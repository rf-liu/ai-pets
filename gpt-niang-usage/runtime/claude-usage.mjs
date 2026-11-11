export {atomicJson,resolveCodexExecutable} from './bridge-usage.mjs';
import {readBridge} from './bridge-usage.mjs';
export const readUsage=(_unused,options)=>readBridge('claude',options);
