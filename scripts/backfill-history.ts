import { db } from "@/lib/db";
import { fetchJson, pmap } from "@/lib/market/http";
import { fetchDailyKline, fetchIndexKline } from "@/lib/market/tx";
import { detectBarStatus, marketOf, limitUpPriceOf, limitDownPriceOf, limitPctOf } from "@/lib/market/rules";
import { computeBoardChain } from "@/lib/calc/board";
import { calcSentiment, sealRateOf, brokenRateOf } from "@/lib/calc/sentiment";
import { buildConceptStats, buildThemeStats } from "@/lib/calc/concept";
import { matchThemes } from "@/lib/calc/themeRules";

const opt=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.replace(/^--/,"").split("=");return [p[0],p.slice(1).join("=")||"true"];}));
const dry=["true","1","yes"].includes(String(opt["dry-run"]??"false").toLowerCase()), start=String(opt.start||"2025-08-01"), end=String(opt.end||new Date().toISOString().slice(0,10));
const ymd=(s:string)=>s.replace(/-/g,""), dateOnly=(s:string)=>s.slice(0,10), round=(n:number)=>Math.round(n*100)/100;
const chunks=<T,>(a:T[],n:number)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,i*n+n));
const volumeRatio=(bars:any[],i:number)=>{const p=bars.slice(Math.max(0,i-20),i);if(p.length<5)return null;const avg=p.reduce((s,b)=>s+b.volume,0)/p.length;return avg>0?round(bars[i].volume/avg):null;};
async function emBars(stock:any){
 const secid=(marketOf(stock.stockCode)==="SH"?"1.":"0.")+stock.stockCode;
 const q=new URLSearchParams({secid,ut:"7eea3edcaed734bea9cbfc24409ed989",fields1:"f1,f2,f3,f4,f5,f6",fields2:"f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",klt:"101",fqt:"0",beg:ymd(start),end:ymd(end),lmt:"321"});
 const j=await fetchJson<any>("https://push2his.eastmoney.com/api/qt/stock/kline/get?"+q,{referer:"https://quote.eastmoney.com/",timeoutMs:18000,retries:2,gapMs:120});
 return (j.data?.klines||[]).map((line:string)=>{const x=line.split(","),changeAmount=x[9]?.trim()===""?NaN:Number(x[9]);return {date:dateOnly(x[0]),open:+x[1],close:+x[2],high:+x[3],low:+x[4],volume:+x[5],amount:+x[6],changeAmount,turnoverRate:+x[10]};}).filter((b:any)=>b.close>0&&b.high>=b.low).sort((a:any,b:any)=>a.date.localeCompare(b.date));
}
function pctOf(b:any,p:any){return round((b.close/p.close-1)*100);}
async function main(){
 const [stocks,index]=await Promise.all([db.stockBasic.findMany({select:{stockCode:true,stockName:true,industry:true,listingDate:true,status:true},orderBy:{stockCode:"asc"}}),fetchIndexKline("sh000001",321)]);
 const indexSeries=await Promise.all(["sz399001","sz399006","sh000688","sh000016","bj899050","sz399106"].map(code=>fetchIndexKline(code,321)));
 const indexMaps=new Map(indexSeries.map(x=>[x.code,new Map(x.bars.map(b=>[b.date,b] as const))] as const));
 const indexBar=(code:string,date:string)=>indexMaps.get(code)?.get(date);
 const indexPrev=(code:string,date:string)=>{const a=indexSeries.find(x=>x.code===code)?.bars||[],i=a.findIndex(b=>b.date===date);return i>0?a[i-1]:undefined;};
 if(!stocks.length)throw Error("StockBasic empty; refusing full-market history run");
 const dates=index.bars.map(b=>b.date).filter(d=>d>=start&&d<=end);
 if(dates.length<30)throw Error("Index trading calendar unavailable/too short");
 // 目标最多取请求区间内最近220个交易日；正式写入前会清理整个请求区间的旧 BACKFILL 世代，避免滑窗遗留混代。
 const targetStart=Math.max(0,dates.length-220),target=dates.slice(targetStart),seed=dates.slice(Math.max(0,targetStart-20),targetStart),ruleDates=seed.concat(target);
 const ruleDateSet=new Set(ruleDates),ruleDateIndex=new Map(ruleDates.map((d,i)=>[d,i] as const));
 const rosters=new Map<string,{zt:Set<string>;zb:Set<string>;dt:Set<string>}>();
 for(const d of ruleDates)rosters.set(d,{zt:new Set<string>(),zb:new Set<string>(),dt:new Set<string>()});
 console.log("[backfill] codes="+stocks.length+" target="+target[0]+".."+target[target.length-1]+" seed="+seed.length+" dry="+dry);
 const results=await pmap(stocks,4,async stock=>{try{return {stock,em:await emBars(stock),qq:await fetchDailyKline(stock.stockCode,321),error:null};}catch(e){return {stock,em:[],qq:[],error:String(e)};}});
 const barsByCode=new Map<string,any[]>(),barIndexByCode=new Map<string,Map<string,number>>(),names=new Map(stocks.map(s=>[s.stockCode,s.stockName] as const));
 let failed=0,noHistory=0,priceMismatch=0,corporateInvalid=0,listingSkipped=0;
 const failedDetails:{stockCode:string;stockName:string;reason:string}[]=[],noHistoryDetails:{stockCode:string;stockName:string;status:string;listingDate:string|null;classification:"not-yet-listed"|"inactive-status"|"unclassified"}[]=[];
 const inactiveStatuses=new Set(["delisted","suspended","inactive","退市","停牌"]);let noHistoryUnclassified=0;
 for(const x of results){
  if(x.error){failed++;failedDetails.push({stockCode:x.stock.stockCode,stockName:x.stock.stockName,reason:x.error});continue;}
  if(!x.em.length&&!x.qq.length){
   noHistory++;const status=String(x.stock.status??"").trim().toLowerCase(),listingDate=x.stock.listingDate?String(x.stock.listingDate).slice(0,10):null;
   const classification: "not-yet-listed"|"inactive-status"|"unclassified" = listingDate&&listingDate>end?"not-yet-listed":inactiveStatuses.has(status)?"inactive-status":"unclassified";
   if(classification==="unclassified")noHistoryUnclassified++;
   noHistoryDetails.push({stockCode:x.stock.stockCode,stockName:x.stock.stockName,status:status||"(empty)",listingDate,classification});continue;
  }
  if(!x.em.length||!x.qq.length){failed++;failedDetails.push({stockCode:x.stock.stockCode,stockName:x.stock.stockName,reason:!x.em.length?"Eastmoney returned no bars while Tencent returned bars":"Tencent returned no bars while Eastmoney returned bars"});continue;}
  const qq=new Map(x.qq.map((b:any)=>[b.date,b] as const)),bars=x.em;
  const validDates=new Set<string>();
  for(const b of bars){
   const q:any=qq.get(b.date);
   if(!q){if(ruleDateSet.has(b.date))priceMismatch++;continue;}
   const diff=Math.max(Math.abs(b.open-q.open),Math.abs(b.high-q.high),Math.abs(b.low-q.low),Math.abs(b.close-q.close))/Math.max(b.close,.01);
   if(diff>.005){if(ruleDateSet.has(b.date))priceMismatch++;continue;}
   validDates.add(b.date);
  }
  barsByCode.set(x.stock.stockCode,bars);
  barIndexByCode.set(x.stock.stockCode,new Map(bars.map((b:any,i:number)=>[b.date,i] as const)));
  const listingDate=x.stock.listingDate?ymd(String(x.stock.listingDate).slice(0,10)):"";
  let listingSkipStart=-1;
  if(listingDate&&listingDate>=ymd(ruleDates[0])&&listingDate<=ymd(ruleDates[ruleDates.length-1])){
   listingSkipStart=ruleDates.findIndex(d=>ymd(d)>=listingDate);
  }
  for(let i=1;i<bars.length;i++){
   const b=bars[i],prev=bars[i-1],dateIndex=ruleDateIndex.get(b.date);
   if(dateIndex===undefined)continue;
   // 保留完整 Eastmoney 序列以保证 prev.close 是上一实际交易日；当前日与前一日均须通过腾讯 OHLC 校验。
   if(!validDates.has(b.date)||!validDates.has(prev.date))continue;
   if(listingSkipStart>=0&&dateIndex>=listingSkipStart&&dateIndex<listingSkipStart+5){listingSkipped++;continue;}
   // f60 涨跌额反推的前收与上一实际交易日 close 不一致时，标 INVALID 并跳过该日判定。
   const impliedPrevClose=b.close-b.changeAmount;
   if(!Number.isFinite(b.changeAmount)||Math.abs(impliedPrevClose-prev.close)/Math.max(prev.close,.01)>.005){corporateInvalid++;continue;}
   const status=detectBarStatus(x.stock.stockCode,x.stock.stockName,prev.close,b);
   if(status)rosters.get(b.date)![status==="limitUp"?"zt":status==="broken"?"zb":"dt"].add(x.stock.stockCode);
  }
 }
 const ztMap=new Map(ruleDates.map(d=>[d,rosters.get(d)!.zt] as const)),chain=computeBoardChain(ruleDates,ztMap,names),byCode=new Map(stocks.map(s=>[s.stockCode,s] as const));
 const pairAt=(code:string,date:string)=>{const bars=barsByCode.get(code)||[],i=barIndexByCode.get(code)?.get(date)??-1;return i>0?{bars,index:i,bar:bars[i],prev:bars[i-1]}:null;};
 const ds:any[]=[],lu:any[]=[],zb:any[]=[],dt:any[]=[],bh:any[]=[],sd:any[]=[],dm:any[]=[],dc:any[]=[],reg:any[]=[];
 const sentimentStages=["冰点","修复","升温","高潮","极强"] as const,regimeStages=["ICE","RECOVERY","WARMING","EUPHORIA","EXTREME"] as const;
 for(const d of target){
  const r=rosters.get(d)!,states=chain.byDate.get(d) ?? new Map<string, import("@/lib/calc/board").BoardState>();
  const poolRows=[...[...r.zt].map(code=>({code,status:"limitUp" as const})),...[...r.zb].map(code=>({code,status:"broken" as const})),...[...r.dt].map(code=>({code,status:"limitDown" as const}))];
  for(const {code,status} of poolRows){
   const pair=pairAt(code,d);if(!pair)continue;const {bars,index:i,bar:b,prev:p}=pair;
   ds.push({tradeDate:d,stockCode:code,open:b.open,high:b.high,low:b.low,close:b.close,prevClose:p.close,changePct:pctOf(b,p),volume:b.volume,amount:b.amount>0?b.amount:null,turnoverRate:b.turnoverRate>0?b.turnoverRate:null,floatMarketCap:null,volumeRatio:volumeRatio(bars,i),isLimitUp:status==="limitUp",isLimitDown:status==="limitDown",isBroken:status==="broken",rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const code of r.zt){const pair=pairAt(code,d);if(!pair)continue;const {bars,index:i,bar:b,prev:p}=pair,s=byCode.get(code),st=states.get(code);
   lu.push({tradeDate:d,stockCode:code,stockName:names.get(code)||code,limitPrice:limitUpPriceOf(p.close,limitPctOf(code,names.get(code)||code)),closePrice:b.close,changePct:pctOf(b,p),firstLimitTime:null,lastLimitTime:null,openCount:-1,sealAmount:null,amount:b.amount>0?b.amount:null,turnoverRate:b.turnoverRate>0?b.turnoverRate:null,floatMarketCap:null,industry:s?.industry??null,boardCount:st?.boardCount??1,volumeRatio:volumeRatio(bars,i),sourceBoard:null,daysAndBoards:null,isPromotion:st?.isPromotion??false,isRebound:st?.isRebound??false,themes:JSON.stringify(matchThemes(names.get(code)||code,s?.industry)),themeEvidence:null,themesNewsEnriched:null,rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const code of r.zb){const pair=pairAt(code,d);if(!pair)continue;const {bars,index:i,bar:b,prev:p}=pair,s=byCode.get(code);
   zb.push({tradeDate:d,stockCode:code,stockName:names.get(code)||code,limitPrice:limitUpPriceOf(p.close,limitPctOf(code,names.get(code)||code)),closePrice:b.close,changePct:pctOf(b,p),firstLimitTime:null,openCount:-1,amount:b.amount>0?b.amount:null,turnoverRate:b.turnoverRate>0?b.turnoverRate:null,floatMarketCap:null,industry:s?.industry??null,volumeRatio:volumeRatio(bars,i),rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const code of r.dt){const pair=pairAt(code,d);if(!pair)continue;const {bar:b,prev:p}=pair,s=byCode.get(code);
   dt.push({tradeDate:d,stockCode:code,stockName:names.get(code)||code,limitPrice:limitDownPriceOf(p.close,limitPctOf(code,names.get(code)||code)),closePrice:b.close,changePct:pctOf(b,p),brokeCount:null,continuousDays:null,amount:b.amount>0?b.amount:null,industry:s?.industry??null,rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  }
  for(const [code,st] of states)bh.push({tradeDate:d,stockCode:code,stockName:st.stockName,boardCount:st.boardCount,previousBoardCount:st.previousBoardCount,isPromotion:st.isPromotion,isBreak:st.isBreak,isRebound:st.isRebound,rowOrigin:"BACKFILL",dataQuality:"GOOD",fieldVersion:"history-v2"});
  const datePos=ruleDateIndex.get(d)??-1,prevDate=datePos>0?ruleDates[datePos-1]:undefined,prevCodes=prevDate?[...rosters.get(prevDate)!.zt]:[],prevReturns:number[]=[];
  for(const code of prevCodes){const pair=pairAt(code,d);if(pair)prevReturns.push((pair.bar.close/pair.prev.close-1)*100);}
  const yavg=prevReturns.length?round(prevReturns.reduce((a,b)=>a+b,0)/prevReturns.length):null,highest=Math.max(0,...[...states.values()].map(x=>x.boardCount));
  const sent=calcSentiment({limitUpCount:r.zt.size,limitDownCount:r.dt.size,brokenCount:r.zb.size,highestBoard:highest,yesterdayLimitAvg:yavg,upCount:null,downCount:null});
  const stageIndex=sentimentStages.indexOf(sent.stage as typeof sentimentStages[number]);
  if(stageIndex<0)throw Error("Unknown calcSentiment stage: "+sent.stage);
  const regimeTag=regimeStages[stageIndex];if(!regimeTag)throw Error("No regime mapping for calcSentiment stage: "+sent.stage);
  sd.push({tradeDate:d,limitUpCount:r.zt.size,limitDownCount:r.dt.size,brokenLimitCount:r.zb.size,sealRate:sealRateOf(r.zt.size,r.zb.size),brokenRate:brokenRateOf(r.zt.size,r.zb.size),highestBoard:highest,yesterdayLimitAvg:yavg,yesterdayCount:prevReturns.length,yesterdayRedCount:prevReturns.filter(x=>x>0).length,promotionDetails:JSON.stringify(chain.promotionsByDate.get(d)||[]),sentimentTemperature:sent.temperature,sentimentStage:sent.stage,upCount:null,downCount:null,rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  const idx=index.bars.findIndex(b=>b.date===d),ib=index.bars[idx],ip=index.bars[idx-1];
  const sz=indexBar("399001",d),cy=indexBar("399006",d),kc=indexBar("000688",d),sz50=indexBar("000016",d),bz50=indexBar("899050",d),szcomp=indexBar("399106",d);
  const amount=(ib?.amount||0)+(szcomp?.amount||0);
  const pct=(code:string,b:any)=>{const p=indexPrev(code,d);return b&&p?round((b.close/p.close-1)*100):null;};
  dm.push({tradeDate:d,shIndex:ib?.close??null,shChangePct:ip?round((ib.close/ip.close-1)*100):null,szIndex:sz?.close??null,szChangePct:pct("399001",sz),cyIndex:cy?.close??null,cyChangePct:pct("399006",cy),kcIndex:kc?.close??null,kcChangePct:pct("000688",kc),sz50Index:sz50?.close??null,sz50ChangePct:pct("000016",sz50),bz50Index:bz50?.close??null,bz50ChangePct:pct("899050",bz50),totalAmount:amount>0?round(amount/1e8):null,upCount:null,downCount:null,flatCount:null,limitUpCount:r.zt.size,limitDownCount:r.dt.size,brokenCount:r.zb.size,sealRate:sealRateOf(r.zt.size,r.zb.size),dataSource:"eastmoney-push2his+qq",rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  const inputs=[...r.zt].map(code=>{const s=byCode.get(code),pair=pairAt(code,d);return {stockCode:code,stockName:names.get(code)||code,industry:s?.industry||"",boardCount:states.get(code)?.boardCount||1,firstLimitTime:null,amount:pair?.bar.amount??null};});
  for(const c of buildConceptStats(inputs,[...r.zb].map(code=>({industry:byCode.get(code)?.industry||""}))))dc.push({tradeDate:d,...c,kind:"industry",rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});
  for(const t of buildThemeStats(inputs)){const o:any={...t};delete o.members;dc.push({tradeDate:d,...o,kind:"theme",members:JSON.stringify(t.members),rowOrigin:"BACKFILL",dataQuality:"MISSING",fieldVersion:"history-v2"});}
  const win=index.bars.filter(b=>b.date<=d).slice(-20),slope=win.length===20?win[19].close/win[0].close-1:null,phase=slope===null?"UNKNOWN":slope>.03?"TREND":slope<-.03?"WEAK":"RANGE";
  reg.push({tradeDate:d,phase,sentimentTag:regimeTag,indexSlope20:slope,tagVersion:"v1"});
 }
 const summary={barCount:[...barsByCode.values()].reduce((n,b)=>n+b.length,0),dailyStock:ds.length,limitUp:lu.length,broken:zb.length,limitDown:dt.length,failedStocks:failed,noHistoryStocks:noHistory,noHistoryUnclassified,priceMismatch,corporateInvalid,listingSkipped,dates:target.length};
 console.log("[backfill] summary",summary);
 if(failedDetails.length)console.error("[backfill] failed stock details",failedDetails);
 if(noHistoryDetails.length)console.warn("[backfill] no-history stocks",noHistoryDetails);
 if(noHistoryUnclassified>0)console.error("[backfill] no-history assertion failed: stocks have no bars but are not explicitly inactive or listed after the requested end date");
 if(dry){console.log("[backfill] dry-run performed zero writes");if(failed>0)console.warn("[backfill] formal run would be refused because at least one stock fetch failed");return;}
 if(failed>0)throw Error("Real stock fetch/source failures detected; refusing writes to protect existing LIVE canonical rows. See failed stock details above.");
 if(noHistoryUnclassified>0)throw Error("No-history assertion failed: "+noHistoryUnclassified+" stocks have no bars but are not explicitly delisted/suspended/inactive and were already listed by the requested end date. See details above.");
 const preserveLiveFrom=target[Math.max(0,target.length-63)];
 const canonicalDates=target.filter(d=>d<preserveLiveFrom);
 // 先做只读 LIVE 覆盖预检；任何一张表缺替代项，都在清理旧 BACKFILL 前终止。
 if(canonicalDates.length)await db.$transaction(async tx=>{
  const check=async(model:any,rows:any[],fields:string[])=>{
   const existing=await model.findMany({where:{tradeDate:{in:canonicalDates},rowOrigin:"LIVE"},select:Object.fromEntries(fields.map(field=>[field,true]))});
   const keys=new Set(rows.map(row=>JSON.stringify(fields.map(field=>row[field]??null))));
   const missing=existing.filter((row:any)=>!keys.has(JSON.stringify(fields.map(field=>row[field]??null))));
   if(missing.length)throw Error("LIVE coverage preflight failed for "+fields.join(",")+"; sample="+JSON.stringify(missing.slice(0,5)));
  };
  await check(tx.dailyStock,ds,["tradeDate","stockCode"]);await check(tx.limitUp,lu,["tradeDate","stockCode"]);
  await check(tx.brokenLimit,zb,["tradeDate","stockCode"]);await check(tx.limitDown,dt,["tradeDate","stockCode"]);
  await check(tx.boardHistory,bh,["tradeDate","stockCode"]);await check(tx.sentimentDaily,sd,["tradeDate"]);
  await check(tx.dailyMarket,dm,["tradeDate"]);
 },{timeout:120000});
 // 先检查旧 BACKFILL 是否都有本次替代项，避免部分源数据导致覆盖成功历史。
 await db.$transaction(async tx=>{
  const verify=async(model:any,rows:any[],fields:string[])=>{
   const oldRows=await model.findMany({where:{tradeDate:{in:target},rowOrigin:"BACKFILL"},select:Object.fromEntries(fields.map(field=>[field,true]))});
   const keys=new Set(rows.map(row=>JSON.stringify(fields.map(field=>row[field]??null))));
   const missing=oldRows.filter((row:any)=>!keys.has(JSON.stringify(fields.map(field=>row[field]??null))));
   if(missing.length)throw Error("BACKFILL replacement check failed: "+fields.join(",")+" "+JSON.stringify(missing.slice(0,5)));
  };
  await verify(tx.dailyStock,ds,["tradeDate","stockCode"]);await verify(tx.limitUp,lu,["tradeDate","stockCode"]);
  await verify(tx.brokenLimit,zb,["tradeDate","stockCode"]);await verify(tx.limitDown,dt,["tradeDate","stockCode"]);
  await verify(tx.boardHistory,bh,["tradeDate","stockCode"]);await verify(tx.dailyConcept,dc,["tradeDate","conceptName","kind"]);
  await verify(tx.sentimentDaily,sd,["tradeDate"]);await verify(tx.dailyMarket,dm,["tradeDate"]);
 },{timeout:120000});
 // 全量清理本次请求区间内的旧 BACKFILL 世代，再按本次统一计算结果重建。
 // target 即使在 63/120/180/220 天之间扩展或滑动，也不会遗留窗口外的旧 BACKFILL 行。
 const backfillRange={tradeDate:{gte:start,lte:end},rowOrigin:"BACKFILL"};
 await db.$transaction(async tx=>{
  await tx.dailyStock.deleteMany({where:backfillRange});await tx.limitUp.deleteMany({where:backfillRange});
  await tx.brokenLimit.deleteMany({where:backfillRange});await tx.limitDown.deleteMany({where:backfillRange});
  await tx.boardHistory.deleteMany({where:backfillRange});await tx.dailyConcept.deleteMany({where:backfillRange});
  await tx.sentimentDaily.deleteMany({where:backfillRange});await tx.dailyMarket.deleteMany({where:backfillRange});
  await tx.marketRegimeTag.deleteMany({where:{tradeDate:{in:target}}});
 },{timeout:120000});
 for(const days of chunks(target,10))await db.$transaction(async tx=>{
  const canonicalDays=days.filter(d=>d<preserveLiveFrom);
  const assertCoverage=async(model:any,rows:any[],fields:string[],origin:"LIVE"|"BACKFILL",scopeDays:string[])=>{
   const existing=await model.findMany({where:{tradeDate:{in:scopeDays},rowOrigin:origin},select:Object.fromEntries(fields.map(field=>[field,true]))});
   const replacementKeys=new Set(rows.map(row=>JSON.stringify(fields.map(field=>row[field]??null))));
   const missing=existing.filter((row:any)=>!replacementKeys.has(JSON.stringify(fields.map(field=>row[field]??null))));
   if(missing.length)throw Error("Refusing "+origin+" deletion: replacement missing for "+fields.join(",")+"; sample="+JSON.stringify(missing.slice(0,5)));
  };
  const assertAllCoverage=async(origin:"LIVE"|"BACKFILL",scopeDays:string[],options:{skipDailyConcept?:boolean}={})=>{
   if(!scopeDays.length)return;
   await assertCoverage(tx.dailyStock,ds,["tradeDate","stockCode"],origin,scopeDays);
   await assertCoverage(tx.limitUp,lu,["tradeDate","stockCode"],origin,scopeDays);
   await assertCoverage(tx.brokenLimit,zb,["tradeDate","stockCode"],origin,scopeDays);
   await assertCoverage(tx.limitDown,dt,["tradeDate","stockCode"],origin,scopeDays);
   await assertCoverage(tx.boardHistory,bh,["tradeDate","stockCode"],origin,scopeDays);
   if(!options.skipDailyConcept)await assertCoverage(tx.dailyConcept,dc,["tradeDate","conceptName","kind"],origin,scopeDays);
   await assertCoverage(tx.sentimentDaily,sd,["tradeDate"],origin,scopeDays);
   await assertCoverage(tx.dailyMarket,dm,["tradeDate"],origin,scopeDays);
  };
  if(canonicalDays.length){
   await assertAllCoverage("LIVE",canonicalDays,{skipDailyConcept:true});
   const old={tradeDate:{in:canonicalDays},rowOrigin:"LIVE"};
   await tx.dailyStock.deleteMany({where:old});await tx.limitUp.deleteMany({where:old});await tx.brokenLimit.deleteMany({where:old});await tx.limitDown.deleteMany({where:old});
   await tx.boardHistory.deleteMany({where:old});await tx.sentimentDaily.deleteMany({where:old});await tx.dailyMarket.deleteMany({where:old});
  }
  const where={tradeDate:{in:days},rowOrigin:"BACKFILL"};
  await tx.dailyStock.deleteMany({where});await tx.limitUp.deleteMany({where});await tx.brokenLimit.deleteMany({where});await tx.limitDown.deleteMany({where});await tx.boardHistory.deleteMany({where});await tx.dailyConcept.deleteMany({where});await tx.sentimentDaily.deleteMany({where});await tx.dailyMarket.deleteMany({where});await tx.marketRegimeTag.deleteMany({where:{tradeDate:{in:days}}});
  const put=async(model:any,rows:any[])=>{const selected=rows.filter(x=>days.includes(x.tradeDate));for(const part of chunks(selected,400))if(part.length)await model.createMany({data:part,skipDuplicates:true});};
  await put(tx.dailyStock,ds);await put(tx.limitUp,lu);await put(tx.brokenLimit,zb);await put(tx.limitDown,dt);await put(tx.boardHistory,bh);await put(tx.dailyConcept,dc);await put(tx.sentimentDaily,sd);await put(tx.dailyMarket,dm);await put(tx.marketRegimeTag,reg);
  await tx.collectLog.create({data:{tradeDates:days[0]+"~"+days[days.length-1],source:"eastmoney-push2his+qq",stockCount:ds.filter(x=>days.includes(x.tradeDate)).length,limitUpCount:lu.filter(x=>x.tradeDate===days[days.length-1]).length,durationMs:0,status:"success",message:JSON.stringify({rowOrigin:"BACKFILL",summary})}});
 },{timeout:120000});
 console.log("[backfill] canonical rewrite complete");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>db.$disconnect());
