// ============================================================
// 每日数据采集编排（方案第七步）
// 流程：数据源 → collector → cleaner(标准化) → 数据库 → 计算衍生指标
// 幂等：同一天重复执行会先删后写
// 执行方式：bun scripts/collect-daily.ts（对应方案中的 python collect_daily.py）
// ============================================================

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { fetchAllPools, type EmPoolStock } from "@/lib/market/em";
import {
  fetchAllStockSnapshot,
  fetchAllIndexKlines,
  fetchKlineBatch,
  type TxDailyBar,
  type TxRankRow,
  type IndexSeries,
} from "@/lib/market/tx";
import {
  detectBarStatus,
  limitUpPriceOf,
  limitDownPriceOf,
  limitPctOf,
  marketOf,
  txCode,
} from "@/lib/market/rules";
import { computeBoardChain, type BoardState } from "@/lib/calc/board";
import { calcSentiment, sealRateOf, brokenRateOf } from "@/lib/calc/sentiment";
import { buildConceptStats, buildThemeStats } from "@/lib/calc/concept";
import {
  matchThemes,
  matchThemesInTextDetailed,
  normalizeStockName,
} from "@/lib/calc/themeRules";
import { analyzeImpact } from "@/lib/calc/newsImpact";
import { fetchStockNews, type StockNewsItem } from "@/lib/market/stockNews";
import { pmap, sleep } from "@/lib/market/http";
import { createHash } from "node:crypto";
import { nameAbbrOf } from "@/lib/calc/pinyin";

export interface CollectOptions {
  backfillDays?: number; // 回补的交易日数量（默认10）
  preWindowDays?: number; // 窗口前种子天数（保证连板链路进入窗口时基数正确）
  klineBars?: number; // 每只股票拉取的K线根数
}

