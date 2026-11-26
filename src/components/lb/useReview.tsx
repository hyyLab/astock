"use client";

// 复盘数据 Hook：各视图共享的 bundle 加载 / 错误 / 重试逻辑
import { useEffect, useState } from "react";
import { api, type ReviewBundle } from "./api";

export function useReview(date?: string) {
  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetcher = date ? api.reviewByDate(date) : api.reviewLatest();
    Promise.resolve()
      .then(() => fetcher)
      .then((b) => {
        if (!cancelled) {
          setBundle(b);
          setError(null);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [date, refreshKey]);

  // 切换日期时旧数据视为过期，展示骨架屏
  const stale = loading || (bundle != null && date != null && bundle.tradeDate !== date);

  return { bundle, error, loading, stale, retry: () => { setLoading(true); setRefreshKey((k) => k + 1); } };
}

/** 骨架屏（浅色） */
export function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="h-10 w-full animate-pulse rounded bg-card" />
      <div className="h-16 w-full animate-pulse rounded bg-card" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded bg-card" />
        ))}
      </div>
      <div className="h-64 w-full animate-pulse rounded bg-card" />
    </div>
  );
}
