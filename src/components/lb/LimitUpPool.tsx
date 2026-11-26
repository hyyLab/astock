"use client";

// 今日涨停池（需求文档·十四）：独立大模块
// 筛选 tabs + 题材筛选 + 排序 + 搜索 + 分页；点击进入个股详情
import { useMemo, useState } from "react";
import type { LadderStock, ReviewBundle } from "./api";
import { fmtYi } from "./format";
import { ChevronDown } from "lucide-react";

/** 筛选口径（透明规则） */
const FILTERS = [
  { key: "all", label: "全部", match: (_: LadderStock) => true },
  { key: "fb", label: "首板", match: (s: LadderStock) => s.boardCount === 1 },
  { key: "b2", label: "2板", match: (s: LadderStock) => s.boardCount === 2 },
  { key: "b3", label: "3板", match: (s: LadderStock) => s.boardCount === 3 },
  { key: "b4", label: "4板+", match: (s: LadderStock) => s.boardCount >= 4 },
  { key: "yz", label: "一字板", match: (s: LadderStock) => s.firstLimitTime === "09:25:00" },
  { key: "hs", label: "换手板", match: (s: LadderStock) => (s.turnoverRate ?? 0) >= 15 },
  { key: "bl", label: "爆量", match: (s: LadderStock) => (s.volumeRatio ?? 0) >= 2 },
  { key: "gc", label: "高成交额", match: (s: LadderStock) => (s.amount ?? 0) >= 10e8 },
] as const;

type SortKey = "boardCount" | "firstLimitTime" | "amount" | "turnoverRate" | "sealAmount" | "volumeRatio";

