// ============================================================
// 东方财富 push2ex 涨停池数据源
// 提供：涨停池 / 炸板池 / 跌停池（支持历史日期回补）
// 字段：首封时间 fbt、末封时间 lbt、炸板次数 zbc、封单资金 fund、
//       行业 hybk、几天几板 zttj、连板数 lbc（仅作交叉验证，不直接采信）
// ============================================================

import { fetchJson, pmap } from "./http";
import { fmtTime } from "./rules";

const EM_UT = "7eea3edcaed734bea9cbfc24409ed989";
const EM_REFERER = "https://quote.eastmoney.com/ztb.html";
const EM_BASE = "https://push2ex.eastmoney.com";

export interface EmPoolStock {
  code: string;
  name: string;
  price: number; // 最新价（元）
  limitPrice: number; // 涨停价（元）
  changePct: number; // 涨跌幅 %
  amount: number; // 成交额（元）
  floatMarketCap: number; // 流通市值（元）
  totalMarketCap: number; // 总市值（元）
  turnoverRate: number; // 换手率 %
  firstLimitTime: string | null; // 首次封板时间
  lastLimitTime: string | null; // 最终封板时间
  openCount: number; // 炸板次数 / 跌停开板次数
  sealFund: number; // 封单资金（元）
  industry: string; // 所属行业
  days: number; // 几天
  boards: number; // 几板
  sourceBoardCount: number; // 数据源连板数（参考）
  continuousDownDays: number; // 连续跌停天数（跌停池）
}

// ---------- 原始字段（防御式解析） ----------
interface RawPoolRow {
  c?: string;
  n?: string;
  p?: number;
  ztp?: number;
  zdp?: number;
  amount?: number;
  ltsz?: number;
  tshare?: number;
  hs?: number;
  lbc?: number;
  fbt?: number;
  lbt?: number;
  fund?: number;
  zbc?: number;
  hybk?: string;
  zttj?: { days?: number; ct?: number };
  days?: number;
  oc?: number;
}

function normalizeRow(r: RawPoolRow): EmPoolStock {
  return {
    code: String(r.c ?? "").padStart(6, "0"),
    name: String(r.n ?? "").trim(),
    price: (r.p ?? 0) / 1000,
    limitPrice: (r.ztp ?? 0) / 1000,
    changePct: Number(r.zdp ?? 0),
    amount: Number(r.amount ?? 0),
    floatMarketCap: Number(r.ltsz ?? 0),
    totalMarketCap: Number(r.tshare ?? 0),
    turnoverRate: Number(r.hs ?? 0),
    firstLimitTime: fmtTime(r.fbt),
    lastLimitTime: fmtTime(r.lbt),
    openCount: Math.max(0, Math.floor(r.zbc ?? r.oc ?? 0)),
    sealFund: Number(r.fund ?? 0),
    industry: String(r.hybk ?? "").trim(),
    days: r.zttj?.days ?? 0,
    boards: r.zttj?.ct ?? 0,
    sourceBoardCount: Math.max(0, Math.floor(r.lbc ?? 0)),
    continuousDownDays: r.days ?? 0,
  };
}

type PoolKind = "zt" | "zb" | "dt";

const POOL_ENDPOINT: Record<PoolKind, string> = {
  zt: "getTopicZTPool", // 涨停股池
  zb: "getTopicZBPool", // 炸板股池
  dt: "getTopicDTPool", // 跌停股池
};

async function fetchPool(kind: PoolKind, dateYYYYMMDD: string, pageSize = 1000): Promise<EmPoolStock[]> {
  const url =
    `${EM_BASE}/${POOL_ENDPOINT[kind]}?ut=${EM_UT}&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=${pageSize}&sort=fbt%3Aasc&date=${dateYYYYMMDD}`;
  try {
    const json = await fetchJson<{
      rc?: number;
      data?: { tc?: number; pool?: RawPoolRow[] } | null;
    }>(url, { referer: EM_REFERER, timeoutMs: 15000 });
    const pool = json?.data?.pool;
    if (!Array.isArray(pool)) return [];
    return pool.map(normalizeRow).filter((s) => s.code.length === 6);
  } catch (e) {
    console.warn(`[em] fetchPool ${kind} ${dateYYYYMMDD} failed:`, (e as Error).message);
    return [];
  }
}

/** 涨停池 */
export function fetchZtPool(dateYYYYMMDD: string): Promise<EmPoolStock[]> {
  return fetchPool("zt", dateYYYYMMDD);
}
/** 炸板池（曾涨停，收盘未封住） */
export function fetchZbPool(dateYYYYMMDD: string): Promise<EmPoolStock[]> {
  return fetchPool("zb", dateYYYYMMDD);
}
/** 跌停池 */
export function fetchDtPool(dateYYYYMMDD: string): Promise<EmPoolStock[]> {
  return fetchPool("dt", dateYYYYMMDD);
}

/** 批量拉取多个交易日的三种池子 */
export async function fetchAllPools(
  datesYYYYMMDD: string[],
  concurrency = 4
): Promise<Map<string, { zt: EmPoolStock[]; zb: EmPoolStock[]; dt: EmPoolStock[] }>> {
  const out = new Map<string, { zt: EmPoolStock[]; zb: EmPoolStock[]; dt: EmPoolStock[] }>();
  await pmap(datesYYYYMMDD, concurrency, async (d) => {
    const [zt, zb, dt] = await Promise.all([
      fetchZtPool(d),
      fetchZbPool(d),
      fetchDtPool(d),
    ]);
    out.set(d, { zt, zb, dt });
  });
  return out;
}
