// ============================================================
// 题材聚类与龙头规则（方案第十二、十三步）
// 题材双层体系：
//   行业细分层 = 数据源返回的行业板块（动态获取，不人工硬编码）
//   主线题材层 = themeRules 规则归组（跨行业归纳，如 福建概念）
// 龙头规则：最高连板 > 首封时间最早 > 成交额最大（可追溯，支持后续人工修正）
// ============================================================

import { matchThemes, normalizeStockName } from "./themeRules";

export interface ConceptInputStock {
  stockCode: string;
  stockName: string;
  industry: string;
  boardCount: number;
  firstLimitTime: string | null;
  amount: number | null;
  /** 预计算的主线归属（规则归组+新闻证据合并）；为空时回退 matchThemes 现算 */
  themes?: string[];
}

export interface ConceptInputBroken {
  industry: string;
}

export interface ConceptStat {
  conceptName: string;
  limitUpCount: number; // 涨停数量
  boardCount: number; // 连板股票数（≥2板）
  highestBoard: number; // 最高板
  brokenCount: number; // 炸板数量
  totalAmount: number; // 涨停股成交额合计（亿元）
  leaderCode: string | null;
  leaderName: string | null;
  strengthScore: number; // 强度分 0-100
  heatScore: number; // 热度分 0-100
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function buildConceptStats(
  limitUps: ConceptInputStock[],
  broken: ConceptInputBroken[]
): ConceptStat[] {
  const groups = new Map<
    string,
    { stocks: ConceptInputStock[]; brokenCount: number }
  >();

  for (const s of limitUps) {
    const key = s.industry || "其他";
    if (!groups.has(key)) groups.set(key, { stocks: [], brokenCount: 0 });
    groups.get(key)!.stocks.push(s);
  }
  for (const b of broken) {
    const key = b.industry || "其他";
    if (!groups.has(key)) groups.set(key, { stocks: [], brokenCount: 0 });
    groups.get(key)!.brokenCount += 1;
  }

  const stats: ConceptStat[] = [];
  for (const [name, g] of groups) {
    if (g.stocks.length === 0) continue; // 只有炸板没有涨停的题材不计入排行

    const highestBoard = Math.max(...g.stocks.map((s) => s.boardCount));
    const boardCount = g.stocks.filter((s) => s.boardCount >= 2).length;
    const totalAmount = g.stocks.reduce((s, x) => s + (x.amount ?? 0), 0) / 1e8;

    // 龙头：最高板 → 首封时间最早 → 成交额最大
    const leader = [...g.stocks].sort((a, b) => {
      if (b.boardCount !== a.boardCount) return b.boardCount - a.boardCount;
      const ta = a.firstLimitTime ?? "99:99:99";
      const tb = b.firstLimitTime ?? "99:99:99";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (b.amount ?? 0) - (a.amount ?? 0);
    })[0];

    const lu = g.stocks.length;
    const sealQuality = lu + g.brokenCount > 0 ? lu / (lu + g.brokenCount) : 1;

    // 强度分：涨停家数40 + 最高板30 + 连板梯队20 + 封板质量10
    const strengthScore =
      100 *
      (0.4 * clamp01(lu / 8) +
        0.3 * clamp01(highestBoard / 6) +
        0.2 * clamp01(boardCount / 4) +
        0.1 * clamp01(sealQuality));

    // 热度分：题材内涨停股总成交额（50亿封顶）
    const heatScore = 100 * clamp01(totalAmount / 50);

    stats.push({
      conceptName: name,
      limitUpCount: lu,
      boardCount,
      highestBoard,
      brokenCount: g.brokenCount,
      totalAmount: Math.round(totalAmount * 100) / 100,
      leaderCode: leader.stockCode,
      leaderName: leader.stockName,
      strengthScore: Math.round(strengthScore * 10) / 10,
      heatScore: Math.round(heatScore * 10) / 10,
    });
  }

  // 排序：强度分 desc → 最高板 desc → 涨停家数 desc
  return stats.sort((a, b) => {
    if (b.strengthScore !== a.strengthScore) return b.strengthScore - a.strengthScore;
    if (b.highestBoard !== a.highestBoard) return b.highestBoard - a.highestBoard;
    return b.limitUpCount - a.limitUpCount;
  });
}

// ============================================================
// 主线题材统计（themeRules 规则归组，跨行业；一只股票可入多个主线）
// 输出与 ConceptStat 同构，另带 members 成分明细（展示跨行业构成）
// ============================================================

export interface ThemeMember {
  stockCode: string;
  stockName: string;
  industry: string | null;
  boardCount: number;
}

export interface ThemeStat extends ConceptStat {
  members: ThemeMember[]; // 按连板数降序
}

export function buildThemeStats(limitUps: ConceptInputStock[]): ThemeStat[] {
  const groups = new Map<string, { stocks: ConceptInputStock[] }>();

  for (const s of limitUps) {
    const themes = s.themes && s.themes.length > 0 ? s.themes : matchThemes(s.stockName, s.industry);
    for (const t of themes) {
      if (!groups.has(t)) groups.set(t, { stocks: [] });
      groups.get(t)!.stocks.push(s);
    }
  }

  const stats: ThemeStat[] = [];
  for (const [name, g] of groups) {
    if (g.stocks.length === 0) continue;

    const highestBoard = Math.max(...g.stocks.map((s) => s.boardCount));
    const boardCount = g.stocks.filter((s) => s.boardCount >= 2).length;
    const totalAmount = g.stocks.reduce((s, x) => s + (x.amount ?? 0), 0) / 1e8;

    // 龙头：与行业层同一规则（最高板 → 首封最早 → 成交额）
    const leader = [...g.stocks].sort((a, b) => {
      if (b.boardCount !== a.boardCount) return b.boardCount - a.boardCount;
      const ta = a.firstLimitTime ?? "99:99:99";
      const tb = b.firstLimitTime ?? "99:99:99";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (b.amount ?? 0) - (a.amount ?? 0);
    })[0];

    const lu = g.stocks.length;
    // 强度分：主线层不做炸板扣减（炸板归属存在歧义），侧重家数/高度/梯队
    const strengthScore =
      100 *
      (0.4 * clamp01(lu / 10) +
        0.3 * clamp01(highestBoard / 6) +
        0.2 * clamp01(boardCount / 5) +
        0.1 * clamp01(totalAmount / 60));

    // 热度分：题材内涨停股总成交额（60亿封顶）
    const heatScore = 100 * clamp01(totalAmount / 60);

    stats.push({
      conceptName: name,
      limitUpCount: lu,
      boardCount,
      highestBoard,
      brokenCount: 0,
      totalAmount: Math.round(totalAmount * 100) / 100,
      leaderCode: leader.stockCode,
      leaderName: normalizeStockName(leader.stockName),
      strengthScore: Math.round(strengthScore * 10) / 10,
      heatScore: Math.round(heatScore * 10) / 10,
      members: [...g.stocks]
        .sort((a, b) => b.boardCount - a.boardCount)
        .map((s) => ({
          stockCode: s.stockCode,
          stockName: normalizeStockName(s.stockName),
          industry: s.industry || null,
          boardCount: s.boardCount,
        })),
    });
  }

  return stats.sort((a, b) => {
    if (b.strengthScore !== a.strengthScore) return b.strengthScore - a.strengthScore;
    if (b.highestBoard !== a.highestBoard) return b.highestBoard - a.highestBoard;
    return b.limitUpCount - a.limitUpCount;
  });
}
