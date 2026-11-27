"use client";

// 断板池（需求文档·十八）：昨日高标今日表现，补充连板天梯
// 范围：昨日涨停今日未涨停（断板/炸板/跌停）；标签：高位/低位断板 + 今日状态
import type { ReviewBundle } from "./api";
import { fmtPct, fmtYi, pctClass } from "./format";

export default function BrokenPool({ bundle }: { bundle: ReviewBundle }) {
  // 昨日高标汇总：晋级（含反包）人数
  const promotedCount = bundle.yesterdayPerf.filter((r) => r.todayStatus === "promoted").length;
  // 断板池：昨日涨停今日未涨停
  const rows = bundle.yesterdayPerf
    .filter((r) => r.todayStatus === "break" || r.todayStatus === "broken" || r.todayStatus === "limitdown")
    .sort((a, b) => b.yesterdayBoardCount - a.yesterdayBoardCount || (b.todayChangePct ?? -99) - (a.todayChangePct ?? -99));

  const statusTag = (status: string) => {
    if (status === "broken") return { text: "炸板", cls: "bg-warn-soft text-warn-strong border-warn-soft" };
    if (status === "limitdown") return { text: "跌停", cls: "bg-muted text-fg2 border-border" };
    return { text: "断板", cls: "bg-muted text-muted-foreground border-line" };
  };

  return (
    <section aria-label="断板池" className="panel">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">断板池</h2>
        <span className="num text-[11px] text-dim">
          昨日涨停 {bundle.yesterdayPerf.length} 家 → 今日晋级 {promotedCount} · 断板 {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-dim">昨日涨停股全部晋级或停牌，无断板</div>
      ) : (
        <div className="lb-scroll max-h-[340px] overflow-y-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-line text-[11px] text-dim">
                <th className="px-3.5 py-1.5 text-left font-normal">股票</th>
                <th className="px-2 py-1.5 text-right font-normal">昨日</th>
                <th className="px-2 py-1.5 text-center font-normal">今日</th>
                <th className="px-2 py-1.5 text-right font-normal">今日涨跌</th>
                <th className="px-2 py-1.5 text-right font-normal">成交额(亿)</th>
                <th className="px-3.5 py-1.5 text-left font-normal">题材</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = statusTag(r.todayStatus);
                const high = r.yesterdayBoardCount >= 3;
                return (
                  <tr
                    key={r.stockCode}
                    onClick={() => (location.hash = `#/stock/${r.stockCode}`)}
                    className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover"
                  >
                    <td className="px-3.5 py-1.5">
                      <span className="font-medium text-foreground">{r.stockName}</span>
                      <span className="num ml-1.5 text-[11px] text-dim2">{r.stockCode}</span>
                    </td>
                    <td className="num px-2 py-1.5 text-right tabular-nums text-fg2">{r.yesterdayBoardCount}板</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">
                      <span className={`rounded-[2px] border px-1 text-[10px] leading-4 ${tag.cls}`}>{tag.text}</span>
                      <span
                        className={`ml-1 rounded-[2px] px-1 text-[10px] leading-4 ${
                          high ? "bg-warn-soft text-warn-strong" : "bg-muted text-dim"
                        }`}
                      >
                        {high ? "高位" : "低位"}
                      </span>
                    </td>
                    <td className={`num px-2 py-1.5 text-right font-medium tabular-nums ${pctClass(r.todayChangePct)}`}>
                      {fmtPct(r.todayChangePct)}
                    </td>
                    <td className="num px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtYi(r.amount)}
                    </td>
                    <td className="max-w-[140px] truncate px-3.5 py-1.5 text-dim" title={r.industry ?? ""}>
                      {r.industry ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
