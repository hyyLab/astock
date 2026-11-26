// ============================================================
// 个股详情服务（对应方案 stock_service.py）
// 自有数据优先，非池内股票通过腾讯行情代理实时补充
// ============================================================

import { db } from "@/lib/db";
import { cached } from "@/lib/cache";
import { fetchJson } from "@/lib/market/http";
import { KLINE_BASES } from "@/lib/market/tx";
import { txCode } from "@/lib/market/rules";

export interface StockQuote {
  price: number;
  changePct: number;
  amount: number; // 元
  turnoverRate: number | null;
  floatMarketCap: number | null; // 元
  prevClose: number | null;
}

export interface StockKlineBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  changePct: number | null;
  isLimitUp: boolean;
  isBroken: boolean;
}

export interface StockDetail {
  basic: {
    stockCode: string;
    stockName: string;
    market: string;
    industry: string | null;
  };
  quote: StockQuote | null;
  kline: StockKlineBar[];
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
  /** 新闻归类证据：个股新闻命中主线关键词的明细（可解释、可追溯） */
  themeEvidence: {
    tradeDate: string;
    theme: string;
    hits: string[];
    title: string;
    media: string;
    time: string;
  }[];
}

/** 从腾讯K线响应 qt 块解析实时报价（数值字段为 ASCII，不受 GBK 影响） */
function parseQt(qtArr: string[]): StockQuote | null {
  if (!qtArr || qtArr.length < 46) return null;
  const n = (i: number) => {
    const v = Number(qtArr[i]);
    return Number.isFinite(v) ? v : null;
  };
  const price = n(3);
  if (!price) return null;
  return {
    price,
    changePct: n(32) ?? 0,
    amount: (n(37) ?? 0) * 1e4,
    turnoverRate: n(38),
    floatMarketCap: (n(44) ?? 0) * 1e8,
    prevClose: n(4),
  };
}

