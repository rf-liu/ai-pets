import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {callRPC,trajectorySummaries} from './gemini-usage.mjs';
import {stepMetadata} from './gemini-step-time.mjs';
import {readJson} from './worker-state.mjs';
import {atomicCompactJson,canonicalizeModel,computeTokenCost,ensurePricing,lookupModelPrice} from './model-pricing.mjs';

export const USAGE_SCAN_INTERVAL_MS=60*60*1000;
export const USAGE_STATS_FILENAME='usage-stats.json';
export const USAGE_CACHE_FILENAME='usage-stats-cache.json';
export const USAGE_DISCLAIMER='Antigravity 为订阅制，金额按官方 API 公开单价折算，非实际扣费。';
const UUID_RE=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ABOVE_200K_THRESHOLD=200000;
const MAX_RPC_PAGES=64;
const RPC_CONTINUE_THRESHOLD=100;

// Compact tuple layout per (day, modelId):
// [0:in, 1:cr, 2:cw, 3:out, 4:respOut, 5:thinkOut, 6:in200k, 7:cr200k, 8:cw200k, 9:out200k, 10:calls]
const TUPLE_LEN=11;

export function localDateKey(ms){
  const date=new Date(ms);
  if(!Number.isFinite(date.getTime()))return null;
  const y=String(date.getFullYear()).padStart(4,'0');
  const m=String(date.getMonth()+1).padStart(2,'0');
  const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

export function recentDateKeys(now=Date.now(),days=7){
  const anchor=new Date(now);
  const y=anchor.getFullYear(),m=anchor.getMonth(),d=anchor.getDate();
  const keys=[];
  for(let i=0;i<days;i++){
    const date=new Date(y,m,d-i);
    keys.push(localDateKey(date.getTime()));
  }
  return keys;
}

export function startOfWindowMs(now=Date.now(),days=7){
  const anchor=new Date(now);
  return new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()-(days-1),0,0,0,0).getTime();
}

function safeCounter(value){
  if(typeof value==='bigint'){
    if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))return null;
    return Number(value);
  }
  if(typeof value==='string'){
    if(!/^(?:0|[1-9]\d*)$/.test(value))return null;
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=0?n:null;
  }
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?value:null;
  return null;
}

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

function parseUsageSubmessage(bytes,start,end){
  let offset=start;
  let modelEnum=null,inputTokens=0,outputTokens=0,cacheWriteTokens=0,cacheReadTokens=0,responseOutputTokens=0,thinkingOutputTokens=0;
  let hasOutputField=false;
  while(offset<end){
    const [tag,afterTag]=readVarint(bytes,offset,end);
    const field=Number(tag>>3n),wire=Number(tag&7n);
    if(!field)throw new Error('Invalid usage tag');
    if(wire===0){
      const [val,next]=readVarint(bytes,afterTag,end);offset=next;
      const n=safeCounter(val);
      if(n===null)continue;
      if(field===1)modelEnum=n;
      else if(field===2)inputTokens=n;
      else if(field===3){outputTokens=n;hasOutputField=true;}
      else if(field===4)cacheWriteTokens=n;
      else if(field===5)cacheReadTokens=n;
      else if(field===9)responseOutputTokens=n;
      else if(field===10)thinkingOutputTokens=n;
    }else{
      offset=skipWire(bytes,wire,afterTag,end);
    }
  }
  if(!hasOutputField&&(responseOutputTokens>0||thinkingOutputTokens>0)){
    outputTokens=responseOutputTokens+thinkingOutputTokens;
  }
  return {modelEnum,inputTokens,outputTokens,cacheWriteTokens,cacheReadTokens,responseOutputTokens,thinkingOutputTokens};
}

