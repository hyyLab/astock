"use client";

// 战法验证页：用库内历史数据回测游资战法，胜率说话
// 数据口径全部透明：样本数、统计窗口直接展示，不搞黑箱

import { useEffect, useState } from "react";
import BayesStrategyView, { type BayesStrategyItem } from "@/components/lb/BayesStrategyView";
import { RefreshCw, FlaskConical, TrendingUp, Clock, Flame, Repeat, Shield, Target } from "lucide-react";

interface PromotionStat {
  level: string;
  total: number;
  n: number;
  promoted: number;
  rate: number;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}
interface FirstBoardTimeStat {
  bucket: string;
  total: number;
  n: number;
  promoted: number;
  rate: number;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}
interface ReboundStat {
  total: number;
  n: number;
  nextLimitUp: number;
  rate: number;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}
interface SentimentTempStat {
  bucket: string;
  days: number;
  n: number;
  positiveDays: number;
  positiveDayRate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  avgNextLimitAvg: number | null;
}
interface SealStrengthBucketStat {
  bucket: string;
  n: number;
  signalN: number;
  dayN: number;
  highOpenN: number;
  highOpenRate: number | null;
  highOpenDayWilson: { successes: number; trials: number; low: number; high: number } | null;
  avgNextClosePremiumPct: number | null;
  maxDrawdownPct: number | null;
  worstNextLowPct: number | null;
  conclusion: string | null;
}
interface SealStrengthBacktest {
  asOf: string;
  dayCount: number;
  signalCount: number;
  validSampleCount: number;
  missingNextBarCount: number;
  strengthDefinition: string;
  bucketMethod: string;
  metricDefinition: string;
  statisticalNote: string;
  buckets: SealStrengthBucketStat[];
}
interface SectorGroupMetrics {
  n: number;
  highOpenRate: number | null;
  highOpenWilson: { low: number; high: number } | null;
  highOpenSuccesses: number;
  avgClosePremiumPct: number | null;
  avgMaxDrawdownPct: number | null;
  conclusionReady: boolean;
}
interface SectorFirstSealBundle {
  asOf: string;
  dayCount: number;
  eventCount: number;
  firstSeal: SectorGroupMetrics;
  followers: SectorGroupMetrics;
  closePremiumSpreadPct: number | null;
  note: string;
}
interface StrategyBundle {
  asOf: string;
  dayCount: number;
  sampleCount: number;
  promotion: PromotionStat[];
  firstBoardTime: FirstBoardTimeStat[];
  rebound: ReboundStat;
  sentimentTemp: SentimentTempStat[];
  yesterdayPerf: { tradeDate: string; avgPct: number; redCount: number | null; totalCount: number | null }[];
  sealStrength: SealStrengthBacktest;
  sectorFirstSeal: SectorFirstSealBundle;
  bayes: {
    strategies: BayesStrategyItem[];
    regimes: string[];
    vpNonPositiveRegimes: string[];
    warnings: string[];
    regimeClassification: string;
    allocationMode: string;
    optimization: { targetWeights: number[]; equalWeights: number[]; converged: boolean; fallback: boolean; iterations: number; objective: number };
    scheduler: { mode: "OFF" | "SHADOW" | "ACTIVE"; weights: number[]; tradeTriggered: boolean; reviewTriggered: boolean; reason: string; fallback: boolean };
    pipelineWarnings: string[];
  };
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? "-" : (x * 100).toFixed(1) + "%";
}

function ciText(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) return "Wilson 95% CI：-";
  return "Wilson 95% CI：" + pct(lower) + "–" + pct(upper);
}

