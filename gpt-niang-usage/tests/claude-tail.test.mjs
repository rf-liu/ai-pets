import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClaudeTail} from '../runtime/local-sessions.mjs';
const encode=x=>JSON.stringify(x)+'\n';
const records=[
 {type:'user',timestamp:1000,uuid:'user',message:{content:'你好'}},
 {type:'assistant',timestamp:2000,uuid:'reply',parentUuid:'user',message:{id:'answer',model:'Claude 中文',stop_reason:'end_turn',content:[{type:'text',text:'完成'}],usage:{output_tokens:10}}},
 {type:'system',subtype:'stop_hook_summary',timestamp:3000,uuid:'stop',parentUuid:'reply',preventedContinuation:false,hookErrors:[]}
];
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-claude-tail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'session.jsonl');}
test('UTF-8 split across one-byte chunks and separate updates preserves model names and completion proof',t=>{
 const file=fixture(t),bytes=Buffer.from(records.map(encode).join('')),split=bytes.indexOf(Buffer.from('中文'))+1;
 fs.writeFileSync(file,bytes.subarray(0,split));const tail=new ClaudeTail(file,{chunkBytes:1});tail.update();
 fs.appendFileSync(file,bytes.subarray(split));const parser=tail.update();
 assert.equal(parser.latest.modelName,'Claude 中文');assert.equal(parser.latest.outputTokens,10);assert.equal(parser.completion.endedAt,3000);
});
test('notification-only parsing has identical completion state without building TPS history',t=>{
 const file=fixture(t);fs.writeFileSync(file,records.map(encode).join(''));
 const speed=new ClaudeTail(file).update(),notice=new ClaudeTail(file,{completionOnly:true}).update();
 assert.equal(notice.completion.endedAt,speed.completion.endedAt);assert.equal(notice.completion.running,speed.completion.running);
 assert.equal(notice.latest,null);assert.deepEqual(notice.recent.snapshot().recentSamples,[]);assert.equal(speed.latest.outputTokens,10);
});
test('oversized partial lines cannot discard an unrelated valid earlier record in the same batch',t=>{
 const file=fixture(t);fs.writeFileSync(file,records.map(encode).join('')+'x'.repeat(1024*1024+1));
 const tail=new ClaudeTail(file);const p=tail.update();assert.equal(p.completion.endedAt,3000);
 fs.appendFileSync(file,'\n'+encode({...records[0],timestamp:4000,uuid:'next'}));tail.update();
 assert.equal(tail.parser.completion.endedAt,null);assert.equal(tail.parser.completion.running,true);
});
test('chunked reads honor the same whole-update byte limit and do not reread unchanged files',t=>{
 const file=fixture(t);fs.writeFileSync(file,records.map(encode).join(''));const tail=new ClaudeTail(file,{chunkBytes:31});tail.update();
 assert.equal(tail.offset,fs.statSync(file).size);const parser=tail.parser;
 for(let i=0;i<600;i++)assert.equal(tail.update(),parser);
 fs.writeFileSync(file,encode(records[0]));tail.update();assert.equal(tail.offset,fs.statSync(file).size);assert.equal(tail.parser.latest,null);
});
