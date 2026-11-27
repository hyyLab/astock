"use client";

// 个股详情视图（需求文档·二十）：报价 → K线 → 涨停历史 → 连板历史 → 题材 → 龙虎榜(预留)
import { useEffect, useState } from "react";
import { api, type StockDetail } from "./api";
import KLineChart from "./KLineChart";
import { fmtYi, fmtPct, pctClass } from "./format";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, RefreshCw } from "lucide-react";

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-28 rounded bg-card" />
      <Skeleton className="h-[380px] rounded bg-card" />
      <Skeleton className="h-56 rounded bg-card" />
    </div>
  );
}

export default function StockView({ code }: { code: string }) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => api.stock(code))
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, refreshKey]);

  const stale = loading || (detail != null && detail.basic.stockCode !== code);

  if (stale) return <LoadingSkeleton />;

  if (error || !detail)
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded border border-warn-soft bg-warn-bg py-20">
        <AlertTriangle className="h-8 w-8 text-warn" />
        <p className="max-w-md px-4 text-center text-sm text-muted-foreground">{error ?? "未知错误"}</p>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs text-fg2 hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 重试
        </button>
      </div>
    );

  const q = detail.quote;

  return (
    <div className="space-y-3">
      {/* 报价头 */}
      <section className="panel p-4">
        <button
          onClick={() => (location.hash = "#/")}
          className="mb-3 flex items-center gap-1 text-xs text-dim hover:text-fg2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回复盘
        </button>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{detail.basic.stockName}</h1>
              <span className="num text-sm text-dim">{detail.basic.stockCode}</span>
              <span className="rounded-[3px] bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {detail.basic.market}
              </span>
            </div>
            <div className="mt-1 text-xs text-dim">
              题材/行业：{detail.concepts.join(" · ") || detail.basic.industry || "—"}
            </div>
          </div>
          {q && (
            <>
              <div className={`num text-3xl font-bold tabular-nums ${pctClass(q.changePct)}`}>
                {q.price.toFixed(2)}
              </div>
              <div className={`num text-base tabular-nums ${pctClass(q.changePct)}`}>{fmtPct(q.changePct)}</div>
              <div className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                {[
                  ["成交额", `${fmtYi(q.amount, 2)}亿`],
                  ["换手率", q.turnoverRate != null ? `${q.turnoverRate.toFixed(2)}%` : "—"],
                  ["流通市值", `${fmtYi(q.floatMarketCap, 0)}亿`],
                  ["昨收", q.prevClose != null ? q.prevClose.toFixed(2) : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span className="text-dim">{k}</span>
                    <span className="num ml-1.5 tabular-nums text-fg2">{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <KLineChart detail={detail} />

      {/* 新闻归类依据（用户需求：不能光看分类，要看相关新闻再归类） */}
      {detail.themeEvidence.length > 0 && (
        <section className="panel p-4">
          <h2 className="mb-1 text-[13px] font-semibold text-foreground">
            题材归类依据 · 新闻证据
            <span className="ml-1.5 text-[11px] font-normal text-dim">
              个股新闻命中主线关键词时佐证/新增归属（最新 {detail.themeEvidence.length} 条）
            </span>
          </h2>
          <p className="mb-2 text-[11px] text-dim2">
            归类信号优先级：炒作类型（新闻/标签） &gt; 盘中同步启动聚类 &gt; 行业细分；此处展示新闻证据明细
          </p>
          <div className="space-y-1">
            {detail.themeEvidence.slice(0, 6).map((e, i) => (
              <div
                key={`${e.time}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-[3px] border border-line bg-hover px-3 py-1.5 text-[12px]"
              >
                <span className="num shrink-0 text-[11px] tabular-nums text-dim2">{e.time.slice(5, 16)}</span>
                <span className="shrink-0 rounded-[2px] bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong">
                  {e.theme}
                </span>
                <span className="truncate text-fg2" title={e.title}>
                  {e.title}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-dim2">
                  命中「{e.hits.join("/")}」{e.media ? ` · ${e.media}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 涨停历史 */}
        <section className="panel p-4">
          <h2 className="mb-3 text-[13px] font-semibold text-foreground">
            涨停历史 <span className="ml-1 text-[11px] font-normal text-dim">近 {detail.limitUpHistory.length} 次</span>
          </h2>
          {detail.limitUpHistory.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-dim2">数据窗口内无涨停记录</div>
          ) : (
            <div className="lb-scroll max-h-72 space-y-1 overflow-y-auto pr-1">
              {detail.limitUpHistory.map((r) => (
                <div
                  key={r.tradeDate}
                  className="num flex items-center gap-2.5 rounded-[3px] border border-line bg-hover px-3 py-2 text-[13px] tabular-nums"
                >
                  <span className="text-muted-foreground">{r.tradeDate}</span>
                  <span className="rounded-[2px] bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg2">
                    {r.boardCount}板
                  </span>
                  {r.daysAndBoards && <span className="text-[11px] text-dim2">{r.daysAndBoards}</span>}
                  <span className="ml-auto text-[11px] text-dim">
                    首封 {r.firstLimitTime?.slice(0, 5) ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 连板历史 */}
        <section className="panel p-4">
          <h2 className="mb-3 text-[13px] font-semibold text-foreground">连板历史（自主计算，可追溯）</h2>
          {detail.boardHistory.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-dim2">数据窗口内无连板记录</div>
          ) : (
            <div className="lb-scroll max-h-72 space-y-1 overflow-y-auto pr-1">
              {detail.boardHistory.map((r) => (
                <div
                  key={r.tradeDate}
                  className="num flex items-center gap-2.5 rounded-[3px] border border-line bg-hover px-3 py-2 text-[13px] tabular-nums"
                >
                  <span className="text-muted-foreground">{r.tradeDate}</span>
                  {r.isBreak ? (
                    <span className="rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[11px] text-fg2">
                      断板（昨日 {r.previousBoardCount} 板）
                    </span>
                  ) : (
                    <span className="rounded-[2px] bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg2">
                      {r.boardCount}板
                    </span>
                  )}
                  {r.isPromotion && <span className="text-[11px] text-dim">晋级</span>}
                  {r.isRebound && <span className="text-[11px] text-link-strong">反包</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 龙虎榜占位（第三阶段） */}
      <section className="rounded border border-dashed border-border bg-card/60 p-4">
        <h2 className="text-[13px] font-semibold text-fg2">龙虎榜</h2>
        <p className="mt-1.5 text-xs text-dim">
          龙虎榜与游资席位数据规划于第三阶段接入，届时将在此展示买卖席位、机构与游资动向。
        </p>
      </section>
    </div>
  );
}
