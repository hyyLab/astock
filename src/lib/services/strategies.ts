// ============================================================
// 战法验证：用库内历史数据回测游资战法，胜率说话
// 数据口径：LimitUp（涨停池）+ BoardHistory（连板状态）+ SentimentDaily（情绪）
// ============================================================

import { db as prisma } from "@/lib/db";

export interface PromotionStat {
  level: string; // "1进2" "2进3" 或合并后的高板档
  total: number;
  n: number;
  promoted: number;
  rate: number;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}

export interface FirstBoardTimeStat {
  bucket: string; // "10:30前" "10:30-14:30" "14:30后"
  total: number;
  n: number;
  promoted: number;
  rate: number;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}

export interface ReboundStat {
  total: number;
  n: number;
  nextLimitUp: number;
  rate: number;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}

export interface SentimentTempStat {
  bucket: string; // "低温<40" "中温40-60" "高温>60"
  days: number;
  n: number;
  positiveDays: number;
  positiveDayRate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  avgNextLimitAvg: number | null; // 次日"昨日涨停今日均涨"平均值
}

export interface StrategyBundle {
  asOf: string; // 数据截止日
  dayCount: number;
  sampleCount: number; // 涨停记录总数
  promotion: PromotionStat[]; // 连板晋级率（强者恒强）
  firstBoardTime: FirstBoardTimeStat[]; // 首板封板时间分层
  rebound: ReboundStat; // 反包战法
  sentimentTemp: SentimentTempStat[]; // 情绪温度分层打板收益
  yesterdayPerf: { tradeDate: string; avgPct: number; redCount: number | null; totalCount: number | null }[];
}

