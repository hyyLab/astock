"use client";

// Theme-aware ECharts palette. Canvas/SVG colors do not inherit CSS variables.
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
const DARK_THEME_IDS = new Set(["dark", "cyberpunk-dark", "aurora-dark", "glass-dark", "holo-dark"]);

export function useIsDark(): boolean {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  return mounted && DARK_THEME_IDS.has(resolvedTheme ?? "dark");
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
  tooltipBorder: "#dce3e8",
  tooltipText: "#334155",
  axisLine: "#dce3e8",
  axisLabel: "#82909d",
  splitLine: "#edf1f4",
  zoomBorder: "#dce3e8",
  zoomBg: "#f8fafc",
  zoomFiller: "rgba(57,127,120,0.10)",
  zoomHandle: "#c5d0d8",
  zoomText: "#82909d",
  up: "#D73546",
  down: "#078B68",
  warn: "#A8792E",
};

export const CHART_DARK: ChartPalette = {
  tooltipBg: "#17212B",
  tooltipBorder: "rgba(255,255,255,0.14)",
  tooltipText: "#D5E0EA",
  axisLine: "rgba(255,255,255,0.14)",
  axisLabel: "#91A0AF",
  splitLine: "rgba(255,255,255,0.07)",
  zoomBorder: "rgba(255,255,255,0.14)",
  zoomBg: "rgba(255,255,255,0.04)",
  zoomFiller: "rgba(131,175,168,0.14)",
  zoomHandle: "#667787",
  zoomText: "#91A0AF",
  up: "#F04452",
  down: "#00B386",
  warn: "#D6B16F",
};

const DARK_CHART_ACCENTS: Record<string, Pick<ChartPalette, "zoomFiller">> = {
  "cyberpunk-dark": { zoomFiller: "rgba(67,232,244,0.16)" },
  "aurora-dark": { zoomFiller: "rgba(121,224,195,0.16)" },
  "glass-dark": { zoomFiller: "rgba(145,185,232,0.16)" },
  "holo-dark": { zoomFiller: "rgba(182,164,255,0.16)" },
};

const LIGHT_CHART_ACCENTS: Record<string, Pick<ChartPalette, "zoomFiller">> = {
  "cyberpunk-light": { zoomFiller: "rgba(8,127,145,0.12)" },
  "aurora-light": { zoomFiller: "rgba(40,126,112,0.12)" },
  "glass-light": { zoomFiller: "rgba(82,127,174,0.12)" },
  "holo-light": { zoomFiller: "rgba(112,94,176,0.12)" },
};

export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  if (!mounted) return CHART_DARK;
  if (DARK_THEME_IDS.has(resolvedTheme ?? "dark")) {
    return { ...CHART_DARK, ...DARK_CHART_ACCENTS[resolvedTheme ?? "dark"] };
  }
  return { ...CHART_LIGHT, ...LIGHT_CHART_ACCENTS[resolvedTheme ?? "light"] };
}
