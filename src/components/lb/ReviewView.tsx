"use client";

// 复盘主视图（需求文档·二十七：首页最终结构）
// 主线：市场环境 → 情绪 → 连板梯队/主线题材 → 涨停池 → 宽度/昨日表现 → 晋级 → 断板 → 爆量+主线追踪 → 明日推演
// 今日与历史日期共用同一套 UI：历史日期不再独立成页，通过日期栏/日历在组件内切换（URL 不变）
import { useState } from "react";
import DateBar from "./DateBar";
import { IndexStrip, CoreMetrics } from "./MarketTop";
import SentimentCycle from "./SentimentCycle";
import MainThemes from "./MainThemes";
import LimitUpPool from "./LimitUpPool";
import MarketBreadth from "./MarketBreadth";
import YesterdayPerf from "./YesterdayPerf";
import PromotionRates from "./PromotionRates";
import BrokenPool from "./BrokenPool";
import VolumeSurge from "./VolumeSurge";
import NewsTracker from "./NewsTracker";
import TomorrowOutlook from "./TomorrowOutlook";
import { useReview, LoadingState } from "./useReview";
import { AlertTriangle, RefreshCw } from "lucide-react";

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded border border-warn-soft bg-warn-bg py-20">
      <AlertTriangle className="h-8 w-8 text-warn" />
      <p className="max-w-md px-4 text-center text-sm text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs text-fg2 hover:bg-muted"
      >
        <RefreshCw className="h-3.5 w-3.5" /> 重试
      </button>
    </div>
  );
}

export default function ReviewView({ initialDate }: { initialDate?: string }) {
  // 日期为组件内状态：上一/下一交易日、日历选择均只换数据不改 URL
  const [date, setDate] = useState<string | undefined>(initialDate);
  const { bundle, error, stale, retry } = useReview(date);

  if (stale) return <LoadingState />;
  if (error || !bundle) return <ErrorState message={error ?? "未知错误"} onRetry={retry} />;

  return (
    <div className="space-y-8">
      {/* 交易日期（含交易日日历选择） */}
      <DateBar bundle={bundle} onNav={setDate} />

      {/* 核心市场行情：指数与成交额先建立市场基准 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <div className="terminal-section-label">MARKET SNAPSHOT</div>
            <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-foreground">主要指数</h2>
          </div>
          <span className="text-[11px] text-dim">指数涨跌与成交额</span>
        </div>
        <IndexStrip bundle={bundle} />
      </section>

      {/* 核心指标：大数字优先，昨日变化作为辅助信息 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <div className="terminal-section-label">MARKET BREADTH</div>
            <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-foreground">市场关键指标</h2>
          </div>
          <span className="text-[11px] text-dim">与上一交易日对比</span>
        </div>
        <CoreMetrics bundle={bundle} />
      </section>

      {/* 情绪周期与主线题材 */}
      <section className="space-y-5">
        <SentimentCycle bundle={bundle} />
        <MainThemes bundle={bundle} />
      </section>

      {/* 今日涨停池 */}
      <LimitUpPool bundle={bundle} pageSize={10} />

      {/* 市场宽度 + 昨日涨停表现 */}
      <div className="grid gap-5 md:grid-cols-2">
        <MarketBreadth bundle={bundle} />
        <YesterdayPerf bundle={bundle} />
      </div>

      {/* 连板晋级率 */}
      <PromotionRates bundle={bundle} />

      {/* 断板池 */}
      <BrokenPool bundle={bundle} />

      {/* 爆量 + 主线追踪（实时要闻/研判/受益标的） */}
      <div className="grid gap-5 xl:grid-cols-[7fr_5fr]">
        <VolumeSurge bundle={bundle} />
        <NewsTracker bundle={bundle} />
      </div>

      {/* 明日推演 */}
      <TomorrowOutlook bundle={bundle} />
    </div>
  );
}
