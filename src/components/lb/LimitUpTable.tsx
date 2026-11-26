"use client";

// 涨停股票列表（方案字段清单：涨停股票），Tabs: 全部/首板/连板/炸板
import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtYi, fmtPct, pctClass } from "./format";
import type { LadderStock, ReviewBundle } from "./api";

type Scope = "all" | "first" | "lianban" | "broken";

export default function LimitUpTable({ bundle }: { bundle: ReviewBundle }) {
  const [scope, setScope] = useState<Scope>("all");

  const rows: LadderStock[] = useMemo(() => {
    if (scope === "first") return bundle.limitUp.filter((r) => r.boardCount === 1);
    if (scope === "lianban") return bundle.limitUp.filter((r) => r.boardCount >= 2);
    if (scope === "broken") return bundle.broken;
    return bundle.limitUp;
  }, [scope, bundle]);

  const counts = {
    all: bundle.limitUp.length,
    first: bundle.limitUp.filter((r) => r.boardCount === 1).length,
    lianban: bundle.limitUp.filter((r) => r.boardCount >= 2).length,
    broken: bundle.broken.length,
  };

  return (
    <section aria-label="涨停股票列表" className="rounded-xl border border-[#1c2536] bg-[#0f1522] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">
          {scope === "broken" ? "炸板股票" : "涨停股票"}
        </h2>
        <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
          <TabsList className="h-8 bg-[#0c1220] p-0.5">
            <TabsTrigger value="all" className="h-7 px-3 text-xs data-[state=active]:bg-[#1c2536] data-[state=active]:text-slate-100">
              全部 {counts.all}
            </TabsTrigger>
            <TabsTrigger value="first" className="h-7 px-3 text-xs data-[state=active]:bg-[#1c2536] data-[state=active]:text-slate-100">
              首板 {counts.first}
            </TabsTrigger>
            <TabsTrigger value="lianban" className="h-7 px-3 text-xs data-[state=active]:bg-[#1c2536] data-[state=active]:text-slate-100">
              连板 {counts.lianban}
            </TabsTrigger>
            <TabsTrigger value="broken" className="h-7 px-3 text-xs data-[state=active]:bg-[#1c2536] data-[state=active]:text-slate-100">
              炸板 {counts.broken}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="max-h-[560px] overflow-auto [scrollbar-color:#2a3550_transparent] [scrollbar-width:thin]">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-[#0f1522]">
            <tr className="border-b border-[#1c2536] text-[11px] text-slate-500">
              <th className="py-2 pr-2 font-normal">股票</th>
              <th className="py-2 pr-2 text-right font-normal">涨跌幅</th>
              <th className="py-2 pr-2 text-center font-normal">连板</th>
              <th className="py-2 pr-2 font-normal">几天几板</th>
              <th className="py-2 pr-2 font-normal">首次封板</th>
              <th className="py-2 pr-2 text-right font-normal">炸板次</th>
              <th className="py-2 pr-2 text-right font-normal">成交额</th>
              <th className="py-2 pr-2 text-right font-normal">换手</th>
              <th className="py-2 pr-2 text-right font-normal">流通市值</th>
              <th className="py-2 font-normal">题材/行业</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-slate-600">
                  暂无数据
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.stockCode}
                onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
                className="cursor-pointer border-b border-[#131a2a] transition-colors hover:bg-white/[0.035]"
              >
                <td className="py-2 pr-2">
                  <span className="font-medium text-slate-200">{r.stockName}</span>
                  <span className="ml-1.5 font-mono text-[11px] text-slate-600">{r.stockCode}</span>
                  {r.isPromotion && (
                    <span className="ml-1.5 rounded border border-[#f6465d]/30 bg-[#f6465d]/10 px-1 text-[10px] text-[#ff8a97]">
                      晋级
                    </span>
                  )}
                  {r.isRebound && (
                    <span className="ml-1.5 rounded border border-purple-400/30 bg-purple-400/10 px-1 text-[10px] text-purple-300">
                      反包
                    </span>
                  )}
                </td>
                <td className={`py-2 pr-2 text-right font-mono tabular-nums ${pctClass(r.changePct)}`}>
                  {fmtPct(r.changePct)}
                </td>
                <td className="py-2 pr-2 text-center">
                  <span
                    className={`inline-block min-w-7 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums ${
                      r.boardCount >= 3
                        ? "bg-[#f6465d]/20 text-[#ff8a97]"
                        : r.boardCount >= 2
                          ? "bg-[#f6465d]/10 text-[#ff9aa6]"
                          : scope === "broken"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-white/5 text-slate-400"
                    }`}
                  >
                    {scope === "broken" ? "炸" : `${r.boardCount}板`}
                  </span>
                </td>
                <td className="py-2 pr-2 text-[12px] text-slate-500">{r.daysAndBoards ?? "—"}</td>
                <td className="py-2 pr-2 font-mono text-[12px] tabular-nums text-slate-400">
                  {r.firstLimitTime?.slice(0, 5) ?? "—"}
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums text-amber-400/80">
                  {r.openCount || "—"}
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-300">
                  {fmtYi(r.amount, 1)}亿
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-400">
                  {r.turnoverRate != null ? `${r.turnoverRate.toFixed(1)}%` : "—"}
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-400">
                  {fmtYi(r.floatMarketCap, 0)}亿
                </td>
                <td className="py-2 text-slate-500">{r.industry ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
