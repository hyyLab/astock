"use client";

// 情绪面板：温度计 + 阶段 + 晋级率 + 核心情绪指标
import { fmtPct, fmtRate, stageColor } from "./format";
import type { ReviewBundle } from "./api";

function Gauge({ temperature, stage }: { temperature: number; stage: string }) {
  const color = stageColor(stage);
  // 半圆弧：180度，从 -90 到 +90
  const angle = Math.max(0, Math.min(100, temperature)) * 1.8;
  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative h-[74px] w-[148px] overflow-hidden"
        role="img"
        aria-label={`情绪温度 ${temperature}，阶段 ${stage}`}
      >
        <div
          className="absolute left-1/2 top-full h-[148px] w-[148px] -translate-x-1/2 -translate-y-full rounded-full"
          style={{
            background: `conic-gradient(from 270deg, ${color} ${angle}deg, #1c2536 ${angle}deg, #1c2536 180deg, transparent 180deg)`,
            mask: "radial-gradient(circle, transparent 58%, #000 60%)",
            WebkitMask: "radial-gradient(circle, transparent 58%, #000 60%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 text-center">
          <span className="font-mono text-[30px] font-bold leading-none tabular-nums" style={{ color }}>
            {temperature.toFixed(1)}
          </span>
        </div>
      </div>
      <span
        className="mt-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
        style={{ color, borderColor: `${color}55`, background: `${color}18` }}
      >
        {stage}
      </span>
    </div>
  );
}

function MiniStat({ label, value, cls = "text-slate-200" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[#1c2536] bg-[#0c1220] px-2.5 py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`font-mono text-sm font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

export default function SentimentPanel({ bundle }: { bundle: ReviewBundle }) {
  const s = bundle.sentiment;
  return (
    <section aria-label="情绪指标" className="flex h-full flex-col rounded-xl border border-[#1c2536] bg-[#0f1522] p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">市场情绪</h2>
        <span className="text-[10px] text-slate-600">自有透明算法 · 第一版</span>
      </div>

      <div className="flex justify-center py-1">
        <Gauge temperature={s.temperature} stage={s.stage} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <MiniStat label="最高连板" value={`${s.highestBoard} 板`} cls="text-[#ff8f3d]" />
        <MiniStat
          label="昨日涨停表现"
          value={s.yesterdayLimitAvg != null ? fmtPct(s.yesterdayLimitAvg) : "—"}
          cls={s.yesterdayLimitAvg != null && s.yesterdayLimitAvg > 0 ? "text-[#f6465d]" : "text-[#0ecb81]"}
        />
        <MiniStat label="封板率" value={fmtRate(s.sealRate)} />
        <MiniStat label="炸板率" value={fmtRate(s.brokenRate)} cls="text-amber-400" />
      </div>

      {s.promotions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-slate-500">连板晋级率</div>
          <div className="flex flex-wrap gap-1.5">
            {s.promotions.map((p) => (
              <span
                key={p.level}
                title={`${p.promoted}/${p.total}`}
                className={`rounded-md border px-2 py-1 font-mono text-[11px] tabular-nums ${
                  p.rate >= 0.5
                    ? "border-[#f6465d]/40 bg-[#f6465d]/12 text-[#ff8a97]"
                    : p.rate >= 0.25
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                      : "border-[#1c2536] bg-[#0c1220] text-slate-400"
                }`}
              >
                {p.level} {(p.rate * 100).toFixed(0)}%
                <span className="ml-1 text-slate-500">
                  {p.promoted}/{p.total}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {s.yesterdayCount != null && (
        <div className="mt-auto pt-3 text-[11px] text-slate-600">
          昨日涨停 {s.yesterdayCount} 只 · 今日红盘 {s.yesterdayRedCount ?? "—"} 只 · 红盘率{" "}
          {s.yesterdayCount > 0 && s.yesterdayRedCount != null
            ? `${((s.yesterdayRedCount / s.yesterdayCount) * 100).toFixed(0)}%`
            : "—"}
        </div>
      )}
    </section>
  );
}
