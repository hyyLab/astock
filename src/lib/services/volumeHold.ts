// ============================================================
// 爆量不跌 服务：近 5 个交易日爆量（量比≥2）且股价未跌的个股筛选
//
// 口径（透明，与爆量榜/涨停池同一量能体系）：
// - 爆量：自有 20 日口径量比 ≥ 2（当日成交量 ÷ 前 20 日均量），来自每日采集入库的
//   爆量榜（VolumeSurge，历史按交易日保留）
// - 窗口：最近 5 个有行情数据的交易日（含最新）
// - 基准日：该股窗口内最近一次爆量日
// - 不跌：当前收盘价 ≥ 基准日收盘价（0 容差；跌破即剔除）
// - 当前价来源：腾讯全市场快照（优先）；快照不可用时回退库内 DailyStock 最新收盘，
//   并在返回值 quoteSource 中标注（前端口径说明展示）
// ============================================================

import { db } from "@/lib/db";
import { cachedTtl } from "@/lib/cache";
import { fetchAllStockSnapshot } from "@/lib/market/tx";

export interface VolumeHoldRow {
  stockCode: string;
  stockName: string;
  industry: string | null;
  themes: string[];
  surgeDate: string; // 基准日 = 窗口内最近一次爆量日
  surgeCount: number; // 窗口内爆量次数（多次爆量为资金反复介入信号）
  surgeVolumeRatio: number; // 基准日量比
  maxVolumeRatio: number; // 窗口内峰值量比
  surgeDayChangePct: number; // 基准日涨跌幅 %
  surgeIsLimitUp: boolean; // 基准日涨停
  surgeIsBroken: boolean; // 基准日炸板
  position: "low" | "mid" | "high"; // 基准日位置（60 日高低点口径）
  distFromHigh60: number | null;
  surgeClose: number; // 基准日收盘
  currentClose: number; // 当前收盘
  sinceChangePct: number; // 距基准日涨幅 %（不跌判定核心）
  currentChangePct: number; // 当前交易日涨跌幅 %
  currentVolumeRatio: number | null; // 腾讯口径量比（仅参考）
  currentTurnoverRate: number | null;
}

export interface VolumeHoldData {
  rows: VolumeHoldRow[];
  windowDates: string[]; // 参与统计的交易日（升序）
  surgeStockCount: number; // 窗口内爆量股票总数（去重，含已跌被剔除的）
  excludedCount: number; // 爆量但已跌破基准日收盘（不入选）
  quoteSource: "snapshot" | "daily"; // 当前价来源
  updatedAt: string;
}

const TTL_MS = 5 * 60 * 1000;

