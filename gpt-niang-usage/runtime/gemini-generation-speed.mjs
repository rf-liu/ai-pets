import os from 'node:os';
import path from 'node:path';
import {callRPC} from './gemini-usage.mjs';
import {latestGenerationIndex,generationStepTimes} from './gemini-generation-index.mjs';
import {stepGenerationTime} from './gemini-step-time.mjs';
import {openReadOnlySqlite,resolveSafeDbPath} from './gemini-usage-stats.mjs';
import {RecentSpeedSamples,RECENT_WINDOW_MS} from './recent-speed.mjs';

export const DEFAULT_CONVERSATION_ROOTS=[
  path.join(os.homedir(),'.gemini','antigravity','conversations'),
  path.join(os.homedir(),'.gemini','antigravity-cli','conversations')
];

function readVarint(bytes,offset,end){
  let value=0n,shift=0n;
  for(let i=0;i<10;i++){
    if(offset>=end)throw new Error('Truncated varint');
    const byte=bytes[offset++];
    value|=BigInt(byte&127)<<shift;
    if(!(byte&128))return [value,offset];
    shift+=7n;
  }
  throw new Error('Invalid varint');
}
function skipWire(bytes,wire,offset,end){
  if(wire===0){const [,next]=readVarint(bytes,offset,end);return next;}
  if(wire===1){if(offset+8>end)throw new Error('Truncated fixed64');return offset+8;}
  if(wire===5){if(offset+4>end)throw new Error('Truncated fixed32');return offset+4;}
  if(wire===2){
    const [len,after]=readVarint(bytes,offset,end);
    const next=after+Number(len);
    if(len<0n||next>end)throw new Error('Truncated bytes');
    return next;
  }
  throw new Error('Unsupported wire type');
}
function decodeDurationMsg(bytes,start,end){
  let offset=start,seconds=0,nanos=0,seen=false;
  while(offset<end){
    const [tag,after]=readVarint(bytes,offset,end);
    const field=Number(tag>>3n),wire=Number(tag&7n);
    if(!field)return null;
    if(wire===0&&(field===1||field===2)){
      const [val,next]=readVarint(bytes,after,end);offset=next;
      if(val<0n||val>BigInt(Number.MAX_SAFE_INTEGER))return null;
      if(field===1)seconds=Number(val);else nanos=Number(val);
      seen=true;
    }else offset=skipWire(bytes,wire,after,end);
  }
  return seen?{seconds,nanos}:null;
}
function decodeUsageMsg(bytes,start,end){
  let offset=start;
  const usage={};
  while(offset<end){
    const [tag,after]=readVarint(bytes,offset,end);
    const field=Number(tag>>3n),wire=Number(tag&7n);
    if(!field)return null;
    if(wire===0&&[1,3,9,10].includes(field)){
      const [val,next]=readVarint(bytes,after,end);offset=next;
      if(val<0n||val>BigInt(Number.MAX_SAFE_INTEGER))return null;
      const n=Number(val);
      if(field===1)usage.model=String(n);
      else if(field===3)usage.outputTokens=n;
      else if(field===9)usage.responseOutputTokens=n;
      else if(field===10)usage.thinkingOutputTokens=n;
    }else offset=skipWire(bytes,wire,after,end);
  }
  return Object.keys(usage).length?usage:null;
}

