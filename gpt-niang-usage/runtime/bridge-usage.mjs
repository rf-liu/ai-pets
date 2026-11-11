import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export {atomicJson} from './usage.mjs';
export const resolveCodexExecutable=value=>value;
const root=path.join(os.homedir(),'Library/Application Support/AIQuotaCompanion');
export function bridgeFile(profile){
 try{const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(config.dataDir)return path.join(config.dataDir,'bridge.json');}catch{}
 return path.join(root,profile,'bridge.json');
}
export function normalizeBridge(profile,raw,now=Date.now()){
 const base={ok:false,queryOk:false,source:profile+'-official-bridge',observedAt:raw?.capturedAt??now,windows:[],accountKey:null,clearPrevious:true,plan:profile,planLabel:profile==='claude'?'Claude':'DeepSeek Harness'};
 if(profile==='claude'){
  const windows=[];
  for(const value of raw?.rateLimits??[]){
   const minutes=value.kind==='five_hour'?300:value.kind==='seven_day'?10080:null;
   if(!minutes||typeof value.percentUsed!=='number'||!Number.isFinite(value.percentUsed)||value.percentUsed<0||value.percentUsed>100)continue;
   const reset=typeof value.resetsAt==='string'?Date.parse(value.resetsAt)/1000:typeof value.resetsAt==='number'?value.resetsAt:null;
   windows.push({minutes,remaining:100-value.percentUsed,resetsAt:Number.isFinite(reset)?reset:null});
  }
  return {...base,ok:windows.length>0,queryOk:windows.length>0,windows,...(windows.length?{}:{error:'Claude 额度尚未接通，未收到官方用量数据。TPS 和完成提醒仍可用于 Code 对话。'})};
 }
 const amounts=new Map();
 if(raw?.status==='ready')for(const [kind,key] of [['recharge','normalWallets'],['bonus','bonusWallets']])for(const wallet of raw[key]??[]){
  const value=typeof wallet.balance==='string'&&wallet.balance.trim()!==''?Number(wallet.balance):NaN;
  if(!['CNY','USD'].includes(wallet.currency)||!Number.isFinite(value))continue;
  const row=amounts.get(wallet.currency)??{currency:wallet.currency,recharge:0,bonus:0};row[kind]+=value;amounts.set(wallet.currency,row);
 }
 const balances=[...amounts.values()];
 return {...base,accountKey:typeof raw?.accountScope==='string'?raw.accountScope:null,ok:balances.length>0,queryOk:balances.length>0,balances,...(balances.length?{}:{error:raw?.signedIn===false?'请先在 DeepSeek Harness 登录账号。':'等待 DeepSeek Harness 同步余额；请打开应用。'})};
}
export async function readBridge(profile,{onAccount=()=>{}}={}){
 onAccount(null);let raw;
 try{raw=JSON.parse(fs.readFileSync(bridgeFile(profile),'utf8'));}catch{}
 return normalizeBridge(profile,raw);
}
