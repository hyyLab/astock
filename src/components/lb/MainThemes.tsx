"use client";

// 主线题材（需求文档·十二/十三）：规则归组跨行业 + 成员明细 + 强度星级 + 近10日热度热力图
// 主线新闻流（用户迭代）：新闻直接放主线下面——每条主线可展开当日相关资讯
//（7x24快讯 + 成分股个股新闻），新闻条数/利好数直观反映主线强度与资金关注度
import { useState } from "react";
import type { ConceptRow, ReviewBundle, ThemeMemberRow, ThemeNewsHeadline } from "./api";

/** 星级：strengthScore(0-100) → 5星制 */
function Stars({ score }: { score: number }) {
  const full = Math.round((score / 100) * 5);
  return (
    <span className="whitespace-nowrap text-[12px] leading-none" title={`强度分 ${score.toFixed(0)}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= full ? "text-warn" : "text-dim2"}>
          ★
        </span>
      ))}
    </span>
  );
}

/** 题材近10日热力图（纯 CSS 色块，克制无动画） */
export function ConceptHeatmap({
  rows,
  maxConcepts = 8,
}: {
  rows: ReviewBundle["conceptHeat"];
  maxConcepts?: number;
}) {
  if (rows.length === 0) return null;
  const list = rows.slice(0, maxConcepts);
  const maxCount = Math.max(1, ...list.flatMap((r) => r.series.map((p) => p.count)));

  return (
    <div className="lb-scroll overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[11px]">
        <thead>
          <tr className="text-dim">
            <th className="w-24 pb-1 text-left font-normal">题材</th>
            {list[0].series.map((p, i) => (
              <th key={p.date} className="pb-1 text-center font-normal">
                {i === list[0].series.length - 1 ? "今日" : `D-${list[0].series.length - 1 - i}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.conceptName}>
              <td className="max-w-24 truncate py-0.5 pr-2 text-fg2" title={r.conceptName}>
                {r.conceptName}
              </td>
              {r.series.map((p) => {
                const alpha = p.count === 0 ? 0 : 0.12 + (p.count / maxCount) * 0.78;
                const bg = p.count === 0 ? "#f7f8fa" : `rgba(217,53,47,${alpha.toFixed(2)})`;
                const txtCls = p.count === 0 ? "text-dim2" : alpha > 0.5 ? "text-white" : "text-up";
                return (
                  <td key={p.date} className="p-0.5">
                    <div
                      className={`num rounded-[2px] py-0.5 text-center tabular-nums ${txtCls}`}
                      style={{ backgroundColor: bg }}
                      title={`${r.conceptName} ${p.date} 涨停 ${p.count} 家`}
                    >
                      {p.count || ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 影响标签（与主线追踪一致的三色口径） */
const IMPACT_META: Record<ThemeNewsHeadline["impact"], { text: string; cls: string }> = {
  good: { text: "利好", cls: "bg-muted text-fg2" },
  bad: { text: "利空", cls: "bg-muted text-fg2" },
  none: { text: "中性", cls: "bg-muted text-dim" },
};

/** 主线新闻流（展开区）：最新 3 条，快讯/个股新闻混排 */
function ThemeNewsStream({ news }: { news: ThemeNewsHeadline[] }) {
  if (news.length === 0) {
    return <div className="px-2 pb-1 pt-0.5 text-[11px] text-dim2">当日暂无该主线相关资讯</div>;
  }
  return (
    <div className="space-y-1 border-l-2 border-line px-2 py-0.5">
      {news.map((n, i) => {
        const impact = IMPACT_META[n.impact];
        return (
          <div key={`${n.pubTime}-${i}`} className="flex items-start gap-1.5 text-[11px] leading-4">
            <span className="num shrink-0 tabular-nums text-dim2">{n.pubTime.slice(5, 16)}</span>
            <span className={`shrink-0 rounded-[2px] px-1 text-[10px] font-medium leading-4 ${impact.cls}`}>
              {impact.text}
            </span>
            {n.kind === "stock" && (
              <span
                className="shrink-0 rounded-[2px] bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong"
                title="个股新闻（题材归类证据源）"
              >
                个股
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-fg2" title={n.title}>
              {n.stockCode && n.stockName ? (
                <button
                  className="mr-1 text-link hover:underline"
                  onClick={() => (location.hash = `#/stock/${n.stockCode}`)}
                >
                  {n.stockName}
                </button>
              ) : null}
              {n.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function MainThemes({ bundle }: { bundle: ReviewBundle }) {
  const themes = bundle.concepts.slice(0, 6);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (themes.length === 0) return null;

  // 行业多样性：主线题材的跨行业程度（如 福建概念 涵盖 林业/医药商业/水泥）
  const industryCount = (members?: ThemeMemberRow[]) =>
    members ? new Set(members.map((m) => m.industry ?? "")).size : 0;

  return (
    <section aria-label="主线题材" className="panel flex h-full flex-col">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">主线题材</h2>
        <span className="text-[11px] text-dim">
          规则归组 · 跨行业 · 共 {bundle.concepts.length} 条主线
        </span>
        <button
          onClick={() => (location.hash = "#/concepts")}
          className="ml-auto text-[11px] text-link hover:underline"
        >
          全部题材 →
        </button>
      </div>

      <div className="divide-y divide-line">
        {themes.map((c: ConceptRow, i) => {
          const ic = industryCount(c.members);
          const newsN = c.newsCount ?? 0;
          const isOpen = expanded === c.conceptName;
          return (
            <div key={c.conceptName} className="px-3.5 py-2 transition-colors hover:bg-hover">
              <div className="flex items-center gap-3">
                <span className="num w-4 shrink-0 text-center text-[12px] font-bold text-dim2">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      className="truncate text-[13px] font-medium text-foreground hover:text-primary"
                      title={`查看 ${c.conceptName} 涨停股`}
                      onClick={() => (location.hash = `#/limit-up?concept=${encodeURIComponent(c.conceptName)}`)}
                    >
                      {c.conceptName}
                    </button>
                    {ic > 1 && (
                      <span
                        className="shrink-0 rounded-[2px] bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong"
                        title={(c.members ?? [])
                          .map((m) => `${m.stockName}（${m.industry ?? "—"}）${m.boardCount > 1 ? `${m.boardCount}板` : ""}`)
                          .join("、")}
                      >
                        跨{ic}行业
                      </span>
                    )}
                  </div>
                  <div className="num mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
                    <span>
                      涨停 <b className="text-up">{c.limitUpCount}</b>
                    </span>
                    <span>
                      连板 <b className="text-foreground">{c.boardCount}</b>
                    </span>
                    <span>
                      最高 <b className="text-foreground">{c.highestBoard}板</b>
                    </span>
                    <span>
                      龙头{" "}
                      <b
                        className="cursor-pointer text-link hover:underline"
                        onClick={() => c.leaderCode && (location.hash = `#/stock/${c.leaderCode}`)}
                      >
                        {c.leaderName ?? "—"}
                      </b>
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Stars score={c.strengthScore} />
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-line" title={`热度 ${c.heatScore?.toFixed(0) ?? "—"}`}>
                    <div
                      className="h-full rounded-full bg-warn"
                      style={{ width: `${Math.min(100, c.heatScore ?? 0)}%` }}
                    />
                  </div>
                </div>
              </div>
              {/* 主线新闻：直接放主线下面（新闻热度 = 强度的直观信号） */}
              {newsN > 0 && (
                <button
                  onClick={() => setExpanded(isOpen ? null : c.conceptName)}
                  className="mt-1 flex w-full items-center gap-1.5 text-left text-[11px] hover:text-fg2"
                  title={`当日相关资讯 ${newsN} 条（快讯+成分股个股新闻），其中利好 ${c.newsGoodCount ?? 0} 条`}
                >
                  <span
                    className={`shrink-0 rounded-[2px] px-1 text-[10px] font-medium leading-4 ${
                      (c.newsGoodCount ?? 0) > 0 ? "bg-muted text-fg2" : "bg-muted text-dim"
                    }`}
                  >
                    新闻 {newsN}
                  </span>
                  {(c.newsGoodCount ?? 0) > 0 && (
                    <span className="num shrink-0 text-[10px] text-fg2">利好 {c.newsGoodCount}</span>
                  )}
                  <span className="truncate text-dim2" title={(c.news ?? []).map((n) => n.title).join(" / ")}>
                    {c.news?.[0]?.title ?? ""}
                  </span>
                  <span className="ml-auto shrink-0 text-dim2">{isOpen ? "收起 ▴" : "展开 ▾"}</span>
                </button>
              )}
              {isOpen && (
                <div className="mt-1">
                  <ThemeNewsStream news={c.news ?? []} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 近10日热度热力图 */}
      <div className="border-t border-line px-3.5 py-2.5">
        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">主线题材近10日涨停家数热力</div>
        <ConceptHeatmap rows={bundle.conceptHeat} maxConcepts={6} />
      </div>

      {/* 盘中同步启动（紧凑提示）：仅题材批次，佐证批次优先（可点击跳转题材） */}
      {(bundle.syncClusters?.filter((c) => c.kind === "batch").length ?? 0) > 0 && (
        <div className="border-t border-line px-3.5 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">盘中同步启动</span>
            <button
              onClick={() => (location.hash = "#/concepts")}
              className="text-[11px] text-link hover:underline"
              title="首封时间相邻≤2分钟且≥3只归为同批，用于题材佐证与新题材发现"
            >
              聚类详情 →
            </button>
          </div>
          <div className="space-y-1">
            {bundle.syncClusters
              .filter((c) => c.kind === "batch")
              .sort((a, b) => Number(a.isCandidate) - Number(b.isCandidate))
              .slice(0, 3)
              .map((c, i) => (
                <div key={`${c.startLabel}-${i}`} className="flex items-center gap-2 text-[11px]">
                  <span className="num rounded-[2px] bg-muted px-1 tabular-nums text-fg2">{c.windowLabel}</span>
                  <span className="num text-dim">{c.stocks.length}股</span>
                  {c.isCandidate ? (
                    <span className="text-warn-strong">候选新题材</span>
                  ) : (
                    <button
                      className="truncate text-link hover:underline"
                      onClick={() =>
                        (location.hash = `#/limit-up?concept=${encodeURIComponent(c.sharedThemes[0])}`)
                      }
                    >
                      佐证：{c.sharedThemes.join("/")}
                    </button>
                  )}
                  <span className="ml-auto truncate text-dim" title={c.stocks.map((s) => s.stockName).join("、")}>
                    {c.stocks.map((s) => s.stockName).join("、")}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
