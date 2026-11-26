"use client";

// 情绪趋势：温度折线 + 涨停家数柱状 + 最高连板（ECharts 双轴）
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ReviewBundle } from "./api";
import { stageColor } from "./format";

export default function SentimentTrend({ bundle }: { bundle: ReviewBundle }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

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
    const h = bundle.history;
    const dates = h.map((x) => x.tradeDate.slice(5)); // MM-DD
    const temps = h.map((x) => x.temperature);
    const counts = h.map((x) => x.limitUpCount);
    const boards = h.map((x) => x.highestBoard);
    const colors = h.map((x) => stageColor(x.stage));

    chart.setOption(
      {
        backgroundColor: "transparent",
        grid: { left: 44, right: 52, top: 36, bottom: 26 },
        tooltip: {
          trigger: "axis",
          backgroundColor: "#0f1522",
          borderColor: "#1c2536",
          textStyle: { color: "#cbd5e1", fontSize: 12 },
          formatter: (params: { axisValue?: string; seriesName?: string; value?: number | string }[]) => {
            const idx = dates.indexOf(params[0]?.axisValue as string);
            const row = h[idx];
            if (!row) return "";
            return (
              `<b>${row.tradeDate}</b><br/>` +
              `情绪温度：${row.temperature}（${row.stage}）<br/>` +
              `涨停：${row.limitUpCount} 只<br/>` +
              `炸板：${row.brokenLimitCount} 只<br/>` +
              `最高板：${row.highestBoard} 板<br/>` +
              `封板率：${(row.sealRate * 100).toFixed(1)}%`
            );
          },
        },
        xAxis: {
          type: "category",
          data: dates,
          axisLine: { lineStyle: { color: "#2a3550" } },
          axisLabel: { color: "#64748b", fontSize: 10 },
        },
        yAxis: [
          {
            type: "value",
            name: "涨停家数",
            nameTextStyle: { color: "#64748b", fontSize: 10 },
            splitLine: { lineStyle: { color: "#161d2e" } },
            axisLabel: { color: "#64748b", fontSize: 10 },
          },
          {
            type: "value",
            name: "温度",
            min: 0,
            max: 100,
            nameTextStyle: { color: "#64748b", fontSize: 10 },
            splitLine: { show: false },
            axisLabel: { color: "#64748b", fontSize: 10 },
          },
        ],
        series: [
          {
            name: "涨停家数",
            type: "bar",
            data: counts,
            barMaxWidth: 26,
            itemStyle: {
              borderRadius: [3, 3, 0, 0],
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(246,70,93,0.85)" },
                { offset: 1, color: "rgba(246,70,93,0.25)" },
              ]),
            },
          },
          {
            name: "情绪温度",
            type: "line",
            yAxisIndex: 1,
            data: temps.map((t, i) => ({
              value: t,
              itemStyle: { color: colors[i], borderColor: "#0f1522", borderWidth: 1.5 },
            })),
            smooth: true,
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { color: "#f5a623", width: 2.5 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(245,166,35,0.22)" },
                { offset: 1, color: "rgba(245,166,35,0)" },
              ]),
            },
            markLine: {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: "#2a3550", type: "dashed" },
              data: [{ yAxis: 50 }, { yAxis: 80 }, { yAxis: 20 }],
            },
          },
          {
            name: "最高连板",
            type: "line",
            yAxisIndex: 1,
            data: boards,
            smooth: false,
            step: "middle",
            symbol: "diamond",
            symbolSize: 7,
            lineStyle: { color: "rgba(148,163,184,0.7)", width: 1.5, type: "dotted" },
            itemStyle: { color: "#94a3b8" },
          },
        ],
      },
      { notMerge: true }
    );
  }, [bundle.history]);

  return (
    <section aria-label="情绪趋势" className="rounded-xl border border-[#1c2536] bg-[#0f1522] p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">情绪趋势</h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[#f5a623]" /> 情绪温度
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2.5 bg-[#f6465d]/70" /> 涨停家数
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rotate-45 bg-slate-400" /> 最高连板
          </span>
        </div>
      </div>
      <div ref={ref} className="h-[260px] w-full md:h-[300px]" />
    </section>
  );
}
