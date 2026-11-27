// ============================================================
// 复盘聚合服务：把某交易日的 市场概览/情绪/连板天梯/题材/涨停池/
// 昨日涨停表现 组装为完整 Bundle（对应方案 review_service.py）
// ============================================================

import { db } from "@/lib/db";
import { cached } from "@/lib/cache";
import { EmptyDataError } from "@/lib/services/errors";
import type { PromotionLevel } from "@/lib/calc/board";
import { buildSyncClusters, type SyncCluster } from "@/lib/calc/syncLaunch";

export type { SyncCluster } from "@/lib/calc/syncLaunch";
export { PHASE_LABEL } from "@/lib/calc/syncLaunch";

export interface IndexQuote {
  close: number;
  changePct: number;
}

export interface ReviewMarket {
  indices: {
    sh: IndexQuote | null; sz: IndexQuote | null; cyb: IndexQuote | null;
    kc50: IndexQuote | null; sz50: IndexQuote | null; bz50: IndexQuote | null;
  };
  totalAmount: number | null; // 亿元
  upCount: number | null;
  downCount: number | null;
  flatCount: number | null;
  limitUpCount: number;
  limitDownCount: number;
  brokenCount: number;
  sealRate: number | null;
}

export interface LadderStock {
  stockCode: string;
  stockName: string;
  boardCount: number;
  changePct: number;
  firstLimitTime: string | null;
  lastLimitTime: string | null;
  openCount: number;
  amount: number | null; // 元
  turnoverRate: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  themes: string[]; // 主线题材标签（规则归组，可跨行业）
  daysAndBoards: string | null;
  isPromotion: boolean;
  isRebound: boolean;
  sealAmount: number | null;
  volumeRatio: number | null; // 量比 = 当日成交量 / 前20日均量
}

export interface ThemeMemberRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  boardCount: number;
}

/** 主线下挂的新闻头条（快讯+成分股个股新闻，最多 3 条） */
export interface ThemeNewsHeadline {
  pubTime: string;
  title: string;
  impact: "good" | "bad" | "none";
  kind: "flash" | "stock";
  stockCode: string | null; // 个股新闻所属股票
  stockName: string | null;
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

/** 核心指标今日 vs 昨日对比（方案第二十三条） */
export interface MetricComparison {
  today: number | null;
  yesterday: number | null;
  delta: number | null; // today - yesterday（封板率为百分点差）
}

export interface ReviewCompare {
  limitUp: MetricComparison;
  lianban: MetricComparison; // 连板家数（≥2板）
  highestBoard: MetricComparison;
  limitDown: MetricComparison;
  broken: MetricComparison;
  sealRate: MetricComparison; // 0-1
}

/** 题材近10日热度序列（热力图数据源） */
export interface ConceptHeatRow {
  conceptName: string;
  series: { date: string; count: number }[]; // 与 history 同序，缺失日=0
}

export const VOLUME_SURGE_RATIO = 2; // 爆量阈值：量比≥2

/** 爆量榜行（含非涨停标的；position=low/mid/high 按距60日高点回撤划分） */
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
  distFromHigh60: number | null; // 距60日最高点回撤 %
  distFromLow60: number | null; // 距60日最低点涨幅 %
}

export interface YesterdayPerfRow {
  stockCode: string;
  stockName: string;
  yesterdayBoardCount: number;
  todayChangePct: number | null;
  todayStatus: "promoted" | "break" | "broken" | "limitdown" | "suspended";
  todayBoardCount: number | null;
  industry: string | null;
  amount: number | null; // 今日成交额（元）
}

