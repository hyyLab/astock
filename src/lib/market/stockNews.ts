// ============================================================
// 个股新闻数据源（题材归类证据链 · 主线新闻流）
// 主源：东财搜索 API（search-api-web.eastmoney.com，jsonp）
//   按股票名称搜索财经新闻，返回 标题/正文摘要/媒体/时间/链接。
//   探测结论（scripts/check-stock-news.ts）：HTTP 200、code=0、
//   result.cmsArticleWebOld 数组，日期与库内交易日一致。
// 用途：
//   1. 归类证据——新闻标题/摘要命中主线关键词 → 佐证该股归属该主线
//   2. 主线新闻流——涨停股新闻入库 NewsItem(kind=stock)，挂到主线下
// ============================================================

import { fetchText } from "./http";

const SEARCH_BASE = "https://search-api-web.eastmoney.com/search/jsonp";

export interface StockNewsItem {
  title: string;
  summary: string;
  media: string;
  url: string;
  pubTime: string; // YYYY-MM-DD HH:mm:ss
}

interface EmArticle {
  title?: string;
  content?: string;
  date?: string;
  mediaName?: string;
  url?: string;
  uniqueUrl?: string;
}

function stripEm(s: string): string {
  return (s ?? "").replace(/<\/?em>/g, "").trim();
}

/**
 * 按股票名称抓取个股新闻。
 * @param stockName 股票名称（自动去空格/星号）
 * @param since 起始时间（含），如 "2026-09-24 00:00:00"，早于该时间的新闻丢弃
 * @param until 截止时间（含），如 "2026-09-25 23:59:59"，晚于该时间的新闻丢弃
 * @param take 最多返回条数
 */
export async function fetchStockNews(
  stockName: string,
  opts?: { since?: string; until?: string; take?: number; pageSize?: number; timeoutMs?: number }
): Promise<StockNewsItem[]> {
  const name = stockName.replace(/[\s*＊]/g, "").trim();
  if (!name) return [];
  const pageSize = Math.min(20, Math.max(5, opts?.pageSize ?? 12));
  const take = opts?.take ?? 8;

  const param = JSON.stringify({
    uid: "",
    keyword: name,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize,
        preTag: "<em>",
        postTag: "</em>",
      },
    },
  });
  const url = `${SEARCH_BASE}?cb=cb&param=${encodeURIComponent(param)}`;
  const text = await fetchText(url, {
    referer: "https://so.eastmoney.com/",
    timeoutMs: opts?.timeoutMs ?? 12000,
    retries: 1,
  });

  // jsonp：cb({...}) → {...}；兼容直接返回 JSON 的情况
  const raw = text.startsWith("cb(") ? text.slice(3, text.lastIndexOf(")")) : text;
  const json = JSON.parse(raw) as {
    code?: number;
    result?: { cmsArticleWebOld?: EmArticle[] };
  };
  const articles = json?.result?.cmsArticleWebOld ?? [];

  const out: StockNewsItem[] = [];
  for (const a of articles) {
    const title = stripEm(a.title ?? "");
    const summary = stripEm(a.content ?? "").slice(0, 200);
    const pubTime = String(a.date ?? "").slice(0, 19);
    if (!title || !/^\d{4}-\d{2}-\d{2}/.test(pubTime)) continue;
    if (opts?.since && pubTime < opts.since) continue;
    if (opts?.until && pubTime > opts.until) continue;
    // 命中过滤：标题或摘要须包含股票名（搜索按全文匹配，剔除仅同名泛称的噪音）
    if (!title.includes(name) && !summary.includes(name)) continue;
    out.push({
      title,
      summary,
      media: String(a.mediaName ?? "").slice(0, 30),
      url: String(a.url ?? a.uniqueUrl ?? "").slice(0, 400),
      pubTime,
    });
    if (out.length >= take) break;
  }
  return out;
}
