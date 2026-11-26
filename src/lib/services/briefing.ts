// ============================================================
// 每日作战简报：情绪周期定位 + 主战法信号 + 明日应对
// 主战法：情绪高温(>=60) + 高位板晋级（3板及以上）
// 规则透明：每个结论都能在数据里找到出处
// ============================================================

import { db as prisma } from "@/lib/db";
import { getTomorrowCandidates, type TomorrowCandidate } from "@/lib/services/candidates";

export interface BriefingSignal {
  stockCode: string;
  stockName: string;
  boardCount: number; // 今日几板
  firstLimitTime: string | null;
  changePct: number;
  sealRate: number | null; // 封单/成交（近似：用 sealAmount/amount）
  isRebound: boolean;
}

export interface Briefing {
  tradeDate: string;
  // 市场概览
  indices: { name: string; close: number; changePct: number }[];
  totalAmount: number; // 亿
  limitUpCount: number;
  limitDownCount: number;
  brokenCount: number;
  sealRate: number; // %
  highestBoard: number;
  upCount: number;
  downCount: number;
  // 情绪
  temperature: number;
  temperaturePrev: number | null;
  temperatureDelta: number | null;
  temperatureHistory: { tradeDate: string; temperature: number; stage: string }[]; // 近 30 个交易日
  stage: string; // 冰点/退潮/回暖/高潮
  stageAdvice: string;
  // 昨日涨停今日表现
  yesterdayLimitAvg: number | null;
  // 主战法
  strategyActive: boolean; // 情绪是否>=60
  strategyName: string;
  signals: BriefingSignal[]; // 今日>=3板的票（明日晋级候选）
  signalNote: string;
  // 连板梯队
  ladder: { boardCount: number; count: number; names: string[] }[];
  // 明日应对
  tomorrowPlan: string[];
  candidates: TomorrowCandidate[];
}

// 情绪周期定位：用温度 + 温度变化方向
function classifyStage(temp: number, delta: number | null): { stage: string; advice: string } {
  if (temp < 25) {
    return { stage: "冰点", advice: "情绪冰点，打板胜率最低，空仓等右侧信号；冰点后首日升温可试错首板。" };
  }
  if (temp < 40) {
    if (delta !== null && delta > 0) {
      return { stage: "回暖", advice: "冰点回暖初期，可小仓试错首板/低位板，不打高位。" };
    }
    return { stage: "退潮", advice: "退潮期，连板晋级率低，管住手，只看不做。" };
  }
  if (temp < 60) {
    if (delta !== null && delta > 0) {
      return { stage: "升温", advice: "升温期，可参与 2-3 板，主战法（高温+高位板）未触发，半仓以下。" };
    }
    return { stage: "降温", advice: "高位降温，注意兑现，不打板，等下一轮冰点。" };
  }
  return { stage: "高潮", advice: "情绪高潮，主战法触发：可打 3 板以上高位票，但高潮次日谨防分歧，只做龙头。" };
}

