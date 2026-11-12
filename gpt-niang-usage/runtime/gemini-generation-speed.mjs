import {callRPC} from './gemini-usage.mjs';
import {latestGenerationIndex,generationStepTimes} from './gemini-generation-index.mjs';
import {RecentSpeedSamples,RECENT_WINDOW_MS} from './recent-speed.mjs';

export function durationSeconds(value){
  if(typeof value==='string'){
    if(!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?s$/.test(value))return null;
    const seconds=Number(value.slice(0,-1));
    return Number.isFinite(seconds)?seconds:null;
  }
  if(value&&typeof value==='object'){
    const seconds=counter(value.seconds??0),nanos=counter(value.nanos??0);
    return seconds!==null&&nanos!==null&&nanos<1e9?seconds+nanos/1e9:null;
  }
  return null;
}
function counter(value){
  if(typeof value==='string'&&!/^(?:0|[1-9]\d*)$/.test(value))return null;
  if(typeof value!=='string'&&typeof value!=='number')return null;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0?number:null;
}

export function generationSample(record,{stepTimes=new Map()}={}){
  const chat=record?.chatModel,usage=chat?.usage;
  if(!usage)return null;
  const total=counter(usage.outputTokens),response=counter(usage.responseOutputTokens),thinking=counter(usage.thinkingOutputTokens);
  for(const key of ['outputTokens','responseOutputTokens','thinkingOutputTokens'])if(usage[key]!==undefined&&counter(usage[key])===null)return null;
  if(total!==null&&response!==null&&thinking!==null&&total!==response+thinking)return null;
  const output=total??(response!==null&&thinking!==null?response+thinking:null);
  const first=durationSeconds(chat.timeToFirstToken),stream=durationSeconds(chat.streamingDuration);
  if(output===null||first===null||stream===null||first+stream<=0)return null;
  const seconds=first+stream,rate=output/seconds;
  if(!Number.isFinite(rate))return null;
  let sampleAt=null;
  for(const index of Array.isArray(record.stepIndices)?record.stepIndices:[]){
    const value=stepTimes.get(index);
    if(Number.isFinite(value)&&(sampleAt===null||value>sampleAt))sampleAt=value;
  }
  return {tokensPerSecond:rate,outputTokens:output,intervalSeconds:seconds,
    timeToFirstTokenSeconds:first,streamingSeconds:stream,
    responseOutputTokens:response,thinkingOutputTokens:thinking,
    modelName:String(chat.modelDisplayName||chat.responseModel||usage.model||'').slice(0,100),
    measurement:'generation-average',sampleAt,timeSource:sampleAt===null?null:'step-finished-generating-at'};
}

export function latestGeneration(raw,{history=new RecentSpeedSamples(),now=Date.now(),offset=0,stepTimes=new Map()}={}){
  const records=(raw?.response??raw)?.generatorMetadata;
  if(!Array.isArray(records))throw new Error('Missing generation metadata');
  let latest=null,oldest=Infinity;
  for(let i=0;i<records.length;i++){
    const sample=generationSample(records[i],{stepTimes});
    if(!sample)continue;
    latest=sample;
    if(Number.isFinite(sample.sampleAt))oldest=Math.min(oldest,sample.sampleAt);
    history.add(offset+i,sample);
  }
  history.partial=offset>0&&oldest>now-RECENT_WINDOW_MS;
  return latest?{...latest,...history.snapshot(now)}:null;
}

export async function readGenerationSpeed(id,{rpc=callRPC,index=latestGenerationIndex,readTimes=generationStepTimes,history=new RecentSpeedSamples(),now=Date.now()}={}){
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('invalid session id');
  let offset=0;
  // Metadata only: bounded history for smoothing, never conversation messages.
  try{const value=await index(id);if(Number.isSafeInteger(value)&&value>=0)offset=Math.max(0,value-255);}catch{}
  const raw=await rpc('GetCascadeTrajectoryGeneratorMetadata',{cascadeId:id,generatorMetadataOffset:offset,includeMessages:false});
  const records=(raw?.response??raw)?.generatorMetadata;
  let stepTimes=new Map();
  try{stepTimes=await readTimes(id,Array.isArray(records)?records.flatMap(record=>record.stepIndices??[]):[]);}catch{}
  return latestGeneration(raw,{history,now,offset,stepTimes});
}
