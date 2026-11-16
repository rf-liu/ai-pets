import fs from 'node:fs';
import path from 'node:path';

// Watch only the provider's record roots. A missing root is watched from its
// nearest existing ancestor so creation is detected without directory polling.
export class ChangeGate {
  constructor(roots,{watch=fs.watch,exists=fs.existsSync,settleMs=0,now=Date.now}={}){
    this.roots=roots;this.watch=watch;this.exists=exists;this.watchers=[];this.revision=1;this.readRevision=0;this.closed=false;
    this.settleMs=settleMs;this.now=now;this.settleAt=settleMs>0?now()+settleMs:Infinity;
    this.attach();
  }
  attach(){
    for(const watcher of this.watchers)watcher.close();this.watchers=[];
    const targets=new Set();
    for(const root of this.roots){let p=root;while(!this.exists(p)&&path.dirname(p)!==p)p=path.dirname(p);if(this.exists(p)&&!fs.statSync(p).isDirectory())p=path.dirname(p);targets.add(p);}
    for(const target of [...targets].filter(p=>![...targets].some(other=>other!==p&&p.startsWith(other+path.sep)))){
      const watcher=this.watch(target,{recursive:true},(_event,name)=>{
        if(this.closed)return;
        const file=name?path.join(target,String(name)):target;
        if(this.roots.some(root=>file===root||file.startsWith(root+path.sep)||root.startsWith(file+path.sep))){this.mark();}
      });
      // Failing closed avoids silently replacing a lost watcher with polling.
      watcher.on('error',()=>{this.close();process.exit(1);});this.watchers.push(watcher);
    }
  }
  consume(){
    if(this.closed)return false;
    if(this.readRevision!==this.revision){this.readRevision=this.revision;return true;}
    // A database commit may precede the host's in-memory status update. One
    // trailing confirmation handles that race; it never becomes periodic polling.
    if(this.now()>=this.settleAt){this.settleAt=Infinity;return true;}
    return false;
  }
  mark(){this.revision++;if(this.settleMs>0)this.settleAt=this.now()+this.settleMs;}
  close(){this.closed=true;for(const watcher of this.watchers)watcher.close();this.watchers=[];}
}
