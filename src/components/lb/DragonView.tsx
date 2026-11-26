"use client";

// 龙虎榜（第三阶段规划，占位页）
import { BarChart3 } from "lucide-react";

export default function DragonView() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <BarChart3 className="h-6 w-6 text-dim" />
      </div>
      <h2 className="text-[15px] font-semibold text-foreground">龙虎榜 · 规划中</h2>
      <p className="max-w-md text-center text-[12px] leading-relaxed text-dim">
        龙虎榜属第三阶段模块：交易所公开席位数据（买卖前五）、游资席位画像、机构/北向动向、
        与连板/爆量体系的交叉分析。数据库已预留 dragon_tiger / dragon_tiger_seat 两表扩展位。
      </p>
      <button
        onClick={() => (location.hash = "#/")}
        className="mt-2 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs text-fg2 hover:bg-muted"
      >
        返回今日复盘
      </button>
    </div>
  );
}
