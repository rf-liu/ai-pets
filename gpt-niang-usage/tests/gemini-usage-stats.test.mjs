import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {
  LITELLM_PRICING_URL,
  PRICING_CACHE_FILENAME,
  PRICING_REFRESH_INTERVAL_MS,
  canonicalizeModel,
  computeTokenCost,
  ensurePricing,
  lookupModelPrice
} from '../runtime/model-pricing.mjs';
import {
  USAGE_CACHE_FILENAME,
  USAGE_SCAN_INTERVAL_MS,
  USAGE_STATS_FILENAME,
  parseGenMetadataBlob,
  scanAntigravityUsage
} from '../runtime/gemini-usage-stats.mjs';

const v=value=>{let n=BigInt(value),out=[];do{const byte=Number(n&127n);n>>=7n;out.push(byte|(n?128:0));}while(n);return Buffer.from(out);};
const varintField=(field,value)=>Buffer.concat([v(field*8),v(value)]);
const bytesField=(field,buf)=>Buffer.concat([v(field*8+2),v(buf.length),buf]);
const strField=(field,text)=>bytesField(field,Buffer.from(text,'utf8'));
const packedVarints=(field,values)=>bytesField(field,Buffer.concat(values.map(v)));

function makeStepMeta(epochMs){
  const seconds=Math.floor(epochMs/1000);
  const nanos=Math.round((epochMs-seconds*1000)*1e6);
  const ts=Buffer.concat([varintField(1,seconds),varintField(2,nanos)]);
  return bytesField(7,ts);
}

function makeGenBlob({
  stepIndices=[1],
  modelEnum=1535,
  inputTokens=1000,
  outputTokens=200,
  cacheWriteTokens=0,
  cacheReadTokens=0,
  responseOutputTokens=120,
  thinkingOutputTokens=80,
  responseModel='gemini-4-neon',
  modelDisplayName='Gemini 4 Neon (High)',
  fakeMessagePaddingBytes=0
}={}){
  const usageParts=[varintField(1,modelEnum)];
  if(inputTokens)usageParts.push(varintField(2,inputTokens));
  if(outputTokens)usageParts.push(varintField(3,outputTokens));
  if(cacheWriteTokens)usageParts.push(varintField(4,cacheWriteTokens));
  if(cacheReadTokens)usageParts.push(varintField(5,cacheReadTokens));
  if(responseOutputTokens)usageParts.push(varintField(9,responseOutputTokens));
  if(thinkingOutputTokens)usageParts.push(varintField(10,thinkingOutputTokens));
  const chatParts=[];
  if(fakeMessagePaddingBytes>0)chatParts.push(bytesField(2,Buffer.alloc(fakeMessagePaddingBytes,0x41)));
  chatParts.push(varintField(3,modelEnum));
  chatParts.push(bytesField(4,Buffer.concat(usageParts)));
  if(responseModel)chatParts.push(strField(19,responseModel));
  if(modelDisplayName)chatParts.push(strField(21,modelDisplayName));
  return Buffer.concat([
    packedVarints(2,stepIndices),
    bytesField(1,Buffer.concat(chatParts))
  ]);
}

function createConvDb(file,rows,steps=[]){
  const db=new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB, size INTEGER DEFAULT 0); CREATE TABLE steps(idx INTEGER PRIMARY KEY, metadata BLOB, step_payload BLOB);');
  const insGen=db.prepare('INSERT INTO gen_metadata(idx, data) VALUES (?, ?)');
  for(const [idx,blob] of rows)insGen.run(idx,blob);
  const insStep=db.prepare('INSERT INTO steps(idx, metadata, step_payload) VALUES (?, ?, NULL)');
  for(const [idx,ms] of steps)insStep.run(idx,makeStepMeta(ms));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  // Remove -wal/-shm to simulate closed WAL DBs (as seen on idle agy CLI sessions).
  for(const suffix of ['-wal','-shm']){try{fs.unlinkSync(file+suffix);}catch{}}
}

function appendConvRows(file,rows,steps=[]){
  const db=new DatabaseSync(file);
  const insGen=db.prepare('INSERT INTO gen_metadata(idx, data) VALUES (?, ?)');
  for(const [idx,blob] of rows)insGen.run(idx,blob);
  const insStep=db.prepare('INSERT INTO steps(idx, metadata, step_payload) VALUES (?, ?, NULL)');
  for(const [idx,ms] of steps)insStep.run(idx,makeStepMeta(ms));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  for(const suffix of ['-wal','-shm']){try{fs.unlinkSync(file+suffix);}catch{}}
}

