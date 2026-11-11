import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {displayThreadName,isUserConversation,userThreadsSQL} from './speed-titles.mjs';

// Completed request output includes reasoning. Duration includes first-token,
// tools, network and approval waits. No prompts or message bodies are emitted.
export function sampleInterval(previous, next) {
  if (!previous || !next || !Number.isFinite(previous.at) || !Number.isFinite(next.at)) return null;
  const seconds = (next.at - previous.at) / 1000;
  const outputTokens = next.outputTokens - previous.outputTokens;
  if (seconds <= 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  return {outputTokens, seconds, tokensPerSecond: outputTokens / seconds, at: next.at};
}
export class RolloutCounters {
  constructor() {
    this.total = null; this.reasoning = null; this.active = null;
    this.latest = null; this.state = 'unknown'; this.lastAt = null; this.model = null;
  }
  accept(record) {
    if (record?.type === 'turn_context') {
      const p=record.payload??{};
      if(typeof p.model==='string')this.model=p.model.slice(0,100)+(typeof p.effort==='string'?' · '+p.effort:'');
      if(this.active){
        if(this.active.seen&&this.active.model!==this.model)this.active.mixedModels=true;
        this.active.model=this.model;
      }
      return;
    }
    if(record?.type==='response_item'){
      const p=record.payload??{};
      if(this.active&&(p.role==='assistant'||['reasoning','function_call'].includes(p.type)))this.active.generated=true;
      return;
    }
    if (record?.type !== 'event_msg') return;
    const event = record.payload;
    const at = Date.parse(record.timestamp);
    if (!Number.isFinite(at)) return;
    if (event?.type === 'task_started') {
      const start=eventTime(event.started_at)??at;
      this.active={id:event.turn_id,start,output:0,reasoning:0,reasoningKnown:true,seen:false,incomplete:false,generated:false,model:this.model};
      this.state='running';this.lastAt=at;return;
    }
    if(['agent_message','agent_reasoning'].includes(event?.type)){
      if(this.active)this.active.generated=true;return;
    }
    if(['task_complete','turn_aborted'].includes(event?.type)){
      const turn=this.active;
      if(turn?.id&&event.turn_id&&turn.id!==event.turn_id)return;
      this.state=event.type==='turn_aborted'?'aborted':'idle';this.lastAt=at;
      if(event.type==='task_complete'&&turn?.seen&&!turn.incomplete){
        const end=eventTime(event.completed_at)??at;
        const seconds=typeof event.duration_ms==='number'&&event.duration_ms>0?event.duration_ms/1000:(end-turn.start)/1000;
        if(Number.isFinite(seconds)&&seconds>0&&turn.output>=turn.reasoning){
          const first=typeof event.time_to_first_token_ms==='number'&&event.time_to_first_token_ms>=0?event.time_to_first_token_ms/1000:null;
          this.latest={at:end,outputTokens:turn.output,seconds,tokensPerSecond:turn.output/seconds,
            reasoningOutputTokens:turn.reasoningKnown?turn.reasoning:null,
            responseOutputTokens:turn.reasoningKnown?turn.output-turn.reasoning:null,
            timeToFirstTokenSeconds:first,modelName:turn.mixedModels?'混合模型 / 思考档':turn.model,measurement:'request-average'};
        }
      }
      this.active=null;return;
    }
    if (event?.type !== 'token_count') return;
    const info=event.info,total=info?.total_token_usage?.output_tokens,reason=info?.total_token_usage?.reasoning_output_tokens;
    if(!counter(total))return;
    if(this.total===total&&this.reasoning===(counter(reason)?reason:null))return;
    const turn=this.active;
    if(turn){
      let delta=null,reasonDelta=null;
      if(this.total!==null){delta=total-this.total;if(counter(reason)&&this.reasoning!==null)reasonDelta=reason-this.reasoning;}
      else{
        const last=info?.last_token_usage;
        // A tail can begin after an older turn. Bootstrap only a witnessed
        // generation (or a proven first-ever counter), never historical totals.
        if(counter(last?.output_tokens)&&(turn.generated||total===last.output_tokens)){
          delta=last.output_tokens;
          if(counter(last.reasoning_output_tokens))reasonDelta=last.reasoning_output_tokens;
        }else turn.incomplete=true;
      }
      if(delta!==null){
        if(delta<0||(reasonDelta!==null&&reasonDelta<0))turn.incomplete=true;
        else{turn.output+=delta;turn.seen=true;if(reasonDelta===null)turn.reasoningKnown=false;else turn.reasoning+=reasonDelta;}
      }
      turn.generated=false;
    }
    this.total=total;this.reasoning=counter(reason)?reason:null;this.lastAt=at;
  }
}
function counter(value){return Number.isSafeInteger(value)&&value>=0;}
function eventTime(value){
  if(typeof value==='number'&&Number.isFinite(value))return value<1e12?value*1000:value;
  if(typeof value==='string'){const at=Date.parse(value);if(Number.isFinite(at))return at;}
  return null;
}
export class RolloutTail {
  constructor(file) { this.file = file; this.offset = 0; this.pending = ''; this.counters = new RolloutCounters(); this.identity = null; }
  update() {
    const stat = fs.statSync(this.file);
    if (stat.ino !== this.identity || stat.size < this.offset) {
      this.identity = stat.ino; this.offset = Math.max(0, stat.size - 4 * 1024 * 1024);
      this.pending = ''; this.counters = new RolloutCounters();
      this.skipFirst = this.offset > 0;
    }
    const remaining = Math.min(stat.size - this.offset, 4 * 1024 * 1024);
    if (remaining <= 0) return this.counters;
    const buffer = Buffer.alloc(remaining);
    const fd = fs.openSync(this.file, 'r');
    let count;
    try { count = fs.readSync(fd, buffer, 0, remaining, this.offset); } finally { fs.closeSync(fd); }
    this.offset += count;
    // Counters/timestamps are ASCII; a partial UTF-8 content line is never emitted.
    const lines = (this.pending + buffer.subarray(0, count).toString('utf8')).split('\n');
    this.pending = lines.pop();
    if (this.pending.length > 1024 * 1024) { this.pending = ''; this.skipFirst = true; }
    if (this.skipFirst && lines.length) { lines.shift(); this.skipFirst = false; }
    for (const line of lines) {
      if (!['"event_msg"','"turn_context"','"response_item"'].some(type=>line.includes(type))) continue;
      try { this.counters.accept(JSON.parse(line)); } catch {}
    }
    return this.counters;
  }
}
export function allowedRollout(file, codexHome) {
  try {
    const real = fs.realpathSync(file);
    return ['sessions', 'archived_sessions'].some(name => {
      let directory;
      try { directory = fs.realpathSync(path.join(codexHome, name)); } catch { return false; }
      const relative = path.relative(directory, real);
      return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) && real.endsWith('.jsonl');
    }) ? real : null;
  } catch { return null; }
}
function run() {
  const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex');
  const tails = new Map();
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  function update() {
    try {
      const databases = fs.readdirSync(codexHome).filter(name => /^state_\d+\.sqlite$/.test(name))
        .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
      if (!databases.length) throw new Error('目前沒有可讀取的本機聊天索引');
      const result = spawnSync('/usr/bin/sqlite3', ['-readonly', '-json', path.join(codexHome, databases[0]),
        userThreadsSQL],
        {encoding: 'utf8', timeout: 2000, maxBuffer: 256 * 1024});
      if (result.status !== 0) throw new Error('本機聊天索引暫時無法讀取');
      const rows = JSON.parse(result.stdout || '[]').filter(isUserConversation);
      const active = new Set();
      const threads = rows.map(row => {
        const file = allowedRollout(row.rollout_path, codexHome);
        const output = {id: row.id, title: displayThreadName(row), tokensPerSecond: null, sampleAt: null, state: 'unavailable'};
        if (!file) return output;
        active.add(file);
        try {
          if (!tails.has(file)) tails.set(file, new RolloutTail(file));
          const counters = tails.get(file).update();
          return {...output, state: counters.state, sampleAt: counters.latest?.at ?? null,
            tokensPerSecond: counters.latest?.tokensPerSecond ?? null,
            outputTokens: counters.latest?.outputTokens ?? null, intervalSeconds: counters.latest?.seconds ?? null,
            measurement:counters.latest?.measurement??'request-average',modelName:counters.latest?.modelName??counters.model,
            timeToFirstTokenSeconds:counters.latest?.timeToFirstTokenSeconds??null,
            reasoningOutputTokens:counters.latest?.reasoningOutputTokens??null,
            responseOutputTokens:counters.latest?.responseOutputTokens??null,
            unavailableReason:counters.latest?null:'尚无完整的已完成回复计数与耗时，下一次回复完成后会更新。'};
        } catch { return output; }
      });
      for (const file of tails.keys()) if (!active.has(file)) tails.delete(file);
      send({threads, at: Date.now(), error: null});
    } catch (error) { send({threads: [], at: Date.now(), error: error.message}); }
  }
  update();
  const timer = setInterval(update, 3000);
  process.stdin.resume();
  process.stdin.on('end', () => { clearInterval(timer); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();
