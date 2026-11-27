"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Newspaper,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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

type View = Route["view"];
type NavItem = {
  id: string;
  label: string;
  hash: string;
  views: View[];
  hint?: string;
};
type NavGroup = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "market",
    label: "市场",
    description: "大盘总览、量能与市场异动",
    icon: LayoutDashboard,
    items: [
      { id: "market-overview", label: "大盘总览", hash: "#/", views: ["today"] },
      { id: "market-volume", label: "量能", hash: "#/volume", views: ["volume"] },
      { id: "market-volume-hold", label: "爆量不跌", hash: "#/volume-hold", views: ["volumehold"] },
      { id: "market-anomaly", label: "异动监控", hash: "#/anomaly", views: ["anomaly"] },
    ],
  },
  {
    id: "sentiment",
    label: "情绪",
    description: "情绪周期整合在总览，独立查看梯队与涨停池",
    icon: Activity,
    items: [
      { id: "sentiment-cycle", label: "情绪周期", hash: "#/", views: ["today"], hint: "周期图位于大盘总览的情绪模块" },
      { id: "sentiment-ladder", label: "连板天梯", hash: "#/ladder", views: ["ladder"] },
      { id: "sentiment-limitup", label: "涨停池", hash: "#/limit-up", views: ["limitup"] },
    ],
  },
  {
    id: "capital",
    label: "资金",
    description: "龙虎榜席位与概念板块",
    icon: Wallet,
    items: [
      { id: "capital-dragon", label: "龙虎榜", hash: "#/dragon", views: ["dragon"] },
      { id: "capital-concepts", label: "概念板块", hash: "#/concepts", views: ["concepts"] },
    ],
  },
  {
    id: "stocks",
    label: "个股",
    description: "个股检索与策略验证",
    icon: CandlestickChart,
    items: [
      { id: "stocks-browser", label: "个股浏览", hash: "#/stocks", views: ["stocks", "stock"] },
      { id: "stocks-strategy", label: "策略", hash: "#/strategy", views: ["strategy"] },
    ],
  },
  {
    id: "news",
    label: "资讯",
    description: "新闻追踪位于总览，简报独立查看",
    icon: Newspaper,
    items: [
      { id: "news-tracker", label: "新闻追踪", hash: "#/", views: ["today"], hint: "新闻追踪模块整合在大盘总览" },
      { id: "news-briefing", label: "每日简报", hash: "#/briefing", views: ["briefing"] },
    ],
  },
  {
    id: "review",
    label: "复盘",
    description: "今日与历史复盘、美股映射",
    icon: FileText,
    items: [
      { id: "review-today", label: "今日复盘", hash: "#/", views: ["today"] },
      { id: "review-history", label: "历史复盘", hash: "#/", views: ["today"], hint: "使用复盘页日期栏切换历史交易日" },
      { id: "review-us", label: "美股", hash: "#/us", views: ["us"] },
    ],
  },
];

function groupForRoute(route: Route): NavGroup {
  if (route.view === "ladder" || route.view === "limitup") return NAV_GROUPS[1];
  if (route.view === "dragon" || route.view === "concepts") return NAV_GROUPS[2];
  if (route.view === "stocks" || route.view === "stock" || route.view === "strategy") return NAV_GROUPS[3];
  if (route.view === "briefing") return NAV_GROUPS[4];
  if (route.view === "us") return NAV_GROUPS[5];
  return NAV_GROUPS[0];
}

function itemForRoute(group: NavGroup, route: Route): NavItem {
  return group.items.find((item) => item.views.includes(route.view)) ?? group.items[0];
}