export async function getBriefing(date?: string): Promise<Briefing | null> {
  const [sdAll, dmAll, bhAll, luAll] = await Promise.all([
    prisma.sentimentDaily.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.dailyMarket.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.boardHistory.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.limitUp.findMany({ orderBy: { tradeDate: "asc" } }),
  ]);

  if (!sdAll.length) return null;

  const tradeDate = date ?? sdAll[sdAll.length - 1].tradeDate;
  const idx = sdAll.findIndex((d) => d.tradeDate === tradeDate);
  if (idx < 0) return null;
  const sd = sdAll[idx];
  const sdPrev = idx > 0 ? sdAll[idx - 1] : null;
  const dm = dmAll.find((d) => d.tradeDate === tradeDate) ?? null;

  const temperature = sd.sentimentTemperature ?? 0;
  const temperaturePrev = sdPrev?.sentimentTemperature ?? null;
  const temperatureDelta = temperaturePrev !== null ? temperature - temperaturePrev : null;
  const { stage, advice } = classifyStage(temperature, temperatureDelta);

  // 指数
  const indices: { name: string; close: number; changePct: number }[] = [];
  if (dm) {
    if (dm.shIndex != null) indices.push({ name: "上证", close: dm.shIndex, changePct: dm.shChangePct ?? 0 });
    if (dm.szIndex != null) indices.push({ name: "深成", close: dm.szIndex, changePct: dm.szChangePct ?? 0 });
    if (dm.cyIndex != null) indices.push({ name: "创业板", close: dm.cyIndex, changePct: dm.cyChangePct ?? 0 });
    if (dm.kcIndex != null) indices.push({ name: "科创50", close: dm.kcIndex, changePct: dm.kcChangePct ?? 0 });
  }

  // 今日连板梯队（BoardHistory: 今日还在连板的）
  const todayBh = bhAll.filter((r) => r.tradeDate === tradeDate);
  const ladderMap = new Map<number, { count: number; names: string[] }>();
  todayBh
    .filter((r) => r.boardCount >= 1 && !r.isBreak)
    .forEach((r) => {
      const e = ladderMap.get(r.boardCount) ?? { count: 0, names: [] };
      e.count++;
      if (e.names.length < 8) e.names.push(r.stockName);
      ladderMap.set(r.boardCount, e);
    });
  const ladder = [...ladderMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([boardCount, e]) => ({ boardCount, count: e.count, names: e.names }));

  // 主战法：情绪高温(>=60) + 高位板(>=3)
  const strategyActive = temperature >= 60;
  const highBoardToday = todayBh.filter((r) => r.boardCount >= 3 && !r.isBreak);
  const luTodayMap = new Map(luAll.filter((r) => r.tradeDate === tradeDate).map((r) => [r.stockCode, r]));
  const signals: BriefingSignal[] = highBoardToday
    .map((r) => {
      const lu = luTodayMap.get(r.stockCode);
      return {
        stockCode: r.stockCode,
        stockName: r.stockName,
        boardCount: r.boardCount,
        firstLimitTime: lu?.firstLimitTime ?? null,
        changePct: lu?.changePct ?? 0,
        sealRate: lu ? (lu.sealAmount != null && lu.amount ? (lu.sealAmount / lu.amount) * 100 : null) : null,
        isRebound: lu?.isRebound ?? false,
      };
    })
    .sort((a, b) => b.boardCount - a.boardCount || (a.firstLimitTime ?? "").localeCompare(b.firstLimitTime ?? ""));

  const signalNote = !strategyActive
    ? `今日情绪 ${temperature.toFixed(1)}° 未达 60°，主战法（高温+高位板）不触发，信号仅作观察，不建议出手。`
    : signals.length
      ? `主战法触发：情绪 ${temperature.toFixed(1)}° ≥ 60°，今日 ${signals.length} 只 3 板以上高位票为明日晋级候选，只做龙头，不追杂毛。`
      : `主战法触发但今日无 3 板以上高位票，无候选，休息。`;

  // 明日应对
  const tomorrowPlan: string[] = [];
  tomorrowPlan.push(advice);
  if (temperatureDelta !== null && temperatureDelta > 0) {
    tomorrowPlan.push(`温度较昨日 +${temperatureDelta.toFixed(1)}°，情绪向上，晋级率通常随温度走高。`);
  } else if (temperatureDelta !== null && temperatureDelta < 0) {
    tomorrowPlan.push(`温度较昨日 ${temperatureDelta.toFixed(1)}°，情绪转弱，注意高位票分歧。`);
  }
  if (sd.yesterdayLimitAvg != null) {
    tomorrowPlan.push(
      sd.yesterdayLimitAvg > 2
        ? `昨日涨停今日均涨 ${sd.yesterdayLimitAvg.toFixed(2)}%，赚钱效应好，可积极。`
        : `昨日涨停今日均涨 ${sd.yesterdayLimitAvg.toFixed(2)}%，亏钱效应，打板需谨慎。`
    );
  }
  if (dm && dm.sealRate != null) {
    const sealPct = dm.sealRate * 100;
    tomorrowPlan.push(sealPct > 70 ? `封板率 ${sealPct.toFixed(1)}%，封板质量高。` : `封板率仅 ${sealPct.toFixed(1)}%，炸板多，打板胜率打折。`);
  }
  // 情绪转暖预期下，纯情绪小票（垃圾股）容易被按跌停：资金撤出去追主流
  if (temperatureDelta !== null && temperatureDelta > 0 && temperature < 60) {
    tomorrowPlan.push("情绪有转暖预期：资金会从纯情绪小票撤出去追主流，前期无题材无业绩的妖股容易按跌停，别接。");
  }
  if (temperatureDelta !== null && temperatureDelta < -10) {
    tomorrowPlan.push(`温度单日大跌 ${Math.abs(temperatureDelta).toFixed(1)}°：高位票集体分歧，明日大概率还有惯性低开，等企稳再动手。`);
  }

  return {
    tradeDate,
    indices,
    totalAmount: dm?.totalAmount ?? 0,
    limitUpCount: sd.limitUpCount,
    limitDownCount: sd.limitDownCount,
    brokenCount: sd.brokenLimitCount,
    sealRate: (sd.sealRate ?? 0) * 100,
    highestBoard: sd.highestBoard ?? 0,
    upCount: dm?.upCount ?? 0,
    downCount: dm?.downCount ?? 0,
    temperature,
    temperaturePrev,
    temperatureDelta,
    temperatureHistory: sdAll.slice(-30).map((d) => ({ tradeDate: d.tradeDate, temperature: d.sentimentTemperature ?? 0, stage: d.sentimentStage })),
    stage,
    stageAdvice: advice,
    yesterdayLimitAvg: sd.yesterdayLimitAvg,
    strategyActive,
    strategyName: "情绪高温 + 高位板晋级",
    signals,
    signalNote,
    ladder,
    tomorrowPlan,
    candidates: await getTomorrowCandidates(tradeDate),
  };
}


