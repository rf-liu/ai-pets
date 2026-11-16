import {readLocalSessions,clearLocalSessionCaches} from './local-sessions.mjs';
import {AdaptivePoller,createHostCheck,bindMonitorLifetime} from './host-activity.mjs';
import {ChangeGate} from './change-gate.mjs';
import os from 'node:os';
import path from 'node:path';
export const localRecordRoots=profile=>profile==='claude'?[path.join(os.homedir(),'Library/Application Support/Claude/claude-code-sessions'),path.join(os.homedir(),'.claude/projects')]:[path.join(os.homedir(),'.dsh/sessions')];
export function runSpeed(profile){
 const update=()=>{try{const threads=readLocalSessions(profile).map(({_rejection,_costRecords,...row})=>row);process.stdout.write(JSON.stringify({threads,error:null})+'\n');}catch{process.stdout.write(JSON.stringify({threads:[],error:'本地会话记录暂不可读。'})+'\n');}};
 const gate=new ChangeGate(localRecordRoots(profile));
 const changed=()=>{if(gate.consume())update();};changed();const timer=setInterval(changed,3000);process.stdin.resume();process.stdin.once('end',()=>{gate.close();clearInterval(timer);process.exit(0)});process.on('SIGTERM',()=>process.exit(0));
}
export function localCompletionScan(profile,{readSessions=readLocalSessions,emit=event=>process.stdout.write(JSON.stringify(event)+'\n'),now=Date.now,since=now()}={}){
 const seen=new Map();
 return ()=>{for(const row of readSessions(profile)){
  const previous=seen.get(row.id);seen.set(row.id,row.sampleAt);
  const age=now()-row.sampleAt;
  if(row.sampleAt&&row.sampleAt>=since&&row.sampleAt!==previous&&age>=0&&age<90000)emit({type:'completion',sessionId:row.id,turnId:String(row.sampleAt),endedAt:row.sampleAt,conversationTitle:row.title,estimatedCost:row.estimatedCost,costCurrency:row.costCurrency});
  while(seen.size>4096)seen.delete(seen.keys().next().value);
 }};
}
export function runCompletions(profile){
 const scan=localCompletionScan(profile);
 const gate=new ChangeGate(localRecordRoots(profile));
 const poller=new AdaptivePoller({checkActive:createHostCheck(profile),work:()=>{if(gate.consume())scan();},
  onPause:()=>{gate.mark();clearLocalSessionCaches(profile);},onOrphan:()=>process.exit(0)});
 bindMonitorLifetime(poller);void poller.start();return poller;
}
