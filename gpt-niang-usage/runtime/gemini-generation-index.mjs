import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const execute=promisify(execFile);

// Read only the metadata index, never conversation message blobs.
export async function latestGenerationIndex(id,{conversationsRoot=path.join(os.homedir(),'.gemini','antigravity','conversations')}={}){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  const base=await fs.realpath(conversationsRoot);
  const file=await fs.realpath(path.join(base,id+'.db'));
  if(!file.startsWith(base+path.sep))throw new Error('session outside source directory');
  const {stdout}=await execute('/usr/bin/sqlite3',['-readonly','-json',file,'SELECT MAX(idx) AS lastIndex FROM gen_metadata;'],{timeout:2000,maxBuffer:4096});
  const value=JSON.parse(stdout||'[]')[0]?.lastIndex;
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