function wilsonInterval(successes: number, trials: number): { lower: number; upper: number } | null {
  if (trials <= 0) return null;
  const z = 1.96;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) /
    denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export async function getStrategyBundle(): Promise<StrategyBundle> {
  const [bh, lu, sd] = await Promise.all([
    prisma.boardHistory.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.limitUp.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" } }),
  ]);

  const dates = [...new Set(bh.map((r) => r.tradeDate))].sort();
  const byDate = new Map<string, typeof bh>();
  bh.forEach((r) => {
    if (!byDate.has(r.tradeDate)) byDate.set(r.tradeDate, []);
    byDate.get(r.tradeDate)!.push(r);
  });
  const luByDate = new Map<string, typeof lu>();
  lu.forEach((r) => {
    if (!luByDate.has(r.tradeDate)) luByDate.set(r.tradeDate, []);
    luByDate.get(r.tradeDate)!.push(r);
  });

  // 1) 连板晋级率：今天 N 板 -> 明天 N+1 板
  const promoMap = new Map<number, { total: number; promoted: number }>();
  for (let i = 0; i < dates.length - 1; i++) {
    const today = byDate.get(dates[i])!;
    const tMap = new Map(byDate.get(dates[i + 1])!.map((r) => [r.stockCode, r]));
    today.forEach((r) => {
      if (r.boardCount < 1) return;
      const stat = promoMap.get(r.boardCount) ?? { total: 0, promoted: 0 };
      stat.total++;
      const t = tMap.get(r.stockCode);
      if (t && t.boardCount === r.boardCount + 1) stat.promoted++;
      promoMap.set(r.boardCount, stat);
    });
  }
  const sortedPromo = [...promoMap.entries()].sort((a, b) => a[0] - b[0]);
  const promotion: PromotionStat[] = [];
  const addPromotionStat = (
    level: string,
    total: number,
    promoted: number,
  ) => {
    const ci = wilsonInterval(promoted, total);
    promotion.push({
      level,
      total,
      n: total,
      promoted,
      rate: total ? promoted / total : 0,
      wilsonLower: ci?.lower ?? null,
      wilsonUpper: ci?.upper ?? null,
    });
  };

  // 低位档正常展示；4板及以上若单档样本不足20，则将这些稀疏高位档合并。
  // 样本充足的高位档仍单独展示，避免不必要地损失分层信息。
  const sparseHigh = sortedPromo.filter(([board, stat]) => board >= 4 && stat.total < 20);
  const sparseHighSet = new Set(sparseHigh.map(([board]) => board));

  for (const [board, stat] of sortedPromo) {
    if (sparseHighSet.has(board)) continue;
    addPromotionStat(`${board}进${board + 1}`, stat.total, stat.promoted);
  }

  if (sparseHigh.length > 0) {
    const merged = sparseHigh.reduce(
      (sum, [, stat]) => ({
        total: sum.total + stat.total,
        promoted: sum.promoted + stat.promoted,
      }),
      { total: 0, promoted: 0 },
    );
    addPromotionStat("高位低样本合并", merged.total, merged.promoted);
  }

  // 2) 首板封板时间分层 -> 次日晋级率
  const buckets: { key: string; label: string; total: number; promoted: number }[] = [
    { key: "early", label: "10:30前", total: 0, promoted: 0 },
    { key: "mid", label: "10:30-14:30", total: 0, promoted: 0 },
    { key: "late", label: "14:30后", total: 0, promoted: 0 },
  ];
  for (let i = 0; i < dates.length - 1; i++) {
    const today = luByDate.get(dates[i]) ?? [];
    const tMap = new Map(byDate.get(dates[i + 1])!.map((r) => [r.stockCode, r]));
    today.forEach((r) => {
      if (r.boardCount !== 1) return;
      const time = (r.firstLimitTime ?? "").slice(0, 5);
      if (!time) return;
      const b = time <= "10:30" ? buckets[0] : time <= "14:30" ? buckets[1] : buckets[2];
      b.total++;
      const t = tMap.get(r.stockCode);
      if (t && t.boardCount === 2) b.promoted++;
    });
  }
  const firstBoardTime: FirstBoardTimeStat[] = buckets.map((b) => {
    const ci = wilsonInterval(b.promoted, b.total);
    return {
      bucket: b.label,
      total: b.total,
      n: b.total,
      promoted: b.promoted,
      rate: b.total ? b.promoted / b.total : 0,
      wilsonLower: ci?.lower ?? null,
      wilsonUpper: ci?.upper ?? null,
    };
  });

  // 3) 反包战法：断板后再涨停的股票，次日再涨停概率
  let rbTotal = 0;
  let rbWin = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const today = luByDate.get(dates[i]) ?? [];
    const nextLu = new Set((luByDate.get(dates[i + 1]) ?? []).map((r) => r.stockCode));
    today.forEach((r) => {
      if (!r.isRebound) return;
      rbTotal++;
      if (nextLu.has(r.stockCode)) rbWin++;
    });
  }
  const reboundCI = wilsonInterval(rbWin, rbTotal);
  const rebound: ReboundStat = {
    total: rbTotal,
    n: rbTotal,
    nextLimitUp: rbWin,
    rate: rbTotal ? rbWin / rbTotal : 0,
    wilsonLower: reboundCI?.lower ?? null,
    wilsonUpper: reboundCI?.upper ?? null,
  };

  // 4) 情绪温度分层 -> 次日打板收益（昨日涨停今日均涨）
  const tempGroups: { label: string; vals: number[] }[] = [
    { label: "低温<40", vals: [] },
    { label: "中温40-60", vals: [] },
    { label: "高温>60", vals: [] },
  ];
  for (let i = 0; i < sd.length - 1; i++) {
    const t = sd[i].sentimentTemperature;
    const nextAvg = sd[i + 1].yesterdayLimitAvg;
    // 空温度或非有限值不归入任何温度档，避免 null 被当作高温。
    if (t === null || t === undefined || !Number.isFinite(t)) continue;
    if (nextAvg === null || nextAvg === undefined || !Number.isFinite(nextAvg)) continue;
    if (t < 40) tempGroups[0].vals.push(nextAvg);
    else if (t < 60) tempGroups[1].vals.push(nextAvg);
    else tempGroups[2].vals.push(nextAvg);
  }
  const sentimentTemp: SentimentTempStat[] = tempGroups.map((g) => {
    const positiveDays = g.vals.filter((value) => value > 0).length;
    const ci = wilsonInterval(positiveDays, g.vals.length);
    return {
      bucket: g.label,
      days: g.vals.length,
      n: g.vals.length,
      positiveDays,
      positiveDayRate: g.vals.length ? positiveDays / g.vals.length : null,
      wilsonLower: ci?.lower ?? null,
      wilsonUpper: ci?.upper ?? null,
      avgNextLimitAvg: g.vals.length
        ? g.vals.reduce((s, x) => s + x, 0) / g.vals.length
        : null,
    };
  });

  // 5) 昨日涨停今日表现序列
  const yesterdayPerf = sd
    .filter((d) => d.yesterdayLimitAvg !== null)
    .map((d) => ({
      tradeDate: d.tradeDate,
      avgPct: d.yesterdayLimitAvg as number,
      redCount: d.yesterdayRedCount,
      totalCount: d.yesterdayCount,
    }));

  const latest = dates[dates.length - 1] ?? "";
  return {
    asOf: latest,
    dayCount: dates.length,
    sampleCount: lu.length,
    promotion,
    firstBoardTime,
    rebound,
    sentimentTemp,
    yesterdayPerf,
  };
}
