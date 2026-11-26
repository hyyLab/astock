// ============================================================
// 个股分时数据（腾讯 minute/query，盘中异动的"窗口涨幅基线"回填源）
//
// 用途：调度器冷启动（进程被回收后重启 / 当日首轮采样）时，全市场快照
// 没有当日历史采样，无法计算 5/10/30 分钟窗口涨幅；对候选异动股拉分时
// 序列，把 t-5m / t-10m / t-30m 时点的真实价格补写进 IntradaySnap，
// 让窗口异动判定与页面展示立即可用（数据为交易所真实分时，非模拟）。
//
// 接口：GET ifzqgtimg/appstock/app/minute/query?code=sh600519
//   data[code].data.data = ["0930 1262.95 170 21470150.00", ...]
//   每分钟一条："HHMM 价格 累计成交量(手) 累计成交额(元)"
// ============================================================

import { fetchJson } from "./http";

const BASE = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query";

export interface MinutePoint {
  hhmm: string; // "0930"（集合竞价行）/"0931"..."1500"
  price: number;
  cumVolume: number; // 手
  cumAmount: number; // 元（可能缺失）
}

interface MinuteResp {
  code?: number;
  data?: Record<
    string,
    { data?: { data?: string[]; date?: string } }
  >;
}

/** 拉取单只股票当日分时序列（失败抛错，由调用方兜底跳过） */
export async function fetchMinuteSeries(fullCode: string): Promise<MinutePoint[]> {
  const json = await fetchJson<MinuteResp>(`${BASE}?code=${fullCode}`, {
    referer: "https://gu.qq.com/",
    timeoutMs: 10000,
    retries: 1,
  });
  const rows = json?.data?.[fullCode]?.data?.data;
  if (!Array.isArray(rows)) return [];
  const out: MinutePoint[] = [];
  for (const r of rows) {
    const parts = String(r).trim().split(/\s+/);
    if (parts.length < 3) continue;
    const hhmm = parts[0];
    const price = Number(parts[1]);
    const cumVolume = Number(parts[2]);
    if (!/^\d{4}$/.test(hhmm) || !Number.isFinite(price) || price <= 0) continue;
    const cumAmount = Number(parts[3] ?? 0);
    out.push({
      hhmm,
      price,
      cumVolume: Number.isFinite(cumVolume) ? cumVolume : 0,
      cumAmount: Number.isFinite(cumAmount) ? cumAmount : 0,
    });
  }
  return out;
}

/**
 * 从分时序列取「不晚于目标时刻的最近一条」价格（用于窗口基线）
 * target = "HHMM" 4位数字字符串；序列按时间升序
 */
export function minuteBaselineAt(
  series: MinutePoint[],
  target: string
): MinutePoint | null {
  let best: MinutePoint | null = null;
  for (const p of series) {
    if (p.hhmm <= target) best = p;
    else break;
  }
  return best;
}
