import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RolloutCounters,RolloutTail,allowedRollout} from '../runtime/thread-speed.mjs';
const event=(at,type,values={})=>({timestamp:new Date(at).toISOString(),type:'event_msg',payload:{type,...values}});
const start=(at,id='a')=>event(at,'task_started',{turn_id:id,started_at:at/1000});
const usage=(at,total,reason,last=total,lastReason=reason)=>event(at,'token_count',{info:{total_token_usage:{output_tokens:total,reasoning_output_tokens:reason},last_token_usage:{output_tokens:last,reasoning_output_tokens:lastReason},last_usage_includes_reasoning:true}});
const end=(at,duration,id='a',first=3000)=>event(at,'task_complete',{turn_id:id,completed_at:at/1000,duration_ms:duration,time_to_first_token_ms:first});
const output=at=>({timestamp:new Date(at).toISOString(),type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'private answer is never exported'}]}});
test('first reply uses a single usage record and includes reasoning and full wait',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept(usage(15740,294,188));assert.equal(c.latest,null);c.accept(end(15742,14742));
 assert.equal(c.latest.outputTokens,294);assert.equal(c.latest.reasoningOutputTokens,188);assert.equal(c.latest.responseOutputTokens,106);assert.equal(c.latest.tokensPerSecond,294/14.742);assert.equal(c.latest.timeToFirstTokenSeconds,3);
});
test('whole-turn output accumulates all calls and deduplicates quota-only checkpoints',()=>{
 const c=new RolloutCounters();c.accept(usage(1000,700,400));c.accept(start(2000));c.accept(usage(3000,800,460,100,60));c.accept(usage(4000,800,460,100,60));c.accept(usage(8000,950,550,150,90));c.accept(end(12000,10000));
 assert.equal(c.latest.outputTokens,250);assert.equal(c.latest.reasoningOutputTokens,150);assert.equal(c.latest.tokensPerSecond,25);
});
test('backend duration is authoritative instead of delayed log write time',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept(usage(30000,300,200));c.accept(end(31000,10000));assert.equal(c.latest.seconds,10);assert.equal(c.latest.tokensPerSecond,30);
});
test('human idle time is excluded while the previous completed sample stays timestamped',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept(usage(5000,100,40));c.accept(end(6000,5000));const previous=c.latest;
 c.accept(start(86401000,'b'));assert.equal(c.latest,previous);assert.equal(c.state,'running');c.accept(usage(86410000,400,190,300,150));c.accept(end(86411000,10000,'b'));assert.equal(c.latest.outputTokens,300);assert.equal(c.latest.tokensPerSecond,30);
});
test('tail bootstrap counts a witnessed new generation rather than historical totals',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept(output(9000));c.accept(usage(10000,10000,5000,200,100));c.accept(end(11000,10000));assert.equal(c.latest.outputTokens,200);assert.equal(c.latest.reasoningOutputTokens,100);assert.equal(c.latest.tokensPerSecond,20);assert.ok(!JSON.stringify(c.latest).includes('private answer'));
});
test('missing start, unknown first count, reset and cancellation do not invent a completed TPS',()=>{
 const a=new RolloutCounters();a.accept(usage(4000,5000,3000,100,50));a.accept(end(5000,4000));assert.equal(a.latest,null);
 const b=new RolloutCounters();b.accept(start(1000));b.accept(usage(2000,5000,3000,100,50));b.accept(end(5000,4000));assert.equal(b.latest,null);
 const c=new RolloutCounters();c.accept(usage(500,1000,500));c.accept(start(1000));c.accept(usage(2000,20,10));c.accept(end(5000,4000));assert.equal(c.latest,null);
 const d=new RolloutCounters();d.accept(start(1000));d.accept(usage(2000,100,50));d.accept(event(3000,'turn_aborted',{turn_id:'a'}));assert.equal(d.latest,null);assert.equal(d.state,'aborted');
});
test('model identity and old timestamp-only completions remain readable',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept({type:'turn_context',payload:{model:'gpt-6.1-sol',effort:'max'}});c.accept(usage(4000,100,30));c.accept(event(6000,'task_complete',{turn_id:'a'}));assert.equal(c.latest.modelName,'gpt-6.1-sol · max');assert.equal(c.latest.seconds,5);
});
test('another turn cannot complete the active request',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept(usage(2000,100,30));c.accept(end(4000,3000,'other'));assert.equal(c.latest,null);assert.equal(c.state,'running');c.accept(end(6000,5000));assert.equal(c.latest.tokensPerSecond,20);
});
test('a turn that used different models is not attributed entirely to its last model',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept({type:'turn_context',payload:{model:'gpt-6.1-sol',effort:'max'}});c.accept(usage(2000,100,30));
 c.accept({type:'turn_context',payload:{model:'gpt-6-astra',effort:'max'}});c.accept(usage(4000,200,60));c.accept(end(6000,5000));
 assert.equal(c.latest.modelName,'混合模型 / 思考档');assert.equal(c.latest.outputTokens,200);
});
test('incremental tail handles partial lines and file truncation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'niang-speed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'sample.jsonl');fs.writeFileSync(file,[start(1000),usage(4000,100,40)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const tail=new RolloutTail(file);assert.equal(tail.update().latest,null);const next=JSON.stringify(end(6000,5000));fs.appendFileSync(file,next.slice(0,30));assert.equal(tail.update().latest,null);fs.appendFileSync(file,next.slice(30)+'\n');assert.equal(tail.update().latest.tokensPerSecond,20);fs.writeFileSync(file,JSON.stringify(start(20000))+'\n');assert.equal(tail.update().latest,null);
});
test('paths outside session roots and symlink escapes remain rejected',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'niang-path-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'sessions'));const file=path.join(dir,'sessions','a.jsonl');fs.writeFileSync(file,'');const outside=path.join(dir,'private.jsonl');fs.writeFileSync(outside,'');assert.equal(allowedRollout(file,dir),fs.realpathSync(file));assert.equal(allowedRollout(outside,dir),null);fs.symlinkSync(outside,path.join(dir,'sessions','escape.jsonl'));assert.equal(allowedRollout(path.join(dir,'sessions','escape.jsonl'),dir),null);
});

test('explicitly failed task-complete records do not enter recent completed-turn history',()=>{
 const c=new RolloutCounters();c.accept(start(1000));c.accept(usage(3000,100,20));c.accept(event(6000,'task_complete',{turn_id:'a',status:'failed',duration_ms:5000}));
 assert.equal(c.latest,null);assert.equal(c.state,'aborted');assert.deepEqual(c.recent.snapshot(6000).recentSamples,[]);
});
