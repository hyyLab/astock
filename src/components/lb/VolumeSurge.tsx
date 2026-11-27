"use client";

// 爆量榜（需求文档·十九 + 用户迭代）：量能体系差异化模块
// 范围：全市场（含非涨停标的）；量比 = 当日成交量 / 20日均量（后端统一口径），≥2 入选
// 位置：距60日最高点回撤 ≤10% 高位 / ≥30% 低位 / 其余中位（规则透明）
import { useMemo, useState } from "react";
import type { ReviewBundle, VolumeSurgeRow } from "./api";
import { fmtYi, pctClass } from "./format";

export const POSITION_LABEL: Record<VolumeSurgeRow["position"], string> = {
  low: "低位爆量",
  mid: "中位爆量",
  high: "高位爆量",
};

function positionChip(p: VolumeSurgeRow["position"]) {
  if (p === "high") return "bg-warn-soft text-warn-strong";
  if (p === "low") return "bg-link-soft-bg text-link-strong";
  return "bg-muted text-muted-foreground";
}

export function VolumeSurgeTable({ rows, compact = false }: { rows: VolumeSurgeRow[]; compact?: boolean }) {
  if (rows.length === 0) {
    return <div className="py-8 text-center text-[12px] text-dim">今日无量比 ≥ 2 的爆量标的</div>;
  }
  const list = compact ? rows.slice(0, 10) : rows;

  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
            <th className="px-2 py-1.5 text-right font-normal">涨跌</th>
            <th className="px-2 py-1.5 text-right font-normal">量比</th>
            <th className="px-2 py-1.5 text-right font-normal">换手</th>
            <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
            <th className="px-2 py-1.5 text-left font-normal">主线题材</th>
            <th className="px-2 py-1.5 text-center font-normal">位置</th>
            <th className="px-3.5 py-1.5 text-center font-normal">标记</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr
              key={s.stockCode}
              onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
              className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
            >
              <td className="px-3.5 py-1.5">
                <span className="font-medium text-foreground">{s.stockName}</span>
                <span className="num ml-1.5 text-[11px] text-dim2">{s.stockCode}</span>
              </td>
              <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(s.changePct)}`}>
                {s.changePct > 0 ? "+" : ""}
                {s.changePct.toFixed(2)}%
              </td>
              <td className="num px-2 py-1.5 text-right font-bold tabular-nums text-warn">
                {s.volumeRatio.toFixed(1)}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {s.turnoverRate != null ? `${s.turnoverRate.toFixed(1)}%` : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{fmtYi(s.amount)}</td>
              <td className="max-w-[140px] truncate px-2 py-1.5 text-muted-foreground" title={s.themes.join("、") || s.industry || ""}>
                {s.themes.length > 0 ? s.themes.slice(0, 2).join("·") : (s.industry ?? "—")}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-center">
                <span className={`rounded-[2px] px-1 text-[10px] leading-4 ${positionChip(s.position)}`}>
                  {POSITION_LABEL[s.position]}
                </span>
              </td>
              <td className="whitespace-nowrap px-3.5 py-1.5 text-center">
                {s.isLimitUp && (
                  <span className="rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-fg2">涨停</span>
                )}
                {s.isBroken && (
                  <span className="rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-dim">炸板</span>
                )}
                {!s.isLimitUp && !s.isBroken && (
                  <span className="text-[10px] leading-4 text-dim2">非涨停</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 首页紧凑版：全部爆量前10（位置分布统计） */
export default function VolumeSurge({ bundle }: { bundle: ReviewBundle }) {
  const rows = bundle.volumeSurge;
  const stats = useMemo(
    () => ({
      high: rows.filter((r) => r.position === "high").length,
      mid: rows.filter((r) => r.position === "mid").length,
      low: rows.filter((r) => r.position === "low").length,
      zt: rows.filter((r) => r.isLimitUp).length,
    }),
    [rows]
  );

  return (
    <section aria-label="爆量榜" className="panel">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">今日爆量</h2>
        <span className="num text-[11px] text-dim">
          量比 = 当日成交量 / 20日均量 · ≥2.0 计入 · 含非涨停 · 共 {rows.length} 家
        </span>
        <div className="ml-auto hidden items-center gap-2.5 text-[10px] text-dim sm:flex">
          <span>涨停 <b className="num text-up">{stats.zt}</b></span>
          <span>高位 <b className="num text-warn-strong">{stats.high}</b></span>
          <span>低位 <b className="num text-link-strong">{stats.low}</b></span>
        </div>
      </div>
      <div className="py-1">
        <VolumeSurgeTable rows={rows} compact />
      </div>
    </section>
  );
}
