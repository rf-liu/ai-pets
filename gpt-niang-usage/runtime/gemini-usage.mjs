import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import https from 'node:https';
import {createHash} from 'node:crypto';
export {atomicJson} from './usage.mjs';

const execute=promisify(execFile);
const service='/exa.language_server_pb.LanguageServerService/';
const methods=new Set(['RetrieveUserQuotaSummary','GetUserStatus','GetAllCascadeTrajectories','GetCascadeTrajectoryGeneratorMetadata']);
const metadata={ideName:'antigravity',extensionName:'antigravity',ideVersion:'2.29.0',locale:'en'};
let cached=null,primedSummary=null;
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const flag=(command,name)=>{
  const match=command.match(new RegExp('(?:^|\\s)'+name+'(?:=|\\s+)(?:"([^"\\n]+)"|([^\\s]+))'));
  return match?.[1]??match?.[2]??null;
};
export async function discoverCandidates() {
  const {stdout}=await execute('/bin/ps',['-ax','-o','uid=,pid=,command='],{timeout:2500,maxBuffer:4*1024*1024});
  const candidates=[];
  for(const line of stdout.split('\n')){
    const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if(!match||Number(match[1])!==process.getuid())continue;
    const command=match[3];
    if(!/^\S*\/Antigravity\.app\/Contents\/Resources\/bin\/language_server(?:\s|$)/.test(command))continue;
    const token=flag(command,'--csrf_token');
    if(!token)continue;
    const pid=Number(match[2]);
    let sockets='';
    try{sockets=(await execute('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-iTCP','-sTCP:LISTEN','-F','n'],{timeout:2500,maxBuffer:512*1024})).stdout;}catch{}
    const values=[flag(command,'--https_server_port'),...Array.from(sockets.matchAll(/:(\d+)$/gm),m=>m[1])];
    const ports=[...new Set(values.map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=65535))].slice(0,12);
    if(ports.length)candidates.push({pid,token,ports});
  }
  return candidates;
}
function request(connection,method,payload={}) {
  if(!methods.has(method))return Promise.reject(new Error('Unsupported read-only RPC'));
  return new Promise((resolve,reject)=>{
    let total=0,parts=[];
    const task=https.request({hostname:'127.0.0.1',port:connection.port,path:service+method,method:'POST',
      // The app owns a self-signed loopback service. No global TLS setting changes.
      rejectUnauthorized:false,timeout:3500,headers:{'Content-Type':'application/json','Connect-Protocol-Version':'1','X-Codeium-Csrf-Token':connection.token}},response=>{
      if(response.statusCode!==200){response.resume();reject(new Error('Local quota endpoint unavailable'));return;}
      response.on('data',part=>{total+=part.length;if(total>4*1024*1024){task.destroy();reject(new Error('Local response too large'));return;}parts.push(part);});
      response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(new Error('Invalid local response'));}});
      response.on('error',reject);
    });
    task.on('timeout',()=>task.destroy(new Error('Local API timeout')));task.on('error',reject);
    task.end(JSON.stringify({metadata,...payload}));
  });
}
async function connection() {
  if(cached&&alive(cached.pid))return cached;
  cached=null;primedSummary=null;
  for(const candidate of await discoverCandidates()){
    for(const port of candidate.ports){
      const attempt={pid:candidate.pid,token:candidate.token,port};
      try{
        const data=await request(attempt,'RetrieveUserQuotaSummary');
        if(!Array.isArray((data.response??data).groups))continue;
        cached=attempt;primedSummary=data;return attempt;
      }catch{}
    }
  }
  throw new Error('Antigravity local quota service not ready');
}
export async function callRPC(method,payload={}) {
  try{return await request(await connection(),method,payload);}
  catch(error){cached=null;primedSummary=null;throw error;}
}
export function normalizeSummary(raw,{accountKey=null,planLabel=null,now=Date.now()}={}) {
  const data=raw?.response??raw;
  if(!Array.isArray(data?.groups))return {ok:false,queryOk:false,source:'antigravity-local',observedAt:now,windows:[],accountKey,clearPrevious:true,error:'Antigravity 未返回有效额度数据'};
  const groups=data.groups.filter(group=>/gemini/i.test(String(group.displayName??'')));
  const windows=[];let invalid=false;
  for(const group of groups)for(const bucket of group.buckets??[]){
    const cadence=String(bucket.window??'').toLowerCase();
    const minutes=cadence==='5h'||/gemini-5h/.test(bucket.bucketId??'')?300:cadence==='weekly'||/gemini-weekly/.test(bucket.bucketId??'')?10080:null;
    const fraction=bucket.remainingFraction??bucket.remaining?.remainingFraction;
    if(!minutes)continue;
    if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<0||fraction>1){invalid=true;continue;}
    const reset=typeof bucket.resetTime==='string'?Date.parse(bucket.resetTime)/1000:null;
    windows.push({label:minutes===300?'5 小时':'每周',minutes,remaining:fraction*100,used:100-fraction*100,resetsAt:Number.isFinite(reset)?reset:null});
  }
  windows.sort((a,b)=>a.minutes-b.minutes);
  return {ok:windows.length>0,queryOk:windows.length>0&&!invalid,source:'antigravity-local',observedAt:now,windows,accountKey,clearPrevious:!accountKey,
    plan:'antigravity',planLabel:planLabel||'Antigravity',planKnown:Boolean(planLabel),planSource:'app-local',authType:'antigravity-local',
    ...(windows.length===0?{error:'当前 Antigravity 账户未提供可显示的 Gemini 额度窗口'}:{})};
}
export async function readUsage(_unused,{onAccount=()=>{}}={}) {
  try{
    const selected=await connection();
    const summary=primedSummary??await request(selected,'RetrieveUserQuotaSummary');primedSummary=null;
    const user=(await request(selected,'GetUserStatus')).userStatus??{};
    const accountKey=typeof user.email==='string'&&user.email.trim()?createHash('sha256').update('antigravity:'+user.email.trim().toLowerCase()).digest('hex'):null;
    onAccount(accountKey);
    return normalizeSummary(summary,{accountKey,planLabel:user.planStatus?.planInfo?.planName});
  }catch{cached=null;primedSummary=null;return {ok:false,queryOk:false,source:'antigravity-local',observedAt:Date.now(),windows:[],accountKey:null,clearPrevious:true,error:'Antigravity 本地额度暂不可用，请确认已打开并登录 Antigravity。'};}
}
// Interface-compatible with the existing, tested writer/refresh queue.
export const resolveCodexExecutable=value=>value;

export async function trajectorySummaries() {
  const response=await callRPC('GetAllCascadeTrajectories');
  return Object.entries(response.trajectorySummaries??{}).map(([id,value])=>({
    id,title:String(value.summary??value.annotations?.title??'').split('\n')[0].slice(0,120),status:String(value.status??''),lastModified:Date.parse(value.lastModifiedTime??''),stepCount:Number(value.stepCount??0),
    reason:String(value.latestExecutorTerminationReason??''),depth:Number(value.trajectoryMetadata?.nestingDepth??0)
  }));
}
