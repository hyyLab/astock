"use client";

// 交易日日历（弹层）：月历网格，仅有数据的交易日可点击
// 数据源：/api/review/calendar（库内有行情数据的交易日）
// includeToday：今天（工作日）即使无收盘数据也可选——异动监控等盘中实时页用，
// 选中后页面展示今天的实时口径数据，无需等收盘采集
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { ChevronLeft } from "lucide-react";

/** 北京时间今天（YYYY-MM-DD），与后端调度器口径一致 */
export function bjToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

export default function TradeCalendar({
  selected,
  onPick,
  includeToday = false,
}: {
  selected: string;
  onPick: (date: string) => void;
  includeToday?: boolean;
}) {
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [latest, setLatest] = useState("");
  const [ym, setYm] = useState(() => monthOf(selected || bjToday()));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .calendar()
      .then((r) => {
        if (!alive) return;
        setDates(new Set(r.dates));
        setLatest(r.latest);
      })
      .catch(() => {
        if (alive) setDates(new Set());
      });
    return () => {
      alive = false;
    };
  }, []);

  // 月历网格：周一开头，前导空位 + 每日
  const cells = useMemo(() => {
    const [y, m] = ym.split("-").map(Number);
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out: ({ date: string; day: number } | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: `${ym}-${String(d).padStart(2, "0")}`, day: d });
    }
    return out;
  }, [ym]);

  const minMonth = dates && dates.size > 0 ? monthOf([...dates][0]) : null;
  const today = bjToday();
  // 今天为工作日且页面支持盘中实时 → 今天可选（即使库内无收盘数据）
  const todayWeekday = (() => {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  })();
  const todaySelectable = includeToday && todayWeekday;
  const maxDate = [latest, todaySelectable ? today : ""].filter(Boolean).sort().at(-1) ?? "";
  const maxMonth = maxDate ? monthOf(maxDate) : null;

  const canPrev = minMonth === null || ym > minMonth;
  const canNext = maxMonth === null || ym < maxMonth;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="选择复盘交易日"
      className="absolute left-0 top-full z-50 mt-1 w-[280px] rounded-[4px] border border-border bg-card shadow-lg shadow-black/10"
    >
      {/* 月份导航 */}
      <div className="flex items-center justify-between border-b border-line px-2 py-1.5">
        <button
          onClick={() => canPrev && shiftMonth(-1)}
          disabled={!canPrev}
          aria-label="上一月"
          className="flex h-6 w-6 items-center justify-center rounded-[3px] text-fg2 transition-colors hover:bg-muted disabled:text-dim2 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="num text-[13px] font-semibold text-foreground">{monthLabel(ym)}</span>
        <button
          onClick={() => canNext && shiftMonth(1)}
          disabled={!canNext}
          aria-label="下一月"
          className="flex h-6 w-6 items-center justify-center rounded-[3px] text-fg2 transition-colors hover:bg-muted disabled:text-dim2 disabled:hover:bg-transparent"
        >
          <span className="rotate-180">
            <ChevronLeft className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* 星期表头 */}
      <div className="grid grid-cols-7 border-b border-line px-2 py-1 text-center text-[10px] text-dim2">
        {WEEK_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {/* 日网格 */}
      {dates === null ? (
        <div className="py-10 text-center text-[12px] text-dim">日历加载中…</div>
      ) : (
        <div className="grid grid-cols-7 gap-y-0.5 px-2 py-2 text-center text-[12px]">
          {cells.map((c, i) => {
            if (!c) return <span key={`b${i}`} />;
            const inData = dates.has(c.date);
            const isTodayCell = c.date === today;
            const trading = inData || (todaySelectable && isTodayCell);
            const isSelected = c.date === selected;
            if (isSelected) {
              return (
                <span key={c.date} className="mx-auto flex h-7 w-7 items-center justify-center rounded-[3px] bg-up font-semibold text-white" title={c.date}>
                  {c.day}
                </span>
              );
            }
            if (trading) {
              return (
                <button
                  key={c.date}
                  onClick={() => onPick(c.date)}
                  className={`mx-auto flex h-7 w-7 items-center justify-center rounded-[3px] transition-colors hover:bg-muted text-foreground ${
                    isTodayCell
                      ? inData
                        ? "font-semibold text-up"
                        : "border border-up/60 font-semibold text-up"
                      : ""
                  }`}
                  title={isTodayCell && !inData ? `${c.date} 今日 · 盘中实时` : `${c.date} 复盘`}
                >
                  {c.day}
                </button>
              );
            }
            return (
              <span key={c.date} className="relative mx-auto flex h-7 w-7 cursor-default items-center justify-center rounded-[3px] text-dim2">
                {c.day}
                {isTodayCell && !todaySelectable && <span className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-up" />}
              </span>
            );
          })}
        </div>
      )}

      <div className="border-t border-line px-3 py-1.5 text-[10px] text-dim2">
        {dates && dates.size > 0
          ? `共 ${dates.size} 个交易日 · 深色数字可点击（最新 ${latest}）${todaySelectable && !dates.has(today) ? " · 今日可看盘中实时" : ""}`
          : todaySelectable
            ? `今日（${today}）可看盘中实时`
            : "暂无交易日数据，请先执行采集"}
      </div>
    </div>
  );

  function shiftMonth(delta: number) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setYm(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
}
