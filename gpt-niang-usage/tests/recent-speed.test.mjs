import test from 'node:test';
import assert from 'node:assert/strict';
import {RecentSpeedSamples,RECENT_WINDOW_MS as WINDOW} from '../runtime/recent-speed.mjs';
import {RolloutCounters} from '../runtime/thread-speed.mjs';
import {ClaudeTurnParser,DshTurnParser} from '../runtime/local-sessions.mjs';
import {latestGeneration} from '../runtime/gemini-generation-speed.mjs';

const now=Date.parse('2026-11-12T12:00:00Z');
const sample=(tokens,seconds,at=now,modelName='sol · max')=>({outputTokens:tokens,intervalSeconds:seconds,sampleAt:at,modelName});
test('three-day boundary is inclusive, old/future/untimed data is excluded without stale fallback',()=>{
  const history=new RecentSpeedSamples();
  history.add('boundary',sample(100,10,now-WINDOW));history.add('old',sample(999,1,now-WINDOW-1));
  history.add('future',sample(999,1,now+1));history.add('no-time',{...sample(999,1),sampleAt:null});
  assert.deepEqual(history.snapshot(now).recentSamples,[{modelName:'sol · max',outputTokens:100,intervalSeconds:10,sampleCount:1}]);
  assert.deepEqual(history.snapshot(now+WINDOW+2).recentSamples,[]);
});
test('weighted totals group each historical model and effort separately and deduplicate identities',()=>{
  const history=new RecentSpeedSamples();
  history.add('a',sample(100,10));history.add('a',sample(100,10));history.add('b',sample(100,1));
  history.add('c',sample(300,10,now,'astra · max'));history.add('d',sample(20,2,now,'sol · low'));
  const rows=history.snapshot(now).recentSamples;
  assert.deepEqual(rows.find(x=>x.modelName==='sol · max'),{modelName:'sol · max',outputTokens:200,intervalSeconds:11,sampleCount:2});
  assert.equal(rows.length,3);
});
test('invalid measurements never become zero-speed samples and history stays bounded',()=>{
  const history=new RecentSpeedSamples({limit:2});
  for(const bad of [sample(-1,1),sample(1,0),sample(1,Infinity),sample(1.5,1)])history.add('bad',bad);
  assert.deepEqual(history.snapshot(now).recentSamples,[]);
  for(let i=0;i<5;i++)history.add(i,sample(10,1));
  assert.equal(history.samples.size,2);assert.equal(history.snapshot(now).recentPartial,true);
  assert.equal(history.snapshot(now).recentSamples[0].sampleCount,2);
});
test('Codex preserves latest single-turn fields while the model-specific history spans turns',()=>{
  const parser=new RolloutCounters();let total=0;
  for(const [id,model,tokens,seconds] of [['a','sol',100,10],['b','astra',300,2],['c','sol',200,20]]){
    const at=now-seconds*1000;
    parser.accept({type:'turn_context',payload:{model,effort:'max'}});
    parser.accept({type:'event_msg',timestamp:new Date(at).toISOString(),payload:{type:'task_started',turn_id:id}});
    parser.accept({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type:'token_count',info:{total_token_usage:{output_tokens:total+tokens},last_token_usage:{output_tokens:tokens}}}});
    parser.accept({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type:'task_complete',turn_id:id,duration_ms:seconds*1000}});total+=tokens;
  }
  assert.equal(parser.latest.outputTokens,200);assert.equal(parser.latest.seconds,20);assert.equal(parser.latest.tokensPerSecond,10);
  assert.deepEqual(parser.recent.snapshot(now).recentSamples.find(x=>x.modelName==='sol · max'),{modelName:'sol · max',outputTokens:300,intervalSeconds:30,sampleCount:2});
});
test('Claude and DS keep latest card metrics independent of their three-day model history',()=>{
  const claude=new ClaudeTurnParser(),ds=new DshTurnParser();
  for(const [i,model,tokens,seconds] of [[1,'one',100,10],[2,'two',200,2]]){
    claude.accept({type:'user',timestamp:new Date(now-seconds*1000).toISOString(),message:{content:'fixture'}});
    claude.accept({type:'assistant',timestamp:new Date(now).toISOString(),message:{id:String(i),model,stop_reason:'end_turn',usage:{output_tokens:tokens}}});
    ds.accept({type:'turn/start',time:now-seconds*1000,data:{turn:i}});
    ds.accept({type:'assistant/message',time:now-1,data:{turn:i,step:0,usage:{outputTokens:tokens},message:{source:{model}}}});
    ds.accept({type:'turn/end',time:now,data:{turn:i,reason:{kind:'completed'}}});
  }
  for(const parser of [claude,ds]){
    assert.equal(parser.latest.outputTokens,200);assert.equal(parser.latest.intervalSeconds,2);assert.equal(parser.latest.tokensPerSecond,100);
    assert.equal(parser.recent.snapshot(now).recentSamples.length,2);
    assert.deepEqual(parser.recent.snapshot(now+WINDOW+1).recentSamples,[]);
    assert.equal(parser.latest.outputTokens,200);
  }
});
test('Gemini keeps one generation on its card, excludes unknown timestamps, and expires cached history',()=>{
  const gen=(tokens,at,model)=>({chatModel:{usage:{outputTokens:tokens},timeToFirstToken:'2s',streamingDuration:'3s',modelDisplayName:model,chatStartMetadata:{createdAt:new Date(at-5000).toISOString()}}});
  const history=new RecentSpeedSamples();
  const raw={generatorMetadata:[gen(100,now-WINDOW-1,'old'),gen(200,now-10000,'flash'),gen(300,now,'pro')]};
  const result=latestGeneration(raw,{history,now});
  assert.equal(result.outputTokens,300);assert.equal(result.intervalSeconds,5);assert.equal(result.tokensPerSecond,60);
  assert.deepEqual(result.recentSamples.map(x=>x.modelName),['flash','pro']);
  assert.deepEqual(history.snapshot(now+WINDOW+1).recentSamples,[]);
  const noTime=gen(100,now,'x');delete noTime.chatModel.chatStartMetadata;
  assert.deepEqual(latestGeneration({generatorMetadata:[noTime]},{now}).recentSamples,[]);
});
