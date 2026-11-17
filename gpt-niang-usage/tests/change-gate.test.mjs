import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ChangeGate} from '../runtime/change-gate.mjs';
import {EventEmitter} from 'node:events';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('600 unchanged checks perform one initial read; changed records trigger another read',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-changes-'));const gate=new ChangeGate([root]);
 t.after(()=>{gate.close();fs.rmSync(root,{recursive:true,force:true});});
 let reads=0;for(let i=0;i<600;i++)if(gate.consume())reads++;
 assert.equal(reads,1);fs.writeFileSync(path.join(root,'record.json'),'{}');
 for(let i=0;i<100&&!gate.consume();i++)await pause(10);
 // A later event is still delivered after the first burst was consumed.
 fs.writeFileSync(path.join(root,'record.json'),'[]');await pause(100);assert.equal(gate.consume(),true);assert.equal(gate.consume(),false);
});
test('unrelated sibling changes do not read a missing provider root; its creation is detected',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-missing-')),provider=path.join(root,'provider');
 const gate=new ChangeGate([provider]);t.after(()=>{gate.close();fs.rmSync(root,{recursive:true,force:true});});gate.consume();
 fs.writeFileSync(path.join(root,'other'),'unrelated');await pause(100);assert.equal(gate.consume(),false);
 fs.mkdirSync(provider);await pause(100);assert.equal(gate.consume(),true);
});
test('host status settling gets one bounded follow-up and never turns into idle polling',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-settle-'));let now=0;
 const gate=new ChangeGate([root],{settleMs:4000,now:()=>now});t.after(()=>{gate.close();fs.rmSync(root,{recursive:true,force:true});});
 assert.equal(gate.consume(),true);now=3999;assert.equal(gate.consume(),false);now=4000;assert.equal(gate.consume(),true);
 for(let i=0;i<600;i++){now+=2000;assert.equal(gate.consume(),false);}
 gate.mark();assert.equal(gate.consume(),true);now+=4000;assert.equal(gate.consume(),true);now+=4000;assert.equal(gate.consume(),false);
});
test('missing nested record roots watch the parent nonrecursively and narrow after creation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-narrow-watch-')),wanted=path.join(root,'provider','records'),calls=[];
 const watch=(dir,options,callback)=>{const handle=new EventEmitter();handle.close=()=>{};calls.push({dir,options,callback});return handle;};
 const gate=new ChangeGate([wanted],{watch});t.after(()=>{gate.close();fs.rmSync(root,{recursive:true,force:true});});
 assert.equal(calls[0].dir,root);assert.equal(calls[0].options.recursive,false);
 fs.mkdirSync(wanted,{recursive:true});calls[0].callback('rename','provider');await Promise.resolve();
 assert.equal(calls.at(-1).dir,wanted);assert.equal(calls.at(-1).options.recursive,true);
});
test('file parent watches do not widen recursive subscriptions over unrelated sibling directories',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-file-watch-')),records=path.join(root,'records'),file=path.join(root,'index.sqlite'),calls=[];
 fs.mkdirSync(records);fs.writeFileSync(file,'fixture');
 const watch=(dir,options)=>{const handle=new EventEmitter();handle.close=()=>{};calls.push({dir,options});return handle;};
 const gate=new ChangeGate([file,records],{watch});t.after(()=>{gate.close();fs.rmSync(root,{recursive:true,force:true});});
 assert.deepEqual(calls.map(c=>[c.dir,c.options.recursive]),[[root,false],[records,true]]);
});
test('a watched directory replaced at the same path attaches to its new identity',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-watch-replace-')),wanted=path.join(root,'records'),calls=[];fs.mkdirSync(wanted);
 const watch=(dir,options,callback)=>{const handle=new EventEmitter();handle.close=()=>{};calls.push({dir,options,callback});return handle;};
 const gate=new ChangeGate([wanted],{watch});t.after(()=>{gate.close();fs.rmSync(root,{recursive:true,force:true});});
 fs.renameSync(wanted,path.join(root,'old'));fs.mkdirSync(wanted);calls[0].callback('rename',null);await Promise.resolve();
 assert.equal(calls.length,2);assert.equal(calls[1].dir,wanted);assert.equal(calls[1].options.recursive,true);
});
