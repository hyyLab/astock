"use client";

// 昨日涨停表现（需求文档·十六）：今日平均涨跌 / 翻红比例 / 涨跌家数 / 涨跌幅分布
import type { ReviewBundle } from "./api";
import { fmtPct, pctClass } from "./format";

/** 涨跌幅分桶（%）：[min, max)，首尾开区间 */
const BUCKETS: { label: string; min: number; max: number; positive: boolean }[] = [
  { label: "≤-5", min: -Infinity, max: -5, positive: false },
  { label: "-5~-2", min: -5, max: -2, positive: false },
  { label: "-2~0", min: -2, max: 0, positive: false },
  { label: "0~+2", min: 0, max: 2, positive: true },
  { label: "+2~+5", min: 2, max: 5, positive: true },
  { label: "≥+5", min: 5, max: Infinity, positive: true },
];

function Distribution({ bundle }: { bundle: ReviewBundle }) {
  const pcts = bundle.yesterdayPerf
    .map((r) => r.todayChangePct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (pcts.length === 0) return null;

  const counts = BUCKETS.map((b) => pcts.filter((p) => p >= b.min && p < b.max).length);
  const maxCount = Math.max(1, ...counts);

  return (
    <div>
      <div className="flex h-14 items-end gap-1">
        {counts.map((n, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${BUCKETS[i].label}%：${n} 家`}>
            <div
              className={`rounded-t-[2px] transition-[height] duration-300 ${BUCKETS[i].positive ? "bg-up/85" : "bg-down/85"}`}
              style={{ height: `${Math.max(n === 0 ? 0 : 6, (n / maxCount) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[9px] text-dim2">
        {BUCKETS.map((b) => (
          <span key={b.label} className="flex-1 text-center">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function YesterdayPerf({ bundle }: { bundle: ReviewBundle }) {
  const s = bundle.sentiment;
  const total = s.yesterdayCount;
  const red = s.yesterdayRedCount;
  const green = red != null && total != null ? total - red : null;
  const redPct = red != null && total ? Math.round((red / total) * 100) : null;

  return (
    <section aria-label="昨日涨停表现" className="panel flex h-full flex-col">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">昨日涨停表现</h2>
        <span className="num text-[11px] text-dim">样本 {total ?? "—"} 家</span>
      </div>

      <div className="flex-1 px-3.5 py-3">
        <div className="flex items-baseline gap-3">
          <div>
            <div className="text-[11px] text-dim">今日平均涨跌</div>
            <div className={`num text-[22px] font-bold leading-tight tabular-nums ${pctClass(s.yesterdayLimitAvg)}`}>
              {s.yesterdayLimitAvg != null ? fmtPct(s.yesterdayLimitAvg) : "—"}
            </div>
          </div>
          <div className="ml-auto flex gap-4 text-[12px]">
            <div>
              <div className="text-[11px] text-dim">翻红比例</div>
              <div className="num font-semibold tabular-nums text-foreground">{redPct != null ? `${redPct}%` : "—"}</div>
            </div>
            <div>
              <div className="text-[11px] text-dim">上涨</div>
              <div className="num font-semibold tabular-nums text-up">{red ?? "—"}</div>
            </div>
            <div>
              <div className="text-[11px] text-dim">下跌</div>
              <div className="num font-semibold tabular-nums text-down">{green ?? "—"}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-1 text-[10px] text-dim2">今日涨跌分布（昨日涨停股，%）</div>
          <Distribution bundle={bundle} />
        </div>
      </div>
    </section>
  );
}