// Zero-copy protobuf parser for local gen_metadata.data speed records; skips prompt/message blobs.
export function parseGenSpeedBlob(rawBytes){
  if(!rawBytes||!rawBytes.length)return null;
  const bytes=Buffer.isBuffer(rawBytes)?rawBytes:Buffer.from(rawBytes.buffer,rawBytes.byteOffset,rawBytes.byteLength);
  try{
    let offset=0;const end=bytes.length;
    const stepIndices=[];
    const chatModel={};
    let hasChat=false;
    while(offset<end){
      const [tag,after]=readVarint(bytes,offset,end);
      const field=Number(tag>>3n),wire=Number(tag&7n);
      if(!field)return null;
      if(field===2&&wire===2){
        const [len,s]=readVarint(bytes,after,end);
        const e=s+Number(len);if(e>end)return null;
        let p=s;
        while(p<e){
          const [idx,np]=readVarint(bytes,p,e);p=np;
          if(idx>=0n&&idx<=BigInt(Number.MAX_SAFE_INTEGER))stepIndices.push(Number(idx));
        }
        offset=e;
      }else if(field===2&&wire===0){
        const [val,next]=readVarint(bytes,after,end);offset=next;
        if(val>=0n&&val<=BigInt(Number.MAX_SAFE_INTEGER))stepIndices.push(Number(val));
      }else if(field===1&&wire===2){
        const [len,cs]=readVarint(bytes,after,end);
        const ce=cs+Number(len);if(ce>end)return null;
        hasChat=true;
        let co=cs;
        while(co<ce){
          const [ctag,cafter]=readVarint(bytes,co,ce);
          const cf=Number(ctag>>3n),cw=Number(ctag&7n);
          if(!cf)return null;
          if(cf===4&&cw===2){
            const [ulen,us]=readVarint(bytes,cafter,ce);
            const ue=us+Number(ulen);if(ue>ce)return null;
            const u=decodeUsageMsg(bytes,us,ue);
            if(u)chatModel.usage=u;
            co=ue;
          }else if((cf===11||cf===12)&&cw===2){
            const [dlen,ds]=readVarint(bytes,cafter,ce);
            const de=ds+Number(dlen);if(de>ce)return null;
            const dur=decodeDurationMsg(bytes,ds,de);
            if(dur){
              if(cf===11)chatModel.timeToFirstToken=dur;else chatModel.streamingDuration=dur;
            }
            co=de;
          }else if((cf===19||cf===21)&&cw===2){
            const [slen,ss]=readVarint(bytes,cafter,ce);
            const se=ss+Number(slen);if(se>ce)return null;
            if(slen<=256n){
              const text=bytes.toString('utf8',ss,se);
              if(cf===19)chatModel.responseModel=text;else chatModel.modelDisplayName=text;
            }
            co=se;
          }else co=skipWire(bytes,cw,cafter,ce);
        }
        offset=ce;
      }else offset=skipWire(bytes,wire,after,end);
    }
    return hasChat?{stepIndices,chatModel}:null;
  }catch{return null;}
}

export function readLocalGenerationSpeed(id,{roots=DEFAULT_CONVERSATION_ROOTS,history=new RecentSpeedSamples(),now=Date.now()}={}){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  let file=null;
  for(const root of roots){
    file=resolveSafeDbPath(root,id);
    if(file)break;
  }
  if(!file)throw new Error('session database not found');
  let db;
  try{
    db=openReadOnlySqlite(file);
    const maxRow=db.prepare('SELECT MAX(idx) AS lastIndex FROM gen_metadata').get();
    const lastIndex=counter(maxRow?.lastIndex);
    if(lastIndex===null)return null;
    const offset=Math.max(0,lastIndex-255);
    const stmt=db.prepare('SELECT idx, data FROM gen_metadata WHERE idx >= ? ORDER BY idx');
    const records=[];
    const stepIndices=[];
    for(const row of stmt.iterate(offset)){
      if(!row?.data)continue;
      const parsed=parseGenSpeedBlob(row.data);
      if(!parsed)continue;
      records.push(parsed);
      for(const s of parsed.stepIndices)stepIndices.push(s);
    }
    const stepTimes=new Map();
    const unique=[...new Set(stepIndices.filter(x=>Number.isSafeInteger(x)&&x>=0))].slice(-2048);
    for(let start=0;start<unique.length;start+=500){
      const chunk=unique.slice(start,start+500);
      const rows=db.prepare(`SELECT idx, metadata FROM steps WHERE idx IN (${chunk.join(',')}) AND metadata IS NOT NULL AND length(metadata) <= 65536`).all();
      for(const row of rows){
        if(!Number.isSafeInteger(row.idx)||!row.metadata)continue;
        const buf=Buffer.isBuffer(row.metadata)?row.metadata:Buffer.from(row.metadata.buffer,row.metadata.byteOffset,row.metadata.byteLength);
        const ts=stepGenerationTime(buf);
        if(Number.isFinite(ts))stepTimes.set(row.idx,ts);
      }
    }
    return latestGeneration({generatorMetadata:records},{history,now,offset,stepTimes});
  }finally{
    try{db?.close();}catch{}
  }
}

