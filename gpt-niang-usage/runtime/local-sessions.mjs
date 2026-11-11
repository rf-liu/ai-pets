import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {estimateMessageCost} from './deepseek-cost.mjs';
const caches=new Map();
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const at=x=>typeof x==='number'?x:Date.parse(x??'');
function files(root,depth=4){
 if(depth<0)return [];
 try{return fs.readdirSync(root,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(root,x.name),depth-1):x.isFile()?[path.join(root,x.name)]:[]);}catch{return [];}
}
function rowID(profile,id){return createHash('sha256').update(profile+':'+id).digest('hex').slice(0,24);}

export class ClaudeTurnParser {
 constructor(){this.active=null;this.latest=null;this.rejection=null;this.lastAt=null;}
 accept(record){
  const time=at(record?.timestamp);if(!Number.isFinite(time)||record.isSidechain)return;
  this.lastAt=time;
  if(record.quotaLimits?.status==='rejected'&&record.quotaLimits.rateLimitType==='five_hour'&&number(record.quotaLimits.resetsAt))this.rejection={capturedAt:time,rateLimits:[{kind:'five_hour',percentUsed:100,resetsAt:record.quotaLimits.resetsAt}]};
  if(record.type==='user'&&!record.isMeta&&!record.isCompactSummary){
   const content=record.message?.content;
   if(typeof content==='string'||Array.isArray(content)&&!content.some(x=>x.type==='tool_result')&&content.some(x=>['text','image'].includes(x.type)))this.active={start:time,messages:new Map()};
  }
  if(record.type!=='assistant'||!this.active||record.isApiErrorMessage)return;
  const message=record.message,usage=message?.usage;
  if(!message?.id||!number(usage?.output_tokens)||String(message.model??'').startsWith('<synthetic'))return;
  this.active.messages.set(message.id,{output:usage.output_tokens,thinking:number(usage.output_tokens_details?.thinking_tokens)?usage.output_tokens_details.thinking_tokens:null,model:message.model,effort:record.perTurnEffort});
  if(message.stop_reason!=='end_turn')return;
  const values=[...this.active.messages.values()],output=values.reduce((s,x)=>s+x.output,0),seconds=(time-this.active.start)/1000;
  if(seconds<=0)return;
  const models=[...new Set(values.map(x=>String(x.model??'Claude')+(typeof x.effort==='string'?' · '+x.effort:'')))];
  const known=values.every(x=>x.thinking!==null),thinking=known?values.reduce((s,x)=>s+x.thinking,0):null;
  if(thinking!==null&&thinking>output)return;
  this.latest={tokensPerSecond:output/seconds,outputTokens:output,reasoningOutputTokens:thinking,responseOutputTokens:thinking===null?null:output-thinking,intervalSeconds:seconds,sampleAt:time,measurement:'request-average',modelName:models.length===1?models[0]:'混合模型 / 思考档'};
  this.active=null;
 }
}
class ClaudeTail {
 constructor(file){this.file=file;this.offset=0;this.identity=null;this.pending='';this.parser=new ClaudeTurnParser();}
 update(){
  const s=fs.statSync(this.file);
  if(this.identity!==s.ino||s.size<this.offset){this.identity=s.ino;this.offset=Math.max(0,s.size-8*1024*1024);this.pending='';this.parser=new ClaudeTurnParser();this.skip=this.offset>0;}
  const count=Math.min(s.size-this.offset,8*1024*1024);if(count<=0)return this.parser;
  const buffer=Buffer.alloc(count),fd=fs.openSync(this.file,'r');let read;try{read=fs.readSync(fd,buffer,0,count,this.offset);}finally{fs.closeSync(fd);}this.offset+=read;
  const lines=(this.pending+buffer.subarray(0,read).toString('utf8')).split('\n');this.pending=lines.pop();if(this.pending.length>1024*1024){this.pending='';this.skip=true;}
  if(this.skip&&lines.length){lines.shift();this.skip=false;}
  for(const line of lines){if(line.length>1024*1024||!/^\{/.test(line))continue;try{this.parser.accept(JSON.parse(line));}catch{}}
  return this.parser;
 }
}
export function readClaudeSessions(){
 const root=path.join(os.homedir(),'Library/Application Support/Claude/claude-code-sessions');
 const metadata=files(root,3).filter(x=>path.basename(x).startsWith('local_')&&x.endsWith('.json')).map(file=>{try{const data=JSON.parse(fs.readFileSync(file,'utf8'));return {...data,_file:file};}catch{return null;}}).filter(x=>x&&!x.isArchived&&x.cliSessionId).sort((a,b)=>(at(b.lastActivityAt)||0)-(at(a.lastActivityAt)||0)).slice(0,12);
 const lookup=new Map(files(path.join(os.homedir(),'.claude/projects'),1).filter(x=>x.endsWith('.jsonl')).map(x=>[path.basename(x,'.jsonl'),x]));
 return metadata.map(meta=>{
  const row={id:rowID('claude',meta.cliSessionId),title:String(meta.title||'Claude Code 对话').slice(0,160),state:'idle',tokensPerSecond:null,modelName:typeof meta.model==='string'?meta.model:'Claude',sampleAt:null,outputTokens:null,intervalSeconds:null};
  const file=lookup.get(meta.cliSessionId);if(!file)return {...row,unavailableReason:'该 Code 对话尚无可读取的本地 token 记录。'};
  try{
   const key='claude:'+file;if(!caches.has(key))caches.set(key,new ClaudeTail(file));const parsed=caches.get(key).update();
   return {...row,...parsed.latest,_rejection:parsed.rejection,state:parsed.active&&(!parsed.latest||parsed.lastAt>parsed.latest.sampleAt)&&Date.now()-parsed.lastAt<300000?'running':'idle',unavailableReason:parsed.latest?null:'等待一轮 Code 回复完成并返回有效计数。'};
  }catch{return {...row,unavailableReason:'本地 Code 记录正在同步，请稍后。'};}
 });
}

export class DshTurnParser {
 constructor(){this.active=null;this.latest=null;this.title=null;this.id=null;this.depth=0;this.lastAt=null;this.costRecords=[];}
 accept(event){
  if(event?.type==='session'){this.id=event.id;this.depth=event.delegationDepth??0;return;}
  const time=event?.time;if(!number(time))return;this.lastAt=time;const data=event.data??{};
  if(event.type==='session/title')this.title=typeof data.title==='string'?data.title:this.title;
  if(event.type==='turn/start')this.active={turn:data.turn,start:time,output:0,cost:0,costKnown:true,models:new Set(),seen:new Set()};
  if(event.type==='assistant/message'&&this.active&&data.turn===this.active.turn){
   const key=data.turn+':'+data.step;if(this.active.seen.has(key))return;this.active.seen.add(key);
   if(!number(data.usage?.outputTokens)){this.active.invalid=true;return;}
   this.active.output+=data.usage.outputTokens;const model=data.message?.source?.model;if(typeof model==='string')this.active.models.add(model);
   const cost=data.message?.source?.provider==='deepseek-account'?estimateMessageCost(data.usage,model,time):null;
   if(cost===null)this.active.costKnown=false;else this.active.cost+=cost;
  }
  if(event.type==='turn/end'&&this.active&&data.turn===this.active.turn){
   const turn=this.active;this.active=null;const seconds=(time-turn.start)/1000;
   const estimatedCost=!turn.invalid&&turn.seen.size&&turn.costKnown?Math.round(turn.cost*1e8)/1e8:null;
   this.costRecords.push({turn:turn.turn,at:time,cost:estimatedCost});
   if(data.reason?.kind!=='completed'||turn.invalid||!turn.seen.size||seconds<=0)return;
   this.latest={tokensPerSecond:turn.output/seconds,outputTokens:turn.output,intervalSeconds:seconds,sampleAt:time,estimatedCost,costCurrency:'CNY',measurement:'request-average',modelName:turn.models.size===1?[...turn.models][0]:turn.models.size?'混合模型':'DeepSeek Harness'};
  }
 }
}
export function readDshSessions(){
 const root=path.join(os.homedir(),'.dsh/sessions'),paths=files(root,4).filter(x=>x.endsWith('.jsonl')||x.endsWith('.jsonl.zstd')).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs).slice(0,24);const rows=[],ids=new Set();
 for(const file of paths){
  try{
   const stat=fs.statSync(file),key='dsh:'+file,prior=caches.get(key);let parser=prior?.parser;
   if(!prior||prior.mtime!==stat.mtimeMs||prior.size!==stat.size){
    let text;
    if(file.endsWith('.zstd')){const binary=['/opt/homebrew/bin/zstd','/usr/local/bin/zstd'].find(fs.existsSync);if(!binary)continue;const result=spawnSync(binary,['-q','-dc',file],{encoding:'utf8',timeout:4000,maxBuffer:64*1024*1024});if(result.status!==0)continue;text=result.stdout;}
    else {if(stat.size>64*1024*1024)continue;text=fs.readFileSync(file,'utf8');}
    parser=new DshTurnParser();for(const line of text.split('\n')){if(!line||line.length>2*1024*1024)continue;try{parser.accept(JSON.parse(line));}catch{}}
    caches.set(key,{mtime:stat.mtimeMs,size:stat.size,parser});
   }
   if(!parser?.id||parser.depth>0||ids.has(parser.id))continue;ids.add(parser.id);
   rows.push({id:rowID('dsh',parser.id),title:String(parser.title||'DeepSeek Harness 对话').slice(0,160),state:parser.active&&Date.now()-parser.lastAt<300000?'running':'idle',tokensPerSecond:null,sampleAt:null,outputTokens:null,intervalSeconds:null,...parser.latest,_costRecords:parser.costRecords,unavailableReason:parser.latest?null:'等待一轮 Harness 回复完成并返回有效计数。'});
  }catch{}
 }
 return rows.sort((a,b)=>(b.sampleAt??0)-(a.sampleAt??0)).slice(0,12);
}
export function readLocalSessions(profile){return profile==='claude'?readClaudeSessions():readDshSessions();}
