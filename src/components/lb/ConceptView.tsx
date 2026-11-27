"use client";

// 题材全景专项页：双层题材体系
//   主线题材 tab = 规则归组（跨行业，如 福建概念 横跨 林业/医药商业/水泥），展开看成分股及各自行业
//   行业细分 tab = 东财 hybk 行业，展开看涨停股
// 附：主线题材10日热度热力图
import { Fragment, useMemo, useState } from "react";
import DateBar from "./DateBar";
import { ConceptHeatmap } from "./MainThemes";
import { useReview, LoadingState } from "./useReview";
import type { SyncClusterRow } from "./api";
import { AlertTriangle, ChevronDown, RefreshCw, Zap } from "lucide-react";

function Stars({ score }: { score: number }) {
  const full = Math.round((score / 100) * 5);
  return (
    <span className="whitespace-nowrap text-[12px] leading-none">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= full ? "text-warn" : "text-dim2"}>
          ★
        </span>
      ))}
    </span>
  );
}

type Tab = "theme" | "industry";

/** 盘中同步启动聚类板块：同批首封 → 题材佐证 / 候选新题材（启动潮降权显示） */
function SyncLaunchPanel({ clusters }: { clusters: SyncClusterRow[] }) {
  if (clusters.length === 0) return null;
  const batches = clusters.filter((c) => c.kind === "batch");
  const waves = clusters.filter((c) => c.kind === "wave");
  if (batches.length === 0 && waves.length === 0) return null;
  return (
    <section className="panel">
      <div className="module-header">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Zap className="h-3.5 w-3.5 text-warn" />
          盘中同步启动聚类
        </h2>
        <span className="text-[11px] text-dim">
          首封时间相邻≤2分钟且≥3只归为同批 · 共享主线＝题材佐证 · 无共享主线＝候选新题材（辅助维护题材规则）
        </span>
      </div>
      <div className="divide-y divide-line">
        {batches.map((c, i) => (
          <div key={`${c.startLabel}-${i}`} className="px-3.5 py-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="num rounded-[2px] bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-fg2">
                {c.windowLabel}
              </span>
              <span className="text-[11px] text-dim">{c.phaseLabel}</span>
              <span className="num text-[11px] text-dim">{c.stocks.length} 股同步封板</span>
              {c.sharedThemes.length > 0 ? (
                c.sharedThemes.map((t) => (
                  <span
                    key={t}
                    className="rounded-[2px] bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-4 text-fg2"
                  >
                    佐证：{t}
                  </span>
                ))
              ) : (
                <span className="rounded-[2px] bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium leading-4 text-warn-strong">
                  候选新题材（无主线归属）
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.stocks.map((s) => (
                <button
                  key={s.stockCode}
                  onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                  className="num rounded-[3px] border border-border bg-card px-2 py-1 text-[11px] text-fg2 hover:border-primary hover:text-primary"
                  title={`首封 ${s.firstLimitTime} · 行业 ${s.industry ?? "—"}${s.themes.length ? ` · 主线 ${s.themes.join("/")}` : ""}`}
                >
                  <span className="font-medium">{s.stockName}</span>
                  <span className="ml-1 text-up">{s.boardCount > 1 ? `${s.boardCount}板` : ""}</span>
                  <span className="ml-1 text-dim">{s.industry ?? "—"}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {waves.length > 0 && (
          <div className="px-3.5 py-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-dim">另有 {waves.length} 波启动潮（跨度&gt;10分钟，普涨封板潮，无题材指向）：</span>
            </div>
            <div className="space-y-0.5 opacity-60">
              {waves.map((c, i) => (
                <div key={i} className="text-[11px] text-dim">
                  <span className="num mr-2 tabular-nums">{c.windowLabel}</span>
                  {c.phaseLabel} · {c.stocks.length} 股 · 成员：{c.stocks.map((s) => s.stockName).join("、")}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function ConceptView() {
  const { bundle, error, stale, retry } = useReview();
  const [tab, setTab] = useState<Tab>("theme");
  const [open, setOpen] = useState<string | null>(null);

  if (stale) return <LoadingState />;
  if (error || !bundle)
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded border border-warn-soft bg-warn-bg py-20">
        <AlertTriangle className="h-8 w-8 text-warn" />
        <p className="text-sm text-muted-foreground">{error ?? "未知错误"}</p>
        <button
          onClick={retry}
          className="flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs text-fg2 hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 重试
        </button>
      </div>
    );

  const rows = tab === "theme" ? bundle.concepts : bundle.industries;

  // 行业 tab 展开用：按行业过滤涨停股（数据量小，直接计算避免 hooks 顺序问题）
  const stocksOfIndustry = new Map<string, typeof bundle.limitUp>();
  for (const s of bundle.limitUp) {
    if (!s.industry) continue;
    if (!stocksOfIndustry.has(s.industry)) stocksOfIndustry.set(s.industry, []);
    stocksOfIndustry.get(s.industry)!.push(s);
  }

  return (
    <div className="space-y-3">
      <DateBar bundle={bundle} />

      {/* Tab 切换 */}
      <div className="flex items-center gap-1">
        {(
          [
            { key: "theme", label: "主线题材", n: bundle.concepts.length, tip: "规则归组 · 跨行业主线" },
            { key: "industry", label: "行业细分", n: bundle.industries.length, tip: "东财行业板块" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setOpen(null);
            }}
            title={t.tip}
            className={`rounded-[3px] px-3 py-1.5 text-[12px] transition-colors ${
              tab === t.key ? "bg-sidebar-accent font-medium text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t.label}
            <span className="num ml-1 text-[10px] text-dim2">{t.n}</span>
          </button>
        ))}
        {tab === "theme" && (
          <span className="ml-2 text-[11px] text-dim">主线为规则归组（行业白名单 + 名称关键词 + 显式成员），一只股票可归属多条主线</span>
        )}
      </div>

      {/* 全题材榜单 */}
      <section className="panel">
        <div className="module-header">
          <h2 className="text-[13px] font-semibold text-foreground">{tab === "theme" ? "主线题材全景" : "行业细分全景"}</h2>
          <span className="num text-[11px] text-dim">
            {rows.length} 个有涨停 · 按强度分排序 · 点击行展开成分
          </span>
        </div>
        <div className="lb-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-dim">
                <th className="w-10 px-3.5 py-1.5 text-left font-normal">#</th>
                <th className="px-2 py-1.5 text-left font-normal">题材</th>
                <th className="px-2 py-1.5 text-right font-normal">涨停</th>
                <th className="px-2 py-1.5 text-right font-normal">连板</th>
                <th className="px-2 py-1.5 text-right font-normal">最高板</th>
                {tab === "industry" && <th className="px-2 py-1.5 text-right font-normal">炸板</th>}
                <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
                <th className="px-2 py-1.5 text-left font-normal">龙头候选</th>
                <th className="px-2 py-1.5 text-right font-normal">今日强度</th>
                <th className="w-24 px-2 py-1.5 text-right font-normal">热度</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const isOpen = open === c.conceptName;
                return (
                  <Fragment key={c.conceptName}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : c.conceptName)}
                      className={`cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover ${isOpen ? "bg-hover" : ""}`}
                    >
                      <td className="num px-3.5 py-1.5 text-dim2">{i + 1}</td>
                      <td className="px-2 py-1.5 font-medium text-foreground">
                        {c.conceptName}
                        {tab === "theme" && (c.newsCount ?? 0) > 0 && (
                          <span
                            className="ml-1.5 rounded-[2px] bg-muted px-1 align-middle text-[10px] font-normal leading-4 text-fg2"
                            title={`当日相关资讯 ${c.newsCount} 条（快讯+成分股个股新闻），其中利好 ${c.newsGoodCount ?? 0} 条`}
                          >
                            新闻 {c.newsCount}
                          </span>
                        )}
                      </td>
                      <td className="num px-2 py-1.5 text-right font-semibold tabular-nums text-up">
                        {c.limitUpCount}
                      </td>
                      <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{c.boardCount}</td>
                      <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{c.highestBoard}板</td>
                      {tab === "industry" && (
                        <td className="num px-2 py-1.5 text-right tabular-nums text-warn-strong">
                          {c.brokenCount > 0 ? c.brokenCount : "—"}
                        </td>
                      )}
                      <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                        {c.totalAmount != null ? c.totalAmount.toFixed(1) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-link">{c.leaderName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Stars score={c.strengthScore} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full rounded-full bg-warn"
                            style={{ width: `${Math.min(100, c.heatScore ?? 0)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <ChevronDown className={`h-3.5 w-3.5 text-dim2 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-hover">
                        <td colSpan={tab === "theme" ? 10 : 11} className="px-3.5 py-2.5">
                          {tab === "theme" ? (
                            (c.members ?? []).length === 0 ? (
                              <span className="text-[11px] text-dim2">暂无成分股明细</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {c.members!.map((m) => (
                                  <button
                                    key={m.stockCode}
                                    onClick={() => (location.hash = `#/stock/${m.stockCode}`)}
                                    className="num rounded-[3px] border border-border bg-card px-2 py-1 text-[11px] text-fg2 hover:border-up-soft hover:text-up"
                                    title={`行业 ${m.industry ?? "—"} · 点击查看个股`}
                                  >
                                    <span className="font-medium">{m.stockName}</span>
                                    <span className="ml-1 text-up">{m.boardCount > 1 ? `${m.boardCount}板` : ""}</span>
                                    <span className="ml-1 text-dim">{m.industry ?? ""}</span>
                                  </button>
                                ))}
                              </div>
                            )
                          ) : (
                            (() => {
                              const stocks = stocksOfIndustry.get(c.conceptName) ?? [];
                              return stocks.length === 0 ? (
                                <span className="text-[11px] text-dim2">暂无涨停股明细</span>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {stocks.map((s) => (
                                    <button
                                      key={s.stockCode}
                                      onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                                      className="num rounded-[3px] border border-border bg-card px-2 py-1 text-[11px] text-fg2 hover:border-up-soft hover:text-up"
                                      title={`首封 ${s.firstLimitTime ?? "—"} · 成交额 ${s.amount ? (s.amount / 1e8).toFixed(2) : "—"}亿`}
                                    >
                                      <span className="font-medium">{s.stockName}</span>
                                      <span className="ml-1 text-up">
                                        {s.boardCount > 1 ? `${s.boardCount}板` : "首板"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 完整热力图（主线题材） */}
      <section className="panel">
        <div className="module-header">
          <h2 className="text-[13px] font-semibold text-foreground">主线题材近10日热度</h2>
          <span className="text-[11px] text-dim">格子数字为当日题材内涨停家数 · 颜色越深强度越高</span>
        </div>
        <div className="px-3.5 py-3">
          <ConceptHeatmap rows={bundle.conceptHeat} maxConcepts={8} />
        </div>
      </section>

      {/* 盘中同步启动聚类（题材佐证 / 候选新题材发现） */}
      <SyncLaunchPanel clusters={bundle.syncClusters ?? []} />
    </div>
  );
}
