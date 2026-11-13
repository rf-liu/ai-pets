import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {conversationDatabase} from './gemini-generation-index.mjs';
import {visitMetadata,stepMetadata} from './gemini-step-time.mjs';

const execute=promisify(execFile);
const NORMAL_REASONS=new Set(['EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL','EXECUTOR_TERMINATION_REASON_TERMINAL_STEP_TYPE']);
export function hasUnfinishedWork(row){
  return row.status!=='CASCADE_RUN_STATUS_IDLE'||row.notFullyIdle||row.hasActiveChildren||row.hasRunningSubagents||row.waitingStepCount>0;
}
export function fullyIdle(row){
  return !hasUnfinishedWork(row)&&NORMAL_REASONS.has(row.reason)&&!row.killed&&!row.interrupted&&row.waitingStepCount===0;
}
// AGY can report the parent IDLE without hasRunningSubagents while a linked
// browser agent is RUNNING. Use explicit IDs, never titles or activity text.
export function activeDescendantRoots(rows){
  const byId=new Map(rows.map(row=>[row.id,row])),blocked=new Set();
  for(const row of rows){
    if(!hasUnfinishedWork(row))continue;
    if(row.rootId&&row.rootId!==row.id)blocked.add(row.rootId);
    const seen=new Set([row.id]);let parent=row.parentId;
    while(parent&&!seen.has(parent)){
      seen.add(parent);blocked.add(parent);parent=byId.get(parent)?.parentId;
    }
  }
  return blocked;
}
export function executorMetadata(bytes){
  try{
    const result={reason:0,invocations:0,lastStepIndex:0,autoContinue:false,executionId:null,error:false};
    visitMetadata(bytes,(field,wire,value)=>{
      if(wire===0&&[1,2,3].includes(field)){
        const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw new Error('Invalid executor counter');
        result[field===1?'reason':field===2?'invocations':'lastStepIndex']=number;
      }else if(field===4&&wire===0)result.autoContinue=value!==0n;
      else if(field===9&&wire===2&&value.length>0&&value.length<=256)result.executionId=value.toString('utf8');
      else if(field===12&&wire===2)result.error=value.length>0;
    });
    return result;
  }catch{return null;}
}
export function verifiedTaskEnd(row,execution,steps){
  const user=row.lastUserInputStepIndex;
  if(!fullyIdle(row)||!Number.isSafeInteger(user)||user<0||!execution?.executionId||execution.error||execution.autoContinue||
    ![4,8].includes(execution.reason)||execution.lastStepIndex<=user||execution.lastStepIndex>=row.stepCount)return null;
  // Summary reasons can describe the previous executor. The database must agree.
  if((execution.reason===4)!==(row.reason==='EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL'))return null;
  const first=steps.find(step=>step.idx===user),last=steps.find(step=>step.idx===execution.lastStepIndex);
  if(first?.step_type!==14||first.status!==3||last?.status!==3)return null;
  if(!(execution.reason===4&&last.step_type===15 || execution.reason===8&&last.step_type===2))return null;
  // A final-looking reply can precede completion of an earlier browser/tool
  // invocation. Check the entire current input interval, not only the tail.
  const terminalStatuses=new Set([3,4,5,6,7,12]);
  if(steps.some(step=>step.idx>=user&&step.idx<row.stepCount&&!terminalStatuses.has(step.status)))return null;
  // Only completed housekeeping may follow the final reply. Generic tools,
  // another user input, waiting steps and partial reads cannot prove an end.
  const trailing=steps.filter(step=>step.idx>execution.lastStepIndex);
  if(trailing.length!==row.stepCount-execution.lastStepIndex-1||trailing.some(step=>step.status!==3||![23,101].includes(step.step_type)))return null;
  const begin=stepMetadata(Buffer.from(first.metadata??'','hex')),end=stepMetadata(Buffer.from(last.metadata??'','hex'));
  if(!begin||![3,4].includes(begin.source)||!end||end.executionId!==execution.executionId)return null;
  const endedAt=end.completedAt??end.generatedAt;
  if(!Number.isFinite(begin.createdAt)||!Number.isFinite(endedAt)||endedAt<=begin.createdAt)return null;
  return {userInputStepIndex:user,lastStepIndex:execution.lastStepIndex,executionId:execution.executionId,
    startedAt:begin.createdAt,endedAt,invocations:execution.invocations};
}
export async function readTaskEnd(row,{conversationsRoot=path.join(os.homedir(),'.gemini','antigravity','conversations')}={}){
  if(!fullyIdle(row)||!Number.isSafeInteger(row.lastUserInputStepIndex))return null;
  const file=await conversationDatabase(row.id,conversationsRoot);
  const {stdout}=await execute('/usr/bin/sqlite3',['-readonly','-json',file,
    'SELECT CASE WHEN length(data)<=131072 THEN hex(data) ELSE NULL END AS data FROM executor_metadata ORDER BY idx DESC LIMIT 1;'],{timeout:2000,maxBuffer:512*1024});
  const raw=JSON.parse(stdout||'[]')[0]?.data;if(typeof raw!=='string'||raw.length>262144)return null;
  const execution=executorMetadata(Buffer.from(raw,'hex'));
  if(!execution||execution.lastStepIndex<=row.lastUserInputStepIndex||execution.lastStepIndex>=row.stepCount)return null;
  const user=row.lastUserInputStepIndex,last=execution.lastStepIndex;
  // Include at most one unfinished middle step as a rejection sentinel. This
  // stays bounded even for long conversations and never reads step_payload.
  const query=`SELECT idx,step_type,status,CASE WHEN idx IN (${user},${last}) AND length(metadata)<=65536 THEN hex(metadata) ELSE NULL END AS metadata FROM steps WHERE idx=${user} OR idx>=${last} OR idx=(SELECT idx FROM steps WHERE idx>${user} AND idx<${last} AND (status IS NULL OR status NOT IN (3,4,5,6,7,12)) LIMIT 1) ORDER BY idx LIMIT 67;`;
  const result=await execute('/usr/bin/sqlite3',['-readonly','-json',file,query],{timeout:2000,maxBuffer:512*1024});
  return verifiedTaskEnd(row,execution,JSON.parse(result.stdout||'[]'));
}
