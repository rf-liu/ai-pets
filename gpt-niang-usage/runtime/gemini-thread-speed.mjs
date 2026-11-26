import fs from 'node:fs';
import {trajectorySummaries} from './gemini-usage.mjs';
import {DEFAULT_CONVERSATION_ROOTS,readGenerationSpeed} from './gemini-generation-speed.mjs';
import {openReadOnlySqlite,resolveSafeDbPath} from './gemini-usage-stats.mjs';
import {createHash} from 'node:crypto';
import {RecentSpeedSamples} from './recent-speed.mjs';
import {ChangeGate} from './change-gate.mjs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const UUID_RE=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DEFAULT_SUMMARY_DBS=[
  path.join(os.homedir(),'.gemini','antigravity','conversation_summaries.db'),
  path.join(os.homedir(),'.gemini','antigravity-cli','conversation_summaries.db')
];

function safeStat(file){try{return fs.statSync(file);}catch{return null;}}

function dbFreshMtime(file){
  const st=safeStat(file);
  if(!st)return 0;
  const wal=safeStat(file+'-wal');
  return Math.max(st.mtimeMs,wal?.mtimeMs??0);
}

function parseSqliteDate(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value!=='string'||!value.trim())return NaN;
  const iso=value.trim().replace(' ','T');
  return Date.parse(iso);
}

export function localTrajectorySummaries({summaryDbs=DEFAULT_SUMMARY_DBS,conversationRoots=DEFAULT_CONVERSATION_ROOTS,limit=36}={}){
  const byId=new Map();
  const findDb=id=>{
    for(let i=0;i<conversationRoots.length;i++){
      const dbFile=resolveSafeDbPath(conversationRoots[i],id);
      if(dbFile)return {dbFile,source:i===1?'cli':'desktop'};
    }
    return null;
  };
  for(const summaryDb of summaryDbs){
    if(!safeStat(summaryDb))continue;
    let db;
    try{
      const real=fs.realpathSync(summaryDb);
      db=openReadOnlySqlite(real);
      const rows=db.prepare('SELECT conversation_id, title, step_count, last_modified_time, status, nesting_depth FROM conversation_summaries WHERE nesting_depth = 0 ORDER BY last_modified_time DESC LIMIT 120').all();
      for(const row of rows){
        const id=String(row.conversation_id??'');
        if(!UUID_RE.test(id))continue;
        const found=findDb(id);
        if(!found)continue;
        const parsedTime=parseSqliteDate(row.last_modified_time);
        const fileTime=dbFreshMtime(found.dbFile);
        const lastModified=Math.max(Number.isFinite(parsedTime)?parsedTime:0,fileTime);
        const stepCount=Number(row.step_count??0);
        const title=String(row.title??'').split('\n')[0].trim().slice(0,120);
        const status=String(row.status??'');
        const prev=byId.get(id);
        if(!prev||lastModified>prev.lastModified||(lastModified===prev.lastModified&&stepCount>prev.stepCount)){
          byId.set(id,{
            id,
            source:found.source,
            title:title||prev?.title||'',
            status:status||prev?.status||'',
            lastModified,
            stepCount:Math.max(stepCount,prev?.stepCount??0),
            depth:0
          });
        }else if(!prev.title&&title){
          prev.title=title;
        }
      }
    }catch{}finally{try{db?.close();}catch{}}
  }

  for(let i=0;i<conversationRoots.length;i++){
    const root=conversationRoots[i];
    let base;
    try{base=fs.realpathSync(root);}catch{continue;}
    let entries;
    try{entries=fs.readdirSync(base);}catch{continue;}
    const candidates=[];
    for(const name of entries){
      if(!name.endsWith('.db'))continue;
      const id=name.slice(0,-3);
      if(!UUID_RE.test(id))continue;
      const full=path.join(base,name);
      const mtime=dbFreshMtime(full);
      if(mtime>0)candidates.push({id,mtime});
    }
    candidates.sort((a,b)=>b.mtime-a.mtime);
    for(const item of candidates.slice(0,limit)){
      const existing=byId.get(item.id);
      if(existing){
        if(item.mtime>existing.lastModified)existing.lastModified=item.mtime;
      }else{
        byId.set(item.id,{id:item.id,source:i===1?'cli':'desktop',title:'',status:'',lastModified:item.mtime,stepCount:0,depth:0});
      }
    }
  }

  return [...byId.values()].sort((a,b)=>b.lastModified-a.lastModified).slice(0,limit);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const watchDirs=DEFAULT_CONVERSATION_ROOTS.filter(dir=>Boolean(safeStat(dir)));
  const gate=new ChangeGate(watchDirs.length?watchDirs:[DEFAULT_CONVERSATION_ROOTS[0]],{settleMs:4000});
  let busy=false;const caches=new Map();
  async function tick(){
    if(busy||!gate.consume())return;busy=true;
    try{
      let rows=null,rpcOk=false;
      try{
        rows=(await trajectorySummaries()).filter(x=>x.depth===0).sort((a,b)=>b.lastModified-a.lastModified).slice(0,12);
        rpcOk=true;
      }catch{
        rows=localTrajectorySummaries({limit:36});
      }
      if(!rows.length){
        process.stdout.write(JSON.stringify({threads:[],error:'暂未找到本地 Antigravity 会话记录。'})+'\n');
        return;
      }
      const threads=[],kept=new Set();
      for(const row of rows){
        if(threads.length>=12)break;
        const cache=caches.get(row.id)??{history:new RecentSpeedSamples()};caches.set(row.id,cache);
        const now=Date.now(),revision=String(Math.trunc(row.lastModified))+':'+row.stepCount;
        if(row.status==='CASCADE_RUN_STATUS_RUNNING'||cache.revision!==revision){
          cache.fetchedAt=now;cache.revision=revision;
          try{cache.sample=await readGenerationSpeed(row.id,{history:cache.history,preferLocal:!rpcOk});cache.error=null;}
          catch{cache.error=cache.sample?'本地记录暂时不可读，显示上次生成统计。':'本地生成记录暂时不可读，正在重试。';cache.revision=null;}
        }
        // In local fallback mode, skip idle empty/probe DBs that have no generation records so real sessions fill the 12 slots.
        if(!rpcOk&&!cache.sample&&!cache.error&&row.status!=='CASCADE_RUN_STATUS_RUNNING'){kept.add(row.id);continue;}
        kept.add(row.id);
        const fallbackPrefix=row.source==='cli'?'agy 会话 ':'Antigravity 会话 ';
        threads.push({id:createHash('sha256').update(row.id).digest('hex').slice(0,24),title:row.title||(fallbackPrefix+(threads.length+1)),state:row.status==='CASCADE_RUN_STATUS_RUNNING'?'running':'idle',tokensPerSecond:null,sampleAt:null,outputTokens:null,intervalSeconds:null,unavailableReason:cache.error??(cache.sample?null:'当前生成尚未返回有效 token 数或耗时。'),...cache.sample,...cache.history.snapshot(now)});
      }
      for(const key of caches.keys())if(!kept.has(key))caches.delete(key);
      process.stdout.write(JSON.stringify({threads,error:null})+'\n');
    }catch{process.stdout.write(JSON.stringify({threads:[],error:'Antigravity 本地状态暂不可用，请确认已打开并登录。'})+'\n');}
    finally{busy=false;}
  }
  process.stdin.resume();process.stdin.once('end',()=>process.exit(0));process.on('SIGTERM',()=>process.exit(0));
  void tick();setInterval(()=>void tick(),3000);
}
