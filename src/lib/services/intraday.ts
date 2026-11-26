// ============================================================
// 盘中异动服务：聚合最近一轮采样 + 当日事件，全部后端计算
//
// 数据源：IntradaySnap / IntradayIndexSnap / IntradayEvent（调度器每 2 分钟写入）
// 页面读取走 30 秒缓存，实时性 = 采样间隔；前端只做展示/筛选/排序
//
// 分组口径（与 calc/intradayMoves.ts 阈值一致，透明可查）：
// - 拉升异动：10 分钟窗口涨幅 ≥1.5%（列表上下文）或当日有拉升事件；
//   按「大盘同期」分型：上证窗口 ≥+0.15% 共振 / ≤-0.15% 逆势 / 其余独立
// - 板块联动：拉升候选股按 题材（近3日主线标签∪规则归组）∪行业 聚合，
//   同组 ≥3 只 → 板块联动块（领涨 = 组内窗口涨幅最大者）
// - 领涨龙头：当前封板股按「昨日连板数+1」高度排序（空间高度），
//   并列最高者为市场总龙头；板块联动块的领涨股为题材龙头
// - 前期爆量：近 5 个交易日爆量股今日盘中状态（涨停/拉升/守住/跌破）
// - 跳水预警：10 分钟窗口跌幅 ≤-3% 或当日有跳水事件
// ============================================================

import { db } from "@/lib/db";
import { cachedTtl } from "@/lib/cache";
import { matchThemes } from "@/lib/calc/themeRules";
import {
  bjNow,
  sessionInfo,
  windowBaseline,
  SURGE_WINDOW_MIN,
  DIVE_PCT,
  IDX_RES_PCT,
  type EventKind,
  type SessionInfo,
} from "@/lib/calc/intradayMoves";

export interface IntradayStockRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  price: number;
  changePct: number;
  pct5m: number | null;
  pct10m: number | null;
  pct30m: number | null;
  idxPct10m: number | null; // 上证 10 分钟窗口涨跌 %
  rsPct10m: number | null; // 窗口相对强度
  volumeRatio: number | null;
  turnoverRate: number | null;
  amount: number | null; // 元
  floatMarketCap: number | null;
  isSealed: boolean;
  touchedLimit: boolean;
  kinds: EventKind[]; // 当日已产生的事件类型
  lastEventTs: string | null;
}

export type SurgeType = "resonance" | "counter" | "independent";

export interface IntradaySurgeRow extends IntradayStockRow {
  windowPct: number; // 用于分组的窗口涨幅（10m 优先，回退 5m）
  windowMinutes: number; // 窗口实际分钟数
  surgeType: SurgeType;
  indexWindow: number | null;
}

export interface SectorBlockRow {
  name: string;
  kind: "theme" | "industry";
  memberCount: number;
  avgWindow: number;
  leaderCode: string | null;
  leaderName: string | null;
  members: {
    stockCode: string;
    stockName: string;
    windowPct: number;
    changePct: number;
    isSealed: boolean;
    themes: string[];
  }[];
}

export interface IntradayLeaderRow {
  stockCode: string;
  stockName: string;
  boardYesterday: number; // 昨日连板数（0=今日首板）
  boardNow: number; // 今日板数 = 昨日+1（封板状态）
  price: number;
  changePct: number;
  amount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  themes: string[];
  firstSealTs: string | null; // 今日首次封板事件时间
  unsealCount: number; // 今日炸板事件次数
  volumeRatio: number | null;
}

export type PrevVolumeStatus = "limitup" | "surging" | "holding" | "floor_broken";

export interface IntradayPrevVolumeRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  surgeDate: string;
  surgeCount: number;
  surgeVolumeRatio: number;
  surgeClose: number;
  currentPrice: number;
  currentChangePct: number;
  sinceChangePct: number;
  pct10m: number | null;
  volumeRatio: number | null;
  isSealed: boolean;
  status: PrevVolumeStatus;
}

