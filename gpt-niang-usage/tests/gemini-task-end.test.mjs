import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {executorMetadata,verifiedTaskEnd,readTaskEnd,activeDescendantRoots} from '../runtime/gemini-task-end.mjs';
import {normalizeTrajectorySummaries} from '../runtime/gemini-usage.mjs';
import {geminiCompletionScan} from '../runtime/gemini-completion-monitor.mjs';

const id='00000000-0000-0000-0000-000000000001',now=Date.parse('2026-11-12T12:00:00Z');
const v=value=>{let n=BigInt(value),out=[];do{const b=Number(n&127n);n>>=7n;out.push(b|(n?128:0));}while(n);return Buffer.from(out);};
const integer=(field,value)=>Buffer.concat([v(field*8),v(value)]);
const blob=(field,value)=>Buffer.concat([v(field*8+2),v(value.length),value]);
const stamp=ms=>Buffer.concat([integer(1,Math.floor(ms/1000)),integer(2,(ms%1000)*1000000)]);
const encodedExec=({reason=4,last=12,auto=false,error=false}={})=>Buffer.concat([
  integer(1,reason),integer(2,2),integer(3,last),integer(4,auto?1:0),blob(9,Buffer.from('execution-a')),
  blob(10,Buffer.from('configuration is never decoded')), ...(error?[blob(12,Buffer.from('fixture error'))]:[])
]);
const row=()=>({id,depth:0,title:'fixture',status:'CASCADE_RUN_STATUS_IDLE',reason:'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL',
  lastModified:now,lastUserInputStepIndex:10,lastUserInputTime:now-60000,stepCount:13,waitingStepCount:0});
function steps(){
  const start=Buffer.concat([blob(1,stamp(now-60000)),integer(3,4)]);
  const end=Buffer.concat([blob(1,stamp(now-10000)),blob(7,stamp(now-2000)),blob(8,stamp(now-1000)),integer(3,2),blob(12,Buffer.from('execution-a'))]);
  return [{idx:10,step_type:14,status:3,metadata:start.toString('hex')},{idx:12,step_type:15,status:3,metadata:end.toString('hex')}];
}

