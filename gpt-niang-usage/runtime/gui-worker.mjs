import fs from 'node:fs';
import path from 'node:path';
import {acquireWorkerLock,processAlive,readJson} from './worker-state.mjs';
import {atomicJson} from './usage.mjs';
import {createRefreshQueue,mergeUsageSnapshot,readRefreshRequest} from './refresh-queue.mjs';
import {readPendingRequests,completeRequests,cleanRefreshResults} from './refresh-client.mjs';

// Native GUI workers exchange volatile state over inherited pipes. The files
// here are ownership records and explicit external requests, never heartbeats.
export async function runGuiWorker({readUsage,resolveCodexExecutable,pluginVersion,usageStats=null}){
  const config=readJson(process.argv[2]),parentPid=Number(process.argv[3]);
  if(!config?.dataDir||!config.codexPath||!Number.isSafeInteger(parentPid)||parentPid<=0)throw new Error('Invalid GUI worker owner');
  const lock=await acquireWorkerLock(config.dataDir,parentPid,{onLost:()=>process.exit(1)});
  if(!lock)return;
  const healthFile=path.join(config.dataDir,'worker-status.json');
  let snapshot=null,visible=false,quotaVisible=false,buffer='',dirty=true,lastRefresh=0;
  let usageBusy=false,usageQueuedForce=false,lastUsageAttempt=0,lastUsageDay=null;
  const usageIntervalMs=Number.isFinite(usageStats?.intervalMs)&&usageStats.intervalMs>0?usageStats.intervalMs:60*60*1000;
  const initialStop=readRefreshRequest(path.join(config.dataDir,'stop.flag'));
  let requestToken=readRefreshRequest(path.join(config.dataDir,'refresh.flag'));
  const handoffName='worker-handoff-'+lock.owner.token+'.flag';
  const requests=path.join(config.dataDir,'refresh-requests');fs.mkdirSync(requests,{recursive:true});
  const publish=value=>{if(!process.stdout.destroyed)process.stdout.write(JSON.stringify(value)+'\n');};
  const save=value=>{snapshot=value;publish({type:'snapshot',snapshot:value});};
  const currentLocalDay=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  async function runUsageScan(force=false){
    if(!usageStats)return;
    if(usageBusy){if(force)usageQueuedForce=true;return;}
    usageBusy=true;
    lastUsageAttempt=Date.now();
    publish({type:'usageStatus',busy:true});
    try{
      const result=await usageStats.scan({dataDir:config.dataDir,force});
      if(result?.summary){
        lastUsageAttempt=result.summary.updatedAt??Date.now();
        lastUsageDay=result.summary.todayDate??currentLocalDay(Date.now());
        publish({type:'usageStats',stats:result.summary});
      }
    }catch{
      publish({type:'usageError',error:'用量统计读取失败，请稍后刷新。'});
    }finally{
      usageBusy=false;
      publish({type:'usageStatus',busy:false});
      if(usageQueuedForce){
        usageQueuedForce=false;
        void runUsageScan(true);
      }
    }
  }
  const refresh=createRefreshQueue(async()=>{
    const batch=readPendingRequests(config.dataDir);
    try{
      const next=await readUsage(resolveCodexExecutable(config.codexPath),{onAccount:accountKey=>{
        if(snapshot?.accountKey!==accountKey||!accountKey)save({ok:false,queryOk:false,accountKey,windows:[],checkedAt:Date.now(),error:'正在读取当前账户额度…'});
      }});
      save(mergeUsageSnapshot(snapshot,next));completeRequests(config.dataDir,batch,snapshot);lastRefresh=Date.now();
    }finally{cleanRefreshResults(config.dataDir);}
  },{onError:()=>publish({type:'error',error:'额度暂时不可用，请稍后刷新。'})});
  atomicJson(healthFile,{...lock.owner,version:pluginVersion,handoffProtocol:1,transport:'stdio',at:Date.now(),busy:false,lastRefresh:0});
  const watch=fs.watch(config.dataDir,(_event,name)=>{
    if(name===null||['stop.flag','refresh.flag',handoffName,'refresh-requests'].includes(String(name)))dirty=true;
  });
  const requestWatch=fs.watch(requests,()=>{dirty=true;});
  watch.on('error',()=>process.exit(1));requestWatch.on('error',()=>process.exit(1));
  function stopApplies(value){
    if(value===null||value===initialStop)return false;
    const fields=value.split(':');
    if(fields.length===4&&fields[1]==='worker-handoff')return fields[2]===lock.owner.token;
    return true;
  }
  function controls(){
    if(!dirty)return;dirty=false;
    if(stopApplies(readRefreshRequest(path.join(config.dataDir,'stop.flag'))))process.exit(0);
    if(readRefreshRequest(path.join(config.dataDir,handoffName))!==null){if(!refresh.busy)process.exit(0);dirty=true;return;}
    const token=readRefreshRequest(path.join(config.dataDir,'refresh.flag'));
    const pending=readPendingRequests(config.dataDir);
    if(token!==null&&token!==requestToken||pending.length){requestToken=token;void refresh.request();}
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    buffer+=chunk;if(buffer.length>8192){buffer='';return;}
    let end;while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      try{
        const message=JSON.parse(line);
        if(message.type==='presence'){
          visible=message.visible===true;const next=visible&&message.quotaVisible===true;
          if(next&&!quotaVisible&&Date.now()-refresh.lastRefresh>=60000)void refresh.request();quotaVisible=next;
        }else if(message.type==='refresh')void refresh.request();
        else if(message.type==='refreshUsage')void runUsageScan(true);
      }catch{}
    }
  });
  const timer=setInterval(()=>{
    if(!processAlive(parentPid))process.exit(0);
    controls();
    if(quotaVisible&&!refresh.busy&&Date.now()-refresh.lastRefresh>=60000)void refresh.request();
    if(usageStats&&!usageBusy){
      const now=Date.now();
      const day=currentLocalDay(now);
      if(now-lastUsageAttempt>=usageIntervalMs||(lastUsageDay&&lastUsageDay!==day)){
        lastUsageDay=day;
        void runUsageScan(false);
      }
    }
    publish({type:'health',pid:process.pid,at:Date.now(),busy:refresh.busy});
  },1000);
  const exit=()=>process.exit(0);
  process.stdin.once('end',exit);process.once('SIGTERM',exit);process.once('SIGINT',exit);
  process.on('exit',()=>{
    clearInterval(timer);watch.close();requestWatch.close();
    try{if(readJson(healthFile)?.token===lock.owner.token)fs.unlinkSync(healthFile);}catch{}
    lock.release();
  });
  publish({type:'health',pid:process.pid,at:Date.now(),busy:false});
  if(usageStats){
    const cached=usageStats.loadSaved?.(config.dataDir);
    if(cached){
      lastUsageAttempt=cached.updatedAt??0;
      lastUsageDay=cached.todayDate??currentLocalDay(Date.now());
      publish({type:'usageStats',stats:cached});
    }
    const now=Date.now();
    if(!cached?.updatedAt||!cached.last3Days||!cached.last30Days||now-cached.updatedAt>=usageIntervalMs||cached.todayDate!==currentLocalDay(now)){
      void runUsageScan(false);
    }
  }
  if(!processAlive(parentPid))process.exit(0);
}
