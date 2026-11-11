export {atomicJson,resolveCodexExecutable} from './bridge-usage.mjs';
import {readBridge,bridgeFile} from './bridge-usage.mjs';
import {appendFinance} from './deepseek-finance.mjs';
import {readDshSessions} from './local-sessions.mjs';
import path from 'node:path';
export const readUsage=async(_unused,options)=>appendFinance(await readBridge('deepseek',options),readDshSessions(),path.join(path.dirname(bridgeFile('deepseek')),'balance-observations.json'));
