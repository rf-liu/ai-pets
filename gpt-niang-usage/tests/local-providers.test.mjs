import test from 'node:test';
import assert from 'node:assert/strict';
import {ClaudeTurnParser,DshTurnParser} from '../runtime/local-sessions.mjs';
import {normalizeBridge} from '../runtime/bridge-usage.mjs';
const t=1700000000000;
const claude=(p,type,seconds,extra)=>p.accept({type,timestamp:new Date(t+seconds*1000).toISOString(),...extra});
const assistant=(id,output,stop='tool_use',thinking=0)=>({message:{id,model:'claude-test',stop_reason:stop,usage:{output_tokens:output,output_tokens_details:{thinking_tokens:thinking}}},perTurnEffort:'high'});
test('Claude whole user turn includes tools, thought and waits and deduplicates message usage',()=>{
 const p=new ClaudeTurnParser();claude(p,'user',0,{message:{content:'hello'}});
 claude(p,'assistant',4,assistant('a',100,'tool_use',20));claude(p,'assistant',5,assistant('a',100,'tool_use',20));
 claude(p,'user',20,{message:{content:[{type:'tool_result',tool_use_id:'x',content:'ok'}]}});
 claude(p,'assistant',30,assistant('b',200,'end_turn',40));
 assert.equal(p.latest.outputTokens,300);assert.equal(p.latest.reasoningOutputTokens,60);assert.equal(p.latest.tokensPerSecond,10);assert.equal(p.latest.intervalSeconds,30);assert.equal(p.active,null);
 claude(p,'assistant',31,assistant('b',200,'end_turn',40));assert.equal(p.latest.intervalSeconds,30);
});
test('Claude aborted, error and sidechain replies do not become completed measurements',()=>{
 const p=new ClaudeTurnParser();claude(p,'user',0,{message:{content:'x'}});claude(p,'assistant',1,{...assistant('a',100,'end_turn'),isApiErrorMessage:true});assert.equal(p.latest,null);
 claude(p,'assistant',2,{...assistant('a',100,'end_turn'),isSidechain:true});assert.equal(p.latest,null);
 claude(p,'assistant',3,assistant('a',100,'tool_use'));assert.equal(p.latest,null);
});
test('Claude new prompt starts a fresh request and rejects impossible thinking count',()=>{
 const p=new ClaudeTurnParser();claude(p,'user',0,{message:{content:'abandon'}});claude(p,'assistant',1,assistant('a',999));
 claude(p,'user',10,{message:{content:'new'}});claude(p,'assistant',12,assistant('b',20,'end_turn',5));assert.equal(p.latest.tokensPerSecond,10);
 claude(p,'user',20,{message:{content:'bad'}});claude(p,'assistant',22,assistant('c',10,'end_turn',11));assert.equal(p.latest.outputTokens,20);
});
function dsh(p,type,s,data){p.accept({type,time:t+s*1000,data});}
test('DS includes all steps, counts duplicates once and includes tool waiting',()=>{
 const p=new DshTurnParser();dsh(p,'turn/start',0,{turn:1});const data={turn:1,step:0,usage:{outputTokens:90},message:{source:{model:'deepseek-flash'}}};
 dsh(p,'assistant/message',5,data);dsh(p,'assistant/message',6,data);dsh(p,'assistant/message',20,{...data,step:1,usage:{outputTokens:210}});dsh(p,'turn/end',30,{turn:1,reason:{kind:'completed'}});
 assert.equal(p.latest.outputTokens,300);assert.equal(p.latest.tokensPerSecond,10);assert.equal(p.latest.modelName,'deepseek-flash');assert.equal(p.active,null);
});
test('DS canceled/error/blocked and unknown usage do not masquerade as complete',()=>{
 for(const reason of ['aborted','error','blocked']){const p=new DshTurnParser();dsh(p,'turn/start',0,{turn:1});dsh(p,'assistant/message',1,{turn:1,step:0,usage:{outputTokens:20}});dsh(p,'turn/end',2,{turn:1,reason:{kind:reason}});assert.equal(p.latest,null);}
 const p=new DshTurnParser();dsh(p,'turn/start',0,{turn:1});dsh(p,'assistant/message',1,{turn:1,step:0});dsh(p,'turn/end',2,{turn:1,reason:{kind:'completed'}});assert.equal(p.latest,null);
});
test('Claude official rate limits keep zero boundary and never invent weekly usage',()=>{
 const r=normalizeBridge('claude',{capturedAt:t,rateLimits:[{kind:'five_hour',percentUsed:100,resetsAt:t/1000+100}]},t);
 assert.equal(r.ok,true);assert.deepEqual(r.windows.map(x=>x.remaining),[0]);assert.equal(r.windows.length,1);assert.equal(r.observedAt,t);
 for(const percentUsed of [null,NaN,undefined,-1,101,'50'])assert.equal(normalizeBridge('claude',{rateLimits:[{kind:'five_hour',percentUsed}]}).ok,false);
 assert.equal(normalizeBridge('claude',{}).ok,false);
});
test('DS official wallet values remain currency balances and never percentage windows',()=>{
 const r=normalizeBridge('deepseek',{status:'ready',normalWallets:[{currency:'CNY',balance:'3.25'}],bonusWallets:[{currency:'CNY',balance:'1.50'}]});
 assert.equal(r.ok,true);assert.deepEqual(r.windows,[]);assert.deepEqual(r.balances,[{currency:'CNY',recharge:3.25,bonus:1.5}]);
 const zero=normalizeBridge('deepseek',{status:'ready',normalWallets:[{currency:'USD',balance:'0'}]});assert.equal(zero.ok,true);assert.equal(zero.balances[0].recharge,0);
 for(const balance of ['',null,'NaN','Infinity'])assert.equal(normalizeBridge('deepseek',{status:'ready',normalWallets:[{currency:'CNY',balance}]}).ok,false);
 assert.equal(normalizeBridge('deepseek',{signedIn:false}).ok,false);
});
