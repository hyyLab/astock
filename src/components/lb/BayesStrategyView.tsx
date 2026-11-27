"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FlaskConical, Info, ArrowDown, ArrowUp, Minus } from "lucide-react";

export type BayesEvidenceLevel = "INSUFFICIENT" | "WATCH" | "SUFFICIENT" | "NO_DIFFERENCE";
export interface BayesStrategyItem {
  id:string; name:string; regime:string; rawWinRate:number; postMean:number;
  hdiLower:number; hdiUpper:number; lambda:number; n:number;
  noSignificantMarketDifference?:boolean;
  selected?:boolean;
}
export interface BayesStrategyViewProps {
  strategies:BayesStrategyItem[];
  vpNonPositive:boolean;
  activeRegime?:string|null;
  onRegimeChange?:(regime:string|null)=>void;
  regimes?:string[];
  thresholds?:{
    insufficientLambda?:number; watchLambda?:number;
    sufficientLambda?:number; sufficientHdiLower?:number;
  };
}
const pct=(x:number)=>(x*100).toFixed(1)+"%";
const labels:Record<BayesEvidenceLevel,string>={
  INSUFFICIENT:"样本不足",WATCH:"待观察",SUFFICIENT:"证据充分",NO_DIFFERENCE:"与大盘无显著差异"
};
function evidence(item:BayesStrategyItem,t:{
  insufficientLambda:number;watchLambda:number;sufficientLambda:number;sufficientHdiLower:number;
}):BayesEvidenceLevel{
  if(item.noSignificantMarketDifference)return "NO_DIFFERENCE";
  if(item.n<5||item.lambda>=t.insufficientLambda)return "INSUFFICIENT";
  if(item.lambda>=t.watchLambda)return "WATCH";
  if(item.lambda<=t.sufficientLambda&&item.hdiLower>=t.sufficientHdiLower)return "SUFFICIENT";
  return "WATCH";
}
function Card({children}:{children:ReactNode}){
  return <section className="rounded border border-border bg-card p-3">{children}</section>;
}

/** Pure presentation: caller supplies posterior data; this component never calls an API. */
export default function BayesStrategyView(props:BayesStrategyViewProps){
  const {strategies,vpNonPositive,onRegimeChange,regimes=[]}=props;
  const [localRegime,setLocalRegime]=useState<string|null>(null);
  const selected=props.activeRegime===undefined?localRegime:props.activeRegime;
  const cfg={
    insufficientLambda:props.thresholds?.insufficientLambda??.8,
    watchLambda:props.thresholds?.watchLambda??.35,
    sufficientLambda:props.thresholds?.sufficientLambda??.15,
    sufficientHdiLower:props.thresholds?.sufficientHdiLower??.5
  };
  const options=regimes.length?regimes:Array.from(new Set(strategies.map(x=>x.regime)));
  const rows=useMemo(()=>strategies.filter(x=>selected===null||x.regime===selected)
    .slice().sort((a,b)=>b.hdiLower-a.hdiLower),[strategies,selected]);
  const change=(value:string|null)=>{
    if(props.activeRegime===undefined)setLocalRegime(value);
    onRegimeChange?.(value);
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <FlaskConical className="h-4 w-4 text-gold"/> 贝叶斯战法证据
      </h2>
      <span className="text-[11px] text-dim">按 HDI 下界排序 · 后验数据由父组件传入</span>
    </div>
    {vpNonPositive&&<div className="flex items-start gap-2 rounded border border-border bg-subtle p-3 text-[12px] text-dim">
      <Info className="mt-0.5 h-4 w-4 shrink-0"/>
      <div><div className="font-medium text-foreground">桶间差异证据不足：完全收缩</div>
        <p className="mt-0.5">当前 v_p ≤ 0，战法间暂不区分，后验胜率收缩至总体胜率。可切换 regime 查看分层结果。</p>
      </div>
    </div>}
    <Card><div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="font-medium">Regime 分层</span>
      <button type="button" onClick={()=>change(null)}
        className={"rounded border px-2 py-1 "+(selected===null?"border-gold text-gold":"border-border text-dim hover:bg-subtle")}>全部</button>
      {options.map(regime=><button type="button" key={regime} onClick={()=>change(regime)}
        className={"rounded border px-2 py-1 "+(selected===regime?"border-gold text-gold":"border-border text-dim hover:bg-subtle")}>{regime}</button>)}
    </div></Card>
    <Card>{rows.length===0?<p className="py-6 text-center text-[12px] text-dim">当前分层暂无数据</p>:
      <div className="space-y-2">{rows.map(item=>{
        const level=evidence(item,cfg);
        const direction=item.postMean>item.rawWinRate?"up":item.postMean<item.rawWinRate?"down":"flat";
        const arrowSize=Math.max(4,Math.min(28,item.lambda*28));
        return <div key={item.id} className="rounded border border-border bg-subtle p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><div className="text-[12px] font-medium">{item.name}</div>
              <div className="text-[10px] text-dim">{item.regime} · n={item.n}</div></div>
            <div className="text-right"><div className="flex items-center justify-end gap-1 tabular-nums">
              <span className="text-lg font-semibold">{pct(item.rawWinRate)}</span>
              <span className="flex items-center gap-0.5 text-[11px] text-dim" title={"lambda="+item.lambda.toFixed(3)}>
                {direction==="up"?<ArrowUp style={{width:arrowSize,height:arrowSize}}/>:
                  direction==="down"?<ArrowDown style={{width:arrowSize,height:arrowSize}}/>:
                  <Minus style={{width:arrowSize,height:arrowSize}}/>}
                {pct(item.postMean)}
              </span>
            </div><div className="text-[10px] text-dim">HDI {pct(item.hdiLower)}–{pct(item.hdiUpper)}</div></div>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-dim">
            <span>{item.selected?"FDR 入选 · ":""}{labels[level]}</span><span>收缩系数 λ={item.lambda.toFixed(2)}</span>
          </div>
        </div>;
      })}</div>}
    </Card>
    <p className="px-1 text-[10px] leading-relaxed text-dim">
      主数字为原始样本胜率；灰色箭头指向后验均值，长度按 λ 映射。排序只使用 HDI 下界。证据标签阈值可由父组件配置。
    </p>
  </div>;
}
