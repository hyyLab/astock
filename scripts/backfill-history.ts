import { db } from "@/lib/db";
import { fetchJson, pmap } from "@/lib/market/http";
import { fetchDailyKline, fetchIndexKline } from "@/lib/market/tx";
import { detectBarStatus, marketOf, limitUpPriceOf, limitDownPriceOf, limitPctOf } from "@/lib/market/rules";
import { computeBoardChain } from "@/lib/calc/board";
import { calcSentiment, sealRateOf, brokenRateOf } from "@/lib/calc/sentiment";
import { buildConceptStats, buildThemeStats } from "@/lib/calc/concept";
import { matchThemes } from "@/lib/calc/themeRules";

const opt=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.replace(/^--/,"").split("=");return [p[0],p.slice(1).join("=")||"true"];}));
const dry=opt["dry-run"]==="true", start=String(opt.start||"2025-08-01"), end=String(opt.end||new Date().toISOString().slice(0,10));
const ymd=(s:string)=>s.replace(/-/g,""), dateOnly=(s:string)=>s.slice(0,10), round=(n:number)=>Math.round(n*100)/100;
const chunks=<T,>(a:T[],n:number)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,i*n+n));
const volumeRatio=(bars:any[],i:number)=>{const p=bars.slice(Math.max(0,i-20),i);if(p.length<5)return null;const avg=p.reduce((s,b)=>s+b.volume,0)/p.length;return avg>0?round(bars[i].volume/avg):null;};
async function emBars(stock:any){
 const secid=(marketOf(stock.stockCode)==="SH"?"1.":"0.")+stock.stockCode;
 const q=new URLSearchParams({secid,ut:"7eea3edcaed734bea9cbfc24409ed989",fields1:"f1,f2,f3,f4,f5,f6",fields2:"f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",klt:"101",fqt:"0",beg:ymd(start),end:ymd(end),lmt:"321"});
 const j=await fetchJson<any>("https://push2his.eastmoney.com/api/qt/stock/kline/get?"+q,{referer:"https://quote.eastmoney.com/",timeoutMs:18000,retries:2,gapMs:120});
 return (j.data?.klines||[]).map((line:string)=>{const x=line.split(",");return {date:dateOnly(x[0]),open:+x[1],close:+x[2],high:+x[3],low:+x[4],volume:+x[5],amount:+x[6],changePct:+x[8],turnoverRate:+x[10]};}).filter((b:any)=>b.close>0&&b.high>=b.low&&Number.isFinite(b.changePct));
}
async function main(){
 const [stocks,index]=await Promise.all([db.stockBasic.findMany({select:{stockCode:true,stockName:true,industry:true,listingDate:true},orderBy:{stockCode:"asc"}}),fetchIndexKline("sh000001",321)]);
 if(!stocks.length)throw Error("StockBasic empty; refusing full-market history run");
 const dates=index.bars.map(b=>b.date).filter(d=>d>=start&&d<=end);
 if(dates.length<30)throw Error("Index trading calendar unavailable/too short");
 const target=dates.slice(-220),seed=dates.slice(Math.max(0,dates.length-240),dates.length-220),ruleDates=seed.concat(target);
 const rosters=new Map<string,any>();for(const d of ruleDates)rosters.set(d,{zt:new Set<string>(),zb:new Set<string>(),dt:new Set<string>()});
 console.log("[backfill] codes="+stocks.length+" target="+target[0]+".."+target[target.length-1]+" dry="+dry);
 const results=await pmap(stocks,4,async stock=>{try{return {stock,em:await emBars(stock),qq:await fetchDailyKline(stock.stockCode,320),error:null};}catch(e){return {stock,em:[],qq:[],error:String(e)};}});
 const barsByCode=new Map<string,any[]>(), names=new Map(stocks.map(s=>[s.stockCode,s.stockName]));
 let failed=0,priceMismatch=0,corporateInvalid=0,listingSkipped=0;
 for(const x of results){
  if(x.error||!x.em.length||!x.qq.length){failed++;continue;}
  const qq=new Map(x.qq.map((b:any)=>[b.date,b])),bars=x.em.filter((b:any)=>ruleDates.includes(b.date)).filter((b:any)=>{
   const q:any=qq.get(b.date);if(!q)return false;
   const diff=Math.max(Math.abs(b.open-q.open),Math.abs(b.high-q.high),Math.abs(b.low-q.low),Math.abs(b.close-q.close))/Math.max(b.close,.01);
   if(diff>.005){priceMismatch++;return false;}return true;
  }).sort((a:any,b:any)=>a.date.localeCompare(b.date));
  barsByCode.set(x.stock.stockCode,bars);
  for(let i=1;i<bars.length;i++){
   const b=bars[i],prev=bars[i-1];if(!ruleDates.includes(b.date))continue;
   if(x.stock.listingDate){const eligible=ruleDates.filter(d=>ymd(d)>=String(x.stock.listingDate).replace(/-/g,""));if(eligible.length&&ruleDates.indexOf(b.date)<ruleDates.indexOf(eligible[0])+5){listingSkipped++;continue;}}
   if(Math.abs(b.changePct-(b.close/prev.close-1)*100)>.5){corporateInvalid++;continue;}
   const status=detectBarStatus(x.stock.stockCode,x.stock.stockName,prev.close,b);if(status)rosters.get(b.date)[status==="limitUp"?"zt":status==="broken"?"zb":"dt"].add(x.stock.stockCode);
  }
 }
 const ztMap=new Map(ruleDates.map(d=>[d,rosters.get(d).zt])),chain=computeBoardChain(ruleDates,ztMap,names),byCode=new Map(stocks.map(s=>[s.stockCode,s]));
 const ds:any[]=[],lu:any[]=[],zb:any[]=[],dt:any[]=[],bh:any[]=[],sd:any[]=[],dm:any[]=[],dc:any[]=[],reg:any[]=[];
 for(const d of target){
  const r=rosters.get(d),states=chain.byDate.get(d);
  for(const code of new Set([...r.zt,...r.zb,...r.dt])){
   const bars=barsByCode.get(code)||[],i=bars.findIndex(b=>b.date===d);if(i<1)continue;const b=bars[i],p=bars[i-1],status=detectBarStatus(code,names.get(code)||code,p.close,b);if(!status)continue;
   ds.push({tradeDate:d,stockCode:code,open:b.open,high:b.high,low:b.low,close:b.close,prevClose:p.close,changePct:round(b.changePct),volume:b.volume,amount:b.amount>0?b.amount:null,turnoverRate:b.turnoverRate>0?b.turnoverRate:null,floatMarketCap:null,volumeRatio:volumeRatio(bars,i),isLimitUp:status==="limitUp",isLimitDown:status==="limitDown",isBroken:status==="broken",rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const code of r.zt){const bars=barsByCode.get(code)||[],i=bars.findIndex(b=>b.date===d);if(i<1)continue;const b=bars[i],p=bars[i-1],s=byCode.get(code),st=states.get(code);
   lu.push({tradeDate:d,stockCode:code,stockName:names.get(code)||code,limitPrice:limitUpPriceOf(p.close,limitPctOf(code,names.get(code)||code)),closePrice:b.close,changePct:round(b.changePct),firstLimitTime:null,lastLimitTime:null,openCount:-1,sealAmount:null,amount:b.amount>0?b.amount:null,turnoverRate:b.turnoverRate>0?b.turnoverRate:null,floatMarketCap:null,industry:s?.industry??null,boardCount:st?.boardCount??1,volumeRatio:volumeRatio(bars,i),sourceBoard:null,daysAndBoards:null,isPromotion:st?.isPromotion??false,isRebound:st?.isRebound??false,themes:JSON.stringify(matchThemes(names.get(code)||code,s?.industry)),themeEvidence:null,themesNewsEnriched:null,rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const code of r.zb){const bars=barsByCode.get(code)||[],i=bars.findIndex(b=>b.date===d);if(i<1)continue;const b=bars[i],p=bars[i-1],s=byCode.get(code);
   zb.push({tradeDate:d,stockCode:code,stockName:names.get(code)||code,limitPrice:limitUpPriceOf(p.close,limitPctOf(code,names.get(code)||code)),closePrice:b.close,changePct:round(b.changePct),firstLimitTime:null,openCount:-1,amount:b.amount>0?b.amount:null,turnoverRate:b.turnoverRate>0?b.turnoverRate:null,floatMarketCap:null,industry:s?.industry??null,volumeRatio:volumeRatio(bars,i),rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const code of r.dt){const bars=barsByCode.get(code)||[],i=bars.findIndex(b=>b.date===d);if(i<1)continue;const b=bars[i],p=bars[i-1],s=byCode.get(code);
   dt.push({tradeDate:d,stockCode:code,stockName:names.get(code)||code,limitPrice:limitDownPriceOf(p.close,limitPctOf(code,names.get(code)||code)),closePrice:b.close,changePct:round(b.changePct),brokeCount:null,continuousDays:null,amount:b.amount>0?b.amount:null,industry:s?.industry??null,rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const [code,st] of states)bh.push({tradeDate:d,stockCode:code,stockName:st.stockName,boardCount:st.boardCount,previousBoardCount:st.previousBoardCount,isPromotion:st.isPromotion,isBreak:st.isBreak,isRebound:st.isRebound,rowOrigin:"BACKFILL",dataQuality:"GOOD",fieldVersion:"history-v2"});
  const prevDate=ruleDates[ruleDates.indexOf(d)-1],prevCodes=prevDate?[...rosters.get(prevDate).zt]:[],prevReturns:number[]=[];
  for(const code of prevCodes){const bars=barsByCode.get(code)||[],i=bars.findIndex(b=>b.date===d);if(i>0)prevReturns.push((bars[i].close/bars[i-1].close-1)*100);}
  const yavg=prevReturns.length?round(prevReturns.reduce((a,b)=>a+b,0)/prevReturns.length):null,highest=Math.max(0,...[...states.values()].map(x=>x.boardCount));
  const sent=calcSentiment({limitUpCount:r.zt.size,limitDownCount:r.dt.size,brokenCount:r.zb.size,highestBoard:highest,yesterdayLimitAvg:yavg,upCount:null,downCount:null});
  sd.push({tradeDate:d,limitUpCount:r.zt.size,limitDownCount:r.dt.size,brokenLimitCount:r.zb.size,sealRate:sealRateOf(r.zt.size,r.zb.size),brokenRate:brokenRateOf(r.zt.size,r.zb.size),highestBoard:highest,yesterdayLimitAvg:yavg,yesterdayCount:prevReturns.length,yesterdayRedCount:prevReturns.filter(x=>x>0).length,promotionDetails:JSON.stringify(chain.promotionsByDate.get(d)||[]),sentimentTemperature:sent.temperature,sentimentStage:sent.stage,upCount:null,downCount:null,rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  const idx=index.bars.findIndex(b=>b.date===d),ib=index.bars[idx],ip=index.bars[idx-1];
  dm.push({tradeDate:d,shIndex:ib?.close??null,shChangePct:ip?round((ib.close/ip.close-1)*100):null,szIndex:null,szChangePct:null,cyIndex:null,cyChangePct:null,kcIndex:null,kcChangePct:null,sz50Index:null,sz50ChangePct:null,bz50Index:null,bz50ChangePct:null,totalAmount:null,upCount:null,downCount:null,flatCount:null,limitUpCount:r.zt.size,limitDownCount:r.dt.size,brokenCount:r.zb.size,sealRate:sealRateOf(r.zt.size,r.zb.size),dataSource:"eastmoney-push2his",rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  const inputs=[...r.zt].map(code=>{const s=byCode.get(code),b=barsByCode.get(code)?.find(x=>x.date===d);return {stockCode:code,stockName:names.get(code)||code,industry:s?.industry||"",boardCount:states.get(code)?.boardCount||1,firstLimitTime:null,amount:b?.amount??null};});
  for(const c of buildConceptStats(inputs,[...r.zb].map(code=>({industry:byCode.get(code)?.industry||""}))))dc.push({tradeDate:d,...c,kind:"industry",rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  for(const t of buildThemeStats(inputs)){const o:any={...t};delete o.members;dc.push({tradeDate:d,...o,kind:"theme",members:JSON.stringify(t.members),rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});}
  const win=index.bars.filter(b=>b.date<=d).slice(-20),slope=win.length===20?win[19].close/win[0].close-1:null,phase=slope===null?"UNKNOWN":slope>.03?"TREND":slope<-.03?"WEAK":"RANGE";
  reg.push({tradeDate:d,phase,sentimentTag:["ICE","RECOVERY","WARMING","EUPHORIA","EXTREME"][["冰点","修复","升温","高潮","极强"].indexOf(sent.stage)],indexSlope20:slope,tagVersion:"v1"});
 }
 const summary={barCount:[...barsByCode.values()].reduce((n,b)=>n+b.length,0),dailyStock:ds.length,limitUp:lu.length,broken:zb.length,limitDown:dt.length,failedStocks:failed,priceMismatch,corporateInvalid,listingSkipped,dates:target.length};
 console.log("[backfill] summary",summary);
 if(dry){console.log("[backfill] dry-run performed zero writes");return;}
 if(failed>Math.max(10,Math.ceil(stocks.length*.02)))throw Error("More than 2% stock fetch failures; refusing writes");
 for(const days of chunks(target,10))await db.$transaction(async tx=>{
  const where={tradeDate:{in:days},rowOrigin:"BACKFILL"};
  await tx.dailyStock.deleteMany({where});await tx.limitUp.deleteMany({where});await tx.brokenLimit.deleteMany({where});await tx.limitDown.deleteMany({where});await tx.boardHistory.deleteMany({where});await tx.dailyConcept.deleteMany({where});await tx.sentimentDaily.deleteMany({where});await tx.dailyMarket.deleteMany({where});await tx.marketRegimeTag.deleteMany({where:{tradeDate:{in:days}}});
  const put=async(model:any,rows:any[])=>{const selected=rows.filter(x=>days.includes(x.tradeDate));for(const part of chunks(selected,400))if(part.length)await model.createMany({data:part,skipDuplicates:true});};
  await put(tx.dailyStock,ds);await put(tx.limitUp,lu);await put(tx.brokenLimit,zb);await put(tx.limitDown,dt);await put(tx.boardHistory,bh);await put(tx.dailyConcept,dc);await put(tx.sentimentDaily,sd);await put(tx.dailyMarket,dm);await put(tx.marketRegimeTag,reg);
  await tx.collectLog.create({data:{tradeDates:days[0]+"~"+days[days.length-1],source:"eastmoney-push2his+qq",stockCount:ds.length,limitUpCount:lu.filter(x=>x.tradeDate===days[days.length-1]).length,durationMs:0,status:"success",message:JSON.stringify({rowOrigin:"BACKFILL",summary})}});
 },{timeout:120000});
 console.log("[backfill] canonical rewrite complete");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>db.$disconnect());
