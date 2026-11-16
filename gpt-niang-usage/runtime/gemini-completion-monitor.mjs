import {trajectorySummaries} from './gemini-usage.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AdaptivePoller,createHostCheck,bindMonitorLifetime} from './host-activity.mjs';
import {fullyIdle,readTaskEnd,activeDescendantRoots} from './gemini-task-end.mjs';
import {ChangeGate} from './change-gate.mjs';
import os from 'node:os';
import path from 'node:path';
export function geminiCompletionScan({readSummaries=trajectorySummaries,readEnd=readTaskEnd,
  emit=event=>process.stdout.write(JSON.stringify(event)+'\n'),now=Date.now,since=now(),settleMs=3000}={}){
  const pending=new Map(),emitted=new Set();
  return async()=>{
    const summaries=await readSummaries(),blocked=activeDescendantRoots(summaries);
    const rows=summaries.filter(row=>row.depth===0&&!row.parentId&&(!row.rootId||row.rootId===row.id));
    const present=new Set();
    for(const row of rows){
      present.add(row.id);
      const key=row.id+'\0'+row.lastUserInputStepIndex;
      if(blocked.has(row.id)||!fullyIdle(row)||emitted.has(key)||!Number.isFinite(row.lastModified)||row.lastModified<since){pending.delete(row.id);continue;}
      let end;try{end=await readEnd(row);}catch{pending.delete(row.id);continue;}
      const time=now(),age=time-end?.endedAt;
      if(!end||end.userInputStepIndex!==row.lastUserInputStepIndex||end.endedAt<since||!Number.isFinite(age)||age<0||age>=90000){pending.delete(row.id);continue;}
      const signature=end.executionId+':'+end.lastStepIndex+':'+row.stepCount+':'+end.endedAt;
      const old=pending.get(row.id);
      if(!old||old.signature!==signature||time<old.at)pending.set(row.id,{signature,at:time});
      const stable=pending.get(row.id);
      if(time-stable.at<settleMs)continue;
      emitted.add(key);while(emitted.size>4096)emitted.delete(emitted.values().next().value);
      pending.delete(row.id);
      emit({type:'completion',sessionId:createHash('sha256').update(row.id).digest('hex').slice(0,24),turnId:'input-'+end.userInputStepIndex,endedAt:end.endedAt,conversationTitle:row.title||null});
    }
    for(const id of pending.keys())if(!present.has(id))pending.delete(id);
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const gate=new ChangeGate([path.join(os.homedir(),'.gemini/antigravity/conversations')]);
  let rows=null;const ends=new Map();
  const readSummaries=async()=>{
    if(gate.consume()||rows===null){try{rows=await trajectorySummaries();ends.clear();}catch(error){gate.mark();throw error;}}
    return rows;
  };
  const readEnd=async row=>{if(!ends.has(row.id))ends.set(row.id,await readTaskEnd(row));return ends.get(row.id);};
  const poller=new AdaptivePoller({checkActive:createHostCheck('gemini'),work:geminiCompletionScan({readSummaries,readEnd}),onPause:()=>{gate.mark();rows=null;ends.clear();},onOrphan:()=>process.exit(0)});
  bindMonitorLifetime(poller);void poller.start();
}
