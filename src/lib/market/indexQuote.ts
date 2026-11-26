// ============================================================
// A股指数实时行情（qt.gtimg.cn，盘中异动的"大盘同期"基准）
// 响应为 GBK 编码（名称乱码可忽略，本站使用自维护中文名）：
//   v_sh000001="1~上证指数~000001~3812.45~3813.79~3806.98~...~20261012105539~-1.34~-0.04~最高~最低~..."
//   split("~") 后：[3]=最新价 [4]=昨收 [30]=时间YYYYMMDDHHMMSS [31]=涨跌额 [32]=涨跌幅% [33]=最高 [34]=最低
// 字段位与 us.ts（美股同源接口）一致，解析逻辑同构
// ============================================================

import { fetchText } from "./http";

const BASE = "https://qt.gtimg.cn/q=";
const REFERER = "https://gu.qq.com/";

export const A_INDEX_CODES = [
  { fullCode: "sh000001", name: "上证指数" },
  { fullCode: "sz399001", name: "深证成指" },
  { fullCode: "sz399006", name: "创业板指" },
] as const;

export interface AIndexQuote {
  fullCode: string; // sh000001
  name: string; // 自维护中文名（数据源 GBK 乱码不用）
  close: number; // 最新点位
  prevClose: number; // 昨收
  changePct: number; // 涨跌幅 %
  high: number;
  low: number;
  quoteTime: string; // 数据源时间戳 YYYYMMDDHHMMSS（用于交易日校验）
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 批量拉取 A 股指数实时行情（失败的条目跳过） */
export async function fetchAIndexQuotes(
  fullCodes: readonly string[] = A_INDEX_CODES.map((c) => c.fullCode)
): Promise<Map<string, AIndexQuote>> {
  const out = new Map<string, AIndexQuote>();
  if (fullCodes.length === 0) return out;
  const nameByCode = new Map(A_INDEX_CODES.map((c) => [c.fullCode, c.name]));
  const text = await fetchText(`${BASE}${fullCodes.join(",")}`, {
    referer: REFERER,
    timeoutMs: 12000,
    retries: 1,
  });
  for (const fullCode of fullCodes) {
    const line = text.split(";").find((s) => s.trim().startsWith(`v_${fullCode}="`));
    if (!line) continue;
    const m = line.match(/="([^"]*)"/);
    if (!m) continue;
    const f = m[1].split("~");
    if (f.length < 35) continue;
    const close = num(f[3]);
    if (close <= 0) continue;
    out.set(fullCode, {
      fullCode,
      name: nameByCode.get(fullCode) ?? fullCode,
      close,
      prevClose: num(f[4]),
      changePct: num(f[32]),
      high: num(f[33]),
      low: num(f[34]),
      quoteTime: String(f[30] ?? ""),
    });
  }
  return out;
}
