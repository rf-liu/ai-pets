import {trajectorySummaries} from './gemini-usage.mjs';
import {readGenerationSpeed} from './gemini-generation-speed.mjs';
import {createHash} from 'node:crypto';
let busy=false;const caches=new Map();
async function tick(){
  if(busy)return;busy=true;
  try{
    const rows=(await trajectorySummaries()).filter(x=>x.depth===0).sort((a,b)=>b.lastModified-a.lastModified).slice(0,12),threads=[];
    for(const [index,row] of rows.entries()){
      const cache=caches.get(row.id)??{};caches.set(row.id,cache);
      const now=Date.now(),revision=String(row.lastModified)+':'+row.stepCount;
      if(row.status==='CASCADE_RUN_STATUS_RUNNING'||cache.revision!==revision||now-(cache.fetchedAt??0)>=60000){
        cache.fetchedAt=now;cache.revision=revision;
        try{cache.sample=await readGenerationSpeed(row.id);cache.error=null;}
        catch{cache.error=cache.sample?'本地记录暂时不可读，显示上次生成统计。':'本地生成记录暂时不可读，正在重试。';cache.revision=null;}
      }
      threads.push({id:createHash('sha256').update(row.id).digest('hex').slice(0,24),title:row.title||'Antigravity 会话 '+(index+1),state:row.status==='CASCADE_RUN_STATUS_RUNNING'?'running':'idle',tokensPerSecond:null,sampleAt:null,outputTokens:null,intervalSeconds:null,unavailableReason:cache.error??(cache.sample?null:'当前生成尚未返回有效 token 数或耗时。'),...cache.sample});
    }
    const alive=new Set(rows.map(x=>x.id));for(const key of caches.keys())if(!alive.has(key))caches.delete(key);
    process.stdout.write(JSON.stringify({threads,error:null})+'\n');
  }catch{process.stdout.write(JSON.stringify({threads:[],error:'Antigravity 本地状态暂不可用，请确认已打开并登录。'})+'\n');}
  finally{busy=false;}
}
process.stdin.resume();process.stdin.once('end',()=>process.exit(0));process.on('SIGTERM',()=>process.exit(0));
void tick();setInterval(()=>void tick(),3000);
