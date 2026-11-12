import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stepGenerationTime} from '../runtime/gemini-step-time.mjs';
import {generationStepTimes} from '../runtime/gemini-generation-index.mjs';
import {generationSample,readGenerationSpeed} from '../runtime/gemini-generation-speed.mjs';

const id='00000000-0000-0000-0000-000000000001',now=Date.parse('2026-11-12T12:00:00Z');
const v=value=>{let n=BigInt(value),out=[];do{const byte=Number(n&127n);n>>=7n;out.push(byte|(n?128:0));}while(n);return Buffer.from(out);};
const integer=(field,value)=>Buffer.concat([v(field*8),v(value)]);
const blob=(field,value)=>Buffer.concat([v(field*8+2),v(value.length),value]);
const stamp=(seconds,nanos=0)=>Buffer.concat([integer(1,seconds),integer(2,nanos)]);
const metadata=(seconds,nanos=0)=>Buffer.concat([blob(1,stamp(seconds-100)),blob(4,Buffer.from('unread tool arguments')),blob(7,stamp(seconds,nanos)),blob(8,stamp(seconds+500))]);
const record=()=>({stepIndices:[10,11],chatModel:{usage:{outputTokens:'250',responseOutputTokens:'100',thinkingOutputTokens:'150'},timeToFirstToken:'2s',streamingDuration:'3s',modelDisplayName:'Gemini fixture',chatStartMetadata:{startStepIndex:10,checkpointIndex:0}}});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-step-time-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('verified step field 7 supplies generation finish time with nanosecond precision',()=>{
  assert.equal(stepGenerationTime(metadata(1794480000,123456789)),1794480000123.4568);
});
test('creation and tool-completion dates are not substituted for the missing generation finish',()=>{
  assert.equal(stepGenerationTime(Buffer.concat([blob(1,stamp(1794480000)),blob(8,stamp(1794480500))])),null);
});
test('malformed metadata and invalid timestamp nanos stay unknown',()=>{
  for(const bytes of [Buffer.from([58,127,1]),Buffer.from([0]),blob(7,stamp(1794480000,1000000000)),integer(7,1794480000)])assert.equal(stepGenerationTime(bytes),null);
});
test('actual RPC shape without createdAt retains single-generation TPS and gains a verified sample time',()=>{
  const value=generationSample(record(),{stepTimes:new Map([[10,now-1],[11,now]])});
  assert.equal(value.sampleAt,now);assert.equal(value.timeSource,'step-finished-generating-at');
  assert.equal(value.tokensPerSecond,50);assert.equal(value.outputTokens,250);assert.equal(value.intervalSeconds,5);
  const speculative=record();speculative.chatModel.chatStartMetadata.createdAt=new Date(now).toISOString();
  assert.equal(generationSample(speculative).sampleAt,null);
});
test('local database lookup reads only bounded metadata and keeps database bytes unchanged',async t=>{
  const root=fixture(t),file=path.join(root,id+'.db'),time=now/1000;
  execFileSync('/usr/bin/sqlite3',[file,`CREATE TABLE steps(idx INTEGER,metadata BLOB,step_payload BLOB); INSERT INTO steps VALUES(10,X'${metadata(time).toString('hex')}',zeroblob(1048576)),(11,X'${metadata(time+1).toString('hex')}',NULL),(12,zeroblob(65537),NULL);`]);
  const hash=()=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=hash();
  const values=await generationStepTimes(id,[10,11,12,'10 OR 1=1',-1],{conversationsRoot:root});
  assert.deepEqual([...values.keys()],[10,11]);assert.equal(values.get(10),now);assert.equal(hash(),before);
});
test('readGenerationSpeed joins real step dates into recent history rather than using observation time',async()=>{
  let indices;
  const sample=await readGenerationSpeed(id,{now,index:async()=>20,rpc:async()=>({generatorMetadata:[record()]}),readTimes:async(_,values)=>{indices=values;return new Map([[10,now-1000],[11,now-500]]);}});
  assert.deepEqual(indices,[10,11]);assert.equal(sample.sampleAt,now-500);assert.equal(sample.recentSamples[0].sampleCount,1);
  assert.equal(sample.outputTokens,250);assert.equal(sample.intervalSeconds,5);
});
test('unavailable local timing does not fabricate a recent sample or remove the latest rate',async()=>{
  const sample=await readGenerationSpeed(id,{now,index:async()=>20,rpc:async()=>({generatorMetadata:[record()]}),readTimes:async()=>{throw new Error('unavailable fixture');}});
  assert.equal(sample.tokensPerSecond,50);assert.equal(sample.sampleAt,null);assert.deepEqual(sample.recentSamples,[]);
});
test('local step metadata lookup rejects paths outside the conversation root',async t=>{
  const root=fixture(t),base=path.join(root,'allowed');fs.mkdirSync(base);const outside=path.join(root,'outside.db');fs.writeFileSync(outside,'');fs.symlinkSync(outside,path.join(base,id+'.db'));
  await assert.rejects(generationStepTimes(id,[10],{conversationsRoot:base}),/outside/);
});