// Zero-copy protobuf scanner for gen_metadata.data: reads only stepIndices,
// chatModel.usage and model identifiers; skips prompt/message blobs in O(1).
export function parseGenMetadataBlob(rawBytes){
  if(!rawBytes||!rawBytes.length)return null;
  const bytes=Buffer.isBuffer(rawBytes)?rawBytes:Buffer.from(rawBytes.buffer,rawBytes.byteOffset,rawBytes.byteLength);
  try{
    let offset=0;
    const end=bytes.length;
    const stepIndices=[];
    let usage=null,chatModelEnum=null,responseModel='',modelDisplayName='';
    while(offset<end){
      const [tag,afterTag]=readVarint(bytes,offset,end);
      const field=Number(tag>>3n),wire=Number(tag&7n);
      if(!field)return null;
      if(field===2&&wire===2){
        const [len,s]=readVarint(bytes,afterTag,end);
        const e=s+Number(len);if(e>end)return null;
        let p=s;
        while(p<e){
          const [idx,np]=readVarint(bytes,p,e);p=np;
          const n=safeCounter(idx);if(n!==null)stepIndices.push(n);
        }
        offset=e;
      }else if(field===2&&wire===0){
        const [val,next]=readVarint(bytes,afterTag,end);offset=next;
        const n=safeCounter(val);if(n!==null)stepIndices.push(n);
      }else if(field===1&&wire===2){
        const [len,cs]=readVarint(bytes,afterTag,end);
        const ce=cs+Number(len);if(ce>end)return null;
        let co=cs;
        while(co<ce){
          const [ctag,cafter]=readVarint(bytes,co,ce);
          const cf=Number(ctag>>3n),cw=Number(ctag&7n);
          if(!cf)return null;
          if(cf===3&&cw===0){
            const [val,next]=readVarint(bytes,cafter,ce);co=next;
            chatModelEnum=safeCounter(val);
          }else if(cf===4&&cw===2){
            const [ulen,us]=readVarint(bytes,cafter,ce);
            const ue=us+Number(ulen);if(ue>ce)return null;
            usage=parseUsageSubmessage(bytes,us,ue);
            co=ue;
          }else if((cf===19||cf===21)&&cw===2){
            const [slen,ss]=readVarint(bytes,cafter,ce);
            const se=ss+Number(slen);if(se>ce)return null;
            if(slen<=256n){
              const text=bytes.toString('utf8',ss,se);
              if(cf===19)responseModel=text;else modelDisplayName=text;
            }
            co=se;
          }else{
            co=skipWire(bytes,cw,cafter,ce);
          }
        }
        offset=ce;
      }else{
        offset=skipWire(bytes,wire,afterTag,end);
      }
    }
    if(!usage)return null;
    const totalTokens=usage.inputTokens+usage.cacheReadTokens+usage.cacheWriteTokens+usage.outputTokens;
    if(totalTokens<=0)return null;
    const {modelId,displayName}=canonicalizeModel(responseModel,modelDisplayName,usage.modelEnum??chatModelEnum);
    return {
      stepIndices,
      modelId,
      displayName,
      inputTokens:usage.inputTokens,
      cacheReadTokens:usage.cacheReadTokens,
      cacheWriteTokens:usage.cacheWriteTokens,
      outputTokens:usage.outputTokens,
      responseOutputTokens:usage.responseOutputTokens,
      thinkingOutputTokens:usage.thinkingOutputTokens
    };
  }catch{
    return null;
  }
}

export function parseRpcGenRecord(record){
  const chat=record?.chatModel;
  const usage=chat?.usage;
  if(!usage||typeof usage!=='object')return null;
  const inputTokens=safeCounter(usage.inputTokens??usage.promptTokens??0)??0;
  const cacheReadTokens=safeCounter(usage.cacheReadTokens??usage.cachedInputTokens??usage.cacheReadInputTokens??0)??0;
  const cacheWriteTokens=safeCounter(usage.cacheWriteTokens??usage.cacheCreationTokens??usage.cacheCreationInputTokens??0)??0;
  const responseOutputTokens=safeCounter(usage.responseOutputTokens??0)??0;
  const thinkingOutputTokens=safeCounter(usage.thinkingOutputTokens??0)??0;
  const rawOutput=usage.outputTokens!==undefined?safeCounter(usage.outputTokens):null;
  const outputTokens=rawOutput!==null?rawOutput:(responseOutputTokens+thinkingOutputTokens);
  const totalTokens=inputTokens+cacheReadTokens+cacheWriteTokens+outputTokens;
  if(totalTokens<=0)return null;
  const stepIndices=Array.isArray(record.stepIndices)?record.stepIndices.map(safeCounter).filter(x=>x!==null):[];
  const {modelId,displayName}=canonicalizeModel(chat.responseModel,chat.modelDisplayName,usage.model??chat.model);
  return {
    stepIndices,
    modelId,
    displayName,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    responseOutputTokens,
    thinkingOutputTokens
  };
}

