// ============================================================
// 隔夜美股 → A股主线题材映射服务
// 输入：腾讯美股行情（指数3只 + 题材映射股池约30只）
// 输出：指数 + 按主线分组的涨跌 + 每组 A股受益标的（当日涨停池内主线/行业匹配）
// ============================================================

import { db } from "@/lib/db";
import { cachedTtl } from "@/lib/cache";
import { fetchUsQuotes, US_INDICES, type UsQuote } from "@/lib/market/us";
import { THEME_RULES, usSymbolThemeMap } from "@/lib/calc/themeRules";

const US_TTL_MS = 60 * 1000; // 盘后行情变化慢，缓存 60s

export interface UsIndexQuote {
  symbol: string;
  name: string;
  close: number;
  changePct: number;
  time: string;
}

export interface UsStockQuote {
  symbol: string; // NVDA
  cname: string; // 英伟达（自维护中文名）
  theme: string;
  note?: string;
  close: number;
  changePct: number;
  time: string;
}

export interface UsThemeGroup {
  theme: string;
  stocks: UsStockQuote[];
  avgChangePct: number; // 组内平均涨跌幅
  direction: "strong" | "up" | "flat" | "down" | "weak"; // 传导强度
  beneficiaries: { stockCode: string; stockName: string; boardCount: number; changePct: number; industry: string | null }[];
}

export interface UsMarketData {
  indices: UsIndexQuote[];
  groups: UsThemeGroup[];
  updateTime: string;
  tradeNote: string; // 隔夜/收盘说明
}

/** 传导强度（透明规则）：≥2% strong / ≥0.5% up / >-0.5% flat / >-2% down / ≤-2% weak */
function directionOf(avg: number): UsThemeGroup["direction"] {
  if (avg >= 2) return "strong";
  if (avg >= 0.5) return "up";
  if (avg > -0.5) return "flat";
  if (avg > -2) return "down";
  return "weak";
}

export const DIRECTION_LABEL: Record<UsThemeGroup["direction"], string> = {
  strong: "隔夜强势",
  up: "隔夜偏强",
  flat: "隔夜平淡",
  down: "隔夜偏弱",
  weak: "隔夜大跌",
};

async function latestBeneficiaries(): Promise<Map<string, { stockCode: string; stockName: string; boardCount: number; changePct: number; industry: string | null }[]>> {
  const latest = await db.dailyMarket.findFirst({ orderBy: { tradeDate: "desc" }, select: { tradeDate: true } });
  const map = new Map<string, { stockCode: string; stockName: string; boardCount: number; changePct: number; industry: string | null }[]>();
  if (!latest) return map;
  const rows = await db.limitUp.findMany({ where: { tradeDate: latest.tradeDate }, orderBy: { boardCount: "desc" } });
  for (const r of rows) {
    let themes: string[] = [];
    if (r.themes) {
      try { themes = JSON.parse(r.themes) as string[]; } catch { themes = []; }
    }
    for (const t of themes) {
      if (!map.has(t)) map.set(t, []);
      const list = map.get(t)!;
      if (list.length < 8) {
        list.push({
          stockCode: r.stockCode,
          stockName: r.stockName,
          boardCount: r.boardCount,
          changePct: r.changePct,
          industry: r.industry,
        });
      }
    }
  }
  return map;
}

export async function getUsMarket(): Promise<UsMarketData> {
  return cachedTtl("us:market", US_TTL_MS, async () => {
    const symbolTheme = usSymbolThemeMap();
    const allSymbols = [...symbolTheme.keys()].map((s) => `us${s}`);

    const [quotes, beneficiaries] = await Promise.all([
      fetchUsQuotes([...US_INDICES.map((i) => i.symbol), ...allSymbols]),
      latestBeneficiaries(),
    ]);

    const indices: UsIndexQuote[] = US_INDICES.map((i) => {
      const q = quotes.get(i.symbol.replace(/^us/i, "").toUpperCase());
      return {
        symbol: i.symbol.replace("us", "").toUpperCase(),
        name: i.name,
        close: q?.close ?? 0,
        changePct: q?.changePct ?? 0,
        time: q?.time ?? "",
      };
    }).filter((i) => i.close > 0);

    // 按主线分组（与 themeRules 中 usSymbols 一一对应）
    const groups: UsThemeGroup[] = [];
    for (const rule of THEME_RULES) {
      if (!rule.usSymbols?.length) continue;
      const stocks: UsStockQuote[] = [];
      for (const us of rule.usSymbols) {
        const q = quotes.get(us.symbol.replace(/^us/i, "").toUpperCase());
        if (!q) continue;
        stocks.push({
          symbol: q.symbol,
          cname: us.name,
          theme: rule.name,
          note: us.note,
          close: q.close,
          changePct: q.changePct,
          time: q.time,
        });
      }
      if (stocks.length === 0) continue;
      const avg = stocks.reduce((s, x) => s + x.changePct, 0) / stocks.length;
      groups.push({
        theme: rule.name,
        stocks: stocks.sort((a, b) => b.changePct - a.changePct),
        avgChangePct: Math.round(avg * 100) / 100,
        direction: directionOf(avg),
        beneficiaries: beneficiaries.get(rule.name) ?? [],
      });
    }
    groups.sort((a, b) => b.avgChangePct - a.avgChangePct);

    // 美股时间戳判断隔夜场景（北京时间早间 = 美股刚收盘）
    const anyTime = indices[0]?.time ?? groups[0]?.stocks[0]?.time ?? "";
    const tradeNote = anyTime
      ? `美股行情时间 ${anyTime}（美东），对应北京时间次日 A 股开盘前`
      : "美股行情暂不可用";

    return { indices, groups, updateTime: new Date().toISOString(), tradeNote };
  });
}
