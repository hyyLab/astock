// ============================================================
// 腾讯行情数据源
// - getBoardRankList: 全市场 A 股快照（涨跌家数 / 成交额 / 换手 / 市值）
// - fqkline: 个股与指数历史日K（不复权，用于连板自主回溯计算）
// ============================================================

import { fetchJson, pmap } from "./http";
import { txCode } from "./rules";

const RANK_BASE = "https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList";
// 主路：proxy.finance.qq.com 网关；备路：web.ifzq.gtimg.cn 直连（可能被 WAF 拦截）
export const KLINE_BASES = [
  "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get",
  "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get",
];

// ---------- 全市场快照 ----------

export interface TxRankRow {
  code: string; // 6位数字
  txCode: string; // sh600519
  name: string;
  price: number; // 最新价
  changePct: number; // 涨跌幅 %
  change: number; // 涨跌额
  turnoverRate: number; // 换手率 %
  volumeRatio: number; // 量比
  floatMarketCap: number; // 流通市值（元）
  totalMarketCap: number; // 总市值（元）
  amount: number; // 成交额（元）
  volume: number; // 成交量（手）
  amplitude: number; // 振幅 %
  changePct5: number; // 5日涨跌幅
  changePct20: number; // 20日涨跌幅
  stockType: string; // GP-A / GP-A-CYB / GP-A-KCB
}

interface RawRankRow {
  code?: string;
  name?: string;
  zxj?: string;
  zdf?: string;
  zd?: string;
  hsl?: string;
  lb?: string;
  ltsz?: string;
  zsz?: string;
  turnover?: string;
  volume?: string;
  zf?: string;
  zdf_d5?: string;
  zdf_d20?: string;
  stock_type?: string;
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRankRow(r: RawRankRow): TxRankRow | null {
  if (!r.code || !/^\w{2}\d{6}$/.test(r.code)) return null;
  return {
    txCode: r.code,
    code: r.code.replace(/^\w{2}/, ""),
    name: String(r.name ?? "").trim(),
    price: num(r.zxj),
    changePct: num(r.zdf),
    change: num(r.zd),
    turnoverRate: num(r.hsl),
    volumeRatio: num(r.lb),
    floatMarketCap: num(r.ltsz) * 1e8, // 亿 → 元
    totalMarketCap: num(r.zsz) * 1e8,
    amount: num(r.turnover) * 1e4, // 万 → 元
    volume: num(r.volume), // 手
    amplitude: num(r.zf),
    changePct5: num(r.zdf_d5),
    changePct20: num(r.zdf_d20),
    stockType: String(r.stock_type ?? ""),
  };
}

/**
 * 拉取全部沪深 A 股快照（约4600只，200只/页分页）
 * sort_type=price 保证分页参数无副作用；total 字段控制翻页终点
 */
export async function fetchAllStockSnapshot(pageSize = 200): Promise<TxRankRow[]> {
  const all: TxRankRow[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = `${RANK_BASE}?board_code=aStock&sort_type=price&direct=down&offset=${offset}&count=${pageSize}`;
    const json = await fetchJson<{
      code?: number;
      data?: { rank_list?: RawRankRow[]; total?: number };
    }>(url, { referer: "https://gu.qq.com/", timeoutMs: 15000 });
    const list = json?.data?.rank_list ?? [];
    total = json?.data?.total ?? 0;
    for (const raw of list) {
      const row = normalizeRankRow(raw);
      if (row && row.price > 0) all.push(row);
    }
    offset += pageSize;
    if (list.length === 0) break;
  }
  return all;
}

// ---------- 历史 K 线 ----------

export interface TxDailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number; // 手（指数同理）
  amount?: number; // 成交额（元，指数/个股 newfqkline 均有；老接口可能缺失）
}

interface KlineResp {
  code?: number;
  data?: Record<
    string,
    {
      day?: string[][];
      qfqday?: string[][];
      nday?: string[][];
      qt?: Record<string, string[]>;
    }
  >;
}

