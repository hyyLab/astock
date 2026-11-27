export type RegimeName="ICE"|"RECOVERY"|"WARMING"|"EUPHORIA"|"EXTREME";
export type SlowVariableVector=[number,number,number,number];
export interface RegimePrototype { regime:RegimeName; center:SlowVariableVector }
export interface RegimeMembershipState {
  ema:Record<RegimeName,number>; confirmedRegime:RegimeName|null;
  candidateRegime:RegimeName|null; candidateCount:number;
}
export interface RegimeMembershipOptions { tau?:number; emaAlpha?:number; hysteresisThreshold?:number; hysteresisConfirmations?:number }
export interface RegimeMembershipResult {
  probabilities:Record<RegimeName,number>; rawProbabilities:Record<RegimeName,number>;
  state:RegimeMembershipState; fallback:boolean;
}
export interface SchedulerState { lastTradeDay:number|null; lastReviewDay:number|null; previousWeights:number[] }
export interface SchedulerInput {
  dayIndex:number; regime:RegimeName; probabilities:Record<RegimeName,number>;
  /** Legacy/upstream-selected target; used when no confident regime-specific target is supplied. */
  targetWeights:number[];
  /** Optional targets keyed by the already-confirmed regime. */
  targetWeightsByRegime?:Partial<Record<RegimeName,number[]>>;
  independentSegmentSamples:number; targetBeatsEqualWeight:boolean;
  eventTriggered:boolean; t4Triggered:boolean; state:SchedulerState;
}
export interface SchedulerOptions {
  cooldownDays?:number; t4ReviewDays?:number;
  /** Maximum allocation change per executed rebalance event (not per calendar day). */
  maxRebalanceStep?:number;
  /** @deprecated Use maxRebalanceStep; retained for compatibility. */
  maxDailyStep?:number;
  hardFloorOff?:number; hardFloorShadow?:number;
}
export interface SchedulerResult {
  weights:number[]; mode:"OFF"|"SHADOW"|"ACTIVE"; tradeTriggered:boolean;
  reviewTriggered:boolean; reason:string; state:SchedulerState; fallback:boolean;
}
const REGIMES:RegimeName[]=["ICE","RECOVERY","WARMING","EUPHORIA","EXTREME"];
const uniform=():Record<RegimeName,number>=>({ICE:.2,RECOVERY:.2,WARMING:.2,EUPHORIA:.2,EXTREME:.2});
const eq=(n:number)=>Array(Math.max(1,n)).fill(1/Math.max(1,n));
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const validVector=(x:number[])=>x.length===4&&x.every(Number.isFinite);
function normalize(x:number[]):number[]{
  const s=x.reduce((a,b)=>a+b,0);if(!(s>0)||!Number.isFinite(s))throw new Error("Invalid sum");
  return x.map(v=>v/s);
}

/** Clip four externally calculated z-scores to [-3,3], then fixed-prototype softmax. */
export function softRegimeMembership(
  features:SlowVariableVector,prototypes:RegimePrototype[],previous?:RegimeMembershipState,
  options:RegimeMembershipOptions={}
):RegimeMembershipResult {
  const state=previous??{ema:uniform(),confirmedRegime:null,candidateRegime:null,candidateCount:0};
  const tau=options.tau??.5,alpha=options.emaAlpha??.2,threshold=options.hysteresisThreshold??.6;
  const confirmations=options.hysteresisConfirmations??3;
  try{
    if(!validVector(features)||prototypes.length!==5||!(tau>0)||!(alpha>0&&alpha<=1)||
      !(threshold>0&&threshold<=1)||!Number.isInteger(confirmations)||confirmations<1)
      throw new Error("Invalid regime input");
    const map=new Map(prototypes.map(p=>[p.regime,p]));
    if(REGIMES.some(r=>!map.has(r))||prototypes.some(p=>!validVector(p.center)))throw new Error("Missing fixed prototype");
    const z=features.map(v=>clamp(v,-3,3));
    const logits=REGIMES.map(r=>{
      const center=map.get(r)!.center;
      const d=z.reduce((s,v,i)=>s+(v-center[i])**2,0);
      return -d/(2*tau*tau);
    });
    const max=Math.max(...logits),raw=normalize(logits.map(v=>Math.exp(v-max)));
    const rawProbabilities=Object.fromEntries(REGIMES.map((r,i)=>[r,raw[i]])) as Record<RegimeName,number>;
    const smoothed=normalize(raw.map((v,i)=>alpha*v+(1-alpha)*(state.ema[REGIMES[i]]??.2)));
    const probabilities=Object.fromEntries(REGIMES.map((r,i)=>[r,smoothed[i]])) as Record<RegimeName,number>;
    const best=REGIMES[smoothed.indexOf(Math.max(...smoothed))];
    let confirmedRegime=state.confirmedRegime,candidateRegime=state.candidateRegime,candidateCount=state.candidateCount;
    if(best!==confirmedRegime&&probabilities[best]>=threshold){
      candidateCount=candidateRegime===best?candidateCount+1:1;candidateRegime=best;
      if(candidateCount>=confirmations){confirmedRegime=best;candidateRegime=null;candidateCount=0;}
    }else{candidateRegime=null;candidateCount=0;}
    return {probabilities,rawProbabilities,state:{ema:probabilities,confirmedRegime,candidateRegime,candidateCount},fallback:false};
  }catch{return {probabilities:uniform(),rawProbabilities:uniform(),state,fallback:true};}
}

