import { estimateEmpiricalPrior, type WinRateBucket } from "./empirical-prior";
import { betaHdi } from "./hdi";
import { selectBayesianFdr, type BayesianFdrOptions, type BayesianFdrResult } from "./fdr";

export interface RegimeWinRateGroup { regime:string; buckets:WinRateBucket[] }
export interface BayesStrategyItem {
  id:string; name:string; regime:string; rawWinRate:number; postMean:number;
  hdiLower:number; hdiUpper:number; lambda:number; n:number;
  posteriorAlpha:number; posteriorBeta:number;
  selected:boolean; noSignificantMarketDifference:boolean;
}
export interface AssembleBayesOptions {
  names?:Record<string,string>;
  minN?:number;
  credMass?:number;
  fdr?:BayesianFdrOptions;
}
export interface BayesAssemblyResult {
  strategies:BayesStrategyItem[];
  regimes:string[];
  vpNonPositive:boolean;
  fdr:BayesianFdrResult;
  priorFallbackRegimes:string[];
  warnings:string[];
}

/**
 * Fit an independent empirical prior within each market regime, then apply
 * Bayesian FDR to the eligible strategies. FDR is global over the supplied
 * regime groups while its null baseline is computed within each regime.
 */
export function assembleBayesStrategyViewData(
  groups:RegimeWinRateGroup[],options:AssembleBayesOptions={}
):BayesAssemblyResult {
  const minN=options.minN??5,credMass=options.credMass??0.9;
  if(!Array.isArray(groups)||!Number.isInteger(minN)||minN<1||
    !(credMass>0&&credMass<1))throw new Error("Invalid Bayes assembly options");
  const ids=new Set<string>(),items:BayesStrategyItem[]=[],fdrInput:
    Array<{id:string;regime:string;wins:number;n:number}>=[];
  const priorFallbackRegimes:string[]=[];
  const warnings:string[]=[];
  let vpNonPositive=false;
  for(const group of groups){
    if(!group.regime||!Array.isArray(group.buckets))throw new Error("Invalid regime group");
    const prior=estimateEmpiricalPrior(group.buckets);
    if(prior.fallback)priorFallbackRegimes.push(group.regime);
    if(prior.vp<=0||prior.completeShrinkage)vpNonPositive=true;
    const posteriorById=new Map(prior.buckets.map(x=>[x.id,x]));
    for(const bucket of group.buckets){
      if(ids.has(bucket.id))throw new Error("Duplicate strategy id across regime groups: "+bucket.id);
      ids.add(bucket.id);
      const fitted=posteriorById.get(bucket.id);
      if(!fitted){
        warnings.push(`战法 ${bucket.id} 的桶数据无效，经验先验回退结果中没有该桶，已跳过展示和 FDR`);
        continue;
      }
      // In complete-shrinkage mode, keep a common regime-level posterior:
      // individual bucket observations must not re-introduce strategy differences.
      const alpha=prior.completeShrinkage?prior.alpha:prior.alpha+bucket.wins;
      const beta=prior.completeShrinkage?prior.beta:prior.beta+bucket.n-bucket.wins;
      const [hdiLower,hdiUpper]=betaHdi(alpha,beta,credMass);
      items.push({
        id:bucket.id,name:options.names?.[bucket.id]??bucket.id,regime:group.regime,
        rawWinRate:bucket.n?bucket.wins/bucket.n:fitted.observedRate,postMean:fitted.postMean,
        hdiLower,hdiUpper,lambda:fitted.lambda,n:bucket.n,posteriorAlpha:alpha,posteriorBeta:beta,
        selected:false,noSignificantMarketDifference:false
      });
      // The minimum-N gate is deliberately applied before invoking FDR.
      if(bucket.n>=minN)fdrInput.push({id:bucket.id,regime:group.regime,wins:bucket.wins,n:bucket.n});
    }
  }
  const fdr=selectBayesianFdr(fdrInput,{...options.fdr,minN});
  const selected=new Set(fdr.fallback?[]:fdr.selectedIds);
  for(const item of items){
    item.selected=selected.has(item.id);
    // A failed FDR computation is unknown evidence, not evidence of no difference.
    item.noSignificantMarketDifference=!fdr.fallback&&!item.selected&&item.n>=minN;
  }
  return {strategies:items,regimes:[...new Set(groups.map(x=>x.regime))],
    vpNonPositive,fdr,priorFallbackRegimes,warnings};
}

/** Convenience API when only the BayesStrategyItem[] is needed. */
export function assembleBayesStrategies(
  groups:RegimeWinRateGroup[],options:AssembleBayesOptions={}
):BayesStrategyItem[] {
  return assembleBayesStrategyViewData(groups,options).strategies;
}
