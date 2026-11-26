"use client";

// 主线追踪（首页内置模块，原 #/news 专项页已下线）
// 实时资讯 → 最新要闻解读 · 利好利空研判 · 受益标的
// 数据：新浪财经 7x24 快讯 + 个股新闻（后端调度器每日自动抓取入库），利好利空为透明关键词规则研判
// 受益标的：新闻命中的主线题材 × 当日该题材涨停股（按连板数排序）
import { useEffect, useState } from "react";
import { api, type NewsRow, type ReviewBundle } from "./api";
import { RefreshCw, Radio } from "lucide-react";

const IMPACT_META: Record<NewsRow["impact"], { text: string; cls: string }> = {
  good: { text: "利好", cls: "bg-up-soft text-up" },
  bad: { text: "利空", cls: "bg-down-soft text-down" },
  none: { text: "中性", cls: "bg-muted text-dim" },
};

/** A股提及股票 → 个股页链接（symbol: sh601238 → 601238） */
function cnCodeOf(symbol: string, market: string): string | null {
  if (market !== "cn") return null;
  const code = symbol.replace(/^(sh|sz|bj)/i, "");
  return /^\d{6}$/.test(code) ? code : null;
}

function NewsItemRow({ n, bundle, compact = false }: { n: NewsRow; bundle: ReviewBundle | null; compact?: boolean }) {
  const impact = IMPACT_META[n.impact];
  const themeSet = new Set(bundle?.concepts.map((c) => c.conceptName) ?? []);
  const beneficiaries = (theme: string) =>
    bundle?.concepts.find((c) => c.conceptName === theme)?.members?.slice(0, 6) ?? [];

  return (
    <div className="border-b border-line px-3.5 py-2 transition-colors last:border-0 hover:bg-hover">
      <div className="flex items-start gap-2">
        <span className="num shrink-0 pt-0.5 text-[11px] text-dim">{n.pubTime.slice(11, 16)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`shrink-0 rounded-[2px] px-1 text-[10px] leading-4 font-medium ${impact.cls}`}>{impact.text}</span>
            {n.kind === "stock" && (
              <span
                className="shrink-0 rounded-[2px] bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong"
                title="个股新闻（东财搜索，题材归类证据源）"
              >
                个股
              </span>
            )}
            {n.themes.map((t) => (
              <span
                key={t}
                className="shrink-0 rounded-[2px] bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong"
                title={`主线题材：${t}`}
              >
                {t}
              </span>
            ))}
            <span className="truncate text-[12px] font-medium text-foreground">{n.title ?? n.content.slice(0, 40)}</span>
          </div>
          {!compact && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{n.content}</p>
          )}
          {/* 受益标的：新闻题材 × 当日题材涨停股（详情页展示） */}
          {!compact && n.themes.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-dim">受益标的（当日题材内涨停，按连板）：</span>
              {n.themes.flatMap((t) =>
                beneficiaries(t).map((m) => (
                  <button
                    key={`${t}-${m.stockCode}`}
                    onClick={() => (location.hash = `#/stock/${m.stockCode}`)}
                    className="rounded-[2px] border border-border bg-card px-1 leading-4 text-fg2 hover:border-up-soft hover:text-up"
                    title={`${t} · ${m.industry ?? ""} · ${m.boardCount}板`}
                  >
                    {m.stockName}
                    {m.boardCount > 1 && <b className="ml-0.5 text-up">{m.boardCount}板</b>}
                  </button>
                ))
              )}
              {n.themes.every((t) => !themeSet.has(t)) && (
                <span className="text-dim2">该题材今日暂无涨停股</span>
              )}
            </div>
          )}
          {/* 数据源提及股票（ext 字段） */}
          {!compact && n.stocks.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-dim">提及：</span>
              {n.stocks.slice(0, 8).map((s, i) => {
                const code = cnCodeOf(s.symbol, s.market);
                return code ? (
                  <button
                    key={`${s.symbol}-${i}`}
                    onClick={() => (location.hash = `#/stock/${code}`)}
                    className="rounded-[2px] border border-border bg-card px-1 leading-4 text-fg2 hover:border-up-soft hover:text-up"
                  >
                    {s.key}
                  </button>
                ) : (
                  <span key={`${s.symbol}-${i}`} className="rounded-[2px] bg-muted px-1 leading-4 text-dim">
                    {s.key}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 首页主线追踪模块（12条要闻，每分钟自动刷新） */
export default function NewsTracker({ bundle }: { bundle: ReviewBundle }) {
  const [rows, setRows] = useState<NewsRow[]>([]);
  const [online, setOnline] = useState(true);
  const [fetchedAt, setFetchedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "good" | "bad" | "theme" | "stock">("all");

  const load = async () => {
    try {
      const r = await api.news(60);
      setRows(r.rows);
      setOnline(r.sourceOnline);
      setFetchedAt(r.fetchedAt);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const counts = {
    all: rows.length,
    theme: rows.filter((r) => r.themes.length > 0).length,
    good: rows.filter((r) => r.impact === "good").length,
    bad: rows.filter((r) => r.impact === "bad").length,
    stock: rows.filter((r) => r.kind === "stock").length,
  };
  const filtered = rows.filter((r) => {
    if (filter === "good") return r.impact === "good";
    if (filter === "bad") return r.impact === "bad";
    if (filter === "theme") return r.themes.length > 0;
    if (filter === "stock") return r.kind === "stock";
    return true;
  });

  return (
    <section aria-label="主线追踪" className="panel flex h-full flex-col">
      <div className="module-header">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Radio className="h-3.5 w-3.5 text-up" /> 主线追踪
        </h2>
        <span className={`text-[11px] ${online ? "text-dim" : "text-warn"}`}>
          {online ? `7x24 快讯 · 更新于 ${fetchedAt.slice(11, 16)}` : "数据源暂不可用"}
        </span>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="ml-auto flex items-center gap-1 text-[11px] text-link hover:underline"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> 刷新
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
        {(
          [
            { key: "all", label: "全部" },
            { key: "theme", label: "有关联主线" },
            { key: "stock", label: "个股新闻" },
            { key: "good", label: "利好" },
            { key: "bad", label: "利空" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`rounded-[3px] px-1.5 py-0.5 text-[11px] transition-colors ${
              filter === t.key ? "bg-up-soft font-medium text-up" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t.label}
            <span className="num ml-0.5 text-[10px] text-dim2">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto lb-scroll">
        {loading && rows.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-dim">快讯加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-dim">
            暂无快讯{online ? "" : "（数据源暂不可用）"}
          </div>
        ) : (
          filtered.slice(0, 12).map((n) => <NewsItemRow key={n.extId} n={n} bundle={bundle} />)
        )}
      </div>
      <div className="border-t border-line px-3.5 py-1.5 text-[10px] text-dim2">
        利好/利空为关键词规则自动研判，不构成投资建议 · 资讯由后端每日自动抓取入库 · 每分钟自动刷新
      </div>
    </section>
  );
}
