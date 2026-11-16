import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DshFileTail} from '../runtime/local-sessions.mjs';
test('DS append-only reads advance offsets without replaying the entire log and recover from truncation',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-dsh-tail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'session.jsonl'),encode=x=>JSON.stringify(x)+'\n';
 fs.writeFileSync(file,encode({type:'session',id:'fixture',delegationDepth:0})+encode({type:'session/title',time:1,data:{title:'鲸鱼'}}));
 const tail=new DshFileTail(file);assert.equal(tail.update().title,'鲸鱼');const offset=tail.offset;
 for(let i=0;i<600;i++)tail.update();assert.equal(tail.offset,offset);
 fs.appendFileSync(file,encode({type:'session/title',time:2,data:{title:'新消息'}}));assert.equal(tail.update().title,'新消息');
 assert.equal(tail.offset,fs.statSync(file).size);assert.ok(tail.offset>offset);
 fs.writeFileSync(file,encode({type:'session',id:'next',delegationDepth:0}));assert.equal(tail.update().id,'next');assert.equal(tail.parser.title,null);
});
test('DS split UTF-8 records are decoded once after the newline arrives',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-dsh-utf8-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'session.jsonl'),bytes=Buffer.from(JSON.stringify({type:'session/title',time:1,data:{title:'鲸鱼'}})+'\n');
 const split=bytes.indexOf(Buffer.from('鲸'))+1;fs.writeFileSync(file,bytes.subarray(0,split));const tail=new DshFileTail(file);tail.update();
 fs.appendFileSync(file,bytes.subarray(split));assert.equal(tail.update().title,'鲸鱼');
});
