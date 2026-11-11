import fs from 'node:fs';
import path from 'node:path';
import {observeBalance,beijingDay} from './deepseek-accounting.mjs';
import {atomicJson} from './usage.mjs';
import {isPeak} from './deepseek-cost.mjs';
export function summarizeFinance(snapshot,rows,ledgers={},now=Date.now()){
 const today=beijingDay(now),observed=[];
 for(const wallet of snapshot.balances??[]){
  if(!snapshot.ok||!snapshot.accountKey)continue;
  const ledger=ledgers[wallet.currency]??={};
  const summary=observeBalance(ledger,{at:snapshot.observedAt,balance:wallet.recharge+wallet.bonus,currency:wallet.currency,scope:snapshot.accountKey});
  if(summary?.day===today)observed.push({currency:wallet.currency,amount:summary.amount,from:summary.firstObservedAt,to:summary.lastObservedAt,partialDay:summary.partialDay,needsReview:summary.needsReview});
 }
 const records=rows.flatMap(row=>(row._costRecords??[]).map(x=>({...x,id:row.id+':'+x.turn})));
 const unique=[...new Map(records.map(x=>[x.id,x])).values()].filter(x=>beijingDay(x.at)===today);
 const known=unique.filter(x=>typeof x.cost==='number'&&Number.isFinite(x.cost)&&x.cost>=0);
 const latest=rows.filter(r=>r.sampleAt&&r.estimatedCost!==null&&Number.isFinite(r.estimatedCost)).sort((a,b)=>b.sampleAt-a.sampleAt)[0];
 return {todayObserved:observed,todayEstimatedCNY:known.length?Math.round(known.reduce((s,x)=>s+x.cost,0)*1e8)/1e8:null,unknownTurns:unique.length-known.length,latestTurn:latest?{amount:latest.estimatedCost,currency:'CNY',at:latest.sampleAt,title:latest.title}:null,peak:isPeak(now)};
}
export function appendFinance(snapshot,rows,file,now=Date.now()){
 let ledgers={};try{ledgers=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
 const deepseek=summarizeFinance(snapshot,rows,ledgers,now);
 if(snapshot.ok&&snapshot.accountKey){fs.mkdirSync(path.dirname(file),{recursive:true});atomicJson(file,ledgers);}
 return {...snapshot,deepseek};
}
