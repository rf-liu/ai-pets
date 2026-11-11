import {readLocalSessions} from './local-sessions.mjs';
export function runSpeed(profile){
 const update=()=>{try{const threads=readLocalSessions(profile).map(({_rejection,_costRecords,...row})=>row);process.stdout.write(JSON.stringify({threads,error:null})+'\n');}catch{process.stdout.write(JSON.stringify({threads:[],error:'本地会话记录暂不可读。'})+'\n');}};
 update();const timer=setInterval(update,3000);process.stdin.resume();process.stdin.once('end',()=>{clearInterval(timer);process.exit(0)});process.on('SIGTERM',()=>process.exit(0));
}
export function runCompletions(profile){
 const seen=new Map(),started=Date.now();
 const update=()=>{try{for(const row of readLocalSessions(profile)){
  const previous=seen.get(row.id);seen.set(row.id,row.sampleAt);
  if(row.sampleAt&&row.sampleAt>=started&&row.sampleAt!==previous&&Date.now()-row.sampleAt<90000)process.stdout.write(JSON.stringify({type:'completion',sessionId:row.id,turnId:String(row.sampleAt),endedAt:row.sampleAt,conversationTitle:row.title,estimatedCost:row.estimatedCost,costCurrency:row.costCurrency})+'\n');
 }}catch{}};
 update();const timer=setInterval(update,2000);process.stdin.resume();process.stdin.once('end',()=>{clearInterval(timer);process.exit(0)});process.on('SIGTERM',()=>process.exit(0));
}
