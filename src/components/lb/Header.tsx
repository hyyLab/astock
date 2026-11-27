"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { api } from "./api";
import { Loader2, Search, Sun, Moon } from "lucide-react";

export interface Route {
  // 历史日期不再独立成页：#/review/{date} 深链归一到 today 视图（带 date 初始值），
  // 首页内通过日期栏/日历切换日期，URL 保持 #/ 不变
  view: "today" | "stock" | "ladder" | "concepts" | "limitup" | "volume" | "volumehold" | "anomaly" | "dragon" | "stocks" | "us" | "strategy" | "briefing";
  date?: string;
  code?: string;
  concept?: string;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const params = new URLSearchParams(query ?? "");
  if (path.startsWith("stock/")) return { view: "stock", code: path.slice(6) };
  if (path.startsWith("review/")) return { view: "today", date: path.slice(7) };
  if (path === "ladder") return { view: "ladder" };
  if (path === "concepts") return { view: "concepts" };
  if (path === "limit-up") return { view: "limitup", concept: params.get("concept") ?? undefined };
  if (path === "volume") return { view: "volume" };
  if (path === "volume-hold") return { view: "volumehold" };
  if (path === "anomaly") return { view: "anomaly" };
  if (path === "dragon") return { view: "dragon" };
  if (path === "stocks") return { view: "stocks" };
  if (path === "us") return { view: "us" };
  if (path === "strategy") return { view: "strategy" };
  if (path === "briefing") return { view: "briefing" };
  return { view: "today" };
}

const NAV_ITEMS: { key: Route["view"]; label: string; hash: string }[] = [
  { key: "today", label: "今日复盘", hash: "#/" },
  { key: "ladder", label: "连板天梯", hash: "#/ladder" },
  { key: "concepts", label: "主线题材", hash: "#/concepts" },
  { key: "limitup", label: "涨停池", hash: "#/limit-up" },
  { key: "volume", label: "爆量", hash: "#/volume" },
  { key: "volumehold", label: "爆量不跌", hash: "#/volume-hold" },
  { key: "anomaly", label: "异动监控", hash: "#/anomaly" },
  { key: "us", label: "美股映射", hash: "#/us" },
  { key: "strategy", label: "战法验证", hash: "#/strategy" },
  { key: "briefing", label: "作战简报", hash: "#/briefing" },
  { key: "stocks", label: "个股", hash: "#/stocks" },
];

export default function Header({ route, navigation = true }: { route: Route; navigation?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ stockCode: string; stockName: string; industry: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const kw = q.trim();
    if (!kw) {
      setResults([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setSearching(true);
        const r = await api.search(kw);
        setResults(r.rows);
        setOpen(true);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const nav = (hash: string) => {
    location.hash = hash;
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[#0D1319]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center gap-4 px-4 md:gap-6 md:px-8">
        <button
          onClick={() => nav("#/")}
          className="flex shrink-0 items-center gap-2"
          aria-label="返回今日复盘"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#34434D] bg-[#18232B] text-[14px] font-bold tracking-tight text-primary">
            A
          </span>
          <span className="hidden text-[15px] font-semibold tracking-[0.14em] text-foreground sm:inline">
            ASTOCK
          </span>
        </button>

        {navigation && (
        <nav className="lb-scroll flex flex-1 items-center gap-0.5 overflow-x-auto text-[13px]" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const active = route.view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => nav(item.hash)}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap border-b-2 px-2 py-1.5 transition-colors md:px-2.5 ${
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        )}

        <ThemeToggle mounted={mounted} resolvedTheme={resolvedTheme} setTheme={setTheme} />

        <div className="ml-auto w-full max-w-[440px] shrink min-w-[180px]" ref={boxRef}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="搜索代码 / 名称"
              aria-label="搜索股票"
              className="h-10 w-full rounded-lg border border-border bg-[#111921] pl-9 pr-8 text-[13px] text-foreground placeholder:text-dim focus:border-primary focus:bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            {searching && (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-dim" />
            )}
            {open && (
              <div className="lb-scroll absolute right-0 top-9 z-50 max-h-72 w-72 overflow-y-auto rounded-[4px] border border-border bg-card shadow-lg shadow-black/5">
                {results.length === 0 ? (
                  <div className="px-3 py-3 text-center text-xs text-dim">无匹配结果</div>
                ) : (
                  results.map((r) => (
                    <button
                      key={r.stockCode}
                      onClick={() => {
                        nav(`#/stock/${r.stockCode}`);
                        setOpen(false);
                        setQ("");
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-subtle"
                    >
                      <span className="font-medium text-foreground">{r.stockName}</span>
                      <span className="num text-dim">{r.stockCode}</span>
                      <span className="ml-auto text-xs text-dim2">{r.industry ?? ""}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * 明暗主题切换（克制：线性图标按钮）
 * 水合一致性：aria-label/title/图标必须统一由 mounted 门控——
 * SSR 时 resolvedTheme 为 undefined，而客户端首帧 next-themes 已能从 localStorage
 * 读出 "dark"，若属性直接读 resolvedTheme 会导致首帧属性不一致（React 19 水合警告）。
 */
function ThemeToggle({
  mounted,
  resolvedTheme,
  setTheme,
}: {
  mounted: boolean;
  resolvedTheme: string | undefined;
  setTheme: (t: string) => void;
}) {
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "切换到亮色主题" : "切换到暗色主题"}
      title={dark ? "切换到亮色主题" : "切换到暗色主题"}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-fg2 transition-colors hover:bg-muted hover:text-primary"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