function makeTempWorkspace(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-agy-usage-'));
  const dataDir=path.join(root,'data');
  const desktopRoot=path.join(root,'desktop');
  const cliRoot=path.join(root,'cli');
  fs.mkdirSync(dataDir,{recursive:true});
  fs.mkdirSync(desktopRoot,{recursive:true});
  fs.mkdirSync(cliRoot,{recursive:true});
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,dataDir,desktopRoot,cliRoot};
}

const SAMPLE_PRICING={
  'sample_spec':{input_cost_per_token:0.1,output_cost_per_token:0.1},
  'gemini/gemini-4-neon':{
    input_cost_per_token:0.000003,
    output_cost_per_token:0.000015,
    cache_read_input_token_cost:0.00000015,
    mode:'chat'
  },
  'gemini/gemini-2.5-pro':{
    input_cost_per_token:0.00000125,
    output_cost_per_token:0.00001,
    cache_read_input_token_cost:0.0000003125,
    input_cost_per_token_above_200k_tokens:0.0000025,
    output_cost_per_token_above_200k_tokens:0.000015,
    mode:'chat'
  },
  'claude-opus-5-5':{
    input_cost_per_token:0.000004,
    output_cost_per_token:0.00002,
    cache_read_input_token_cost:0.0000002,
    cache_creation_input_token_cost:0.000005,
    mode:'chat'
  },
  'claude-sonnet-latest':{mode:'chat'},
  'us.anthropic.claude-opus-5-5':{input_cost_per_token:0.0000044,output_cost_per_token:0.000022,mode:'chat'}
};

const mockFetch=(payload,calls=[])=>async(url,init)=>{
  calls.push({url,init});
  return {ok:true,status:200,text:async()=>JSON.stringify(payload)};
};

test('protobuf blob parser extracts token breakdown and skips large message payload',()=>{
  const blob=makeGenBlob({
    stepIndices:[12,13],
    inputTokens:4036,
    outputTokens:720,
    cacheReadTokens:50918,
    cacheWriteTokens:1200,
    responseOutputTokens:323,
    thinkingOutputTokens:397,
    responseModel:'gemini-4-neon',
    modelDisplayName:'Gemini 4 Neon (XHigh)',
    fakeMessagePaddingBytes:120000
  });
  const parsed=parseGenMetadataBlob(blob);
  assert.deepEqual(parsed,{
    stepIndices:[12,13],
    modelId:'gemini-4-neon',
    displayName:'Gemini 4 Neon',
    inputTokens:4036,
    cacheReadTokens:50918,
    cacheWriteTokens:1200,
    outputTokens:720,
    responseOutputTokens:323,
    thinkingOutputTokens:397
  });
});

test('hourly cadence skips scans within 1h and manual refresh bypasses the hourly gate',async t=>{
  const {dataDir,desktopRoot,cliRoot}=makeTempWorkspace(t);
  const now=new Date(2026,10,21,15,0,0).getTime();
  const id='00000000-0000-0000-0000-000000000001';
  const dbPath=path.join(cliRoot,id+'.db');
  createConvDb(dbPath,[[0,makeGenBlob({stepIndices:[1],inputTokens:100000,outputTokens:10000,responseOutputTokens:6000,thinkingOutputTokens:4000})]],[[1,now-60000]]);
  fs.utimesSync(dbPath,new Date(now-60000),new Date(now-60000));

  const fetchCalls=[];
  const first=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING,fetchCalls)
  });
  assert.equal(first.scanned,true);
  assert.equal(first.summary.today.totalTokens,110000);
  assert.equal(first.summary.scan.dbFilesOpened,1);
  assert.equal(fetchCalls.length,1);

  // Append a new turn 20 minutes later.
  const t20=now+20*60*1000;
  appendConvRows(dbPath,[[1,makeGenBlob({stepIndices:[2],inputTokens:50000,outputTokens:5000,responseOutputTokens:3000,thinkingOutputTokens:2000})]],[[2,t20-1000]]);
  fs.utimesSync(dbPath,new Date(t20-1000),new Date(t20-1000));

  // Within 1 hour, automatic scan (force=false) must NOT scan or open DBs.
  let dbReadCalled=false;
  const throttled=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:t20,force:false,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING,fetchCalls),
    readDb:()=>{dbReadCalled=true;throw new Error('should not open DB');}
  });
  assert.equal(throttled.scanned,false);
  assert.equal(dbReadCalled,false);
  assert.equal(throttled.summary.today.totalTokens,110000);

  // Manual refresh (force=true) immediately scans and picks up ONLY the new generation incrementally.
  const manual=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:t20,force:true,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING,fetchCalls)
  });
  assert.equal(manual.scanned,true);
  assert.equal(manual.summary.today.totalTokens,165000);
  assert.equal(manual.summary.today.calls,2);
  assert.equal(manual.summary.scan.dbFilesOpened,1);
  // Pricing cache is <24h old so LiteLLM was NOT downloaded a second time.
  assert.equal(fetchCalls.length,1);

  // After >1 hour, automatic scan (force=false) runs again and skips unchanged DB.
  const t65=t20+61*60*1000;
  const hourly=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:t65,force:false,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING,fetchCalls)
  });
  assert.equal(hourly.scanned,true);
  assert.equal(hourly.summary.scan.dbFilesOpened,0);
  assert.equal(hourly.summary.scan.dbFilesSkipped,1);
  assert.equal(hourly.summary.today.totalTokens,165000);
});

