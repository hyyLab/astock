// ============================================================
// 盘中采样器（异动监控实时数据链路的核心）
//
// 交易时段（工作日 09:20–11:36 ∪ 12:55–15:06）每 2 分钟由调度器触发：
//   ① 拉取腾讯全市场快照 + 三大指数实时行情
//   ② 交易日自校验：指数行情时间戳必须为今日（节假日自动跳过）
//   ③ 过滤"有异动价值"的股票写入 IntradaySnap（控制体量，约千余只/轮）
//   ④ 冷启动/新进候选股：拉分时序列回补 5/10/30 分钟窗口基线（真实分时价）
//   ⑤ 指数写入 IntradayIndexSnap（共振/逆势的同期大盘基准）
//   ⑥ 异动事件检测写入 IntradayEvent（10 分钟桶去重）
//   ⑦ 清理 intraday: 缓存
//
// 幂等：同一 pollTs 重复执行 = 先删后写；事件按 dedupeKey upsert
// 收盘后由采集任务调用 pruneIntraday() 清理 3 个交易日前采样（事件留 30 天）
// ============================================================

import { db } from "@/lib/db";
import { cacheClearPrefix } from "@/lib/cache";
import { fetchAllStockSnapshot, type TxRankRow } from "@/lib/market/tx";
import { fetchAIndexQuotes } from "@/lib/market/indexQuote";
import { fetchMinuteSeries, minuteBaselineAt, type MinutePoint } from "@/lib/market/minute";
import { pmap } from "@/lib/market/http";
import { limitPctOf, txCode } from "@/lib/market/rules";
import { matchThemes } from "@/lib/calc/themeRules";
import {
  bjDateStr,
  bjHHMM,
  bjNow,
  detectEvents,
  limitStateOf,
  sessionInfo,
  shouldPollAt,
  SURGE_WINDOW_MIN,
  windowBaseline,
  type EventKind,
  type LimitState,
} from "@/lib/calc/intradayMoves";

/** 采样写入行（writeSnaps 参数） */
interface SnapWriteRow {
  tradeDate: string;
  pollTs: string;
  stockCode: string;
  stockName: string;
  price: number;
  changePct: number;
  volume: number;
  amount: number;
  volumeRatio: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  isSealed: boolean;
  touchedLimit: boolean;
}

export interface IntradayPollResult {
  tradeDate: string;
  pollTs: string;
  universeCount: number; // 本轮入库采样股票数
  backfillCount: number; // 分时回补基线的股票数
  eventsCount: number; // 本轮新增事件数
  eventsByKind: Partial<Record<EventKind, number>>;
  indexPct: number | null; // 上证实时涨幅
  durationMs: number;
}

// 前期爆量股票池（近 5 个交易日 VolumeSurge 并集，10 分钟内存缓存）
let surgePoolCache: { at: number; codes: Set<string> } | null = null;
const SURGE_POOL_TTL_MS = 10 * 60_000;

async function prevSurgeCodes(): Promise<Set<string>> {
  if (surgePoolCache && Date.now() - surgePoolCache.at < SURGE_POOL_TTL_MS) {
    return surgePoolCache.codes;
  }
  const dates = await db.dailyMarket.findMany({
    orderBy: { tradeDate: "desc" },
    take: 5,
    select: { tradeDate: true },
  });
  const rows =
    dates.length > 0
      ? await db.volumeSurge.findMany({
          where: { tradeDate: { in: dates.map((d) => d.tradeDate) } },
          select: { stockCode: true },
        })
      : [];
  const codes = new Set(rows.map((r) => r.stockCode));
  surgePoolCache = { at: Date.now(), codes };
  return codes;
}

