"use client";
// ============================================================
// 前端 API 客户端（对应方案 frontend/src/api/*.ts）
// 全部走本站 REST 接口，前端不直接接触数据库
// ============================================================

export interface IndexQuote {
  close: number;
  changePct: number;
}

export interface LadderStock {
  stockCode: string;
  stockName: string;
  boardCount: number;
  changePct: number;
  firstLimitTime: string | null;
  lastLimitTime: string | null;
  openCount: number;
  amount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  themes: string[]; // 主线题材标签（规则归组，可跨行业）
  daysAndBoards: string | null;
  isPromotion: boolean;
  isRebound: boolean;
  sealAmount: number | null;
  volumeRatio: number | null;
}

export interface ThemeMemberRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  boardCount: number;
}

export interface ConceptRow {
  conceptName: string;
  limitUpCount: number;
  boardCount: number;
  highestBoard: number;
  brokenCount: number;
  totalAmount: number | null;
  leaderCode: string | null;
  leaderName: string | null;
  strengthScore: number;
  heatScore: number | null;
  members?: ThemeMemberRow[]; // 仅主线条目：跨行业成分明细
  newsCount?: number; // 当日相关资讯数（快讯+成分股新闻，新闻热度信号）
  newsGoodCount?: number; // 其中研判为利好的条数
  news?: ThemeNewsHeadline[]; // 主线新闻流（最新 3 条）
}

/** 主线下挂的新闻头条（用户需求：新闻直接放主线下面，直观了解强度） */
export interface ThemeNewsHeadline {
  pubTime: string;
  title: string;
  impact: "good" | "bad" | "none";
  kind: "flash" | "stock";
  stockCode: string | null;
  stockName: string | null;
}

export interface VolumeSurgeRow {
  stockCode: string;
  stockName: string;
  close: number;
  changePct: number;
  volumeRatio: number;
  amount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  themes: string[];
  isLimitUp: boolean;
  isBroken: boolean;
  position: "low" | "mid" | "high";
  distFromHigh60: number | null;
  distFromLow60: number | null;
}

export interface PromotionLevel {
  level: string;
  fromBoard: number;
  total: number;
  promoted: number;
  rate: number;
}

export interface YesterdayPerfRow {
  stockCode: string;
  stockName: string;
  yesterdayBoardCount: number;
  todayChangePct: number | null;
  todayStatus: "promoted" | "break" | "broken" | "limitdown" | "suspended";
  todayBoardCount: number | null;
  industry: string | null;
  amount: number | null;
}

export interface ReviewBundle {
  tradeDate: string;
  latestDate: string;
  prevDate: string | null;
  nextDate: string | null;
  isLatest: boolean;
  market: {
    indices: {
      sh: IndexQuote | null; sz: IndexQuote | null; cyb: IndexQuote | null;
      kc50: IndexQuote | null; sz50: IndexQuote | null; bz50: IndexQuote | null;
    };
    totalAmount: number | null;
    upCount: number | null;
    downCount: number | null;
    flatCount: number | null;
    limitUpCount: number;
    limitDownCount: number;
    brokenCount: number;
    sealRate: number | null;
  };
  sentiment: {
    temperature: number;
    stage: string;
    limitUpCount: number;
    limitDownCount: number;
    brokenLimitCount: number;
    sealRate: number;
    brokenRate: number;
    highestBoard: number;
    yesterdayLimitAvg: number | null;
    yesterdayCount: number | null;
    yesterdayRedCount: number | null;
    promotions: PromotionLevel[];
  };
  history: {
    tradeDate: string;
    temperature: number;
    stage: string;
    limitUpCount: number;
    brokenLimitCount: number;
    highestBoard: number;
    sealRate: number;
  }[];
  boards: { boardCount: number; stocks: LadderStock[] }[];
  concepts: ConceptRow[]; // 主线题材（规则归组，跨行业）
  industries: ConceptRow[]; // 行业细分（东财 hybk）
  conceptHeat: { conceptName: string; series: { date: string; count: number }[] }[];
  compare: {
    limitUp: MetricComparison;
    lianban: MetricComparison;
    highestBoard: MetricComparison;
    limitDown: MetricComparison;
    broken: MetricComparison;
    sealRate: MetricComparison;
  };
  limitUp: LadderStock[];
  broken: LadderStock[];
  volumeSurge: VolumeSurgeRow[];
  syncClusters: SyncClusterRow[]; // 盘中同步启动聚类（题材佐证/候选新题材）
  yesterdayPerf: YesterdayPerfRow[];
  prevTemperature: number | null;
  prevStage: string | null;
  dataSource: string;
}

