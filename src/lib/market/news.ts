// ============================================================
// 新浪财经 7x24 快讯数据源（主线追踪栏目）
// https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152
// rich_text 结构通常为：【标题】正文（来源），ext 内含提及股票
// ============================================================

import { fetchJson } from "./http";

const FEED_BASE = "https://zhibo.sina.com.cn/api/zhibo/feed";
const SINA_REFERER = "https://finance.sina.com.cn/";

export interface SinaExtStock {
  market: string; // cn | us | hk
  symbol: string; // sh601238 / didiy
  key: string; // 提及名称
}

export interface SinaNewsItem {
  extId: string;
  pubTime: string; // YYYY-MM-DD HH:mm:ss
  content: string; // 清理后的正文（去 HTML 标签）
  title: string | null; // 【】内标题（无则为 null）
  stocks: SinaExtStock[]; // 提及股票（来自 ext，可能为空）
}

interface RawFeedItem {
  id?: number | string;
  rich_text?: string;
  create_time?: string;
  ext?: string;
  is_delete?: number;
  top_value?: number;
}

/** 清理 rich_text：去 HTML 标签，压缩空白 */
function cleanRichText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExtStocks(extRaw?: string): SinaExtStock[] {
  if (!extRaw) return [];
  try {
    const ext = JSON.parse(extRaw) as { stocks?: { market?: string; symbol?: string; key?: string }[] };
    return (ext.stocks ?? [])
      .filter((s) => s.symbol && s.key)
      .map((s) => ({ market: String(s.market ?? "cn"), symbol: String(s.symbol), key: String(s.key) }));
  } catch {
    return [];
  }
}

function normalizeItem(raw: RawFeedItem): SinaNewsItem | null {
  const content = cleanRichText(String(raw.rich_text ?? ""));
  if (!content || raw.is_delete === 1) return null;
  const titleMatch = content.match(/^【(.+?)】/);
  return {
    extId: String(raw.id ?? ""),
    pubTime: String(raw.create_time ?? "").slice(0, 19),
    content,
    title: titleMatch ? titleMatch[1] : null,
    stocks: parseExtStocks(raw.ext),
  };
}

/** 拉取最新快讯（page 从 1 开始，每页最多 50 条） */
export async function fetchSinaFastNews(pageSize = 30, page = 1): Promise<SinaNewsItem[]> {
  const url = `${FEED_BASE}?zhibo_id=152&page=${page}&page_size=${pageSize}`;
  const json = await fetchJson<{
    result?: { status?: { code?: number }; data?: { feed?: { list?: RawFeedItem[] } } };
  }>(url, { referer: SINA_REFERER, timeoutMs: 15000 });
  const list = json?.result?.data?.feed?.list ?? [];
  return list
    .map(normalizeItem)
    .filter((x): x is SinaNewsItem => x != null && x.extId !== "");
}
