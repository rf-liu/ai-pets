import {trajectorySummaries} from './gemini-usage.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
let known=new Map(),busy=false;
export function completedTransition(previous,current) {
  return previous?.status==='CASCADE_RUN_STATUS_RUNNING' && current.status==='CASCADE_RUN_STATUS_IDLE'
    && !/CANCEL|USER_STOP|WAITING|INTERRUPT/.test(current.reason??'');
}
async function tick(){
  if(busy)return;busy=true;
  try{
    const rows=(await trajectorySummaries()).filter(row=>row.depth===0);
    const next=new Map();
    for(const row of rows){
      const old=known.get(row.id);next.set(row.id,row);
      if(completedTransition(old,row)&&Number.isFinite(row.lastModified)&&Math.abs(Date.now()-row.lastModified)<90_000){
        process.stdout.write(JSON.stringify({type:'completion',sessionId:createHash('sha256').update(row.id).digest('hex').slice(0,24),turnId:String(row.lastModified),endedAt:row.lastModified,conversationTitle:row.title||null})+'\n');
      }
    }
    known=next;
  }catch{known=new Map();}finally{busy=false;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  process.stdin.resume();process.stdin.once('end',()=>process.exit(0));
  process.on('SIGTERM',()=>process.exit(0));
  void tick();setInterval(()=>void tick(),2000);
}
