// ============================================================
// 异动监控服务：对「最新一天」的显性异动做多维分组，全部后端计算
//
// 日期口径（核心）：「最新一天」= 今天（北京时间交易日），而不是等收盘采集落定
// - 交易日（盘中 / 午休 / 收盘后至采集落定前）：tradeDate = 今天，
//   五维分组按「盘中实时口径」计算——腾讯全市场实时快照 + 盘中采样
//   （封板/炸板/首封时间来自 IntradaySnap/IntradayEvent，大盘基准为实时指数），
//   页面分钟级更新；收盘采集（15:35）落定后自动切换为今天的收盘口径
// - 盘前 / 节假日（指数行情时间戳非今天）或实时快照不可用：
//   回放最近一个收盘日的四池数据（badge = 最新）
// - 历史日期：回放当日显性异动池（涨停/炸板/跌停/爆量四池并集）
//
// 异动宇宙：
// - 今天盘中实时口径：腾讯全市场快照（约 4600 只）→ universe = "snapshot"
// - 收盘 / 历史日期：当日显性异动池并集 → universe = "pools"
//
// 五个维度（口径透明，阈值统一写明）：
// 1. 跟大盘共振：大盘（上证指数）上涨时，个股涨幅 ≥2% 且跑赢大盘 ≥2 个百分点
//    （同向放大，按相对强度 rsPct 降序）
// 2. 逆大盘拉升：大盘下跌时，个股上涨且跑赢大盘 ≥1 个百分点（按涨幅降序）
//    盘中实时口径：大盘方向 = 上证实时涨跌幅；收盘口径 = 上证当日收盘涨跌幅
// 3. 板块效应：主线题材/行业层 涨停 ≥2 家，或 涨停+炸板 ≥3 家（群体异动）
//    盘中实时口径：封板 = 实时涨幅达到涨停幅度（容差 0.15pp），炸板 = 曾封板/触板
//    但当前未封；题材标签 = 近 3 日涨停主线 ∪ 规则归组 ∪ 行业
// 4. 领涨龙头：市场最高连板股（市场总龙头）+ 有板块效应主线题材的龙头
//    盘中实时口径：板数 = 昨日连板数 + 1（封板状态下），首封时间 = 当日首次封板事件
// 5. 前期爆量：近 5 个交易日爆量（量比≥2，20 日口径）的个股今日表现，
//    状态分级：今日涨停 / 今日拉升(≥2%) / 守住不跌(距基准日≥0) / 跌破基准
// ============================================================

import { db } from "@/lib/db";
import { cachedTtl } from "@/lib/cache";
import { fetchAllStockSnapshot, type TxRankRow } from "@/lib/market/tx";
import { fetchAIndexQuotes, type AIndexQuote } from "@/lib/market/indexQuote";
import { limitPctOf } from "@/lib/market/rules";
import { matchThemes } from "@/lib/calc/themeRules";
import { bjDateStr, sessionInfo, limitStateOf, LIMIT_TOL_PCT } from "@/lib/calc/intradayMoves";
import { loadThemeMaps } from "@/lib/services/intraday";

export type PoolSource = "limitup" | "broken" | "limitdown" | "surge" | "scan";

export interface AnomalyStock {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[]; // 主线题材标签（近3日涨停主线 ∪ 规则归组；池内股另含采集标签）
  price: number; // 收盘/最新价
  changePct: number; // 当日涨跌幅 %
  rsPct: number; // 相对大盘强度 = 个股涨幅 - 上证涨幅（百分点）
  volumeRatio: number | null; // 量比（实时快照为腾讯口径；池内为 20 日口径）
  turnoverRate: number | null;
  amount: number | null; // 成交额（元）
  floatMarketCap: number | null; // 流通市值（元）
  isLimitUp: boolean;
  isBroken: boolean;
  isLimitDown: boolean;
  boardCount: number | null; // 连板数（涨停股）
  firstLimitTime: string | null;
  position: "low" | "mid" | "high" | null; // 60 日位置（爆量股才有）
  fromPool: PoolSource; // 异动来源：四池之一 / 全市场扫描
}

export interface SectorEffectMember {
  stockCode: string;
  stockName: string;
  industry: string | null;
  boardCount: number;
  changePct: number | null; // 当日涨幅（非涨停成员可对照）
}

export interface SectorEffectRow {
  conceptName: string;
  kind: "theme" | "industry"; // theme=主线题材（规则归组跨行业）/ industry=行业细分
  limitUpCount: number;
  brokenCount: number;
  highestBoard: number;
  boardStockCount: number; // 连板股票数（≥2板）
  totalAmount: number | null; // 题材内涨停股成交额（亿元）
  strengthScore: number;
  leaderCode: string | null;
  leaderName: string | null;
  members: SectorEffectMember[];
}

export interface LeaderRow {
  scope: "market" | "theme"; // market=市场最高连板（空间龙头）/ theme=题材龙头
  conceptName: string | null; // scope=market 时为 null
  stockCode: string;
  stockName: string;
  boardCount: number;
  firstLimitTime: string | null;
  sealAmount: number | null;
  amount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  themes: string[];
  changePct: number;
  volumeRatio: number | null;
  themeLimitUpCount: number | null; // 所属题材当日涨停家数（scope=theme）
  themeStrength: number | null; // 所属题材强度分（scope=theme）
}