export interface ReviewBundle {
  tradeDate: string;
  latestDate: string;
  prevDate: string | null;
  nextDate: string | null;
  isLatest: boolean;
  market: ReviewMarket;
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
  conceptHeat: ConceptHeatRow[]; // 近10日主线题材热度（热力图）
  compare: ReviewCompare; // 核心指标今日/昨日对比
  limitUp: LadderStock[];
  broken: LadderStock[];
  volumeSurge: VolumeSurgeRow[]; // 爆量榜（含非涨停，量比≥2，按量比降序）
  syncClusters: SyncCluster[]; // 盘中同步启动聚类（题材佐证/候选新题材，不落库即席计算）
  yesterdayPerf: YesterdayPerfRow[];
  prevTemperature: number | null; // 昨日情绪温度（情绪周期模块对比用）
  prevStage: string | null;
  dataSource: string;
}

function pctClose(bars: { close: number; date: string }[], date: string): IndexQuote | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 0) return null;
  const prev = bars[idx - 1];
  const close = bars[idx].close;
  return {
    close,
    changePct: prev ? Math.round(((close / prev.close - 1) * 100) * 100) / 100 : 0,
  };
}

function toLadderStock(r: {
  stockCode: string; stockName: string; boardCount: number; changePct: number;
  firstLimitTime: string | null; lastLimitTime: string | null; openCount: number;
  amount: number | null; turnoverRate: number | null; floatMarketCap: number | null;
  industry: string | null; daysAndBoards: string | null; isPromotion: boolean;
  isRebound: boolean; sealAmount: number | null; volumeRatio?: number | null;
  themes?: string | null;
}): LadderStock {
  let themes: string[] = [];
  if (r.themes) {
    try { themes = JSON.parse(r.themes) as string[]; } catch { themes = []; }
  }
  return { ...r, volumeRatio: r.volumeRatio ?? null, themes };
}

function toConceptRow(c: {
  conceptName: string; limitUpCount: number; boardCount: number; highestBoard: number;
  brokenCount: number; totalAmount: number | null; leaderCode: string | null;
  leaderName: string | null; strengthScore: number; heatScore: number | null;
  members?: string | null;
}): ConceptRow {
  let members: ThemeMemberRow[] | undefined;
  if (c.members) {
    try { members = JSON.parse(c.members) as ThemeMemberRow[]; } catch { members = undefined; }
  }
  return { ...c, members };
}

function cmp(today: number | null, yesterday: number | null): MetricComparison {
  const delta = today != null && yesterday != null ? Math.round((today - yesterday) * 100) / 100 : null;
  return { today, yesterday, delta };
}

/**
 * 主线新闻流聚合：当日窗口内（[tradeDate, nextDate)）的快讯+个股新闻
 * 按 NewsItem.themes 归到主线，输出 计数/利好数/最新头条（供主线卡片直接挂新闻）。
 * pubTime 与 tradeDate 均为 YYYY-MM-DD 起始的字符串，直接字典序比较。
 */
async function aggregateThemeNews(tradeDate: string, nextDate: string | null) {
  const rows = await db.newsItem.findMany({
    where: { pubTime: { gte: tradeDate, ...(nextDate ? { lt: nextDate } : {}) } },
    orderBy: { pubTime: "desc" },
    take: 300,
  });
  const agg = new Map<
    string,
    { count: number; good: number; headlines: ThemeNewsHeadline[] }
  >();
  const touch = (t: string) => {
    if (!agg.has(t)) agg.set(t, { count: 0, good: 0, headlines: [] });
    return agg.get(t)!;
  };
  for (const r of rows) {
    let themes: string[] = [];
    try {
      themes = r.themes ? (JSON.parse(r.themes) as string[]) : [];
    } catch {
      themes = [];
    }
    if (themes.length === 0) continue;
    let stockName: string | null = null;
    let stockCode: string | null = null;
    if (r.kind === "stock") {
      try {
        const st = r.stocks ? (JSON.parse(r.stocks) as { market: string; symbol: string; key: string }[]) : [];
        const first = st[0];
        if (first) {
          stockName = first.key;
          stockCode = first.symbol.replace(/^(sh|sz|bj)/i, "");
        }
      } catch {
        stockName = null;
      }
    }
    const title = (r.content.match(/^【(.+?)】/)?.[1] ?? r.content.split("；")[0]).slice(0, 60);
    for (const t of themes) {
      const a = touch(t);
      a.count++;
      if (r.impact === "good") a.good++;
      if (a.headlines.length < 3) {
        a.headlines.push({
          pubTime: r.pubTime,
          title,
          impact: r.impact as ThemeNewsHeadline["impact"],
          kind: r.kind as ThemeNewsHeadline["kind"],
          stockCode,
          stockName,
        });
      }
    }
  }
  return agg;
}

