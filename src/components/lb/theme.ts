"use client";

// 主题 Hook：暗/亮判定 + ECharts 专用调色板
// CSS 变量类（text-dim 等）自动跟随主题；Canvas/SVG 内联色需要 JS 侧感知
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** 暗色判定（SSR/首次渲染前恒为 false，避免水合不一致；useSyncExternalStore 避开 setState-in-effect） */
export function useIsDark(): boolean {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  return mounted && resolvedTheme === "dark";
}

export interface ChartPalette {
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  axisLine: string;
  axisLabel: string;
  splitLine: string;
  zoomBorder: string;
  zoomBg: string;
  zoomFiller: string;
  zoomHandle: string;
  zoomText: string;
  up: string;
  down: string;
  warn: string;
}

export const CHART_LIGHT: ChartPalette = {
  tooltipBg: "#ffffff",
  tooltipBorder: "#e6e8ec",
  tooltipText: "#374151",
  axisLine: "#e6e8ec",
  axisLabel: "#9ca3af",
  splitLine: "#f0f1f3",
  zoomBorder: "#e6e8ec",
  zoomBg: "#fafbfc",
  zoomFiller: "rgba(217,53,47,0.08)",
  zoomHandle: "#d4d7dd",
  zoomText: "#9ca3af",
  up: "#d9352f",
  down: "#0e9663",
  warn: "#e8850c",
};

export const CHART_DARK: ChartPalette = {
  tooltipBg: "#1c2434",
  tooltipBorder: "rgba(255,255,255,0.12)",
  tooltipText: "#cbd2dc",
  axisLine: "rgba(255,255,255,0.12)",
  axisLabel: "#8b93a1",
  splitLine: "rgba(255,255,255,0.07)",
  zoomBorder: "rgba(255,255,255,0.12)",
  zoomBg: "rgba(255,255,255,0.04)",
  zoomFiller: "rgba(246,70,93,0.12)",
  zoomHandle: "#5f6878",
  zoomText: "#8b93a1",
  up: "#f6465d",
  down: "#0ecb81",
  warn: "#f5a623",
};

export function useChartPalette(): ChartPalette {
  return useIsDark() ? CHART_DARK : CHART_LIGHT;
}
