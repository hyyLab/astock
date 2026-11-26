"use client";

// 爆量不跌专项页（用户迭代新增）
// 近 5 个交易日爆量（量比≥2，与爆量榜同一 20 日口径）且未跌破最近一次爆量日收盘的个股
// 语义：放量说明有资金大进大出，之后股价不跌 = 抛压被承接/筹码锁定，为强势观察信号
import { useEffect, useMemo, useState } from "react";
import { api, type VolumeHoldRow } from "./api";
import { pctClass } from "./format";
import { RefreshCw, TrendingUp } from "lucide-react";

const POSITION_LABEL: Record<VolumeHoldRow["position"], string> = {
  low: "低位",
  mid: "中位",
  high: "高位",
};

function positionChip(p: VolumeHoldRow["position"]) {
  if (p === "high") return "bg-warn-soft text-warn-strong";
  if (p === "low") return "bg-link-soft-bg text-link-strong";
  return "bg-muted text-muted-foreground";
}

type Tab = "all" | "strong" | "multi" | "zt" | "low";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "strong", label: "强势（距爆量日 ≥5%）" },
  { key: "multi", label: "多次爆量" },
  { key: "zt", label: "爆量日涨停" },
  { key: "low", label: "低位爆量" },
];

type SortKey = "since" | "current" | "ratio" | "surge";

