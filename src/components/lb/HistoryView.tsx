"use client";

// 历史复盘：日期选择（[<] 日期 [>] + 交易日列表），方案第十九步
import { useEffect, useState } from "react";
import { api } from "./api";
import ReviewView from "./ReviewView";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

export default function HistoryView({ date }: { date: string }) {
  const [dates, setDates] = useState<string[]>([]);
  // 空日期（#/review/）→ 自动跳转最新交易日
  useEffect(() => {
    if (date) return;
    api
      .calendar()
      .then((r) => {
        if (r.latest) location.replace(`#/review/${r.latest}`);
      })
      .catch(() => {});
  }, [date]);

  useEffect(() => {
    api.calendar().then((r) => setDates(r.dates)).catch(() => setDates([]));
  }, []);

  if (!date) return null;
  const current = date;

  const idx = dates.indexOf(current);
  const prev = idx > 0 ? dates[idx - 1] : null;
  const next = idx >= 0 && idx < dates.length - 1 ? dates[idx + 1] : null;

  const nav = (d: string | null) => {
    if (d) location.hash = `#/review/${d}`;
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1c2536] bg-[#0f1522] px-3 py-2.5">
        <CalendarDays className="h-4 w-4 text-slate-500" />
        <button
          onClick={() => nav(prev)}
          disabled={!prev}
          aria-label="前一交易日"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#1c2536] text-slate-400 enabled:hover:bg-white/5 enabled:hover:text-slate-200 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[110px] text-center font-mono text-sm font-semibold tabular-nums text-slate-100">
          {current}
        </span>
        <button
          onClick={() => nav(next)}
          disabled={!next}
          aria-label="后一交易日"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#1c2536] text-slate-400 enabled:hover:bg-white/5 enabled:hover:text-slate-200 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {idx === dates.length - 1 && (
          <span className="rounded bg-[#f6465d]/12 px-1.5 py-0.5 text-[11px] text-[#ff8a97]">最新</span>
        )}
        <div className="flex flex-1 flex-wrap justify-end gap-1">
          {dates.slice(-10).map((d) => (
            <button
              key={d}
              onClick={() => nav(d)}
              className={`rounded px-2 py-1 font-mono text-[11px] tabular-nums transition-colors ${
                d === current
                  ? "bg-[#f6465d]/15 text-[#ff8a97]"
                  : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
              }`}
            >
              {d.slice(5)}
            </button>
          ))}
        </div>
      </div>
      <ReviewView initialDate={current} />
    </div>
  );
}
