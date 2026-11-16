import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readClaudeSessions,clearLocalSessionCaches} from '../runtime/local-sessions.mjs';
test('unchanged Claude desktop metadata is read once across 600 session updates and edits still load',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-claude-meta-')),prior=process.env.HOME;
 process.env.HOME=root;
 const dir=path.join(root,'Library/Application Support/Claude/claude-code-sessions/account/workspace');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'local_fixture.json');fs.writeFileSync(file,JSON.stringify({cliSessionId:'fixture',title:'before',lastActivityAt:1}));
 const original=fs.readFileSync;let reads=0;
 fs.readFileSync=function(p,...args){if(p===file)reads++;return original.call(this,p,...args);};
 t.after(()=>{fs.readFileSync=original;if(prior===undefined)delete process.env.HOME;else process.env.HOME=prior;clearLocalSessionCaches('claude');fs.rmSync(root,{recursive:true,force:true});});
 for(let i=0;i<600;i++)assert.equal(readClaudeSessions()[0]?.title,'before');
 assert.equal(reads,1);
 fs.writeFileSync(file,JSON.stringify({cliSessionId:'fixture',title:'after!',lastActivityAt:2}));
 assert.equal(readClaudeSessions()[0]?.title,'after!');assert.equal(reads,2);
});
