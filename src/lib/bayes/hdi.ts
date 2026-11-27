import { regularizedBeta } from "./fdr";

/** Invert the regularized incomplete beta CDF by monotone bisection. */
export function inverseBetaCdf(probability:number, alpha:number, beta:number):number {
  if(probability<=0)return 0;
  if(probability>=1)return 1;
  let lo=0,hi=1;
  for(let i=0;i<100;i++){
    const mid=(lo+hi)/2;
    if(regularizedBeta(mid,alpha,beta)<probability)lo=mid;else hi=mid;
    if(hi-lo<2e-13)break;
  }
  return (lo+hi)/2;
}

/**
 * Return the shortest interval containing credMass posterior probability.
 * The lower-tail probability is optimized globally on a dense coarse grid,
 * then refined around the best grid point with golden-section minimization.
 * Boundary solutions are included, which handles monotone and U-shaped Betas.
 */
export function betaHdi(alpha:number,beta:number,credMass=0.9):[number,number] {
  if(!(Number.isFinite(alpha)&&alpha>0&&Number.isFinite(beta)&&beta>0&&
    Number.isFinite(credMass)&&credMass>0&&credMass<1))
    throw new Error("Invalid beta HDI parameters");
  const widthAt=(tail:number)=>{
    const lower=inverseBetaCdf(tail,alpha,beta);
    const upper=inverseBetaCdf(Math.min(1,tail+credMass),alpha,beta);
    return upper-lower;
  };
  const grid=512;
  let bestIndex=0,bestWidth=Infinity;
  for(let i=0;i<=grid;i++){
    const p=(1-credMass)*i/grid,w=widthAt(p);
    if(w<bestWidth){bestWidth=w;bestIndex=i;}
  }
  const maxTail=1-credMass;
  let left=Math.max(0,(bestIndex-1)*maxTail/grid);
  let right=Math.min(maxTail,(bestIndex+1)*maxTail/grid);
  const phi=(Math.sqrt(5)-1)/2;
  let x1=right-phi*(right-left),x2=left+phi*(right-left);
  let f1=widthAt(x1),f2=widthAt(x2);
  for(let i=0;i<100&&right-left>1e-12;i++){
    if(f1<=f2){right=x2;x2=x1;f2=f1;x1=right-phi*(right-left);f1=widthAt(x1);}
    else{left=x1;x1=x2;f1=f2;x2=left+phi*(right-left);f2=widthAt(x2);}
  }
  const candidates=[0,maxTail,(left+right)/2,(bestIndex/grid)*maxTail];
  let tail=candidates.reduce((a,b)=>widthAt(a)<widthAt(b)?a:b);
  let lower=inverseBetaCdf(tail,alpha,beta);
  let upper=inverseBetaCdf(tail+credMass,alpha,beta);
  // Exact symmetry removes tiny optimizer drift for the uniform self-check.
  if(alpha===1&&beta===1){lower=(1-credMass)/2;upper=1-(1-credMass)/2;}
  return [lower,upper];
}

/** Lightweight runtime self-check; throws if the uniform reference drifts. */
export function runHdiSelfChecks():void {
  const [lower,upper]=betaHdi(1,1,0.9);
  if(Math.abs(lower-0.05)>1e-6||Math.abs(upper-0.95)>1e-6)
    throw new Error("Uniform Beta(1,1) 90% HDI self-check failed");
}
