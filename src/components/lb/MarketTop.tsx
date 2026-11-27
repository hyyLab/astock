"use client";

// 首页市场指数与核心指标：突出行情数字，标签与容器保持单色。
import type { ReviewBundle } from "./api";
import { fmtNum, fmtPct, fmtDelta, fmtRate } from "./format";

const INDEX_META: { key: "sh" | "sz" | "cyb" | "kc50" | "sz50" | "bz50"; name: string }[] = [
  { key: "sh", name: "上证指数" },
  { key: "sz", name: "深证成指" },
  { key: "cyb", name: "创业板指" },
  { key: "kc50", name: "科创50" },
  { key: "sz50", name: "上证50" },
  { key: "bz50", name: "北证50" },
];

export function IndexStrip({ bundle }: { bundle: ReviewBundle }) {
  return (
    <section aria-label="市场指数" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      {INDEX_META.map(({ key, name }) => {
        const q = bundle.market.indices[key];
        const cls = !q ? "text-dim2" : q.changePct > 0 ? "text-up" : q.changePct < 0 ? "text-down" : "text-flat";
        return (
          <div key={key} className="min-w-0 rounded-xl border border-line bg-card px-4 py-4 md:px-4 md:py-5">
            <div className="truncate text-[11px] font-medium tracking-wide text-dim">{name}</div>
            {q ? (
              <>
                <div className={`num mt-3 text-[21px] font-bold leading-none tracking-tight tabular-nums md:text-[23px] ${cls}`}>
                  {q.close.toFixed(2)}
                </div>
                <div className={`num mt-2 text-[13px] font-semibold tabular-nums ${cls}`}>{fmtPct(q.changePct)}</div>
              </>
            ) : (
              <div className="num mt-3 text-[22px] font-semibold text-dim2">—</div>
            )}
          </div>
        );
      })}
      <div className="min-w-0 rounded-xl border border-line bg-card px-4 py-4 md:px-4 md:py-5">
        <div className="truncate text-[11px] font-medium tracking-wide text-dim">两市成交额</div>
        <div className="num mt-3 text-[21px] font-bold leading-none tracking-tight text-foreground tabular-nums md:text-[23px]">
          {bundle.market.totalAmount != null ? fmtNum(bundle.market.totalAmount, 2) : "—"}
        </div>
        <div className="mt-2 text-[11px] text-dim">亿元 · 沪深合计</div>
      </div>
    </section>
  );
}

function MetricCell(props: {
  label: string;
  today: string;
  yesterday?: string | null;
  delta?: number | null;
  deltaDigits?: number;
  tone?: "up" | "down" | null;
}) {
  const { label, today, yesterday, delta, deltaDigits = 0, tone } = props;
  const toneCls = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground";
  const deltaCls = delta == null || delta === 0 ? "text-dim" : delta > 0 ? "text-up" : "text-down";
  const arrow = delta == null || delta === 0 ? "" : delta > 0 ? "↑" : "↓";
  return (
    <div className="flex min-h-[132px] min-w-0 flex-col justify-between rounded-xl border border-line bg-card px-4 py-4 md:px-4 md:py-5">
      <span className="text-[11px] font-medium tracking-wide text-dim">{label}</span>
      <span className={`kpi-value num mt-4 block text-[34px] font-bold tabular-nums md:text-[38px] ${toneCls}`}>{today}</span>
      <div className="mt-3 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-none">
        {yesterday != null && <span className="num text-dim2">昨 {yesterday}</span>}
        {delta != null && (
          <span className={`num font-medium tabular-nums ${deltaCls}`}>
            {arrow} {fmtDelta(delta, deltaDigits)}
          </span>
        )}
      </div>
    </div>
  );
}

export function CoreMetrics({ bundle }: { bundle: ReviewBundle }) {
  const { market, compare, sentiment } = bundle;
  const sealToday = market.sealRate != null ? fmtRate(market.sealRate) : "—";
  const sealYesterday = compare.sealRate.yesterday != null ? fmtRate(compare.sealRate.yesterday) : null;
  const sealDeltaPct = compare.sealRate.delta != null ? compare.sealRate.delta * 100 : null;
  const yesterdayAvg = sentiment.yesterdayLimitAvg;

  return (
    <section aria-label="市场核心指标" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      <MetricCell label="涨停" today={String(market.limitUpCount)} yesterday={compare.limitUp.yesterday != null ? String(compare.limitUp.yesterday) : null} delta={compare.limitUp.delta} tone="up" />
      <MetricCell label="连板" today={String(compare.lianban.today ?? 0)} yesterday={compare.lianban.yesterday != null ? String(compare.lianban.yesterday) : null} delta={compare.lianban.delta} />
      <MetricCell label="最高板" today={`${sentiment.highestBoard}板`} yesterday={compare.highestBoard.yesterday != null ? `${compare.highestBoard.yesterday}板` : null} delta={compare.highestBoard.delta} />
      <MetricCell label="跌停" today={String(market.limitDownCount)} yesterday={compare.limitDown.yesterday != null ? String(compare.limitDown.yesterday) : null} delta={compare.limitDown.delta} tone="down" />
      <MetricCell label="炸板" today={String(market.brokenCount)} yesterday={compare.broken.yesterday != null ? String(compare.broken.yesterday) : null} delta={compare.broken.delta} />
      <MetricCell label="封板率" today={sealToday} yesterday={sealYesterday} delta={sealDeltaPct} deltaDigits={1} />
      <MetricCell
        label="昨日涨停表现"
        today={yesterdayAvg != null ? fmtPct(yesterdayAvg) : "—"}
        tone={yesterdayAvg == null ? null : yesterdayAvg > 0 ? "up" : yesterdayAvg < 0 ? "down" : null}
      />
    </section>
  );
}