export type PriorSurgeStatus = "limitup" | "surging" | "holding" | "floor_broken";

export interface PriorSurgeRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  surgeDate: string; // 基准日 = 窗口内最近一次爆量日
  surgeCount: number; // 窗口内爆量次数
  surgeVolumeRatio: number; // 基准日量比
  maxVolumeRatio: number; // 窗口内峰值量比
  surgeClose: number; // 基准日收盘
  surgeIsLimitUp: boolean;
  surgeIsBroken: boolean;
  position: "low" | "mid" | "high";
  currentClose: number;
  currentChangePct: number;
  currentVolumeRatio: number | null;
  sinceChangePct: number; // 距基准日涨幅 %（不跌判定核心）
  status: PriorSurgeStatus;
}

export interface AnomalyData {
  tradeDate: string;
  latestDate: string;
  prevDate: string | null;
  nextDate: string | null;
  today: string; // 北京时间今天（「最新一天」锚点，前端日历/徽章用）
  liveMode: boolean; // true = 今天收盘采集未落定，按盘中实时口径计算
  sessionLabel: string; // 盘中 · 上午时段 / 午间休市 / 已收盘 / 非交易日…
  index: { name: string; close: number; changePct: number } | null; // 上证指数（大盘基准）
  indices: {
    sh: { close: number; changePct: number } | null;
    sz: { close: number; changePct: number } | null;
    cyb: { close: number; changePct: number } | null;
  };
  universe: "snapshot" | "pools"; // 异动宇宙来源
  universeLabel: string; // 前端头部直接展示
  universeSize: number;
  resonance: AnomalyStock[]; // 跟大盘共振（最多展示 150）
  resonanceTotal: number; // 满足条件总数
  counter: AnomalyStock[]; // 逆大盘拉升（最多展示 150）
  counterTotal: number;
  sectorEffect: SectorEffectRow[];
  leaders: LeaderRow[];
  priorSurge: PriorSurgeRow[];
  priorSurgeWindow: string[]; // 前期爆量窗口（升序）
  priorSurgeExcluded: number; // 无当日行情、无法判定的家数
  displayCap: number; // 列表展示上限
  updatedAt: string;
}

