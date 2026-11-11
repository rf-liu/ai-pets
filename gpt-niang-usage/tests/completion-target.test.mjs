import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {CompletionTargetResolver} from '../runtime/completion-target.mjs';
import {CompletionMonitor} from '../runtime/completion-monitor.mjs';
const id='00000000-0000-0000-0000-000000000001',wrong='00000000-0000-0000-0000-000000000002';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'completion-target-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'sessions');fs.mkdirSync(dir);const file=path.join(dir,'rollout-'+wrong+'.jsonl');
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id,source:'vscode'}})+'\n');
 const db=path.join(root,'state_5.sqlite');
 const sql=`CREATE TABLE threads(id TEXT,name TEXT,title TEXT,source TEXT,rollout_path TEXT); INSERT INTO threads VALUES('${id}','实际对话','原始消息','vscode','${file}');`;
 execFileSync('/usr/bin/sqlite3',[db,sql]);return {root,file,db};
}
test('real header/index ID wins even when a filename contains another valid UUID',t=>{
 const {root,file}=fixture(t);assert.deepEqual(new CompletionTargetResolver(root).resolve(file,id),{conversationId:id,conversationTitle:'实际对话'});
});
test('mismatched path, missing index, or invalid IDs fall back without guessing a filename UUID',t=>{
 const {root,file,db}=fixture(t),r=new CompletionTargetResolver(root);
 assert.deepEqual(r.resolve(file,wrong),{});assert.deepEqual(r.resolve(file,'not-a-uuid'),{});
 execFileSync('/usr/bin/sqlite3',[db,"UPDATE threads SET rollout_path='/wrong/file';"]);assert.deepEqual(r.resolve(file,id),{});
 fs.unlinkSync(db);assert.deepEqual(r.resolve(file,id),{});
});
test('automatic exec reviews are not user completion destinations',t=>{
 const {root,file,db}=fixture(t);execFileSync('/usr/bin/sqlite3',[db,"UPDATE threads SET source='exec',name=NULL;"]);
 assert.deepEqual(new CompletionTargetResolver(root).resolve(file,id),{excluded:true});
});
test('emitted completion binds the verified ID and sidebar name rather than its filename',t=>{
 const {root,file}=fixture(t),found=[],now=Date.now();
 const monitor=new CompletionMonitor({codexHome:root,since:now-100,onNotification:x=>found.push(x)});monitor.scan(true);
 fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type:'task_complete',turn_id:'one'}})+'\n');monitor.scan();
 assert.equal(found.length,1);assert.equal(found[0].conversationId,id);assert.equal(found[0].conversationTitle,'实际对话');
});
