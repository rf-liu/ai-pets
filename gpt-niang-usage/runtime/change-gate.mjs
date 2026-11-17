import fs from 'node:fs';
import path from 'node:path';

// Watch only the provider's record roots. A missing root is watched from its
// nearest existing ancestor so creation is detected without directory polling.
export class ChangeGate {
  constructor(roots,{watch=fs.watch,exists=fs.existsSync,settleMs=0,now=Date.now}={}){
    this.roots=roots;this.watch=watch;this.exists=exists;this.watchers=[];this.revision=1;this.readRevision=0;this.closed=false;
    this.settleMs=settleMs;this.now=now;this.settleAt=settleMs>0?now()+settleMs:Infinity;
    this.rearmScheduled=false;
    this.attach();
  }
  attach(){
    for(const watcher of this.watchers)watcher.close();this.watchers=[];
    const targets=new Map(),missing=new Set();
    for(const root of this.roots){
      let p=root;if(!this.exists(root))missing.add(root);
      while(!this.exists(p)&&path.dirname(p)!==p)p=path.dirname(p);
      const directory=fs.statSync(p).isDirectory(),recursive=p===root&&directory;
      if(!directory)p=path.dirname(p);
      targets.set(p,(targets.get(p)??false)||recursive);
    }
    for(const [target,recursive] of [...targets].filter(([p])=>![...targets].some(([other,recurse])=>recurse&&other!==p&&p.startsWith(other+path.sep)))){
      const original=fs.statSync(target),identity=original.dev+':'+original.ino;
      // An absent provider must not recursively subscribe to the whole home
      // or Application Support folder. Watch its parent until it appears.
      const watcher=this.watch(target,{recursive},(event,name)=>{
        if(this.closed)return;
        const file=name?path.join(target,String(name)):target;
        const relevant=this.roots.filter(root=>file===root||file.startsWith(root+path.sep)||root.startsWith(file+path.sep));
        if(relevant.length)this.mark();
        let replaced=false;
        if(event==='rename'){try{const s=fs.statSync(target);replaced=s.dev+':'+s.ino!==identity;}catch{replaced=true;}}
        if(relevant.some(root=>missing.has(root))||replaced)this.rearm();
      });
      // Failing closed avoids silently replacing a lost watcher with polling.
      watcher.on('error',()=>{this.close();process.exit(1);});this.watchers.push(watcher);
    }
  }
  rearm(){
    if(this.rearmScheduled||this.closed)return;this.rearmScheduled=true;
    queueMicrotask(()=>{this.rearmScheduled=false;if(!this.closed){this.attach();this.mark();}});
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
