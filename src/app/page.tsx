"use client";

// 连板复盘 · 主页
// 仅 / 一个页面路由，视图通过 hash 路由切换。
// 导航统一由 Header.NAV_ITEMS 提供（顶部横向导航），不再使用侧边栏。

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

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-4 md:px-6 md:py-5">
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

      <footer className="mt-auto border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-1.5 px-3 py-4 text-[11px] text-dim md:flex-row md:px-6">
          <span>连板复盘 · 涨停/连板/题材/情绪/量能 结构化市场复盘工作台</span>
          <span>
            数据来源：东方财富涨停池 & 腾讯行情公开接口整理 · 仅供学习研究，不构成任何投资建议
          </span>
        </div>
      </footer>
    </div>
  );
}
