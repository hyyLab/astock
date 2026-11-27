export interface WinRateBucket { id: string; wins: number; n: number }
export interface EmpiricalPriorOptions {
  minBucketN?: number; minBuckets?: number; minMu?: number; maxMu?: number;
  minKappa?: number; maxKappa?: number;
}
export interface BucketPosterior {
  id: string; wins: number; n: number; observedRate: number;
  lambda: number; postMean: number; includedInPriorFit: boolean;
}
export interface EmpiricalPriorResult {
  alpha: number; beta: number; mu: number; kappa: number;
  observedVar: number; binomialVar: number; vp: number;
  completeShrinkage: boolean; fallback: boolean; reason: string | null;
  buckets: BucketPosterior[];
}
const DEFAULTS = { minBucketN: 5, minBuckets: 3, minMu: 0.01, maxMu: 0.99, minKappa: 1, maxKappa: 200 };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const valid = (b: WinRateBucket) => Boolean(b.id) && Number.isInteger(b.n) && b.n >= 0 &&
  Number.isInteger(b.wins) && b.wins >= 0 && b.wins <= b.n;

function fallback(buckets: WinRateBucket[], reason: string): EmpiricalPriorResult {
  return { alpha: 1, beta: 1, mu: 0.5, kappa: 2, observedVar: 0, binomialVar: 0,
    vp: 0, completeShrinkage: true, fallback: true, reason,
    buckets: buckets.map(b => ({ id: b.id, wins: b.wins, n: b.n,
      observedRate: b.n ? b.wins / b.n : 0.5, lambda: 1, postMean: 0.5,
      includedInPriorFit: false })) };
}

/** n_i-weighted between-bucket rate variance minus weighted binomial noise. */
export function estimateEmpiricalPrior(input: WinRateBucket[], options: EmpiricalPriorOptions = {}): EmpiricalPriorResult {
  try {
    const c = { ...DEFAULTS, ...options };
    if (!Array.isArray(input) || input.some(b => !valid(b))) throw new Error("Invalid bucket input");
    if (!Number.isInteger(c.minBucketN) || c.minBucketN < 1 ||
        !Number.isInteger(c.minBuckets) || c.minBuckets < 1 ||
        !(c.minMu > 0 && c.minMu < c.maxMu && c.maxMu < 1) ||
        !(c.minKappa > 0 && c.minKappa <= c.maxKappa)) throw new Error("Invalid options");
    if (input.reduce((s,b) => s+b.n,0) === 0) return fallback(input, "总样本数为 0");
    const fit = input.filter(b => b.n >= c.minBucketN);
    const fitN = fit.reduce((s,b) => s+b.n,0);
    if (fit.length < c.minBuckets || fitN === 0) return fallback(input, "有效桶少于 3 个");
    const rawMu = fit.reduce((s,b) => s+b.wins,0) / fitN;
    const mu = clamp(rawMu,c.minMu,c.maxMu);
    const observedVar = fit.reduce((s,b) => s + b.n/fitN * (b.wins/b.n-rawMu)**2,0);
    const binomialVar = fit.reduce((s,b) => {
      const p=b.wins/b.n; return s + b.n/fitN * p*(1-p)/b.n;
    },0);
    const vp = observedVar-binomialVar;
    const completeShrinkage = !Number.isFinite(vp) || vp <= 0;
    const rawKappa = completeShrinkage ? c.maxKappa : mu*(1-mu)/vp-1;
    const kappa = clamp(rawKappa,c.minKappa,c.maxKappa);
    const alpha=mu*kappa, beta=(1-mu)*kappa;
    const buckets=input.map(b => {
      const observedRate=b.n ? b.wins/b.n : mu;
      const lambda=completeShrinkage ? 1 : kappa/(kappa+b.n);
      return { id:b.id,wins:b.wins,n:b.n,observedRate,lambda,
        postMean:completeShrinkage ? mu : (alpha+b.wins)/(alpha+beta+b.n),
        includedInPriorFit:b.n>=c.minBucketN };
    });
    const result={alpha,beta,mu,kappa,observedVar,binomialVar,vp,completeShrinkage,
      fallback:false,reason:null,buckets};
    runEmpiricalPriorSelfChecks(result,0,1);
    return result;
  } catch(e) { return fallback(Array.isArray(input) ? input.filter(valid) : [],
    e instanceof Error ? e.message : "经验贝叶斯估计异常"); }
}

/** Self-checks: lambda decreases with n, posterior is bounded, and large n approaches p_i. */
export function runEmpiricalPriorSelfChecks(result: EmpiricalPriorResult, minMu=0.01, maxMu=0.99): void {
  const ordered=result.buckets.filter(b=>b.n>0).sort((a,b)=>a.n-b.n);
  for(let i=1;i<ordered.length;i++) if(ordered[i].lambda>ordered[i-1].lambda+1e-12)
    throw new Error("lambda must be non-increasing with n");
  for(const b of result.buckets) {
    if(b.postMean<minMu-1e-12 || b.postMean>maxMu+1e-12) throw new Error("postMean out of bounds");
    if(!result.completeShrinkage && b.n>=10000 && Math.abs(b.postMean-b.observedRate)>0.01)
      throw new Error("large-n posterior does not converge to observed rate");
  }
}
