import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stepGenerationTime} from './gemini-step-time.mjs';
const execute=promisify(execFile);

// Read only the metadata index, never conversation message blobs.
export async function conversationDatabase(id,conversationsRoot){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  const base=await fs.realpath(conversationsRoot);
  const file=await fs.realpath(path.join(base,id+'.db'));
  if(!file.startsWith(base+path.sep))throw new Error('session outside source directory');
  return file;
}
export async function latestGenerationIndex(id,{conversationsRoot=path.join(os.homedir(),'.gemini','antigravity','conversations')}={}){
  const file=await conversationDatabase(id,conversationsRoot);
  const {stdout}=await execute('/usr/bin/sqlite3',['-readonly','-json',file,'SELECT MAX(idx) AS lastIndex FROM gen_metadata;'],{timeout:2000,maxBuffer:4096});
  const value=JSON.parse(stdout||'[]')[0]?.lastIndex;
  return Number.isSafeInteger(value)&&value>=0?value:null;
}

export async function generationStepTimes(id,indices,{conversationsRoot=path.join(os.homedir(),'.gemini','antigravity','conversations')}={}){
  const selected=[...new Set(indices.filter(x=>Number.isSafeInteger(x)&&x>=0))].slice(-2048);
  if(!selected.length)return new Map();
  const file=await conversationDatabase(id,conversationsRoot);
  // Read the small metadata column, never steps.step_payload or conversation text.
  const query=`SELECT idx,hex(metadata) AS metadata FROM steps WHERE idx IN (${selected.join(',')}) AND length(metadata)<=65536;`;
  const {stdout}=await execute('/usr/bin/sqlite3',['-readonly','-json',file,query],{timeout:2000,maxBuffer:4*1024*1024});
  const result=new Map();
  for(const row of JSON.parse(stdout||'[]')){
    if(!Number.isSafeInteger(row.idx)||typeof row.metadata!=='string')continue;
    const value=stepGenerationTime(Buffer.from(row.metadata,'hex'));
    if(Number.isFinite(value))result.set(row.idx,value);
  }
  return result;
}
