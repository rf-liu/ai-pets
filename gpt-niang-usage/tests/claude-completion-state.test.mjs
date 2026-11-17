import test from 'node:test';
import assert from 'node:assert/strict';
import {ClaudeCompletionState} from '../runtime/claude-completion-state.mjs';
import {localCompletionScan} from '../runtime/local-session-runner.mjs';
import {parseActivityRecord} from '../runtime/completion-monitor.mjs';
import {CompletionRolloutTail} from '../runtime/completion-monitor.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const user=()=>({type:'user',timestamp:1000,uuid:'user',message:{content:'fixture'}});
const reply=(type='text')=>({type:'assistant',timestamp:2000,uuid:'final',parentUuid:'user',message:{stop_reason:'end_turn',content:[type==='text'?{type,text:'done'}:{type,thinking:'fixture'}]}});
const stop=(extra={})=>({type:'system',subtype:'stop_hook_summary',timestamp:3000,uuid:'stop',parentUuid:'final',preventedContinuation:false,hookErrors:[],...extra});
test('thinking end_turn and visible reply alone cannot complete while stop hooks are still running',()=>{
 const s=new ClaudeCompletionState();s.accept(user());s.accept(reply('thinking'));assert.equal(s.endedAt,null);assert.equal(s.running,true);
 s.accept(reply());assert.equal(s.endedAt,null);s.accept(stop());assert.equal(s.endedAt,3000);assert.equal(s.running,false);
});
test('foreign ancestry, blocked/error stop hooks and sidechains cannot finish a root reply',()=>{
 for(const extra of [{parentUuid:'foreign'},{preventedContinuation:true},{hookErrors:['fixture']},{isSidechain:true}]){
  const s=new ClaudeCompletionState();s.accept(user());s.accept(reply());s.accept(stop(extra));assert.equal(s.endedAt,null);
 }
});
test('successful stop hook attachments preserve the ancestry proof and a new user input invalidates it',()=>{
 const s=new ClaudeCompletionState();s.accept(user());s.accept(reply());s.accept({type:'attachment',timestamp:2500,uuid:'hook',parentUuid:'final'});
 s.accept(stop({parentUuid:'hook'}));assert.equal(s.endedAt,3000);
 s.accept({...user(),uuid:'next',timestamp:4000});assert.equal(s.endedAt,null);assert.equal(s.running,true);
 s.accept(stop({timestamp:5000}));assert.equal(s.endedAt,null);
});
test('known detached jobs block completion until a structured matching terminal result arrives',()=>{
 const s=new ClaudeCompletionState();s.accept(user());
 s.accept({type:'assistant',timestamp:1200,uuid:'call',message:{content:[{type:'tool_use',id:'b',name:'Bash',input:{run_in_background:true}}]}});
 s.accept({type:'user',timestamp:1300,message:{content:[{type:'tool_result',tool_use_id:'b'}]},toolUseResult:{backgroundTaskId:'job'}});
 s.accept(reply());s.accept(stop());assert.equal(s.endedAt,null);
 s.accept({type:'assistant',timestamp:4000,message:{content:[{type:'tool_use',id:'wait',name:'TaskOutput',input:{task_id:'job'}}]}});
 s.accept({type:'user',timestamp:4500,message:{content:[{type:'tool_result',tool_use_id:'wait'}]},toolUseResult:{task:{task_id:'job',status:'completed'}}});
 s.accept({...reply(),timestamp:5000});s.accept(stop({timestamp:6000}));assert.equal(s.endedAt,6000);
});
test('Claude scanner ignores previous statistics during a new task and only sends a fresh confirmed stop once',()=>{
 let now=10000,rows=[{id:'a',state:'running',sampleAt:9500,_completionAt:9500,_completionPending:true}];const events=[];
 const scan=localCompletionScan('claude',{since:0,now:()=>now,readSessions:()=>rows,emit:e=>events.push(e)});
 scan();scan();assert.deepEqual(events,[{type:'activity',sessionId:'a'}]);
 rows=[{id:'a',state:'idle',sampleAt:9800,_completionAt:10000,_completionPending:false}];scan();scan();assert.equal(events.filter(e=>e.type==='completion').length,1);
 rows=[{id:'b',state:'idle',sampleAt:1000,_completionAt:1000}];now=30000;scan();assert.equal(events.filter(e=>e.type==='completion').length,1);
});
test('Codex current task_started is an activity signal while item completions and old starts are ignored',()=>{
 assert.deepEqual(parseActivityRecord({type:'event_msg',timestamp:10,payload:{type:'task_started'}},{sessionId:'a',since:1}),{type:'activity',sessionId:'a'});
 assert.equal(parseActivityRecord({type:'event_msg',timestamp:10,payload:{type:'item_completed'}},{since:1}),null);
 assert.equal(parseActivityRecord({type:'event_msg',timestamp:10,payload:{type:'task_started'}},{since:11}),null);
});
test('a Codex tail batch preserves completion followed by resumed activity so the UI can cancel it',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-start-signal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'session.jsonl');fs.writeFileSync(file,'');
 const tail=new CompletionRolloutTail(file,{sessionId:'fixture',since:1});
 fs.appendFileSync(file,[{type:'event_msg',timestamp:10,payload:{type:'task_complete',turn_id:'old'}},{type:'event_msg',timestamp:11,payload:{type:'task_started',turn_id:'new'}}].map(x=>JSON.stringify(x)+'\n').join(''));
 assert.deepEqual(tail.update().map(e=>e.type),['completion','activity']);assert.deepEqual(tail.update(),[]);
});
