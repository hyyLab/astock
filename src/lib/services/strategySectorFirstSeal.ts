// ============================================================
// 战法：题材首封（Sector First-Seal）
// 假设：同一题材当日第一只封板的个股，次日相对题材内跟风股享有溢价
// 数据：LimitUp（themes/industry + firstLimitTime）+ DailyStock（次日 OHLC）
// 统计纪律：
//   - 分析单元 = (tradeDate, sector)，同日同题材多股先合成再汇总，避免伪独立
//   - 比例类指标给 Wilson 95% 区间；n<20 不写结论（conclusionReady=false）
//   - firstLimitTime 为 null/空则跳过该股；题材内有效封板时间不足 2 只则跳过该题材日
// ============================================================

import { db as prisma } from "@/lib/db";

/** Wilson score interval for binomial proportion (default 95%). */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96
): { low: number; high: number } | null {
  if (n <= 0 || successes < 0 || successes > n) return null;
  const p = successes / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, (center - margin) / den),
    high: Math.min(1, (center + margin) / den),
  };
}

/** Normalize "H:MM" / "HH:MM" / "HH:MM:SS" → "HH:MM" for lexicographic compare; null if unusable. */
export function normalizeLimitTime(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Parse LimitUp.themes JSON array; fallback to industry as single sector tag. */
function sectorsOf(row: { themes: string | null; industry: string | null }): string[] {
  const out: string[] = [];
  if (row.themes) {
    try {
      const parsed = JSON.parse(row.themes) as unknown;
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          if (typeof x === "string" && x.trim()) out.push(x.trim());
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }
  if (out.length === 0 && row.industry && row.industry.trim()) {
    out.push(row.industry.trim());
  }
  return [...new Set(out)];
}

export interface GroupMetrics {
  /** 分析单元数 = (tradeDate, sector) 事件数（非个股数） */
  n: number;
  /** 次日高开率：事件内二元结果的比例（首封）或事件内跟风平均高开率再对事件取均值的说明见实现 */
  highOpenRate: number | null;
  highOpenWilson: { low: number; high: number } | null;
  /** 用于 Wilson 的成功次数（仅二元汇总时有意义） */
  highOpenSuccesses: number;
  /** 次日收盘溢价 %：相对前收（优先 DailyStock.changePct） */
  avgClosePremiumPct: number | null;
  /** 次日最大回撤 %：从开盘计 (low-open)/open*100，负数表示向下 */
  avgMaxDrawdownPct: number | null;
  /** n>=20 才允许写结论 */
  conclusionReady: boolean;
}

export interface SectorFirstSealBundle {
  asOf: string;
  dayCount: number;
  /** 参与统计的 (日, 题材) 事件数 */
  eventCount: number;
  /** 至少 2 只有效封板时间的题材日才入样 */
  firstSeal: GroupMetrics;
  followers: GroupMetrics;
  /** 首封相对跟风的收盘溢价差（百分点，首封均值 - 跟风均值） */
  closePremiumSpreadPct: number | null;
  note: string;
}

interface EventLeg {
  highOpen: boolean;
  closePremiumPct: number;
  maxDrawdownPct: number;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function buildGroupMetrics(fromBinaryHighOpen: boolean, legs: EventLeg[]): GroupMetrics {
  const n = legs.length;
  const conclusionReady = n >= 20;
  if (n === 0) {
    return {
      n: 0,
      highOpenRate: null,
      highOpenWilson: null,
      highOpenSuccesses: 0,
      avgClosePremiumPct: null,
      avgMaxDrawdownPct: null,
      conclusionReady: false,
    };
  }

  // 高开率：每个 (日,题材) 已是一条腿——首封为 0/1；跟风腿为该题材日跟风高开比例再二值化不合适，
  // 跟风用「事件级高开率」= 跟风股高开比例的均值，Wilson 则把事件内「高开跟风数/跟风数」池化会破坏设计。
  // 这里统一：对事件级 highOpen 二元（跟风：事件内跟风平均高开率 >= 0.5 记为 1）做 Wilson，
  // 同时 highOpenRate 报告事件级高开率的均值（跟风更平滑）。
  const eventHighOpenRates = legs.map((l) => (l.highOpen ? 1 : 0));
  const successes = eventHighOpenRates.reduce((a, b) => a + b, 0);
  const highOpenRate = mean(eventHighOpenRates);
  const highOpenWilson = wilsonInterval(successes, n);

  return {
    n,
    highOpenRate,
    highOpenWilson,
    highOpenSuccesses: successes,
    avgClosePremiumPct: mean(legs.map((l) => l.closePremiumPct)),
    avgMaxDrawdownPct: mean(legs.map((l) => l.maxDrawdownPct)),
    conclusionReady,
    // fromBinaryHighOpen reserved for future asymmetry; currently both paths use event-level binary
    ...(fromBinaryHighOpen ? {} : {}),
  };
}

/**
 * 题材首封回测：
 * 1) 按日解析涨停股所属题材（themes JSON，否则 industry）
 * 2) 同一 (日, 题材) 内按 normalize(firstLimitTime) 最早且非 null 者为「首封」
 * 3) 其余有效时间的涨停股为「跟风」；跟风在事件内先平均，再跨事件汇总
 * 4) 次日指标来自 DailyStock（open/high/low/close/prevClose/changePct）
 */
export async function getSectorFirstSealBundle(): Promise<SectorFirstSealBundle> {
  const [limitUps, dailyStocks] = await Promise.all([
    prisma.limitUp.findMany({
      orderBy: [{ tradeDate: "asc" }, { stockCode: "asc" }],
      select: {
        tradeDate: true,
        stockCode: true,
        firstLimitTime: true,
        themes: true,
        industry: true,
      },
    }),
    prisma.dailyStock.findMany({
      select: {
        tradeDate: true,
        stockCode: true,
        open: true,
        high: true,
        low: true,
        close: true,
        prevClose: true,
        changePct: true,
      },
    }),
  ]);

  const dates = [...new Set(limitUps.map((r) => r.tradeDate))].sort();
  const nextDate = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) {
    nextDate.set(dates[i], dates[i + 1]);
  }

  // DailyStock index: tradeDate|stockCode
  const dsKey = (d: string, c: string) => `${d}|${c}`;
  const dsMap = new Map<string, (typeof dailyStocks)[number]>();
  for (const r of dailyStocks) {
    dsMap.set(dsKey(r.tradeDate, r.stockCode), r);
  }

  // Group limit-ups by date then sector
  // date -> sector -> rows with normalized time
  type LuRow = (typeof limitUps)[number] & { t: string };
  const byDateSector = new Map<string, Map<string, LuRow[]>>();

  for (const row of limitUps) {
    const t = normalizeLimitTime(row.firstLimitTime);
    if (!t) continue;
    const sectors = sectorsOf(row);
    if (sectors.length === 0) continue;
    if (!byDateSector.has(row.tradeDate)) byDateSector.set(row.tradeDate, new Map());
    const secMap = byDateSector.get(row.tradeDate)!;
    for (const sec of sectors) {
      if (!secMap.has(sec)) secMap.set(sec, []);
      secMap.get(sec)!.push({ ...row, t });
    }
  }

  const firstLegs: EventLeg[] = [];
  const followLegs: EventLeg[] = [];

  const legFromDs = (ds: (typeof dailyStocks)[number]): EventLeg | null => {
    const prev =
      ds.prevClose != null && ds.prevClose > 0
        ? ds.prevClose
        : ds.open > 0
          ? ds.open / (1 + (ds.changePct ?? 0) / 100)
          : null;
    if (prev == null || prev <= 0 || ds.open == null || ds.open <= 0) return null;
    const highOpen = ds.open > prev;
    const closePremiumPct =
      ds.changePct != null && Number.isFinite(ds.changePct)
        ? ds.changePct
        : ((ds.close - prev) / prev) * 100;
    // 盘中最大回撤：相对开盘
    const maxDrawdownPct = ((ds.low - ds.open) / ds.open) * 100;
    if (!Number.isFinite(closePremiumPct) || !Number.isFinite(maxDrawdownPct)) return null;
    return { highOpen, closePremiumPct, maxDrawdownPct };
  };

  for (const [date, secMap] of byDateSector) {
    const nd = nextDate.get(date);
    if (!nd) continue;

    for (const [, rows] of secMap) {
      // 同一股可能因数据重复出现：按 stockCode 去重，保留最早时间
      const byCode = new Map<string, LuRow>();
      for (const r of rows) {
        const prev = byCode.get(r.stockCode);
        if (!prev || r.t < prev.t) byCode.set(r.stockCode, r);
      }
      const uniq = [...byCode.values()].sort((a, b) =>
        a.t < b.t ? -1 : a.t > b.t ? 1 : a.stockCode.localeCompare(b.stockCode)
      );
      if (uniq.length < 2) continue; // 需要首封 + 至少 1 跟风

      const first = uniq[0];
      const followers = uniq.slice(1);

      const firstDs = dsMap.get(dsKey(nd, first.stockCode));
      if (!firstDs) continue;
      const firstLeg = legFromDs(firstDs);
      if (!firstLeg) continue;

      const fLegs: EventLeg[] = [];
      for (const f of followers) {
        const ds = dsMap.get(dsKey(nd, f.stockCode));
        if (!ds) continue;
        const leg = legFromDs(ds);
        if (leg) fLegs.push(leg);
      }
      if (fLegs.length === 0) continue;

      // 跟风：事件内先平均，再作为一条事件腿（高开=平均高开率>=0.5）
      const followHighOpenRate = fLegs.filter((l) => l.highOpen).length / fLegs.length;
      const followLeg: EventLeg = {
        highOpen: followHighOpenRate >= 0.5,
        closePremiumPct: mean(fLegs.map((l) => l.closePremiumPct))!,
        maxDrawdownPct: mean(fLegs.map((l) => l.maxDrawdownPct))!,
      };

      firstLegs.push(firstLeg);
      followLegs.push(followLeg);
    }
  }

  const firstSeal = buildGroupMetrics(true, firstLegs);
  const followers = buildGroupMetrics(false, followLegs);

  const closePremiumSpreadPct =
    firstSeal.avgClosePremiumPct != null && followers.avgClosePremiumPct != null
      ? firstSeal.avgClosePremiumPct - followers.avgClosePremiumPct
      : null;

  const asOf = dates[dates.length - 1] ?? "";
  const note =
    firstSeal.n < 20
      ? `事件数 n=${firstSeal.n} < 20，样本不足，不写结论；仅供描述性参考。分析单元为 (交易日, 题材)，同题材跟风已事件内平均。`
      : `事件数 n=${firstSeal.n} ≥ 20。分析单元为 (交易日, 题材)；同日同题材跟风股已先平均再汇总，避免伪独立样本。`;

  return {
    asOf,
    dayCount: dates.length,
    eventCount: firstSeal.n,
    firstSeal,
    followers,
    closePremiumSpreadPct,
    note,
  };
}