const DISPLAY_CAP = 150;
const TTL_LIVE_MS = 60_000; // 今天盘中实时口径：60 秒短缓存（采样节奏 2 分钟）
const TTL_EOD_MS = 15 * 60_000; // 收盘口径回放：数据不可变，15 分钟缓存（采集后主动清缓存）

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeParseThemes(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const POOL_RANK: Record<string, number> = { limitup: 0, broken: 1, limitdown: 2, surge: 3, scan: 4 };

interface PoolInfo {
  name: string;
  industry: string | null;
  themes: string[];
  isLimitUp: boolean;
  isBroken: boolean;
  isLimitDown: boolean;
  boardCount: number | null;
  firstLimitTime: string | null;
  sealAmount: number | null;
  amount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  volumeRatio: number | null;
  position: "low" | "mid" | "high" | null;
  pool: Exclude<PoolSource, "scan">;
  close: number; // 池行自带收盘价（涨停池 closePrice / 爆量榜 close）
  changePct: number;
}

// ============================================================
// 入口：日期解析 + 模式路由
// ============================================================

export async function getAnomaly(dateInput?: string): Promise<AnomalyData> {
  const today = bjDateStr();
  const session = sessionInfo();
  const dateRows = await db.dailyMarket.findMany({ orderBy: { tradeDate: "asc" }, select: { tradeDate: true } });
  if (dateRows.length === 0) throw new Error("数据库为空，请先执行每日采集");
  const eodDates = dateRows.map((r) => r.tradeDate);
  const latestEod = eodDates[eodDates.length - 1];

  // 「最新一天」= 今天（交易日）；非交易日回落最近收盘日
  const defaultTarget = session.isTradingDay ? today : latestEod;
  const target =
    !dateInput || dateInput === today || !eodDates.includes(dateInput) ? defaultTarget : dateInput;

  // 今天且收盘采集未落定 → 盘中实时口径（实时快照 + 盘中采样）
  if (target === today && latestEod !== today) {
    return cachedTtl(`anomaly:live:${today}`, TTL_LIVE_MS, async () => {
      const live = await computeAnomalyLive(today, eodDates, session.label);
      if (live) return live;
      // 盘前/节假日（指数行情时间戳非今天）或实时快照不可用：回放最近收盘日
      return computeAnomalyEod(latestEod, eodDates, {
        latestDisplay: latestEod,
        nextIsToday: false,
        today,
        sessionLabel: session.label,
      });
    });
  }

  // 收盘口径回放（含今天的收盘数据已落定的情形）
  const nextIsToday = target === latestEod && session.isTradingDay && today !== latestEod;
  const key = `anomaly:eod:${target}:${nextIsToday ? "fwd" : "end"}`;
  return cachedTtl(key, TTL_EOD_MS, () =>
    computeAnomalyEod(target, eodDates, {
      latestDisplay: session.isTradingDay ? today : latestEod,
      nextIsToday,
      today,
      sessionLabel: session.label,
    })
  );
}

// ============================================================
// 收盘口径（收盘采集落定后 / 历史日期）：四池并集回放
// ============================================================

interface EodOpts {
  latestDisplay: string;
  nextIsToday: boolean;
  today: string;
  sessionLabel: string;
}

async function computeAnomalyEod(
  tradeDate: string,
  eodDates: string[],
  opts: EodOpts
): Promise<AnomalyData> {
  const updatedAt = new Date().toISOString();

  const markets = await db.dailyMarket.findMany({ orderBy: { tradeDate: "asc" } });
  const dates = markets.map((m) => m.tradeDate);
  const idx = Math.max(0, dates.indexOf(tradeDate));
  const prevDate = idx > 0 ? dates[idx - 1] : null;
  const nextDate =
    idx < dates.length - 1 ? dates[idx + 1] : opts.nextIsToday ? opts.latestDisplay : null;
  const market = markets[idx];
  const idxPct = market.shChangePct ?? null;

  const [limitUps, brokens, downs, surges, todayStocks] = await Promise.all([
    db.limitUp.findMany({ where: { tradeDate } }),
    db.brokenLimit.findMany({ where: { tradeDate } }),
    db.limitDown.findMany({ where: { tradeDate } }),
    db.volumeSurge.findMany({ where: { tradeDate }, orderBy: { volumeRatio: "desc" } }),
    db.dailyStock.findMany({ where: { tradeDate } }),
  ]);

  // ---------- 1. 池信息合并（同股多池取最高优先级：涨停>炸板>跌停>爆量，题材取并集） ----------
  const poolByCode = new Map<string, PoolInfo>();
  const mergePool = (code: string, info: PoolInfo) => {
    const prev = poolByCode.get(code);
    if (!prev) {
      poolByCode.set(code, info);
      return;
    }
    const keep = POOL_RANK[prev.pool] <= POOL_RANK[info.pool] ? prev : info;
    const other = keep === prev ? info : prev;
    poolByCode.set(code, {
      ...keep,
      themes: [...new Set([...keep.themes, ...other.themes])],
      isLimitUp: keep.isLimitUp || other.isLimitUp,
      isBroken: keep.isBroken || other.isBroken,
      isLimitDown: keep.isLimitDown || other.isLimitDown,
      amount: keep.amount ?? other.amount,
      turnoverRate: keep.turnoverRate ?? other.turnoverRate,
      floatMarketCap: keep.floatMarketCap ?? other.floatMarketCap,
      volumeRatio: keep.volumeRatio ?? other.volumeRatio,
    });
  };
  for (const r of limitUps)
    mergePool(r.stockCode, {
      name: r.stockName,
      industry: r.industry,
      themes: safeParseThemes(r.themes),
      isLimitUp: true,
      isBroken: false,
      isLimitDown: false,
      boardCount: r.boardCount,
      firstLimitTime: r.firstLimitTime,
      sealAmount: r.sealAmount,
      amount: r.amount,
      turnoverRate: r.turnoverRate,
      floatMarketCap: r.floatMarketCap,
      volumeRatio: r.volumeRatio,
      position: null,
      pool: "limitup",
      close: r.closePrice,
      changePct: r.changePct,
    });
  for (const r of brokens)
    mergePool(r.stockCode, {
      name: r.stockName,
      industry: r.industry,
      themes: [],
      isLimitUp: false,
      isBroken: true,
      isLimitDown: false,
      boardCount: null,
      firstLimitTime: r.firstLimitTime,
      sealAmount: null,
      amount: r.amount,
      turnoverRate: r.turnoverRate,
      floatMarketCap: r.floatMarketCap,
      volumeRatio: r.volumeRatio,
      position: null,
      pool: "broken",
      close: r.closePrice,
      changePct: r.changePct,
    });
  for (const r of downs)
    mergePool(r.stockCode, {
      name: r.stockName,
      industry: r.industry,
      themes: [],
      isLimitUp: false,
      isBroken: false,
      isLimitDown: true,
      boardCount: null,
      firstLimitTime: null,
      sealAmount: null,
      amount: r.amount,
      turnoverRate: null,
      floatMarketCap: null,
      volumeRatio: null,
      position: null,
      pool: "limitdown",
      close: r.closePrice,
      changePct: r.changePct,
    });
  for (const r of surges)
    mergePool(r.stockCode, {
      name: r.stockName,
      industry: r.industry,
      themes: safeParseThemes(r.themes),
      isLimitUp: r.isLimitUp,
      isBroken: r.isBroken,
      isLimitDown: false,
      boardCount: null, // 爆量池行不带连板数；涨停归属由涨停池行（更高优先级）提供
      firstLimitTime: null,
      sealAmount: null,
      amount: r.amount,
      turnoverRate: r.turnoverRate,
      floatMarketCap: r.floatMarketCap,
      volumeRatio: r.volumeRatio,
      position: r.position as PoolInfo["position"],
      pool: "surge",
      close: r.close,
      changePct: r.changePct,
    });

  // ---------- 2. 异动宇宙 = 四池并集（行情优先取 DailyStock 真实 OHLC，缺失回退池行价格） ----------
  const dailyByCode = new Map(todayStocks.map((r) => [r.stockCode, r]));
  const universeRows: AnomalyStock[] = [];
  for (const [code, p] of poolByCode) {
    const d = dailyByCode.get(code);
    const price = d && d.close > 0 ? d.close : p.close;
    const changePct = d && d.close > 0 ? d.changePct : p.changePct;
    if (!(price > 0)) continue;
    universeRows.push({
      stockCode: code,
      stockName: p.name,
      industry: p.industry,
      themes: p.themes,
      price,
      changePct,
      rsPct: idxPct == null ? 0 : round2(changePct - idxPct),
      volumeRatio: d?.volumeRatio != null && d.volumeRatio > 0 ? d.volumeRatio : p.volumeRatio,
      turnoverRate: d?.turnoverRate ?? p.turnoverRate,
      amount: d?.amount ?? p.amount,
      floatMarketCap: d?.floatMarketCap ?? p.floatMarketCap,
      isLimitUp: p.isLimitUp,
      isBroken: p.isBroken,
      isLimitDown: p.isLimitDown,
      boardCount: p.boardCount,
      firstLimitTime: p.firstLimitTime,
      position: p.position,
      fromPool: p.pool,
    });
  }
  const universeLabel = `显性异动池：涨停/炸板/跌停/爆量（${universeRows.length} 只）`;

  // ---------- 3. 跟大盘共振 / 逆大盘拉升 ----------
  const resonanceAll =
    idxPct != null && idxPct > 0
      ? universeRows
          .filter((r) => r.changePct >= 2 && r.rsPct >= 2 && !r.isLimitDown)
          .sort((a, b) => b.rsPct - a.rsPct || b.changePct - a.changePct)
      : [];
  const counterAll =
    idxPct != null && idxPct < 0
      ? universeRows
          .filter((r) => r.changePct > 0 && r.rsPct >= 1 && !r.isLimitDown)
          .sort((a, b) => b.changePct - a.changePct || b.rsPct - a.rsPct)
      : [];

  // ---------- 4. 板块效应 ----------
  const conceptRows = await db.dailyConcept.findMany({
    where: { tradeDate },
    orderBy: [
      { limitUpCount: "desc" },
      { strengthScore: "desc" },
      { highestBoard: "desc" },
    ],
  });
  const changePctByCode = new Map(universeRows.map((r) => [r.stockCode, r.changePct]));
  const sectorEffect: SectorEffectRow[] = [];
  for (const c of conceptRows) {
    if (!(c.limitUpCount >= 2 || c.limitUpCount + c.brokenCount >= 3)) continue;
    let members: SectorEffectMember[] = [];
    if (c.kind === "theme" && c.members) {
      try {
        const raw = JSON.parse(c.members) as {
          stockCode: string;
          stockName: string;
          industry: string | null;
          boardCount: number;
        }[];
        members = raw.map((m) => ({
          ...m,
          changePct: changePctByCode.get(m.stockCode) ?? null,
        }));
      } catch {
        members = [];
      }
    } else if (c.kind === "industry") {
      // 行业层无 members 落库：从涨停+炸板池按行业现算
      members = [...limitUps, ...brokens]
        .filter((r) => r.industry === c.conceptName)
        .map((r) => ({
          stockCode: r.stockCode,
          stockName: r.stockName,
          industry: r.industry,
          boardCount: "boardCount" in r ? (r.boardCount as number) : 0,
          changePct: changePctByCode.get(r.stockCode) ?? null,
        }))
        .sort((a, b) => b.boardCount - a.boardCount);
    }
    sectorEffect.push({
      conceptName: c.conceptName,
      kind: c.kind === "theme" ? "theme" : "industry",
      limitUpCount: c.limitUpCount,
      brokenCount: c.brokenCount,
      highestBoard: c.highestBoard,
      boardStockCount: c.boardCount,
      totalAmount: c.totalAmount,
      strengthScore: c.strengthScore,
      leaderCode: c.leaderCode,
      leaderName: c.leaderName,
      members: members.slice(0, 24),
    });
    if (sectorEffect.length >= 40) break;
  }

  // ---------- 5. 领涨龙头 ----------
  const leaders: LeaderRow[] = [];
  const seenLeader = new Set<string>();
  const limitUpByCode = new Map(limitUps.map((r) => [r.stockCode, r]));
  const marketMaxBoard = limitUps.reduce((m, r) => Math.max(m, r.boardCount), 0);
  const toLeader = (
    r: (typeof limitUps)[number],
    scope: "market" | "theme",
    conceptName: string | null,
    themeLimitUpCount: number | null,
    themeStrength: number | null
  ): LeaderRow => ({
    scope,
    conceptName,
    stockCode: r.stockCode,
    stockName: r.stockName,
    boardCount: r.boardCount,
    firstLimitTime: r.firstLimitTime,
    sealAmount: r.sealAmount,
    amount: r.amount,
    turnoverRate: r.turnoverRate,
    floatMarketCap: r.floatMarketCap,
    industry: r.industry,
    themes: safeParseThemes(r.themes),
    changePct: r.changePct,
    volumeRatio: r.volumeRatio,
    themeLimitUpCount,
    themeStrength,
  });
  // 市场总龙头：最高连板股（并列全列）
  for (const r of limitUps.filter((r) => r.boardCount === marketMaxBoard).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))) {
    if (seenLeader.has(r.stockCode)) continue;
    seenLeader.add(r.stockCode);
    leaders.push(toLeader(r, "market", null, null, null));
  }
  // 题材龙头：有板块效应主线题材的 leaderCode（与题材统计同规则：最高板→首封最早→成交额）
  for (const s of sectorEffect) {
    if (s.kind !== "theme" || !s.leaderCode || seenLeader.has(s.leaderCode)) continue;
    const r = limitUpByCode.get(s.leaderCode);
    if (!r) continue;
    seenLeader.add(s.leaderCode);
    leaders.push(toLeader(r, "theme", s.conceptName, s.limitUpCount, s.strengthScore));
  }

  // ---------- 6. 前期爆量（近 5 个交易日窗口） ----------
  const priorSurgeWindow = eodDates.slice(Math.max(0, eodDates.length - 5), eodDates.indexOf(tradeDate) + 1);
  const surgeWindowRows =
    priorSurgeWindow.length > 0
      ? await db.volumeSurge.findMany({
          where: { tradeDate: { in: priorSurgeWindow } },
          orderBy: [{ tradeDate: "asc" }, { volumeRatio: "desc" }],
        })
      : [];
  interface SurgeAgg {
    code: string;
    name: string;
    industry: string | null;
    themes: string[];
    baseline: (typeof surgeWindowRows)[number];
    count: number;
    maxRatio: number;
  }
  const surgeAgg = new Map<string, SurgeAgg>();
  for (const r of surgeWindowRows) {
    const prev = surgeAgg.get(r.stockCode);
    if (!prev) {
      surgeAgg.set(r.stockCode, {
        code: r.stockCode,
        name: r.stockName,
        industry: r.industry,
        themes: safeParseThemes(r.themes),
        baseline: r, // 升序遍历，最后一次赋值即最近一次爆量日
        count: 1,
        maxRatio: r.volumeRatio,
      });
    } else {
      prev.count += 1;
      prev.maxRatio = Math.max(prev.maxRatio, r.volumeRatio);
      prev.baseline = r;
      if (!prev.industry && r.industry) prev.industry = r.industry;
      if (prev.themes.length === 0 && r.themes) prev.themes = safeParseThemes(r.themes);
    }
  }
  const priorSurge: PriorSurgeRow[] = [];
  let priorSurgeExcluded = 0;
  for (const agg of surgeAgg.values()) {
    const d = dailyByCode.get(agg.code);
    if (!d || !(d.close > 0)) {
      priorSurgeExcluded += 1; // 停牌 / 未入任何异动池无当日行情
      continue;
    }
    const b = agg.baseline;
    const sinceChangePct = round2((d.close / b.close - 1) * 100);
    const status: PriorSurgeStatus = d.isLimitUp
      ? "limitup"
      : d.changePct >= 2
        ? "surging"
        : sinceChangePct >= 0
          ? "holding"
          : "floor_broken";
    priorSurge.push({
      stockCode: agg.code,
      stockName: agg.name,
      industry: agg.industry,
      themes: agg.themes,
      surgeDate: b.tradeDate,
      surgeCount: agg.count,
      surgeVolumeRatio: b.volumeRatio,
      maxVolumeRatio: agg.maxRatio,
      surgeClose: b.close,
      surgeIsLimitUp: b.isLimitUp,
      surgeIsBroken: b.isBroken,
      position: b.position as PriorSurgeRow["position"],
      currentClose: d.close,
      currentChangePct: d.changePct,
      currentVolumeRatio: d.volumeRatio != null && d.volumeRatio > 0 ? d.volumeRatio : null,
      sinceChangePct,
      status,
    });
  }
  const STATUS_RANK: Record<PriorSurgeStatus, number> = { limitup: 0, surging: 1, holding: 2, floor_broken: 3 };
  priorSurge.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.sinceChangePct - a.sinceChangePct ||
      b.surgeVolumeRatio - a.surgeVolumeRatio
  );

  const toIdx = (close: number | null | undefined, pct: number | null | undefined) =>
    close ? { close, changePct: pct ?? 0 } : null;

  return {
    tradeDate,
    latestDate: opts.latestDisplay,
    prevDate,
    nextDate,
    today: opts.today,
    liveMode: false,
    sessionLabel: opts.sessionLabel,
    index: market.shIndex
      ? { name: "上证指数", close: market.shIndex, changePct: market.shChangePct ?? 0 }
      : null,
    indices: {
      sh: toIdx(market.shIndex, market.shChangePct),
      sz: toIdx(market.szIndex, market.szChangePct),
      cyb: toIdx(market.cyIndex, market.cyChangePct),
    },
    universe: "pools",
    universeLabel,
    universeSize: universeRows.length,
    resonance: resonanceAll.slice(0, DISPLAY_CAP),
    resonanceTotal: resonanceAll.length,
    counter: counterAll.slice(0, DISPLAY_CAP),
    counterTotal: counterAll.length,
    sectorEffect,
    leaders: leaders.slice(0, 40),
    priorSurge,
    priorSurgeWindow,
    priorSurgeExcluded,
    displayCap: DISPLAY_CAP,
    updatedAt,
  };
}