function parseBars(rows: string[][] | undefined): TxDailyBar[] {
  if (!Array.isArray(rows)) return [];
  const out: TxDailyBar[] = [];
  for (const r of rows) {
    // 行结构: [date, open, close, high, low, volume, {}, 换手?, 成交额万?, ...]
    if (r.length < 6) continue;
    const [date, open, close, high, low, volume] = r;
    const amtRaw = r.length > 8 ? Number(r[8]) : NaN;
    const bar = {
      date: String(date),
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number.isFinite(amtRaw) && amtRaw > 0 ? amtRaw * 1e4 : undefined,
    };
    if (bar.close > 0 && bar.high >= bar.low) out.push(bar);
  }
  return out;
}

/**
 * 拉取个股/指数日K（默认不复权）
 * count: 最近N根；用于连板回溯时建议 ≥ 60
 * 主路失败自动切换备用域名
 */
export async function fetchDailyKline(
  code: string,
  count = 70,
  fq: "" | "qfq" = ""
): Promise<TxDailyBar[]> {
  return fetchKlineByFullCode(txCode(code), count, fq);
}

/** 接受带市场前缀的完整代码（指数如 sh000001 必须带前缀传入） */
export async function fetchKlineByFullCode(
  fullCode: string,
  count = 70,
  fq: "" | "qfq" = ""
): Promise<TxDailyBar[]> {
  let lastErr: unknown;
  for (const base of KLINE_BASES) {
    try {
      const url = `${base}?param=${fullCode},day,,,${count},${fq}`;
      const json = await fetchJson<KlineResp>(url, {
        referer: "https://gu.qq.com/",
        timeoutMs: 15000,
        retries: base.includes("proxy") ? 2 : 0,
        gapMs: 120,
      });
      const d = json?.data?.[fullCode];
      if (!d) return [];
      const bars = parseBars(d.day ?? d.qfqday ?? d.nday);
      if (bars.length > 0) return bars;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`kline failed: ${fullCode}`);
}

/** 并发拉取多只股票日K（失败的返回空数组）；限速并发，避免触发 WAF */
export async function fetchKlineBatch(
  codes: string[],
  count = 70,
  concurrency = 3
): Promise<Map<string, TxDailyBar[]>> {
  const map = new Map<string, TxDailyBar[]>();
  await pmap(codes, concurrency, async (code) => {
    try {
      const bars = await fetchDailyKline(code, count);
      map.set(code, bars);
    } catch {
      map.set(code, []);
    }
  });
  return map;
}

// ---------- 指数 ----------

export const INDEX_CODES = {
  sh: "sh000001", // 上证指数
  sz: "sz399001", // 深证成指
  cyb: "sz399006", // 创业板指
  kc50: "sh000688", // 科创50
  sz50: "sh000016", // 上证50
  bz50: "bj899050", // 北证50
  szcomp: "sz399106", // 深证综指（用于深市成交额）
} as const;

export interface IndexSeries {
  code: string; // 6位数字
  name: string;
  bars: TxDailyBar[];
}

const INDEX_NAMES: Record<string, string> = {
  "000001": "上证指数",
  "399001": "深证成指",
  "399006": "创业板指",
  "000688": "科创50",
  "000016": "上证50",
  "899050": "北证50",
  "399106": "深证综指",
};

export async function fetchIndexKline(
  fullCode: string,
  count = 40
): Promise<IndexSeries> {
  // 指数代码直接带前缀传入（sh000001 与 平安银行 sz000001 同号不同市）
  const numeric = fullCode.replace(/^\w{2}/, "");
  const bars = await fetchDailyKlineRaw(fullCode, count);
  return { code: numeric, name: INDEX_NAMES[numeric] ?? numeric, bars };
}

/** 与 fetchDailyKline 相同，但接受带前缀的完整代码 */
async function fetchDailyKlineRaw(fullCode: string, count = 70): Promise<TxDailyBar[]> {
  return fetchKlineByFullCode(fullCode, count, "");
}

/** 一次性拉取全部关注指数（失败的自动跳过） */
export async function fetchAllIndexKlines(count = 40): Promise<IndexSeries[]> {
  const codes = Object.values(INDEX_CODES);
  const list = await pmap(codes, 3, (c) => fetchIndexKline(c, count));
  return list.filter((s): s is IndexSeries => Array.isArray(s?.bars) && s.bars.length > 0);
}
