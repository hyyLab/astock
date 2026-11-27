"use client";

// 日期导航行：交易日期 + 周几 + 交易日日历选择 + 上一/下一交易日 + 今日/历史标识（需求文档·五）
// 历史日期不再独立成页：onNav 由父组件在页面内切换数据，URL 保持不变
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, CalendarDays } from "lucide-react";
import { weekdayOf } from "./format";
import TradeCalendar from "./TradeCalendar";

// 日期导航行所需的最小字段（ReviewBundle / AnomalyData 均满足，便于多页面复用）
// today/liveMode 为可选扩展：提供时徽章按「今日·盘中 / 今日 / 最新 / 历史复盘」四态展示，
// 且日历允许直接选中今天（盘中实时数据可见，无需等收盘采集）
export interface DateBarBundle {
  tradeDate: string;
  latestDate: string;
  prevDate: string | null;
  nextDate: string | null;
  isLatest: boolean;
  today?: string;
  liveMode?: boolean;
}

export default function DateBar({ bundle, onNav }: { bundle: DateBarBundle; onNav?: (date: string) => void }) {
  const [calOpen, setCalOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const nav = (date: string | null) => {
    if (!date) return;
    setCalOpen(false);
    if (onNav) onNav(date);
    else location.hash = `#/review/${date}`;
  };

  // 徽章四态：今日·盘中（实时口径） / 今日（收盘口径） / 最新 / 历史复盘
  const isToday = bundle.today != null && bundle.tradeDate === bundle.today;
  const badge =
    bundle.today == null
      ? bundle.isLatest
        ? "今日"
        : "历史复盘"
      : isToday
        ? bundle.liveMode
          ? "今日 · 盘中"
          : "今日"
        : bundle.tradeDate === bundle.latestDate
          ? "最新"
          : "历史复盘";

  // 点击日历弹层外部 / Esc 关闭
  useEffect(() => {
    if (!calOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setCalOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCalOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [calOpen]);

  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 py-2">
      <div ref={boxRef} className="relative">
        <button
          onClick={() => setCalOpen((v) => !v)}
          aria-expanded={calOpen}
          aria-haspopup="dialog"
          className="flex items-baseline gap-2 rounded-[3px] px-1.5 py-0.5 transition-colors hover:bg-muted"
          aria-label="选择复盘交易日"
        >
          <span className="num text-[15px] font-bold text-foreground">{bundle.tradeDate}</span>
          <span className="text-[12px] text-dim">{weekdayOf(bundle.tradeDate)}</span>
          <CalendarDays className="h-3.5 w-3.5 self-center text-dim" />
          {badge === "今日 · 盘中" ? (
            <span className="flex items-center gap-1 rounded-[3px] bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-medium text-fg2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              今日 · 盘中
            </span>
          ) : badge === "今日" ? (
            <span className="rounded-[3px] bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-medium text-fg2">今日</span>
          ) : badge === "最新" ? (
            <span className="rounded-[3px] bg-muted px-1.5 py-0.5 text-[11px] font-medium text-fg2">最新</span>
          ) : (
            <span className="rounded-[3px] bg-muted px-1.5 py-0.5 text-[11px] font-medium text-fg2">
              历史复盘
            </span>
          )}
        </button>
        {calOpen && <TradeCalendar selected={bundle.tradeDate} onPick={nav} includeToday={bundle.today != null} />}
      </div>

      {bundle.tradeDate !== bundle.latestDate && (
        <span className="text-[11px] text-dim2">最新交易日 {bundle.latestDate}</span>
      )}

      <div className="ml-auto flex items-center gap-1 text-[12px]">
        <button
          onClick={() => nav(bundle.prevDate)}
          disabled={!bundle.prevDate}
          className="flex items-center gap-0.5 rounded-[3px] px-2 py-1 text-fg2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-dim2 disabled:hover:bg-transparent"
          aria-label="上一交易日"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          上一交易日
        </button>
        <span className="mx-1 h-3 w-px bg-border" />
        <button
          onClick={() => nav(bundle.nextDate)}
          disabled={!bundle.nextDate}
          className="flex items-center gap-0.5 rounded-[3px] px-2 py-1 text-fg2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-dim2 disabled:hover:bg-transparent"
          aria-label="下一交易日"
        >
          下一交易日
          <span className="rotate-180">
            <ChevronLeft className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </div>
  );
}
