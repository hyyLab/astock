"use client";

// 明日推演（需求文档·首页结构末模块）：基于结构化数据的规则化观察
// 完全透明：每条结论标注数据依据；非 AI 生成原始数据，不构成投资建议
import type { ReviewBundle } from "./api";
import { fmtPct, fmtRate } from "./format";

export default function TomorrowOutlook({ bundle }: { bundle: ReviewBundle }) {
  const { market, sentiment, compare, concepts } = bundle;
  const items: { tag: string; tagCls: string; text: string }[] = [];

  // 1. 情绪面
  const deltaT = bundle.prevTemperature != null ? sentiment.temperature - bundle.prevTemperature : null;
  const mood =
    deltaT == null
      ? `情绪 ${sentiment.temperature.toFixed(0)}°（${sentiment.stage}期）`
      : deltaT >= 5
        ? `情绪回暖：${bundle.prevTemperature?.toFixed(0)}° → ${sentiment.temperature.toFixed(0)}°（+${deltaT.toFixed(1)}°），处${sentiment.stage}期`
        : deltaT <= -5
          ? `情绪降温：${bundle.prevTemperature?.toFixed(0)}° → ${sentiment.temperature.toFixed(0)}°（${deltaT.toFixed(1)}°），处${sentiment.stage}期`
          : `情绪平稳：${sentiment.temperature.toFixed(0)}°（${deltaT > 0 ? "+" : ""}${deltaT.toFixed(1)}°），处${sentiment.stage}期`;
  items.push({
    tag: "情绪",
    tagCls: "bg-link-soft-bg text-link-strong",
    text: mood,
  });

  // 2. 空间高度
  const hb = compare.highestBoard;
  const heightText =
    hb.delta == null
      ? `市场最高 ${sentiment.highestBoard} 板`
      : hb.delta > 0
        ? `空间打开：最高板 ${hb.yesterday}板 → ${hb.today}板，高位梯队重启`
        : hb.delta < 0
          ? `空间压缩：最高板 ${hb.yesterday}板 → ${hb.today}板，高度退坡`
          : `高度持平：最高板维持 ${hb.today} 板`;
  items.push({ tag: "高度", tagCls: "bg-warn-soft text-warn-strong", text: heightText });

  // 3. 接力（1进2）
  const p12 = sentiment.promotions.find((p) => p.fromBoard === 1);
  if (p12 && p12.total > 0) {
    const rate = Math.round(p12.rate * 100);
    items.push({
      tag: "接力",
      tagCls: "bg-down-soft text-down",
      text:
        rate >= 40
          ? `首板晋级率 ${rate}%（${p12.promoted}/${p12.total}），2板接力正反馈，打板情绪偏积极`
          : rate >= 20
            ? `首板晋级率 ${rate}%（${p12.promoted}/${p12.total}），接力中性，重视个股辨识度`
            : `首板晋级率仅 ${rate}%（${p12.promoted}/${p12.total}），2板接力弱，注意降低预期`,
    });
  }

  // 4. 封板质量
  const seal = compare.sealRate;
  if (seal.today != null) {
    const dPct = seal.delta != null ? seal.delta * 100 : null;
    items.push({
      tag: "封板",
      tagCls: "bg-muted text-fg2",
      text:
        dPct == null
          ? `封板率 ${fmtRate(seal.today)}，炸板 ${market.brokenCount} 家`
          : dPct >= 3
            ? `封板率 ${fmtRate(seal.today)}（${fmtRate(seal.yesterday)} → ${fmtRate(seal.today)}），封板质量转强`
            : dPct <= -3
              ? `封板率 ${fmtRate(seal.today)}（${fmtRate(seal.yesterday)} → ${fmtRate(seal.today)}），炸板增多需防分歧`
              : `封板率 ${fmtRate(seal.today)}，与昨日基本持平`,
    });
  }

  // 5. 亏钱效应
  if (market.limitDownCount > 0 || (compare.limitDown.yesterday ?? 0) > 0) {
    items.push({
      tag: "风险",
      tagCls: "bg-up-soft text-up",
      text: `跌停 ${market.limitDownCount} 家（昨 ${compare.limitDown.yesterday ?? "—"}），断板池 ${
        bundle.yesterdayPerf.filter((r) => r.todayStatus !== "promoted" && r.todayStatus !== "suspended").length
      } 家待修复，高位股注意补跌风险`,
    });
  }

  // 6. 主线聚焦
  const top = concepts[0];
  if (top) {
    items.push({
      tag: "主线",
      tagCls: "bg-warn-soft text-warn-strong",
      text: `${top.conceptName} 涨停 ${top.limitUpCount} 家、最高 ${top.highestBoard} 板（龙头 ${
        top.leaderName ?? "—"
      }），${concepts[1] && concepts[1].limitUpCount >= top.limitUpCount * 0.7 ? `与 ${concepts[1].conceptName} 双主线并行` : "题材聚焦度较高"}`,
    });
  }

  return (
    <section aria-label="明日推演" className="panel">
      <div className="module-header">
        <h2 className="text-[13px] font-semibold text-foreground">明日推演</h2>
        <span className="text-[11px] text-dim">规则化观察 · 依据当日结构化数据 · 不构成投资建议</span>
      </div>
      <div className="grid gap-x-6 px-3.5 py-3 md:grid-cols-2">
        {items.map((it) => (
          <div key={it.tag} className="flex items-start gap-2 border-b border-line py-2 text-[12px] last:border-0">
            <span className={`shrink-0 rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium ${it.tagCls}`}>{it.tag}</span>
            <span className="leading-relaxed text-fg2">{it.text}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-3.5 py-2 text-[11px] text-dim2">
        昨日涨停表现 {sentiment.yesterdayLimitAvg != null ? fmtPct(sentiment.yesterdayLimitAvg) : "—"} · 涨停{" "}
        {market.limitUpCount}（昨 {compare.limitUp.yesterday ?? "—"}）· 两市成交{" "}
        {market.totalAmount != null ? market.totalAmount.toFixed(0) : "—"} 亿
      </div>
    </section>
  );
}
