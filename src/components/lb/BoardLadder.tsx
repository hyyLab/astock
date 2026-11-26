"use client";

// 连板天梯（需求文档·十/十一）：页面核心视觉模块
// 层级天梯而非普通表格；颜色体系：最高板=强调橙 / 连板=主红 / 首板=中性灰 / 反包=特殊标识
import { useState } from "react";
import type { LadderStock, ReviewBundle } from "./api";
import { boardTierClass, fmtYi } from "./format";

function LadderNode({ s, highest }: { s: LadderStock; highest: number }) {
  const tier = boardTierClass(s.boardCount, highest);
  const big = s.boardCount === highest && highest >= 2;
  return (
    <div className="group relative flex min-w-0 items-center gap-2 overflow-hidden rounded-[3px] px-1.5 py-[3px] transition-colors hover:bg-subtle">
      <span
        className={`shrink-0 rounded-full transition-transform group-hover:scale-125 ${tier.dotCls} ${big ? "h-2 w-2" : "h-1.5 w-1.5"}`}
      />
      <button
        onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
        className={`flex min-w-0 items-baseline gap-1.5 text-left text-[13px] ${tier.nameCls}`}
        title="进入个股详情"
      >
        <span className="truncate">{s.stockName}</span>
        <span className="num shrink-0 text-[10px] text-dim2">{s.stockCode}</span>
      </button>
      {s.isRebound && (
        <span className="shrink-0 rounded-[2px] border border-link-soft bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong">
          反包
        </span>
      )}
      {s.industry && (
        <span className="hidden shrink-0 truncate text-[11px] text-dim xl:inline">{s.industry}</span>
      )}
      <span className="num ml-auto hidden shrink-0 text-[11px] tabular-nums text-dim2 sm:inline">
        {s.firstLimitTime ? s.firstLimitTime.slice(0, 5) : "—"}
      </span>

      {/* 悬停详情（行内展开，避免浮层溢出） */}
      <div className="pointer-events-none absolute left-5 top-full z-20 hidden w-max min-w-56 rounded-[4px] border border-border bg-card px-2.5 py-1.5 text-[11px] shadow-md group-hover:block">
        <span className="num text-fg2">成交额 {fmtYi(s.amount)}亿</span>
        <span className="num ml-2 text-fg2">换手 {s.turnoverRate != null ? `${s.turnoverRate.toFixed(1)}%` : "—"}</span>
        <span className="num ml-2 text-fg2">
          封单 {s.sealAmount != null ? `${(s.sealAmount / 1e8).toFixed(2)}亿` : "—"}
        </span>
        <span className="num ml-2 text-fg2">炸板 {s.openCount}次</span>
        {s.industry && <div className="mt-0.5 text-dim">题材/行业：{s.industry}</div>}
      </div>
    </div>
  );
}

export default function BoardLadder({ bundle, maxFirstBoard = 8 }: { bundle: ReviewBundle; maxFirstBoard?: number }) {
  const [expandFirst, setExpandFirst] = useState(false);
  const groups = bundle.boards;
  const highest = bundle.sentiment.highestBoard;
  if (groups.length === 0) return null;

  const lianbanGroups = groups.filter((g) => g.boardCount >= 2);
  const firstGroup = groups.find((g) => g.boardCount === 1);

  return (
    <section aria-label="连板天梯" className="panel flex h-full flex-col">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">连板天梯</h2>
        <span className="text-[11px] text-dim">最高 {highest} 板 · 连板 {bundle.compare.lianban.today ?? 0} 家</span>
        <div className="ml-auto flex items-center gap-2.5 text-[10px] text-dim">
          <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-warn" />最高板</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-up" />连板</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-flat" />首板</span>
        </div>
      </div>

      <div className="lb-scroll flex-1 overflow-y-auto px-3.5 py-2.5">
        {/* 连板梯队（高 → 低） */}
        <div className="space-y-1">
          {lianbanGroups.map((g) => {
            const tier = boardTierClass(g.boardCount, highest);
            return (
              <div key={g.boardCount} className="flex items-start gap-2.5">
                <div
                  className={`num w-11 shrink-0 rounded-[3px] border px-1 py-0.5 text-center text-[12px] font-bold tabular-nums ${tier.labelCls}`}
                >
                  {g.boardCount}板
                </div>
                <div className={`min-w-0 flex-1 border-l-2 pl-2.5 ${g.boardCount === highest ? "border-warn-soft" : "border-up-soft/60"}`}>
                  <div className="flex flex-wrap">
                    {g.stocks.map((s) => (
                      <div key={s.stockCode} className="w-full sm:w-1/2 xl:w-1/3">
                        <LadderNode s={s} highest={highest} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* 首板（中性色，折叠） */}
          {firstGroup && (
            <div className="flex items-start gap-2.5">
              <div className="num w-11 shrink-0 rounded-[3px] border border-line bg-muted px-1 py-0.5 text-center text-[12px] font-bold tabular-nums text-muted-foreground">
                首板
              </div>
              <div className="min-w-0 flex-1 border-l-2 border-line pl-2.5">
                <div className="flex flex-wrap">
                  {(expandFirst ? firstGroup.stocks : firstGroup.stocks.slice(0, maxFirstBoard)).map((s) => (
                    <div key={s.stockCode} className="w-full sm:w-1/2 xl:w-1/3">
                      <LadderNode s={s} highest={highest} />
                    </div>
                  ))}
                </div>
                {firstGroup.stocks.length > maxFirstBoard && (
                  <button
                    onClick={() => setExpandFirst((v) => !v)}
                    className="mt-0.5 px-1.5 text-[11px] text-link hover:underline"
                  >
                    {expandFirst ? "收起" : `展开全部 ${firstGroup.stocks.length} 只首板`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
