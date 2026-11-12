import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {AdaptivePoller,createHostCheck,matchesHost} from '../runtime/host-activity.mjs';
import {localCompletionScan} from '../runtime/local-session-runner.mjs';
import {geminiCompletionScan} from '../runtime/gemini-completion-monitor.mjs';

test('executable detection does not count the probing shell or another user',async()=>{
  assert.equal(matchesHost('gpt','/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'),true);
  assert.equal(matchesHost('gpt','/opt/bin/codex'),true);
  assert.equal(matchesHost('claude','/Users/test/.local/share/claude/versions/2.0.0'),true);
  assert.equal(matchesHost('deepseek','/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'),true);
  let calls=0,time=0;
  const check=createHostCheck('gemini',{uid:501,now:()=>time,readProcesses:async()=>{calls++;return {stdout:'501 999 /bin/sh\n502 998 /Applications/Antigravity.app/Contents/MacOS/Antigravity\n'};}});
  assert.equal(await check(),false);await check();assert.equal(calls,1);
  time=5000;await check();assert.equal(calls,2);
});
test('fresh native host state avoids process spawning and rejects a stale or foreign owner',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-host-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'state.json');let calls=0,time=10000;
  const check=createHostCheck('gpt',{stateFile:file,parentPid:42,now:()=>time,uid:501,readProcesses:async()=>{calls++;return {stdout:''};}});
  fs.writeFileSync(file,JSON.stringify({pid:42,at:10,hostsRunning:['gpt']}));assert.equal(await check(),true);assert.equal(calls,0);
  time=25000;assert.equal(await check(),false);assert.equal(calls,1);
});
test('sleep performs no work; active work never overlaps; pause and orphan stop are bounded',async()=>{
  let active=false,work=0,paused=0,scheduled=[],orphan=false,owner=true;
  const poller=new AdaptivePoller({checkActive:async()=>active,work:()=>{work++;},onPause:()=>{paused++;},ownerAlive:()=>owner,onOrphan:()=>{orphan=true;},schedule:(_,ms)=>{scheduled.push(ms);return 1;},cancel:()=>{}});
  await poller.start();assert.equal(work,0);assert.equal(scheduled.at(-1),5000);
  active=true;await poller.tick();assert.equal(work,1);assert.equal(scheduled.at(-1),2000);
  active=false;await poller.tick();await poller.tick();assert.equal(work,1);assert.equal(paused,1);
  owner=false;await poller.tick();assert.equal(orphan,true);assert.equal(poller.stopped,true);
});
test('stopping during an in-flight request cannot resurrect a timer',async()=>{
  let release,scheduled=0;
  const poller=new AdaptivePoller({checkActive:async()=>true,work:()=>new Promise(resolve=>{release=resolve;}),schedule:()=>{scheduled++;},ownerAlive:()=>true});
  const starting=poller.start();await Promise.resolve();poller.stop();release();await starting;assert.equal(scheduled,0);
});
test('late first scan after wake does not reset the startup boundary or duplicate completions',()=>{
  let now=10000,rows=[],found=[];
  const scan=localCompletionScan('claude',{now:()=>now,readSessions:()=>rows,emit:e=>found.push(e)});
  rows=[{id:'chat',sampleAt:12000,title:'fixture'}];now=15000;scan();scan();assert.equal(found.length,1);
  now=30000;rows=[{id:'chat',sampleAt:29000,title:'fixture'}];scan();assert.equal(found.length,2);
  rows=[{id:'future',sampleAt:40000}];scan();assert.equal(found.length,2);
});
test('temporary Gemini RPC failures preserve a running transition without repeated notifications',async()=>{
  let phase=0,found=[];
  const scan=geminiCompletionScan({now:()=>10000,since:0,settleMs:0,emit:e=>found.push(e),readEnd:async()=>({endedAt:9000,userInputStepIndex:2,lastStepIndex:3,executionId:'fixture'}),readSummaries:async()=>{
    if(phase===1)throw new Error('temporary fixture failure');
    return [{id:'a',depth:0,title:'fixture',lastModified:9000,lastUserInputStepIndex:2,waitingStepCount:0,reason:'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL',stepCount:4,status:phase===0?'CASCADE_RUN_STATUS_RUNNING':'CASCADE_RUN_STATUS_IDLE'}];
  }});
  await scan();phase=1;await assert.rejects(scan());phase=2;await scan();await scan();assert.equal(found.length,1);
});
test('all four monitor entrypoints exit when their owner is already gone',async t=>{
  for(const name of ['completion-monitor','gemini-completion-monitor','claude-completion-monitor','deepseek-completion-monitor']){
    const child=spawn(process.execPath,[fileURLToPath(new URL('../runtime/'+name+'.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{...process.env,AI_PETS_PARENT_PID:'2147483647'}});
    t.after(()=>{if(child.exitCode===null)child.kill();});
    const [code]=await Promise.race([once(child,'exit'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('orphan monitor stayed alive: '+name)),4000);timer.unref();})]);
    assert.equal(code,0,name);
  }
});
