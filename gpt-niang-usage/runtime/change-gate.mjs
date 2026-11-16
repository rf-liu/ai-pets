import fs from 'node:fs';
import path from 'node:path';

// Watch only the provider's record roots. A missing root is watched from its
// nearest existing ancestor so creation is detected without directory polling.
export class ChangeGate {
  constructor(roots,{watch=fs.watch,exists=fs.existsSync}={}){
    this.roots=roots;this.watch=watch;this.exists=exists;this.watchers=[];this.revision=1;this.readRevision=0;this.closed=false;
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
        if(this.roots.some(root=>file===root||file.startsWith(root+path.sep)||root.startsWith(file+path.sep))){this.revision++;}
      });
      // Failing closed avoids silently replacing a lost watcher with polling.
      watcher.on('error',()=>{this.close();process.exit(1);});this.watchers.push(watcher);
    }
  }
  consume(){if(this.closed||this.readRevision===this.revision)return false;this.readRevision=this.revision;return true;}
  mark(){this.revision++;}
  close(){this.closed=true;for(const watcher of this.watchers)watcher.close();this.watchers=[];}
}