test('brand-new models appear dynamically, missing prices stay unknown without guessing, and future pricing updates recompute cleanly',async t=>{
  const {dataDir,desktopRoot,cliRoot}=makeTempWorkspace(t);
  const now=new Date(2026,10,21,16,0,0).getTime();
  const id='00000000-0000-0000-0000-000000000002';

  const rpcRecords=[
    {
      stepIndices:[1],
      chatModel:{
        responseModel:'gemini-4-neon',
        modelDisplayName:'Gemini 4 Neon (XHigh)',
        usage:{inputTokens:'1000000',outputTokens:'100000',cacheReadTokens:'2000000',responseOutputTokens:'60000',thinkingOutputTokens:'40000'}
      }
    },
    {
      stepIndices:[2],
      chatModel:{
        responseModel:'gemini-9-hypernova-tiered-high',
        modelDisplayName:'Gemini 9 Hypernova (High)',
        usage:{inputTokens:'500000',outputTokens:'50000',responseOutputTokens:'30000',thinkingOutputTokens:'20000'}
      }
    }
  ];

  const first=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now,force:true,
    listTrajectories:async()=>[{id,lastModified:now-1000,stepCount:10}],
    rpc:async()=>({generatorMetadata:rpcRecords}),
    fetchImpl:mockFetch(SAMPLE_PRICING)
  });

  assert.equal(first.summary.scan.desktopRpcAvailable,true);
  assert.equal(first.summary.scan.rpcConversationsScanned,1);
  assert.equal(first.summary.scan.dbFilesOpened,0);

  const neon=first.summary.today.models.find(m=>m.modelId==='gemini-4-neon');
  const hyper=first.summary.today.models.find(m=>m.modelId==='gemini-9-hypernova');
  assert.ok(neon);
  assert.ok(hyper,'unseen future model appears automatically');
  assert.equal(hyper.displayName,'Gemini 9 Hypernova');
  assert.equal(hyper.totalTokens,550000);
  assert.equal(hyper.priceKnown,false);
  assert.equal(hyper.estimatedCostUsd,null);

  // Known model cost: 1M * $3/1M + 2M * $0.15/1M + 0.1M * $15/1M = $3 + $0.30 + $1.50 = $4.80
  assert.equal(neon.priceKnown,true);
  assert.equal(neon.estimatedCostUsd,4.8);
  assert.equal(first.summary.today.hasUnknownPrice,true);
  assert.equal(first.summary.today.estimatedCostUsd,4.8);

  // Next day (25h later), LiteLLM adds gemini-9-hypernova -> 7-day summary updates price without re-calling RPC!
  const nextDay=now+PRICING_REFRESH_INTERVAL_MS+60000;
  let rpcCalls=0;
  const updatedPricing={
    ...SAMPLE_PRICING,
    'gemini/gemini-9-hypernova':{input_cost_per_token:0.000002,output_cost_per_token:0.00001,mode:'chat'}
  };
  const second=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:nextDay,force:true,
    listTrajectories:async()=>[{id,lastModified:now-1000,stepCount:10}],
    rpc:async()=>{rpcCalls++;return {generatorMetadata:[]};},
    fetchImpl:mockFetch(updatedPricing)
  });
  assert.equal(rpcCalls,0,'unchanged conversation is not re-fetched');
  const hyper7d=second.summary.last7Days.models.find(m=>m.modelId==='gemini-9-hypernova');
  assert.equal(hyper7d.priceKnown,true);
  // 0.5M * $2/1M + 0.05M * $10/1M = $1.00 + $0.50 = $1.50
  assert.equal(hyper7d.estimatedCostUsd,1.5);
  assert.equal(second.summary.last7Days.hasUnknownPrice,false);
  assert.equal(second.summary.last7Days.estimatedCostUsd,6.3);
});

