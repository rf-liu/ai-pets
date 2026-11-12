import {readLocalSessions,clearLocalSessionCaches} from './local-sessions.mjs';
import {AdaptivePoller,createHostCheck,bindMonitorLifetime} from './host-activity.mjs';
export function runSpeed(profile){
 const update=()=>{try{const threads=readLocalSessions(profile).map(({_rejection,_costRecords,...row})=>row);process.stdout.write(JSON.stringify({threads,error:null})+'\n');}catch{process.stdout.write(JSON.stringify({threads:[],error:'本地会话记录暂不可读。'})+'\n');}};
 update();const timer=setInterval(update,3000);process.stdin.resume();process.stdin.once('end',()=>{clearInterval(timer);process.exit(0)});process.on('SIGTERM',()=>process.exit(0));
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
 const poller=new AdaptivePoller({checkActive:createHostCheck(profile),work:scan,
  onPause:()=>{try{scan();}finally{clearLocalSessionCaches(profile);}},onOrphan:()=>process.exit(0)});
 bindMonitorLifetime(poller);void poller.start();return poller;
}