test('verified final reply uses the current input boundary and actual completed step time',()=>{
  const end=verifiedTaskEnd(row(),executorMetadata(encodedExec()),steps());
  assert.equal(end.endedAt,now-1000);assert.equal(end.startedAt,now-60000);assert.equal(end.userInputStepIndex,10);
});
test('stale previous-executor reason cannot finish a newer user request during transient idle',()=>{
  assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec({last:9})),steps()),null);
  assert.equal(verifiedTaskEnd({...row(),lastUserInputStepIndex:13},executorMetadata(encodedExec()),steps()),null);
});
test('errors, cancellation, chaining, limits and auto-continuation are not normal endings',()=>{
  for(const reason of [0,1,2,3,6,7,9,10,11,12])assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec({reason})),steps()),null);
  assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec({auto:true})),steps()),null);
  assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec({error:true})),steps()),null);
});
test('waiting, busy state and running children suppress an otherwise valid final record',()=>{
  for(const flags of [{waitingStepCount:1},{notFullyIdle:true},{hasActiveChildren:true},{hasRunningSubagents:true},{interrupted:true},{killed:true},{status:'CASCADE_RUN_STATUS_BUSY'}])assert.equal(verifiedTaskEnd({...row(),...flags},executorMetadata(encodedExec()),steps()),null);
});
test('observed AGY idle parent and running browser child are linked without a running-subagent flag',()=>{
  const childId='00000000-0000-0000-0000-000000000002';
  const rows=normalizeTrajectorySummaries({trajectorySummaries:{
    [id]:{status:'CASCADE_RUN_STATUS_IDLE',stepCount:135,lastUserInputStepIndex:86,
      latestExecutorTerminationReason:'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL',trajectoryMetadata:{rootConversationId:id}},
    [childId]:{status:'CASCADE_RUN_STATUS_RUNNING',stepCount:43,
      latestExecutorTerminationReason:'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL',
      trajectoryMetadata:{parentConversationId:id,rootConversationId:id,nestingDepth:1}}
  }});
  assert.equal(rows[0].hasRunningSubagents,false);assert.equal(rows[0].notFullyIdle,false);
  assert.equal(rows[1].parentId,id);assert.equal(rows[1].rootId,id);
  assert.ok(activeDescendantRoots(rows).has(id));
});
test('nested, waiting and busy children block ancestors, including when an intermediate summary is missing',()=>{
  for(const flags of [{status:'CASCADE_RUN_STATUS_RUNNING'},{status:'CASCADE_RUN_STATUS_BUSY'},
    {status:'CASCADE_RUN_STATUS_CANCELING'},{status:'CASCADE_RUN_STATUS_UNSPECIFIED'},
    {notFullyIdle:true},{hasRunningSubagents:true},{waitingStepCount:1}]){
    const middle={...row(),id:'middle',parentId:id},child={...row(),id:'child',parentId:'middle',rootId:id,...flags};
    assert.ok(activeDescendantRoots([row(),middle,child]).has(id));
    assert.ok(activeDescendantRoots([row(),child]).has(id));
  }
  assert.ok(activeDescendantRoots([row(),{...row(),id:'child',parentId:id,status:'CASCADE_RUN_STATUS_RUNNING'}]).has(id));
});
test('unrelated active conversations and terminal children do not suppress a normal completion',()=>{
  const other={...row(),id:'other',rootId:'other',status:'CASCADE_RUN_STATUS_RUNNING'};
  const endedChild={...row(),id:'child',rootId:id,parentId:id,killed:true};
  assert.equal(activeDescendantRoots([row(),other,endedChild]).has(id),false);
});
test('malformed parent cycles terminate and do not block unrelated roots',()=>{
  const a={...row(),id:'a',parentId:'b',status:'CASCADE_RUN_STATUS_RUNNING'},b={...row(),id:'b',parentId:'a'};
  const blocked=activeDescendantRoots([a,b,row()]);assert.ok(blocked.has('b'));assert.equal(blocked.has(id),false);
});
test('unfinished browser and generic tool steps before the final reply still block completion',()=>{
  for(const type of [85,132,136])for(const status of [0,1,2,8,9,11,13,null]){
    assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec()),[...steps(),{idx:11,step_type:type,status}]),null);
  }
  for(const status of [3,4,5,6,7,12])assert.ok(verifiedTaskEnd(row(),executorMetadata(encodedExec()),[...steps(),{idx:11,step_type:132,status}]));
  assert.ok(verifiedTaskEnd(row(),executorMetadata(encodedExec()),[...steps(),{idx:9,step_type:132,status:2}]));
});
test('generic tools and intermediate notify-user steps are not final answer steps',()=>{
  for(const type of [132,82,81,17]){const values=steps();values[1].step_type=type;assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec()),values),null);}
  const values=steps();values[1].step_type=2;
  assert.ok(verifiedTaskEnd({...row(),reason:'EXECUTOR_TERMINATION_REASON_TERMINAL_STEP_TYPE'},executorMetadata(encodedExec({reason:8})),values));
});
test('only completed housekeeping may follow the final reply, with no missing trailing steps',()=>{
  assert.ok(verifiedTaskEnd({...row(),stepCount:14},executorMetadata(encodedExec()),[...steps(),{idx:13,step_type:101,status:3}]));
  for(const extra of [{idx:13,step_type:132,status:3},{idx:13,step_type:101,status:2}])assert.equal(verifiedTaskEnd({...row(),stepCount:14},executorMetadata(encodedExec()),[...steps(),extra]),null);
  assert.equal(verifiedTaskEnd({...row(),stepCount:14},executorMetadata(encodedExec()),steps()),null);
});
test('missing times, unmatched execution id and system-injected input do not invent a user completion',()=>{
  const values=steps();values[1].metadata=blob(1,stamp(now-10000)).toString('hex');assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec()),values),null);
  const foreign={...executorMetadata(encodedExec()),executionId:'other'};assert.equal(verifiedTaskEnd(row(),foreign,steps()),null);
  const system=steps();system[0].metadata=Buffer.concat([blob(1,stamp(now-60000)),integer(3,6)]).toString('hex');assert.equal(verifiedTaskEnd(row(),executorMetadata(encodedExec()),system),null);
});
test('stable confirmation emits at most once for each real input despite repeated status flips',async()=>{
  let clock=now,current=row(),end=verifiedTaskEnd(current,executorMetadata(encodedExec()),steps());const found=[];
  const scan=geminiCompletionScan({now:()=>clock,since:now-10000,readSummaries:async()=>[current],readEnd:async()=>end,emit:e=>found.push(e)});
  await scan();clock+=2000;await scan();assert.equal(found.length,0);clock+=2000;await scan();assert.equal(found.length,1);
  current={...current,status:'CASCADE_RUN_STATUS_RUNNING'};await scan();current={...current,status:'CASCADE_RUN_STATUS_IDLE',lastModified:clock};clock+=10000;await scan();assert.equal(found.length,1);
  current={...current,lastUserInputStepIndex:14,stepCount:17,lastModified:clock};end={...end,userInputStepIndex:14,lastStepIndex:16,executionId:'execution-b',endedAt:clock-1};
  await scan();clock+=4000;await scan();assert.equal(found.length,2);assert.equal(found[1].turnId,'input-14');
});
test('resumed work resets the quiet interval before the final notification',async()=>{
  let clock=now,current=row();const found=[],end=verifiedTaskEnd(current,executorMetadata(encodedExec()),steps());
  const scan=geminiCompletionScan({now:()=>clock,since:now-10000,readSummaries:async()=>[current],readEnd:async()=>end,emit:e=>found.push(e)});
  await scan();clock+=2000;current={...current,notFullyIdle:true};await scan();clock+=2000;current={...current,notFullyIdle:false};await scan();
  clock+=2000;await scan();assert.equal(found.length,0);clock+=2000;await scan();assert.equal(found.length,1);
});
test('running descendants reset the quiet interval; a finished browser permits one final reminder',async()=>{
  let clock=now,children=[];const found=[],end=verifiedTaskEnd(row(),executorMetadata(encodedExec()),steps());
  const scan=geminiCompletionScan({now:()=>clock,since:now-10000,readSummaries:async()=>[row(),...children],readEnd:async()=>end,emit:e=>found.push(e)});
  await scan();clock+=2000;children=[{...row(),id:'browser',depth:1,parentId:id,rootId:id,status:'CASCADE_RUN_STATUS_RUNNING'}];
  await scan();clock+=4000;await scan();assert.equal(found.length,0);
  children[0].status='CASCADE_RUN_STATUS_IDLE';await scan();clock+=2000;await scan();assert.equal(found.length,0);
  clock+=2000;await scan();assert.equal(found.length,1);clock+=4000;await scan();assert.equal(found.length,1);
});
test('a linked child without nestingDepth cannot emit its own root completion',async()=>{
  const found=[],child={...row(),id:'child',parentId:id,rootId:id};
  const scan=geminiCompletionScan({now:()=>now,since:now-10000,settleMs:0,readSummaries:async()=>[child],
    readEnd:async()=>verifiedTaskEnd(row(),executorMetadata(encodedExec()),steps()),emit:e=>found.push(e)});
  await scan();assert.equal(found.length,0);
});
test('startup and metadata edits do not replay an already finished input',async()=>{
  const found=[],end=verifiedTaskEnd(row(),executorMetadata(encodedExec()),steps());
  const scan=geminiCompletionScan({now:()=>now,since:now,settleMs:0,readSummaries:async()=>[{...row(),lastModified:now}],readEnd:async()=>end,emit:e=>found.push(e)});
  await scan();assert.equal(found.length,0);
});
test('database checks use the newest executor only and reject an oversized newest record',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-task-end-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,id+'.db');
  execFileSync('/usr/bin/sqlite3',[file,`CREATE TABLE executor_metadata(idx INTEGER,data BLOB);CREATE TABLE steps(idx INTEGER,step_type INTEGER,status INTEGER,metadata BLOB);INSERT INTO executor_metadata VALUES(0,X'${encodedExec().toString('hex')}');`]);
  for(const step of steps())execFileSync('/usr/bin/sqlite3',[file,`INSERT INTO steps VALUES(${step.idx},${step.step_type},${step.status},X'${step.metadata}');`]);
  assert.ok(await readTaskEnd(row(),{conversationsRoot:root}));
  // Real observed shape: an earlier GENERIC invocation is RUNNING even though
  // the latest PLANNER_RESPONSE and executor both look final.
  execFileSync('/usr/bin/sqlite3',[file,'INSERT INTO steps VALUES(11,132,2,NULL);']);
  assert.equal(await readTaskEnd(row(),{conversationsRoot:root}),null);
  execFileSync('/usr/bin/sqlite3',[file,'UPDATE steps SET status=3 WHERE idx=11;']);
  assert.ok(await readTaskEnd(row(),{conversationsRoot:root}));
  execFileSync('/usr/bin/sqlite3',[file,'UPDATE steps SET status=NULL WHERE idx=11;']);
  assert.equal(await readTaskEnd(row(),{conversationsRoot:root}),null);
  execFileSync('/usr/bin/sqlite3',[file,'UPDATE steps SET status=3 WHERE idx=11;']);
  execFileSync('/usr/bin/sqlite3',[file,'INSERT INTO executor_metadata VALUES(1,zeroblob(131073));']);assert.equal(await readTaskEnd(row(),{conversationsRoot:root}),null);
});
