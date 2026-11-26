"use client";

// 市场概览：四大指数卡片 + 市场统计条
import { fmtPct, pctClass } from "./format";
import type { ReviewBundle } from "./api";

function IndexCard({ name, quote }: { name: string; quote: { close: number; changePct: number } | null }) {
  return (
    <div className="rounded-xl border border-[#1c2536] bg-[#0f1522] px-3 py-2.5 md:px-4 md:py-3">
      <div className="text-[11px] text-slate-500 md:text-xs">{name}</div>
      {quote ? (
        <>
          <div className={`mt-1 font-mono text-lg font-semibold tabular-nums md:text-2xl ${pctClass(quote.changePct)}`}>
            {quote.close.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`text-xs tabular-nums md:text-[13px] ${pctClass(quote.changePct)}`}>
            {fmtPct(quote.changePct)}
          </div>
        </>
      ) : (
        <div className="mt-2 font-mono text-lg text-slate-600 md:text-2xl">—</div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  cls = "",
  sub,
}: {
  label: string;
  value: string;
  cls?: string;
  sub?: string;
}) {
  return (
    <div className="flex min-w-[86px] flex-col items-center justify-center rounded-lg border border-[#1c2536] bg-[#0f1522] px-2 py-2 md:px-3">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`mt-0.5 font-mono text-base font-semibold tabular-nums md:text-lg ${cls}`}>{value}</span>
      {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
    </div>
  );
}

export default function MarketOverview({ bundle }: { bundle: ReviewBundle }) {
  const m = bundle.market;
  return (
    <section aria-label="市场概览" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-3 lg:grid-cols-5">
        <IndexCard name="上证指数" quote={m.indices.sh} />
        <IndexCard name="深证成指" quote={m.indices.sz} />
        <IndexCard name="创业板指" quote={m.indices.cyb} />
        <IndexCard name="科创50" quote={m.indices.kc50} />
        <div className="col-span-2 rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/8 to-[#0f1522] px-3 py-2.5 sm:col-span-1 md:px-4 md:py-3">
          <div className="text-[11px] text-amber-200/60 md:text-xs">两市成交额</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-300 md:text-2xl">
            {m.totalAmount != null ? m.totalAmount.toLocaleString("zh-CN") : "—"}
            <span className="ml-1 text-xs font-normal text-amber-200/50 md:text-sm">亿</span>
          </div>
          <div className="text-[10px] text-amber-200/40 md:text-xs">沪深两市合计</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7 md:gap-3">
        <StatChip label="涨停" value={String(m.limitUpCount)} cls="text-[#f6465d]" />
        <StatChip label="跌停" value={String(m.limitDownCount)} cls="text-[#0ecb81]" />
        <StatChip label="炸板" value={String(m.brokenCount)} cls="text-amber-400" />
        <StatChip label="封板率" value={m.sealRate != null ? `${(m.sealRate * 100).toFixed(1)}%` : "—"} cls="text-slate-200" />
        <StatChip label="上涨" value={m.upCount != null ? String(m.upCount) : "—"} cls="text-[#f6465d]" sub={m.flatCount != null ? `平 ${m.flatCount}` : undefined} />
        <StatChip label="下跌" value={m.downCount != null ? String(m.downCount) : "—"} cls="text-[#0ecb81]" />
        <StatChip
          label="涨跌比"
          value={m.upCount != null && m.downCount ? (m.upCount / Math.max(m.downCount, 1)).toFixed(2) : "—"}
          cls="text-slate-200"
        />
      </div>
    </section>
  );
}
