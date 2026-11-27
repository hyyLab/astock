import type { JointReturnDraws } from "./joint-returns";

export interface OptimizeWeightsOptions {
  returns: number[][];
  wCap: number;
  riskAversion?: number;
  turnoverPenalty?: number;
  initialWeights?: number[];
  maxIterations?: number;
  tolerance?: number;
  stepSize?: number;
}

export interface OptimizeWeightsResult {
  weights: number[];
  converged: boolean;
  iterations: number;
  objective: number;
  fallback: boolean;
}

export interface ComputeTargetWeightResult {
  wStar: number[];
  wEq: number[];
  optimized: OptimizeWeightsResult;
}

function validateFiniteArray(values: number[], name: string): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error(`${name}[${i}] is not finite`);
  }
}

function equalWeights(m: number): number[] {
  if (!Number.isInteger(m) || m <= 0) {
    throw new Error("Number of strategies must be positive");
  }
  return new Array(m).fill(1 / m);
}

/**
 * Euclidean projection onto {w: sum(w)=1, 0<=w_i<=wCap}.
 * w_i = clip(v_i - lambda, 0, wCap), with lambda found by 80 bisection steps.
 * Numerical residual is distributed only over dimensions that are not at a bound.
 */
export function projectCappedSimplex(values: number[], wCap: number): number[] {
  const m = values.length;
  if (m === 0) throw new Error("Cannot project an empty vector");
  if (!Number.isFinite(wCap) || wCap <= 0) {
    throw new Error("wCap must be finite and positive");
  }
  validateFiniteArray(values, "values");
  if (m * wCap < 1) {
    throw new Error(`Infeasible capped simplex: m*wCap=${m * wCap} < 1`);
  }

  const clip = (x: number): number => Math.min(wCap, Math.max(0, x));
  let left = Math.min(...values) - wCap;
  let right = Math.max(...values);

  for (let iteration = 0; iteration < 80; iteration++) {
    const lambda = (left + right) / 2;
    let sum = 0;
    for (let i = 0; i < m; i++) sum += clip(values[i] - lambda);
    if (sum > 1) left = lambda;
    else right = lambda;
  }

  const lambda = (left + right) / 2;
  const weights = values.map((value) => clip(value - lambda));
  let residual = 1 - weights.reduce((sum, weight) => sum + weight, 0);
  const epsilon = 1e-12;

  for (let pass = 0; pass < m && Math.abs(residual) > epsilon; pass++) {
    const free = weights
      .map((weight, index) => ({ weight, index }))
      .filter(({ weight }) =>
        residual > 0 ? weight < wCap - epsilon : weight > epsilon,
      );
    if (free.length === 0) break;

    const adjustment = residual / free.length;
    for (const { index } of free) {
      const before = weights[index];
      const after = clip(before + adjustment);
      weights[index] = after;
      residual -= after - before;
    }
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  if (
    Math.abs(sum - 1) > 1e-9 ||
    weights.some((weight) => weight < -epsilon || weight > wCap + epsilon)
  ) {
    throw new Error("Capped simplex projection failed numerical validation");
  }
  return weights;
}

interface ReturnStatistics {
  mean: number[];
  covariance: number[][];
}

function calculateStatistics(returns: number[][]): ReturnStatistics {
  const n = returns.length;
  const m = returns[0]?.length ?? 0;
  if (n < 2 || m === 0) throw new Error("At least two return samples are required");

  for (let s = 0; s < n; s++) {
    if (returns[s].length !== m) throw new Error("Inconsistent return matrix dimensions");
    validateFiniteArray(returns[s], `returns[${s}]`);
  }

  const mean = new Array(m).fill(0);
  for (const row of returns) {
    for (let j = 0; j < m; j++) mean[j] += row[j] / n;
  }

  const covariance = Array.from({ length: m }, () => new Array(m).fill(0));
  for (const row of returns) {
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        covariance[i][j] +=
          ((row[i] - mean[i]) * (row[j] - mean[j])) / (n - 1);
      }
    }
  }
  return { mean, covariance };
}

function matrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0),
  );
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function objectiveValue(
  weights: number[],
  stats: ReturnStatistics,
  riskAversion: number,
): number {
  const covarianceProduct = matrixVector(stats.covariance, weights);
  return dot(stats.mean, weights) -
    0.5 * riskAversion * dot(weights, covarianceProduct);
}

function vectorDistance(a: number[], b: number[]): number {
  return Math.sqrt(
    a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0),
  );
}

function fallbackResult(m: number): OptimizeWeightsResult {
  return {
    weights: equalWeights(m),
    converged: false,
    iterations: 0,
    objective: 0,
    fallback: true,
  };
}

/**
 * Projected proximal-gradient ascent for mean-variance utility:
 * mu'w - riskAversion/2 * w'Cov*w.
 *
 * Proximal center is the current iterate wCur, not the zero vector.
 * Any exception returns equal weights.
 */
export function optimizeWeights(options: OptimizeWeightsOptions): OptimizeWeightsResult {
  const m = options.returns[0]?.length ?? 0;
  if (m === 0) return fallbackResult(1);

  try {
    const riskAversion = options.riskAversion ?? 1;
    const turnoverPenalty = options.turnoverPenalty ?? 0.05;
    const maxIterations = options.maxIterations ?? 1000;
    const tolerance = options.tolerance ?? 1e-9;
    const stepSize = options.stepSize ?? 0.05;

    if (
      !Number.isFinite(riskAversion) || riskAversion < 0 ||
      !Number.isFinite(turnoverPenalty) || turnoverPenalty < 0 ||
      !Number.isInteger(maxIterations) || maxIterations <= 0 ||
      !Number.isFinite(tolerance) || tolerance <= 0 ||
      !Number.isFinite(stepSize) || stepSize <= 0
    ) {
      throw new Error("Invalid optimizer parameters");
    }

    const stats = calculateStatistics(options.returns);
    let wCur = options.initialWeights
      ? [...options.initialWeights]
      : equalWeights(m);

    if (wCur.length !== m) throw new Error("Initial weight dimension mismatch");
    validateFiniteArray(wCur, "initialWeights");
    wCur = projectCappedSimplex(wCur, options.wCap);

    let converged = false;
    let iterations = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      iterations = iteration + 1;
      const covarianceProduct = matrixVector(stats.covariance, wCur);
      const gradient = stats.mean.map(
        (mu, j) => mu - riskAversion * covarianceProduct[j],
      );

      const candidate = wCur.map((weight, j) => weight + stepSize * gradient[j]);

      // Proximal operator centered on wCur.
      const denominator = 1 + stepSize * turnoverPenalty;
      const proximal = candidate.map(
        (value, j) =>
          (value + stepSize * turnoverPenalty * wCur[j]) / denominator,
      );

      const wNext = projectCappedSimplex(proximal, options.wCap);
      const distance = vectorDistance(wNext, wCur);
      wCur = wNext;

      if (distance <= tolerance) {
        converged = true;
        break;
      }
    }

    return {
      weights: wCur,
      converged,
      iterations,
      objective: objectiveValue(wCur, stats, riskAversion),
      fallback: false,
    };
  } catch {
    return fallbackResult(m);
  }
}

/** Always compute and return both optimized and equal-weight targets. */
export function computeTargetWeight(
  options: OptimizeWeightsOptions,
): ComputeTargetWeightResult {
  const m = options.returns[0]?.length ?? 0;
  const wEq = equalWeights(m > 0 ? m : 1);
  const optimized = optimizeWeights(options);
  const wStar = optimized.fallback ? [...wEq] : [...optimized.weights];
  return { wStar, wEq, optimized };
}

export function computeTargetWeightFromDraws(
  draws: JointReturnDraws,
  options: Omit<OptimizeWeightsOptions, "returns">,
): ComputeTargetWeightResult {
  if (draws.strategyIds.length === 0) throw new Error("No strategy draws available");
  return computeTargetWeight({ ...options, returns: draws.samples });
}
