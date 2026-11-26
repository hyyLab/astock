"use client";

// 主线题材排行榜（方案第十六步布局：主线题材排行榜）
import { fmtYi } from "./format";
import type { ReviewBundle } from "./api";

export default function ConceptRanking({ bundle }: { bundle: ReviewBundle }) {
  const rows = bundle.concepts;
  const maxStrength = Math.max(1, ...rows.map((r) => r.strengthScore));

  return (
    <section aria-label="主线题材" className="rounded-xl border border-[#1c2536] bg-[#0f1522] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">主线题材</h2>
        <span className="text-[11px] text-slate-500">按强度分排序 · 强度=涨停家数/高度/梯队/封板质量加权</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-600">当日无题材数据</div>
      ) : (
        <div className="overflow-x-auto [scrollbar-color:#2a3550_transparent] [scrollbar-width:thin]">
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#1c2536] text-[11px] text-slate-500">
                <th className="py-2 pr-2 font-normal">题材</th>
                <th className="py-2 pr-2 text-right font-normal">涨停</th>
                <th className="py-2 pr-2 text-right font-normal">连板</th>
                <th className="py-2 pr-2 text-right font-normal">最高板</th>
                <th className="py-2 pr-2 font-normal">龙头</th>
                <th className="py-2 pr-2 text-right font-normal">炸板</th>
                <th className="py-2 pr-2 text-right font-normal">成交额</th>
                <th className="py-2 font-normal">强度</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r, i) => (
                <tr
                  key={r.conceptName}
                  className={`border-b border-[#131a2a] transition-colors hover:bg-white/[0.025] ${
                    i === 0 ? "bg-amber-500/[0.04]" : ""
                  }`}
                >
                  <td className="py-2 pr-2">
                    <span className={`font-medium ${i === 0 ? "text-amber-300" : "text-slate-200"}`}>
                      {r.conceptName}
                    </span>
                    {i === 0 && (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-300">
                        主线
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums text-[#ff8a97]">{r.limitUpCount}</td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-300">{r.boardCount}</td>
                  <td className="py-2 pr-2 text-right">
                    <span
                      className={`inline-block min-w-7 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums ${
                        r.highestBoard >= 4
                          ? "bg-[#f6465d]/20 text-[#ff8a97]"
                          : r.highestBoard >= 2
                            ? "bg-[#f6465d]/10 text-[#ff9aa6]"
                            : "bg-white/5 text-slate-400"
                      }`}
                    >
                      {r.highestBoard}板
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    {r.leaderCode ? (
                      <button
                        onClick={() => (location.hash = `#/stock/${r.leaderCode}`)}
                        className="text-slate-300 underline-offset-2 hover:text-[#ff8a97] hover:underline"
                      >
                        {r.leaderName}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums text-amber-400/80">
                    {r.brokenCount || "—"}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-400">
                    {fmtYi(r.totalAmount != null ? r.totalAmount * 1e8 : null, 1)}亿
                  </td>
                  <td className="w-[130px] py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1a2233]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-[#f6465d]"
                          style={{ width: `${(r.strengthScore / maxStrength) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-[11px] tabular-nums text-slate-400">
                        {r.strengthScore}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
