import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {displayThreadName,isUserConversation} from './speed-titles.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Filenames can retain a different ID after a fork/import. A jump is only
// trusted when the session header and current index agree on both ID and file.
export class CompletionTargetResolver {
  constructor(codexHome){this.home=codexHome;this.database=null;this.nextCheck=0;}
  resolve(file,headerID){
    if(typeof headerID!=='string'||!uuid.test(headerID))return {};
    if(Date.now()>=this.nextCheck){
      this.nextCheck=Date.now()+60000;
      try{const names=fs.readdirSync(this.home).filter(x=>/^state_\d+\.sqlite$/.test(x)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));this.database=names[0]?path.join(this.home,names[0]):null;}catch{this.database=null;}
    }
    if(!this.database)return {};
    const query=`SELECT id,name,title,source,rollout_path FROM threads WHERE id='${headerID.toLowerCase()}' LIMIT 1;`;
    const result=spawnSync('/usr/bin/sqlite3',['-readonly','-json',this.database,query],{encoding:'utf8',timeout:1500,maxBuffer:64*1024});
    if(result.status!==0)return {};
    try{
      const row=JSON.parse(result.stdout||'[]')[0];
      if(!row||row.id.toLowerCase()!==headerID.toLowerCase()||fs.realpathSync(row.rollout_path)!==fs.realpathSync(file))return {};
      if(!isUserConversation(row))return {excluded:true};
      return {conversationId:row.id.toLowerCase(),conversationTitle:displayThreadName(row)};
    }catch{return {};}
  }
}
