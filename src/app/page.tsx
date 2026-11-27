"use client";

// 连板复盘 · 主页
// 仅 / 一个页面路由，视图通过 hash 路由切换：
//   #/                  → 今日复盘（结构化复盘工作台）
//   #/review/{date}     → 历史日期（不再独立成页，归一到今日复盘同套 UI，日期栏/日历可切换）
//   #/stock/{code}      → 个股详情
//   #/ladder            → 连板天梯
//   #/concepts          → 主线题材
//   #/limit-up          → 涨停池
//   #/volume            → 爆量（全市场量比榜）
//   #/volume-hold       → 爆量不跌（近5交易日爆量且未跌破基准日收盘）
//   #/anomaly           → 异动监控（大盘共振/逆势拉升/板块效应/领涨龙头/前期爆量）
//   #/us                → 隔夜美股映射（美股题材→A股主线→受益标的）
//   #/dragon            → 龙虎榜（第三阶段）
//   #/stocks            → 个股浏览
// 主线追踪为首页内置模块（NewsTracker），资讯由后端进程内调度器每日自动更新入库
// 自部署时可将 hash 路由平移为 Next.js 文件路由，组件与 API 层完全复用。

import { useEffect, useState } from "react";
import Header, { parseHash, type Route } from "@/components/lb/Header";
import ReviewView from "@/components/lb/ReviewView";
import StockView from "@/components/lb/StockView";
import LadderView from "@/components/lb/LadderView";
import ConceptView from "@/components/lb/ConceptView";
import LimitUpView from "@/components/lb/LimitUpView";
import VolumeView from "@/components/lb/VolumeView";
import VolumeHoldView from "@/components/lb/VolumeHoldView";
import AnomalyView from "@/components/lb/AnomalyView";
import DragonView from "@/components/lb/DragonView";
import StocksView from "@/components/lb/StocksView";
import UsMarketView from "@/components/lb/UsMarketView";
import StrategyView from "@/components/lb/StrategyView";
import BriefingView from "@/components/lb/BriefingView";

export default function Home() {
  const [route, setRoute] = useState<Route>({ view: "today" });

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header route={route} />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 md:px-6 md:py-6">
        {route.view === "today" && <ReviewView key={route.date ?? ""} initialDate={route.date} />}
        {route.view === "stock" && route.code && <StockView code={route.code} />}
        {route.view === "ladder" && <LadderView />}
        {route.view === "concepts" && <ConceptView />}
        {route.view === "limitup" && <LimitUpView concept={route.concept} />}
        {route.view === "volume" && <VolumeView />}
        {route.view === "volumehold" && <VolumeHoldView />}
        {route.view === "anomaly" && <AnomalyView />}
        {route.view === "us" && <UsMarketView />}
        {route.view === "strategy" && <StrategyView />}
        {route.view === "briefing" && <BriefingView />}
        {route.view === "dragon" && <DragonView />}
        {route.view === "stocks" && <StocksView />}
      </main>

      <footer className="mt-auto border-t border-border bg-card/80">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-2 px-4 py-5 text-[11px] text-dim md:flex-row md:px-6">
          <span className="tracking-wide">连板复盘 · 涨停 / 连板 / 题材 / 情绪 / 量能 结构化复盘工作台</span>
          <span className="text-dim2">
            数据来源：东方财富涨停池 & 腾讯行情公开接口 · 仅供学习研究，不构成投资建议
          </span>
        </div>
      </footer>
    </div>
  );
}