/** 盘中同步启动聚类行（首封时间相邻 ≤2 分钟、≥3 只归为同批） */
export interface SyncClusterRow {
  windowLabel: string; // 如 "14:23~14:24"
  startLabel: string;
  phase: "open" | "am" | "midday" | "pm";
  phaseLabel: string;
  kind: "batch" | "wave"; // batch=题材批次（有效信号）/ wave=启动潮（跨度>10分钟，低信号）
  spanMinutes: number; // 批次首尾跨度（分钟）
  stocks: {
    stockCode: string;
    stockName: string;
    boardCount: number;
    industry: string | null;
    themes: string[];
    firstLimitTime: string;
  }[];
  sharedThemes: string[]; // ≥2 只成员共享的主线题材（题材佐证）
  isCandidate: boolean; // 无共享主线 → 候选新题材（仅 batch 有意义）
}

export interface MetricComparison {
  today: number | null;
  yesterday: number | null;
  delta: number | null;
}

export interface StockDetail {
  basic: { stockCode: string; stockName: string; market: string; industry: string | null };
  quote: {
    price: number;
    changePct: number;
    amount: number;
    turnoverRate: number | null;
    floatMarketCap: number | null;
    prevClose: number | null;
  } | null;
  kline: {
    date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    changePct: number | null;
    isLimitUp: boolean;
    isBroken: boolean;
  }[];
  limitUpHistory: {
    tradeDate: string;
    boardCount: number;
    firstLimitTime: string | null;
    openCount: number;
    daysAndBoards: string | null;
  }[];
  boardHistory: {
    tradeDate: string;
    boardCount: number;
    previousBoardCount: number;
    isPromotion: boolean;
    isBreak: boolean;
    isRebound: boolean;
  }[];
  concepts: string[];
  /** 新闻归类证据：个股新闻命中主线关键词的明细（个股页展示归类依据） */
  themeEvidence: {
    tradeDate: string;
    theme: string;
    hits: string[];
    title: string;
    media: string;
    time: string;
  }[];
}


// ---------- 主线追踪资讯 / 隔夜美股 ----------

export interface NewsRow {
  extId: string;
  pubTime: string;
  title: string | null;
  content: string;
  impact: "good" | "bad" | "none";
  kind: "flash" | "stock"; // flash=7x24快讯 | stock=个股新闻（题材归类证据源）
  themes: string[];
  stocks: { market: string; symbol: string; key: string }[];
}

export interface UsIndexQuote {
  symbol: string;
  name: string;
  close: number;
  changePct: number;
  time: string;
}

export interface UsStockQuote {
  symbol: string;
  cname: string;
  theme: string;
  note?: string;
  close: number;
  changePct: number;
  time: string;
}

export interface UsThemeGroup {
  theme: string;
  stocks: UsStockQuote[];
  avgChangePct: number;
  direction: "strong" | "up" | "flat" | "down" | "weak";
  beneficiaries: { stockCode: string; stockName: string; boardCount: number; changePct: number; industry: string | null }[];
}

export interface UsMarketData {
  indices: UsIndexQuote[];
  groups: UsThemeGroup[];
  updateTime: string;
  tradeNote: string;
}

