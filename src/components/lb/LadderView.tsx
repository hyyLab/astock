"use client";

// 连板天梯专项页：完整梯队（不折叠首板）+ 晋级率 + 断板池
import DateBar from "./DateBar";
import BoardLadder from "./BoardLadder";
import PromotionRates from "./PromotionRates";
import BrokenPool from "./BrokenPool";
import { useReview, LoadingState } from "./useReview";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function LadderView() {
  const { bundle, error, stale, retry } = useReview();

  if (stale) return <LoadingState />;
  if (error || !bundle)
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded border border-warn-soft bg-warn-bg py-20">
        <AlertTriangle className="h-8 w-8 text-warn" />
        <p className="text-sm text-muted-foreground">{error ?? "未知错误"}</p>
        <button
          onClick={retry}
          className="flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs text-fg2 hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 重试
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      <DateBar bundle={bundle} />
      <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <BoardLadder bundle={bundle} maxFirstBoard={999} />
        </div>
        <div className="space-y-3">
          <PromotionRates bundle={bundle} />
          <BrokenPool bundle={bundle} />
        </div>
      </div>
    </div>
  );
}
