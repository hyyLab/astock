export interface FdrStrategy { id: string; regime: string; wins: number; n: number }
export interface BayesianFdrOptions { q?: number; priorAlpha?: number; priorBeta?: number; quadratureSteps?: number }
export interface FdrStrategyResult {
  id:string; regime:string; wins:number; n:number; p0:number;
  posteriorAlpha:number; posteriorBeta:number; v:number; selected:boolean; rank:number;
}
export interface BayesianFdrResult {
  q:number; selectedIds:string[]; cutoffIndex:number; averageVAtCutoff:number|null;
  globalBaseline:number; results:FdrStrategyResult[]; fallback:boolean;
}
const valid=(x:FdrStrategy)=>Boolean(x.id&&x.regime)&&Number.isInteger(x.n)&&x.n>=0&&
  Number.isInteger(x.wins)&&x.wins>=0&&x.wins<=x.n;
const clamp=(x:number)=>Math.max(1e-9,Math.min(1-1e-9,x));

function logGamma(z:number):number {
  const p=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.6150291621406,
    12.507343278686905,-0.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
  if(z<0.5) return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
  let x=0.9999999999998099; const t0=z-1;
  for(let i=0;i<p.length;i++) x+=p[i]/(t0+i+1);
  const t=t0+p.length-0.5;
  return 0.5*Math.log(2*Math.PI)+(t0+0.5)*Math.log(t)-t+Math.log(x);
}
function betaCf(a:number,b:number,x:number):number {
  const tiny=1e-300, eps=3e-14, qab=a+b, qap=a+1, qam=a-1;
  let c=1, d=1-qab*x/qap; if(Math.abs(d)<tiny)d=tiny; d=1/d;
  let h=d;
  for(let m=1;m<=200;m++) {
    const m2=2*m;
    let aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;
    d=1/d;h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;
    d=1/d;const delta=d*c;h*=delta;
    if(Math.abs(delta-1)<eps)return h;
  }
  throw new Error("Beta CDF did not converge");
}
function regularizedBeta(x:number,a:number,b:number):number {
  if(!(a>0&&b>0))throw new Error("Invalid beta parameters");
  if(x<=0)return 0;if(x>=1)return 1;
  const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  const value=x<(a+1)/(a+b+2)
    ? bt*betaCf(a,b,x)/a
    : 1-bt*betaCf(b,a,1-x)/b;
  return Math.max(0,Math.min(1,value));
}
function betaCdfFallback(x:number,a:number,b:number,steps:number):number {
  const dx=x/steps, norm=logGamma(a+b)-logGamma(a)-logGamma(b);let sum=0;
  for(let i=0;i<steps;i++){const t=(i+0.5)*dx;if(t>0&&t<1)
    sum+=Math.exp(norm+(a-1)*Math.log(t)+(b-1)*Math.log1p(-t))*dx;}
  return Math.max(0,Math.min(1,sum));
}
function posteriorV(p0:number,a:number,b:number,steps:number):number {
  try{return regularizedBeta(p0,a,b);}catch{return betaCdfFallback(p0,a,b,steps);}
}

/** v_i=P(theta_i<=p0_i|data); p0 is leave-one-strategy-out within regime. */
export function selectBayesianFdr(input:FdrStrategy[],options:BayesianFdrOptions={}):BayesianFdrResult {
  const q=options.q??0.10, pa=options.priorAlpha??1, pb=options.priorBeta??1, steps=options.quadratureSteps??4096;
  const empty:BayesianFdrResult={q,selectedIds:[],cutoffIndex:0,averageVAtCutoff:null,
    globalBaseline:0.5,results:[],fallback:true};
  try {
    if(!Array.isArray(input)||input.some(x=>!valid(x))||!(q>0&&q<1)||!(pa>0&&pb>0)||
      !Number.isInteger(steps)||steps<256)throw new Error("Invalid FDR inputs");
    const totalN=input.reduce((s,x)=>s+x.n,0),totalWins=input.reduce((s,x)=>s+x.wins,0);
    const globalBaseline=totalN?clamp(totalWins/totalN):0.5;
    const ranked=input.map(x=>{
      const same=input.filter(y=>y.regime===x.regime&&y.id!==x.id);
      const reference=same.length?same:input.filter(y=>y.id!==x.id);
      const n=reference.reduce((s,y)=>s+y.n,0),w=reference.reduce((s,y)=>s+y.wins,0);
      const p0=n?clamp(w/n):globalBaseline;
      const a=pa+x.wins,b=pb+x.n-x.wins;
      return {id:x.id,regime:x.regime,wins:x.wins,n:x.n,p0,posteriorAlpha:a,
        posteriorBeta:b,v:posteriorV(p0,a,b,steps),selected:false,rank:0};
    }).sort((a,b)=>a.v-b.v||a.id.localeCompare(b.id));
    let sum=0,cutoffIndex=0,averageVAtCutoff:number|null=null;
    for(let i=0;i<ranked.length;i++){
      const avg=(sum+ranked[i].v)/(i+1);
      if(avg<=q){sum+=ranked[i].v;cutoffIndex=i+1;averageVAtCutoff=avg;}else break;
    }
    ranked.forEach((x,i)=>{x.rank=i+1;x.selected=i<cutoffIndex;});
    return {q,selectedIds:ranked.filter(x=>x.selected).map(x=>x.id),cutoffIndex,
      averageVAtCutoff,globalBaseline,results:ranked,fallback:false};
  }catch{
    const safeResults=Array.isArray(input)?input.filter(valid).map(x=>({
      id:x.id,regime:x.regime,wins:x.wins,n:x.n,p0:0.5,
      posteriorAlpha:1,posteriorBeta:1,v:0.5,selected:false,rank:0
    })):[];
    return {...empty,results:safeResults,fallback:true};
  }
}