test('pricing download sends zero personal headers and falls back cleanly on download failure',async t=>{
  const {dataDir}=makeTempWorkspace(t);
  const t0=Date.parse('2026-11-20T10:00:00Z');
  const calls=[];

  // 1) Initial download fails with no cache -> graceful unavailable, no throw.
  const noCache=await ensurePricing(dataDir,{
    now:t0,
    fetchImpl:async()=>{throw new Error('offline');}
  });
  assert.deepEqual(noCache.models,{});
  assert.equal(noCache.updatedAt,null);
  assert.equal(noCache.stale,true);

  // 2) Download succeeds -> verify zero custom headers/query params and cache saved.
  const ok=await ensurePricing(dataDir,{
    now:t0+1000,
    fetchImpl:mockFetch(SAMPLE_PRICING,calls)
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,LITELLM_PRICING_URL);
  assert.equal(calls[0].init.method,'GET');
  assert.equal(calls[0].init.headers,undefined);
  assert.equal(ok.stale,false);
  assert.ok(lookupModelPrice(ok.models,'gemini-4-neon'));
  assert.equal(lookupModelPrice(ok.models,'claude-sonnet-latest'),null);
  assert.ok(fs.existsSync(path.join(dataDir,PRICING_CACHE_FILENAME)));

  // 3) Next day download fails (HTTP 503) -> falls back to cached table without corrupting cache.
  const tNextDay=t0+PRICING_REFRESH_INTERVAL_MS+5000;
  const fallback=await ensurePricing(dataDir,{
    now:tNextDay,
    fetchImpl:async()=>({ok:false,status:503,text:async()=>'unavailable'})
  });
  assert.equal(fallback.stale,true);
  assert.equal(fallback.updatedAt,t0+1000);
  assert.ok(lookupModelPrice(fallback.models,'gemini-4-neon'),'retains cached pricing');
});

test('incremental DB scan leaves conversation DB bytes untouched, creates no wal/shm, and splits 1/3/7/30-day windows accurately',async t=>{
  const {dataDir,desktopRoot,cliRoot}=makeTempWorkspace(t);
  const today=new Date(2026,10,27,14,0,0).getTime();
  const twoDaysAgo=new Date(2026,10,25,14,0,0).getTime();
  const fiveDaysAgo=new Date(2026,10,22,14,0,0).getTime();
  const fifteenDaysAgo=new Date(2026,10,12,14,0,0).getTime();
  const fortyDaysAgo=new Date(2026,9,18,14,0,0).getTime();

  const idCross='00000000-0000-0000-0000-000000000010';
  const id5d='00000000-0000-0000-0000-000000000011';
  const id15d='00000000-0000-0000-0000-000000000012';
  const id40d='00000000-0000-0000-0000-000000000013';

  const dbCross=path.join(cliRoot,idCross+'.db');
  const db5d=path.join(cliRoot,id5d+'.db');
  const db15d=path.join(cliRoot,id15d+'.db');
  const db40d=path.join(cliRoot,id40d+'.db');

  createConvDb(dbCross,[
    [0,makeGenBlob({stepIndices:[1],inputTokens:200000,outputTokens:10000,responseModel:'gemini-4-neon',modelDisplayName:'Gemini 4 Neon (High)'})],
    [1,makeGenBlob({stepIndices:[2],inputTokens:300000,outputTokens:20000,responseModel:'gemini-4-neon',modelDisplayName:'Gemini 4 Neon (High)'})]
  ],[[1,twoDaysAgo],[2,today-30000]]);
  fs.utimesSync(dbCross,new Date(today-30000),new Date(today-30000));

  createConvDb(db5d,[
    [0,makeGenBlob({stepIndices:[1],inputTokens:100000,outputTokens:5000,responseModel:'claude-opus-5-5-high',modelDisplayName:'Claude Opus 5.5 (High)'})]
  ],[[1,fiveDaysAgo]]);
  fs.utimesSync(db5d,new Date(fiveDaysAgo),new Date(fiveDaysAgo));

  createConvDb(db15d,[
    [0,makeGenBlob({stepIndices:[1],inputTokens:400000,outputTokens:40000,responseModel:'gemini-4-neon',modelDisplayName:'Gemini 4 Neon (High)'})]
  ],[[1,fifteenDaysAgo]]);
  fs.utimesSync(db15d,new Date(fifteenDaysAgo),new Date(fifteenDaysAgo));

  createConvDb(db40d,[
    [0,makeGenBlob({stepIndices:[1],inputTokens:999999,outputTokens:99999,responseModel:'gemini-4-neon',modelDisplayName:'Gemini 4 Neon (High)'})]
  ],[[1,fortyDaysAgo]]);
  fs.utimesSync(db40d,new Date(fortyDaysAgo),new Date(fortyDaysAgo));

  const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const hashesBefore={cross:sha(dbCross),d5:sha(db5d),d15:sha(db15d),d40:sha(db40d)};

  const res=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:today,force:true,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING)
  });

  // 40-day-old DB was never opened; only the 3 DBs within 30 days were opened.
  assert.equal(res.summary.scan.dbFilesOpened,3);
  assert.equal(res.summary.scan.dbFilesSkipped,1);

  // Today: turn 1 of idCross = 320,000
  assert.equal(res.summary.today.totalTokens,320000);
  // Last 3 days: turn 0 (day -2: 210k) + turn 1 (today: 320k) = 530,000
  assert.equal(res.summary.last3Days.totalTokens,530000);
  // Last 7 days: 530k + id5d (105k) = 635,000
  assert.equal(res.summary.last7Days.totalTokens,635000);
  assert.equal(res.summary.last7Days.models.length,2);
  // Last 30 days: 635k + id15d (440k) = 1,075,000 (excludes 40-day-old DB)
  assert.equal(res.summary.last30Days.totalTokens,1075000);

  // Zero writes to conversation DBs and zero -wal/-shm sidecars created!
  assert.deepEqual({cross:sha(dbCross),d5:sha(db5d),d15:sha(db15d),d40:sha(db40d)},hashesBefore);
  for(const db of [dbCross,db5d,db15d,db40d]){
    assert.equal(fs.existsSync(db+'-wal'),false);
    assert.equal(fs.existsSync(db+'-shm'),false);
  }

  // Subsequent force scan with no changes opens 0 DBs and does NOT rewrite cache file.
  const cacheFile=path.join(dataDir,USAGE_CACHE_FILENAME);
  const statsFile=path.join(dataDir,USAGE_STATS_FILENAME);
  assert.ok(fs.statSync(statsFile).size<8192,'summary file stays a few KB');
  const cacheBefore=fs.readFileSync(cacheFile);
  const res2=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:today+1000,force:true,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING)
  });
  assert.equal(res2.summary.scan.dbFilesOpened,0);
  assert.equal(res2.summary.scan.dbFilesSkipped,4);
  assert.deepEqual(fs.readFileSync(cacheFile),cacheBefore);
});