export default function LimitUpPool({
  bundle,
  pageSize = 10,
  initialConcept = "",
  showConceptFilter = true,
}: {
  bundle: ReviewBundle;
  pageSize?: number;
  initialConcept?: string;
  showConceptFilter?: boolean;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [concept, setConcept] = useState(initialConcept);
  const [kw, setKw] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  const themeOptions = useMemo(() => {
    // 题材筛选选项 = 主线题材（优先）∪ 行业细分，主线上面的表示带珠标记
    const m = new Map<string, { n: number; isTheme: boolean }>();
    const bump = (name: string, isTheme: boolean) => {
      const prev = m.get(name);
      m.set(name, { n: (prev?.n ?? 0) + 1, isTheme: (prev?.isTheme ?? false) || isTheme });
    };
    for (const s of bundle.limitUp) {
      for (const t of s.themes ?? []) bump(t, true);
      if (s.industry) bump(s.industry, false);
    }
    const themeNames = new Set(bundle.concepts.map((c) => c.conceptName));
    return [...m.entries()]
      .sort((a, b) => Number(b[1].isTheme) - Number(a[1].isTheme) || b[1].n - a[1].n)
      .slice(0, 30)
      .map(([name, v]) => ({ name, n: v.n, isTheme: themeNames.has(name) }));
  }, [bundle]);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    let list = bundle.limitUp.filter(f.match);
    if (concept) list = list.filter((s) => (s.themes ?? []).includes(concept) || s.industry === concept);
    const k = kw.trim().toLowerCase();
    if (k) list = list.filter((s) => s.stockCode.includes(k) || s.stockName.toLowerCase().includes(k));
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const va = a[sortKey] ?? (sortKey === "firstLimitTime" ? "99:99:99" : -1);
        const vb = b[sortKey] ?? (sortKey === "firstLimitTime" ? "99:99:99" : -1);
        if (va === vb) return 0;
        const r = va > vb ? 1 : -1;
        return sortAsc ? r : -r;
      });
    }
    return list;
  }, [bundle, filter, concept, kw, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = rows.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
    setPage(1);
  };

  const th = (label: string, key?: SortKey, cls = "") => (
    <th
      className={`whitespace-nowrap px-2 py-1.5 text-right font-normal ${key ? "cursor-pointer select-none hover:text-foreground" : ""} ${cls}`}
      onClick={key ? () => toggleSort(key) : undefined}
    >
      {label}
      {key && sortKey === key && <span className="ml-0.5 text-[9px]">{sortAsc ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <section aria-label="今日涨停池" className="panel">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">今日涨停池</h2>
        <span className="num text-[11px] text-dim">
          {bundle.limitUp.length} 家 · 首板 {bundle.limitUp.filter((s) => s.boardCount === 1).length} · 连板{" "}
          {bundle.limitUp.filter((s) => s.boardCount >= 2).length}
        </span>
      </div>

      {/* 筛选行 */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-line px-3.5 py-2">
        {FILTERS.map((f) => {
          const n = bundle.limitUp.filter(f.match).length;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={`rounded-[3px] px-2 py-1 text-[12px] transition-colors ${
                active ? "bg-up-soft font-medium text-up" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
              <span className="num ml-1 text-[10px] text-dim2">{n}</span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {showConceptFilter && themeOptions.length > 0 && (
            <div className="relative">
              <select
                value={concept}
                onChange={(e) => {
                  setConcept(e.target.value);
                  setPage(1);
                }}
                aria-label="题材筛选"
                className="h-7 appearance-none rounded-[3px] border border-border bg-card pl-2 pr-6 text-[12px] text-fg2 focus:border-link-soft focus:outline-none"
              >
                <option value="">全部题材</option>
                {themeOptions.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.isTheme ? "★ " : ""}
                    {t.name} ({t.n})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-dim" />
            </div>
          )}
          <input
            value={kw}
            onChange={(e) => {
              setKw(e.target.value);
              setPage(1);
            }}
            placeholder="搜索名称/代码"
            aria-label="涨停池搜索"
            className="h-7 w-32 rounded-[3px] border border-border bg-subtle px-2 text-[12px] text-foreground placeholder:text-dim2 focus:border-link-soft focus:bg-card focus:outline-none"
          />
        </div>
      </div>

      {/* 表格 */}
      <div className="lb-scroll overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-dim">
              <th className="px-2 py-1.5 text-left font-normal">股票</th>
              {th("连板", "boardCount")}
              {th("涨停时间", "firstLimitTime")}
              <th className="px-2 py-1.5 text-left font-normal">题材(主线★)</th>
              {th("成交额(亿)", "amount")}
              {th("换手", "turnoverRate")}
              {th("封单(亿)", "sealAmount")}
              {th("量比", "volumeRatio")}
              <th className="px-2 py-1.5 text-center font-normal">标记</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-[12px] text-dim">
                  无符合条件的涨停股
                </td>
              </tr>
            ) : (
              pageRows.map((s) => (
                <tr
                  key={s.stockCode}
                  onClick={() => (location.hash = `#/stock/${s.stockCode}`)}
                  className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
                >
                  <td className="px-2 py-1.5">
                    <span className="font-medium text-foreground">{s.stockName}</span>
                    <span className="num ml-1.5 text-[11px] text-dim2">{s.stockCode}</span>
                  </td>
                  <td className="num px-2 py-1.5 text-right font-semibold tabular-nums text-up">
                    {s.boardCount > 1 ? `${s.boardCount}板` : "首板"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {s.firstLimitTime ? s.firstLimitTime.slice(0, 5) : "—"}
                  </td>
                  <td className="max-w-[150px] truncate px-2 py-1.5" title={[...(s.themes ?? []), s.industry ?? ""].filter(Boolean).join(" / ")}>
                    {(s.themes ?? []).length > 0 ? (
                      <span className="text-link-strong">{s.themes.slice(0, 2).join("·")}</span>
                    ) : (
                      <span className="text-muted-foreground">{s.industry ?? "—"}</span>
                    )}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{fmtYi(s.amount)}</td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                    {s.turnoverRate != null ? `${s.turnoverRate.toFixed(1)}%` : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">
                    {s.sealAmount != null ? (s.sealAmount / 1e8).toFixed(2) : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-right tabular-nums">
                    {s.volumeRatio != null ? (
                      <span className={s.volumeRatio >= 2 ? "font-medium text-warn" : "text-muted-foreground"}>
                        {s.volumeRatio.toFixed(1)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-center">
                    {s.isPromotion && (
                      <span className="rounded-[2px] bg-up-soft px-1 text-[10px] leading-4 text-up">晋级</span>
                    )}
                    {s.isRebound && (
                      <span className="ml-1 rounded-[2px] bg-link-soft-bg px-1 text-[10px] leading-4 text-link-strong">反包</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {rows.length > pageSize && (
        <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[11px] text-dim">
          <span className="num">
            共 {rows.length} 家 · 第 {pageSafe}/{totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageSafe <= 1}
              className="rounded-[3px] border border-border px-2 py-1 text-fg2 hover:bg-muted disabled:text-dim2 disabled:hover:bg-transparent"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageSafe >= totalPages}
              className="rounded-[3px] border border-border px-2 py-1 text-fg2 hover:bg-muted disabled:text-dim2 disabled:hover:bg-transparent"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
