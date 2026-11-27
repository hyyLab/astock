"use client";

// 盘中实时异动模块（异动监控页顶部）
// 数据源：/api/intraday（调度器每 2 分钟采样落库 → 30 秒缓存聚合）
// 前端只做展示/筛选/排序：事件时间轴 + 快速拉升(共振/逆势/独立) + 板块联动
//   + 领涨龙头 + 前期爆量 + 跳水预警；30 秒自动刷新
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Radio, RefreshCw } from "lucide-react";
import { api, type IntradayData, type IntradayEventKind, type IntradaySurgeRow } from "./api";
import { pctClass, fmtPct, fmtYi, fmtNum } from "./format";

const KIND_META: Record<IntradayEventKind, { label: string; cls: string }> = {
  surge_resonance: { label: "共振拉升", cls: "bg-muted text-fg2" },
  surge_counter: { label: "逆势拉升", cls: "bg-link-soft-bg text-link-strong" },
  surge: { label: "快速拉升", cls: "bg-muted text-fg2" },
  dive: { label: "快速跳水", cls: "bg-muted text-fg2" },
  seal: { label: "封板", cls: "bg-muted text-fg2" },
  unseal: { label: "炸板", cls: "bg-warn-soft text-warn-strong" },
  volume: { label: "分时爆量", cls: "bg-warn-soft text-warn-strong" },
};

const SURGE_TYPE_META = {
  resonance: { label: "共振", cls: "bg-muted text-fg2" },
  counter: { label: "逆势", cls: "bg-link-soft-bg text-link-strong" },
  independent: { label: "独立", cls: "bg-muted text-dim" },
} as const;

const PREV_STATUS_META = {
  limitup: { label: "涨停", cls: "bg-muted text-fg2" },
  surging: { label: "拉升", cls: "bg-muted text-fg2" },
  holding: { label: "守住", cls: "bg-muted text-muted-foreground" },
  floor_broken: { label: "跌破", cls: "bg-muted text-fg2" },
} as const;

type Tab = "feed" | "surge" | "sector" | "leader" | "prev" | "dive";