test('upgrading from v1 7-day cache automatically backfills 3-day and 30-day history even within 1h',async t=>{
  const {dataDir,desktopRoot,cliRoot}=makeTempWorkspace(t);
  const today=new Date(2026,10,27,14,0,0).getTime();
  const fifteenDaysAgo=new Date(2026,10,12,14,0,0).getTime();
  const id='00000000-0000-0000-0000-000000000020';
  const dbPath=path.join(cliRoot,id+'.db');
  createConvDb(dbPath,[
    [0,makeGenBlob({stepIndices:[1],inputTokens:250000,outputTokens:10000,responseModel:'gemini-4-neon',modelDisplayName:'Gemini 4 Neon (High)'})],
    [1,makeGenBlob({stepIndices:[2],inputTokens:100000,outputTokens:5000,responseModel:'gemini-4-neon',modelDisplayName:'Gemini 4 Neon (High)'})]
  ],[[1,fifteenDaysAgo],[2,today-10000]]);
  fs.utimesSync(dbPath,new Date(today-10000),new Date(today-10000));
  const st=fs.statSync(dbPath);
  const fp=`${Math.trunc(st.mtimeMs)}:${st.size}:0:0`;

  // Simulate an existing v1 (7-day) cache that had pruned day -15 and omitted last3Days/last30Days.
  fs.writeFileSync(path.join(dataDir,USAGE_STATS_FILENAME),JSON.stringify({
    version:1,updatedAt:today-60000,todayDate:'2026-11-27',disclaimer:'test',
    today:{totalTokens:105000,inputTokens:100000,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:5000,responseOutputTokens:5000,thinkingOutputTokens:0,calls:1,estimatedCostUsd:0.375,hasUnknownPrice:false,topModels:[],models:[]},
    last7Days:{totalTokens:105000,inputTokens:100000,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:5000,responseOutputTokens:5000,thinkingOutputTokens:0,calls:1,estimatedCostUsd:0.375,hasUnknownPrice:false,topModels:[],models:[]}
  }));
  fs.writeFileSync(path.join(dataDir,USAGE_CACHE_FILENAME),JSON.stringify({
    version:1,labels:{'gemini-4-neon':'Gemini 4 Neon'},
    conversations:{[id]:{s:'c',lm:st.mtimeMs,sc:0,fp,sz:st.size,n:2,d:{'2026-11-27':{'gemini-4-neon':[100000,0,0,5000,5000,0,0,0,0,0,1]}}}}
  }));

  // Even with force=false within 1h, upgrade triggers a one-time backfill scan and recovers day -15!
  const upgraded=await scanAntigravityUsage({
    dataDir,desktopRoot,cliRoot,now:today,force:false,
    listTrajectories:null,rpc:null,fetchImpl:mockFetch(SAMPLE_PRICING)
  });
  assert.equal(upgraded.scanned,true);
  assert.equal(upgraded.summary.today.totalTokens,105000);
  assert.equal(upgraded.summary.last3Days.totalTokens,105000);
  assert.equal(upgraded.summary.last7Days.totalTokens,105000);
  assert.equal(upgraded.summary.last30Days.totalTokens,365000);
});