export default function VolumeHoldView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.volumeHold>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("since");

  const load = async () => {
    try {
      const r = await api.volumeHold();
      setData(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      all: rows.length,
      strong: rows.filter((r) => r.sinceChangePct >= 5).length,
      multi: rows.filter((r) => r.surgeCount >= 2).length,
      zt: rows.filter((r) => r.surgeIsLimitUp).length,
      low: rows.filter((r) => r.position === "low").length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    if (tab === "strong") return rows.filter((r) => r.sinceChangePct >= 5);
    if (tab === "multi") return rows.filter((r) => r.surgeCount >= 2);
    if (tab === "zt") return rows.filter((r) => r.surgeIsLimitUp);
    if (tab === "low") return rows.filter((r) => r.position === "low");
    return rows;
  }, [data, tab]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const cmp: Record<SortKey, (a: VolumeHoldRow, b: VolumeHoldRow) => number> = {
      since: (a, b) => b.sinceChangePct - a.sinceChangePct,
      current: (a, b) => b.currentChangePct - a.currentChangePct,
      ratio: (a, b) => b.surgeVolumeRatio - a.surgeVolumeRatio,
      surge: (a, b) => b.surgeDate.localeCompare(a.surgeDate) || b.surgeVolumeRatio - a.surgeVolumeRatio,
    };
    return list.sort(cmp[sortKey]);
  }, [filtered, sortKey]);

  return (
    <div className="space-y-3">
      <section className="panel">
        <div className="module-header">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-up" /> 爆量不跌
          </h2>
          {data && (
            <span className="num text-[11px] text-dim">
              近 {data.windowDates.length} 个交易日（{data.windowDates[0]} ~ {data.windowDates[data.windowDates.length - 1]}）
              爆量 {data.surgeStockCount} 家 · 未跌破基准日收盘 {data.rows.length} 家 · 当前价来源
              {data.quoteSource === "snapshot" ? "实时快照" : "库内收盘"} · 更新于 {data.updatedAt.slice(11, 16)}
            </span>
          )}
          <button
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="ml-auto flex items-center gap-1 text-[11px] text-link hover:underline"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
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

        {error ? (
          <div className="py-16 text-center text-sm text-dim">{error}</div>
        ) : loading && !data ? (
          <div className="py-16 text-center text-[12px] text-dim">计算中（需拉取实时行情，约数秒）…</div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-dim">
            该筛选条件下暂无标的（爆量数据随每日采集积累，历史窗口越满结果越丰富）
          </div>
        ) : (
          <div className="lb-scroll overflow-x-auto">
            <table className="w-full min-w-[880px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-dim">
                  <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
                  <th
                    onClick={() => setSortKey("current")}
                    className={`cursor-pointer px-2 py-1.5 text-right font-normal hover:text-foreground ${sortKey === "current" ? "text-up" : ""}`}
                    title="点击排序"
                  >
                    现价 / 今日
                  </th>
                  <th
                    onClick={() => setSortKey("since")}
                    className={`cursor-pointer px-2 py-1.5 text-right font-normal hover:text-foreground ${sortKey === "since" ? "text-up" : ""}`}
                    title="当前收盘较最近一次爆量日收盘的涨跌幅 · 点击排序"
                  >
                    距爆量日
                  </th>
                  <th
                    onClick={() => setSortKey("surge")}
                    className={`cursor-pointer px-2 py-1.5 text-left font-normal hover:text-foreground ${sortKey === "surge" ? "text-up" : ""}`}
                    title="基准日 = 窗口内最近一次爆量日 · 点击排序"
                  >
                    爆量日
                  </th>
                  <th
                    onClick={() => setSortKey("ratio")}
                    className={`cursor-pointer px-2 py-1.5 text-right font-normal hover:text-foreground ${sortKey === "ratio" ? "text-up" : ""}`}
                    title="基准日 20 日口径量比 · 点击排序"
                  >
                    爆量量比
                  </th>
                  <th className="px-2 py-1.5 text-center font-normal">爆量日表现</th>
                  <th className="px-2 py-1.5 text-center font-normal">位置</th>
                  <th className="px-2 py-1.5 text-left font-normal">主线题材</th>
                  <th className="px-3.5 py-1.5 text-right font-normal">行业</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.stockCode}
                    onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
                    className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
                  >
                    <td className="px-3.5 py-1.5">
                      <span className="font-medium text-foreground">{r.stockName}</span>
                      <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
                    </td>
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                      <span className="text-foreground">{r.currentClose.toFixed(2)}</span>
                      <span className={`ml-1.5 ${pctClass(r.currentChangePct)}`}>
                        {r.currentChangePct > 0 ? "+" : ""}
                        {r.currentChangePct.toFixed(2)}%
                      </span>
                    </td>
                    <td className={`num px-2 py-1.5 text-right font-bold tabular-nums ${pctClass(r.sinceChangePct)}`}>
                      {r.sinceChangePct > 0 ? "+" : ""}
                      {r.sinceChangePct.toFixed(2)}%
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-left text-fg2">
                      <span className="num">{r.surgeDate.slice(5)}</span>
                      {r.surgeCount >= 2 && (
                        <span
                          className="ml-1 rounded-[2px] bg-up-soft px-1 text-[10px] leading-4 text-up"
                          title={`窗口内爆量 ${r.surgeCount} 次（峰值量比 ${r.maxVolumeRatio.toFixed(1)}）`}
                        >
                          {r.surgeCount}次
                        </span>
                      )}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-bold tabular-nums text-warn">
                      {r.surgeVolumeRatio.toFixed(1)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">
                      {r.surgeIsLimitUp ? (
                        <span className="rounded-[2px] bg-up-soft px-1 text-[10px] leading-4 text-up">涨停</span>
                      ) : r.surgeIsBroken ? (
                        <span className="rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-dim">炸板</span>
                      ) : (
                        <span className={`num text-[11px] ${pctClass(r.surgeDayChangePct)}`}>
                          {r.surgeDayChangePct > 0 ? "+" : ""}
                          {r.surgeDayChangePct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">
                      <span className={`rounded-[2px] px-1 text-[10px] leading-4 ${positionChip(r.position)}`}>
                        {POSITION_LABEL[r.position]}
                      </span>
                    </td>
                    <td
                      className="max-w-[150px] truncate px-2 py-1.5 text-muted-foreground"
                      title={r.themes.join("、") || r.industry || ""}
                    >
                      {r.themes.length > 0 ? r.themes.slice(0, 2).join("·") : (r.industry ?? "—")}
                    </td>
                    <td className="max-w-[90px] truncate px-3.5 py-1.5 text-right text-dim2" title={r.industry ?? ""}>
                      {r.industry ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">口径说明</div>
        <p>
          <b className="text-fg2">爆量</b>：量比 = 当日成交量 ÷ 前 20 个交易日均量 ≥ 2.0（与爆量榜/涨停池同一口径），
          统计范围为最近 {data?.windowDates.length ?? 5} 个有行情数据的交易日，来源于每日采集入库的爆量榜（历史按日保留）。
          <b className="text-fg2">不跌</b>：以该股窗口内最近一次爆量日为基准日，当前收盘价 ≥ 基准日收盘价（0 容差）；
          跌破基准日收盘的标的被剔除（本轮剔除 {data?.excludedCount ?? 0} 家）。
          语义：放量意味着筹码大量换手，其后股价不跌说明抛压被有效承接，属强势观察信号；「多次爆量」为资金反复介入的加强信号。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">当前价来源</b>：优先实时快照（腾讯全市场行情，缓存 5 分钟）；数据源不可用时回退库内最新收盘，
          页面头部会标注来源。位置划分沿用爆量榜口径：距 60 日最高点回撤 ≤10% 为高位、≥30% 为低位（基于基准日收盘）。
          爆量数据自该功能上线日起逐日积累，历史窗口越满，本榜参考价值越高。
        </p>
      </section>
    </div>
  );
}
