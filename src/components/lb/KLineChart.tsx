"use client";

// 个股K线：蜡烛图 + 成交量 + 涨停日标记（ECharts · 亮/暗主题自适应）
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { StockDetail } from "./api";
import { useChartPalette } from "./theme";

export default function KLineChart({ detail }: { detail: StockDetail }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const palette = useChartPalette();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const P = palette;
    const bars = detail.kline;
    const dates = bars.map((b) => b.date.slice(5));
    // ECharts 蜡烛: [open, close, low, high]
    const candles = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const volumes = bars.map((b, i) => ({
      value: b.volume,
      itemStyle: { color: b.close >= bars[i].open ? `${P.up}99` : `${P.down}99` },
    }));
    const luPoints = bars
      .map((b, i) => (b.isLimitUp ? { coord: [i, b.high], value: b.isBroken ? "炸" : "板" } : null))
      .filter(Boolean) as { coord: [number, number]; value: string }[];

    chart.setOption(
      {
        backgroundColor: "transparent",
        animation: false,
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        tooltip: {
          trigger: "axis",
          backgroundColor: P.tooltipBg,
          borderColor: P.tooltipBorder,
          textStyle: { color: P.tooltipText, fontSize: 12 },
          axisPointer: { type: "cross", label: { backgroundColor: P.tooltipText } },
        },
        grid: [
          { left: 52, right: 16, top: 12, height: "58%" },
          { left: 52, right: 16, top: "76%", height: "16%" },
        ],
        xAxis: [
          {
            type: "category",
            data: dates,
            gridIndex: 0,
            boundaryGap: true,
            axisLine: { lineStyle: { color: P.axisLine } },
            axisLabel: { show: false },
            splitLine: { show: false },
          },
          {
            type: "category",
            data: dates,
            gridIndex: 1,
            boundaryGap: true,
            axisLine: { lineStyle: { color: P.axisLine } },
            axisLabel: { color: P.axisLabel, fontSize: 10 },
            splitLine: { show: false },
          },
        ],
        yAxis: [
          {
            scale: true,
            gridIndex: 0,
            splitLine: { lineStyle: { color: P.splitLine } },
            axisLabel: { color: P.axisLabel, fontSize: 10 },
          },
          {
            scale: true,
            gridIndex: 1,
            splitLine: { show: false },
            axisLabel: { show: false },
          },
        ],
        dataZoom: [
          { type: "inside", xAxisIndex: [0, 1], start: 40, end: 100 },
          {
            type: "slider", xAxisIndex: [0, 1], start: 40, end: 100, height: 18, bottom: 2,
            borderColor: P.zoomBorder, backgroundColor: P.zoomBg,
            fillerColor: P.zoomFiller, handleStyle: { color: P.zoomHandle },
            textStyle: { color: P.zoomText, fontSize: 9 },
          },
        ],
        series: [
          {
            name: detail.basic.stockName,
            type: "candlestick",
            data: candles,
            xAxisIndex: 0,
            yAxisIndex: 0,
            itemStyle: {
              color: P.up, // 阳线红
              color0: P.down, // 阴线绿
              borderColor: P.up,
              borderColor0: P.down,
            },
            markPoint: {
              symbol: "pin",
              symbolSize: 30,
              label: { fontSize: 9, color: "#fff" },
              data: luPoints.map((p) => ({
                coord: p.coord,
                value: p.value,
                itemStyle: { color: p.value === "板" ? P.up : P.warn },
              })),
            },
          },
          {
            name: "成交量",
            type: "bar",
            data: volumes,
            xAxisIndex: 1,
            yAxisIndex: 1,
          },
        ],
      },
      { notMerge: true }
    );
  }, [detail, palette]);

  return (
    <div className="panel p-4">
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-dim">
        <h2 className="text-[13px] font-semibold text-foreground">K线走势</h2>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-up" /> 涨停日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-warn" /> 炸板日
        </span>
        <span>不复权 · 支持缩放</span>
      </div>
      <div ref={ref} className="h-[340px] w-full md:h-[420px]" />
    </div>
  );
}
