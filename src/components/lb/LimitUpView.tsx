"use client";

// 涨停池专项页：全功能涨停池（更大分页 + 题材筛选）
import DateBar from "./DateBar";
import LimitUpPool from "./LimitUpPool";
import { useReview, LoadingState } from "./useReview";

export default function LimitUpView({ concept }: { concept?: string }) {
  const { bundle, stale, error, retry } = useReview();

  if (stale) return <LoadingState />;
  if (error || !bundle)
    return <div className="py-20 text-center text-sm text-dim">{error ?? "数据加载失败"}</div>;

  return (
    <div className="space-y-3">
      <DateBar bundle={bundle} />
      <LimitUpPool bundle={bundle} pageSize={20} initialConcept={concept ?? ""} />
    </div>
  );
}
