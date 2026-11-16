import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ChangeGate} from '../runtime/change-gate.mjs';
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
