"use client";

// 市场指数条（需求文档·六） + 市场核心指标（需求文档·七/八：今日值+昨日对比）
import type { ReviewBundle } from "./api";
import { fmtNum, fmtPct, fmtDelta, fmtRate } from "./format";

/* ---------------- 市场指数条 ---------------- */

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
    <section aria-label="市场指数" className="panel px-3.5 py-2.5">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5 sm:grid-cols-6">
        {INDEX_META.map(({ key, name }) => {
          const q = bundle.market.indices[key];
          const cls = !q ? "text-flat" : q.changePct > 0 ? "text-up" : q.changePct < 0 ? "text-down" : "text-flat";
          return (
            <div key={key} className="min-w-0">
              <div className="truncate text-[11px] text-dim">{name}</div>
              {q ? (
                <div className="flex items-baseline gap-1.5">
                  <span className={`num text-[14px] font-semibold tabular-nums ${cls}`}>
                    {q.close.toFixed(2)}
                  </span>
                  <span className={`num text-[12px] tabular-nums ${cls}`}>{fmtPct(q.changePct)}</span>
                </div>
              ) : (
                <div className="num text-[14px] text-dim2">—</div>
              )}
            </div>
          );
        })}
      </div>
      {bundle.market.totalAmount != null && (
        <div className="mt-2 border-t border-line pt-1.5 text-[11px] text-dim">
          两市成交额 <span className="num font-medium text-fg2">{fmtNum(bundle.market.totalAmount, 2)}</span> 亿元
        </div>
      )}
    </section>
  );
}

/* ---------------- 市场核心指标（含昨日对比） ---------------- */

function MetricCell(props: {
  label: string;
  today: string;
  yesterday?: string | null;
  delta?: number | null;
  deltaDigits?: number;
  /** 数值颜色：up=红 down=绿 warn=橙 null=默认深色 */
  tone?: "up" | "down" | "warn" | null;
}) {
  const { label, today, yesterday, delta, deltaDigits = 0, tone } = props;
  const toneCls = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "text-foreground";
  const deltaCls =
    delta == null || delta === 0 ? "text-dim" : delta > 0 ? "text-up" : "text-down";
  const arrow = delta == null || delta === 0 ? "" : delta > 0 ? "↑" : "↓";
  return (
    <div className="flex min-w-[86px] flex-col gap-0.5 px-3.5 py-2.5">
      <span className="text-[11px] text-dim">{label}</span>
      <span className={`num text-[19px] font-bold leading-none tabular-nums ${toneCls}`}>{today}</span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] leading-none">
        {yesterday != null && <span className="num text-dim2">昨 {yesterday}</span>}
        {delta != null && (
          <span className={`num tabular-nums ${deltaCls}`}>
            {arrow} {fmtDelta(delta, deltaDigits)}
          </span>
        )}
      </span>
    </div>
  );
}

export function CoreMetrics({ bundle }: { bundle: ReviewBundle }) {
  const { market, compare, sentiment } = bundle;
  const sealToday = market.sealRate != null ? fmtRate(market.sealRate) : "—";
  const sealYesterday = compare.sealRate.yesterday != null ? fmtRate(compare.sealRate.yesterday) : null;
  const sealDeltaPct = compare.sealRate.delta != null ? compare.sealRate.delta * 100 : null;

  return (
    <section aria-label="市场核心指标" className="panel">
      <div className="lb-scroll overflow-x-auto">
        <div className="flex divide-x divide-line">
          <MetricCell
            label="涨停"
            today={String(market.limitUpCount)}
            yesterday={compare.limitUp.yesterday != null ? String(compare.limitUp.yesterday) : null}
            delta={compare.limitUp.delta}
            tone="up"
          />
          <MetricCell
            label="连板"
            today={String(compare.lianban.today ?? 0)}
            yesterday={compare.lianban.yesterday != null ? String(compare.lianban.yesterday) : null}
            delta={compare.lianban.delta}
          />
          <MetricCell
            label="最高板"
            today={`${sentiment.highestBoard}板`}
            yesterday={compare.highestBoard.yesterday != null ? `${compare.highestBoard.yesterday}板` : null}
            delta={compare.highestBoard.delta}
            tone={compare.highestBoard.delta != null && compare.highestBoard.delta > 0 ? "warn" : null}
          />
          <MetricCell
            label="跌停"
            today={String(market.limitDownCount)}
            yesterday={compare.limitDown.yesterday != null ? String(compare.limitDown.yesterday) : null}
            delta={compare.limitDown.delta}
            tone="down"
          />
          <MetricCell
            label="炸板"
            today={String(market.brokenCount)}
            yesterday={compare.broken.yesterday != null ? String(compare.broken.yesterday) : null}
            delta={compare.broken.delta}
            tone={market.brokenCount > 0 ? "warn" : null}
          />
          <MetricCell
            label="封板率"
            today={sealToday}
            yesterday={sealYesterday}
            delta={sealDeltaPct}
            deltaDigits={1}
            tone="up"
          />
          <MetricCell
            label="昨日涨停表现"
            today={sentiment.yesterdayLimitAvg != null ? fmtPct(sentiment.yesterdayLimitAvg) : "—"}
            tone={
              sentiment.yesterdayLimitAvg == null
                ? null
                : sentiment.yesterdayLimitAvg > 0
                  ? "up"
                  : sentiment.yesterdayLimitAvg < 0
                    ? "down"
                    : null
            }
          />
        </div>
      </div>
    </section>
  );
}
