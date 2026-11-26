"use client";

// 爆量专项页（需求文档·十九 + 用户迭代）
// 全市场口径（含非涨停标的）；低位爆量 / 高位爆量 分 tabs 观察
// 位置规则：距60日最高点回撤 ≤10% 高位 / ≥30% 低位 / 其余中位
import { useState } from "react";
import DateBar from "./DateBar";
import { VolumeSurgeTable } from "./VolumeSurge";
import { useReview, LoadingState } from "./useReview";

type Tab = "all" | "low" | "high" | "mid" | "zt";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "low", label: "低位爆量" },
  { key: "high", label: "高位爆量" },
  { key: "mid", label: "中位爆量" },
  { key: "zt", label: "爆量涨停" },
];

export default function VolumeView() {
  const { bundle, stale, error, retry } = useReview();
  const [tab, setTab] = useState<Tab>("all");

  if (stale) return <LoadingState />;
  if (error || !bundle)
    return <div className="py-20 text-center text-sm text-dim">{error ?? "数据加载失败"}</div>;

  const rows = bundle.volumeSurge;
  const counts = {
    all: rows.length,
    low: rows.filter((r) => r.position === "low").length,
    high: rows.filter((r) => r.position === "high").length,
    mid: rows.filter((r) => r.position === "mid").length,
    zt: rows.filter((r) => r.isLimitUp).length,
  };
  const filtered =
    tab === "all"
      ? rows
      : tab === "zt"
        ? rows.filter((r) => r.isLimitUp)
        : rows.filter((r) => r.position === tab);

  return (
    <div className="space-y-3">
      <DateBar bundle={bundle} />

      <section className="panel">
        <div className="module-header">
          <h2 className="text-[13px] font-semibold text-foreground">今日爆量榜</h2>
          <span className="num text-[11px] text-dim">量比 ≥ 2.0 · 全市场（含非涨停） · 共 {rows.length} 家</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3.5 py-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-[3px] px-2 py-1 text-[12px] transition-colors ${
                tab === t.key ? "bg-up-soft font-medium text-up" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t.label}
              <span className="num ml-1 text-[10px] text-dim2">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="py-1">
          <VolumeSurgeTable rows={filtered} />
        </div>
      </section>

      <section className="panel px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">口径说明</div>
        <p>
          量比 = 当日成交量 ÷ 前 20 个交易日均量（不足 20 日按可用天数，至少 5 日），量比 ≥ 2.0 视为爆量。
          爆量观察范围为全市场（约 4600 只），不再限于涨停股——非涨停的放量标的同样可能是资金介入信号，
          榜内以「涨停 / 炸板 / 非涨停」标记区分。候选预筛采用数据源量比排序，正式入选与本站涨停池同一 20 日口径精算。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">位置划分</b>（规则透明）：收盘价距 60 日最高点回撤 ≤ 10% 为<b className="text-warn-strong">高位爆量</b>
          （警惕高位放量出货，也可视为突破中继）；回撤 ≥ 30% 为<b className="text-link-strong">低位爆量</b>
          （关注底部放量启动）；其余为<b>中位爆量</b>。历史 10 日内上市新股因样本不足不计入。
        </p>
        <p className="mt-1.5">
          「<b className="text-fg2">爆量不跌</b>」专项页已上线：近 5 个交易日爆量且未跌破最近爆量日收盘的标的筛选（导航「爆量不跌」）。
          规划中：爆量后 1 / 3 / 5 个交易日收益统计、爆量题材聚合、爆量选股器。
        </p>
      </section>
    </div>
  );
}
