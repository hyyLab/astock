"use client";

// ============================================================
// 每日作战简报：情绪周期定位 + 主战法信号 + 明日应对
// 数据口径全部来自 /api/briefing，规则透明，结论可追溯
// ============================================================

import { useEffect, useState } from "react";
import { RefreshCw, FileText, Flame, TrendingUp, ListOrdered, CalendarClock, AlertTriangle, Crosshair } from "lucide-react";
import type { Briefing } from "@/lib/services/briefing";
import type { TomorrowCandidate } from "@/lib/services/candidates";

function stageColor(stage: string): string {
  if (stage === "高潮") return "bg-[#8B98A7]";
  if (stage === "升温" || stage === "回暖") return "bg-[#657384]";
  if (stage === "冰点") return "bg-dim";
  return "bg-[#46525E]"; // 退潮 / 降温
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "dim" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-dim";
  return (
    <div className="rounded bg-subtle px-2 py-1.5">
      <div className="text-[10px] text-dim">{label}</div>
      <div className={`text-[13px] font-medium ${tone ? color : ""}`}>{value}</div>
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


function CandidateRow({ c }: { c: TomorrowCandidate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded bg-subtle/50">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-subtle">
        <span className="w-20 shrink-0 truncate font-medium">
          <a href={`#/stock/${c.stockCode}`} onClick={(e) => e.stopPropagation()} className="hover:text-gold">{c.stockName}</a>
        </span>
        <span className="w-14 shrink-0 text-dim">{c.boardCount != null ? `${c.boardCount}板` : "-"}</span>
        <span className={`w-16 shrink-0 text-right ${c.changePct > 0 ? "text-up" : c.changePct < 0 ? "text-down" : "text-dim"}`}>
          {c.changePct > 0 ? "+" : ""}{c.changePct.toFixed(1)}%
        </span>
        <span className="w-10 shrink-0 text-right text-dim">{c.score}分</span>
        <span className="flex-1 truncate text-dim">{c.reasons[0]}</span>
        <span className="shrink-0 text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-border/50 px-3 py-1.5 text-[11px] leading-relaxed text-dim">
          {c.reasons.map((r, i) => (
            <div key={i}>· {r}</div>
          ))}
          <div className="mt-0.5 text-fg2">→ {c.historyNote}</div>
          {c.pullbackLevel != null && <div className="mt-0.5">回踩参考位：{c.pullbackLevel.toFixed(2)}</div>}
        </div>
      )}
    </div>
  );
}
export default function BriefingView() {
  const [data, setData] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/briefing")
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
        <RefreshCw className="h-4 w-4 animate-spin" /> 简报生成中…
      </div>
    );
  if (error || !data)
    return (
      <div className="py-20 text-center text-dim">
        加载失败：{error}
        <button onClick={load} className="ml-2 rounded border border-border px-2 py-0.5 hover:bg-subtle">重试</button>
      </div>
    );

  const delta = data.temperatureDelta;

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4 text-gold" /> 每日作战简报
        </h1>
        <p className="text-[11px] text-dim">
          {data.tradeDate} · 规则透明：每个结论都能在数据里找到出处 · 不构成投资建议
        </p>
      </div>

      {/* 情绪周期定位 */}
      <Card
        title="情绪周期定位"
        icon={<Flame className="h-3.5 w-3.5 text-warn" />}
        note={data.stageAdvice}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-semibold">{data.temperature.toFixed(1)}</span>
            <span className="text-[13px] text-dim">°</span>
          </div>
          <span className={`rounded px-2 py-0.5 text-[12px] font-medium text-white ${stageColor(data.stage)}`}>
            {data.stage}
          </span>
          {delta !== null && (
            <span className={`text-[12px] ${"text-fg2"}`}>
              较昨日 {delta > 0 ? "+" : ""}{delta.toFixed(1)}° {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}
            </span>
          )}
          {data.temperaturePrev !== null && (
            <span className="text-[11px] text-dim">昨日 {data.temperaturePrev.toFixed(1)}°</span>
          )}
        </div>
      </Card>

      {/* 近 30 日情绪温度 */}
      {data.temperatureHistory?.length > 0 && (
        <Card title="近 30 日情绪温度" icon={<Flame className="h-3.5 w-3.5 text-warn" />}>
          <div className="flex items-end gap-[3px]" style={{ height: 64 }}>
            {data.temperatureHistory.map((h) => {
              const pct = Math.max(6, Math.min(100, h.temperature));
              const color = h.temperature >= 60 ? "bg-[#8B98A7]" : h.temperature >= 40 ? "bg-[#657384]" : "bg-dim";
              return (
                <div key={h.tradeDate} className="group relative flex-1" style={{ height: "100%" }} title={`${h.tradeDate}  ${h.temperature.toFixed(1)}° ${h.stage}`}>
                  <div className={`absolute bottom-0 w-full rounded-t ${color}`} style={{ height: `${pct}%` }} />
                  <span className="absolute -top-0.5 w-full text-center text-[9px] leading-none text-dim">{h.temperature.toFixed(0)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-dim">
            <span>{data.temperatureHistory[0].tradeDate.slice(5)}</span>
            <span>≥60° 高潮 · 40-60° 升温 · &lt;40° 冰点</span>
            <span>{data.temperatureHistory[data.temperatureHistory.length - 1].tradeDate.slice(5)}</span>
          </div>
        </Card>
      )}

      {/* 市场概览 */}
      <Card title="市场概览" icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}>
        <div className="mb-2 flex flex-wrap gap-2">
          {data.indices.map((ix) => (
            <div key={ix.name} className="rounded bg-subtle px-2 py-1.5">
              <span className="text-[11px] text-dim">{ix.name} </span>
              <span className={`text-[13px] font-medium ${ix.changePct > 0 ? "text-up" : ix.changePct < 0 ? "text-down" : ""}`}>
                {ix.close.toFixed(2)} ({ix.changePct > 0 ? "+" : ""}{ix.changePct.toFixed(2)}%)
              </span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <Stat label="成交额" value={`${data.totalAmount.toFixed(0)} 亿`} />
          <Stat label="涨停 / 跌停" value={`${data.limitUpCount} / ${data.limitDownCount}`} />
          <Stat label="炸板 / 封板率" value={`${data.brokenCount} / ${data.sealRate.toFixed(0)}%`} />
          <Stat label="最高板" value={`${data.highestBoard} 板`} />
          <Stat label="上涨 / 下跌" value={`${data.upCount} / ${data.downCount}`} />
          <Stat
            label="昨日涨停今日均涨"
            value={data.yesterdayLimitAvg === null ? "-" : `${data.yesterdayLimitAvg > 0 ? "+" : ""}${data.yesterdayLimitAvg.toFixed(2)}%`}
            tone={data.yesterdayLimitAvg === null ? undefined : data.yesterdayLimitAvg > 0 ? "up" : "down"}
          />
        </div>
      </Card>

      {/* 主战法信号 */}
      <Card
        title={`主战法 · ${data.strategyName}`}
        icon={data.strategyActive ? <Flame className="h-3.5 w-3.5 text-primary" /> : <AlertTriangle className="h-3.5 w-3.5 text-dim" />}
        note={data.signalNote}
      >
        {!data.strategyActive ? (
          <p className="text-[12px] text-dim">情绪未达 60°，今日不出手，只看不做。</p>
        ) : data.signals.length === 0 ? (
          <p className="text-[12px] text-dim">今日无 3 板以上高位票，无候选，休息。</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-dim">
                <th className="py-1 pr-2 font-normal">代码</th>
                <th className="py-1 pr-2 font-normal">名称</th>
                <th className="py-1 pr-2 font-normal">板数</th>
                <th className="py-1 pr-2 font-normal">首次封板</th>
                <th className="py-1 pr-2 font-normal text-right">今日涨跌</th>
                <th className="py-1 font-normal text-right">封成比</th>
              </tr>
            </thead>
            <tbody>
              {data.signals.map((s) => (
                <tr key={s.stockCode} className="border-b border-border/50 last:border-0">
                  <td className="py-1 pr-2">
                    <a href={`#/stock/${s.stockCode}`} className="hover:text-gold">{s.stockCode}</a>
                  </td>
                  <td className="py-1 pr-2">
                    <a href={`#/stock/${s.stockCode}`} className="hover:text-gold">{s.stockName}</a>
                    {s.isRebound && <span className="ml-1 rounded bg-subtle px-1 text-[10px] text-dim">反包</span>}
                  </td>
                  <td className="py-1 pr-2 font-medium">{s.boardCount} 板</td>
                  <td className="py-1 pr-2 text-dim">{s.firstLimitTime ?? "-"}</td>
                  <td className={`py-1 pr-2 text-right ${s.changePct > 0 ? "text-up" : s.changePct < 0 ? "text-down" : ""}`}>
                    {s.changePct > 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                  </td>
                  <td className="py-1 text-right text-dim">{s.sealRate === null ? "-" : s.sealRate.toFixed(1) + "%"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 连板梯队 */}
      <Card title="连板梯队" icon={<ListOrdered className="h-3.5 w-3.5 text-gold" />}>
        {data.ladder.length === 0 ? (
          <p className="text-[12px] text-dim">今日无连板。</p>
        ) : (
          <div className="space-y-1.5">
            {data.ladder.map((l) => (
              <div key={l.boardCount} className="flex items-baseline gap-2 text-[12px]">
                <span className="w-10 shrink-0 font-medium">{l.boardCount} 板</span>
                <span className="w-12 shrink-0 text-dim">{l.count} 只</span>
                <span className="text-dim">{l.names.join(" · ")}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 明日候选 */}
      <Card
        title="明日候选（复盘视角，非预言）"
        icon={<Crosshair className="h-3.5 w-3.5 text-warn" />}
        note="打板只做主线龙头；趋势给回踩位；跳水/首阴按历史概率决定接不接。开盘后按竞价修正，收盘数据会更新。"
      >
        {(["打板", "涨停后低吸", "辨识度回踩", "趋势", "爆量洗盘", "跳水观察"] as const).map((kind) => {
          const list = data.candidates.filter((c) => c.kind === kind);
          if (!list.length) return null;
          const kindNote: Record<string, string> = {
            打板: "主线龙头，封单质量优先",
            涨停后低吸: "涨停=活跃证明，低开 2%+ 接，高开不追",
            辨识度回踩: "前期涨停打出辨识度，缩量回踩不破位，放量转强接",
            趋势: "均线多头+资金活跃，回踩接",
            爆量洗盘: "爆量长下影不破位（会稽山模式）",
            跳水观察: "炸板/首阴，按历史概率决定接不接",
          };
          return (
            <div key={kind} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-baseline gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium text-fg2 bg-muted`}>
                  {kind}
                </span>
                <span className="text-[11px] text-dim">{kindNote[kind]} · {list.length} 只</span>
              </div>
              <div className="space-y-1">
                {list.map((c) => (
                  <CandidateRow key={c.stockCode + c.kind} c={c} />
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      {/* 明日应对 */}
      <Card title="明日应对" icon={<CalendarClock className="h-3.5 w-3.5 text-primary" />}>
        <ul className="space-y-1 text-[12px] leading-relaxed">
          {data.tomorrowPlan.map((t, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-dim">·</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}