export default function IntradayLive() {
  const [data, setData] = useState<IntradayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("feed");
  const [surgeFilter, setSurgeFilter] = useState<"all" | "resonance" | "counter" | "independent">("all");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.intraday();
      setData(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const isTrading = data?.session.isTrading ?? false;

  const counts: Record<Tab, number> = data
    ? {
        feed: data.eventCount,
        surge: data.surgeTotal,
        sector: data.sectors.length,
        leader: data.leaders.length,
        prev: data.prevVolume.length,
        dive: data.dives.length,
      }
    : { feed: 0, surge: 0, sector: 0, leader: 0, prev: 0, dive: 0 };

  const TABS: { key: Tab; label: string }[] = [
    { key: "feed", label: "异动时间轴" },
    { key: "surge", label: "快速拉升" },
    { key: "sector", label: "板块联动" },
    { key: "leader", label: "领涨龙头" },
    { key: "prev", label: "前期爆量" },
    { key: "dive", label: "跳水预警" },
  ];

  return (
    <section className="panel">
      {/* 头部 */}
      <div className="module-header">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Radio className="h-4 w-4 text-primary" /> 盘中实时异动
        </h2>
        {data?.hasData && (
          <span className="flex items-center gap-2 text-[11px] text-dim">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${isTrading ? "animate-pulse bg-primary" : "bg-flat"}`}
              title={isTrading ? "交易时段，每 2 分钟自动采样" : "非交易时段，展示最近交易日记录"}
            />
            {data.session.label}
            {data.pollTs && (
              <span className="num">
                · {data.tradeDate} {data.pollTs} 采样（第 {data.pollCount} 轮）
              </span>
            )}
          </span>
        )}
        <button
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1 text-[11px] text-link hover:underline"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 刷新
          <span className="text-dim2">· 30s 自动</span>
        </button>
      </div>

      {error ? (
        <div className="py-12 text-center text-sm text-dim">{error}</div>
      ) : loading && !data ? (
        <div className="py-12 text-center text-[12px] text-dim">读取盘中采样…</div>
      ) : !data || !data.hasData ? (
        <div className="px-3.5 py-12 text-center text-[12px] leading-relaxed text-dim">
          暂无盘中采样数据。交易时段（工作日 09:20–11:36 / 12:55–15:06）调度器每 2 分钟自动采样，
          收盘后保留最近 3 个交易日回放。可先手动触发：
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">bun scripts/intraday-poll.ts --force</code>
        </div>
      ) : (
        <>
          {/* 实时状态条 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3.5 py-2 text-[12px]">
            {(
              [
                ["上证", data.indices.sh],
                ["深成", data.indices.sz],
                ["创业板", data.indices.cyb],
              ] as const
            ).map(([label, q]) =>
              q ? (
                <span key={label} className="whitespace-nowrap">
                  <span className="text-dim">{label}</span>{" "}
                  <span className="num text-foreground">{q.close.toFixed(2)}</span>{" "}
                  <span className={`num font-medium ${pctClass(q.changePct)}`}>{fmtPct(q.changePct)}</span>
                  {q.pct10m != null && (
                    <span className={`num ml-1 text-[10px] ${pctClass(q.pct10m)}`} title="10 分钟窗口涨跌">
                      （10分钟 {fmtPct(q.pct10m)}）
                    </span>
                  )}
                </span>
              ) : null
            )}
            <span className="whitespace-nowrap text-dim2">
              扫描 <span className="num text-fg2">{fmtNum(data.universeSize)}</span> · 封板{" "}
              <span className="num text-up">{fmtNum(data.sealedCount)}</span> · 异动事件{" "}
              <span className="num text-warn-strong">{fmtNum(data.eventCount)}</span>
            </span>
            {data.indexWindow10m != null && (
              <span className="whitespace-nowrap text-dim2">
                大盘10分钟窗口{" "}
                <span className={`num font-medium ${pctClass(data.indexWindow10m)}`}>
                  {fmtPct(data.indexWindow10m)}
                </span>
                {Math.abs(data.indexWindow10m) < 0.15
                  ? "（走平，拉升按独立分型）"
                  : data.indexWindow10m > 0
                    ? "（上行，拉升多为共振）"
                    : "（下行，关注逆势拉升）"}
              </span>
            )}
          </div>

          {/* 页签 */}
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3.5 py-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-[3px] px-2 py-1 text-[12px] transition-colors ${
                  tab === t.key ? "bg-sidebar-accent font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
                <span className="num ml-1 text-[10px] text-dim2">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {tab === "feed" && <EventFeed data={data} />}
          {tab === "surge" && (
            <SurgeTable data={data} filter={surgeFilter} onFilter={setSurgeFilter} />
          )}
          {tab === "sector" && <SectorBlocks data={data} />}
          {tab === "leader" && <LeaderTable data={data} />}
          {tab === "prev" && <PrevVolumeTable data={data} />}
          {tab === "dive" && <DiveTable data={data} />}
        </>
      )}
    </section>
  );
}

// ---------- 异动时间轴（事件流，最新在前） ----------

function EventFeed({ data }: { data: IntradayData }) {
  if (data.events.length === 0) {
    return (
      <div className="py-12 text-center text-[12px] text-dim">
        {data.session.isTrading
          ? "本交易日暂无异动事件（阈值：10分钟拉升≥2% / 跳水≤-3% / 封板炸板 / 量比≥3 且涨≥1%）"
          : "该交易日无异动事件记录"}
      </div>
    );
  }
  return (
    <div className="lb-scroll max-h-[520px] overflow-y-auto">
      {data.events.map((ev, i) => {
        const meta = KIND_META[ev.kind];
        return (
          <div
            key={`${ev.ts}-${ev.stockCode}-${ev.kind}-${i}`}
            onClick={() => (location.hash = `#/stock/${ev.stockCode}`)}
            className="flex cursor-pointer items-center gap-2 border-b border-line px-3.5 py-1.5 text-[12px] transition-colors last:border-0 hover:bg-hover"
          >
            <span className="num w-10 shrink-0 text-dim2">{ev.ts}</span>
            <span className={`w-[64px] shrink-0 rounded-[2px] px-1 py-0.5 text-center text-[10px] leading-4 ${meta.cls}`}>
              {meta.label}
            </span>
            <span className="w-[86px] shrink-0 truncate font-medium text-foreground">{ev.stockName}</span>
            <span className="num w-[52px] shrink-0 text-right tabular-nums text-foreground">{ev.price.toFixed(2)}</span>
            <span className={`num w-[58px] shrink-0 text-right font-medium tabular-nums ${pctClass(ev.changePct)}`}>
              {fmtPct(ev.changePct)}
            </span>
            <span className="hidden w-[76px] shrink-0 text-right sm:inline" title="10分钟窗口涨幅">
              {ev.windowPct != null ? (
                <span className={`num ${pctClass(ev.windowPct)}`}>10分钟 {fmtPct(ev.windowPct)}</span>
              ) : (
                <span className="text-dim2">—</span>
              )}
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-right text-[11px] text-dim2 md:inline">
              {ev.themes.slice(0, 3).join(" · ")}
              {ev.themes.length > 3 ? " …" : ""}
            </span>
          </div>
        );
      })}
      {data.eventCount > data.events.length && (
        <div className="px-3.5 py-1.5 text-center text-[11px] text-dim2">
          仅展示最新 {data.events.length} 条（当日共 {data.eventCount} 条事件）
        </div>
      )}
    </div>
  );
}

