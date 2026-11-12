import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {latestGenerationIndex} from '../runtime/gemini-generation-index.mjs';
const id='00000000-0000-0000-0000-000000000001';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-generation-index-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('generation index reads only MAX(idx), without changing the database or parsing blobs',async t=>{
  const root=fixture(t),file=path.join(root,id+'.db');
  execFileSync('/usr/bin/sqlite3',[file,'CREATE TABLE gen_metadata(idx INTEGER,data BLOB); INSERT INTO gen_metadata VALUES(1,zeroblob(524288)),(42,zeroblob(524288));']);
  const hash=()=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=hash();
  assert.equal(await latestGenerationIndex(id,{conversationsRoot:root}),42);assert.equal(hash(),before);
});
test('empty generation metadata stays unknown',async t=>{
  const root=fixture(t);execFileSync('/usr/bin/sqlite3',[path.join(root,id+'.db'),'CREATE TABLE gen_metadata(idx INTEGER);']);
  assert.equal(await latestGenerationIndex(id,{conversationsRoot:root}),null);
});
test('invalid session ids and symlink escapes are rejected',async t=>{
  const root=fixture(t),base=path.join(root,'allowed');fs.mkdirSync(base);const outside=path.join(root,'private.db');fs.writeFileSync(outside,'');
  fs.symlinkSync(outside,path.join(base,id+'.db'));await assert.rejects(latestGenerationIndex(id,{conversationsRoot:base}),/outside/);
  await assert.rejects(latestGenerationIndex('../private',{conversationsRoot:base}),/invalid/);
});
