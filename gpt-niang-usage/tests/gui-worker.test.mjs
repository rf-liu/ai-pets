import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {healthyWorker} from '../runtime/worker-state.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-gui-io-'));
 const source=fileURLToPath(new URL('../',import.meta.url));
 fs.cpSync(path.join(source,'runtime'),path.join(root,'runtime'),{recursive:true});
 fs.cpSync(path.join(source,'.codex-plugin'),path.join(root,'.codex-plugin'),{recursive:true});
 fs.renameSync(path.join(root,'runtime/usage.mjs'),path.join(root,'runtime/usage-real.mjs'));
 fs.writeFileSync(path.join(root,'runtime/usage.mjs'),`
 export {atomicJson,resolveCodexExecutable} from './usage-real.mjs';
 export async function readUsage(){process.stdout.write(JSON.stringify({type:'fixture-query'})+'\\n');await new Promise(r=>setTimeout(r,100));return {ok:true,queryOk:true,accountKey:'fixture',windows:[],observedAt:Date.now()};}
 `);
 const dataDir=path.join(root,'data');fs.mkdirSync(dataDir);const config=path.join(root,'config.json');
 fs.writeFileSync(config,JSON.stringify({dataDir,codexPath:process.execPath}));
 const child=spawn(process.execPath,[path.join(root,'runtime/watch.mjs'),config,String(process.pid),'--inherit-stop'],{env:{...process.env,AI_PETS_GUI_STDIO:'1'},stdio:['pipe','pipe','pipe']});
 const messages=[];let buffer='',errors='',exited=false;
 child.stdout.on('data',bytes=>{buffer+=bytes;let end;while((end=buffer.indexOf('\n'))>=0){messages.push(JSON.parse(buffer.slice(0,end)));buffer=buffer.slice(end+1);}});
 child.stderr.on('data',b=>{errors+=b;});const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;resolve({code,signal});}));
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const wait=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;if(exited)throw new Error(errors||'worker exited');await pause(20);}throw new Error(errors||'fixture timeout');};
 t.after(async()=>{if(!exited){child.stdin.end();await exit;}fs.rmSync(root,{recursive:true,force:true});});
 await wait(()=>messages.some(x=>x.type==='health'));
 return {root,dataDir,child,messages,send,wait,exit};
}
test('native worker heartbeats and 600 unchanged presence messages do not rewrite disk mailboxes or query quota',async t=>{
 const f=await fixture(t),health=path.join(f.dataDir,'worker-status.json'),before=fs.readFileSync(health);
 for(let i=0;i<600;i++)f.send({type:'presence',visible:true,quotaVisible:false});
 await pause(3200);
 assert.ok(f.messages.filter(x=>x.type==='health').length>=3);
 assert.deepEqual(fs.readFileSync(health),before);
 assert.equal(f.messages.filter(x=>x.type==='fixture-query').length,0);
 for(const name of ['presence.json','status.json','refresh.flag'])assert.equal(fs.existsSync(path.join(f.dataDir,name)),false);
 assert.equal(healthyWorker(f.dataDir,Date.now()+600000)?.pid,f.child.pid,'static stdio owner uses process liveness, not disk heartbeat age');
});
test('explicit refresh and visible quota return pipe snapshots; hidden quota stops autonomous queries',async t=>{
 const f=await fixture(t);f.send({type:'refresh'});f.send({type:'presence',visible:true,quotaVisible:true});
 await f.wait(()=>f.messages.some(x=>x.type==='snapshot'));
 await pause(200);assert.equal(f.messages.filter(x=>x.type==='fixture-query').length,1,'opening does not duplicate an explicit request');
 const next=f.messages.find(x=>x.type==='snapshot');assert.equal(next.snapshot.accountKey,'fixture');
 assert.equal(fs.existsSync(path.join(f.dataDir,'status.json')),false);
 f.send({type:'presence',visible:false,quotaVisible:false});
 f.child.stdin.end();assert.equal((await f.exit).code,0);
 assert.equal(fs.existsSync(path.join(f.dataDir,'worker-status.json')),false);
});
test('native worker still accepts explicit file refresh/stop requests without polling them',async t=>{
 const f=await fixture(t);fs.writeFileSync(path.join(f.dataDir,'refresh.flag'),'external-request');
 await f.wait(()=>f.messages.some(x=>x.type==='snapshot'));
 fs.writeFileSync(path.join(f.dataDir,'stop.flag'),'external-stop');
 const stopped=await Promise.race([f.exit,pause(5000).then(()=>({timeout:true}))]);assert.equal(stopped.code,0);
});
test('malformed and oversized pipe input recovers at the next valid command',async t=>{
 const f=await fixture(t);f.child.stdin.write('x'.repeat(9000)+'\nnot-json\n');await pause(50);
 f.send({type:'refresh'});await f.wait(()=>f.messages.some(x=>x.type==='snapshot'));
});