export async function getReviewBundle(dateInput?: string): Promise<ReviewBundle> {
  return cached(`review:full:${dateInput ?? "latest"}`, async () => {
    const markets = await db.dailyMarket.findMany({ orderBy: { tradeDate: "asc" } });
    if (markets.length === 0) throw new EmptyDataError("数据库为空，请先执行采集（bun scripts/collect-daily.ts）");

    const dates = markets.map((m) => m.tradeDate);
    const latestDate = dates[dates.length - 1];
    const tradeDate = dateInput && dates.includes(dateInput) ? dateInput : latestDate;
    const idx = dates.indexOf(tradeDate);
    const prevDate = idx > 0 ? dates[idx - 1] : null;
    const nextDate = idx < dates.length - 1 ? dates[idx + 1] : null;
    const market = markets[idx];

    const [sentiment, limitUps, brokens, conceptRowsAll, history, prevLimitUps, surgeRows] = await Promise.all([
      db.sentimentDaily.findUnique({ where: { tradeDate } }),
      db.limitUp.findMany({ where: { tradeDate } }),
      db.brokenLimit.findMany({ where: { tradeDate } }),
      db.dailyConcept.findMany({
        where: { tradeDate },
        orderBy: [{ strengthScore: "desc" }, { highestBoard: "desc" }],
      }),
      db.sentimentDaily.findMany({
        orderBy: { tradeDate: "asc" },
        select: {
          tradeDate: true, sentimentTemperature: true, sentimentStage: true,
          limitUpCount: true, brokenLimitCount: true, highestBoard: true, sealRate: true,
        },
      }),
      prevDate ? db.limitUp.findMany({ where: { tradeDate: prevDate } }) : Promise.resolve([]),
      db.volumeSurge.findMany({ where: { tradeDate }, orderBy: { volumeRatio: "desc" } }),
    ]);

    if (!sentiment) throw new EmptyDataError(`交易日 ${tradeDate} 数据不完整`);

    // 主线新闻流：快讯+成分股个股新闻 → 主线计数/利好数/头条（用户需求：新闻直接挂主线，直观了解强度）
    const themeNews = await aggregateThemeNews(tradeDate, nextDate);

    // 双层题材：theme=主线题材（规则归组，跨行业） / industry=行业细分（东财 hybk）
    const themeRows = conceptRowsAll.filter((c) => c.kind === "theme");
    const industryRows = conceptRowsAll.filter((c) => c.kind !== "theme");

    // 昨日核心指标（对比模块）：来自 prevDate 的市场汇总 / 情绪行 / 涨停明细
    const prevMarket = prevDate ? markets.find((m) => m.tradeDate === prevDate) ?? null : null;
    const prevSentiment = prevDate ? await db.sentimentDaily.findUnique({ where: { tradeDate: prevDate } }) : null;
    const prevLianban = prevLimitUps.filter((r) => r.boardCount >= 2).length;
    const compare: ReviewCompare = {
      limitUp: cmp(market.limitUpCount, prevMarket?.limitUpCount ?? null),
      lianban: cmp(limitUps.filter((r) => r.boardCount >= 2).length, prevDate ? prevLianban : null),
      highestBoard: cmp(sentiment.highestBoard, prevSentiment?.highestBoard ?? null),
      limitDown: cmp(market.limitDownCount, prevMarket?.limitDownCount ?? null),
      broken: cmp(market.brokenCount, prevMarket?.brokenCount ?? null),
      sealRate: cmp(market.sealRate, prevMarket?.sealRate ?? null),
    };

    // 主线题材近10日热度（热力图）：取今日强度前8主线 × 最近10个交易日涨停数
    const last10Dates = dates.slice(Math.max(0, idx - 9), idx + 1);
    const topConceptNames = themeRows.slice(0, 8).map((c) => c.conceptName);
    const heatRows = topConceptNames.length
      ? await db.dailyConcept.findMany({
          where: { conceptName: { in: topConceptNames }, tradeDate: { in: last10Dates }, kind: "theme" },
        })
      : [];
    const conceptHeat: ConceptHeatRow[] = topConceptNames.map((name) => ({
      conceptName: name,
      series: last10Dates.map((d) => ({
        date: d,
        count: heatRows.find((h) => h.conceptName === name && h.tradeDate === d)?.limitUpCount ?? 0,
      })),
    }));

    // 连板天梯分组
    const ladderStocks = limitUps.map(toLadderStock).sort((a, b) => {
      if (b.boardCount !== a.boardCount) return b.boardCount - a.boardCount;
      const ta = a.firstLimitTime ?? "99:99:99";
      const tb = b.firstLimitTime ?? "99:99:99";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (b.amount ?? 0) - (a.amount ?? 0);
    });
    const boardGroups: { boardCount: number; stocks: LadderStock[] }[] = [];
    for (const s of ladderStocks) {
      const g = boardGroups.find((x) => x.boardCount === s.boardCount);
      if (g) g.stocks.push(s);
      else boardGroups.push({ boardCount: s.boardCount, stocks: [s] });
    }

    // 昨日涨停表现：roster(prev) 在 today 的状态
    const todayLuMap = new Map(limitUps.map((r) => [r.stockCode, r]));
    const todayBrokenSet = new Set(brokens.map((r) => r.stockCode));
    const todayDowns = await db.limitDown.findMany({ where: { tradeDate } });
    const todayDownSet = new Set(todayDowns.map((r) => r.stockCode));
    const todayStockRows = await db.dailyStock.findMany({ where: { tradeDate } });
    const todayPctMap = new Map(todayStockRows.map((r) => [r.stockCode, r.changePct]));
    const todayAmountMap = new Map(todayStockRows.map((r) => [r.stockCode, r.amount]));

    const yesterdayPerf: YesterdayPerfRow[] = prevLimitUps
      .map((r) => {
        let status: YesterdayPerfRow["todayStatus"];
        let todayBoardCount: number | null = null;
        if (todayLuMap.has(r.stockCode)) {
          status = "promoted";
          todayBoardCount = todayLuMap.get(r.stockCode)!.boardCount;
        } else if (todayBrokenSet.has(r.stockCode)) status = "broken";
        else if (todayDownSet.has(r.stockCode)) status = "limitdown";
        else if (!todayPctMap.has(r.stockCode)) status = "suspended";
        else status = "break";
        return {
          stockCode: r.stockCode,
          stockName: r.stockName,
          yesterdayBoardCount: r.boardCount,
          todayChangePct: todayPctMap.has(r.stockCode) ? todayPctMap.get(r.stockCode)! : null,
          todayStatus: status,
          todayBoardCount,
          industry: r.industry,
          amount: todayAmountMap.get(r.stockCode) ?? null,
        };
      })
      .sort((a, b) => (b.todayChangePct ?? -99) - (a.todayChangePct ?? -99));

    return {
      tradeDate,
      latestDate,
      prevDate,
      nextDate,
      isLatest: tradeDate === latestDate,
      market: {
        indices: {
          sh: market.shIndex ? { close: market.shIndex, changePct: market.shChangePct ?? 0 } : null,
          sz: market.szIndex ? { close: market.szIndex, changePct: market.szChangePct ?? 0 } : null,
          cyb: market.cyIndex ? { close: market.cyIndex, changePct: market.cyChangePct ?? 0 } : null,
          kc50: market.kcIndex ? { close: market.kcIndex, changePct: market.kcChangePct ?? 0 } : null,
          sz50: market.sz50Index ? { close: market.sz50Index, changePct: market.sz50ChangePct ?? 0 } : null,
          bz50: market.bz50Index ? { close: market.bz50Index, changePct: market.bz50ChangePct ?? 0 } : null,
        },
        totalAmount: market.totalAmount,
        upCount: market.upCount,
        downCount: market.downCount,
        flatCount: market.flatCount,
        limitUpCount: market.limitUpCount,
        limitDownCount: market.limitDownCount,
        brokenCount: market.brokenCount,
        sealRate: market.sealRate,
      },
      sentiment: {
        temperature: sentiment.sentimentTemperature,
        stage: sentiment.sentimentStage,
        limitUpCount: sentiment.limitUpCount,
        limitDownCount: sentiment.limitDownCount,
        brokenLimitCount: sentiment.brokenLimitCount,
        sealRate: sentiment.sealRate,
        brokenRate: sentiment.brokenRate,
        highestBoard: sentiment.highestBoard,
        yesterdayLimitAvg: sentiment.yesterdayLimitAvg,
        yesterdayCount: sentiment.yesterdayCount,
        yesterdayRedCount: sentiment.yesterdayRedCount,
        promotions: sentiment.promotionDetails ? JSON.parse(sentiment.promotionDetails) : [],
      },
      history: history.map((h) => ({
        tradeDate: h.tradeDate,
        temperature: h.sentimentTemperature,
        stage: h.sentimentStage,
        limitUpCount: h.limitUpCount,
        brokenLimitCount: h.brokenLimitCount,
        highestBoard: h.highestBoard,
        sealRate: h.sealRate,
      })),
      boards: boardGroups,
      concepts: themeRows.map(toConceptRow).map((c) => ({
        ...c,
        newsCount: themeNews.get(c.conceptName)?.count ?? 0,
        newsGoodCount: themeNews.get(c.conceptName)?.good ?? 0,
        news: themeNews.get(c.conceptName)?.headlines ?? [],
      })),
      industries: industryRows.map(toConceptRow),
      conceptHeat,
      compare,
      limitUp: ladderStocks,
      broken: brokens.map((r) =>
        toLadderStock({ ...r, boardCount: 0, isPromotion: false, isRebound: false, lastLimitTime: null, daysAndBoards: null, sealAmount: null })
      ),
      syncClusters: buildSyncClusters(limitUps.map((r) => ({
        stockCode: r.stockCode,
        stockName: r.stockName,
        boardCount: r.boardCount,
        industry: r.industry,
        themes: r.themes,
        firstLimitTime: r.firstLimitTime,
      }))),
      volumeSurge: surgeRows.map((r) => {
        let themes: string[] = [];
        if (r.themes) {
          try { themes = JSON.parse(r.themes) as string[]; } catch { themes = []; }
        }
        return {
          stockCode: r.stockCode,
          stockName: r.stockName,
          close: r.close,
          changePct: r.changePct,
          volumeRatio: r.volumeRatio,
          amount: r.amount,
          turnoverRate: r.turnoverRate,
          floatMarketCap: r.floatMarketCap,
          industry: r.industry,
          themes,
          isLimitUp: r.isLimitUp,
          isBroken: r.isBroken,
          position: r.position as VolumeSurgeRow["position"],
          distFromHigh60: r.distFromHigh60,
          distFromLow60: r.distFromLow60,
        };
      }),
      yesterdayPerf,
      prevTemperature: prevSentiment?.sentimentTemperature ?? null,
      prevStage: prevSentiment?.sentimentStage ?? null,
      dataSource: market.dataSource,
    };
  });
}

/** 有数据的交易日列表（日历） */
export async function getCalendar(): Promise<{ dates: string[]; latest: string }> {
  return cached("review:calendar", async () => {
    const rows = await db.dailyMarket.findMany({
      orderBy: { tradeDate: "asc" },
      select: { tradeDate: true },
    });
    return { dates: rows.map((r) => r.tradeDate), latest: rows[rows.length - 1]?.tradeDate ?? "" };
  });
}