export default function Home() {
  const [route, setRoute] = useState<Route>({ view: "today" });
  const [collapsed, setCollapsed] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState("market");
  const [activeItemId, setActiveItemId] = useState("market-overview");
  const pendingNavigation = useRef<{ groupId: string; itemId: string } | null>(null);

  useEffect(() => {
    const onHash = () => {
      const nextRoute = parseHash(window.location.hash);
      setRoute(nextRoute);
      const pending = pendingNavigation.current;
      const pendingGroup = pending ? NAV_GROUPS.find((group) => group.id === pending.groupId) : undefined;
      const pendingItem = pendingGroup?.items.find((item) => item.id === pending?.itemId);
      const usePending = Boolean(pendingItem?.views.includes(nextRoute.view));
      const group = usePending && pendingGroup ? pendingGroup : groupForRoute(nextRoute);
      const item = usePending && pendingItem ? pendingItem : itemForRoute(group, nextRoute);
      pendingNavigation.current = null;
      setActiveGroupId(group.id);
      setActiveItemId(item.id);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const activeGroup = NAV_GROUPS.find((group) => group.id === activeGroupId) ?? NAV_GROUPS[0];

  const selectItem = (group: NavGroup, item: NavItem) => {
    setActiveGroupId(group.id);
    setActiveItemId(item.id);
    if (window.location.hash !== item.hash) {
      pendingNavigation.current = { groupId: group.id, itemId: item.id };
      window.location.hash = item.hash;
    }
  };

  const selectGroup = (group: NavGroup) => {
    const currentItem = group.items.find((item) => item.views.includes(route.view)) ?? group.items[0];
    selectItem(group, currentItem);
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={[
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-[232px]",
        ].join(" ")}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
          <button
            type="button"
            onClick={() => selectItem(NAV_GROUPS[0], NAV_GROUPS[0].items[0])}
            className="flex min-w-0 items-center gap-2.5 text-left"
            aria-label="返回大盘总览"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-primary text-[12px] font-bold text-primary-foreground">
              A
            </span>
            {!collapsed && <span className="truncate text-[14px] font-semibold tracking-wide">ASTOCK</span>}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="lb-scroll flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="主导航">
          {!collapsed && <div className="px-2 pb-2 text-[10px] font-semibold tracking-[0.16em] text-dim">WORKSPACE</div>}
          {NAV_GROUPS.map((group) => {
            const selected = activeGroup.id === group.id;
            const Icon = group.icon;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => selectGroup(group)}
                aria-current={selected ? "page" : undefined}
                title={collapsed ? group.label : undefined}
                className={[
                  "flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left text-[13px] transition-colors",
                  selected ? "bg-sidebar-accent font-medium text-primary" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                  collapsed ? "justify-center px-0" : "",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{group.label}</span>}
                {!collapsed && selected && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-3 py-3">
          {!collapsed ? (
            <>
              <div className="text-[10px] font-medium tracking-wide text-dim">MARKET WORKSPACE</div>
              <div className="mt-1 text-[11px] text-dim2">A 股 · 结构化复盘</div>
            </>
          ) : (
            <div className="text-center text-[10px] font-semibold text-dim">A股</div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header route={route} navigation={false} />
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-5 md:px-6">
          <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-dim">
                <span>ASTOCK</span><span className="text-dim2">/</span><span>{activeGroup.label}</span>
              </div>
              <h1 className="text-[22px] font-semibold tracking-tight">{activeGroup.label}</h1>
              <p className="mt-1 text-[12px] text-muted-foreground">{activeGroup.description}</p>
            </div>
            <div className="lb-scroll flex max-w-full items-center gap-1 overflow-x-auto" role="tablist" aria-label={activeGroup.label + "二级导航"}>
              {activeGroup.items.map((item) => {
                const selected = activeItemId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    title={item.hint}
                    onClick={() => selectItem(activeGroup, item)}
                    className={[
                      "shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
                      selected ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
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
          </div>
        </main>

        <footer className="mt-auto border-t border-border bg-card">
          <div className="mx-auto flex w-full max-w-[1680px] flex-col items-center justify-between gap-1.5 px-4 py-3 text-[11px] text-dim md:flex-row md:px-6">
            <span>ASTOCK · A 股结构化市场复盘工作台</span>
            <span>数据仅供学习研究，不构成任何投资建议</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
