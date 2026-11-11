import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {requestRefresh,readPendingRequests,completeRequests} from '../runtime/refresh-client.mjs';
test('obsolete app-update markers no longer block normal local refresh requests',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'no-updater-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const marker=path.join(dir,'update-installing.json'),original=JSON.stringify({pid:process.pid});fs.writeFileSync(marker,original);
 const expected={ok:true,queryOk:true,windows:[]};let starts=0;
 const actual=await requestRefresh({dataDir:dir},'unused',{timeoutMs:1000,pollMs:10,startWorker:()=>{starts++;completeRequests(dir,readPendingRequests(dir),expected)}});
 assert.deepEqual(actual,expected);assert.equal(starts,1);assert.equal(fs.readFileSync(marker,'utf8'),original);
});