export function durationSeconds(value){
  if(typeof value==='string'){
    if(!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?s$/.test(value))return null;
    const seconds=Number(value.slice(0,-1));
    return Number.isFinite(seconds)?seconds:null;
  }
  if(value&&typeof value==='object'){
    const seconds=counter(value.seconds??0),nanos=counter(value.nanos??0);
    return seconds!==null&&nanos!==null&&nanos<1e9?seconds+nanos/1e9:null;
  }
  return null;
}
function counter(value){
  if(typeof value==='string'&&!/^(?:0|[1-9]\d*)$/.test(value))return null;
  if(typeof value!=='string'&&typeof value!=='number')return null;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0?number:null;
}

export function generationSample(record,{stepTimes=new Map()}={}){
  const chat=record?.chatModel,usage=chat?.usage;
  if(!usage)return null;
  const total=counter(usage.outputTokens),response=counter(usage.responseOutputTokens),thinking=counter(usage.thinkingOutputTokens);
  for(const key of ['outputTokens','responseOutputTokens','thinkingOutputTokens'])if(usage[key]!==undefined&&counter(usage[key])===null)return null;
  if(total!==null&&response!==null&&thinking!==null&&total!==response+thinking)return null;
  const output=total??(response!==null&&thinking!==null?response+thinking:null);
  const first=durationSeconds(chat.timeToFirstToken),stream=durationSeconds(chat.streamingDuration);
  if(output===null||first===null||stream===null||first+stream<=0)return null;
  const seconds=first+stream,rate=output/seconds;
  if(!Number.isFinite(rate))return null;
  let sampleAt=null;
  for(const index of Array.isArray(record.stepIndices)?record.stepIndices:[]){
    const value=stepTimes.get(index);
    if(Number.isFinite(value)&&(sampleAt===null||value>sampleAt))sampleAt=value;
  }
  return {tokensPerSecond:rate,outputTokens:output,intervalSeconds:seconds,
    timeToFirstTokenSeconds:first,streamingSeconds:stream,
    responseOutputTokens:response,thinkingOutputTokens:thinking,
    modelName:String(chat.modelDisplayName||chat.responseModel||usage.model||'').slice(0,100),
    measurement:'generation-average',sampleAt,timeSource:sampleAt===null?null:'step-finished-generating-at'};
}

export function latestGeneration(raw,{history=new RecentSpeedSamples(),now=Date.now(),offset=0,stepTimes=new Map()}={}){
  const records=(raw?.response??raw)?.generatorMetadata;
  if(!Array.isArray(records))throw new Error('Missing generation metadata');
  let latest=null,oldest=Infinity;
  for(let i=0;i<records.length;i++){
    const sample=generationSample(records[i],{stepTimes});
    if(!sample)continue;
    latest=sample;
    if(Number.isFinite(sample.sampleAt))oldest=Math.min(oldest,sample.sampleAt);
    history.add(offset+i,sample);
  }
  history.partial=offset>0&&oldest>now-RECENT_WINDOW_MS;
  return latest?{...latest,...history.snapshot(now)}:null;
}

export async function readGenerationSpeed(id,{rpc=callRPC,index=latestGenerationIndex,readTimes=generationStepTimes,roots=DEFAULT_CONVERSATION_ROOTS,preferLocal=false,history=new RecentSpeedSamples(),now=Date.now()}={}){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  if(preferLocal)return readLocalGenerationSpeed(id,{roots,history,now});
  try{
    let offset=0;
    // Metadata only: bounded history for smoothing, never conversation messages.
    try{const value=await index(id);if(Number.isSafeInteger(value)&&value>=0)offset=Math.max(0,value-255);}catch{}
    const raw=await rpc('GetCascadeTrajectoryGeneratorMetadata',{cascadeId:id,generatorMetadataOffset:offset,includeMessages:false});
    const records=(raw?.response??raw)?.generatorMetadata;
    let stepTimes=new Map();
    try{stepTimes=await readTimes(id,Array.isArray(records)?records.flatMap(record=>record.stepIndices??[]):[]);}catch{}
    return latestGeneration(raw,{history,now,offset,stepTimes});
  }catch(error){
    try{return readLocalGenerationSpeed(id,{roots,history,now});}catch{throw error;}
  }
}
