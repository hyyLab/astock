// ============================================================
// 封单相对强度（Seal Strength）回测
//
// 信号：T 日首板涨停股，封单强度 = 封单额 / 流通市值。
// 分层：每个交易日内部按强度排序，分为 Q1（弱）到 Q4（强）四档。
// 结果：T+1 高开率、收盘溢价、等权日收益净值最大回撤。
//
// 统计纪律：
// - 先按日分层，避免用全样本分位点引入未来信息，也控制每日市场环境。
// - n 是有完整 T+1 OHLC 的股票样本数；signalN 另计缺失次日行情的信号。
// - Wilson 区间以“该档当日高开比例是否 >= 50%”为日级二元结果，
//   以交易日为独立聚类单位；它不是个股高开率的 Wilson 区间。
// - n < 20 时 conclusion 为 null，不输出结论。
// ============================================================

import { db as prisma } from "@/lib/db";

export interface SealStrengthBucketStat {
  bucket: string;
  n: number;
  signalN: number;
  dayN: number;
  highOpenN: number;
  highOpenRate: number | null;
  /** 日级聚类 Wilson 区间：当日该档高开比例 >= 50% 记为成功日 */
  highOpenDayWilson: { successes: number; trials: number; low: number; high: number } | null;
  avgNextClosePremiumPct: number | null;
  /** 基于该档每日等权收盘溢价复利净值计算，百分数；回撤为 <= 0 */
  maxDrawdownPct: number | null;
  /** 次日最低价相对 T 日涨停收盘价的最差幅度，百分数 */
  worstNextLowPct: number | null;
  /** n < 20 时不输出结论 */
  conclusion: string | null;
}

export interface SealStrengthBacktest {
  asOf: string;
  dayCount: number;
  signalCount: number;
  validSampleCount: number;
  missingNextBarCount: number;
  strengthDefinition: string;
  bucketMethod: string;
  metricDefinition: string;
  statisticalNote: string;
  buckets: SealStrengthBucketStat[];
}

type Outcome = {
  tradeDate: string;
  stockCode: string;
  strength: number;
  highOpen: boolean;
  closePremiumPct: number;
  lowPct: number;
};

const BUCKETS = [
  { key: "Q1", label: "Q1 弱封单（当日最低 25%）" },
  { key: "Q2", label: "Q2 偏弱（25%-50%）" },
  { key: "Q3", label: "Q3 偏强（50%-75%）" },
  { key: "Q4", label: "Q4 强封单（当日最高 25%）" },
] as const;

function wilsonInterval(successes: number, trials: number) {
  if (trials <= 0) return null;
  const z = 1.959963984540054;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) /
    denominator;
  return {
    successes,
    trials,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function maxDrawdownPct(dailyReturns: number[]): number | null {
  if (!dailyReturns.length) return null;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const dailyReturn of dailyReturns) {
    equity *= 1 + dailyReturn / 100;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }
  return maxDrawdown * 100;
}

function summarizeBucket(bucket: (typeof BUCKETS)[number], signalN: number, rows: Outcome[]): SealStrengthBucketStat {
  const n = rows.length;
  const highOpenN = rows.filter((r) => r.highOpen).length;
  const byDay = new Map<string, Outcome[]>();
  for (const row of rows) {
    const dayRows = byDay.get(row.tradeDate) ?? [];
    dayRows.push(row);
    byDay.set(row.tradeDate, dayRows);
  }

  // 日级聚类：每个交易日只贡献一个二元观测，避免把同日股票当独立样本。
  const dayHighOpenRates = [...byDay.values()].map(
    (dayRows) => dayRows.filter((r) => r.highOpen).length / dayRows.length,
  );
  const successfulDays = dayHighOpenRates.filter((rate) => rate >= 0.5).length;
  const highOpenDayWilson = wilsonInterval(successfulDays, dayHighOpenRates.length);

  // 每个交易日先对该档股票等权，再构造日频净值，避免股票多的日期权重更大。
  const dailyCloseReturns = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, dayRows]) =>
      dayRows.reduce((sum, row) => sum + row.closePremiumPct, 0) / dayRows.length,
    );

  const avgNextClosePremiumPct = n
    ? rows.reduce((sum, row) => sum + row.closePremiumPct, 0) / n
    : null;
  const worstNextLowPct = n ? Math.min(...rows.map((r) => r.lowPct)) : null;

  return {
    bucket: bucket.label,
    n,
    signalN,
    dayN: byDay.size,
    highOpenN,
    highOpenRate: n ? highOpenN / n : null,
    highOpenDayWilson,
    avgNextClosePremiumPct,
    maxDrawdownPct: maxDrawdownPct(dailyCloseReturns),
    worstNextLowPct,
    conclusion:
      n < 20
        ? null
        : "达到 20 个有效个股样本门槛；该结果仍为描述性统计，不能单独证明策略显著有效。",
  };
}