/** 爆量不跌：近 5 个交易日爆量且未跌破基准日收盘的个股 */
export interface VolumeHoldRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  surgeDate: string; // 基准日 = 窗口内最近一次爆量日
  surgeCount: number; // 窗口内爆量次数
  surgeVolumeRatio: number; // 基准日量比
  maxVolumeRatio: number; // 窗口内峰值量比
  surgeDayChangePct: number; // 基准日涨跌幅 %
  surgeIsLimitUp: boolean;
  surgeIsBroken: boolean;
  position: "low" | "mid" | "high";
  distFromHigh60: number | null;
  surgeClose: number;
  currentClose: number;
  sinceChangePct: number; // 距基准日涨幅 %（不跌判定核心）
  currentChangePct: number;
  currentVolumeRatio: number | null;
  currentTurnoverRate: number | null;
}

export interface VolumeHoldData {
  rows: VolumeHoldRow[];
  windowDates: string[];
  surgeStockCount: number; // 窗口内爆量股票总数（含被剔除的）
  excludedCount: number; // 爆量但已跌破基准日收盘（不入选）
  quoteSource: "snapshot" | "daily"; // 当前价来源
  updatedAt: string;
}

// ---------- 异动监控（大盘共振 / 逆势拉升 / 板块效应 / 领涨龙头 / 前期爆量） ----------

export type PoolSource = "limitup" | "broken" | "limitdown" | "surge" | "scan";

export interface AnomalyStock {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  price: number;
  changePct: number;
  rsPct: number; // 相对大盘强度 = 个股涨幅 - 上证涨幅（百分点）
  volumeRatio: number | null;
  turnoverRate: number | null;
  amount: number | null; // 元
  floatMarketCap: number | null; // 元
  isLimitUp: boolean;
  isBroken: boolean;
  isLimitDown: boolean;
  boardCount: number | null;
  firstLimitTime: string | null;
  position: "low" | "mid" | "high" | null;
  fromPool: PoolSource;
}

export interface SectorEffectMember {
  stockCode: string;
  stockName: string;
  industry: string | null;
  boardCount: number;
  changePct: number | null;
}

export interface SectorEffectRow {
  conceptName: string;
  kind: "theme" | "industry";
  limitUpCount: number;
  brokenCount: number;
  highestBoard: number;
  boardStockCount: number;
  totalAmount: number | null; // 亿元
  strengthScore: number;
  leaderCode: string | null;
  leaderName: string | null;
  members: SectorEffectMember[];
}

export interface LeaderRow {
  scope: "market" | "theme";
  conceptName: string | null;
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
  themeLimitUpCount: number | null;
  themeStrength: number | null;
}

export type PriorSurgeStatus = "limitup" | "surging" | "holding" | "floor_broken";

export interface PriorSurgeRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  surgeDate: string;
  surgeCount: number;
  surgeVolumeRatio: number;
  maxVolumeRatio: number;
  surgeClose: number;
  surgeIsLimitUp: boolean;
  surgeIsBroken: boolean;
  position: "low" | "mid" | "high";
  currentClose: number;
  currentChangePct: number;
  currentVolumeRatio: number | null;
  sinceChangePct: number;
  status: PriorSurgeStatus;
}

export interface AnomalyData {
  tradeDate: string;
  latestDate: string;
  prevDate: string | null;
  nextDate: string | null;
  today: string; // 北京时间今天（「最新一天」锚点）
  liveMode: boolean; // true = 今天收盘采集未落定，按盘中实时口径计算
  sessionLabel: string; // 盘中 · 上午时段 / 午间休市 / 已收盘 / 非交易日…
  index: { name: string; close: number; changePct: number } | null;
  indices: {
    sh: { close: number; changePct: number } | null;
    sz: { close: number; changePct: number } | null;
    cyb: { close: number; changePct: number } | null;
  };
  universe: "snapshot" | "pools";
  universeLabel: string;
  universeSize: number;
  resonance: AnomalyStock[];
  resonanceTotal: number;
  counter: AnomalyStock[];
  counterTotal: number;
  sectorEffect: SectorEffectRow[];
  leaders: LeaderRow[];
  priorSurge: PriorSurgeRow[];
  priorSurgeWindow: string[];
  priorSurgeExcluded: number;
  displayCap: number;
  updatedAt: string;
}

