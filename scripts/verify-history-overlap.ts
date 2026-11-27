import { db } from "@/lib/db";
import { fetchZtPool,fetchZbPool,fetchDtPool } from "@/lib/market/em";
import { fetchIndexKline } from "@/lib/market/tx";
import { pmap } from "@/lib/market/http";
const ix=await fetchIndexKline("sh000001",40),dates=ix.bars.slice(-20).map(x=>x.date);
const rows=await pmap(dates,3,async date=>{
 const [zt,zb,dt,lu,br,dd]=await Promise.all([fetchZtPool(date.replace(/-/g,"")),fetchZbPool(date.replace(/-/g,"")),fetchDtPool(date.replace(/-/g,"")),
 db.limitUp.findMany({where:{tradeDate:date},select:{stockCode:true}}),db.brokenLimit.findMany({where:{tradeDate:date},select:{stockCode:true}}),db.limitDown.findMany({where:{tradeDate:date},select:{stockCode:true}})]);
 const score=(truth:string[],pred:string[])=>{const t=new Set(truth),p=new Set(pred),tp=[...t].filter(x=>p.has(x)).length;return {truth:t.size,pred:p.size,tp,recall:t.size?tp/t.size:1,precision:p.size?tp/p.size:1};};
 return {date,zt:score(zt.map(x=>x.code),lu.map(x=>x.stockCode)),zb:score(zb.map(x=>x.code),br.map(x=>x.stockCode)),dt:score(dt.map(x=>x.code),dd.map(x=>x.stockCode))};
});
const avg=(k:"zt"|"zb"|"dt",f:"recall"|"precision")=>rows.reduce((s,r)=>s+r[k][f],0)/Math.max(1,rows.length);
const leaders=["002242","000530","001309","603986"];
const leaderRows=await db.limitUp.findMany({where:{stockCode:{in:leaders}},orderBy:{tradeDate:"desc"},select:{stockCode:true,tradeDate:true,boardCount:true}});
const leaderCoverage=leaders.map(code=>({code,rows:leaderRows.filter(x=>x.stockCode===code).length,latest:leaderRows.find(x=>x.stockCode===code)||null}));
const report={rows,mean:{ztRecall:avg("zt","recall"),ztPrecision:avg("zt","precision"),zbRecall:avg("zb","recall"),zbPrecision:avg("zb","precision"),dtRecall:avg("dt","recall"),dtPrecision:avg("dt","precision")},leaderCoverage};
console.log(JSON.stringify(report,null,2));
if(report.mean.ztRecall<.97||report.mean.ztPrecision<.95||report.mean.zbRecall<.90||report.mean.zbPrecision<.85)process.exitCode=2;
if(leaderCoverage.some(x=>x.rows===0))process.exitCode=3;
await db.$disconnect();
