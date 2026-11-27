/**
 * Bayesian joint return draws.
 *
 * R[s][j] = 1(theta[s][j] > p0[s][j]) * pFill[s][j] * rCond[s][j]
 *
 * One shared HyperSample is drawn per Monte Carlo sample.
 * Conditional variables are sampled independently given HyperSample.
 */

export type RNG = () => number;

export interface BetaPrior {
  alpha: number;
  beta: number;
}

export interface HyperSample {
  thetaAlphaScale: number;
  thetaBetaScale: number;
  p0AlphaScale: number;
  p0BetaScale: number;
  pFillAlphaScale: number;
  pFillBetaScale: number;
  returnShift: number;
  returnScale: number;
}

export interface CondReturnSource {
  sample(rng: RNG, hyper: HyperSample): number;
}

export interface StrategySpec {
  id: string;
  thetaPrior: BetaPrior;
  p0Prior: BetaPrior;
  pFillPrior: BetaPrior;
  conditionalReturn: CondReturnSource;
}

export interface JointReturnDiagnostics {
  gateRate: number;
  pointEstimateMu: number;
}

export interface JointReturnDraws {
  samples: number[][];
  strategyIds: string[];
  diagnostics: Record<string, JointReturnDiagnostics>;
}

export interface BuildJointReturnDrawsOptions {
  strategies: StrategySpec[];
  nSamples: number;
  seed: number;
  sampleHyper: (rng: RNG) => HyperSample;
}

const POINT_ESTIMATE_KEYS = new Set([
  "postMean",
  "p0",
  "pFill",
  "rCondMean",
]);

export function assertNoPointEstimate(
  value: unknown,
  path = "StrategySpec",
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoPointEstimate(item, `${path}[${index}]`, seen),
    );
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (POINT_ESTIMATE_KEYS.has(key)) {
      throw new Error(`Point estimate field "${key}" is forbidden at ${path}.${key}`);
    }
    assertNoPointEstimate(child, `${path}.${key}`, seen);
  }
}

