"use client";

// 战法验证页：用库内历史数据回测游资战法，胜率说话
// 数据口径全部透明：样本数、统计窗口直接展示，不搞黑箱

import { useEffect, useState } from "react";
import { RefreshCw, FlaskConical, TrendingUp, Clock, Flame, Repeat } from "lucide-react";

interface PromotionStat {
  level: string;
  total: number;
  promoted: number;
  rate: number;
}
interface FirstBoardTimeStat {
  bucket: string;
  total: number;
  promoted: number;
  rate: number;
}
interface ReboundStat {
  total: number;
  nextLimitUp: number;
  rate: number;
}
interface SentimentTempStat {
  bucket: string;
  days: number;
  avgNextLimitAvg: number | null;
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
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? "-" : (x * 100).toFixed(1) + "%";
}

function RateBar({ rate, tone }: { rate: number; tone?: "up" | "warn" }) {
  const color = tone === "warn" ? "bg-dim" : rate >= 0.25 ? "bg-[#8B98A7]" : rate >= 0.15 ? "bg-[#657384]" : "bg-dim";
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

  const bestTime = [...data.firstBoardTime].sort((a, b) => b.rate - a.rate)[0];
  const strongPromo = data.promotion.filter((p) => p.level !== "1进2");

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

      {/* 战法一：连板晋级率（强者恒强） */}
      <Card
        title="战法一 · 连板晋级率（强者恒强）"
        icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}
        note="口径：今天 N 连板的股票，明天晋级 N+1 板的比例。板数越高晋级率越高 → 妖股行情里「敢上高位」有统计支撑，但注意幸存者偏差：能走到高位的本身就是少数。"
      >
        <div className="space-y-2">
          {data.promotion.map((p) => (
            <div key={p.level} className="flex items-center gap-2 text-[12px]">
              <span className="w-12 shrink-0 font-medium">{p.level}</span>
              <RateBar rate={p.rate} />
              <span className="w-28 shrink-0 text-right tabular-nums text-dim">
                {p.promoted}/{p.total} = <span className={p.rate >= 0.3 ? "text-up font-medium" : ""}>{pct(p.rate)}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* 战法二：首板封板时间 */}
      <Card
        title="战法二 · 首板封板时间分层"
        icon={<Clock className="h-3.5 w-3.5 text-gold" />}
        note={`口径：首板（今天第一个涨停）按首次封板时间分层，统计次日晋级 2 板的比例。当前结论：${bestTime.bucket}封板的首板晋级率最高（${pct(bestTime.rate)}）——早盘板是主力资金态度，尾盘板多为偷袭。`}
      >
        <div className="space-y-2">
          {data.firstBoardTime.map((b) => (
            <div key={b.bucket} className="flex items-center gap-2 text-[12px]">
              <span className="w-20 shrink-0">{b.bucket}</span>
              <RateBar rate={b.rate} tone={b.bucket === bestTime.bucket ? "up" : "warn"} />
              <span className="w-28 shrink-0 text-right tabular-nums text-dim">
                {b.promoted}/{b.total} = <span className={b.bucket === bestTime.bucket ? "text-up font-medium" : ""}>{pct(b.rate)}</span>
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
            反包股次日再涨停 {data.rebound.nextLimitUp}/{data.rebound.total}
          </span>
        </div>
      </Card>

      {/* 战法四：情绪温度分层 */}
      <Card
        title="战法四 · 情绪温度 → 次日打板收益"
        icon={<Flame className="h-3.5 w-3.5 text-warn" />}
        note="口径：按当日情绪温度分层，统计次日「昨日涨停股平均涨幅」（即无脑打板次日卖出的平均收益）。温度越高打板正收益越明显 → 情绪冰点别打板。"
      >
        <div className="grid grid-cols-3 gap-2">
          {data.sentimentTemp.map((t) => (
            <div key={t.bucket} className="rounded border border-border bg-subtle p-2 text-center">
              <div className="text-[11px] text-dim">{t.bucket}</div>
              <div className={`text-lg font-bold tabular-nums ${(t.avgNextLimitAvg ?? 0) > 0 ? "text-up" : "text-down"}`}>
                {t.avgNextLimitAvg === null ? "-" : t.avgNextLimitAvg.toFixed(2) + "%"}
              </div>
              <div className="text-[10px] text-dim">{t.days} 个交易日</div>
            </div>
          ))}
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

      {strongPromo.length > 0 && (
        <p className="px-1 text-[11px] leading-relaxed text-dim">
          一句话总结：高位晋级率 &gt; 低位（强者恒强）、早盘首板 &gt; 尾盘首板（时间即态度）、温度高时打板 &gt; 冰点打板（情绪即仓位）。
          样本只有 {data.dayCount} 个交易日，等采集跑满一个季度再来验证一轮。
        </p>
      )}
    </div>
  );
}