test('tiered >200k pricing and canonical model normalization work cleanly',()=>{
  assert.deepEqual(canonicalizeModel('gemini-4-hydrogen-tiered-high','Gemini 4 Hydrogen (High)'),{
    modelId:'gemini-4-hydrogen',displayName:'Gemini 4 Hydrogen'
  });
  assert.deepEqual(canonicalizeModel('gemini-4-argon-d','Gemini 4 Argon (Medium)'),{
    modelId:'gemini-4-argon',displayName:'Gemini 4 Argon'
  });
  assert.deepEqual(canonicalizeModel('gemini-pro-orchestrator','Orchestrator (Carbon)'),{
    modelId:'gemini-pro-orchestrator',displayName:'Orchestrator (Carbon)'
  });
  const price={in:0.00000125,out:0.00001,cr:0.0000003125,in200k:0.0000025,out200k:0.000015};
  // 100k standard in + 300k >200k in + 10k >200k out
  const cost=computeTokenCost({
    inputTokens:400000,outputTokens:10000,cacheReadTokens:0,cacheWriteTokens:0,
    input200k:300000,output200k:10000,cacheRead200k:0,cacheWrite200k:0
  },price);
  assert.equal(cost.priceKnown,true);
  // 0.1M * 1.25 + 0.3M * 2.5 + 0.01M * 15 = 0.125 + 0.75 + 0.15 = 1.025
  assert.equal(cost.estimatedCostUsd,1.025);
});

