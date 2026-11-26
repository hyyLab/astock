"use client";

// 个股浏览页：搜索入口 + 今日涨停股 / 断板股 快速索引
import { useEffect, useState } from "react";
import { api } from "./api";
import { useReview, LoadingState } from "./useReview";
import { Loader2, Search } from "lucide-react";

export default function StocksView() {
  const { bundle, stale } = useReview();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ stockCode: string; stockName: string; industry: string | null }[]>([]);
  const [searching, setSearching] = useState(false);

  // 全库搜索（防抖）
  useEffect(() => {
    const kw = q.trim();
    if (!kw) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setSearching(true);
        const r = await api.search(kw);
        setResults(r.rows);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (stale) return <LoadingState />;

  const lianban = bundle?.limitUp.filter((s) => s.boardCount >= 2) ?? [];
  const firsts = bundle?.limitUp.filter((s) => s.boardCount === 1) ?? [];

  return (
    <div className="space-y-3">
      {/* 搜索 */}
      <section className="panel px-3.5 py-3">
        <div className="relative mx-auto max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入股票代码或名称，如 600000 / 新华文轩"
            aria-label="搜索股票"
            className="h-10 w-full rounded-[4px] border border-border bg-subtle pl-9 pr-9 text-[13px] text-foreground placeholder:text-dim2 focus:border-link-soft focus:bg-card focus:outline-none"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-dim" />
          )}
          {results.length > 0 && (
            <div className="lb-scroll absolute inset-x-0 top-11 z-30 max-h-72 overflow-y-auto rounded-[4px] border border-border bg-card shadow-lg">
              {results.map((r) => (
                <button
                  key={r.stockCode}
                  onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-subtle"
                >
                  <span className="font-medium text-foreground">{r.stockName}</span>
                  <span className="num text-dim">{r.stockCode}</span>
                  <span className="ml-auto text-xs text-dim2">{r.industry ?? ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 今日连板股 */}
      {bundle && (
        <>
          <section className="panel">
            <div className="module-header">
              <h2 className="text-[13px] font-semibold text-foreground">今日连板股</h2>
              <span className="num text-[11px] text-dim">{lianban.length} 家</span>
            </div>
            <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
              {lianban.length === 0 && <span className="text-[12px] text-dim2">今日无连板股</span>}
              {lianban.map((s) => (
                <button
                  key={s.stockCode}
                  onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                  className="num rounded-[3px] border border-up-soft bg-up-soft px-2 py-1 text-[12px] text-fg2 hover:bg-card"
                >
                  <span className="font-medium">{s.stockName}</span>
                  <span className="ml-1 text-up">{s.boardCount}板</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="module-header">
              <h2 className="text-[13px] font-semibold text-foreground">今日首板股</h2>
              <span className="num text-[11px] text-dim">{firsts.length} 家</span>
            </div>
            <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
              {firsts.map((s) => (
                <button
                  key={s.stockCode}
                  onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                  className="rounded-[3px] border border-border bg-card px-2 py-1 text-[12px] text-fg2 hover:border-up-soft"
                  title={s.industry ?? ""}
                >
                  {s.stockName}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
