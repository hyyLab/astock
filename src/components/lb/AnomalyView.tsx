"use client";

// 异动监控专项页（用户迭代新增）
// 对当日显性异动做多维分组：大盘共振 / 逆势拉升 / 板块效应 / 领涨龙头 / 前期爆量
// 全部指标由后端 /api/anomaly 计算，前端只做展示、筛选与排序
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AnomalyData } from "./api";
import { pctClass, fmtPct } from "./format";
import DateBar, { type DateBarBundle } from "./DateBar";
import {
  AnomalyStockTable,
  LeaderTable,
  PriorSurgeTable,
  SectorEffectTable,
} from "./anomalyTables";
import IntradayLive from "./intradayLive";
import { Activity, RefreshCw } from "lucide-react";

type Tab = "resonance" | "counter" | "sector" | "leader" | "surge";

const TABS: { key: Tab; label: string }[] = [
  { key: "resonance", label: "大盘共振" },
  { key: "counter", label: "逆势拉升" },
  { key: "sector", label: "板块效应" },
  { key: "leader", label: "领涨龙头" },
  { key: "surge", label: "前期爆量" },
];

export default function AnomalyView() {
  const [date, setDate] = useState<string | undefined>(undefined); // undefined = 最新交易日
  const [data, setData] = useState<AnomalyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("resonance");
  const autoTabDone = useRef(false);

  const load = async (d?: string) => {
    try {
      const r = await api.anomaly(d);
      setData(r);
      setError(null);
      // 首次加载：按大盘方向自动落到有内容的页签（此后尊重用户选择）
      if (!autoTabDone.current) {
        autoTabDone.current = true;
        const pct = r.index?.changePct ?? 0;
        setTab(pct > 0 ? "resonance" : pct < 0 ? "counter" : "sector");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load(date);
  }, [date]);

  // 最新日数据会随盘中采样/实时快照/收盘采集更新；实时口径 60s，收盘口径 120s；历史日期仅刷新一次
  useEffect(() => {
    const interval = data?.liveMode ? 60_000 : 120_000;
    const t = setInterval(() => {
      if (!date || date === data?.tradeDate) load(date);
    }, interval);
    return () => clearInterval(t);
  }, [date, data?.liveMode]);

  const bundle: DateBarBundle | null = useMemo(
    () =>
      data
        ? {
            tradeDate: data.tradeDate,
            latestDate: data.latestDate,
            prevDate: data.prevDate,
            nextDate: data.nextDate,
            isLatest: data.tradeDate === data.latestDate,
            today: data.today,
            liveMode: data.liveMode,
          }
        : null,
    [data]
  );

  const counts: Record<Tab, number> = data
    ? {
        resonance: data.resonanceTotal,
        counter: data.counterTotal,
        sector: data.sectorEffect.length,
        leader: data.leaders.length,
        surge: data.priorSurge.length,
      }
    : { resonance: 0, counter: 0, sector: 0, leader: 0, surge: 0 };

  const idxPct = data?.index?.changePct ?? null;
  const idxLabel = (v: number | null | undefined) =>
    v == null ? "—" : <span className={`num ${pctClass(v)}`}>{fmtPct(v)}</span>;
  // updatedAt 为 ISO（UTC），展示北京时间 HH:MM
  const updatedHhmm = data
    ? new Date(data.updatedAt).toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

  return (
    <div className="space-y-3">
      <IntradayLive />

      {bundle && <DateBar bundle={bundle} onNav={(d) => setDate(d)} />}

      <section className="panel">
        <div className="module-header">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Activity className="h-4 w-4 text-up" />
            {data?.liveMode ? "今日盘中 · 异动五维分组（实时）" : "全天复盘 · 异动五维分组"}
          </h2>
          {data && (
            <span className="num text-[11px] text-dim">
              {data.universeLabel}
              {data.liveMode ? ` · ${data.sessionLabel}` : ""} · 更新于 {updatedHhmm}
            </span>
          )}
          <button
            onClick={() => {
              setLoading(true);
              load(date);
            }}
            className="ml-auto flex items-center gap-1 text-[11px] text-link hover:underline"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3.5 py-2 text-[12px]">
            <span className="text-dim">大盘基准</span>
            <span className="whitespace-nowrap">
              <span className="text-fg2">上证</span>{" "}
              <span className="num text-foreground">{data.indices.sh?.close.toFixed(2) ?? "—"}</span> {idxLabel(data.indices.sh?.changePct)}
            </span>
            <span className="whitespace-nowrap">
              <span className="text-fg2">深成</span>{" "}
              <span className="num text-foreground">{data.indices.sz?.close.toFixed(2) ?? "—"}</span> {idxLabel(data.indices.sz?.changePct)}
            </span>
            <span className="whitespace-nowrap">
              <span className="text-fg2">创业板</span>{" "}
              <span className="num text-foreground">{data.indices.cyb?.close.toFixed(2) ?? "—"}</span> {idxLabel(data.indices.cyb?.changePct)}
            </span>
            <span className="text-dim2">
              {idxPct == null
                ? "大盘行情缺失，共振/逆势维度不可判定"
                : idxPct > 0
                  ? data.liveMode
                    ? `大盘现涨 ${fmtPct(idxPct)}（实时基准），关注同向共振与板块效应`
                    : `大盘收涨 ${fmtPct(idxPct)}，关注同向共振与板块效应`
                  : idxPct < 0
                    ? data.liveMode
                      ? `大盘现跌 ${fmtPct(idxPct)}（实时基准），关注逆势拉升方向`
                      : `大盘收跌 ${fmtPct(idxPct)}，关注逆势拉升方向`
                    : "大盘平盘，共振/逆势两组均按口径判定"}
            </span>
          </div>
        )}

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
          <div className="py-16 text-center text-[12px] text-dim">
            计算中（最新交易日需拉取全市场快照，约数秒）…
          </div>
        ) : !data ? (
          <div className="py-16 text-center text-[12px] text-dim">暂无数据</div>
        ) : tab === "resonance" ? (
          data.resonance.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-dim">
              {idxPct == null
                ? "大盘行情数据缺失，无法判定共振"
                : idxPct <= 0
                  ? data.liveMode
                    ? `当前大盘未上涨（上证 ${fmtPct(idxPct)}），不存在「跟大盘共振拉升」情形，请查看「逆势拉升」页签`
                    : `今日大盘未收涨（上证 ${fmtPct(idxPct)}），不存在「跟大盘共振拉升」情形，请查看「逆势拉升」页签`
                  : "当前无满足共振条件的个股（涨幅 ≥2% 且跑赢大盘 ≥2 个百分点）"}
            </div>
          ) : (
            <>
              {data.resonanceTotal > data.resonance.length && (
                <div className="border-b border-line px-3.5 py-1.5 text-[11px] text-dim">
                  共 {data.resonanceTotal} 只满足条件，按相对大盘强度仅展示前 {data.displayCap} 只（可点列头重排）
                </div>
              )}
              <AnomalyStockTable key="resonance" tableKey="resonance" rows={data.resonance} defaultSort="rs" />
            </>
          )
        ) : tab === "counter" ? (
          data.counter.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-dim">
              {idxPct == null
                ? "大盘行情数据缺失，无法判定逆势"
                : idxPct >= 0
                  ? data.liveMode
                    ? `当前大盘未下跌（上证 ${fmtPct(idxPct)}），不存在「逆大盘拉升」情形，请查看「大盘共振」页签`
                    : `今日大盘未收跌（上证 ${fmtPct(idxPct)}），不存在「逆大盘拉升」情形，请查看「大盘共振」页签`
                  : "当前无逆势红盘个股（上涨且跑赢大盘 ≥1 个百分点）"}
            </div>
          ) : (
            <>
              {data.counterTotal > data.counter.length && (
                <div className="border-b border-line px-3.5 py-1.5 text-[11px] text-dim">
                  共 {data.counterTotal} 只满足条件，按涨幅仅展示前 {data.displayCap} 只（可点列头重排）
                </div>
              )}
              <AnomalyStockTable key="counter" tableKey="counter" rows={data.counter} defaultSort="pct" />
            </>
          )
        ) : tab === "sector" ? (
          data.sectorEffect.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-dim">
              {data.liveMode
                ? "当前无板块效应（需主线题材/行业内封板 ≥2 家，或封板+炸板 ≥3 家）"
                : "今日无板块效应（需主线题材/行业内涨停 ≥2 家，或涨停+炸板 ≥3 家）"}
            </div>
          ) : (
            <SectorEffectTable rows={data.sectorEffect} />
          )
        ) : tab === "leader" ? (
          data.leaders.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-dim">
              {data.liveMode ? "当前暂无封板股，无法产出龙头名单" : "今日无涨停数据，无法产出龙头名单"}
            </div>
          ) : (
            <LeaderTable rows={data.leaders} />
          )
        ) : data.priorSurge.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-dim">
            近 {data.priorSurgeWindow.length} 个交易日（{data.priorSurgeWindow[0] ?? "—"} ~{" "}
            {data.priorSurgeWindow[data.priorSurgeWindow.length - 1] ?? "—"}）无爆量记录
          </div>
        ) : (
          <>
            {data.priorSurgeExcluded > 0 && (
              <div className="border-b border-line px-3.5 py-1.5 text-[11px] text-dim">
                窗口内爆量股 {data.priorSurge.length + data.priorSurgeExcluded} 家，其中{" "}
                {data.priorSurgeExcluded} 家因无当日行情无法判定（停牌/历史日期下未入任何异动池）已剔除
              </div>
            )}
            <PriorSurgeTable rows={data.priorSurge} />
          </>
        )}
      </section>

      <section className="panel px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">口径说明</div>
        <p>
          <b className="text-fg2">日期口径（最新一天）</b>：本页默认展示「最新一天」——交易日即为今天，
          盘中直接按实时口径计算并分钟级更新，<b className="text-fg2">无需等收盘</b>；收盘采集（工作日
          15:35）落定后自动切换为今天的收盘口径。徽章含义：「今日 · 盘中」= 今天实时口径；
          「今日」= 今天收盘口径；「最新」= 最近一个已有收盘数据的交易日（非交易日/盘前）；
          「历史复盘」= 更早日期的回放。日历中带红框的「今天」也可直接选中。
        </p>
        <p>
          <b className="text-fg2">盘中实时异动</b>：调度器在交易时段（工作日 09:20–11:36 ∪ 12:55–15:06）每 2 分钟
          采样全市场快照与三大指数（交易日自校验：指数行情时间戳非今日自动跳过），仅保留有异动价值的股票
          （|涨幅|≥1% 或 量比≥1.5 或 触板附近 或 近 5 日爆量股），采样表保留最近 3 个交易日。
          <b className="text-fg2">拉升/跳水</b>：10 分钟窗口涨幅 ≥2% 报拉升事件（≥1.5% 进列表），同期上证 ≥+0.15% 为共振、
          ≤-0.15% 为逆势、其余独立；窗口跌幅 ≤-3% 报跳水。冷启动/新进股用交易所分时数据回补窗口基线（真实分时价，非估算）。
          <b className="text-fg2">封板/炸板</b>：涨幅达到涨停幅度（容差 0.15pp）与上一轮封板状态的转移；
          <b className="text-fg2">分时爆量</b>：腾讯实时量比 ≥3 且当日涨 ≥1%。同股同类事件 10 分钟一桶去重。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">板块联动</b>：拉升候选股按题材（近 3 日主线标签 ∪ 规则归组）∪ 行业聚合，同组 ≥3 只成块，
          领涨 = 组内窗口涨幅最大者。<b className="text-fg2">领涨龙头</b>：当前封板股按「昨日连板数+1」高度排序，
          并列最高者为市场总龙头（高亮）。<b className="text-fg2">前期爆量</b>：近 5 个交易日爆量股今日盘中状态分级
          （涨停/拉升/守住/跌破，距基准日 0 容差，与「爆量不跌」同口径）。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">异动宇宙</b>：今天（实时口径）为腾讯全市场快照（约 4600 只，封板/炸板/跌停/爆量
          为盘中实时标记：封板 = 实时涨幅达涨停幅度，炸板 = 曾封板/触板但当前未封，爆量 = 实时量比 ≥2）；
          收盘/历史日期仅能回放当日显性异动池（涨停/炸板/跌停/爆量四池并集，即页面头部所示范围），未入池的温和波动无法回溯。
          <b className="text-fg2">大盘基准</b>：上证指数涨跌幅（今天实时口径为实时行情，收盘/历史口径读每日市场表）。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">大盘共振</b>：大盘上涨时，个股涨幅 ≥2% 且跑赢大盘 ≥2 个百分点（相对强度 = 个股涨幅 − 上证涨幅），
          按相对强度降序。<b className="text-fg2">逆势拉升</b>：大盘下跌时，个股上涨且跑赢大盘 ≥1 个百分点，按涨幅降序。
          两组互斥于大盘方向：涨时看共振、跌时看逆势（今天以实时方向为准，收盘后以收盘方向为准），
          页签计数即满足条件的全部家数（超出上限仅展示前 150）。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">板块效应</b>：主线题材（规则归组、可跨行业）/ 行业细分当日涨停（实时口径为封板） ≥2 家，
          或涨停+炸板 ≥3 家，按强度分排序（实时口径强度分 = 封板家数×10 + 连板股数×5 + 最高板×3 + 炸板家数），
          行可展开成分明细（含连板数与当日涨幅）。<b className="text-fg2">领涨龙头</b>：
          市场最高连板股（空间龙头）+ 有板块效应主线题材的龙头（规则：最高板 → 首封最早 → 成交额最大）。
        </p>
        <p className="mt-1.5">
          <b className="text-fg2">前期爆量</b>：近 5 个交易日内爆量（量比 = 当日成交量 ÷ 前 20 日均量 ≥2，与爆量榜同一口径）的个股，
          基准日 = 窗口内最近一次爆量日；状态分级：今日涨停 / 今日拉升（涨幅 ≥2%）/ 守住不跌（距基准日 ≥0，与「爆量不跌」同口径）/
          跌破基准。放量说明有大资金进出，其后的方向选择是承接强度的直接证据。历史日期下未入任何异动池的个股无当日行情、无法判定（页内标注剔除家数）。
          全部指标后端计算、阈值透明；仅供复盘研究，不构成投资建议。
        </p>
      </section>
    </div>
  );
}
