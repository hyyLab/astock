"use client";

// 情绪周期模块（需求文档·九）：温度 / 阶段 / 与昨日对比 / 五段刻度尺 / 10日温度趋势
// 分段口径与后端透明算法一致：0-20冰点 20-40修复 40-60升温 60-80高潮 80+极强
import type { ReviewBundle } from "./api";
import { fmtPct, fmtRate } from "./format";

const SEGMENTS = [
  { label: "冰点", from: 0, to: 20, color: "#52606D" },
  { label: "修复", from: 20, to: 40, color: "#657384" },
  { label: "升温", from: 40, to: 60, color: "#7A8794" },
  { label: "高潮", from: 60, to: 80, color: "#929DA8" },
  { label: "极强", from: 80, to: 100, color: "#AAB5C0" },
];

function tempPos(t: number): number {
  return Math.min(100, Math.max(0, t));
}

/** 10日温度趋势（SVG 迷你折线，克制动画） */
function TempTrend({ bundle }: { bundle: ReviewBundle }) {
  const h = bundle.history;
  if (h.length < 2) return null;
  const W = 100;
  const H = 28;
  const pad = 2;
  const pts = h.map((row, i) => {
    const x = pad + (i / (h.length - 1)) * (W - pad * 2);
    const y = H - pad - (tempPos(row.temperature) / 100) * (H - pad * 2);
    return { x, y, t: row.temperature, date: row.tradeDate };
  });
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const stageClr = "var(--primary)";

  return (
    <div className="flex items-center gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-7 w-full flex-1"
        preserveAspectRatio="none"
        role="img"
        aria-label="10日情绪温度趋势"
      >
        <polyline points={line} fill="none" stroke={stageClr} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="0.9" fill={i === pts.length - 1 ? stageClr : "var(--dim2)"} />
        ))}
      </svg>
      <span className="shrink-0 text-[10px] text-dim">
        近{h.length}日 <span className="num font-medium text-fg2">{last.t.toFixed(0)}°</span>
      </span>
    </div>
  );
}

export default function SentimentCycle({ bundle }: { bundle: ReviewBundle }) {
  const t = bundle.sentiment.temperature;
  const prevT = bundle.prevTemperature;
  const deltaT = prevT != null ? Math.round((t - prevT) * 10) / 10 : null;
  const stage = bundle.sentiment.stage;
  const clr = "var(--primary)";
  const s = bundle.sentiment;

  return (
    <section aria-label="市场情绪" className="panel">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">市场情绪</h2>
        <span className="text-[11px] text-dim">透明加权算法 · 0~100°</span>
        <span className="ml-auto flex items-baseline gap-2 text-[11px]">
          {prevT != null && <span className="num text-dim2">昨日 {prevT.toFixed(0)}°</span>}
          {deltaT != null && (
            <span className={`num font-medium tabular-nums ${"text-fg2"}`}>
              {deltaT > 0 ? "+" : ""}
              {deltaT.toFixed(1)}°
            </span>
          )}
        </span>
      </div>

      <div className="grid gap-4 px-3.5 py-3.5 md:grid-cols-[auto_1fr] md:gap-6">
        {/* 温度 + 阶段 */}
        <div className="flex items-center gap-4 md:flex-col md:items-start md:gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="num text-[34px] font-bold leading-none tabular-nums" style={{ color: clr }}>
              {t.toFixed(0)}°
            </span>
            <span className="text-[14px] font-semibold" style={{ color: clr }}>
              {stage}期
            </span>
          </div>
          <div className="text-[11px] text-dim">
            情绪较昨日 {deltaT == null ? "—" : deltaT > 0 ? "回暖" : deltaT < 0 ? "降温" : "持平"}
          </div>
        </div>

        {/* 刻度尺 */}
        <div className="flex flex-col justify-center gap-1.5">
          <div className="relative">
            <div className="flex h-2 w-full overflow-hidden rounded-full">
              {SEGMENTS.map((seg) => (
                <div
                  key={seg.label}
                  style={{
                    width: `${seg.to - seg.from}%`,
                    backgroundColor: seg.color,
                    opacity: 0.2,
                    borderRight: "1px solid var(--card)",
                  }}
                />
              ))}
            </div>
            {/* 昨日指针 */}
            {prevT != null && (
              <div
                className="absolute -top-0.5 h-3 w-0.5 bg-dim2"
                style={{ left: `${tempPos(prevT)}%` }}
                title={`昨日 ${prevT.toFixed(0)}°`}
              />
            )}
            {/* 今日指针 */}
            <div
              className="absolute -top-1.5 h-5 w-[3px] rounded-full transition-[left] duration-300"
              style={{ left: `calc(${tempPos(t)}% - 1.5px)`, backgroundColor: clr }}
              title={`今日 ${t.toFixed(0)}°`}
            />
          </div>
          <div className="flex text-[10px] text-dim">
            {SEGMENTS.map((seg) => (
              <div key={seg.label} style={{ width: `${seg.to - seg.from}%` }} className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full" style={{ backgroundColor: seg.colorDark }} />
                {seg.label}
              </div>
            ))}
          </div>

          <div className="mt-1.5">
            <TempTrend bundle={bundle} />
          </div>
        </div>
      </div>

      {/* 温度输入因子（透明口径） */}
      <div className="lb-scroll flex items-center gap-x-5 gap-y-1 overflow-x-auto whitespace-nowrap border-t border-line px-3.5 py-2 text-[11px] text-muted-foreground">
        <span>涨停 <b className="num text-foreground">{s.limitUpCount}</b></span>
        <span>跌停 <b className="num text-foreground">{s.limitDownCount}</b></span>
        <span>炸板率 <b className="num text-foreground">{fmtRate(s.brokenRate)}</b></span>
        <span>封板率 <b className="num text-foreground">{fmtRate(s.sealRate)}</b></span>
        <span>最高板 <b className="num text-foreground">{s.highestBoard}板</b></span>
        <span>昨日涨停表现 <b className="num text-foreground">{s.yesterdayLimitAvg != null ? fmtPct(s.yesterdayLimitAvg) : "—"}</b></span>
        <span className="hidden sm:inline">上涨/下跌 <b className="num text-foreground">{bundle.market.upCount ?? "—"}/{bundle.market.downCount ?? "—"}</b></span>
      </div>
    </section>
  );
}
