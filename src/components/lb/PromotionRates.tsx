"use client";

// 连板晋级率（需求文档·十七）：水平进度条 + 点击展开该层级晋级/失败股票
import { useState } from "react";
import type { ReviewBundle } from "./api";

export default function PromotionRates({ bundle }: { bundle: ReviewBundle }) {
  const [openLevel, setOpenLevel] = useState<string | null>(null);
  const promos = bundle.sentiment.promotions.filter((p) => p.total > 0);
  if (promos.length === 0) return null;

  const promotedByLevel = (fromBoard: number) => {
    const target = fromBoard + 1;
    const ok = bundle.limitUp.filter((s) => s.isPromotion && s.boardCount === target);
    const failed = bundle.yesterdayPerf.filter(
      (r) => r.yesterdayBoardCount === fromBoard && r.todayStatus !== "promoted" && r.todayStatus !== "suspended"
    );
    return { ok, failed };
  };

  return (
    <section aria-label="连板晋级率" className="panel">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">连板晋级率</h2>
        <span className="num text-[11px] text-dim">
          昨日最高 {bundle.compare.highestBoard.yesterday ?? "—"} 板 → 今日最高 {bundle.sentiment.highestBoard} 板
        </span>
        <span className="ml-auto text-[10px] text-dim2">点击层级查看个股</span>
      </div>

      <div className="grid gap-x-8 gap-y-0 px-3.5 py-3 sm:grid-cols-2">
        {promos.map((p) => {
          const rate = Math.round(p.rate * 100);
          const cls = rate >= 50 ? "bg-[#8B98A7]" : rate >= 30 ? "bg-[#657384]" : "bg-flat";
          const open = openLevel === p.level;
          const { ok, failed } = promotedByLevel(p.fromBoard);
          return (
            <div key={p.level} className="border-b border-line py-2 last:border-0">
              <button
                className="flex w-full items-center gap-3 text-left"
                onClick={() => setOpenLevel(open ? null : p.level)}
                aria-expanded={open}
              >
                <span className="num w-12 shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                  {p.fromBoard}→{p.fromBoard + 1}
                </span>
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full transition-[width] duration-300 ${cls}`} style={{ width: `${rate}%` }} />
                </div>
                <span className="num w-11 shrink-0 text-right text-[13px] font-bold tabular-nums text-foreground">
                  {rate}%
                </span>
                <span className="num w-12 shrink-0 text-right text-[11px] tabular-nums text-dim2">
                  {p.promoted}/{p.total}
                </span>
              </button>

              {open && (
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 rounded-[3px] bg-hover px-2.5 py-2 text-[11px]">
                  <div className="min-w-40">
                    <span className="text-dim">晋级成功</span>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      {ok.length === 0 && <span className="text-dim2">无</span>}
                      {ok.map((s) => (
                        <button
                          key={s.stockCode}
                          className="num text-up hover:underline"
                          onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                        >
                          {s.stockName}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="min-w-40">
                    <span className="text-dim">晋级失败</span>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      {failed.length === 0 && <span className="text-dim2">无</span>}
                      {failed.map((s) => (
                        <button
                          key={s.stockCode}
                          className="num text-muted-foreground hover:underline"
                          onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                        >
                          {s.stockName}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