export interface CollectSummary {
  latestDate: string;
  tradeDates: string[];
  stockCount: number;
  limitUpCount: number;
  brokenCount: number;
  limitDownCount: number;
  firstBoardCount: number;
  lianbanCount: number;
  highestBoard: number;
  totalAmountYi: number;
  upCount: number;
  downCount: number;
  sealRate: number;
  temperature: number;
  stage: string;
  boardMismatch: number; // 自主连板数 与 数据源参考连板数 不一致数量（交叉验证观测）
  stockNewsCount: number; // 最新交易日涨停股个股新闻实际新增入库条数（主线新闻流）
  stockNewsFetched: number; // 抓取到的个股新闻条数（含已存在、upsert 跳过的）
  evidenceStocks: number; // 有新闻归类证据的涨停股数
  themeMerged: number; // 新闻证据新增的主线归属处数
  durationMs: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 解析 JSON 字符串为主题材数组（防御式） */
function parseThemes(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

interface KlineMeta {
  bars: TxDailyBar[];
  barByDate: Map<string, TxDailyBar>;
}

/**
 * 量比 = 当日成交量 / 前 N 日均量（爆量体系核心定义，默认 N=20）
 * 历史不足 N 日时用可用天数（至少 5 日，否则返回 null）
 */
function volumeRatioAt(meta: KlineMeta | undefined, date: string, window = 20): number | null {
  if (!meta) return null;
  const idx = meta.bars.findIndex((b) => b.date === date);
  if (idx < 0) return null;
  const prevBars = meta.bars.slice(Math.max(0, idx - window), idx);
  if (prevBars.length < 5) return null;
  const avg = prevBars.reduce((s, b) => s + b.volume, 0) / prevBars.length;
  if (avg <= 0) return null;
  return Math.round((meta.bars[idx].volume / avg) * 100) / 100;
}

export async function runCollection(opts: CollectOptions = {}): Promise<CollectSummary> {
  const startedAt = Date.now();
  const backfillDays = opts.backfillDays ?? 10;
  const preWindowDays = opts.preWindowDays ?? 12;
  const klineBars = opts.klineBars ?? 80;

  // ---------- 1. 全市场快照（腾讯）：涨跌家数 / 成交额 / 名称表 ----------
  console.log("[1/7] 拉取全市场A股快照 ...");
  const snapshot = await fetchAllStockSnapshot(200);
  if (snapshot.length === 0) throw new Error("全市场快照获取失败");
  const snapByCode = new Map<string, TxRankRow>(snapshot.map((r) => [r.code, r]));
  const nameMap = new Map<string, string>(snapshot.map((r) => [r.code, r.name]));
  const upCount = snapshot.filter((r) => r.changePct > 0).length;
  const downCount = snapshot.filter((r) => r.changePct < 0).length;
  const flatCount = snapshot.filter((r) => r.changePct === 0).length;
  const totalAmountYi =
    Math.round(snapshot.reduce((s, r) => s + r.amount, 0) / 1e6) / 100; // 元 → 亿元
  console.log(`  快照 ${snapshot.length} 只 | 涨${upCount} 跌${downCount} 平${flatCount} | 两市成交 ${totalAmountYi} 亿`);

  // ---------- 2. 指数K线：确定交易日序列 ----------
  console.log("[2/7] 拉取指数K线（确定交易日与指数收盘） ...");
  const indexSeries = await fetchAllIndexKlines(60);
  const sh = indexSeries.find((s) => s.code === "000001");
  if (!sh || sh.bars.length < 5) throw new Error("上证指数K线获取失败");
  const allDates = sh.bars.map((b) => b.date); // 升序
  const windowDates = allDates.slice(-backfillDays);
  const preDates = allDates.slice(
    Math.max(0, allDates.length - backfillDays - preWindowDays),
    allDates.length - backfillDays
  );
  const latestDate = windowDates[windowDates.length - 1];
  console.log(`  最新交易日 ${latestDate}，回补窗口 ${windowDates[0]} ~ ${latestDate}`);

  // ---------- 3. 东财涨停池/炸板池/跌停池（支持历史日期） ----------
  console.log("[3/7] 拉取东财涨停池/炸板池/跌停池 ...");
  const poolsByDate = await fetchAllPools(windowDates.map((d) => d.replace(/-/g, "")));
  // 空日语义（src/lib/market/em.ts）：fetchAllPools 对每个日期无条件 set key；
  // 当日无涨停/炸板/跌停时值为三个空数组，接口失败被 catch 后同样是空数组但 key 仍在。
  // 因此只校验 key 是否存在，不能按数组长度判缺失（会把正常空日误判为失败）。
  const missingPoolDates = windowDates.filter((d) => !poolsByDate.has(d.replace(/-/g, "")));
  if (missingPoolDates.length > 0) {
    throw new Error(`东财池数据缺日（${missingPoolDates.join(", ")}），终止采集以避免写库空窗`);
  }
  const latestPools = poolsByDate.get(latestDate.replace(/-/g, ""));
  if (!latestPools || (latestPools.zt.length === 0 && latestPools.zb.length === 0)) {
    throw new Error(`涨停池数据获取失败（${latestDate}），请检查数据源网络`);
  }

  // 行业映射：来自所有池子行（题材聚类的数据来源，动态获取）
  const industryByCode = new Map<string, string>();
  for (const p of poolsByDate.values()) {
    for (const row of [...p.zt, ...p.zb, ...p.dt]) {
      if (row.industry) industryByCode.set(row.code, row.industry);
    }
  }

  // ---------- 4. 池内股票去重 → 拉取日K（不复权，自主判定用） ----------
  console.log("[4/7] 拉取池内股票历史K线 ...");
  const poolCodes = new Set<string>();
  for (const p of poolsByDate.values()) {
    for (const row of [...p.zt, ...p.zb, ...p.dt]) poolCodes.add(row.code);
  }
  console.log(`  去重后 ${poolCodes.size} 只股票`);
  const klineMaps = await fetchKlineBatch([...poolCodes], klineBars, 6);
  const klineMeta = new Map<string, KlineMeta>();
  for (const [code, bars] of klineMaps) {
    klineMeta.set(code, {
      bars,
      barByDate: new Map(bars.map((b) => [b.date, b])),
    });
  }
  const klineFail = [...poolCodes].filter((c) => (klineMaps.get(c)?.length ?? 0) === 0).length;
  if (klineFail > 0) console.warn(`  ${klineFail} 只股票K线获取失败（连板数将依赖池子链路）`);

  // ---------- 5. 规则法检测（方案第八步：不直接相信数据源的连板数） ----------
  console.log("[5/7] 规则法逐日涨停/炸板/跌停检测并合并名单 ...");
  const ruleDates = [...preDates, ...windowDates]; // 种子期 + 窗口期
  type Roster = { zt: Set<string>; zb: Set<string>; dt: Set<string> };
  const ruleRosters = new Map<string, Roster>();
  for (const d of ruleDates) ruleRosters.set(d, { zt: new Set(), zb: new Set(), dt: new Set() });

  for (const [code, meta] of klineMeta) {
    if (meta.bars.length === 0) continue;
    const name = nameMap.get(code) ?? code;
    for (let i = 1; i < meta.bars.length; i++) {
      const bar = meta.bars[i];
      const roster = ruleRosters.get(bar.date);
      if (!roster) continue; // K线含窗口外日期，跳过
      const prev = meta.bars[i - 1];
      const status = detectBarStatus(code, name, prev.close, bar);
      if (!status) continue;
      const key = status === "limitUp" ? "zt" : status === "broken" ? "zb" : "dt";
      roster[key].add(code);
    }
  }

  // 合并名单：窗口期 = 数据源池 ∪ 规则检测；种子期 = 仅规则检测
  const mergedRosters = new Map<string, Set<string>>();
  for (const d of ruleDates) {
    const rule = ruleRosters.get(d)!;
    const set = new Set<string>([...rule.zt]);
    if (windowDates.includes(d)) {
      const p = poolsByDate.get(d.replace(/-/g, ""));
      if (p) for (const row of p.zt) set.add(row.code);
    }
    mergedRosters.set(d, set);
  }

  // ---------- 6. 连板链路计算（自主状态机） ----------
  console.log("[6/7] 计算连板链路 / 晋级率 ...");
  const chain = computeBoardChain(ruleDates, mergedRosters, nameMap);

  // 交叉验证：自主连板数 vs 数据源参考连板数
  let boardMismatch = 0;
  for (const d of windowDates) {
    const p = poolsByDate.get(d.replace(/-/g, ""));
    if (!p) continue;
    const dayStates = chain.byDate.get(d);
    for (const row of p.zt) {
      const own = dayStates?.get(row.code)?.boardCount ?? 0;
      if (row.sourceBoardCount > 0 && own > 0 && row.sourceBoardCount !== own) {
        boardMismatch++;
        console.warn(
          `  [校验] ${d} ${row.code} ${row.name}: 自主=${own}板, 数据源=${row.sourceBoardCount}板（以自主计算为准）`
        );
      }
    }
  }

  // ---------- 7. 入库（先删后写，幂等） ----------
  console.log("[7/7] 标准化入库 ...");
  const ymd = (d: string) => d.replace(/-/g, "");
  const poolsOf = (d: string) => {
    const p = poolsByDate.get(ymd(d));
    if (!p) throw new Error(`东财池数据缺失：${d}，终止采集以避免写库空窗`);
    return p;
  };

  // 7.1 股票基础信息（含拼音首字母，搜索用）
  for (const batch of chunk(snapshot, 500)) {
    for (const r of batch) {
      await db.stockBasic.upsert({
        where: { stockCode: r.code },
        create: {
          stockCode: r.code,
          stockName: r.name,
          market: marketOf(r.code),
          industry: industryByCode.get(r.code) ?? null,
          nameAbbr: nameAbbrOf(r.name),
        },
        update: {
          stockName: r.name,
          industry: industryByCode.get(r.code) ?? undefined,
          nameAbbr: nameAbbrOf(r.name),
        },
      });
    }
  }

  // 题材主表 + 关联表（动态采集，非硬编码）
  const conceptNames = [...new Set(industryByCode.values())].filter(Boolean);
  for (const name of conceptNames) {
    await db.concept.upsert({ where: { conceptName: name }, create: { conceptName: name }, update: {} });
  }
  const conceptIdByName = new Map<string, number>();
  for (const c of await db.concept.findMany()) conceptIdByName.set(c.conceptName, c.id);
  for (const [code, ind] of industryByCode) {
    const cid = conceptIdByName.get(ind);
    if (!cid) continue;
    await db.stockConcept.upsert({
      where: { stockCode_conceptId: { stockCode: code, conceptId: cid } },
      create: { stockCode: code, conceptId: cid, source: "eastmoney-hybk" },
      update: {},
    });
  }

  // 所有写库操作先入队，最后在单个交互事务内顺序执行（网络抓取/计算均在事务外）。
  type DbOp = (tx: Prisma.TransactionClient) => Promise<unknown>;
  const dbOps: DbOp[] = [];

  // 7.2 清理旧数据（幂等）—— 所有表 tradeDate 统一为 YYYY-MM-DD 格式
  const dateStrs = windowDates;
  dbOps.push((tx) => tx.limitUp.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.brokenLimit.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.limitDown.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.dailyStock.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.boardHistory.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.dailyConcept.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.sentimentDaily.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));
  dbOps.push((tx) => tx.dailyMarket.deleteMany({ where: { tradeDate: { in: dateStrs }, rowOrigin: "LIVE" } }));

  // 7.3 每日行情明细（DailyStock，仅池内股票）
  interface DailyStockRow {
    tradeDate: string; stockCode: string; open: number; high: number; low: number; close: number;
    prevClose: number; changePct: number; volume: number; amount: number | null;
    turnoverRate: number | null; floatMarketCap: number | null;
    volumeRatio: number | null;
    isLimitUp: boolean; isLimitDown: boolean; isBroken: boolean;
  }
  const dailyStockRows: DailyStockRow[] = [];
  const poolRowBy = new Map<string, EmPoolStock>(); // `${date}:${code}` -> pool row
  for (const d of windowDates) {
    const p = poolsOf(d);
    for (const row of p.zt) poolRowBy.set(`${d}:${row.code}`, row);
    for (const row of p.zb) poolRowBy.set(`${d}:${row.code}`, row);
    for (const row of p.dt) poolRowBy.set(`${d}:${row.code}`, row);
  }

  const seenStockDate = new Set<string>();
  for (const code of poolCodes) {
    const meta = klineMeta.get(code);
    if (!meta) continue;
    for (let i = 1; i < meta.bars.length; i++) {
      const bar = meta.bars[i];
      if (!windowDates.includes(bar.date)) continue;
      const dedupeKey = `${bar.date}:${code}`;
      if (seenStockDate.has(dedupeKey)) continue; // 防御：K线偶发重复日期
      seenStockDate.add(dedupeKey);
      const prev = meta.bars[i - 1];
      const poolRow = poolRowBy.get(`${bar.date}:${code}`);
      const pct = ((bar.close / prev.close - 1) * 100) as number;
      const isLatest = bar.date === latestDate;
      const snap = snapByCode.get(code);
      // 成交额：池子精确值 > K线真实值 > 快照精确值 > 典型价估算
      const amount =
        poolRow?.amount ??
        bar.amount ??
        (isLatest && snap ? snap.amount : Math.round(bar.volume * 100 * ((bar.open + bar.high + bar.low + bar.close) / 4)));
      const turnoverRate = poolRow?.turnoverRate ?? (isLatest && snap ? snap.turnoverRate : null);
      const floatMarketCap = poolRow?.floatMarketCap ?? (isLatest && snap ? snap.floatMarketCap : null);
      dailyStockRows.push({
        tradeDate: bar.date,
        stockCode: code,
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        prevClose: prev.close,
        changePct: Math.round(pct * 100) / 100,
        volume: bar.volume,
        amount,
        turnoverRate: turnoverRate ?? null,
        floatMarketCap: floatMarketCap ?? null,
        volumeRatio: volumeRatioAt(meta, bar.date),
        isLimitUp: mergedRosters.get(bar.date)!.has(code),
        isLimitDown: ruleRosters.get(bar.date)!.dt.has(code) || (poolsByDate.get(ymd(bar.date))?.dt.some((r) => r.code === code) ?? false),
        isBroken: ruleRosters.get(bar.date)!.zb.has(code) || (poolsByDate.get(ymd(bar.date))?.zb.some((r) => r.code === code) ?? false),
      });
    }
  }
  for (const batch of chunk(dailyStockRows, 400)) dbOps.push((tx) => tx.dailyStock.createMany({ data: batch }));

  // 7.4 涨停 / 炸板 / 跌停明细 + 连板历史
  const limitUpRows: Parameters<typeof db.limitUp.createMany>[0]["data"] = [];
  const brokenRows: Parameters<typeof db.brokenLimit.createMany>[0]["data"] = [];
  const limitDownRows: Parameters<typeof db.limitDown.createMany>[0]["data"] = [];
  const boardHistRows: Parameters<typeof db.boardHistory.createMany>[0]["data"] = [];

  for (const d of windowDates) {
    const p = poolsOf(d);
    const rule = ruleRosters.get(d)!;
    const states = chain.byDate.get(d)!;

    const mkLimitUp = (row: EmPoolStock) => {
      const st = states.get(row.code);
      return {
        tradeDate: d, stockCode: row.code, stockName: row.name,
        limitPrice: row.limitPrice > 0 ? row.limitPrice : row.price,
        closePrice: row.price, changePct: row.changePct,
        firstLimitTime: row.firstLimitTime, lastLimitTime: row.lastLimitTime,
        openCount: row.openCount, sealAmount: row.sealFund > 0 ? row.sealFund : null,
        amount: row.amount > 0 ? row.amount : null,
        turnoverRate: row.turnoverRate > 0 ? row.turnoverRate : null,
        floatMarketCap: row.floatMarketCap > 0 ? row.floatMarketCap : null,
        industry: row.industry || null,
        boardCount: st?.boardCount ?? 1,
        volumeRatio: volumeRatioAt(klineMeta.get(row.code), d),
        themes: JSON.stringify(matchThemes(row.name, row.industry)),
        sourceBoard: row.sourceBoardCount > 0 ? row.sourceBoardCount : null,
        daysAndBoards: row.days > 0 ? `${row.days}天${row.boards}板` : null,
        isPromotion: st?.isPromotion ?? false,
        isRebound: st?.isRebound ?? false,
      };
    };
    for (const row of p.zt) limitUpRows.push(mkLimitUp(row));

    // 规则检出但池子遗漏的涨停（补录）
    for (const code of rule.zt) {
      if (p.zt.some((r) => r.code === code)) continue;
      const meta = klineMeta.get(code)!;
      const bar = meta.barByDate.get(d);
      const prev = meta.bars[meta.bars.findIndex((b) => b.date === d) - 1];
      if (!bar || !prev) continue;
      const name = nameMap.get(code) ?? code;
      const pct = limitPctOf(code, name);
      const st = states.get(code);
      limitUpRows.push({
        tradeDate: d, stockCode: code, stockName: name,
        limitPrice: limitUpPriceOf(prev.close, pct), closePrice: bar.close,
        changePct: Math.round(((bar.close / prev.close - 1) * 100) * 100) / 100,
        firstLimitTime: bar.open === limitUpPriceOf(prev.close, pct) ? "09:25:00" : null,
        lastLimitTime: null, openCount: 0, sealAmount: null,
        amount: Math.round(bar.volume * 100 * ((bar.open + bar.high + bar.low + bar.close) / 4)),
        turnoverRate: null, floatMarketCap: null,
        industry: industryByCode.get(code) ?? null,
        themes: JSON.stringify(matchThemes(name, industryByCode.get(code) ?? null)),
        boardCount: st?.boardCount ?? 1, volumeRatio: volumeRatioAt(meta, d), sourceBoard: null, daysAndBoards: null,
        isPromotion: st?.isPromotion ?? false, isRebound: st?.isRebound ?? false,
      });
    }

    for (const row of p.zb) {
      const st = states.get(row.code);
      brokenRows.push({
        tradeDate: d, stockCode: row.code, stockName: row.name,
        limitPrice: row.limitPrice > 0 ? row.limitPrice : limitUpPriceOf(row.price, limitPctOf(row.code, row.name)),
        closePrice: row.price, changePct: row.changePct,
        firstLimitTime: row.firstLimitTime, openCount: row.openCount,
        amount: row.amount > 0 ? row.amount : null,
        turnoverRate: row.turnoverRate > 0 ? row.turnoverRate : null,
        floatMarketCap: row.floatMarketCap > 0 ? row.floatMarketCap : null,
        industry: row.industry || null,
        volumeRatio: volumeRatioAt(klineMeta.get(row.code), d),
      });
      void st;
    }

    for (const row of p.dt) {
      limitDownRows.push({
        tradeDate: d, stockCode: row.code, stockName: row.name,
        limitPrice: limitDownPriceOf(row.price / (1 + row.changePct / 100), limitPctOf(row.code, row.name)),
        closePrice: row.price, changePct: row.changePct,
        brokeCount: row.openCount,
        continuousDays: row.continuousDownDays > 0 ? row.continuousDownDays : null,
        amount: row.amount > 0 ? row.amount : null,
        industry: row.industry || null,
      });
    }

    // 连板历史（含断板记录 boardCount=0）
    for (const st of states.values() as IterableIterator<BoardState>) {
      if (st.boardCount === 0 && !st.isBreak) continue;
      boardHistRows.push({
        tradeDate: d, stockCode: st.stockCode, stockName: st.stockName,
        boardCount: st.boardCount, previousBoardCount: st.previousBoardCount,
        isPromotion: st.isPromotion, isBreak: st.isBreak, isRebound: st.isRebound,
      });
    }
  }
  // 去重前置：入库与所有下游统计（新闻证据、题材/情绪、summary）统一消费 uniq* 行，
  // 避免「入库去重、统计不去重」导致汇总与库内明细不一致。
  const uniqLimitUp = limitUpRows.filter((r, i) => limitUpRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);
  const uniqBroken = brokenRows.filter((r, i) => brokenRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);
  const uniqDown = limitDownRows.filter((r, i) => limitDownRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);
  const uniqBoard = boardHistRows.filter((r, i) => boardHistRows.findIndex(x => x.tradeDate === r.tradeDate && x.stockCode === r.stockCode) === i);
  // ---------- 7.4.2 个股新闻证据（最新交易日涨停股：新闻参与题材归类） ----------
  // 用户方法论：不能光看行业分类——要看股票下面的相关新闻再归类。
  // 新闻命中主线关键词 → ①佐证/新增该股主线归属（merge 进 themes）
  //                    ②证据明细落 LimitUp.themeEvidence（可解释）
  //                    ③新闻入库 NewsItem(kind=stock) 挂到主线下（主线新闻流）
  console.log("[7.4b] 个股新闻 → 题材归类证据（最新交易日涨停股） ...");
  let stockNewsCount = 0;
  let stockNewsFetched = 0;
  let evidenceStocks = 0;
  let themeMerged = 0;
  {
    const [yy, mm, dd] = latestDate.split("-").map(Number);
    const nextDayDate = new Date(Date.UTC(yy, mm - 1, dd + 1)).toISOString().slice(0, 10);
    const dayStart = `${latestDate} 00:00:00`;
    const dayEnd = `${nextDayDate} 23:59:59`; // 当日+次日：盘后/次日早间新闻同样支撑当日归类
    const latestLuRows = uniqLimitUp.filter((r) => r.tradeDate === latestDate);

    const fetched = await pmap(latestLuRows, 3, async (row) => {
      try {
        const news = await fetchStockNews(row.stockName, { since: dayStart, until: dayEnd, take: 8 });
        await sleep(120); // 对数据源限速
        return { row, news };
      } catch {
        return { row, news: [] as StockNewsItem[] };
      }
    });

    const newsRowsToInsert: Parameters<typeof db.newsItem.createMany>[0]["data"] = [];
    for (const { row, news } of fetched) {
      if (news.length === 0) continue;
      stockNewsFetched += news.length;
      const inherited = parseThemes(row.themes);
      const evidence: { theme: string; hits: string[]; title: string; media: string; time: string }[] = [];
      const extraThemes = new Set<string>();
      for (const it of news) {
        const text = `${it.title} ${it.summary}`;
        const detail = matchThemesInTextDetailed(text);
        const { impact } = analyzeImpact(text);
        for (const d of detail) {
          evidence.push({ theme: d.theme, hits: d.hits, title: it.title, media: it.media, time: it.pubTime });
          if (!inherited.includes(d.theme)) extraThemes.add(d.theme);
        }
        // 主线新闻流：个股新闻挂 新闻命中主线 ∪ 该股当日主线（快讯流之外的增量）
        const newsThemes = [...new Set([...detail.map((d) => d.theme), ...inherited])];
        const hash = createHash("md5")
          .update(it.url || `${row.stockCode}-${it.title}`)
          .digest("hex")
          .slice(0, 16);
        newsRowsToInsert.push({
          extId: `em:${row.stockCode}:${hash}`,
          pubTime: it.pubTime,
          content: `${it.title}${it.summary ? `；${it.summary}` : ""}`.slice(0, 400),
          source: "eastmoney-search",
          kind: "stock",
          impact,
          themes: newsThemes.length ? JSON.stringify(newsThemes) : null,
          stocks: JSON.stringify([
            { market: "cn", symbol: txCode(row.stockCode), key: normalizeStockName(row.stockName) },
          ]),
        });
      }
      if (evidence.length > 0) {
        evidenceStocks++;
        row.themeEvidence = JSON.stringify(evidence.slice(0, 6));
      }
      if (extraThemes.size > 0) {
        themeMerged += extraThemes.size;
        row.themes = JSON.stringify([...inherited, ...extraThemes]);
      }
    }
    // 实际新增条数：事务外按 batch 查已存在 extId（单进程采集，无并发竞态）。
    // 必须在 summary 构建前算好——事务在 summary 之后才执行。
    const knownExtIds = new Set<string>();
    for (const batch of chunk(newsRowsToInsert, 200)) {
      const existing = await db.newsItem.findMany({
        where: { extId: { in: batch.map((n) => n.extId) } },
        select: { extId: true },
      });
      for (const r of existing) knownExtIds.add(r.extId);
    }
    stockNewsCount = newsRowsToInsert.reduce((acc, n) => acc + (knownExtIds.has(n.extId) ? 0 : 1), 0);
    // 入库个股新闻（extId 唯一，重复采集幂等）—— 抓取与内存回写已在事务外完成，此处只写库
    for (const batch of chunk(newsRowsToInsert, 200)) {
      for (const n of batch) {
        dbOps.push((tx) => tx.newsItem.upsert({ where: { extId: n.extId }, create: n, update: {} }));
      }
    }
    // 个股新闻裁剪：仅保留最近 600 条（与快讯流 500 条裁剪独立）
    dbOps.push(async (tx) => {
      const stockTotal = await tx.newsItem.count({ where: { kind: "stock" } });
      if (stockTotal > 600) {
        const old = await tx.newsItem.findMany({
          where: { kind: "stock" },
          orderBy: [{ pubTime: "desc" }, { id: "desc" }],
          skip: 600,
          select: { id: true },
        });
        if (old.length > 0) await tx.newsItem.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
      }
    });
    console.log(
      `  覆盖 ${fetched.filter((x) => x.news.length > 0).length}/${latestLuRows.length} 只 | 抓取 ${stockNewsFetched} 条 / 新增入库 ${stockNewsCount} 条 | 新闻证据 ${evidenceStocks} 只 | 新增归属 ${themeMerged} 处`
    );
  }

  for (const batch of chunk(uniqLimitUp, 400)) dbOps.push((tx) => tx.limitUp.createMany({ data: batch }));
  for (const batch of chunk(uniqBroken, 400)) dbOps.push((tx) => tx.brokenLimit.createMany({ data: batch }));
  for (const batch of chunk(uniqDown, 400)) dbOps.push((tx) => tx.limitDown.createMany({ data: batch }));
  for (const batch of chunk(uniqBoard, 400)) dbOps.push((tx) => tx.boardHistory.createMany({ data: batch }));

  // ---------- 7.4.5 爆量榜（含非涨停标的） ----------
  // 口径：正式=volumeRatioAt（当日成交量/前20日均量）≥2，与涨停池完全一致。
  // 预筛双通道（时点无关：盘前/盘中补采时全市场快照量比无效，池内精算兜底）：
  //   ① 腾讯全市场快照量比≥1.5 取前120（运行时有效则覆盖非涨停爆量股）
  //   ② 池内股票（K线已在手）直接 volumeRatioAt ≥1.5（涨停/炸板爆量股必不遗漏）
  console.log("[7.5] 爆量候选计算（快照+池内双预筛，含非涨停） ...");
  const SURGE_PREFILTER_RATIO = 1.5;
  const SURGE_CANDIDATE_LIMIT = 120;
  const SURGE_RATIO_MIN = 2;
  const ztSetLatest = mergedRosters.get(latestDate)!;
  const zbSetLatest = new Set<string>([
    ...ruleRosters.get(latestDate)!.zb,
    ...(poolsByDate.get(ymd(latestDate))?.zb.map((r) => r.code) ?? []),
  ]);
  const snapSurgeCands = snapshot
    .filter((r) => r.volumeRatio >= SURGE_PREFILTER_RATIO && r.price > 0)
    .sort((a, b) => b.volumeRatio - a.volumeRatio)
    .slice(0, SURGE_CANDIDATE_LIMIT);
  const poolSurgeCands: string[] = [];
  for (const [code, meta] of klineMeta) {
    const r = volumeRatioAt(meta, latestDate);
    if (r != null && r >= SURGE_PREFILTER_RATIO) poolSurgeCands.push(code);
  }
  const surgeCodes = new Set<string>([...snapSurgeCands.map((r) => r.code), ...poolSurgeCands]);
  console.log(
    `  量比预筛：快照 ${snapSurgeCands.length} 只 + 池内精算 ${poolSurgeCands.length} 只 → 去重 ${surgeCodes.size} 只 → 20日口径精算`
  );
  const surgeKlines = await fetchKlineBatch(
    [...surgeCodes].filter((c) => !klineMeta.has(c)),
    100,
    6
  );
  for (const [code, bars] of surgeKlines) {
    if (bars.length > 0 && !klineMeta.has(code)) {
      klineMeta.set(code, { bars, barByDate: new Map(bars.map((b) => [b.date, b])) });
    }
  }
  // 当日 DailyStock 行（K线日 bar，时点无关）：价格/涨跌幅一律取此；快照仅在数值有效时补充成交额/换手/市值
  const dsLatestByCode = new Map(
    dailyStockRows.filter((r) => r.tradeDate === latestDate).map((r) => [r.stockCode, r])
  );
  const surgeRows: Parameters<typeof db.volumeSurge.createMany>[0]["data"] = [];
  for (const code of surgeCodes) {
    const meta = klineMeta.get(code);
    const ratio = volumeRatioAt(meta, latestDate);
    if (ratio == null || ratio < SURGE_RATIO_MIN) continue;
    const idx = meta!.bars.findIndex((b) => b.date === latestDate);
    if (idx < 0) continue; // 当日无K线（停牌等）
    const bar = meta!.bars[idx];
    const prevBar = idx > 0 ? meta!.bars[idx - 1] : undefined;
    // 价格/涨跌幅取 K线日 bar（时点无关：盘前补采快照价停在昨收、量比无效也能算对）
    const price = bar.close;
    if (price <= 0) continue;
    const changePct =
      prevBar && prevBar.close > 0
        ? Math.round((bar.close / prevBar.close - 1) * 10000) / 100
        : dsLatestByCode.get(code)?.changePct ?? 0;
    const snap = snapByCode.get(code);
    const name = nameMap.get(code) ?? "";
    const ds = dsLatestByCode.get(code);
    const amount = snap && snap.amount > 0 ? snap.amount : bar.amount && bar.amount > 0 ? bar.amount : ds?.amount ?? null;
    const turnoverRate =
      snap && snap.turnoverRate > 0 ? snap.turnoverRate : ds?.turnoverRate && ds.turnoverRate > 0 ? ds.turnoverRate : null;
    const floatMarketCap =
      snap && snap.floatMarketCap > 0 ? snap.floatMarketCap : ds?.floatMarketCap && ds.floatMarketCap > 0 ? ds.floatMarketCap : null;
    const win = meta!.bars.slice(Math.max(0, idx - 59), idx + 1);
    const high60 = Math.max(...win.map((b) => b.high));
    const low60 = Math.min(...win.map((b) => b.low));
    const distFromHigh60 = Math.round(((high60 - price) / high60) * 10000) / 100;
    const distFromLow60 = Math.round(((price - low60) / low60) * 10000) / 100;
    const position = distFromHigh60 <= 10 ? "high" : distFromHigh60 >= 30 ? "low" : "mid";
    const industry = industryByCode.get(code) ?? null;
    surgeRows.push({
      tradeDate: latestDate, stockCode: code, stockName: name,
      close: price, changePct, volumeRatio: ratio,
      amount,
      turnoverRate,
      floatMarketCap,
      industry,
      themes: JSON.stringify(matchThemes(name, industry)),
      isLimitUp: ztSetLatest.has(code),
      isBroken: zbSetLatest.has(code),
      position, distFromHigh60, distFromLow60,
    });
  }
  console.log(
    `  爆量入选 ${surgeRows.length} 家（涨停 ${surgeRows.filter((r) => r.isLimitUp).length} / 非涨停 ${
      surgeRows.filter((r) => !r.isLimitUp).length
    } · 高位 ${surgeRows.filter((r) => r.position === "high").length} / 低位 ${
      surgeRows.filter((r) => r.position === "low").length
    }）`
  );
  // 仅清理并重写最新交易日（历史爆量保留，供 P2 爆量后表现统计）
  dbOps.push((tx) => tx.volumeSurge.deleteMany({ where: { tradeDate: latestDate } }));
  for (const batch of chunk(surgeRows, 400)) dbOps.push((tx) => tx.volumeSurge.createMany({ data: batch }));

  // 7.5 题材统计 + 情绪指标 + 市场汇总
  const indexByDate = new Map<string, Record<string, { close: number; pct: number }>>();
  // 指数官方成交额（上证指数 + 深证综指 = 沪深两市成交额，口径历史一致）
  const indexAmountByDate = new Map<string, number>();
  for (const s of indexSeries as IndexSeries[]) {
    for (let i = 1; i < s.bars.length; i++) {
      const b = s.bars[i];
      const rec = indexByDate.get(b.date) ?? {};
      rec[s.code] = { close: b.close, pct: Math.round(((b.close / s.bars[i - 1].close - 1) * 100) * 100) / 100 };
      indexByDate.set(b.date, rec);
    }
    if (s.code === "000001" || s.code === "399106") {
      for (const b of s.bars) {
        if (b.amount) indexAmountByDate.set(b.date, (indexAmountByDate.get(b.date) ?? 0) + b.amount);
      }
    }
  }

  const conceptRows: Parameters<typeof db.dailyConcept.createMany>[0]["data"] = [];
  const sentimentRows: Parameters<typeof db.sentimentDaily.createMany>[0]["data"] = [];
  const marketRows: Parameters<typeof db.dailyMarket.createMany>[0]["data"] = [];

  for (const d of windowDates) {
    const lu = uniqLimitUp.filter((r) => r.tradeDate === d);
    const zb = uniqBroken.filter((r) => r.tradeDate === d);
    const dt = uniqDown.filter((r) => r.tradeDate === d);
    const sealRate = sealRateOf(lu.length, zb.length);
    const brokenRate = brokenRateOf(lu.length, zb.length);

    // 题材（双层：行业细分 + 主线题材规则归组）
    const conceptStats = buildConceptStats(
      lu.map((r) => ({
        stockCode: r.stockCode, stockName: r.stockName,
        industry: (r.industry as string) ?? "", boardCount: r.boardCount as number,
        firstLimitTime: r.firstLimitTime as string | null, amount: r.amount as number | null,
      })),
      zb.map((r) => ({ industry: (r.industry as string) ?? "" }))
    );
    for (const c of conceptStats) {
      conceptRows.push({ tradeDate: d, ...c, kind: "industry" });
    }
    const themeStats = buildThemeStats(
      lu.map((r) => ({
        stockCode: r.stockCode, stockName: r.stockName,
        industry: (r.industry as string) ?? "", boardCount: r.boardCount as number,
        firstLimitTime: r.firstLimitTime as string | null, amount: r.amount as number | null,
        themes: parseThemes(r.themes as string | null | undefined), // 含新闻证据合并后的归属
      }))
    );
    for (const t of themeStats) {
      const { members, ...rest } = t;
      conceptRows.push({ tradeDate: d, ...rest, kind: "theme", members: JSON.stringify(members) });
    }

    // 情绪
    const states = chain.byDate.get(d)!;
    const highestBoard = Math.max(0, ...[...states.values()].map((s) => s.boardCount));
    const prevDate = ruleDates[ruleDates.indexOf(d) - 1];
    let yesterdayLimitAvg: number | null = null;
    let yesterdayCount: number | null = null;
    let yesterdayRedCount: number | null = null;
    if (prevDate) {
      const prevRoster = mergedRosters.get(prevDate)!;
      const pcts: number[] = [];
      let red = 0;
      for (const code of prevRoster) {
        const meta = klineMeta.get(code);
        const idx = meta?.bars.findIndex((b) => b.date === d) ?? -1;
        if (!meta || idx <= 0) continue;
        const pct = ((meta.bars[idx].close / meta.bars[idx - 1].close - 1) * 100) as number;
        pcts.push(pct);
        if (pct > 0) red++;
      }
      if (pcts.length > 0) {
        yesterdayCount = prevRoster.size;
        yesterdayRedCount = red;
        yesterdayLimitAvg = Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100;
      }
    }
    const promos = chain.promotionsByDate.get(d) ?? [];
    const isLatest = d === latestDate;
    const s = calcSentiment({
      limitUpCount: lu.length, limitDownCount: dt.length, brokenCount: zb.length,
      highestBoard, yesterdayLimitAvg,
      upCount: isLatest ? upCount : null,
      downCount: isLatest ? downCount : null,
    });
    sentimentRows.push({
      tradeDate: d,
      limitUpCount: lu.length, limitDownCount: dt.length, brokenLimitCount: zb.length,
      sealRate: Math.round(sealRate * 10000) / 10000,
      brokenRate: Math.round(brokenRate * 10000) / 10000,
      highestBoard,
      yesterdayLimitAvg, yesterdayCount, yesterdayRedCount,
      promotionDetails: JSON.stringify(promos),
      sentimentTemperature: s.temperature, sentimentStage: s.stage,
      upCount: isLatest ? upCount : null,
      downCount: isLatest ? downCount : null,
    });

    // 市场汇总
    const idx = indexByDate.get(d) ?? {};
    marketRows.push({
      tradeDate: d,
      shIndex: idx["000001"]?.close ?? null, shChangePct: idx["000001"]?.pct ?? null,
      szIndex: idx["399001"]?.close ?? null, szChangePct: idx["399001"]?.pct ?? null,
      cyIndex: idx["399006"]?.close ?? null, cyChangePct: idx["399006"]?.pct ?? null,
      kcIndex: idx["000688"]?.close ?? null, kcChangePct: idx["000688"]?.pct ?? null,
      sz50Index: idx["000016"]?.close ?? null, sz50ChangePct: idx["000016"]?.pct ?? null,
      bz50Index: idx["899050"]?.close ?? null, bz50ChangePct: idx["899050"]?.pct ?? null,
      totalAmount: indexAmountByDate.has(d)
        ? Math.round(indexAmountByDate.get(d)! / 1e6) / 100
        : isLatest ? totalAmountYi : null,
      upCount: isLatest ? upCount : null,
      downCount: isLatest ? downCount : null,
      flatCount: isLatest ? flatCount : null,
      limitUpCount: lu.length, limitDownCount: dt.length, brokenCount: zb.length,
      sealRate: Math.round(sealRate * 10000) / 10000,
      dataSource: "eastmoney+qq",
    });
  }
  for (const batch of chunk(conceptRows, 400)) dbOps.push((tx) => tx.dailyConcept.createMany({ data: batch }));
  for (const batch of chunk(sentimentRows, 400)) dbOps.push((tx) => tx.sentimentDaily.createMany({ data: batch }));
  dbOps.push((tx) => tx.dailyMarket.createMany({ data: marketRows }));

  // ---------- 采集日志 ----------
  const latestStates = chain.byDate.get(latestDate)!;
  const latestLu = uniqLimitUp.filter((r) => r.tradeDate === latestDate);
  const latestBroken = uniqBroken.filter((r) => r.tradeDate === latestDate);
  const latestDown = uniqDown.filter((r) => r.tradeDate === latestDate);
  const latestSent = sentimentRows.find((r) => r.tradeDate === latestDate)!;
  const summary: CollectSummary = {
    latestDate,
    tradeDates: windowDates,
    stockCount: snapshot.length,
    limitUpCount: latestLu.length,
    brokenCount: latestBroken.length,
    limitDownCount: latestDown.length,
    firstBoardCount: latestLu.filter((r) => (r.boardCount as number) === 1).length,
    lianbanCount: latestLu.filter((r) => (r.boardCount as number) >= 2).length,
    highestBoard: Math.max(0, ...[...latestStates.values()].map((x) => x.boardCount)),
    totalAmountYi,
    upCount, downCount,
    sealRate: sealRateOf(latestLu.length, latestBroken.length),
    temperature: latestSent.sentimentTemperature as number,
    stage: latestSent.sentimentStage as string,
    boardMismatch,
    stockNewsCount,
    stockNewsFetched,
    evidenceStocks,
    themeMerged,
    durationMs: Date.now() - startedAt,
  };
  dbOps.push((tx) => tx.collectLog.create({
    data: {
      tradeDates: `${windowDates[0]}~${latestDate}`,
      source: "eastmoney+qq",
      stockCount: snapshot.length,
      limitUpCount: summary.limitUpCount,
      durationMs: summary.durationMs,
      status: "success",
      message: JSON.stringify({
        broken: summary.brokenCount, highestBoard: summary.highestBoard,
        mismatch: summary.boardMismatch,
        stockNews: summary.stockNewsCount, stockNewsFetched: summary.stockNewsFetched,
        evidenceStocks: summary.evidenceStocks,
        themeMerged: summary.themeMerged,
      }),
    },
  }));
  // 单一交互事务：8 表删写 + 新闻 + 爆量 + collectLog 全有全无；网络抓取与计算均已在事务外完成。
  await db.$transaction(async (tx) => {
    for (const op of dbOps) await op(tx);
  }, { timeout: 60000 });
  // 验收清单成交额与数据库口径一致（指数官方口径）
  const latestMarketRow = marketRows.find((r) => r.tradeDate === latestDate);
  if (latestMarketRow && typeof latestMarketRow.totalAmount === "number") {
    summary.totalAmountYi = latestMarketRow.totalAmount;
  }
  return summary;
}