// ---------- 盘中实时异动（调度器每 2 分钟采样，API 30 秒缓存聚合） ----------

export type IntradayEventKind =
  | "surge_resonance"
  | "surge_counter"
  | "surge"
  | "dive"
  | "seal"
  | "unseal"
  | "volume";

export type IntradaySurgeType = "resonance" | "counter" | "independent";

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
  idxPct10m: number | null;
  rsPct10m: number | null;
  volumeRatio: number | null;
  turnoverRate: number | null;
  amount: number | null;
  floatMarketCap: number | null;
  isSealed: boolean;
  touchedLimit: boolean;
  kinds: IntradayEventKind[];
  lastEventTs: string | null;
}

export interface IntradaySurgeRow extends IntradayStockRow {
  windowPct: number;
  windowMinutes: number;
  surgeType: IntradaySurgeType;
  indexWindow: number | null;
}

export interface IntradaySectorRow {
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
  boardYesterday: number;
  boardNow: number;
  price: number;
  changePct: number;
  amount: number | null;
  turnoverRate: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  themes: string[];
  firstSealTs: string | null;
  unsealCount: number;
  volumeRatio: number | null;
}

export type IntradayPrevVolumeStatus = "limitup" | "surging" | "holding" | "floor_broken";

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
  status: IntradayPrevVolumeStatus;
}

export interface IntradayEventRow {
  ts: string;
  kind: IntradayEventKind;
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

export interface IntradayData {
  hasData: boolean;
  tradeDate: string;
  pollTs: string | null;
  pollCount: number;
  session: { phase: string; label: string; isTradingDay: boolean; inPollWindow: boolean; isTrading: boolean };
  indices: {
    sh: { close: number; changePct: number; pct10m: number | null } | null;
    sz: { close: number; changePct: number; pct10m: number | null } | null;
    cyb: { close: number; changePct: number; pct10m: number | null } | null;
  };
  indexWindow10m: number | null;
  universeSize: number;
  sealedCount: number;
  surges: IntradaySurgeRow[];
  surgeTotal: number;
  dives: IntradayStockRow[];
  sectors: IntradaySectorRow[];
  leaders: IntradayLeaderRow[];
  marketLeaders: IntradayLeaderRow[];
  prevVolume: IntradayPrevVolumeRow[];
  events: IntradayEventRow[];
  eventCount: number;
  updatedAt: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `请求失败 ${res.status}`);
  return json as T;
}

export const api = {
  reviewLatest: () => getJson<ReviewBundle>("/api/review/latest"),
  reviewByDate: (date: string) => getJson<ReviewBundle>(`/api/review/${date}`),
  calendar: () => getJson<{ dates: string[]; latest: string }>("/api/review/calendar"),
  stock: (code: string) => getJson<StockDetail>(`/api/stock/${code}`),
  search: (q: string) =>
    getJson<{ count: number; rows: { stockCode: string; stockName: string; market: string; industry: string | null }[] }>(
      `/api/stocks?q=${encodeURIComponent(q)}`
    ),
  news: (limit = 50) =>
    getJson<{ count: number; fetchedAt: string; sourceOnline: boolean; rows: NewsRow[] }>(
      `/api/news?limit=${limit}`
    ),
  usMarket: () => getJson<UsMarketData>("/api/us-market"),
  volumeHold: () => getJson<VolumeHoldData>("/api/volume-hold"),
  anomaly: (date?: string) =>
    getJson<AnomalyData>(`/api/anomaly${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  intraday: () => getJson<IntradayData>("/api/intraday"),
};