// 已经以“百分点”表达的数值（如收盘溢价、回撤），不再乘 100
function signedPct(x: number | null | undefined): string {
  return x === null || x === undefined ? "-" : (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
}

function ciRange(ci: { low: number; high: number } | null): string {
  return ci ? "Wilson 95% CI：" + pct(ci.low) + "–" + pct(ci.high) : "Wilson 95% CI：-";
}

function signTone(x: number | null | undefined): string {
  return x === null || x === undefined ? "text-dim" : x >= 0 ? "text-up" : "text-down";
}

function boardLevel(level: string): number {
  const match = level.match(/^(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function promotionTrend(stats: PromotionStat[]): string {
  const eligible = stats.filter((item) => item.n >= 20).sort((a, b) => boardLevel(a.level) - boardLevel(b.level));
  if (eligible.length < 2) return "样本不足：至少需要两个 n≥20 的板数档位才能比较趋势";
  const nonDecreasing = eligible.every((item, index) => index === 0 || item.rate >= eligible[index - 1].rate);
  const nonIncreasing = eligible.every((item, index) => index === 0 || item.rate <= eligible[index - 1].rate);
  if (nonDecreasing && !nonIncreasing) return "在 n≥20 的可比较档位中，晋级率随板数整体上升（描述性结果）";
  if (nonIncreasing && !nonDecreasing) return "在 n≥20 的可比较档位中，晋级率随板数整体下降（描述性结果）";
  if (nonDecreasing && nonIncreasing) return "在 n≥20 的可比较档位中，各档晋级率相同";
  return "在 n≥20 的可比较档位中，晋级率未呈现稳定单调关系";
}

function highestEligible<T extends { n: number; rate: number; bucket: string }>(stats: T[]): T | null {
  const eligible = stats.filter((item) => item.n >= 20).sort((a, b) => b.rate - a.rate);
  return eligible.length >= 2 ? eligible[0] : null;
}

function describeObservedRange<T extends { n: number; bucket: string }>(stats: T[], getValue: (item: T) => number | null): string {
  const eligible = stats.filter((item) => item.n >= 20 && getValue(item) !== null);
  if (eligible.length < 2) return "样本不足：少于两个 n≥20 的档位，暂不比较";
  const sorted = [...eligible].sort((a, b) => (getValue(b) ?? -Infinity) - (getValue(a) ?? -Infinity));
  return "观测值最高为" + sorted[0].bucket + "，最低为" + sorted[sorted.length - 1].bucket + "（描述性比较，不代表统计显著）";
}

function RateBar({ rate, tone }: { rate: number; tone?: "up" | "warn" }) {
  const color = tone === "warn" ? "bg-warn" : rate >= 0.25 ? "bg-up" : rate >= 0.15 ? "bg-gold" : "bg-dim";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-subtle">
      <div className={`h-full rounded ${color}`} style={{ width: `${Math.min(100, rate * 100)}%` }} />
    </div>
  );
}

function Card({ title, icon, children, note }: { title: string; icon: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded border border-border bg-card p-3">
      <header className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">
        {icon}
        {title}
      </header>
      {children}
      {note && <p className="mt-2 text-[11px] leading-relaxed text-dim">{note}</p>}
    </section>
  );
}

export default function StrategyView() {
  const [data, setData] = useState<StrategyBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setData(j);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-dim">
        <RefreshCw className="h-4 w-4 animate-spin" /> 战法回测计算中…
      </div>
    );
  if (error || !data)
    return (
      <div className="py-20 text-center text-dim">
        加载失败：{error}
        <button onClick={load} className="ml-2 rounded border border-border px-2 py-0.5 hover:bg-subtle">重试</button>
      </div>
    );

  const bestTime = highestEligible(data.firstBoardTime);
  const promoNote = promotionTrend(data.promotion);
  const timeNote = bestTime
    ? "在 n≥20 的档位中，" + bestTime.bucket + "观察到的晋级率最高（" + pct(bestTime.rate) + "）。"
    : "样本不足：当前没有 n≥20 的封板时间档位，不作结论。";
  const sentimentNote = describeObservedRange(data.sentimentTemp, (item) => item.avgNextLimitAvg);

  return (
    <div className="space-y-3">
      {/* 标题与数据口径 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <FlaskConical className="h-4 w-4 text-gold" /> 战法验证
        </h1>
        <p className="text-[11px] text-dim">
          样本：{data.asOf} 前 {data.dayCount} 个交易日 · {data.sampleCount} 条涨停记录 · 全部为库内真实数据回测，不构成投资建议
        </p>
      </div>

      <section className="rounded border border-border bg-card p-3">
        <BayesStrategyView strategies={data.bayes.strategies} vpNonPositiveRegimes={data.bayes.vpNonPositiveRegimes} regimes={data.bayes.regimes} />
        <div className="mt-3 border-t border-border pt-2 text-[11px] text-dim">
          <div className="font-medium">联合后验与权重优化（影子模式）</div>
          <p>优化目标权重：{data.bayes.strategies.map((item, index) => `${item.name} ${(data.bayes.optimization.targetWeights[index] * 100).toFixed(1)}%`).join(" · ")}</p>
          <p>调度状态：{data.bayes.scheduler.mode} · 实际锚点权重保持等权 · {data.bayes.scheduler.reason}</p>
          {data.bayes.pipelineWarnings.map((warning) => <p key={warning}>说明：{warning}</p>)}
          {data.bayes.warnings.map((warning) => <p key={warning}>数据警告：{warning}</p>)}
        </div>
      </section>

      {/* 战法一：连板晋级率（强者恒强） */}
      <Card
        title="战法一 · 连板晋级率（强者恒强）"
        icon={<TrendingUp className="h-3.5 w-3.5 text-up" />}
        note={"口径：今天 N 连板的股票，明天晋级 N+1 板的比例。" + promoNote + "；n<20 的档位仅展示观察值，不作趋势结论；高位样本不足时已合并展示。"}
      >
        <div className="space-y-2">
          {data.promotion.map((p) => (
            <div key={p.level} className="flex items-center gap-2 text-[12px]">
              <span className="w-20 shrink-0 font-medium">{p.level}</span>
              <RateBar rate={p.rate} />
              <span className="w-28 shrink-0 text-right tabular-nums text-dim">
                {p.promoted}/{p.total} = <span className={p.rate >= 0.3 ? "text-up font-medium" : ""}>{pct(p.rate)}</span>
                <span className="block text-[10px]">n={p.n} · {ciText(p.wilsonLower, p.wilsonUpper)}</span>
                {p.n < 20 && <span className="block text-[10px]">样本不足，不作结论</span>}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* 战法二：首板封板时间 */}
      <Card
        title="战法二 · 首板封板时间分层"
        icon={<Clock className="h-3.5 w-3.5 text-gold" />}
        note={"口径：首板按首次封板时间分层，统计次日晋级 2 板的比例。" + timeNote + "不对样本量不足的档位作结论。"}
      >
        <div className="space-y-2">
          {data.firstBoardTime.filter((b) => b.n > 0).map((b) => (
            <div key={b.bucket} className="flex items-center gap-2 text-[12px]">
              <span className="w-20 shrink-0">{b.bucket}</span>
              <RateBar rate={b.rate} tone={bestTime?.bucket === b.bucket ? "up" : "warn"} />
              <span className="w-28 shrink-0 text-right tabular-nums text-dim">
                {b.promoted}/{b.total} = <span className={bestTime?.bucket === b.bucket ? "text-up font-medium" : ""}>{pct(b.rate)}</span>
                <span className="block text-[10px]">n={b.n} · {ciText(b.wilsonLower, b.wilsonUpper)}</span>
                {b.n < 20 && <span className="block text-[10px]">样本不足，不作结论</span>}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* 战法三：反包 */}
      <Card
        title="战法三 · 反包（断板后再涨停）"
        icon={<Repeat className="h-3.5 w-3.5 text-gold" />}
        note="口径：昨天涨停、今天断板、今天又涨停的「反包股」，明天再涨停的概率。反包是游资经典打法，但样本少，参考意义大于操作意义。"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold tabular-nums text-up">{pct(data.rebound.rate)}</span>
          <span className="text-[12px] text-dim">
            反包股次日再涨停 {data.rebound.nextLimitUp}/{data.rebound.total} · n={data.rebound.n}
            <span className="block text-[10px]">{ciText(data.rebound.wilsonLower, data.rebound.wilsonUpper)}</span>
          </span>
        </div>
      </Card>

      {/* 战法四：情绪温度分层 */}
      <Card
        title="战法四 · 情绪温度 → 次日打板收益"
        icon={<Flame className="h-3.5 w-3.5 text-warn" />}
        note={"口径：按当日情绪温度分层，统计次日昨日涨停股平均涨幅。正收益日比例附 Wilson 95% 区间；均值和档位比较仅作描述性观察。" + sentimentNote + "；n<20 的档位不作结论。"}
      >
        <div className="grid grid-cols-3 gap-2">
          {data.sentimentTemp.map((t) => (
            <div key={t.bucket} className="rounded border border-border bg-subtle p-2 text-center">
              <div className="text-[11px] text-dim">{t.bucket}</div>
              <div className={`text-lg font-bold tabular-nums ${(t.avgNextLimitAvg ?? 0) > 0 ? "text-up" : "text-down"}`}>
                {t.avgNextLimitAvg === null ? "-" : t.avgNextLimitAvg.toFixed(2) + "%"}
              </div>
              <div className="text-[10px] text-dim">n={t.n} 个交易日</div>
              <div className="text-[10px] text-dim">正收益日 {t.positiveDays}/{t.n} · {pct(t.positiveDayRate)}</div>
              <div className="text-[10px] text-dim">{ciText(t.wilsonLower, t.wilsonUpper)}</div>
              {t.n < 20 && <div className="text-[10px] text-dim">样本不足，不作结论</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* 战法五：封单相对强度 */}
      <Card
        title="战法五 · 封单相对强度"
        icon={<Shield className="h-3.5 w-3.5 text-up" />}
        note={"口径：T 日首板按当日封单额/流通市值等频分为 Q1–Q4，统计 T+1 高开率与收盘溢价；有效样本 " + data.sealStrength.validSampleCount + "，缺失 T+1 行情 " + data.sealStrength.missingNextBarCount + "。n<20 不写结论；Wilson 区间按交易日聚类，非个股高开率区间。"}
      >
        <div className="space-y-2">
          {data.sealStrength.buckets.map((b) => (
            <div key={b.bucket} className="rounded border border-border bg-subtle p-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="w-44 shrink-0 font-medium">{b.bucket}</span>
                <RateBar rate={b.highOpenRate ?? 0} tone={b.n >= 20 ? "up" : undefined} />
                <span className="w-24 shrink-0 text-right tabular-nums text-dim">
                  高开 {pct(b.highOpenRate)} · {b.highOpenN}/{b.n}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-dim">
                <span>信号 n={b.signalN} · 有效 n={b.n} · {b.dayN} 个交易日</span>
                <span>次日收盘溢价 <span className={signTone(b.avgNextClosePremiumPct)}>{signedPct(b.avgNextClosePremiumPct)}</span></span>
                <span>次日最低最差 {signedPct(b.worstNextLowPct)}</span>
                <span>净值最大回撤 {b.maxDrawdownPct === null ? "-" : b.maxDrawdownPct.toFixed(2) + "%"}</span>
                <span>{ciRange(b.highOpenDayWilson)}</span>
              </div>
              {b.conclusion && <div className="mt-1 text-[10px] text-up">{b.conclusion}</div>}
              {b.n < 20 && <div className="mt-1 text-[10px] text-dim">有效样本 n&lt;20，不作结论</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* 战法六：题材首封 vs 跟风 */}
      <Card
        title="战法六 · 题材首封 vs 跟风"
        icon={<Target className="h-3.5 w-3.5 text-gold" />}
        note={"口径：同一交易日同一题材中最先封板的个股为「首封」，其余有效封板时间为「跟风」；跟风先事件内平均再汇总，分析单元为 (交易日, 题材)。" + data.sectorFirstSeal.note}
      >
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "题材首封", m: data.sectorFirstSeal.firstSeal },
            { label: "同题材跟风", m: data.sectorFirstSeal.followers },
          ].map(({ label, m }) => (
            <div key={label} className="rounded border border-border bg-subtle p-2">
              <div className="text-[11px] text-dim">{label} · 事件 n={m.n}</div>
              <div className="mt-1 flex items-center gap-2">
                <RateBar rate={m.highOpenRate ?? 0} tone={label === "题材首封" ? "up" : undefined} />
                <span className="shrink-0 text-[12px] tabular-nums">高开 {pct(m.highOpenRate)}</span>
              </div>
              <div className="mt-1 text-[10px] text-dim">{ciRange(m.highOpenWilson)}</div>
              <div className="mt-1 text-[12px] tabular-nums">
                次日收盘溢价 <span className={signTone(m.avgClosePremiumPct)}>{signedPct(m.avgClosePremiumPct)}</span>
              </div>
              <div className="text-[10px] text-dim">开盘后最大回撤 {signedPct(m.avgMaxDrawdownPct)}</div>
              {!m.conclusionReady && <div className="mt-1 text-[10px] text-dim">n&lt;20，不写结论</div>}
            </div>
          ))}
        </div>
        <div className="mt-2 text-[12px] text-dim">
          首封相对跟风收盘溢价差：
          <span className={`font-medium ${signTone(data.sectorFirstSeal.closePremiumSpreadPct)}`}>
            {signedPct(data.sectorFirstSeal.closePremiumSpreadPct)}
          </span>
          （百分点，事件数 {data.sectorFirstSeal.eventCount}）
        </div>
      </Card>

      {/* 昨日涨停表现序列 */}
      <Card
        title="昨日涨停 · 今日表现（逐日）"
        icon={<TrendingUp className="h-3.5 w-3.5 text-up" />}
        note="打板生态最直接的温度计：红盘占比低于一半的日子，打板就是接飞刀。"
      >
        <div className="space-y-1">
          {data.yesterdayPerf.map((d) => (
            <div key={d.tradeDate} className="flex items-center gap-2 text-[12px]">
              <span className="w-20 shrink-0 tabular-nums text-dim">{d.tradeDate.slice(5)}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-subtle">
                <div
                  className={`h-full rounded ${d.avgPct >= 0 ? "bg-up" : "bg-down"}`}
                  style={{ width: `${Math.min(100, Math.abs(d.avgPct) * 10)}%` }}
                />
              </div>
              <span className={`w-14 shrink-0 text-right tabular-nums ${d.avgPct >= 0 ? "text-up" : "text-down"}`}>
                {d.avgPct >= 0 ? "+" : ""}{d.avgPct.toFixed(2)}%
              </span>
              <span className="w-16 shrink-0 text-right text-[11px] text-dim">
                {d.redCount !== null ? `红盘 ${d.redCount}/${d.totalCount}` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <p className="px-1 text-[11px] leading-relaxed text-dim">
        当前数据摘要：{promoNote}；{timeNote}；情绪温度分层：{sentimentNote}。统计窗口为 {data.dayCount} 个交易日；所有结论均为描述性观察，需在更长样本和样本外数据中复核。
      </p>
    </div>
  );
}
