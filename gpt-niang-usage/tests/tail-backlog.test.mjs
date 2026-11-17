import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClaudeTail} from '../runtime/local-sessions.mjs';
import {CompletionRolloutTail} from '../runtime/completion-monitor.mjs';
import {localCompletionScan} from '../runtime/local-session-runner.mjs';
const line=x=>JSON.stringify(x)+'\n';
function file(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-tail-backlog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'log.jsonl');fs.writeFileSync(file,'');return file;}
test('Claude reports unread data and can finish a large append without another filesystem change',t=>{
 const p=file(t),tail=new ClaudeTail(p,{completionOnly:true});tail.update();
 fs.appendFileSync(p,'x'.repeat(8*1024*1024)+'\n'+[
  {type:'user',timestamp:1000,uuid:'u',message:{content:'fixture'}},
  {type:'assistant',timestamp:2000,uuid:'a',parentUuid:'u',message:{stop_reason:'end_turn',content:[{type:'text',text:'done'}]}},
  {type:'system',subtype:'stop_hook_summary',timestamp:3000,uuid:'s',parentUuid:'a',preventedContinuation:false,hookErrors:[]}
 ].map(line).join(''));
 tail.update();assert.equal(tail.hasUnread,true);assert.equal(tail.parser.completion.endedAt,null);
 tail.update();assert.equal(tail.hasUnread,false);assert.equal(tail.parser.completion.endedAt,3000);
});
test('Codex holds a completion until the unread suffix can invalidate it with a new task start',t=>{
 const p=file(t),tail=new CompletionRolloutTail(p,{sessionId:'fixture',since:1});
 fs.appendFileSync(p,line({type:'event_msg',timestamp:10,payload:{type:'task_complete',turn_id:'old'}})+'x'.repeat(4*1024*1024)+'\n'+line({type:'event_msg',timestamp:11,payload:{type:'task_started',turn_id:'new'}}));
 assert.deepEqual(tail.update(),[]);assert.equal(tail.hasUnread,true);
 assert.deepEqual(tail.update().map(e=>e.type),['activity']);assert.equal(tail.hasUnread,false);
});
test('partially read rows do not consume the final notification before the backlog is drained',()=>{
 let row={id:'a',state:'running',_completionAt:3000,_completionPending:true,_recordsPending:true};const events=[];
 const scan=localCompletionScan('claude',{since:0,now:()=>4000,readSessions:()=>[row],emit:e=>events.push(e)});
 scan();row={...row,state:'idle',_completionPending:false,_recordsPending:false};scan();scan();
 assert.deepEqual(events.map(e=>e.type),['activity','completion']);
});
