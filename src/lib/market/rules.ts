// ============================================================
// 涨停/跌停判定规则（方案第六步：不能只写 close == yesterday_close * 1.1）
// 覆盖：主板10% / 创业板·科创板20% / 北交所30% / ST 5%
// ============================================================

/** 根据股票代码推断市场 */
export function marketOf(code: string): "SH" | "SZ" | "BJ" {
  if (code.startsWith("6")) return "SH";
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("92")) return "BJ";
  return "SZ";
}

/** 腾讯行情代码（sh600000 / sz000001 / bj920002） */
export function txCode(code: string): string {
  return `${marketOf(code).toLowerCase()}${code}`;
}

/** 标准化 6 位纯数字代码（去掉 sh/sz/bj 前缀） */
export function plainCode(code: string): string {
  const m = code.match(/(\d{6})$/);
  return m ? m[1] : code;
}

/**
 * 该股票的涨跌幅限制（百分比数值）
 * - 科创板(68)/创业板(30)：20%
 * - 北交所(4/8/92开头)：30%
 * - 主板 ST：5%
 * - 主板其余：10%
 * 注：新股上市初期无涨跌幅限制的特殊情况，由涨停池数据源兜底（规则法仅做交叉验证）
 */
export function limitPctOf(code: string, name: string): number {
  if (code.startsWith("68") || code.startsWith("30")) return 20;
  if (marketOf(code) === "BJ") return 30;
  if (name.includes("ST")) return 5;
  return 10;
}

/** 四舍五入到分 */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** 理论涨停价 */
export function limitUpPriceOf(prevClose: number, pct: number): number {
  return round2(prevClose * (1 + pct / 100));
}

/** 理论跌停价 */
export function limitDownPriceOf(prevClose: number, pct: number): number {
  return round2(prevClose * (1 - pct / 100));
}

export type BarStatus = "limitUp" | "broken" | "limitDown" | null;

export interface RawBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

const EPS = 0.001;

/**
 * 基于「不复权日K」+ 涨跌幅规则 判定单日涨停状态
 * - limitUp   : 收盘封住涨停
 * - broken    : 盘中触板但收盘未封住（炸板）
 * - limitDown : 收盘跌停
 */
export function detectBarStatus(
  code: string,
  name: string,
  prevClose: number,
  bar: RawBar
): BarStatus {
  if (!prevClose || prevClose <= 0) return null;
  const pct = limitPctOf(code, name);
  const up = limitUpPriceOf(prevClose, pct);
  const down = limitDownPriceOf(prevClose, pct);
  if (Math.abs(bar.close - up) < EPS) return "limitUp";
  if (Math.abs(bar.high - up) < EPS && bar.close < up) return "broken";
  if (Math.abs(bar.close - down) < EPS) return "limitDown";
  return null;
}

/** HHMMSS 数字时间 → "HH:MM:SS"；0/空 → null */
export function fmtTime(t: number | undefined | null): string | null {
  if (!t || t <= 0) return null;
  const s = String(Math.floor(t)).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

/** YYYYMMDD → YYYY-MM-DD */
export function fmtDate(d: number | string): string {
  const s = String(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
