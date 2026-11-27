import { getStrategyBundle } from "@/lib/services/strategies";
import { assembleBayesStrategyViewData } from "@/lib/bayes/assemble";
import type { WinRateBucket } from "@/lib/bayes/empirical-prior";
import { buildJointReturnDraws, type StrategySpec } from "@/lib/bayes/joint-returns";
import { computeTargetWeightFromDraws } from "@/lib/bayes/optimize";
import { scheduleRegimeWeights } from "@/lib/bayes/regime-weight";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BAYES_DRAWS = 2048;
const NEUTRAL_HYPER = {
  thetaAlphaScale: 1, thetaBetaScale: 1,
  p0AlphaScale: 1, p0BetaScale: 1,
  pFillAlphaScale: 1, pFillBetaScale: 1,
  returnShift: 0, returnScale: 1,
};

/** Convert existing summaries into posterior buckets without changing legacy backtests. */
function buildBayesInputs(bundle: Awaited<ReturnType<typeof getStrategyBundle>>) {
  const buckets: WinRateBucket[] = [];
  const names: Record<string, string> = {};
  const conditionalReturnById = new Map<string, number>();
  const add = (id: string, name: string, wins: number, n: number, returnPct?: number | null) => {
    buckets.push({ id, wins, n });
    names[id] = name;
    if (returnPct !== null && returnPct !== undefined && Number.isFinite(returnPct)) {
      conditionalReturnById.set(id, returnPct / 100);
    }
  };
  for (const row of bundle.promotion) add(`promotion:${row.level}`, `连板晋级 · ${row.level}`, row.promoted, row.n);
  for (const row of bundle.firstBoardTime) add(`first-board:${row.bucket}`, `首板封板时间 · ${row.bucket}`, row.promoted, row.n);
  add("rebound:next-limit-up", "反包 · 次日再涨停", bundle.rebound.nextLimitUp, bundle.rebound.n);
  for (const row of bundle.sentimentTemp) add(`sentiment:${row.bucket}`, `情绪温度 · ${row.bucket}`, row.positiveDays, row.n, row.avgNextLimitAvg);
  for (const row of bundle.sealStrength.buckets) add(`seal-strength:${row.bucket}`, `封单强度 · ${row.bucket}`, row.highOpenN, row.n, row.avgNextClosePremiumPct);
  add("sector-first-seal:first", "题材首封 · 次日高开", bundle.sectorFirstSeal.firstSeal.highOpenSuccesses, bundle.sectorFirstSeal.firstSeal.n, bundle.sectorFirstSeal.firstSeal.avgClosePremiumPct);
  add("sector-first-seal:followers", "题材跟风 · 次日高开", bundle.sectorFirstSeal.followers.highOpenSuccesses, bundle.sectorFirstSeal.followers.n, bundle.sectorFirstSeal.followers.avgClosePremiumPct);
  return { buckets, names, conditionalReturnById };
}

function buildBayesPipeline(bundle: Awaited<ReturnType<typeof getStrategyBundle>>) {
  const { buckets, names, conditionalReturnById } = buildBayesInputs(bundle);
  // Current persisted summaries contain no validated market-regime label.
  // Keep observations UNCLASSIFIED rather than inventing ICE/RECOVERY/WARMING states.
  const assembly = assembleBayesStrategyViewData([{ regime: "UNCLASSIFIED", buckets }], {
    names, minN: 5, credMass: 0.9,
  });
  const fdrById = new Map(assembly.fdr.results.map((row) => [row.id, row]));
  const strategySpecs: StrategySpec[] = assembly.strategies.map((item) => {
    const p0 = fdrById.get(item.id)?.p0 ?? 0.5;
    // p0 uses an explicit 10-observation calibration prior; fill data is absent,
    // so Beta(1,1) is neutral rather than an invented fill-rate estimate.
    const conditionalReturn = conditionalReturnById.get(item.id) ?? 0;
    return {
      id: item.id,
      thetaPrior: { alpha: item.posteriorAlpha, beta: item.posteriorBeta },
      p0Prior: { alpha: 1 + 10 * p0, beta: 1 + 10 * (1 - p0) },
      pFillPrior: { alpha: 1, beta: 1 },
      // Missing conditional-return observations are set to zero, never fabricated.
      conditionalReturn: { sample: () => conditionalReturn },
    };
  });
  const draws = buildJointReturnDraws({
    strategies: strategySpecs, nSamples: BAYES_DRAWS, seed: 0x5eed2026,
    // No calibrated hyperparameter time series exists; share an explicit identity draw.
    sampleHyper: () => ({ ...NEUTRAL_HYPER }),
  });
  const wCap = Math.max(1 / strategySpecs.length, 0.35);
  const optimization = computeTargetWeightFromDraws(draws, { wCap });

  // No independent out-of-sample segment evidence or confirmed regime is persisted.
  // Execute the scheduler in OFF mode only; it must preserve the equal-weight anchor.
  const uniformProbabilities = { ICE: 0.2, RECOVERY: 0.2, WARMING: 0.2, EUPHORIA: 0.2, EXTREME: 0.2 };
  const scheduler = scheduleRegimeWeights({
    dayIndex: 0, regime: "UNCLASSIFIED", probabilities: uniformProbabilities,
    targetWeights: optimization.wStar, independentSegmentSamples: 0,
    targetBeatsEqualWeight: false, eventTriggered: false, t4Triggered: false,
    state: { lastTradeDay: null, lastReviewDay: null, previousWeights: optimization.wEq },
  });
  const missingReturnCount = assembly.strategies.filter((x) => !conditionalReturnById.has(x.id)).length;
  return {
    ...assembly,
    regimeClassification: "UNCLASSIFIED" as const,
    allocationMode: "SHADOW_ONLY" as const,
    optimization: {
      targetWeights: optimization.wStar, equalWeights: optimization.wEq,
      converged: optimization.optimized.converged, fallback: optimization.optimized.fallback,
      iterations: optimization.optimized.iterations, objective: optimization.optimized.objective,
    },
    scheduler: {
      mode: scheduler.mode, weights: scheduler.weights,
      tradeTriggered: scheduler.tradeTriggered, reviewTriggered: scheduler.reviewTriggered,
      reason: scheduler.reason, fallback: scheduler.fallback,
    },
    jointDiagnostics: draws.diagnostics,
    pipelineWarnings: [
      "当前数据库汇总没有经过确认的市场 regime 标签，所有桶暂归 UNCLASSIFIED；不推断市场状态。",
      "当前没有独立样本外调仓段，调度器固定为 OFF；不会生成或执行真实交易。",
      "成交率没有可用观测，pFill 使用中性 Beta(1,1)；超参数使用共享单位尺度抽样。",
      `${missingReturnCount} 个战法桶缺少条件收益观测，条件收益按 0 处理，不虚构收益。`,
    ],
  };
}

export async function GET() {
  try {
    const bundle = await getStrategyBundle();
    const bayes = buildBayesPipeline(bundle);
    return NextResponse.json({ ...bundle, bayes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "未知错误" }, { status: 500 });
  }
}