function encodeSqlitePath(filePath){
  return filePath.replace(/%/g,'%25').replace(/\?/g,'%3F').replace(/#/g,'%23');
}

function safeStat(filePath){
  try{return fs.statSync(filePath);}catch{return null;}
}

// Open strictly read-only without ever creating -shm or -wal files on disk.
export function openReadOnlySqlite(realFilePath){
  const walStat=safeStat(realFilePath+'-wal');
  const shmStat=safeStat(realFilePath+'-shm');
  const hasActiveWal=Boolean(walStat&&walStat.size>0&&shmStat);
  const uri=hasActiveWal
    ?`file:${encodeSqlitePath(realFilePath)}?mode=ro`
    :`file:${encodeSqlitePath(realFilePath)}?mode=ro&immutable=1`;
  return new DatabaseSync(uri,{readOnly:true});
}

function queryStepTimesOnDb(db,indices){
  const result=new Map();
  const unique=[...new Set(indices.filter(x=>Number.isSafeInteger(x)&&x>=0))];
  if(!unique.length)return result;
  for(let start=0;start<unique.length;start+=500){
    const chunk=unique.slice(start,start+500);
    const query=`SELECT idx, metadata FROM steps WHERE idx IN (${chunk.join(',')}) AND metadata IS NOT NULL AND length(metadata) <= 65536`;
    const rows=db.prepare(query).all();
    for(const row of rows){
      if(!Number.isSafeInteger(row.idx)||!row.metadata)continue;
      const buf=Buffer.isBuffer(row.metadata)?row.metadata:Buffer.from(row.metadata.buffer,row.metadata.byteOffset,row.metadata.byteLength);
      const meta=stepMetadata(buf);
      const ts=meta?.generatedAt??meta?.completedAt??meta?.createdAt;
      if(Number.isFinite(ts))result.set(row.idx,ts);
    }
  }
  return result;
}

export function resolveSafeDbPath(rootDir,id){
  if(!UUID_RE.test(id))return null;
  try{
    const base=fs.realpathSync(rootDir);
    const file=fs.realpathSync(path.join(base,id+'.db'));
    if(!file.startsWith(base+path.sep))return null;
    return file;
  }catch{
    return null;
  }
}

export function readStepTimesFromConversationDb(rootDir,id,indices){
  const file=resolveSafeDbPath(rootDir,id);
  if(!file)return new Map();
  let db;
  try{
    db=openReadOnlySqlite(file);
    return queryStepTimesOnDb(db,indices);
  }catch{
    return new Map();
  }finally{
    try{db?.close();}catch{}
  }
}

export function readConversationDbIncremental(realFilePath,fromGenIdx=0,{needStepTimes=true}={}){
  let db;
  try{
    db=openReadOnlySqlite(realFilePath);
    const maxRow=db.prepare('SELECT MAX(idx) AS maxIdx FROM gen_metadata').get();
    const maxIdx=safeCounter(maxRow?.maxIdx);
    if(maxIdx===null)return {reset:false,nextGenIdx:0,records:[],stepTimes:new Map()};
    const reset=fromGenIdx>0&&maxIdx<fromGenIdx-1;
    const effectiveFrom=reset?0:fromGenIdx;
    if(effectiveFrom>maxIdx)return {reset:false,nextGenIdx:maxIdx+1,records:[],stepTimes:new Map()};
    const stmt=db.prepare('SELECT idx, data FROM gen_metadata WHERE idx >= ? ORDER BY idx');
    const records=[];
    const stepIndices=[];
    let lastIdx=effectiveFrom-1;
    for(const row of stmt.iterate(effectiveFrom)){
      const idx=safeCounter(row.idx);
      if(idx!==null&&idx>lastIdx)lastIdx=idx;
      if(!row.data)continue;
      const parsed=parseGenMetadataBlob(row.data);
      if(!parsed)continue;
      records.push(parsed);
      if(needStepTimes){
        for(const s of parsed.stepIndices)stepIndices.push(s);
      }
    }
    const stepTimes=needStepTimes&&stepIndices.length?queryStepTimesOnDb(db,stepIndices):new Map();
    return {reset,nextGenIdx:Math.max(effectiveFrom,lastIdx+1),records,stepTimes};
  }finally{
    try{db?.close();}catch{}
  }
}

function emptyTuple(){
  return [0,0,0,0,0,0,0,0,0,0,0];
}

function ensureTuple(value){
  if(Array.isArray(value)&&value.length===TUPLE_LEN)return value.slice();
  return emptyTuple();
}

function updateLabel(labels,modelId,displayName){
  if(!displayName)return;
  const existing=labels[modelId];
  if(!existing||(existing===modelId&&displayName!==modelId)){
    labels[modelId]=displayName;
  }
}

function mergeRecordIntoDays(daysMap,labels,record,dayKey){
  if(!dayKey)return;
  updateLabel(labels,record.modelId,record.displayName);
  if(!daysMap[dayKey])daysMap[dayKey]={};
  const day=daysMap[dayKey];
  const t=day[record.modelId]?ensureTuple(day[record.modelId]):emptyTuple();
  t[0]+=record.inputTokens;
  t[1]+=record.cacheReadTokens;
  t[2]+=record.cacheWriteTokens;
  t[3]+=record.outputTokens;
  t[4]+=record.responseOutputTokens;
  t[5]+=record.thinkingOutputTokens;
  if(record.inputTokens+record.cacheReadTokens+record.cacheWriteTokens>ABOVE_200K_THRESHOLD){
    t[6]+=record.inputTokens;
    t[7]+=record.cacheReadTokens;
    t[8]+=record.cacheWriteTokens;
    t[9]+=record.outputTokens;
  }
  t[10]+=1;
  day[record.modelId]=t;
}

function resolveRecordDayKey(record,stepTimes,fallbackMs){
  let latest=null;
  if(stepTimes&&record.stepIndices.length){
    for(const idx of record.stepIndices){
      const ts=stepTimes.get(idx);
      if(Number.isFinite(ts)&&(latest===null||ts>latest))latest=ts;
    }
  }
  const ts=latest??fallbackMs;
  return Number.isFinite(ts)?localDateKey(ts):null;
}

function buildPeriodSummary(conversations,labels,dayKeySet,pricingModels){
  const merged=new Map();
  for(const conv of Object.values(conversations)){
    if(!conv?.d||typeof conv.d!=='object')continue;
    for(const [dayKey,models] of Object.entries(conv.d)){
      if(!dayKeySet.has(dayKey)||!models||typeof models!=='object')continue;
      for(const [modelId,rawTuple] of Object.entries(models)){
        if(!Array.isArray(rawTuple)||rawTuple.length<TUPLE_LEN)continue;
        let acc=merged.get(modelId);
        if(!acc){acc=emptyTuple();merged.set(modelId,acc);}
        for(let i=0;i<TUPLE_LEN;i++)acc[i]+=Number(rawTuple[i]??0);
      }
    }
  }

  let totalTokens=0,inputTokens=0,cacheReadTokens=0,cacheWriteTokens=0,outputTokens=0,responseOutputTokens=0,thinkingOutputTokens=0,calls=0;
  let knownCostSum=0,pricedModelCount=0,hasUnknownPrice=false;
  const rows=[];

  for(const [modelId,t] of merged.entries()){
    const modelTotal=t[0]+t[1]+t[2]+t[3];
    if(modelTotal<=0)continue;
    const displayName=labels[modelId]||modelId;
    const match=lookupModelPrice(pricingModels,modelId,displayName);
    const {priceKnown,estimatedCostUsd}=computeTokenCost({
      inputTokens:t[0],cacheReadTokens:t[1],cacheWriteTokens:t[2],outputTokens:t[3],
      input200k:t[6],cacheRead200k:t[7],cacheWrite200k:t[8],output200k:t[9]
    },match?.price??null);
    if(priceKnown&&estimatedCostUsd!==null){
      knownCostSum+=estimatedCostUsd;
      pricedModelCount++;
    }else{
      hasUnknownPrice=true;
    }
    totalTokens+=modelTotal;
    inputTokens+=t[0];
    cacheReadTokens+=t[1];
    cacheWriteTokens+=t[2];
    outputTokens+=t[3];
    responseOutputTokens+=t[4];
    thinkingOutputTokens+=t[5];
    calls+=t[10];
    rows.push({
      modelId,
      displayName,
      totalTokens:modelTotal,
      inputTokens:t[0],
      cacheReadTokens:t[1],
      cacheWriteTokens:t[2],
      outputTokens:t[3],
      responseOutputTokens:t[4],
      thinkingOutputTokens:t[5],
      calls:t[10],
      priceKnown,
      estimatedCostUsd
    });
  }

  rows.sort((a,b)=>b.totalTokens-a.totalTokens||b.calls-a.calls||a.modelId.localeCompare(b.modelId));
  const estimatedCostUsd=totalTokens===0?0:(pricedModelCount>0?Number(knownCostSum.toFixed(6)):null);

  return {
    totalTokens,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    responseOutputTokens,
    thinkingOutputTokens,
    calls,
    estimatedCostUsd,
    hasUnknownPrice,
    topModels:rows.slice(0,3),
    models:rows
  };
}

function pruneConversations(conversations,keepKeys,cutoffMs){
  const pruned={};
  let changed=false;
  for(const [id,entry] of Object.entries(conversations)){
    if(!entry||typeof entry!=='object'){changed=true;continue;}
    const nextDays={};
    let hasDay=false;
    for(const [dayKey,models] of Object.entries(entry.d??{})){
      if(keepKeys.has(dayKey)){nextDays[dayKey]=models;hasDay=true;}
      else changed=true;
    }
    if(hasDay||(Number.isFinite(entry.lm)&&entry.lm>=cutoffMs)){
      pruned[id]={...entry,d:nextDays};
    }else{
      changed=true;
    }
  }
  return {pruned,changed};
}

function listUuidDbFiles(rootDir){
  const files=[];
  if(!rootDir)return files;
  let base;
  try{base=fs.realpathSync(rootDir);}catch{return files;}
  let entries;
  try{entries=fs.readdirSync(base);}catch{return files;}
  for(const name of entries){
    if(!name.endsWith('.db'))continue;
    const id=name.slice(0,-3);
    if(!UUID_RE.test(id))continue;
    const full=path.join(base,name);
    let real;
    try{real=fs.realpathSync(full);}catch{continue;}
    if(!real.startsWith(base+path.sep))continue;
    const st=safeStat(real);
    if(!st||!st.isFile())continue;
    const wal=safeStat(real+'-wal');
    const walMtime=wal?.mtimeMs??0;
    const walSize=wal?.size??0;
    const effectiveMtime=Math.max(st.mtimeMs,walMtime);
    const fp=`${Math.trunc(st.mtimeMs)}:${st.size}:${Math.trunc(walMtime)}:${walSize}`;
    files.push({id,real,dbSize:st.size,effectiveMtime,fp});
  }
  return files;
}

async function fetchRpcRecordsIncremental(id,startOffset,rpc){
  let offset=startOffset;
  const all=[];
  for(let page=0;page<MAX_RPC_PAGES;page++){
    const raw=await rpc('GetCascadeTrajectoryGeneratorMetadata',{cascadeId:id,generatorMetadataOffset:offset,includeMessages:false});
    const batch=(raw?.response??raw)?.generatorMetadata;
    if(!Array.isArray(batch)||batch.length===0)break;
    for(const item of batch)all.push(item);
    offset+=batch.length;
    if(batch.length<RPC_CONTINUE_THRESHOLD)break;
  }
  return {rawRecords:all,nextGenIdx:offset};
}

export function loadSavedUsageStats(dataDir){
  if(!dataDir)return null;
  const summary=readJson(path.join(dataDir,USAGE_STATS_FILENAME));
  if(!summary||typeof summary!=='object'||!summary.today||!summary.last7Days)return null;
  return summary;
}

function loadUsageCache(dataDir){
  if(!dataDir)return {conversations:{},labels:{}};
  const parsed=readJson(path.join(dataDir,USAGE_CACHE_FILENAME));
  if(!parsed||typeof parsed!=='object')return {conversations:{},labels:{}};
  return {
    conversations:parsed.conversations&&typeof parsed.conversations==='object'?parsed.conversations:{},
    labels:parsed.labels&&typeof parsed.labels==='object'?parsed.labels:{}
  };
}

export async function scanAntigravityUsage({
  dataDir,
  now=Date.now(),
  force=false,
  desktopRoot=path.join(os.homedir(),'.gemini','antigravity','conversations'),
  cliRoot=path.join(os.homedir(),'.gemini','antigravity-cli','conversations'),
  listTrajectories=trajectorySummaries,
  rpc=callRPC,
  fetchPricing=ensurePricing,
  fetchImpl=globalThis.fetch,
  readDb=readConversationDbIncremental,
  readStepTimes=readStepTimesFromConversationDb
}={}){
  const savedSummary=loadSavedUsageStats(dataDir);
  const todayKey=localDateKey(now);
  const sevenDayKeys=new Set(recentDateKeys(now,7));
  const keepKeys=new Set(recentDateKeys(now,8));
  const cutoffMs=startOfWindowMs(now,7);
  const statCutoffMs=cutoffMs-24*60*60*1000;

  if(!force&&savedSummary?.updatedAt&&now-savedSummary.updatedAt>=0&&now-savedSummary.updatedAt<USAGE_SCAN_INTERVAL_MS){
    if(savedSummary.todayDate===todayKey){
      return {summary:savedSummary,scanned:false};
    }
    const cache=loadUsageCache(dataDir);
    const pricing=await fetchPricing(dataDir,{now,fetchImpl,force:false});
    const {pruned}=pruneConversations(cache.conversations,keepKeys,statCutoffMs);
    const updatedSummary={
      ...savedSummary,
      todayDate:todayKey,
      pricingUpdatedAt:pricing.updatedAt,
      pricingSource:pricing.source,
      pricingStale:pricing.stale,
      today:buildPeriodSummary(pruned,cache.labels,new Set([todayKey]),pricing.models),
      last7Days:buildPeriodSummary(pruned,cache.labels,sevenDayKeys,pricing.models)
    };
    return {summary:updatedSummary,scanned:false};
  }

  const loadedCache=loadUsageCache(dataDir);
  const labels={...loadedCache.labels};
  const {pruned:conversations,changed:prunedOnLoad}=pruneConversations(structuredClone(loadedCache.conversations),keepKeys,statCutoffMs);
  let cacheDirty=prunedOnLoad;

  const cliFiles=listUuidDbFiles(cliRoot);
  const desktopFiles=listUuidDbFiles(desktopRoot);
  const cliIdSet=new Set(cliFiles.map(f=>f.id));
  const desktopById=new Map(desktopFiles.map(f=>[f.id,f]));

  let rpcConversationsScanned=0,dbFilesOpened=0,dbFilesSkipped=0,desktopRpcAvailable=false;
  const rpcCoveredIds=new Set();

  // 1) Primary source: Desktop Antigravity read-only local language_server RPC.
  if(typeof listTrajectories==='function'&&typeof rpc==='function'){
    try{
      const summaries=await listTrajectories();
      if(Array.isArray(summaries)){
        desktopRpcAvailable=true;
        for(const row of summaries){
          if(!row?.id||!UUID_RE.test(row.id))continue;
          if(cliIdSet.has(row.id)&&!desktopById.has(row.id))continue;
          if(!Number.isFinite(row.lastModified)||row.lastModified<statCutoffMs)continue;
          const prev=conversations[row.id];
          const dbInfo=desktopById.get(row.id);
          if(prev&&prev.s==='r'&&prev.lm===row.lastModified&&prev.sc===row.stepCount){
            if(dbInfo&&prev.fp!==dbInfo.fp){prev.fp=dbInfo.fp;cacheDirty=true;}
            rpcCoveredIds.add(row.id);
            continue;
          }
          const shouldReset=Boolean(prev&&Number.isFinite(prev.sc)&&row.stepCount<prev.sc);
          const startOffset=shouldReset?0:(prev?.n??0);
          try{
            const {rawRecords,nextGenIdx}=await fetchRpcRecordsIncremental(row.id,startOffset,rpc);
            const parsed=rawRecords.map(parseRpcGenRecord).filter(Boolean);
            const hasOutputs=parsed.some(r=>r.outputTokens>0);
            const hasInputs=parsed.some(r=>r.inputTokens>0||r.cacheReadTokens>0||r.cacheWriteTokens>0);
            if(hasOutputs&&!hasInputs&&dbInfo)continue;

            const days=shouldReset?{}:structuredClone(prev?.d??{});
            const sameDayFastPath=Boolean(
              !shouldReset&&prev?.lm&&Number.isFinite(prev.lm)&&
              localDateKey(prev.lm)===localDateKey(row.lastModified)
            );
            let stepTimes=null;
            if(!sameDayFastPath&&parsed.length>0&&dbInfo){
              const needed=parsed.flatMap(r=>r.stepIndices);
              if(needed.length){
                stepTimes=readStepTimes(desktopRoot,row.id,needed);
                dbFilesOpened++;
              }
            }
            const fallbackDay=localDateKey(row.lastModified);
            for(const record of parsed){
              const dayKey=sameDayFastPath?fallbackDay:resolveRecordDayKey(record,stepTimes,row.lastModified);
              if(dayKey&&keepKeys.has(dayKey))mergeRecordIntoDays(days,labels,record,dayKey);
            }
            conversations[row.id]={
              s:'r',
              lm:row.lastModified,
              sc:row.stepCount,
              fp:dbInfo?.fp??prev?.fp??null,
              sz:dbInfo?.dbSize??prev?.sz??0,
              n:nextGenIdx,
              d:days
            };
            cacheDirty=true;
            rpcConversationsScanned++;
            rpcCoveredIds.add(row.id);
          }catch{
            // Leave uncovered for desktop DB fallback.
          }
        }
      }
    }catch{
      desktopRpcAvailable=false;
    }
  }

  // 2) Incremental read-only DB scan: always for agy CLI, and fallback for uncovered desktop DBs.
  const dbQueue=[
    ...cliFiles.map(item=>({...item,src:'c'})),
    ...desktopFiles.filter(item=>!rpcCoveredIds.has(item.id)).map(item=>({...item,src:'d'}))
  ];

  for(const item of dbQueue){
    if(item.effectiveMtime<statCutoffMs){
      dbFilesSkipped++;
      continue;
    }
    const prev=conversations[item.id];
    if(prev&&prev.fp===item.fp){
      dbFilesSkipped++;
      continue;
    }
    const shrunk=Boolean(prev?.sz&&item.dbSize<prev.sz*0.5);
    const fromIdx=shrunk?0:(prev?.n??0);
    const sameDayFastPath=Boolean(
      !shrunk&&prev?.lm&&Number.isFinite(prev.lm)&&
      localDateKey(prev.lm)===localDateKey(item.effectiveMtime)
    );
    try{
      const result=readDb(item.real,fromIdx,{needStepTimes:!sameDayFastPath});
      dbFilesOpened++;
      const days=(shrunk||result.reset)?{}:structuredClone(prev?.d??{});
      const fallbackDay=localDateKey(item.effectiveMtime);
      for(const record of result.records){
        const dayKey=sameDayFastPath?fallbackDay:resolveRecordDayKey(record,result.stepTimes,item.effectiveMtime);
        if(dayKey&&keepKeys.has(dayKey))mergeRecordIntoDays(days,labels,record,dayKey);
      }
      conversations[item.id]={
        s:item.src,
        lm:item.effectiveMtime,
        sc:prev?.sc??0,
        fp:item.fp,
        sz:item.dbSize,
        n:result.nextGenIdx,
        d:days
      };
      cacheDirty=true;
    }catch{
      // Skip unreadable/corrupt DB without aborting the scan.
    }
  }

  const {pruned:cleaned}=pruneConversations(conversations,keepKeys,statCutoffMs);
  const pricing=await fetchPricing(dataDir,{now,fetchImpl,force:false});

  const summary={
    version:1,
    updatedAt:now,
    todayDate:todayKey,
    disclaimer:USAGE_DISCLAIMER,
    pricingUpdatedAt:pricing.updatedAt,
    pricingSource:pricing.source,
    pricingStale:pricing.stale,
    today:buildPeriodSummary(cleaned,labels,new Set([todayKey]),pricing.models),
    last7Days:buildPeriodSummary(cleaned,labels,sevenDayKeys,pricing.models),
    scan:{
      rpcConversationsScanned,
      dbFilesOpened,
      dbFilesSkipped,
      desktopRpcAvailable
    }
  };

  if(dataDir){
    fs.mkdirSync(dataDir,{recursive:true});
    atomicCompactJson(path.join(dataDir,USAGE_STATS_FILENAME),summary);
    if(cacheDirty||!fs.existsSync(path.join(dataDir,USAGE_CACHE_FILENAME))){
      atomicCompactJson(path.join(dataDir,USAGE_CACHE_FILENAME),{version:1,labels,conversations:cleaned});
    }
  }

  return {summary,scanned:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dataDir=process.argv[2];
  const force=process.argv.includes('--force');
  if(!dataDir){process.exit(2);}
  const result=await scanAntigravityUsage({dataDir,force});
  process.stdout.write(JSON.stringify(result)+'\n');
}
