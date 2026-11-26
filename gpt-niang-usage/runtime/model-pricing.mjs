import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readJson} from './worker-state.mjs';

export const LITELLM_PRICING_URL='https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const PRICING_REFRESH_INTERVAL_MS=24*60*60*1000;
export const PRICING_CACHE_FILENAME='pricing-cache.json';
const MAX_PRICING_BYTES=8*1024*1024;
const ALLOWED_MODES=new Set(['chat','responses','completion']);
const OFFICIAL_PREFIXES=new Set(['gemini','anthropic','openai']);
const NON_OFFICIAL_DOT_PREFIX=/^(?:us|eu|au|jp|ap|global|anthropic|amazon|meta|mistral|cohere|ai21|deepseek|qwen|moonshot)\./i;

const nonNeg=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

export function atomicCompactJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value),'utf8');
  fs.renameSync(tmp,file);
}

function isOfficialPricingKey(lowerKey){
  const slash=lowerKey.indexOf('/');
  if(slash>=0){
    const prefix=lowerKey.slice(0,slash);
    const rest=lowerKey.slice(slash+1);
    return OFFICIAL_PREFIXES.has(prefix)&&!rest.includes('/');
  }
  return !NON_OFFICIAL_DOT_PREFIX.test(lowerKey);
}

export function slimPricingTable(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const models={};
  let count=0;
  for(const [key,entry] of Object.entries(raw)){
    if(key==='sample_spec'||!entry||typeof entry!=='object')continue;
    const lowerKey=key.toLowerCase();
    if(!isOfficialPricingKey(lowerKey))continue;
    if(typeof entry.mode==='string'&&entry.mode&&!ALLOWED_MODES.has(entry.mode))continue;
    const input=nonNeg(entry.input_cost_per_token);
    const output=nonNeg(entry.output_cost_per_token);
    if(input===null||output===null)continue;
    const compact={in:input,out:output};
    const cr=nonNeg(entry.cache_read_input_token_cost);
    const cw=nonNeg(entry.cache_creation_input_token_cost);
    const in200k=nonNeg(entry.input_cost_per_token_above_200k_tokens);
    const out200k=nonNeg(entry.output_cost_per_token_above_200k_tokens);
    const cr200k=nonNeg(entry.cache_read_input_token_cost_above_200k_tokens);
    const cw200k=nonNeg(entry.cache_creation_input_token_cost_above_200k_tokens);
    if(cr!==null)compact.cr=cr;
    if(cw!==null)compact.cw=cw;
    if(in200k!==null)compact.in200k=in200k;
    if(out200k!==null)compact.out200k=out200k;
    if(cr200k!==null)compact.cr200k=cr200k;
    if(cw200k!==null)compact.cw200k=cw200k;
    models[lowerKey]=compact;
    count++;
  }
  return count>0?models:null;
}

export function loadPricingCache(dataDir){
  const file=path.join(dataDir,PRICING_CACHE_FILENAME);
  const parsed=readJson(file);
  if(!parsed||typeof parsed!=='object'||!parsed.models||typeof parsed.models!=='object')return null;
  const fetchedAt=typeof parsed.fetchedAt==='number'&&Number.isFinite(parsed.fetchedAt)?parsed.fetchedAt:null;
  if(fetchedAt===null)return null;
  return {fetchedAt,source:typeof parsed.source==='string'?parsed.source:'litellm',models:parsed.models};
}

export async function ensurePricing(dataDir,{now=Date.now(),fetchImpl=globalThis.fetch,url=LITELLM_PRICING_URL,force=false,timeoutMs=12000}={}){
  const cached=dataDir?loadPricingCache(dataDir):null;
  const fresh=cached&&now-cached.fetchedAt>=0&&now-cached.fetchedAt<PRICING_REFRESH_INTERVAL_MS;
  if(fresh&&!force){
    return {models:cached.models,updatedAt:cached.fetchedAt,stale:false,source:'litellm-cache',fetched:false};
  }
  if(typeof fetchImpl!=='function'){
    return cached
      ?{models:cached.models,updatedAt:cached.fetchedAt,stale:true,source:'litellm-cache',fetched:false,error:'pricing-fetch-unavailable'}
      :{models:{},updatedAt:null,stale:true,source:'unavailable',fetched:false,error:'pricing-fetch-unavailable'};
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    // Privacy: plain GET with zero user/device/model identifiers.
    const response=await fetchImpl(url,{method:'GET',signal:controller.signal});
    if(!response?.ok)throw new Error('HTTP '+(response?.status??'error'));
    const text=await response.text();
    if(Buffer.byteLength(text,'utf8')>MAX_PRICING_BYTES)throw new Error('Pricing table too large');
    const models=slimPricingTable(JSON.parse(text));
    if(!models)throw new Error('Invalid pricing payload');
    if(dataDir){
      fs.mkdirSync(dataDir,{recursive:true});
      atomicCompactJson(path.join(dataDir,PRICING_CACHE_FILENAME),{version:1,source:'litellm',fetchedAt:now,models});
    }
    return {models,updatedAt:now,stale:false,source:'litellm',fetched:true};
  }catch{
    if(cached){
      return {models:cached.models,updatedAt:cached.fetchedAt,stale:true,source:'litellm-cache',fetched:false,error:'pricing-fetch-failed'};
    }
    return {models:{},updatedAt:null,stale:true,source:'unavailable',fetched:false,error:'pricing-fetch-failed'};
  }finally{
    clearTimeout(timer);
  }
}