/** Component-wise median prototypes from labelled history strictly before windowStart. */
export function deriveHistoricalRegimePrototypes(
  history:Array<{date:string;regime:RegimeName;z:SlowVariableVector}>,windowStart:string
):RegimePrototype[]{
  const median=(values:number[])=>{
    const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);
    return s.length%2?s[m]:(s[m-1]+s[m])/2;
  };
  return REGIMES.map(regime=>{
    const rows=history.filter(r=>r.date<windowStart&&r.regime===regime&&validVector(r.z));
    if(!rows.length)throw new Error("Insufficient strictly-prior prototype history for "+regime);
    return {regime,center:[0,1,2,3].map(i=>median(rows.map(r=>r.z[i]))) as SlowVariableVector};
  });
}

/** Redistribute residual only across dimensions with remaining per-day step capacity. */
function boundedStep(previous:number[],target:number[],step:number):number[]{
  const next=previous.map((v,i)=>v+clamp(target[i]-v,-step,step));
  let residual=1-next.reduce((a,b)=>a+b,0);
  for(let pass=0;pass<previous.length*2&&Math.abs(residual)>1e-10;pass++){
    const free=next.map((v,i)=>({v,i})).filter(x=>residual>0
      ? x.v<previous[x.i]+step-1e-10 : x.v>previous[x.i]-step+1e-10);
    if(!free.length)break;
    const delta=residual/free.length;
    for(const x of free){const before=next[x.i];
      next[x.i]=clamp(before+delta,previous[x.i]-step,previous[x.i]+step);
      residual-=next[x.i]-before;}
  }
  if(Math.abs(residual)>1e-7)throw new Error("Daily step constraints infeasible");
  return next;
}
function scheduleFallback(input:SchedulerInput,reason:string):SchedulerResult{
  const weights=eq(input.targetWeights?.length??1);
  return {weights,mode:"OFF",tradeTriggered:false,reviewTriggered:false,reason,
    state:{...input.state,previousWeights:weights},fallback:true};
}

/** Inner loop refreshes target daily; outer loop trades only on event/cooldown or T4 review. */
export function scheduleRegimeWeights(input:SchedulerInput,options:SchedulerOptions={}):SchedulerResult{
  const cooldown=options.cooldownDays??5,t4Days=options.t4ReviewDays??20;
  const step=options.maxRebalanceStep??options.maxDailyStep??.03;
  const off=options.hardFloorOff??40,shadow=options.hardFloorShadow??60;
  try{
    const regimeTarget=input.targetWeightsByRegime?.[input.regime];
    // A regime-specific target is adopted only when the supplied regime posterior
    // gives the confirmed regime at least 50% membership; otherwise use upstream target.
    const target=regimeTarget&&input.probabilities[input.regime]>=0.5?regimeTarget:input.targetWeights;
    const n=target.length;
    if(!Number.isInteger(input.dayIndex)||n<1||target.some(x=>!Number.isFinite(x)||x<0)||
      !Number.isInteger(input.independentSegmentSamples)||input.independentSegmentSamples<0||
      !Number.isInteger(cooldown)||cooldown<0||!Number.isInteger(t4Days)||t4Days<1||
      !(step>0)||!(off>=0&&shadow>off))throw new Error("Invalid scheduler arguments");
    if(Math.abs(target.reduce((a,b)=>a+b,0)-1)>1e-6)throw new Error("Target must sum to one");
    const probabilityValues=REGIMES.map(r=>input.probabilities[r]);
    if(probabilityValues.some(v=>!Number.isFinite(v)||v<0)||
      Math.abs(probabilityValues.reduce((a,b)=>a+b,0)-1)>1e-5||
      !REGIMES.includes(input.regime))throw new Error("Invalid regime probabilities");
    const stored=input.state.previousWeights;
    if(stored.length!==n||stored.some(v=>!Number.isFinite(v)||v<0)||
      Math.abs(stored.reduce((a,b)=>a+b,0)-1)>1e-5)throw new Error("Invalid previous allocation");
    const previous=stored;
    if(input.independentSegmentSamples<off){
      const weights=eq(n);return {weights,mode:"OFF",tradeTriggered:false,reviewTriggered:false,
        reason:"独立样本少于 40：关闭",state:{...input.state,previousWeights:weights},fallback:false};
    }
    if(input.independentSegmentSamples<shadow||!input.targetBeatsEqualWeight){
      const weights=eq(n);return {weights,mode:"SHADOW",tradeTriggered:false,reviewTriggered:true,
        reason:input.independentSegmentSamples<shadow?"独立样本 40–59：影子运行":"样本未跑赢等权：维持影子运行",
        state:{...input.state,previousWeights:weights},fallback:false};
    }
    const t4Due=input.t4Triggered&&(input.state.lastReviewDay===null||
      input.dayIndex-input.state.lastReviewDay>=t4Days);
    const eventDue=input.eventTriggered&&(input.state.lastTradeDay===null||
      input.dayIndex-input.state.lastTradeDay>=cooldown);
    const review=t4Due||eventDue;
    // The 0.03 cap is applied once per executed rebalance event. Calendar days\n    // without an event never accumulate step capacity: slow, event-driven moves\n    // avoid reacting to noisy daily target fluctuations.\n    const proposedWeights=boundedStep(previous,normalize(target),step);
    return {weights:proposedWeights,mode:"ACTIVE",tradeTriggered:eventDue,reviewTriggered:review,
      reason:t4Due?"T4 距上次复核至少 20 日：强制复核":
        eventDue?"事件触发且冷却期结束":"每日刷新目标，不触发交易",
      state:{lastTradeDay:eventDue?input.dayIndex:input.state.lastTradeDay,
        lastReviewDay:review?input.dayIndex:input.state.lastReviewDay,
        // Keep the last executed allocation unchanged until the outer loop trades.
        previousWeights:eventDue?proposedWeights:previous},fallback:false};
  }catch{return scheduleFallback(input,"调度异常：回退等权");}
}
