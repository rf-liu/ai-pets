import test from 'node:test';
import assert from 'node:assert/strict';
import {displayThreadName,isUserConversation,userThreadsSQL} from '../runtime/speed-titles.mjs';
import {execFileSync} from 'node:child_process';
test('sidebar name wins over attachment preamble or an old first message',()=>{
 assert.equal(displayThreadName({name:'按图片创建并选择宠物',title:'# Files mentioned by the user:\nprivate/path'}),'按图片创建并选择宠物');
 assert.equal(displayThreadName({name:'已重命名聊天',title:'旧名字'}),'已重命名聊天');
});
test('fallback avoids ambient context and attachment paths',()=>{
 assert.equal(displayThreadName({title:'<in-app-browser-context>ambient state'}),'未命名聊天');
 assert.equal(displayThreadName({title:'# Files mentioned by the user:\nfile.png\n## My request:\n帮我修复挂件'}),'帮我修复挂件');
 assert.equal(displayThreadName({title:'普通聊天\n第二行'}),'普通聊天');
});
test('background reviews and unnamed exec tasks are excluded by origin, not by a human chosen name',()=>{
 assert.equal(isUserConversation({source:'{"subagent":{"other":"guardian"}}',name:'Guardian review'}),false);
 assert.equal(isUserConversation({source:'exec',name:null}),false);
 assert.equal(isUserConversation({source:'vscode',name:'Guardian review'}),true);
 assert.equal(isUserConversation({source:'exec',name:'我自己的 CLI 聊天'}),true);
});
test('filtering happens before LIMIT so reviews cannot crowd actual chats out',()=>{
 const script=`CREATE TABLE threads(id TEXT,name TEXT,title TEXT,source TEXT,rollout_path TEXT,archived INTEGER,updated_at INTEGER);
 INSERT INTO threads VALUES('real','实际聊天','附件正文','vscode','/real',0,1);
 INSERT INTO threads VALUES('manual','自己的聊天','old','exec','/manual',0,2);
 WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20)
 INSERT INTO threads SELECT 'bg'||x,'Guardian review','review','{"subagent":{"other":"guardian"}}','/bg',0,x+10 FROM n;
 ${userThreadsSQL}`;
 const rows=JSON.parse(execFileSync('/usr/bin/sqlite3',['-json',':memory:',script],{encoding:'utf8'}));
 assert.deepEqual(rows.map(x=>x.id),['manual','real']);
});
