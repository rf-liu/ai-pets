import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSummary} from '../runtime/gemini-usage.mjs';
import {completedTransition} from '../runtime/gemini-completion-monitor.mjs';
const bucket=(window,fraction)=>({bucketId:'gemini-'+window,window,remainingFraction:fraction,resetTime:'2026-11-09T00:00:00Z'});
test('real wrapped AGY summary selects Gemini 5h/weekly and excludes Claude pool',()=>{
  const result=normalizeSummary({response:{groups:[{displayName:'Claude and GPT models',buckets:[bucket('5h',.1)]},{displayName:'Gemini Models',buckets:[bucket('weekly',.43),bucket('5h',.97)]}]}},{accountKey:'scope'});
  assert.equal(result.ok,true);assert.deepEqual(result.windows.map(w=>w.minutes),[300,10080]);assert.deepEqual(result.windows.map(w=>Math.round(w.remaining)),[97,43]);assert.equal(result.clearPrevious,false);
});
test('weekly-only account never invents a5h window',()=>{const r=normalizeSummary({groups:[{displayName:'Gemini Models',buckets:[bucket('weekly',.5)]}]});assert.equal(r.windows.length,1);assert.equal(r.windows[0].minutes,10080);});
test('missing/invalid remaining values are unavailable, never100percent or exhausted',()=>{for(const value of [undefined,null,-1,2,NaN]){const r=normalizeSummary({groups:[{displayName:'Gemini Models',buckets:[bucket('5h',value)]}]});assert.equal(r.ok,false);assert.equal(r.windows.length,0);}});
test('verified0percent and100percent remain real boundary measurements',()=>{for(const value of [0,1]){const r=normalizeSummary({groups:[{displayName:'Gemini Models',buckets:[bucket('5h',value)]}]});assert.equal(r.ok,true);assert.equal(r.windows[0].remaining,value*100);}});
test('unknown account does not authorize cached reuse',()=>{assert.equal(normalizeSummary({groups:[]}).clearPrevious,true);});
test('completion requires an observed running-to-idle transition',()=>{assert.equal(completedTransition(null,{status:'CASCADE_RUN_STATUS_IDLE'}),false);assert.equal(completedTransition({status:'CASCADE_RUN_STATUS_RUNNING'},{status:'CASCADE_RUN_STATUS_IDLE',reason:'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL'}),true);});
test('cancellation and pending user input never become completed-answer reminders',()=>{for(const reason of ['EXECUTOR_TERMINATION_REASON_USER_CANCELED','WAITING_FOR_USER','INTERRUPTED'])assert.equal(completedTransition({status:'CASCADE_RUN_STATUS_RUNNING'},{status:'CASCADE_RUN_STATUS_IDLE',reason}),false);});
