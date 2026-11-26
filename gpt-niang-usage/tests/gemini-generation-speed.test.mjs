import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {durationSeconds,generationSample,latestGeneration,parseGenSpeedBlob,readGenerationSpeed,readLocalGenerationSpeed} from '../runtime/gemini-generation-speed.mjs';

const record=()=>({chatModel:{usage:{outputTokens:'250',responseOutputTokens:'100',thinkingOutputTokens:'150'},timeToFirstToken:'2s',streamingDuration:'3s',modelDisplayName:'Gemini 3.8 Flash (Low)'}});
test('completed historical generation immediately yields TPS without two polls',()=>{
  const result=latestGeneration({generatorMetadata:[record()]});
  assert.equal(result.tokensPerSecond,50);assert.equal(result.intervalSeconds,5);
  assert.equal(result.outputTokens,250);assert.equal(result.measurement,'generation-average');
  assert.equal(result.sampleAt,null); // no fabricated historical timestamp
});
test('first-token wait is included rather than reporting an inflated streaming burst rate',()=>{
  const value=record();value.chatModel.timeToFirstToken='4.449604542s';value.chatModel.streamingDuration='0.083627583s';
  const sample=generationSample(value);assert.ok(sample.tokensPerSecond<60);assert.ok(sample.intervalSeconds>4.5);
});
test('protobuf duration precision and explicit zero durations are supported',()=>{
  assert.equal(durationSeconds('0.083627583s'),.083627583);
  assert.equal(durationSeconds({seconds:'2',nanos:500000000}),2.5);
  const value=record();value.chatModel.streamingDuration='0s';assert.equal(generationSample(value).tokensPerSecond,125);
});
test('invalid counters, inconsistent totals, missing timings and unfinished records are unavailable',()=>{
  for(const change of [x=>delete x.chatModel.streamingDuration,x=>x.chatModel.streamingDuration='-1s',x=>x.chatModel.usage.outputTokens='251',x=>x.chatModel.usage.outputTokens='9007199254740993',x=>x.chatModel.timeToFirstToken='NaNs']){
    const value=record();change(value);assert.equal(generationSample(value),null);
  }
  assert.equal(latestGeneration({generatorMetadata:[{chatModel:{}}]}),null);
});
test('latest valid generation survives unfinished metadata at the end',()=>{
  const newer=record();newer.chatModel.usage={outputTokens:'100',responseOutputTokens:'50',thinkingOutputTokens:'50'};
  assert.equal(latestGeneration({response:{generatorMetadata:[record(),newer,{chatModel:{}}]}}).outputTokens,100);
});
test('historical metadata is paged from the real database index and conversation messages are excluded',async()=>{
  let request;
  const sample=await readGenerationSpeed('00000000-0000-0000-0000-000000000001',{
    index:async()=>2933,
    rpc:async(method,payload)=>{request={method,payload};return {generatorMetadata:[record()]};}
  });
  assert.equal(request.method,'GetCascadeTrajectoryGeneratorMetadata');
  assert.equal(request.payload.generatorMetadataOffset,2678);assert.equal(request.payload.includeMessages,false);
  assert.equal(sample.tokensPerSecond,50);
});
test('a session without a local database can still use metadata RPC',async()=>{
  const sample=await readGenerationSpeed('00000000-0000-0000-0000-000000000001',{
    index:async()=>{throw new Error('no db');},rpc:async(_,payload)=>{assert.equal(payload.generatorMetadataOffset,0);return {generatorMetadata:[record()]};}
  });
  assert.equal(sample.outputTokens,250);
});
test('local read-only sqlite fallback decodes TTFT, streaming duration, thinking tokens and step finish times without writing DB bytes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-local-speed-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const id='00000000-0000-0000-0000-000000000099';
  const file=path.join(root,id+'.db');
  const v=value=>{let n=BigInt(value),out=[];do{const b=Number(n&127n);n>>=7n;out.push(b|(n?128:0));}while(n);return Buffer.from(out);};
  const vf=(f,val)=>Buffer.concat([v(f*8),v(val)]);
  const bf=(f,buf)=>Buffer.concat([v(f*8+2),v(buf.length),buf]);
  const dur=(s,ns)=>Buffer.concat([...(s?[vf(1,s)]:[]),...(ns?[vf(2,ns)]:[])]);
  const usage=Buffer.concat([vf(3,250),vf(9,100),vf(10,150)]);
  const chat=Buffer.concat([
    bf(2,Buffer.alloc(65536,0x42)), // large message blob must be skipped cleanly
    bf(4,usage),
    bf(11,dur(2,0)),
    bf(12,dur(3,0)),
    bf(19,Buffer.from('gemini-4-neon')),
    bf(21,Buffer.from('Gemini 4 Neon (XHigh)'))
  ]);
  const blob=Buffer.concat([bf(2,Buffer.concat([v(10),v(11)])),bf(1,chat)]);
  assert.equal(parseGenSpeedBlob(blob).chatModel.modelDisplayName,'Gemini 4 Neon (XHigh)');
  const now=Date.parse('2026-11-21T12:00:00Z');
  const stepMeta=bf(7,Buffer.concat([vf(1,Math.floor(now/1000)),vf(2,0)]));
  const db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps(idx INTEGER PRIMARY KEY, metadata BLOB);');
  db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(0,blob);
  db.prepare('INSERT INTO steps VALUES (?, ?)').run(11,stepMeta);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  for(const s of ['-wal','-shm']){try{fs.unlinkSync(file+s);}catch{}}
  const before=createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  // When RPC fails, readGenerationSpeed falls back to readLocalGenerationSpeed seamlessly.
  const sample=await readGenerationSpeed(id,{
    rpc:async()=>{throw new Error('RPC unavailable');},
    roots:[root],
    now:now+1000
  });
  assert.equal(sample.tokensPerSecond,50);
  assert.equal(sample.outputTokens,250);
  assert.equal(sample.responseOutputTokens,100);
  assert.equal(sample.thinkingOutputTokens,150);
  assert.equal(sample.timeToFirstTokenSeconds,2);
  assert.equal(sample.streamingSeconds,3);
  assert.equal(sample.modelName,'Gemini 4 Neon (XHigh)');
  assert.equal(sample.sampleAt,now);
  assert.equal(sample.recentSamples[0].sampleCount,1);
  assert.equal(readLocalGenerationSpeed(id,{roots:[root],now:now+1000}).tokensPerSecond,50);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before);
  assert.equal(fs.existsSync(file+'-wal'),false);
  assert.equal(fs.existsSync(file+'-shm'),false);
});