function hhmmMinus(ts: string, minutes: number): string {
  const t = Number(ts.slice(0, 2)) * 60 + Number(ts.slice(3, 5)) - minutes;
  const clamped = Math.max(0, t);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function hhmm4Minus(ts: string, minutes: number): string {
  return hhmmMinus(ts, minutes).replace(":", "");
}

/** 采样时刻守卫：非交易窗口抛错（调度器已判，这里双保险；force 供手动脚本使用） */
function assertPollTime(force?: boolean): { tradeDate: string; ts: string; tMinutes: number } {
  const now = bjNow();
  const info = sessionInfo(now);
  const tradeDate = bjDateStr(now);
  const ts = bjHHMM(now);
  const tMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (!force && !shouldPollAt(tMinutes)) {
    throw new Error(`当前非采样窗口（北京时间 ${ts}，${info.label}）`);
  }
  return { tradeDate, ts, tMinutes };
}

/** createMany 幂等写入：先删同键旧数据，再分块 createMany */
async function writeSnaps(tradeDate: string, pollTsList: string[], rows: SnapWriteRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.intradaySnap.deleteMany({
    where: { tradeDate, pollTs: { in: pollTsList } },
  });
  for (let i = 0; i < rows.length; i += 400) {
    await db.intradaySnap.createMany({ data: rows.slice(i, i + 400) });
  }
}

/** 基线行写入：只删除「即将写入的股票×时点」的旧行（保留他股同时点基线），同键去重后写入 */
async function writeBaselineSnaps(tradeDate: string, rows: SnapWriteRow[]): Promise<void> {
  if (rows.length === 0) return;
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = `${r.pollTs}|${r.stockCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const tsList = [...new Set(deduped.map((r) => r.pollTs))];
  const codes = [...new Set(deduped.map((r) => r.stockCode))];
  await db.intradaySnap.deleteMany({
    where: { tradeDate, pollTs: { in: tsList }, stockCode: { in: codes } },
  });
  for (let i = 0; i < deduped.length; i += 400) {
    await db.intradaySnap.createMany({ data: deduped.slice(i, i + 400) });
  }
}

// 题材标签缓存（10 分钟）：行业库 + 近 3 日涨停股主线标签（供事件/采样行标注）
let themeCache: {
  at: number;
  industry: Map<string, string>;
  recentThemes: Map<string, string[]>;
} | null = null;
const THEME_TTL_MS = 10 * 60_000;

async function themeMaps(): Promise<{
  industry: Map<string, string>;
  recentThemes: Map<string, string[]>;
}> {
  if (themeCache && Date.now() - themeCache.at < THEME_TTL_MS) return themeCache;
  const dates = await db.dailyMarket
    .findMany({ orderBy: { tradeDate: "desc" }, take: 3, select: { tradeDate: true } });
  const [basics, limitUps] = await Promise.all([
    db.stockBasic.findMany({ select: { stockCode: true, industry: true } }),
    dates.length > 0
      ? db.limitUp.findMany({
          where: { tradeDate: { in: dates.map((d) => d.tradeDate) } },
          select: { stockCode: true, themes: true },
        })
      : Promise.resolve([] as { stockCode: string; themes: string | null }[]),
  ]);
  const industry = new Map(basics.map((b) => [b.stockCode, b.industry ?? ""]));
  const recentThemes = new Map<string, string[]>();
  for (const r of limitUps) {
    if (!r.themes) continue;
    try {
      const arr = JSON.parse(r.themes) as string[];
      if (!Array.isArray(arr)) continue;
      const prev = recentThemes.get(r.stockCode) ?? [];
      recentThemes.set(r.stockCode, [...new Set([...prev, ...arr.filter((x) => typeof x === "string")])]);
    } catch {
      /* 忽略坏行 */
    }
  }
  themeCache = { at: Date.now(), industry, recentThemes };
  return themeCache;
}

/**
 * 执行一轮盘中采样（调度器每 2 分钟调用；scripts/intraday-poll.ts 手动兜底用 force）
 */
export async function runIntradayPoll(opts?: { force?: boolean }): Promise<IntradayPollResult> {
  const t0 = Date.now();
  const { tradeDate, ts } = assertPollTime(opts?.force);

  // ① 快照 + 指数实时
  const [snap, indexQuotes] = await Promise.all([
    fetchAllStockSnapshot(200),
    fetchAIndexQuotes(),
  ]);
  const shQuote = indexQuotes.get("sh000001");
  const szQuote = indexQuotes.get("sz399001");
  const cybQuote = indexQuotes.get("sz399006");

  // ② 交易日自校验：指数行情时间戳必须是今日（工作日但休市 → 自动跳过）
  const todayCompact = tradeDate.replace(/-/g, "");
  if (!shQuote || !/^\d{14}$/.test(shQuote.quoteTime)) {
    throw new Error("指数实时行情缺失，本轮采样取消");
  }
  if (shQuote.quoteTime.slice(0, 8) !== todayCompact) {
    throw new Error(`指数行情时间戳为 ${shQuote.quoteTime.slice(0, 8)}，疑似非交易日，本轮采样取消`);
  }

  // ③ 上一轮封板集合 + 当日已有采样的股票（回补目标）
  const [latestPrior, existingRows] = await Promise.all([
    db.intradaySnap.findFirst({
      where: { tradeDate, pollTs: { lt: ts } },
      orderBy: { pollTs: "desc" },
      select: { pollTs: true },
    }),
    db.intradaySnap.findMany({
      where: { tradeDate, pollTs: { lt: ts } },
      select: { stockCode: true },
      distinct: ["stockCode"],
    }),
  ]);
  const prevSealedCodes = latestPrior
    ? await db.intradaySnap.findMany({
        where: { tradeDate, pollTs: latestPrior.pollTs, isSealed: true },
        select: { stockCode: true },
      })
    : [];
  const prevSealed = new Set(prevSealedCodes.map((r) => r.stockCode));
  const existingCodes = new Set(existingRows.map((r) => r.stockCode));

  // ④ 前期爆量池
  const surgeCodes = await prevSurgeCodes();

  // ⑤ 异动宇宙过滤：|涨幅|≥1% 或 量比≥1.5 或 触板附近 或 前期爆量 或 上一轮封板
  // （快照源偶有重复行，按代码去重防唯一约束冲突）
  const keep: (TxRankRow & { limitState: LimitState })[] = [];
  const seenCode = new Set<string>();
  for (const s of snap) {
    if (seenCode.has(s.code)) continue;
    seenCode.add(s.code);
    const limitState = limitStateOf(s.changePct, limitPctOf(s.code, s.name));
    if (
      Math.abs(s.changePct) >= 1 ||
      s.volumeRatio >= 1.5 ||
      limitState != null ||
      prevSealed.has(s.code) ||
      surgeCodes.has(s.code)
    ) {
      keep.push({ ...s, limitState });
    }
  }

  // ⑥ 分时回补：当日无采样记录的新进股（按异动强度优先，单轮上限 200 只）
  const newRows = keep
    .filter((r) => !existingCodes.has(r.code))
    .sort(
      (a, b) =>
        Math.abs(b.changePct) + (b.volumeRatio ?? 0) - (Math.abs(a.changePct) + (a.volumeRatio ?? 0))
    )
    .slice(0, 200);

  const backfillBaseline = new Map<string, { price: number; ageMin: number }>(); // code → 10 分钟基线
  const baselineRows: SnapWriteRow[] = [];
  if (newRows.length > 0) {
    const seriesList = await pmap(newRows, 6, async (r) => {
      try {
        return { code: r.code, name: r.name, row: r, series: await fetchMinuteSeries(txCode(r.code)) };
      } catch {
        return { code: r.code, name: r.name, row: r, series: [] as MinutePoint[] };
      }
    });
    for (const { code, name, row, series } of seriesList) {
      if (series.length === 0) continue;
      const prevClose = row.price > 0 && Math.abs(row.changePct) < 99.5
        ? row.price / (1 + row.changePct / 100)
        : 0;
      // 在 5/10/30 分钟前三个目标时点回写真实分时价（pollTs 用分时实际分钟，避免伪造时间）
      for (const back of [5, 10, 30]) {
        const pt = minuteBaselineAt(series, hhmm4Minus(ts, back));
        if (!pt || !(pt.price > 0)) continue;
        const changePct = prevClose > 0 ? Math.round((pt.price / prevClose - 1) * 10000) / 100 : row.changePct;
        baselineRows.push({
          tradeDate,
          pollTs: `${pt.hhmm.slice(0, 2)}:${pt.hhmm.slice(2, 4)}`,
          stockCode: code,
          stockName: name,
          price: pt.price,
          changePct,
          volume: pt.cumVolume,
          amount: pt.cumAmount,
          volumeRatio: null,
          turnoverRate: null,
          floatMarketCap: row.floatMarketCap > 0 ? row.floatMarketCap : null,
          isSealed: false,
          touchedLimit: false,
        });
      }
      const base10 = minuteBaselineAt(series, hhmm4Minus(ts, SURGE_WINDOW_MIN));
      if (base10 && base10.price > 0) {
        const ageMin =
          Number(ts.slice(0, 2)) * 60 + Number(ts.slice(3, 5)) - (Number(base10.hhmm.slice(0, 2)) * 60 + Number(base10.hhmm.slice(2, 4)));
        if (ageMin >= 3 && ageMin <= SURGE_WINDOW_MIN + 5) {
          backfillBaseline.set(code, { price: base10.price, ageMin });
        }
      }
    }
  }

  // ⑦ 库内窗口基线（已有采样历史的股票）
  const universeCodes = keep.map((r) => r.code);
  const pointsRows =
    universeCodes.length > 0
      ? await db.intradaySnap.findMany({
          where: {
            tradeDate,
            pollTs: { gte: hhmmMinus(ts, SURGE_WINDOW_MIN + 10), lt: ts },
            stockCode: { in: universeCodes },
          },
          select: { stockCode: true, pollTs: true, price: true },
        })
      : [];
  const pointsByCode = new Map<string, { pollTs: string; price: number }[]>();
  for (const r of pointsRows) {
    const arr = pointsByCode.get(r.stockCode) ?? [];
    arr.push({ pollTs: r.pollTs, price: r.price });
    pointsByCode.set(r.stockCode, arr);
  }
  const baseline10 = new Map<string, { price: number; ageMin: number }>();
  for (const r of keep) {
    const fromDb = windowBaseline(pointsByCode.get(r.code) ?? [], ts, SURGE_WINDOW_MIN);
    if (fromDb) baseline10.set(r.code, fromDb);
  }
  for (const [code, b] of backfillBaseline) {
    if (!baseline10.has(code)) baseline10.set(code, b);
  }

  // ⑧ 写入本轮采样（同 pollTs 先删后写，幂等）
  const { industry: industryMap, recentThemes } = await themeMaps();
  const themesFor = (code: string, name: string): string[] => {
    const ind = industryMap.get(code) || null;
    return [...new Set([...matchThemes(name, ind), ...(recentThemes.get(code) ?? [])])];
  };
  const snapRows: SnapWriteRow[] = keep.map((r) => ({
    tradeDate,
    pollTs: ts,
    stockCode: r.code,
    stockName: r.name,
    price: r.price,
    changePct: r.changePct,
    volume: r.volume,
    amount: r.amount,
    volumeRatio: r.volumeRatio > 0 ? r.volumeRatio : null,
    turnoverRate: r.turnoverRate > 0 ? r.turnoverRate : null,
    floatMarketCap: r.floatMarketCap > 0 ? r.floatMarketCap : null,
    isSealed: r.limitState === "sealed",
    touchedLimit: r.limitState !== null || prevSealed.has(r.code),
  }));
  await writeSnaps(tradeDate, [ts], snapRows);
  await writeBaselineSnaps(tradeDate, baselineRows);

  // ⑨ 指数采样（upsert 幂等）
  for (const q of [shQuote, szQuote, cybQuote]) {
    if (!q) continue;
    await db.intradayIndexSnap.upsert({
      where: {
        tradeDate_pollTs_indexCode: { tradeDate, pollTs: ts, indexCode: q.fullCode },
      },
      create: {
        tradeDate,
        pollTs: ts,
        indexCode: q.fullCode,
        name: q.name,
        close: q.close,
        changePct: q.changePct,
      },
      update: { close: q.close, changePct: q.changePct },
    });
  }

  // ⑩ 事件检测（指数基线取 [t-14, t-6] 窗口最近一点）
  const idxBaseRow = await db.intradayIndexSnap.findFirst({
    where: {
      tradeDate,
      indexCode: "sh000001",
      pollTs: { gte: hhmmMinus(ts, SURGE_WINDOW_MIN + 4), lte: hhmmMinus(ts, SURGE_WINDOW_MIN - 4) },
    },
    orderBy: { pollTs: "desc" },
  });
  const events = detectEvents({
    tradeDate,
    ts,
    rows: keep.map((r) => ({
      stockCode: r.code,
      stockName: r.name,
      price: r.price,
      changePct: r.changePct,
      volumeRatio: r.volumeRatio > 0 ? r.volumeRatio : null,
      limitState: r.limitState,
      themes: themesFor(r.code, r.name),
    })),
    baseline10,
    indexPctNow: shQuote.changePct,
    indexPctBase: idxBaseRow?.changePct ?? null,
    prevSealed,
  });
  for (const ev of events) {
    await db.intradayEvent.upsert({
      where: { dedupeKey: ev.dedupeKey },
      create: {
        tradeDate,
        ts: ev.ts,
        kind: ev.kind,
        stockCode: ev.stockCode,
        stockName: ev.stockName,
        price: ev.price,
        changePct: ev.changePct,
        windowPct: ev.windowPct,
        indexPct: ev.indexPct,
        rsPct: ev.rsPct,
        volumeRatio: ev.volumeRatio,
        themes: JSON.stringify(ev.themes),
        detail: JSON.stringify(ev.detail),
        dedupeKey: ev.dedupeKey,
      },
      update: {}, // 同桶重复执行不覆盖（保留首见）
    });
  }

  cacheClearPrefix("intraday:");

  const eventsByKind: Partial<Record<EventKind, number>> = {};
  for (const ev of events) eventsByKind[ev.kind] = (eventsByKind[ev.kind] ?? 0) + 1;

  return {
    tradeDate,
    pollTs: ts,
    universeCount: snapRows.length,
    backfillCount: backfillBaseline.size,
    eventsCount: events.length,
    eventsByKind,
    indexPct: shQuote.changePct,
    durationMs: Date.now() - t0,
  };
}

/**
 * 收盘清理：IntradaySnap / IntradayIndexSnap 只留最近 3 个交易日，
 * IntradayEvent 留 30 天（时间轴回放与统计用）。由 15:35 采集任务调用。
 */
export async function pruneIntraday(keepDays = 3): Promise<void> {
  const dates = await db.intradaySnap.findMany({
    select: { tradeDate: true },
    distinct: ["tradeDate"],
    orderBy: { tradeDate: "desc" },
  });
  const keep = dates.slice(0, keepDays).map((d) => d.tradeDate);
  if (keep.length > 0) {
    await db.intradaySnap.deleteMany({ where: { tradeDate: { notIn: keep } } });
    await db.intradayIndexSnap.deleteMany({ where: { tradeDate: { notIn: keep } } });
  }
  const cutoff = new Date(Date.now() + 8 * 3600_000 - 30 * 86400_000).toISOString().slice(0, 10);
  await db.intradayEvent.deleteMany({ where: { tradeDate: { lt: cutoff } } });
}
