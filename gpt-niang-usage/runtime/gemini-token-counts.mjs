import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const execute=promisify(execFile);
function varint(buffer,offset){let value=0n,shift=0n;for(let i=0;i<10;i++){if(offset>=buffer.length)throw new Error('truncated protobuf');const b=buffer[offset++];value|=BigInt(b&127)<<shift;if(!(b&128))return [value,offset];shift+=7n;}throw new Error('invalid varint');}
export function fields(buffer){
  let offset=0;const result=new Map();
  while(offset<buffer.length){let tag;[tag,offset]=varint(buffer,offset);const field=Number(tag>>3n),wire=Number(tag&7n);if(!field)throw new Error('invalid protobuf tag');let value;
    if(wire===0){[value,offset]=varint(buffer,offset);}
    else if(wire===2){let length;[length,offset]=varint(buffer,offset);const end=offset+Number(length);if(end>buffer.length||end<offset)throw new Error('invalid protobuf length');value=buffer.subarray(offset,end);offset=end;}
    else if(wire===1||wire===5){const end=offset+(wire===1?8:4);if(end>buffer.length)throw new Error('invalid fixed field');value=buffer.subarray(offset,end);offset=end;}
    else throw new Error('unsupported protobuf wire');
    const values=result.get(field)??[];values.push(value);result.set(field,values);
  }
  return result;
}
const number=(map,key)=>{const value=map.get(key)?.[0];return typeof value==='bigint'&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;};
export function outputCounter(blob){
  const chat=fields(blob).get(1)?.[0];if(!Buffer.isBuffer(chat))return null;
  const usage=fields(chat).get(4)?.[0];if(!Buffer.isBuffer(usage))return null;
  const values=fields(usage),total=number(values,3),text=number(values,9),thinking=number(values,10);
  if(total!==null&&text!==null&&thinking!==null&&total!==text+thinking)throw new Error('token schema mismatch');
  return total??(text!==null||thinking!==null?(text??0)+(thinking??0):null);
}
export function updateRate(cache,counts,now){
  if(!cache.initialized){cache.initialized=true;cache.counts=new Map(counts);cache.at=now;return null;}
  let delta=0;
  for(const [id,count] of counts){const previous=cache.counts.get(id);if(previous===undefined)delta+=count;else if(count>=previous)delta+=count-previous;else {cache.counts=new Map(counts);cache.at=now;cache.sample=null;return null;}cache.counts.set(id,count);}
  while(cache.counts.size>256)cache.counts.delete(cache.counts.keys().next().value);
  if(delta>0&&now>cache.at){const seconds=(now-cache.at)/1000;cache.sample={tokensPerSecond:delta/seconds,outputTokens:delta,intervalSeconds:seconds,sampleAt:now};cache.at=now;}
  return cache.sample??null;
}
export async function readOutputCounters(id,cache){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  const base=await fs.realpath(path.join(os.homedir(),'.gemini','antigravity','conversations'));
  const file=await fs.realpath(path.join(base,id+'.db'));if(!file.startsWith(base+path.sep))throw new Error('session outside source directory');
  const filter=Number.isSafeInteger(cache.lastIndex)?'WHERE idx >= '+Math.max(0,cache.lastIndex-1):'';
  const order=filter?'ASC':'DESC';
  const query=`SELECT idx,CASE WHEN length(data)<=524288 THEN hex(data) ELSE NULL END AS data FROM gen_metadata ${filter} ORDER BY idx ${order} LIMIT 16;`;
  const {stdout}=await execute('/usr/bin/sqlite3',['-readonly','-json',file,query],{timeout:2000,maxBuffer:4*1024*1024});
  const rows=JSON.parse(stdout||'[]'),counts=[];
  for(const row of rows){if(!row.data)throw new Error('token record exceeds bounded read');const value=outputCounter(Buffer.from(row.data,'hex'));if(value!==null)counts.push([row.idx,value]);}
  cache.lastIndex=Math.max(cache.lastIndex??0,...rows.map(x=>x.idx));
  return counts;
}

// The local index matches generatorMetadataOffset. Read no conversation blobs:
// asking RPC for the tail avoids fetching megabytes of historical metadata.
export async function latestGenerationIndex(id){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  const base=await fs.realpath(path.join(os.homedir(),'.gemini','antigravity','conversations'));
  const file=await fs.realpath(path.join(base,id+'.db'));
  if(!file.startsWith(base+path.sep))throw new Error('session outside source directory');
  const {stdout}=await execute('/usr/bin/sqlite3',['-readonly','-json',file,'SELECT MAX(idx) AS lastIndex FROM gen_metadata;'],{timeout:2000,maxBuffer:4096});
  const value=JSON.parse(stdout||'[]')[0]?.lastIndex;
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
