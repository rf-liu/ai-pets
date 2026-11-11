import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const name='aiquota-companion';
export const inject=['deepseekAccount'];
export function apply(ctx, config){
 const file=config.output;let busy=false;
 async function capture(){
  if(busy)return;busy=true;let phase="get-state";
  try{
   const state=await ctx.deepseekAccount.getState();
   phase="get-balance";const balance=state.status==='credential-stored'?await ctx.deepseekAccount.getBalance({version:'0.2.1-rc.5',locale:'zh-CN',timezoneOffsetSeconds:28800}):null;
   let profile=null;if(state.status==='credential-stored'){try{profile=await ctx.deepseekAccount.getProfile({version:'0.2.1-rc.5',locale:'zh-CN',timezoneOffsetSeconds:28800})}catch{}}
   const accountScope=profile?.status==='ready'&&profile.value?.id!=null?createHash('sha256').update(String(profile.value.id)).digest('hex').slice(0,24):null;
   const project=xs=>Array.isArray(xs)?xs.map(x=>({currency:x.currency,balance:x.balance})):[];
   const value={version:1,source:'dsh-official-host',capturedAt:Date.now(),accountScope,signedIn:state.status==='credential-stored',status:balance?.status??'unavailable',normalWallets:project(balance?.value),bonusWallets:project(balance?.bonusWallets)};
   await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await fs.rename(file+'.tmp',file);
  }catch(error){await fs.writeFile(file,JSON.stringify({diagnostic:{phase,name:error?.name,code:error?.code,message:typeof error?.message==="string"?error.message.slice(0,120):null},source:'dsh-official-host',capturedAt:Date.now(),status:'unavailable'}),{mode:0o600}).catch(()=>{});}
  finally{busy=false;}
 }
 const timer=setInterval(()=>void capture(),60000);ctx.effect(()=>()=>clearInterval(timer));void capture();
}
