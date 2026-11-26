// ============================================================
// 美股行情数据源（腾讯 qt.gtimg.cn）
// 代码格式：usAAPL（无后缀），指数 usIXIC/usDJI/usINX
// 响应为 GBK 编码（名称乱码可忽略，本站使用自维护中文名），数值字段均为 ASCII：
//   v_usAAPL="200~名称~AAPL.OQ~最新价~昨收~今开~成交量~...~时间~涨跌额~涨跌幅%~最高~最低~..."
//   split("~") 后：[3]=最新价 [4]=昨收 [30]=时间 [31]=涨跌额 [32]=涨跌幅%
// ============================================================

import { fetchText } from "./http";

const US_BASE = "https://qt.gtimg.cn/q=";
const US_REFERER = "https://gu.qq.com/";

export interface UsQuote {
  symbol: string; // AAPL
  close: number;
  prevClose: number;
  changePct: number; // %
  change: number;
  high: number;
  low: number;
  time: string; // 行情时间（美东收盘后的最新时间戳）
}

export const US_INDICES = [
  { symbol: "usIXIC", name: "纳斯达克" },
  { symbol: "usDJI", name: "道琼斯" },
  { symbol: "usINX", name: "标普500" },
] as const;

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseOne(symbol: string, raw: string): UsQuote | null {
  const m = raw.match(/="([^"]*)"/);
  if (!m) return null;
  const f = m[1].split("~");
  if (f.length < 35) return null;
  const close = num(f[3]);
  if (close <= 0) return null;
  return {
    symbol: symbol.replace(/^us/i, "").toUpperCase(),
    close,
    prevClose: num(f[4]),
    changePct: num(f[32]),
    change: num(f[31]),
    high: num(f[33]),
    low: num(f[34]),
    time: String(f[30] ?? ""),
  };
}

/** 批量拉取美股/美股指数行情（失败的条目跳过） */
export async function fetchUsQuotes(symbols: string[]): Promise<Map<string, UsQuote>> {
  const out = new Map<string, UsQuote>();
  if (symbols.length === 0) return out;
  const text = await fetchText(`${US_BASE}${symbols.join(",")}`, {
    referer: US_REFERER,
    timeoutMs: 15000,
    retries: 1,
  });
  for (const symbol of symbols) {
    const re = new RegExp(`v_${symbol.replace(".", "\\.")}="`);
    const line = text.split(";").find((s) => re.test(s.trim()));
    if (!line) continue;
    const q = parseOne(symbol, line.trim());
    if (q) out.set(q.symbol, q);
  }
  return out;
}