test('gui-worker refreshUsage triggers immediate usage scan while quota refresh does not',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-gui-usage-pipe-'));
  const source=fileURLToPath(new URL('../',import.meta.url));
  fs.cpSync(path.join(source,'runtime'),path.join(root,'runtime'),{recursive:true});
  fs.cpSync(path.join(source,'.codex-plugin'),path.join(root,'.codex-plugin'),{recursive:true});
  const dataDir=path.join(root,'data');
  fs.mkdirSync(dataDir,{recursive:true});
  // Seed a fresh (<1h) cached summary for today so startup does not auto-scan.
  const nowDate=new Date();
  const todayDate=`${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,'0')}-${String(nowDate.getDate()).padStart(2,'0')}`;
  const cachedSummary={
    version:2,updatedAt:nowDate.getTime(),todayDate,
    disclaimer:'test',pricingUpdatedAt:Date.now(),pricingSource:'litellm',pricingStale:false,
    today:{totalTokens:1234,inputTokens:1000,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:234,responseOutputTokens:234,thinkingOutputTokens:0,calls:1,estimatedCostUsd:0.01,hasUnknownPrice:false,topModels:[],models:[]},
    last3Days:{totalTokens:1234,inputTokens:1000,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:234,responseOutputTokens:234,thinkingOutputTokens:0,calls:1,estimatedCostUsd:0.01,hasUnknownPrice:false,topModels:[],models:[]},
    last7Days:{totalTokens:1234,inputTokens:1000,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:234,responseOutputTokens:234,thinkingOutputTokens:0,calls:1,estimatedCostUsd:0.01,hasUnknownPrice:false,topModels:[],models:[]},
    last30Days:{totalTokens:1234,inputTokens:1000,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:234,responseOutputTokens:234,thinkingOutputTokens:0,calls:1,estimatedCostUsd:0.01,hasUnknownPrice:false,topModels:[],models:[]}
  };
  fs.writeFileSync(path.join(dataDir,USAGE_STATS_FILENAME),JSON.stringify(cachedSummary));
  // Replace gemini-usage.mjs & gemini-usage-stats.mjs with isolated mocks.
  fs.writeFileSync(path.join(root,'runtime/gemini-usage.mjs'),`
    export {atomicJson} from './usage.mjs';
    export const resolveCodexExecutable=v=>v;
    export async function readUsage(){return {ok:true,queryOk:true,accountKey:'g',windows:[],observedAt:Date.now()};}
  `);
  fs.writeFileSync(path.join(root,'runtime/gemini-usage-stats.mjs'),`
    import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
    export const USAGE_SCAN_INTERVAL_MS=${USAGE_SCAN_INTERVAL_MS};
    export function loadSavedUsageStats(dir){return JSON.parse(fs.readFileSync(path.join(dir,'usage-stats.json'),'utf8'));}
    if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
      const force=process.argv.includes('--force');
      fs.appendFileSync(path.join(process.argv[2],'scan-invocations.log'),JSON.stringify({force})+'\\n');
      process.stdout.write(JSON.stringify({scanned:true,summary:{...${JSON.stringify(cachedSummary)},updatedAt:Date.now(),today:{...${JSON.stringify(cachedSummary.today)},totalTokens:9999}}})+'\\n');
    }
  `);
  const config=path.join(root,'config.json');
  fs.writeFileSync(config,JSON.stringify({dataDir,codexPath:process.execPath}));
  const child=spawn(process.execPath,[path.join(root,'runtime/gemini-watch.mjs'),config,String(process.pid),'--inherit-stop'],{
    env:{...process.env,AI_PETS_GUI_STDIO:'1'},stdio:['pipe','pipe','pipe']
  });
  const messages=[];let buffer='',errors='',exited=false;
  child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){messages.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);}});
  child.stderr.on('data',b=>{errors+=b;});
  const exit=new Promise(r=>child.on('exit',(code,signal)=>{exited=true;r({code,signal});}));
  const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;if(exited)throw new Error(errors||'exited');await new Promise(r=>setTimeout(r,20));}throw new Error(errors||'timeout');};
  t.after(async()=>{if(!exited){child.stdin.end();await exit;}fs.rmSync(root,{recursive:true,force:true});});

  // Startup publishes cached stats without scanning.
  await wait(()=>messages.some(m=>m.type==='usageStats'&&m.stats.today.totalTokens===1234));
  // Quota-only refresh must NOT trigger usage scan.
  const scanLog=path.join(dataDir,'scan-invocations.log');
  child.stdin.write(JSON.stringify({type:'refresh'})+'\n');
  await wait(()=>messages.some(m=>m.type==='snapshot'));
  await new Promise(r=>setTimeout(r,150));
  assert.equal(fs.existsSync(scanLog),false);

  // Explicit refreshUsage triggers immediate forced scan and publishes fresh summary.
  child.stdin.write(JSON.stringify({type:'refreshUsage'})+'\n');
  await wait(()=>messages.some(m=>m.type==='usageStats'&&m.stats.today.totalTokens===9999));
  const invocations=fs.readFileSync(scanLog,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(invocations,[{force:true}]);
});
