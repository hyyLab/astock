"use client";

// 市场宽度（需求文档·十五）：一眼看懂今日市场总体偏强/偏弱
import type { ReviewBundle } from "./api";
import { fmtNum } from "./format";

export default function MarketBreadth({ bundle }: { bundle: ReviewBundle }) {
  const { upCount, downCount, flatCount, limitUpCount, limitDownCount } = bundle.market;
  const up = upCount ?? 0;
  const down = downCount ?? 0;
  const flat = flatCount ?? 0;
  const total = Math.max(1, up + down + flat);
  const upPct = (up / total) * 100;
  const flatPct = (flat / total) * 100;
  const downPct = (down / total) * 100;
  const hasBreadth = upCount != null && downCount != null;

  return (
    <section aria-label="市场宽度" className="panel flex h-full flex-col">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">市场宽度</h2>
        <span className="text-[11px] text-dim">涨跌家数（全市场快照）</span>
      </div>

      <div className="flex-1 px-3.5 py-3">
        {hasBreadth ? (
          <>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="flex items-baseline gap-1">
                <span className="text-dim">上涨</span>
                <b className="num text-[16px] tabular-nums text-up">{fmtNum(up)}</b>
              </span>
              {flat > 0 && (
                <span className="flex items-baseline gap-1">
                  <span className="text-dim">平盘</span>
                  <b className="num text-[13px] tabular-nums text-flat">{fmtNum(flat)}</b>
                </span>
              )}
              <span className="flex items-baseline gap-1">
                <b className="num text-[16px] tabular-nums text-down">{fmtNum(down)}</b>
                <span className="text-dim">下跌</span>
              </span>
            </div>

            {/* 强弱比例条 */}
            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full" title={`上涨 ${upPct.toFixed(1)}% / 下跌 ${downPct.toFixed(1)}%`}>
              <div className="bg-up transition-[width] duration-300" style={{ width: `${upPct}%` }} />
              <div className="bg-line" style={{ width: `${flatPct}%` }} />
              <div className="bg-down transition-[width] duration-300" style={{ width: `${downPct}%` }} />
            </div>
            <div className="num mt-1 flex justify-between text-[10px] tabular-nums text-dim2">
              <span>{upPct.toFixed(0)}%</span>
              <span>{downPct.toFixed(0)}%</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-line pt-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-dim">涨停</span>
                <b className="num tabular-nums text-up">{limitUpCount}</b>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dim">跌停</span>
                <b className="num tabular-nums text-down">{limitDownCount}</b>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-24 items-center justify-center text-[12px] text-dim2">
            历史交易日无全市场快照 · 仅有涨停/跌停 <b className="num mx-1 text-up">{limitUpCount}</b>/
            <b className="num mx-1 text-down">{limitDownCount}</b>
          </div>
        )}
      </div>
    </section>
  );
}