// ============================================================
// 盘中实时口径（今天收盘采集未落定）：实时快照 + 盘中采样
// 返回 null 表示实时数据不可用（盘前/节假日/快照失败），由入口回落收盘回放
// ============================================================

async function computeAnomalyLive(
  today: string,
  eodDates: string[],
  sessionLabel: string
): Promise<AnomalyData | null> {
  const updatedAt = new Date().toISOString();
  const latestEod = eodDates[eodDates.length - 1];

  // ---------- 实时行情（指数 + 全市场快照） ----------
  let idxQuotes: Map<string, AIndexQuote>;
  let snap: TxRankRow[];
  try {
    [idxQuotes, snap] = await Promise.all([fetchAIndexQuotes(), fetchAllStockSnapshot(200)]);
  } catch {
    return null;
  }
  const sh = idxQuotes.get("sh000001");
  const yyyymmdd = today.replace(/-/g, "");
  // 指数行情时间戳非今天（盘前/节假日自动识别）或快照异常 → 回落
  if (!sh || !sh.quoteTime.startsWith(yyyymmdd) || snap.length < 100) return null;
  const idxPct = sh.changePct;

  // ---------- 并行取库：昨收连板高度 / 盘中采样 / 封板事件 / 近5日爆量 ----------
  const [prevMarket, lastPoll, sealEvents, surgeWindowRows] = await Promise.all([
    db.dailyMarket.findFirst({
      where: { tradeDate: { lt: today } },
      orderBy: { tradeDate: "desc" },
      select: { tradeDate: true },
    }),
    db.intradaySnap.findFirst({
      where: { tradeDate: today },
      orderBy: { pollTs: "desc" },
      select: { pollTs: true },
    }),
    db.intradayEvent.findMany({
      where: { tradeDate: today, kind: "seal" },
      orderBy: { ts: "asc" },
      select: { stockCode: true, ts: true },
    }),
    eodDates.length > 0
      ? db.volumeSurge.findMany({
          where: { tradeDate: { in: eodDates.slice(-5) } },
          orderBy: [{ tradeDate: "asc" }, { volumeRatio: "desc" }],
        })
      : Promise.resolve([]),
  ]);

  const pollRows = lastPoll
    ? await db.intradaySnap.findMany({
        where: { tradeDate: today, pollTs: lastPoll.pollTs },
        select: { stockCode: true, isSealed: true, touchedLimit: true },
      })
    : [];
  const pollTouched = new Set(pollRows.filter((r) => r.touchedLimit).map((r) => r.stockCode));

  const firstSealTs = new Map<string, string>();
  for (const ev of sealEvents) if (!firstSealTs.has(ev.stockCode)) firstSealTs.set(ev.stockCode, ev.ts);

  const boardYesterday = new Map<string, number>();
  if (prevMarket) {
    const bh = await db.boardHistory.findMany({
      where: { tradeDate: prevMarket.tradeDate, boardCount: { gt: 0 } },
      select: { stockCode: true, boardCount: true },
    });
    for (const b of bh) boardYesterday.set(b.stockCode, b.boardCount);
  }

  const themeMaps = await loadThemeMaps(today);

  // ---------- 异动宇宙 = 全市场实时快照（封板/炸板/量比为盘中实时口径） ----------
  const universeRows: AnomalyStock[] = snap.map((s) => {
    const limitPct = limitPctOf(s.code, s.name);
    const sealed = limitStateOf(s.changePct, limitPct) === "sealed";
    const touched = pollTouched.has(s.code) || firstSealTs.has(s.code);
    const broken = !sealed && touched;
    const isLimitDown = s.changePct <= -(limitPct - LIMIT_TOL_PCT);
    const industry = themeMaps.industry.get(s.code) || null;
    const themes = [
      ...new Set([
        ...matchThemes(s.name, industry),
        ...(themeMaps.recentThemes.get(s.code) ?? []),
      ]),
    ];
    const pool: PoolSource = sealed
      ? "limitup"
      : broken
        ? "broken"
        : isLimitDown
          ? "limitdown"
          : s.volumeRatio >= 2
            ? "surge"
            : "scan";
    return {
      stockCode: s.code,
      stockName: s.name,
      industry,
      themes,
      price: s.price,
      changePct: s.changePct,
      rsPct: round2(s.changePct - idxPct),
      volumeRatio: s.volumeRatio > 0 ? s.volumeRatio : null,
      turnoverRate: s.turnoverRate > 0 ? s.turnoverRate : null,
      amount: s.amount > 0 ? s.amount : null,
      floatMarketCap: s.floatMarketCap > 0 ? s.floatMarketCap : null,
      isLimitUp: sealed,
      isBroken: broken,
      isLimitDown,
      boardCount: sealed ? (boardYesterday.get(s.code) ?? 0) + 1 : null,
      firstLimitTime: sealed ? (firstSealTs.get(s.code) ?? null) : null,
      position: null,
      fromPool: pool,
    };
  });

  // ---------- 1. 跟大盘共振 / 逆大盘拉升（大盘基准 = 上证实时涨跌幅） ----------
  const resonanceAll =
    idxPct > 0
      ? universeRows
          .filter((r) => r.changePct >= 2 && r.rsPct >= 2 && !r.isLimitDown)
          .sort((a, b) => b.rsPct - a.rsPct || b.changePct - a.changePct)
      : [];
  const counterAll =
    idxPct < 0
      ? universeRows
          .filter((r) => r.changePct > 0 && r.rsPct >= 1 && !r.isLimitDown)
          .sort((a, b) => b.changePct - a.changePct || b.rsPct - a.rsPct)
      : [];

  // ---------- 2. 板块效应（封板/炸板按题材标签 ∪ 行业聚合，盘中实时口径） ----------
  interface LiveGroup {
    kind: "theme" | "industry";
    members: AnomalyStock[];
  }
  const groups = new Map<string, LiveGroup>();
  for (const r of universeRows) {
    if (!r.isLimitUp && !r.isBroken) continue;
    const tags: { name: string; kind: "theme" | "industry" }[] = r.themes.map((t) => ({
      name: t,
      kind: "theme" as const,
    }));
    if (r.industry) tags.push({ name: r.industry, kind: "industry" });
    for (const t of tags) {
      const key = `${t.kind}:${t.name}`;
      const g = groups.get(key) ?? { kind: t.kind, members: [] };
      g.members.push(r);
      groups.set(key, g);
    }
  }
  const sectorEffect: SectorEffectRow[] = [];
  for (const [key, g] of groups) {
    const limitUpCount = g.members.filter((m) => m.isLimitUp).length;
    const brokenCount = g.members.length - limitUpCount;
    if (!(limitUpCount >= 2 || limitUpCount + brokenCount >= 3)) continue;
    const members = [...g.members].sort(
      (a, b) => (b.boardCount ?? 0) - (a.boardCount ?? 0) || b.changePct - a.changePct
    );
    const highestBoard = members.reduce((m, x) => Math.max(m, x.boardCount ?? 0), 0);
    const boardStockCount = members.filter((m) => (m.boardCount ?? 0) >= 2).length;
    const totalAmount = round2(
      members.filter((m) => m.isLimitUp).reduce((s, m) => s + (m.amount ?? 0), 0) / 1e8
    );
    // 龙头 = 封板成员中 板数最高 → 首封最早 → 成交额最大（与收盘口径同规则）
    const leader = members
      .filter((m) => m.isLimitUp)
      .sort(
        (a, b) =>
          (b.boardCount ?? 0) - (a.boardCount ?? 0) ||
          (a.firstLimitTime ?? "99:99").localeCompare(b.firstLimitTime ?? "99:99") ||
          (b.amount ?? 0) - (a.amount ?? 0)
      )[0];
    const strengthScore = limitUpCount * 10 + boardStockCount * 5 + highestBoard * 3 + brokenCount;
    sectorEffect.push({
      conceptName: key.slice(key.indexOf(":") + 1),
      kind: g.kind,
      limitUpCount,
      brokenCount,
      highestBoard,
      boardStockCount,
      totalAmount,
      strengthScore,
      leaderCode: leader?.stockCode ?? null,
      leaderName: leader?.stockName ?? null,
      members: members.slice(0, 24).map((m) => ({
        stockCode: m.stockCode,
        stockName: m.stockName,
        industry: m.industry,
        boardCount: m.boardCount ?? 0,
        changePct: m.changePct,
      })),
    });
  }
  sectorEffect.sort((a, b) => b.strengthScore - a.strengthScore || b.limitUpCount - a.limitUpCount);
  if (sectorEffect.length > 40) sectorEffect.length = 40;

  // ---------- 3. 领涨龙头（封板股：板数 = 昨日连板 + 1） ----------
  const leaders: LeaderRow[] = [];
  const seenLeader = new Set<string>();
  const sealedRows = universeRows.filter((r) => r.isLimitUp);
  const marketMaxBoard = sealedRows.reduce((m, r) => Math.max(m, r.boardCount ?? 0), 0);
  const toLeader = (
    r: AnomalyStock,
    scope: "market" | "theme",
    conceptName: string | null,
    themeLimitUpCount: number | null,
    themeStrength: number | null
  ): LeaderRow => ({
    scope,
    conceptName,
    stockCode: r.stockCode,
    stockName: r.stockName,
    boardCount: r.boardCount ?? 0,
    firstLimitTime: r.firstLimitTime,
    sealAmount: null, // 盘中实时口径无封单额（收盘口径提供）
    amount: r.amount,
    turnoverRate: r.turnoverRate,
    floatMarketCap: r.floatMarketCap,
    industry: r.industry,
    themes: r.themes,
    changePct: r.changePct,
    volumeRatio: r.volumeRatio,
    themeLimitUpCount,
    themeStrength,
  });
  if (marketMaxBoard > 0) {
    for (const r of sealedRows
      .filter((r) => r.boardCount === marketMaxBoard)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))) {
      if (seenLeader.has(r.stockCode)) continue;
      seenLeader.add(r.stockCode);
      leaders.push(toLeader(r, "market", null, null, null));
    }
  }
  for (const s of sectorEffect) {
    if (s.kind !== "theme" || !s.leaderCode || seenLeader.has(s.leaderCode)) continue;
    const r = universeRows.find((x) => x.stockCode === s.leaderCode);
    if (!r) continue;
    seenLeader.add(s.leaderCode);
    leaders.push(toLeader(r, "theme", s.conceptName, s.limitUpCount, s.strengthScore));
  }

  // ---------- 4. 前期爆量（近 5 个收盘日窗口 × 实时状态） ----------
  const priorSurgeWindow = eodDates.slice(-5);
  interface SurgeAgg {
    code: string;
    name: string;
    industry: string | null;
    themes: string[];
    baseline: (typeof surgeWindowRows)[number];
    count: number;
    maxRatio: number;
  }
  const surgeAgg = new Map<string, SurgeAgg>();
  for (const r of surgeWindowRows) {
    const prev = surgeAgg.get(r.stockCode);
    if (!prev) {
      surgeAgg.set(r.stockCode, {
        code: r.stockCode,
        name: r.stockName,
        industry: r.industry,
        themes: safeParseThemes(r.themes),
        baseline: r,
        count: 1,
        maxRatio: r.volumeRatio,
      });
    } else {
      prev.count += 1;
      prev.maxRatio = Math.max(prev.maxRatio, r.volumeRatio);
      prev.baseline = r;
      if (!prev.industry && r.industry) prev.industry = r.industry;
      if (prev.themes.length === 0 && r.themes) prev.themes = safeParseThemes(r.themes);
    }
  }
  const universeByCode = new Map(universeRows.map((r) => [r.stockCode, r]));
  const priorSurge: PriorSurgeRow[] = [];
  let priorSurgeExcluded = 0;
  for (const agg of surgeAgg.values()) {
    const u = universeByCode.get(agg.code);
    if (!u) {
      priorSurgeExcluded += 1; // 快照缺失（停牌等）
      continue;
    }
    const b = agg.baseline;
    const sinceChangePct = round2((u.price / b.close - 1) * 100);
    const status: PriorSurgeStatus = u.isLimitUp
      ? "limitup"
      : u.changePct >= 2
        ? "surging"
        : sinceChangePct >= 0
          ? "holding"
          : "floor_broken";
    priorSurge.push({
      stockCode: agg.code,
      stockName: agg.name,
      industry: agg.industry,
      themes: agg.themes,
      surgeDate: b.tradeDate,
      surgeCount: agg.count,
      surgeVolumeRatio: b.volumeRatio,
      maxVolumeRatio: agg.maxRatio,
      surgeClose: b.close,
      surgeIsLimitUp: b.isLimitUp,
      surgeIsBroken: b.isBroken,
      position: b.position as PriorSurgeRow["position"],
      currentClose: u.price,
      currentChangePct: u.changePct,
      currentVolumeRatio: u.volumeRatio,
      sinceChangePct,
      status,
    });
  }
  const STATUS_RANK: Record<PriorSurgeStatus, number> = { limitup: 0, surging: 1, holding: 2, floor_broken: 3 };
  priorSurge.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.sinceChangePct - a.sinceChangePct ||
      b.surgeVolumeRatio - a.surgeVolumeRatio
  );

  // ---------- 指数（实时） ----------
  const toLive = (code: string) => {
    const q = idxQuotes.get(code);
    return q ? { close: q.close, changePct: q.changePct } : null;
  };

  return {
    tradeDate: today,
    latestDate: today,
    prevDate: latestEod,
    nextDate: null,
    today,
    liveMode: true,
    sessionLabel,
    index: { name: "上证指数", close: sh.close, changePct: sh.changePct },
    indices: { sh: toLive("sh000001"), sz: toLive("sz399001"), cyb: toLive("sz399006") },
    universe: "snapshot",
    universeLabel: `全市场实时快照（${universeRows.length} 只 · 封板/炸板/量比为盘中实时口径）`,
    universeSize: universeRows.length,
    resonance: resonanceAll.slice(0, DISPLAY_CAP),
    resonanceTotal: resonanceAll.length,
    counter: counterAll.slice(0, DISPLAY_CAP),
    counterTotal: counterAll.length,
    sectorEffect,
    leaders: leaders.slice(0, 40),
    priorSurge,
    priorSurgeWindow,
    priorSurgeExcluded,
    displayCap: DISPLAY_CAP,
    updatedAt,
  };
}
