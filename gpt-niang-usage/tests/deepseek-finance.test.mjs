import test from 'node:test';import assert from 'node:assert/strict';
import {estimateMessageCost,isPeak} from '../runtime/deepseek-cost.mjs';
import {summarizeFinance} from '../runtime/deepseek-finance.mjs';
import {DshTurnParser} from '../runtime/local-sessions.mjs';
const at=s=>Date.parse(s+'+08:00');const usage={inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,reasoningTokens:900000};
test('official CNY token pricing includes reasoning once, separates cache and peak',()=>{
 assert.equal(estimateMessageCost(usage,'deepseek-flash',at('2026-11-11T10:00:00')),10.04);
 assert.equal(estimateMessageCost(usage,'deepseek-flash',at('2026-11-11T20:00:00')),5.02);
 assert.equal(estimateMessageCost(usage,'deepseek-v4-pro',at('2026-11-11T10:00:00')),36.3);
 assert.equal(estimateMessageCost(usage,'unknown-model',at('2026-11-11T10:00:00')),null);
 assert.equal(estimateMessageCost({outputTokens:10},'deepseek-flash',at('2026-11-11T10:00:00')),null);
});
test('peak rules include weekend, public holiday and future schedule unknown',()=>{
 assert.equal(isPeak(at('2026-11-14T10:00:00')),false);assert.equal(isPeak(at('2026-10-01T10:00:00')),false);assert.equal(isPeak(at('2027-01-04T10:00:00')),null);
});
test('daily balance observations persist spending across top-ups, ignore duplicate/out-of-order samples',()=>{
 const now=at('2026-11-11T20:00:00'),book={};
 const s=(amount,time,scope='a')=>({ok:true,accountKey:scope,observedAt:time,balances:[{currency:'CNY',recharge:amount,bonus:0}]});
 let r=summarizeFinance(s(10,now),[],book,now);assert.equal(r.todayObserved[0].amount,0);assert.equal(r.todayObserved[0].partialDay,true);
 r=summarizeFinance(s(8,now+60000),[],book,now+60000);assert.equal(r.todayObserved[0].amount,2);
 r=summarizeFinance(s(18,now+120000),[],book,now+120000);assert.equal(r.todayObserved[0].amount,2);assert.equal(r.todayObserved[0].needsReview,true);
 r=summarizeFinance(s(10,now),[],book,now+120000);assert.equal(r.todayObserved[0].amount,2);
 r=summarizeFinance(s(100,now+180000,'b'),[],book,now+180000);assert.equal(r.todayObserved[0].amount,0);
});
test('missing identity does not blend balances, and unknown usage is not zero',()=>{
 const now=at('2026-11-11T20:00:00');let r=summarizeFinance({ok:true,observedAt:now,balances:[{currency:'CNY',recharge:10,bonus:0}]},[{id:'a',_costRecords:[{turn:1,at:now,cost:null}]}],{},now);
 assert.equal(r.todayObserved.length,0);assert.equal(r.todayEstimatedCNY,null);assert.equal(r.unknownTurns,1);
});
test('DS turn cost deduplicates steps and includes aborted billable work without completing TPS',()=>{
 const p=new DshTurnParser(),now=at('2026-11-11T20:00:00');const event=(type,data,offset=0)=>p.accept({type,time:now+offset,data});
 event('turn/start',{turn:1});const d={turn:1,step:0,usage,message:{source:{model:'deepseek-flash',provider:'deepseek-account'}}};event('assistant/message',d);event('assistant/message',d);event('turn/end',{turn:1,reason:{kind:'aborted'}},1000);
 assert.equal(p.latest,null);assert.equal(p.costRecords.length,1);assert.equal(p.costRecords[0].cost,5.02);
 event('turn/start',{turn:2},2000);event('assistant/message',{...d,turn:2},3000);event('turn/end',{turn:2,reason:{kind:'completed'}},4000);assert.equal(p.latest.estimatedCost,5.02);
});