/** Reproducible Mulberry32 RNG. */
export function mulberry32(seed: number): RNG {
  let state = seed >>> 0;
  return function random(): number {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and positive`);
  }
}

function normalSample(rng: RNG): number {
  let u1 = rng();
  while (u1 <= 0) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Marsaglia-Tsang Gamma(shape, 1), with the shape<1 boost. */
export function gammaSample(shape: number, rng: RNG): number {
  positiveFinite(shape, "Gamma shape");

  if (shape < 1) {
    let u = rng();
    while (u <= 0) u = rng();
    return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (let attempt = 0; attempt < 10000; attempt++) {
    const x = normalSample(rng);
    const base = 1 + c * x;
    if (base <= 0) continue;

    const v = base * base * base;
    const u = rng();

    if (
      u < 1 - 0.0331 * x * x * x * x ||
      Math.log(Math.max(u, Number.MIN_VALUE)) <
        0.5 * x * x + d * (1 - v + Math.log(v))
    ) {
      return d * v;
    }
  }

  throw new Error("Gamma sampling failed to converge");
}

/** Beta(alpha, beta) via two independent Gamma draws. */
export function betaSample(alpha: number, beta: number, rng: RNG): number {
  positiveFinite(alpha, "Beta alpha");
  positiveFinite(beta, "Beta beta");

  const x = gammaSample(alpha, rng);
  const y = gammaSample(beta, rng);
  const denominator = x + y;

  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new Error("Invalid Beta sampling denominator");
  }
  return x / denominator;
}

function validateBetaPrior(prior: BetaPrior, name: string): void {
  positiveFinite(prior.alpha, `${name}.alpha`);
  positiveFinite(prior.beta, `${name}.beta`);
}

function validateHyper(hyper: HyperSample): void {
  positiveFinite(hyper.thetaAlphaScale, "thetaAlphaScale");
  positiveFinite(hyper.thetaBetaScale, "thetaBetaScale");
  positiveFinite(hyper.p0AlphaScale, "p0AlphaScale");
  positiveFinite(hyper.p0BetaScale, "p0BetaScale");
  positiveFinite(hyper.pFillAlphaScale, "pFillAlphaScale");
  positiveFinite(hyper.pFillBetaScale, "pFillBetaScale");
  if (!Number.isFinite(hyper.returnShift)) throw new Error("returnShift must be finite");
  positiveFinite(hyper.returnScale, "returnScale");
}

function sampleConditionalReturn(
  source: CondReturnSource,
  rng: RNG,
  hyper: HyperSample,
): number {
  const raw = source.sample(rng, hyper);
  if (!Number.isFinite(raw)) throw new Error("Conditional return must be finite");

  const value = hyper.returnShift + hyper.returnScale * raw;
  if (!Number.isFinite(value)) throw new Error("Transformed return must be finite");
  return value;
}

/**
 * Draw one shared HyperSample per s, then conditionally independent
 * theta, p0, pFill and R|fill draws for each strategy j.
 * The nonlinear gate is evaluated separately for every (s,j).
 */
export function buildJointReturnDraws(
  options: BuildJointReturnDrawsOptions,
): JointReturnDraws {
  const { strategies, nSamples, seed, sampleHyper } = options;

  if (!Number.isInteger(nSamples) || nSamples <= 0) {
    throw new Error("nSamples must be a positive integer");
  }
  if (strategies.length === 0) throw new Error("At least one strategy is required");

  const ids = new Set<string>();
  for (const strategy of strategies) {
    assertNoPointEstimate(strategy);
    if (!strategy.id || ids.has(strategy.id)) {
      throw new Error(`Invalid or duplicated strategy id: ${strategy.id}`);
    }
    ids.add(strategy.id);
    validateBetaPrior(strategy.thetaPrior, "thetaPrior");
    validateBetaPrior(strategy.p0Prior, "p0Prior");
    validateBetaPrior(strategy.pFillPrior, "pFillPrior");
    if (typeof strategy.conditionalReturn?.sample !== "function") {
      throw new Error(`Strategy ${strategy.id} has no conditional return sampler`);
    }
  }
  if (typeof sampleHyper !== "function") throw new Error("sampleHyper must be a function");

  const rng = mulberry32(seed);
  const samples: number[][] = [];
  const gateCounts = new Array(strategies.length).fill(0);
  const returnSums = new Array(strategies.length).fill(0);

  for (let s = 0; s < nSamples; s++) {
    // Exactly one shared hyperparameter draw per Monte Carlo sample.
    const hyper = sampleHyper(rng);
    validateHyper(hyper);

    const row: number[] = [];
    for (let j = 0; j < strategies.length; j++) {
      const strategy = strategies[j];

      const theta = betaSample(
        strategy.thetaPrior.alpha * hyper.thetaAlphaScale,
        strategy.thetaPrior.beta * hyper.thetaBetaScale,
        rng,
      );
      const p0 = betaSample(
        strategy.p0Prior.alpha * hyper.p0AlphaScale,
        strategy.p0Prior.beta * hyper.p0BetaScale,
        rng,
      );
      const pFill = betaSample(
        strategy.pFillPrior.alpha * hyper.pFillAlphaScale,
        strategy.pFillPrior.beta * hyper.pFillBetaScale,
        rng,
      );
      const rCond = sampleConditionalReturn(strategy.conditionalReturn, rng, hyper);

      // Do not replace these sample-level draws with posterior means.
      const gate = theta > p0 ? 1 : 0;
      const r = gate * pFill * rCond;

      if (!Number.isFinite(r)) {
        throw new Error(`Non-finite joint return: sample=${s}, strategy=${strategy.id}`);
      }
      row.push(r);
      gateCounts[j] += gate;
      returnSums[j] += r;
    }
    samples.push(row);
  }

  const diagnostics: Record<string, JointReturnDiagnostics> = {};
  for (let j = 0; j < strategies.length; j++) {
    diagnostics[strategies[j].id] = {
      gateRate: gateCounts[j] / nSamples,
      // Display-only diagnostic; never used to construct the gate.
      pointEstimateMu: returnSums[j] / nSamples,
    };
  }

  return {
    samples,
    strategyIds: strategies.map((strategy) => strategy.id),
    diagnostics,
  };
}