export async function getSealStrengthBacktest(): Promise<SealStrengthBacktest> {
  const [calendar, limitUps, boardHistory, dailyStocks] = await Promise.all([
    prisma.dailyMarket.findMany({
      select: { tradeDate: true },
      orderBy: { tradeDate: "asc" },
    }),
    prisma.limitUp.findMany({
      select: {
        tradeDate: true,
        stockCode: true,
        closePrice: true,
        sealAmount: true,
        floatMarketCap: true,
        boardCount: true,
      },
      orderBy: [{ tradeDate: "asc" }, { stockCode: "asc" }],
    }),
    prisma.boardHistory.findMany({
      select: { tradeDate: true, stockCode: true, boardCount: true },
      orderBy: { tradeDate: "asc" },
    }),
    prisma.dailyStock.findMany({
      select: {
        tradeDate: true,
        stockCode: true,
        open: true,
        high: true,
        low: true,
        close: true,
      },
      orderBy: [{ tradeDate: "asc" }, { stockCode: "asc" }],
    }),
  ]);

  const dates = calendar.map((row) => row.tradeDate);
  const nextDateByDate = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) {
    nextDateByDate.set(dates[i], dates[i + 1]);
  }

  const boardByKey = new Map(
    boardHistory.map((row) => [`${row.tradeDate}|${row.stockCode}`, row]),
  );
  const dailyStockByKey = new Map(
    dailyStocks.map((row) => [`${row.tradeDate}|${row.stockCode}`, row]),
  );
  const limitUpsByDate = new Map<string, typeof limitUps>();
  for (const row of limitUps) {
    const dayRows = limitUpsByDate.get(row.tradeDate) ?? [];
    dayRows.push(row);
    limitUpsByDate.set(row.tradeDate, dayRows);
  }

  const outcomesByBucket = new Map<string, Outcome[]>(
    BUCKETS.map((bucket) => [bucket.key, []]),
  );
  const signalCounts = new Map<string, number>(BUCKETS.map((bucket) => [bucket.key, 0]));
  let signalCount = 0;
  let missingNextBarCount = 0;

  for (const tradeDate of dates) {
    const nextDate = nextDateByDate.get(tradeDate);
    if (!nextDate) continue; // 最后一个交易日没有可观察的 T+1 结果。

    const candidates = (limitUpsByDate.get(tradeDate) ?? [])
      .filter((row) => {
        const board = boardByKey.get(`${tradeDate}|${row.stockCode}`);
        return (
          row.boardCount === 1 &&
          board?.boardCount === 1 &&
          row.sealAmount !== null &&
          row.sealAmount !== undefined &&
          Number.isFinite(row.sealAmount) &&
          row.sealAmount > 0 &&
          row.floatMarketCap !== null &&
          row.floatMarketCap !== undefined &&
          Number.isFinite(row.floatMarketCap) &&
          row.floatMarketCap > 0 &&
          Number.isFinite(row.closePrice) &&
          row.closePrice > 0
        );
      })
      .map((row) => ({
        row,
        strength: (row.sealAmount as number) / (row.floatMarketCap as number),
      }))
      .sort((a, b) => a.strength - b.strength || a.row.stockCode.localeCompare(b.row.stockCode));

    // 每日横截面分四档，阈值只使用当日可见的首板样本。
    candidates.forEach((candidate, index) => {
      const bucketIndex = Math.min(
        BUCKETS.length - 1,
        Math.floor((index * BUCKETS.length) / candidates.length),
      );
      const bucket = BUCKETS[bucketIndex];
      signalCount++;
      signalCounts.set(bucket.key, (signalCounts.get(bucket.key) ?? 0) + 1);

      const next = dailyStockByKey.get(`${nextDate}|${candidate.row.stockCode}`);
      if (
        !next ||
        !Number.isFinite(next.open) ||
        !Number.isFinite(next.high) ||
        !Number.isFinite(next.low) ||
        !Number.isFinite(next.close) ||
        next.open <= 0 ||
        next.high <= 0 ||
        next.low <= 0 ||
        next.close <= 0
      ) {
        missingNextBarCount++;
        return;
      }

      const base = candidate.row.closePrice;
      const outcome: Outcome = {
        tradeDate,
        stockCode: candidate.row.stockCode,
        strength: candidate.strength,
        highOpen: next.open > base,
        closePremiumPct: (next.close / base - 1) * 100,
        lowPct: (next.low / base - 1) * 100,
      };
      outcomesByBucket.get(bucket.key)!.push(outcome);
    });
  }

  const buckets = BUCKETS.map((bucket) =>
    summarizeBucket(
      bucket,
      signalCounts.get(bucket.key) ?? 0,
      outcomesByBucket.get(bucket.key) ?? [],
    ),
  );


    dayCount: dates.length,
    signalCount,
    validSampleCount: buckets.reduce((sum, bucket) => sum + bucket.n, 0),
    missingNextBarCount,
    strengthDefinition: "封单强度 = T 日封单金额 sealAmount（元）/ T 日流通市值 floatMarketCap（元）；仅保留两者均为正且非空的首板。",
    bucketMethod: "每个交易日内对有效首板按封单强度升序排序，等频分为 Q1-Q4；Q4 为当日最强四分之一。不是全历史固定阈值。",
    metricDefinition: "次日高开 = T+1 open > T 日涨停 closePrice；收盘溢价 = (T+1 close / T 日 closePrice - 1) × 100%；最大回撤基于各档每日等权收盘溢价复利净值。未计手续费、滑点、涨停买不到等执行约束。",
    statisticalNote: "个股 n 仅作样本量展示。同日股票相关，不以个股作为独立观测计算 Wilson 区间；区间按交易日聚类，每日该档高开比例 >= 50% 记为成功日，Wilson 区间的 trials 为交易日数。该日级区间衡量的是“多数股票高开日占比”，不是个股高开率区间。n < 20 不输出结论。",
  };
}
