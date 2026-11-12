import {trajectorySummaries} from './gemini-usage.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AdaptivePoller,createHostCheck,bindMonitorLifetime} from './host-activity.mjs';
export function completedTransition(previous,current) {
  return previous?.status==='CASCADE_RUN_STATUS_RUNNING' && current.status==='CASCADE_RUN_STATUS_IDLE'
    && !/CANCEL|USER_STOP|WAITING|INTERRUPT/.test(current.reason??'');
}
export function geminiCompletionScan({readSummaries=trajectorySummaries,emit=event=>process.stdout.write(JSON.stringify(event)+'\n'),now=Date.now}={}){
  let known=new Map();
  return async()=>{
    const rows=(await readSummaries()).filter(row=>row.depth===0);
    const next=new Map();
    for(const row of rows){
      const old=known.get(row.id);next.set(row.id,row);
      const age=now()-row.lastModified;
      if(completedTransition(old,row)&&Number.isFinite(row.lastModified)&&age>=0&&age<90_000){
        emit({type:'completion',sessionId:createHash('sha256').update(row.id).digest('hex').slice(0,24),turnId:String(row.lastModified),endedAt:row.lastModified,conversationTitle:row.title||null});
      }
    }
    known=next;
  };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const poller=new AdaptivePoller({checkActive:createHostCheck('gemini'),work:geminiCompletionScan(),onOrphan:()=>process.exit(0)});
  bindMonitorLifetime(poller);void poller.start();
}
