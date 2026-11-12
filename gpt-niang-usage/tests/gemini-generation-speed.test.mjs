import test from 'node:test';
import assert from 'node:assert/strict';
import {durationSeconds,generationSample,latestGeneration,readGenerationSpeed} from '../runtime/gemini-generation-speed.mjs';

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