const EFFORT_PARENS=/\s*\((?:low|medium|high|xhigh|minimal|thinking)\)\s*$/i;
const ROUTING_SUFFIX=/-(?:tiered(?:-(?:low|medium|high|xhigh|minimal))?|xhigh|high|medium|low|minimal|thinking)$/i;

export function stripEffortLabel(displayName){
  return String(displayName??'').trim().replace(EFFORT_PARENS,'').trim();
}

export function slugFromDisplayName(displayName){
  const cleaned=stripEffortLabel(displayName).toLowerCase();
  if(!cleaned)return '';
  return cleaned.replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
}

export function canonicalizeModel(responseModel,modelDisplayName,fallbackModel=null){
  const rawResponse=String(responseModel??'').trim();
  const rawDisplay=String(modelDisplayName??'').trim();
  const cleanDisplay=stripEffortLabel(rawDisplay);
  const displaySlug=slugFromDisplayName(rawDisplay);

  let modelId='';
  if(rawResponse){
    modelId=rawResponse.toLowerCase().replace(ROUTING_SUFFIX,'');
    // Match internal variant suffixes like gemini-4-argon-d when displayName cleanly confirms the base slug.
    if(displaySlug&&modelId.startsWith(displaySlug+'-')&&modelId.slice(displaySlug.length+1).length<=2){
      modelId=displaySlug;
    }
  }else if(displaySlug){
    modelId=displaySlug;
  }else if(fallbackModel!==null&&fallbackModel!==undefined&&String(fallbackModel).trim()){
    modelId='model-'+String(fallbackModel).trim().toLowerCase();
  }else{
    modelId='unknown';
  }
  const displayName=cleanDisplay||rawResponse||modelId;
  return {modelId,displayName};
}

function exactOfficialMatch(models,candidate){
  if(!candidate)return null;
  const key=candidate.toLowerCase();
  for(const lookup of [key,'gemini/'+key,'anthropic/'+key,'openai/'+key]){
    const hit=models[lookup];
    if(hit&&nonNeg(hit.in)!==null&&nonNeg(hit.out)!==null)return {key:lookup,price:hit};
  }
  return null;
}

export function lookupModelPrice(models,modelId,displayName=''){
  if(!models||typeof models!=='object')return null;
  const direct=exactOfficialMatch(models,modelId);
  if(direct)return direct;
  const stripped=String(modelId??'').toLowerCase().replace(ROUTING_SUFFIX,'');
  if(stripped&&stripped!==String(modelId??'').toLowerCase()){
    const afterStrip=exactOfficialMatch(models,stripped);
    if(afterStrip)return afterStrip;
  }
  const slug=slugFromDisplayName(displayName);
  if(slug&&slug!==String(modelId??'').toLowerCase()){
    const byDisplay=exactOfficialMatch(models,slug);
    if(byDisplay)return byDisplay;
  }
  return null;
}

export function computeTokenCost(bucket,price){
  if(!price||nonNeg(price.in)===null||nonNeg(price.out)===null){
    return {priceKnown:false,estimatedCostUsd:null};
  }
  const hiIn=Math.max(0,Number(bucket.input200k??0));
  const hiOut=Math.max(0,Number(bucket.output200k??0));
  const hiCr=Math.max(0,Number(bucket.cacheRead200k??0));
  const hiCw=Math.max(0,Number(bucket.cacheWrite200k??0));

  const stdIn=Math.max(0,Number(bucket.inputTokens??0)-hiIn);
  const stdOut=Math.max(0,Number(bucket.outputTokens??0)-hiOut);
  const stdCr=Math.max(0,Number(bucket.cacheReadTokens??0)-hiCr);
  const stdCw=Math.max(0,Number(bucket.cacheWriteTokens??0)-hiCw);

  const crRate=nonNeg(price.cr)??price.in;
  const cwRate=nonNeg(price.cw)??price.in;
  const in200k=nonNeg(price.in200k)??price.in;
  const out200k=nonNeg(price.out200k)??price.out;
  const cr200k=nonNeg(price.cr200k)??nonNeg(price.cr)??in200k;
  const cw200k=nonNeg(price.cw200k)??nonNeg(price.cw)??in200k;

  const cost=stdIn*price.in+stdOut*price.out+stdCr*crRate+stdCw*cwRate
    +hiIn*in200k+hiOut*out200k+hiCr*cr200k+hiCw*cw200k;
  if(!Number.isFinite(cost)||cost<0)return {priceKnown:false,estimatedCostUsd:null};
  return {priceKnown:true,estimatedCostUsd:Number(cost.toFixed(6))};
}
