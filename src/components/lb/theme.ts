"use client";

// 主题 Hook：暗/亮判定 + ECharts 专用调色板
// Style B · Graphite Terminal — amber focus, red/green numbers only
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** 暗色判定（SSR/首次渲染前恒为 false，避免水合不一致） */
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
  tooltipBorder: "#e4e4e7",
  tooltipText: "#3f3f46",
  axisLine: "#e4e4e7",
  axisLabel: "#a1a1aa",
  splitLine: "#f4f4f5",
  zoomBorder: "#e4e4e7",
  zoomBg: "#fafafa",
  zoomFiller: "rgba(217,119,6,0.08)",
  zoomHandle: "#d4d4d8",
  zoomText: "#a1a1aa",
  up: "#dc2626",
  down: "#16a34a",
  warn: "#d97706",
};

export const CHART_DARK: ChartPalette = {
  tooltipBg: "#1c1c1f",
  tooltipBorder: "rgba(255,255,255,0.1)",
  tooltipText: "#d4d4d8",
  axisLine: "rgba(255,255,255,0.1)",
  axisLabel: "#71717a",
  splitLine: "rgba(255,255,255,0.06)",
  zoomBorder: "rgba(255,255,255,0.1)",
  zoomBg: "rgba(255,255,255,0.03)",
  zoomFiller: "rgba(251,191,36,0.12)",
  zoomHandle: "#52525b",
  zoomText: "#71717a",
  up: "#f87171",
  down: "#4ade80",
  warn: "#fbbf24",
};

export function useChartPalette(): ChartPalette {
  return useIsDark() ? CHART_DARK : CHART_LIGHT;
}