export async function getStockDetail(code: string): Promise<StockDetail> {
  return cached(`stock:detail:${code}`, async () => {
    const basic = await db.stockBasic.findUnique({ where: { stockCode: code } });
    if (!basic) throw new Error(`未找到股票 ${code}`);

    const [limitUpHistory, boardHistory, conceptLinks, dbBars, limitDates, brokenDates, latestThemesRow, evidenceRows] =
      await Promise.all([
        db.limitUp.findMany({ where: { stockCode: code }, orderBy: { tradeDate: "desc" }, take: 60 }),
        db.boardHistory.findMany({ where: { stockCode: code }, orderBy: { tradeDate: "desc" }, take: 60 }),
        db.stockConcept.findMany({ where: { stockCode: code }, include: { concept: true } }),
        db.dailyStock.findMany({ where: { stockCode: code }, orderBy: { tradeDate: "asc" } }),
        db.limitUp.findMany({ where: { stockCode: code }, select: { tradeDate: true } }),
        db.brokenLimit.findMany({ where: { stockCode: code }, select: { tradeDate: true } }),
        db.limitUp.findFirst({ where: { stockCode: code }, orderBy: { tradeDate: "desc" }, select: { themes: true } }),
        db.limitUp.findMany({
          where: { stockCode: code, themeEvidence: { not: null } },
          orderBy: { tradeDate: "desc" },
          take: 8,
          select: { tradeDate: true, themeEvidence: true },
        }),
      ]);

    // 主线题材（最近一次涨停行的规则归组+新闻证据归属）优先，行业细分概念殿后
    let latestThemes: string[] = [];
    try {
      latestThemes = latestThemesRow?.themes ? (JSON.parse(latestThemesRow.themes) as string[]) : [];
    } catch {
      latestThemes = [];
    }
    const concepts = [...new Set([...latestThemes, ...conceptLinks.map((l) => l.concept.conceptName)])];

    // 新闻归类证据展开（新→旧）
    const themeEvidence: StockDetail["themeEvidence"] = [];
    for (const row of evidenceRows) {
      try {
        const list = row.themeEvidence
          ? (JSON.parse(row.themeEvidence) as { theme: string; hits: string[]; title: string; media: string; time: string }[])
          : [];
        for (const e of list) themeEvidence.push({ tradeDate: row.tradeDate, ...e });
      } catch {
        // 忽略损坏的证据行
      }
    }
    themeEvidence.sort((a, b) => b.time.localeCompare(a.time));
    const luSet = new Set(limitDates.map((r) => r.tradeDate));
    const brSet = new Set(brokenDates.map((r) => r.tradeDate));

    // K线：自有数据优先；数据不足或非池内股票走腾讯代理（120根前复权）
    let kline: StockKlineBar[] = [];
    let quote: StockQuote | null = null;
    if (dbBars.length >= 40) {
      kline = dbBars.map((b, i) => ({
        date: b.tradeDate,
        open: b.open,
        close: b.close,
        high: b.high,
        low: b.low,
        volume: b.volume,
        changePct: b.changePct,
        isLimitUp: b.isLimitUp,
        isBroken: b.isBroken,
      }));
      const last = dbBars[dbBars.length - 1];
      quote = {
        price: last.close,
        changePct: last.changePct,
        amount: last.amount ?? 0,
        turnoverRate: last.turnoverRate,
        floatMarketCap: last.floatMarketCap,
        prevClose: last.prevClose,
      };
    } else {
      // 实时代理：多域名容错（proxy.finance 主路 + web.ifzq 备路），响应自带 qt 报价块
      let parsed: { rows: string[][]; qt: string[] | null } | null = null;
      let lastErr: unknown = null;
      for (const base of KLINE_BASES) {
        try {
          const json = await fetchJson<{
            data?: Record<string, { day?: string[][]; qfqday?: string[][]; nday?: string[][]; qt?: Record<string, string[]> }>;
          }>(`${base}?param=${txCode(code)},day,,,120,qfq`, {
            referer: "https://gu.qq.com/",
            timeoutMs: 15000,
            retries: base.includes("proxy") ? 2 : 0,
          });
          const d = json?.data?.[txCode(code)];
          if (d) {
            parsed = { rows: d.qfqday ?? d.day ?? d.nday ?? [], qt: d.qt?.[txCode(code)] ?? null };
            if (parsed.rows.length > 0) break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (!parsed || parsed.rows.length === 0) {
        throw new Error(
          `K线数据获取失败（${code}），请稍后重试${lastErr ? `：${(lastErr as Error).message.slice(0, 60)}` : ""}`
        );
      }
      const rows = parsed.rows.slice(-120);
      kline = rows.map((r, i) => ({
        date: r[0],
        open: Number(r[1]),
        close: Number(r[2]),
        high: Number(r[3]),
        low: Number(r[4]),
        volume: Number(r[5]),
        changePct:
          i > 0 && Number(rows[i - 1][2]) > 0
            ? Math.round((Number(r[2]) / Number(rows[i - 1][2]) - 1) * 10000) / 100
            : null,
        isLimitUp: luSet.has(r[0]),
        isBroken: brSet.has(r[0]),
      }));
      quote = parsed.qt ? parseQt(parsed.qt) : null;
    }

    return {
      basic: {
        stockCode: basic.stockCode,
        stockName: basic.stockName,
        market: basic.market,
        industry: basic.industry ?? concepts[0] ?? null,
      },
      quote,
      kline,
      limitUpHistory: limitUpHistory.map((r) => ({
        tradeDate: r.tradeDate,
        boardCount: r.boardCount,
        firstLimitTime: r.firstLimitTime,
        openCount: r.openCount,
        daysAndBoards: r.daysAndBoards,
      })),
      boardHistory: boardHistory.map((r) => ({
        tradeDate: r.tradeDate,
        boardCount: r.boardCount,
        previousBoardCount: r.previousBoardCount,
        isPromotion: r.isPromotion,
        isBreak: r.isBreak,
        isRebound: r.isRebound,
      })),
      concepts,
      themeEvidence,
    };
  });
}

/** 搜索结果排序权重：精确代码 > 缩写前缀 > 名称前缀 > 缩写包含 > 名称包含 */
function searchRank(r: { stockCode: string; stockName: string; nameAbbr: string | null }, q: string, digits: string): number {
  if (digits && r.stockCode === digits) return 100;
  const abbr = (r.nameAbbr ?? "").toUpperCase();
  if (abbr && abbr.startsWith(q)) return 90;
  if (r.stockName.startsWith(q)) return 80;
  if (abbr && abbr.includes(q)) return 60;
  if (r.stockName.includes(q)) return 50;
  if (digits && r.stockCode.includes(digits)) return 40;
  return 0;
}

/** 股票搜索：支持 代码 / 名称关键字 / 名称拼音首字母缩写（如 ptf → 平潭发展），大小写不敏感 */
export async function searchStocks(q: string, limit = 12) {
  const query = q.trim();
  if (!query) return [];
  const digits = query.replace(/\D/g, "");
  const upper = query.toUpperCase();
  const rows = await db.stockBasic.findMany({
    where: {
      OR: [
        ...(digits ? [{ stockCode: { contains: digits } }] : []),
        { stockName: { contains: query } },
        { nameAbbr: { contains: upper } },
      ],
    },
    take: 80,
  });
  return rows
    .map((r) => ({ ...r, _rank: searchRank(r, upper, digits) }))
    .filter((r) => r._rank > 0)
    .sort((a, b) => b._rank - a._rank || a.stockCode.localeCompare(b.stockCode))
    .slice(0, limit)
    .map((r) => ({
      stockCode: r.stockCode,
      stockName: r.stockName,
      market: r.market,
      industry: r.industry,
    }));
}