function safeParseThemes(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getVolumeHold(): Promise<VolumeHoldData> {
  return cachedTtl("volume-hold:latest", TTL_MS, computeVolumeHold);
}

async function computeVolumeHold(): Promise<VolumeHoldData> {
  const updatedAt = new Date().toISOString();

  // 1. 最近 5 个有行情数据的交易日
  const marketDays = await db.dailyMarket.findMany({
    orderBy: { tradeDate: "desc" },
    take: 5,
    select: { tradeDate: true },
  });
  const windowDates = marketDays.map((r) => r.tradeDate).reverse();
  if (windowDates.length === 0) {
    return { rows: [], windowDates: [], surgeStockCount: 0, excludedCount: 0, quoteSource: "daily", updatedAt };
  }

  // 2. 窗口内全部爆量记录 → 按股票聚合（基准日 = 最近一次爆量日）
  const surgeRows = await db.volumeSurge.findMany({
    where: { tradeDate: { in: windowDates } },
    orderBy: [{ tradeDate: "asc" }, { volumeRatio: "desc" }],
  });

  interface Agg {
    code: string;
    name: string;
    industry: string | null;
    themes: string[];
    baseline: (typeof surgeRows)[number];
    count: number;
    maxRatio: number;
  }
  const aggByCode = new Map<string, Agg>();
  for (const r of surgeRows) {
    const prev = aggByCode.get(r.stockCode);
    if (!prev) {
      aggByCode.set(r.stockCode, {
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
      prev.baseline = r; // 覆盖为更晚的爆量日
      if (!prev.industry && r.industry) prev.industry = r.industry;
      if (prev.themes.length === 0 && r.themes) prev.themes = safeParseThemes(r.themes);
    }
  }
  if (aggByCode.size === 0) {
    return { rows: [], windowDates, surgeStockCount: 0, excludedCount: 0, quoteSource: "daily", updatedAt };
  }
  const codes = [...aggByCode.keys()];

  // 3. 当前价：优先腾讯全市场快照；失败回退库内 DailyStock 最新收盘
  let quoteSource: "snapshot" | "daily" = "snapshot";
  interface Quote {
    close: number;
    changePct: number;
    volumeRatio: number | null;
    turnoverRate: number | null;
  }
  const priceByCode = new Map<string, Quote>();
  try {
    const snap = await fetchAllStockSnapshot(200);
    if (snap.length === 0) throw new Error("快照为空");
    for (const r of snap) {
      priceByCode.set(r.code, {
        close: r.price,
        changePct: r.changePct,
        volumeRatio: r.volumeRatio > 0 ? r.volumeRatio : null,
        turnoverRate: r.turnoverRate > 0 ? r.turnoverRate : null,
      });
    }
  } catch {
    quoteSource = "daily";
    priceByCode.clear();
  }
  if (quoteSource === "daily") {
    const daily = await db.dailyStock.findMany({
      where: { stockCode: { in: codes } },
      orderBy: [{ stockCode: "asc" }, { tradeDate: "asc" }],
      select: { stockCode: true, tradeDate: true, close: true, changePct: true, volumeRatio: true, turnoverRate: true },
    });
    for (const r of daily) {
      // 升序遍历，最后一次赋值即该股最新交易日
      priceByCode.set(r.stockCode, {
        close: r.close,
        changePct: r.changePct,
        volumeRatio: r.volumeRatio != null && r.volumeRatio > 0 ? r.volumeRatio : null,
        turnoverRate: r.turnoverRate != null && r.turnoverRate > 0 ? r.turnoverRate : null,
      });
    }
  }

  // 4. 逐股判定「不跌」并输出
  const rows: VolumeHoldRow[] = [];
  let excludedCount = 0;
  for (const agg of aggByCode.values()) {
    const q = priceByCode.get(agg.code);
    if (!q || q.close <= 0) continue;
    const b = agg.baseline;
    const sinceChangePct = round2((q.close / b.close - 1) * 100);
    if (q.close < b.close) {
      excludedCount += 1; // 已跌破基准日收盘 → 剔除
      continue;
    }
    rows.push({
      stockCode: agg.code,
      stockName: agg.name,
      industry: agg.industry,
      themes: agg.themes,
      surgeDate: b.tradeDate,
      surgeCount: agg.count,
      surgeVolumeRatio: b.volumeRatio,
      maxVolumeRatio: agg.maxRatio,
      surgeDayChangePct: b.changePct,
      surgeIsLimitUp: b.isLimitUp,
      surgeIsBroken: b.isBroken,
      position: b.position as VolumeHoldRow["position"],
      distFromHigh60: b.distFromHigh60,
      surgeClose: b.close,
      currentClose: q.close,
      sinceChangePct,
      currentChangePct: q.changePct,
      currentVolumeRatio: q.volumeRatio,
      currentTurnoverRate: q.turnoverRate,
    });
  }

  // 默认排序：距基准日涨幅降序，其次基准日量比降序
  rows.sort((a, b2) => b2.sinceChangePct - a.sinceChangePct || b2.surgeVolumeRatio - a.surgeVolumeRatio);

  return {
    rows,
    windowDates,
    surgeStockCount: aggByCode.size,
    excludedCount,
    quoteSource,
    updatedAt,
  };
}