// ---------- 快速拉升（共振 / 逆势 / 独立 分型） ----------

function SurgeTable({
  data,
  filter,
  onFilter,
}: {
  data: IntradayData;
  filter: "all" | "resonance" | "counter" | "independent";
  onFilter: (f: "all" | "resonance" | "counter" | "independent") => void;
}) {
  const byType = {
    resonance: data.surges.filter((s) => s.surgeType === "resonance").length,
    counter: data.surges.filter((s) => s.surgeType === "counter").length,
    independent: data.surges.filter((s) => s.surgeType === "independent").length,
  };
  const rows = (filter === "all" ? data.surges : data.surges.filter((s) => s.surgeType === filter)).slice(0, 150);
  if (data.surges.length === 0) {
    return (
      <div className="py-12 text-center text-[12px] text-dim">
        最近采样轮无 10 分钟窗口涨幅 ≥1.5% 的个股（拉升事件阈值 ≥2%，见时间轴）
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3.5 py-2">
        {(
          [
            ["all", `全部 ${data.surges.length}`],
            ["resonance", `共振 ${byType.resonance}`],
            ["counter", `逆势 ${byType.counter}`],
            ["independent", `独立 ${byType.independent}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onFilter(key)}
            className={`rounded-[3px] px-2 py-0.5 text-[11px] transition-colors ${
              filter === key ? "bg-sidebar-accent font-medium text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-dim2">
          窗口 = 最近采样 vs 10 分钟前（回退 5 分钟）· 大盘同期 {" "}
          {data.indexWindow10m != null ? fmtPct(data.indexWindow10m) : "—"}
        </span>
      </div>
      <div className="lb-scroll overflow-x-auto">
        <table className="w-full min-w-[900px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-dim">
              <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
              <th className="px-2 py-1.5 text-center font-normal">分型</th>
              <th className="px-2 py-1.5 text-right font-normal">现价 / 今日</th>
              <th className="px-2 py-1.5 text-right font-normal">窗口涨幅★</th>
              <th className="px-2 py-1.5 text-right font-normal">相对大盘</th>
              <th className="px-2 py-1.5 text-right font-normal">10分钟前</th>
              <th className="px-2 py-1.5 text-right font-normal">30分钟前</th>
              <th className="px-2 py-1.5 text-right font-normal">量比</th>
              <th className="px-2 py-1.5 text-right font-normal">换手%</th>
              <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
              <th className="px-3.5 py-1.5 text-left font-normal">主线题材</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: IntradaySurgeRow) => {
              const tm = SURGE_TYPE_META[r.surgeType];
              return (
                <tr
                  key={r.stockCode}
                  onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
                  className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
                >
                  <td className="whitespace-nowrap px-3.5 py-1.5">
                    <span className="font-medium text-foreground">{r.stockName}</span>
                    <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
                    {r.isSealed && (
                      <span className="ml-1 rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-fg2">封板</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`rounded-[2px] px-1 text-[10px] leading-4 ${tm.cls}`}>{tm.label}</span>
                  </td>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    <span className="text-foreground">{r.price.toFixed(2)}</span>
                    <span className={`ml-1.5 font-medium ${pctClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
                  </td>
                  <td className={`num px-2 py-1.5 text-right font-bold tabular-nums ${pctClass(r.windowPct)}`}>
                    {fmtPct(r.windowPct)}
                    <span className="ml-0.5 text-[10px] font-normal text-dim2">{r.windowMinutes}分</span>
                  </td>
                  <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(r.rsPct10m)}`}>
                    {fmtPct(r.rsPct10m)}
                  </td>
                  <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(r.pct10m)}`}>
                    {fmtPct(r.pct10m)}
                  </td>
                  <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(r.pct30m)}`}>
                    {fmtPct(r.pct30m)}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                    {r.volumeRatio != null ? r.volumeRatio.toFixed(2) : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                    {r.turnoverRate != null ? r.turnoverRate.toFixed(1) : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{fmtYi(r.amount)}</td>
                  <td className="max-w-[180px] truncate px-3.5 py-1.5 text-[11px] text-dim2">
                    {r.themes.slice(0, 3).join(" · ") || r.industry || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- 板块联动（拉升候选按题材/行业聚合，≥3 只成块） ----------

function SectorBlocks({ data }: { data: IntradayData }) {
  const [open, setOpen] = useState<string | null>(null);
  if (data.sectors.length === 0) {
    return (
      <div className="py-12 text-center text-[12px] text-dim">
        无板块联动（需同题材/行业内 ≥3 只个股 10 分钟窗口涨幅 ≥1.5%）
      </div>
    );
  }
  return (
    <div className="lb-scroll max-h-[520px] overflow-y-auto">
      {data.sectors.map((s) => {
        const isOpen = open === `${s.kind}:${s.name}`;
        return (
          <div key={`${s.kind}:${s.name}`} className="border-b border-line last:border-0">
            <div
              onClick={() => setOpen(isOpen ? null : `${s.kind}:${s.name}`)}
              className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] transition-colors hover:bg-hover"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-dim2 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
              <span className="font-medium text-foreground">{s.name}</span>
              <span className="rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-dim">
                {s.kind === "theme" ? "主线" : "行业"}
              </span>
              <span className="num text-dim2">{s.memberCount} 只联动</span>
              <span className={`num font-medium ${pctClass(s.avgWindow)}`}>均值 {fmtPct(s.avgWindow)}</span>
              <span className="ml-auto text-[11px] text-dim2">
                领涨 <span className="font-medium text-fg2">{s.leaderName}</span>
              </span>
            </div>
            {isOpen && (
              <div className="flex flex-wrap gap-1.5 border-t border-line bg-muted/40 px-9 py-2">
                {s.members.map((m) => (
                  <button
                    key={m.stockCode}
                    onClick={(e) => {
                      e.stopPropagation();
                      location.hash = `#/stock/${m.stockCode}`;
                    }}
                    className="rounded-[3px] border border-line bg-card px-1.5 py-0.5 text-[11px] transition-colors hover:bg-hover"
                    title={`${m.stockCode}${m.isSealed ? " · 封板" : ""}${m.themes.length ? ` · ${m.themes.join("/")}` : ""}`}
                  >
                    <span className={m.isSealed ? "font-medium text-fg2" : "text-fg2"}>{m.stockName}</span>
                    <span className={`num ml-1 ${pctClass(m.windowPct)}`}>{fmtPct(m.windowPct)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- 领涨龙头（封板股按板数高度，市场最高板高亮） ----------

function LeaderTable({ data }: { data: IntradayData }) {
  const marketCodes = new Set(data.marketLeaders.map((l) => l.stockCode));
  if (data.leaders.length === 0) {
    return (
      <div className="py-12 text-center text-[12px] text-dim">当前无封板个股（封板 = 涨幅达到涨停幅度）</div>
    );
  }
  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[860px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">板数</th>
            <th className="px-2 py-1.5 text-left font-normal">股票</th>
            <th className="px-2 py-1.5 text-right font-normal">现价 / 涨幅</th>
            <th className="px-2 py-1.5 text-right font-normal">首次封板</th>
            <th className="px-2 py-1.5 text-right font-normal">炸板次数</th>
            <th className="px-2 py-1.5 text-right font-normal">量比</th>
            <th className="px-2 py-1.5 text-right font-normal">换手%</th>
            <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
            <th className="px-2 py-1.5 text-right font-normal">流通市值(亿)</th>
            <th className="px-3.5 py-1.5 text-left font-normal">主线题材</th>
          </tr>
        </thead>
        <tbody>
          {data.leaders.map((l) => (
            <tr
              key={l.stockCode}
              onClick={() => (location.hash = `#/stock/${l.stockCode}`)}
              className={`cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover ${
                marketCodes.has(l.stockCode) ? "bg-sidebar-accent" : ""
              }`}
            >
              <td className="px-3.5 py-1.5">
                <span
                  className={`rounded-[2px] px-1.5 py-0.5 text-[11px] font-semibold ${
                    l.boardNow >= 3
                      ? "bg-warn-soft text-warn-strong"
                      : l.boardNow === 2
                        ? "bg-muted text-fg2"
                        : "bg-muted text-muted-foreground"
                  }`}
                  title={`昨日 ${l.boardYesterday} 板`}
                >
                  {l.boardNow}板
                </span>
                {marketCodes.has(l.stockCode) && (
                  <span className="ml-1 rounded-[2px] bg-muted px-1 text-[10px] leading-4 text-fg2">市场最高</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <span className="font-medium text-foreground">{l.stockName}</span>
                <span className="num ml-1.5 text-[11px] text-dim2">{l.stockCode}</span>
              </td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                <span className="text-foreground">{l.price.toFixed(2)}</span>
                <span className={`ml-1.5 font-medium ${pctClass(l.changePct)}`}>{fmtPct(l.changePct)}</span>
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{l.firstSealTs ?? "—"}</td>
              <td className={`num px-2 py-1.5 text-right tabular-nums ${l.unsealCount > 0 ? "text-warn-strong" : "text-fg2"}`}>
                {l.unsealCount}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {l.volumeRatio != null ? l.volumeRatio.toFixed(2) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {l.turnoverRate != null ? l.turnoverRate.toFixed(1) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{fmtYi(l.amount)}</td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-dim">{fmtYi(l.floatMarketCap)}</td>
              <td className="max-w-[180px] truncate px-3.5 py-1.5 text-[11px] text-dim2">
                {l.themes.slice(0, 3).join(" · ") || l.industry || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 前期爆量（近 5 个交易日爆量股 · 今日盘中状态） ----------

function PrevVolumeTable({ data }: { data: IntradayData }) {
  if (data.prevVolume.length === 0) {
    return <div className="py-12 text-center text-[12px] text-dim">近 5 个交易日无爆量记录，或爆量股未进入当前扫描宇宙</div>;
  }
  const cnt = data.prevVolume.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="lb-scroll max-h-[560px] overflow-y-auto">
      <div className="sticky top-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line bg-card px-3.5 py-1.5 text-[11px] text-dim2">
        <span>窗口：近 5 个交易日爆量（量比 ≥2，20 日口径）</span>
        <span>状态：涨停 {cnt.limitup ?? 0} · 拉升 {cnt.surging ?? 0} · 守住 {cnt.holding ?? 0} · 跌破 {cnt.floor_broken ?? 0}</span>
      </div>
      <table className="w-full min-w-[880px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
            <th className="px-2 py-1.5 text-center font-normal">状态</th>
            <th className="px-2 py-1.5 text-right font-normal">现价 / 今日</th>
            <th className="px-2 py-1.5 text-right font-normal">距爆量日★</th>
            <th className="px-2 py-1.5 text-right font-normal">10分钟窗口</th>
            <th className="px-2 py-1.5 text-right font-normal">爆量日</th>
            <th className="px-2 py-1.5 text-right font-normal">次数</th>
            <th className="px-2 py-1.5 text-right font-normal">基准日量比</th>
            <th className="px-2 py-1.5 text-right font-normal">今日量比</th>
            <th className="px-3.5 py-1.5 text-left font-normal">主线题材</th>
          </tr>
        </thead>
        <tbody>
          {data.prevVolume.map((r) => {
            const st = PREV_STATUS_META[r.status];
            return (
              <tr
                key={r.stockCode}
                onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
                className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
              >
                <td className="whitespace-nowrap px-3.5 py-1.5">
                  <span className="font-medium text-foreground">{r.stockName}</span>
                  <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
                  {r.surgeCount > 1 && (
                    <span
                      className="num ml-1 rounded-[2px] bg-warn-soft px-1 text-[10px] leading-4 text-warn-strong"
                      title={`窗口内 ${r.surgeCount} 次爆量（峰值量比 ${r.surgeVolumeRatio.toFixed(1)}）`}
                    >
                      {r.surgeCount}次
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`rounded-[2px] px-1 text-[10px] leading-4 ${st.cls}`}>{st.label}</span>
                </td>
                <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  <span className="text-foreground">{r.currentPrice.toFixed(2)}</span>
                  <span className={`ml-1.5 font-medium ${pctClass(r.currentChangePct)}`}>{fmtPct(r.currentChangePct)}</span>
                </td>
                <td className={`num px-2 py-1.5 text-right font-bold tabular-nums ${pctClass(r.sinceChangePct)}`}>
                  {fmtPct(r.sinceChangePct)}
                </td>
                <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(r.pct10m)}`}>{fmtPct(r.pct10m)}</td>
                <td className="num px-2 py-1.5 text-right tabular-nums text-dim">{r.surgeDate.slice(5)}</td>
                <td className="num px-2 py-1.5 text-right tabular-nums text-dim">{r.surgeCount}</td>
                <td className="num px-2 py-1.5 text-right tabular-nums text-warn-strong">{r.surgeVolumeRatio.toFixed(1)}</td>
                <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                  {r.volumeRatio != null ? r.volumeRatio.toFixed(2) : "—"}
                </td>
                <td className="max-w-[160px] truncate px-3.5 py-1.5 text-[11px] text-dim2">
                  {r.themes.slice(0, 3).join(" · ") || r.industry || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 跳水预警 ----------

function DiveTable({ data }: { data: IntradayData }) {
  if (data.dives.length === 0) {
    return (
      <div className="py-12 text-center text-[12px] text-dim">
        无快速跳水个股（10 分钟窗口跌幅 ≤3%，封板股不判跳水）
      </div>
    );
  }
  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[760px] text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-dim">
            <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
            <th className="px-2 py-1.5 text-right font-normal">现价 / 今日</th>
            <th className="px-2 py-1.5 text-right font-normal">10分钟窗口★</th>
            <th className="px-2 py-1.5 text-right font-normal">5分钟窗口</th>
            <th className="px-2 py-1.5 text-right font-normal">30分钟窗口</th>
            <th className="px-2 py-1.5 text-right font-normal">量比</th>
            <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
            <th className="px-3.5 py-1.5 text-left font-normal">主线题材</th>
          </tr>
        </thead>
        <tbody>
          {data.dives.map((r) => (
            <tr
              key={r.stockCode}
              onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
              className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
            >
              <td className="whitespace-nowrap px-3.5 py-1.5">
                <span className="font-medium text-foreground">{r.stockName}</span>
                <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
                {r.touchedLimit && !r.isSealed && (
                  <span className="ml-1 rounded-[2px] bg-warn-soft px-1 text-[10px] leading-4 text-warn-strong">曾触板</span>
                )}
              </td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                <span className="text-foreground">{r.price.toFixed(2)}</span>
                <span className={`ml-1.5 font-medium ${pctClass(r.changePct)}`}>{fmtPct(r.changePct)}</span>
              </td>
              <td className={`num px-2 py-1.5 text-right font-bold tabular-nums ${pctClass(r.pct10m)}`}>{fmtPct(r.pct10m)}</td>
              <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(r.pct5m)}`}>{fmtPct(r.pct5m)}</td>
              <td className={`num px-2 py-1.5 text-right tabular-nums ${pctClass(r.pct30m)}`}>{fmtPct(r.pct30m)}</td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                {r.volumeRatio != null ? r.volumeRatio.toFixed(2) : "—"}
              </td>
              <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{fmtYi(r.amount)}</td>
              <td className="max-w-[180px] truncate px-3.5 py-1.5 text-[11px] text-dim2">
                {r.themes.slice(0, 3).join(" · ") || r.industry || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