export interface IntradayEventRow {
  ts: string;
  kind: EventKind;
  stockCode: string;
  stockName: string;
  price: number;
  changePct: number;
  windowPct: number | null;
  indexPct: number | null;
  rsPct: number | null;
  volumeRatio: number | null;
  themes: string[];
}

export interface IntradayIndexRow {
  close: number;
  changePct: number;
  pct10m: number | null;
}

export interface IntradayData {
  hasData: boolean; // 当日是否已有盘中采样
  tradeDate: string; // 最近采样交易日
  pollTs: string | null; // 最近采样时刻
  pollCount: number; // 当日采样轮数
  session: SessionInfo;
  indices: { sh: IntradayIndexRow | null; sz: IntradayIndexRow | null; cyb: IntradayIndexRow | null };
  indexWindow10m: number | null; // 上证 10 分钟窗口涨跌（共振/逆势分型基准）
  universeSize: number;
  sealedCount: number;
  surges: IntradaySurgeRow[]; // 拉升异动（含共振/逆势/独立分型 chip）
  surgeTotal: number;
  dives: IntradayStockRow[];
  sectors: SectorBlockRow[];
  leaders: IntradayLeaderRow[];
  marketLeaders: IntradayLeaderRow[]; // 市场最高板（并列）
  prevVolume: IntradayPrevVolumeRow[];
  events: IntradayEventRow[]; // 时间轴（最新在前，上限 80）
  eventCount: number; // 当日事件总数
  updatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toMin(ts: string): number {
  return Number(ts.slice(0, 2)) * 60 + Number(ts.slice(3, 5));
}

function hhmmMinus(ts: string, minutes: number): string {
  const t = Math.max(0, toMin(ts) - minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function safeThemes(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getIntraday(): Promise<IntradayData> {
  return cachedTtl("intraday:latest", 30_000, computeIntraday);
}

async function computeIntraday(): Promise<IntradayData> {
  const updatedAt = new Date().toISOString();
  const session = sessionInfo(bjNow());

  const empty: IntradayData = {
    hasData: false,
    tradeDate: "",
    pollTs: null,
    pollCount: 0,
    session,
    indices: { sh: null, sz: null, cyb: null },
    indexWindow10m: null,
    universeSize: 0,
    sealedCount: 0,
    surges: [],
    surgeTotal: 0,
    dives: [],
    sectors: [],
    leaders: [],
    marketLeaders: [],
    prevVolume: [],
    events: [],
    eventCount: 0,
    updatedAt,
  };

  // 最近采样交易日与时刻
  const lastSnap = await db.intradaySnap.findFirst({
    orderBy: [{ tradeDate: "desc" }, { pollTs: "desc" }],
    select: { tradeDate: true, pollTs: true },
  });
  if (!lastSnap) return empty;
  const tradeDate = lastSnap.tradeDate;
  const pollTs = lastSnap.pollTs;
  const nowTs = pollTs; // 窗口计算基准 = 最近采样时刻

  // 并行取数：最新轮快照 / 窗口基线 / 指数 / 事件 / 交易日历
  const [latestRows, pointsRows, idxRows, eventRows, pollCount, prevMarket] = await Promise.all([
    db.intradaySnap.findMany({ where: { tradeDate, pollTs } }),
    db.intradaySnap.findMany({
      where: { tradeDate, pollTs: { gte: hhmmMinus(nowTs, SURGE_WINDOW_MIN + 20), lt: nowTs } },
      select: { stockCode: true, pollTs: true, price: true },
    }),
    db.intradayIndexSnap.findMany({
      where: { tradeDate, pollTs: { gte: hhmmMinus(nowTs, SURGE_WINDOW_MIN + 10) } },
      orderBy: { pollTs: "asc" },
    }),
    db.intradayEvent.findMany({
      where: { tradeDate },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
    }),
    db.intradaySnap.findMany({
      where: { tradeDate },
      select: { pollTs: true },
      distinct: ["pollTs"],
    }),
    db.dailyMarket.findFirst({
      where: { tradeDate: { lt: tradeDate } },
      orderBy: { tradeDate: "desc" },
      select: { tradeDate: true },
    }),
  ]);
  if (latestRows.length === 0) return empty;

  // ---------- 窗口涨幅（5/10/30 分钟，同一份基线点） ----------
  const pointsByCode = new Map<string, { pollTs: string; price: number }[]>();
  for (const r of pointsRows) {
    const arr = pointsByCode.get(r.stockCode) ?? [];
    arr.push({ pollTs: r.pollTs, price: r.price });
    pointsByCode.set(r.stockCode, arr);
  }

  // 上证窗口基准（取 [t-16, t-6] 内最近一点）
  const shRows = idxRows.filter((r) => r.indexCode === "sh000001");
  const shNow = shRows.length > 0 ? shRows[shRows.length - 1] : null;
  const shBase = (() => {
    for (let i = shRows.length - 1; i >= 0; i--) {
      const age = toMin(nowTs) - toMin(shRows[i].pollTs);
      if (age >= SURGE_WINDOW_MIN - 4 && age <= SURGE_WINDOW_MIN + 6 && shRows[i].close > 0) {
        return shRows[i];
      }
    }
    return null;
  })();
  const indexWindow10m =
    shNow && shBase ? round2(shNow.changePct - shBase.changePct) : null;

  const idxPct10mOf = (code: string): number | null => {
    const rows = idxRows.filter((r) => r.indexCode === code);
    if (rows.length === 0) return null;
    const now = rows[rows.length - 1];
    const base = (() => {
      for (let i = rows.length - 1; i >= 0; i--) {
        const age = toMin(nowTs) - toMin(rows[i].pollTs);
        if (age >= SURGE_WINDOW_MIN - 4 && age <= SURGE_WINDOW_MIN + 6) return rows[i];
      }
      return null;
    })();
    return base ? round2(now.changePct - base.changePct) : null;
  };

  // ---------- 题材标签（行业库 + 近3日涨停主线标签，10 分钟缓存） ----------
  const themeMaps = await loadThemeMaps(tradeDate);

  // ---------- 当日事件索引（kind/时间） ----------
  const kindsByCode = new Map<string, Set<EventKind>>();
  const lastEventTs = new Map<string, string>();
  const sealTs = new Map<string, string[]>();
  const unsealCount = new Map<string, number>();
  for (const ev of eventRows) {
    const kinds = kindsByCode.get(ev.stockCode) ?? new Set<EventKind>();
    kinds.add(ev.kind as EventKind);
    kindsByCode.set(ev.stockCode, kinds);
    if (!lastEventTs.has(ev.stockCode)) lastEventTs.set(ev.stockCode, ev.ts);
    if (ev.kind === "seal") {
      const arr = sealTs.get(ev.stockCode) ?? [];
      arr.push(ev.ts);
      sealTs.set(ev.stockCode, arr);
    }
    if (ev.kind === "unseal") {
      unsealCount.set(ev.stockCode, (unsealCount.get(ev.stockCode) ?? 0) + 1);
    }
  }

  // ---------- 行模型 ----------
  const rows: IntradayStockRow[] = latestRows.map((r) => {
    const b10 = windowBaseline(pointsByCode.get(r.stockCode) ?? [], nowTs, SURGE_WINDOW_MIN);
    const b5 = windowBaseline(pointsByCode.get(r.stockCode) ?? [], nowTs, 5);
    const b30 = windowBaseline(pointsByCode.get(r.stockCode) ?? [], nowTs, 30);
    const pct10m = b10 ? round2((r.price / b10.price - 1) * 100) : null;
    const pct5m = b5 ? round2((r.price / b5.price - 1) * 100) : null;
    const pct30m = b30 ? round2((r.price / b30.price - 1) * 100) : null;
    const industry = themeMaps.industry.get(r.stockCode) || null;
    const themes = [
      ...new Set([
        ...matchThemes(r.stockName, industry),
        ...(themeMaps.recentThemes.get(r.stockCode) ?? []),
      ]),
    ];
    return {
      stockCode: r.stockCode,
      stockName: r.stockName,
      industry,
      themes,
      price: r.price,
      changePct: r.changePct,
      pct5m,
      pct10m,
      pct30m,
      idxPct10m: indexWindow10m,
      rsPct10m: pct10m != null && indexWindow10m != null ? round2(pct10m - indexWindow10m) : null,
      volumeRatio: r.volumeRatio != null && r.volumeRatio > 0 ? r.volumeRatio : null,
      turnoverRate: r.turnoverRate,
      amount: r.amount,
      floatMarketCap: r.floatMarketCap,
      isSealed: r.isSealed,
      touchedLimit: r.touchedLimit,
      kinds: [...(kindsByCode.get(r.stockCode) ?? [])],
      lastEventTs: lastEventTs.get(r.stockCode) ?? null,
    };
  });

  const rowByCode = new Map(rows.map((r) => [r.stockCode, r]));

  // ---------- 拉升异动（窗口 ≥1.5% 或有拉升事件） ----------
  const surgeAll: IntradaySurgeRow[] = [];
  for (const r of rows) {
    const hasSurgeEvent = r.kinds.some((k) => k === "surge" || k === "surge_resonance" || k === "surge_counter");
    const pct10 = r.pct10m;
    const pct5 = r.pct5m;
    let windowPct: number | null = null;
    let windowMinutes = SURGE_WINDOW_MIN;
    if (pct10 != null) {
      windowPct = pct10;
    } else if (pct5 != null) {
      windowPct = pct5;
      windowMinutes = 5;
    }
    if (windowPct == null && !hasSurgeEvent) continue;
    if (windowPct == null || windowPct < 1.5) {
      if (!hasSurgeEvent) continue;
      if (windowPct == null) continue; // 有事件但窗口基线丢失：事件流里看，列表不展示
    }
    const idxWindow = indexWindow10m;
    const surgeType: SurgeType =
      idxWindow == null || Math.abs(idxWindow) < IDX_RES_PCT
        ? "independent"
        : idxWindow > 0
          ? "resonance"
          : "counter";
    surgeAll.push({ ...r, windowPct, windowMinutes, surgeType, indexWindow: idxWindow });
  }
  surgeAll.sort(
    (a, b) =>
      b.windowPct - a.windowPct ||
      b.changePct - a.changePct ||
      (b.rsPct10m ?? 0) - (a.rsPct10m ?? 0)
  );

  // ---------- 跳水预警 ----------
  const dives = rows
    .filter((r) => (r.pct10m != null && r.pct10m <= DIVE_PCT) || (r.pct5m != null && r.pct5m <= DIVE_PCT / 2) || r.kinds.includes("dive"))
    .sort((a, b) => (a.pct10m ?? a.pct5m ?? 0) - (b.pct10m ?? b.pct5m ?? 0))
    .slice(0, 80);

  // ---------- 板块联动 ----------
  const candidates = surgeAll.filter((s) => s.windowPct >= 1.5);
  const blockMap = new Map<string, { kind: "theme" | "industry"; members: IntradaySurgeRow[] }>();
  for (const s of candidates) {
    const tags: { name: string; kind: "theme" | "industry" }[] = s.themes.map((t) => ({ name: t, kind: "theme" as const }));
    if (s.industry) tags.push({ name: s.industry, kind: "industry" });
    for (const t of tags) {
      const key = `${t.kind}:${t.name}`;
      const b = blockMap.get(key) ?? { kind: t.kind, members: [] };
      b.members.push(s);
      blockMap.set(key, b);
    }
  }
  const sectors: SectorBlockRow[] = [];
  for (const [key, b] of blockMap) {
    if (b.members.length < 3) continue;
    const members = [...b.members].sort((x, y) => y.windowPct - x.windowPct);
    const avgWindow = round2(members.reduce((s, m) => s + m.windowPct, 0) / members.length);
    sectors.push({
      name: key.slice(key.indexOf(":") + 1),
      kind: b.kind,
      memberCount: members.length,
      avgWindow,
      leaderCode: members[0].stockCode,
      leaderName: members[0].stockName,
      members: members.slice(0, 12).map((m) => ({
        stockCode: m.stockCode,
        stockName: m.stockName,
        windowPct: m.windowPct,
        changePct: m.changePct,
        isSealed: m.isSealed,
        themes: m.themes,
      })),
    });
  }
  sectors.sort((a, b) => b.memberCount - a.memberCount || b.avgWindow - a.avgWindow);

  // ---------- 领涨龙头（封板股：昨日连板+1） ----------
  const sealedRows = rows.filter((r) => r.isSealed);
  const boardYesterday = new Map<string, number>();
  if (sealedRows.length > 0 && prevMarket) {
    const bh = await db.boardHistory.findMany({
      where: { tradeDate: prevMarket.tradeDate, stockCode: { in: sealedRows.map((r) => r.stockCode) }, boardCount: { gt: 0 } },
      select: { stockCode: true, boardCount: true },
    });
    for (const b of bh) boardYesterday.set(b.stockCode, b.boardCount);
  }
  const leaders: IntradayLeaderRow[] = sealedRows
    .map((r) => {
      const by = boardYesterday.get(r.stockCode) ?? 0;
      return {
        stockCode: r.stockCode,
        stockName: r.stockName,
        boardYesterday: by,
        boardNow: by + 1,
        price: r.price,
        changePct: r.changePct,
        amount: r.amount,
        turnoverRate: r.turnoverRate,
        floatMarketCap: r.floatMarketCap,
        industry: r.industry,
        themes: r.themes,
        firstSealTs: (sealTs.get(r.stockCode) ?? []).sort()[0] ?? null,
        unsealCount: unsealCount.get(r.stockCode) ?? 0,
        volumeRatio: r.volumeRatio,
      };
    })
    .sort((a, b) => b.boardNow - a.boardNow || (b.amount ?? 0) - (a.amount ?? 0));
  const maxBoard = leaders.length > 0 ? leaders[0].boardNow : 0;
  const marketLeaders = leaders.filter((l) => l.boardNow === maxBoard);

  // ---------- 前期爆量（近 5 个交易日） ----------
  const surgeDates = await db.dailyMarket.findMany({
    where: { tradeDate: { lt: tradeDate } },
    orderBy: { tradeDate: "desc" },
    take: 5,
    select: { tradeDate: true },
  });
  const windowDates = surgeDates.map((d) => d.tradeDate).reverse();
  const surgeRows =
    windowDates.length > 0
      ? await db.volumeSurge.findMany({
          where: { tradeDate: { in: windowDates } },
          orderBy: [{ tradeDate: "asc" }, { volumeRatio: "desc" }],
        })
      : [];
  interface Agg {
    code: string;
    name: string;
    baseline: (typeof surgeRows)[number];
    count: number;
    themes: string[];
    industry: string | null;
  }
  const agg = new Map<string, Agg>();
  for (const s of surgeRows) {
    const prev = agg.get(s.stockCode);
    if (!prev) {
      agg.set(s.stockCode, {
        code: s.stockCode,
        name: s.stockName,
        baseline: s,
        count: 1,
        themes: safeThemes(s.themes),
        industry: s.industry,
      });
    } else {
      prev.count += 1;
      prev.baseline = s;
      if (!prev.industry && s.industry) prev.industry = s.industry;
      if (prev.themes.length === 0 && s.themes) prev.themes = safeThemes(s.themes);
    }
  }
  const prevVolume: IntradayPrevVolumeRow[] = [];
  for (const a of agg.values()) {
    const u = rowByCode.get(a.code);
    if (!u) continue; // 本轮采样宇宙外（波动小），盘中页面不展示
    const b = a.baseline;
    const sinceChangePct = round2((u.price / b.close - 1) * 100);
    const status: PrevVolumeStatus = u.isSealed
      ? "limitup"
      : u.changePct >= 2
        ? "surging"
        : sinceChangePct >= 0
          ? "holding"
          : "floor_broken";
    prevVolume.push({
      stockCode: a.code,
      stockName: a.name,
      industry: a.industry,
      themes: a.themes,
      surgeDate: b.tradeDate,
      surgeCount: a.count,
      surgeVolumeRatio: b.volumeRatio,
      surgeClose: b.close,
      currentPrice: u.price,
      currentChangePct: u.changePct,
      sinceChangePct,
      pct10m: u.pct10m,
      volumeRatio: u.volumeRatio,
      isSealed: u.isSealed,
      status,
    });
  }
  const STATUS_RANK: Record<PrevVolumeStatus, number> = { limitup: 0, surging: 1, holding: 2, floor_broken: 3 };
  prevVolume.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.sinceChangePct - a.sinceChangePct);

  // ---------- 指数 ----------
  const mkIdx = (code: string): IntradayIndexRow | null => {
    const rs = idxRows.filter((r) => r.indexCode === code);
    if (rs.length === 0) return null;
    const now = rs[rs.length - 1];
    return { close: now.close, changePct: now.changePct, pct10m: idxPct10mOf(code) };
  };

  return {
    hasData: true,
    tradeDate,
    pollTs,
    pollCount: pollCount.length,
    session,
    indices: { sh: mkIdx("sh000001"), sz: mkIdx("sz399001"), cyb: mkIdx("sz399006") },
    indexWindow10m,
    universeSize: rows.length,
    sealedCount: sealedRows.length,
    surges: surgeAll.slice(0, 200),
    surgeTotal: surgeAll.length,
    dives,
    sectors: sectors.slice(0, 20),
    leaders: leaders.slice(0, 60),
    marketLeaders,
    prevVolume,
    events: eventRows.slice(0, 80).map((ev) => ({
      ts: ev.ts,
      kind: ev.kind as EventKind,
      stockCode: ev.stockCode,
      stockName: ev.stockName,
      price: ev.price,
      changePct: ev.changePct,
      windowPct: ev.windowPct,
      indexPct: ev.indexPct,
      rsPct: ev.rsPct,
      volumeRatio: ev.volumeRatio,
      themes: safeThemes(ev.themes),
    })),
    eventCount: eventRows.length,
    updatedAt,
  };
}

// 题材映射（10 分钟缓存；行业库全量 + 指定交易日之前的近 3 个交易日涨停主线标签）
// 导出供异动监控（anomaly）盘中实时口径复用
let themeMapsCache: {
  at: number;
  industry: Map<string, string>;
  recentThemes: Map<string, string[]>;
} | null = null;

export async function loadThemeMaps(tradeDate: string) {
  if (themeMapsCache && Date.now() - themeMapsCache.at < 10 * 60_000) return themeMapsCache;
  const dates = await db.dailyMarket.findMany({
    where: { tradeDate: { lt: tradeDate } },
    orderBy: { tradeDate: "desc" },
    take: 3,
    select: { tradeDate: true },
  });
  const [basics, limitUps] = await Promise.all([
    db.stockBasic.findMany({ select: { stockCode: true, industry: true } }),
    dates.length > 0
      ? db.limitUp.findMany({
          where: { tradeDate: { in: dates.map((d) => d.tradeDate) } },
          select: { stockCode: true, themes: true },
        })
      : [],
  ]);
  const recentThemes = new Map<string, string[]>();
  for (const r of limitUps) {
    const arr = safeThemes(r.themes);
    if (arr.length === 0) continue;
    recentThemes.set(r.stockCode, [...new Set([...(recentThemes.get(r.stockCode) ?? []), ...arr])]);
  }
  themeMapsCache = {
    at: Date.now(),
    industry: new Map(basics.map((b) => [b.stockCode, b.industry ?? ""])),
    recentThemes,
  };
  return themeMapsCache;
}
