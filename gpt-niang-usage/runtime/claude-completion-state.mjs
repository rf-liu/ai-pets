// Completion proof is independent of TPS. Streaming thinking fragments may
// already carry end_turn; a visible final answer and a successful stop summary
// in its UUID ancestry are both required before notifying.
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256?value:null;
const terminal=new Set(['completed','failed','killed','cancelled','canceled']);
export class ClaudeCompletionState {
 constructor(){this.running=false;this.endedAt=null;this.final=null;this.observedInput=false;this.parents=new Map();this.tools=new Map();this.background=new Set();}
 accept(record){
  if(!record||record.isSidechain)return;
  const uuid=id(record.uuid),parent=id(record.parentUuid);
  if(uuid){this.parents.set(uuid,parent);while(this.parents.size>4096)this.parents.delete(this.parents.keys().next().value);}
  const time=typeof record.timestamp==='number'?record.timestamp:Date.parse(record.timestamp??'');
  if(!Number.isFinite(time))return;
  const content=record.message?.content,blocks=Array.isArray(content)?content.filter(x=>x&&typeof x==='object'):[];
  if(record.type==='user'&&!record.isMeta&&!record.isCompactSummary&&record.toolUseResult===undefined&&(typeof content==='string'||blocks.some(x=>['text','image'].includes(x.type))&&!blocks.some(x=>x.type==='tool_result'))){
   this.observedInput=true;this.running=true;this.endedAt=null;this.final=null;this.background.clear();this.tools.clear();
  }
  if(record.type==='assistant'){
   this.running=true;this.endedAt=null;this.final=null;
   for(const tool of blocks.filter(x=>x.type==='tool_use')){
    const key=id(tool.id);if(!key)continue;
    this.tools.set(key,{task:id(tool.input?.task_id)});
    if(tool.input?.run_in_background===true)this.background.add('tool:'+key);
    if(tool.name==='TaskOutput'&&id(tool.input?.task_id))this.background.add('task:'+tool.input.task_id);
   }
   while(this.tools.size>1024)this.tools.delete(this.tools.keys().next().value);
   const visible=typeof content==='string'?content.trim().length>0:blocks.some(x=>x.type==='text'&&typeof x.text==='string'&&x.text.trim().length>0);
   if(!record.isApiErrorMessage&&record.message?.stop_reason==='end_turn'&&visible&&!blocks.some(x=>x.type==='tool_use')&&uuid)this.final={uuid,at:time};
  }
  if(record.type==='user'){
   const result=record.toolUseResult;
   for(const block of blocks.filter(x=>x.type==='tool_result')){
    const call=id(block.tool_use_id),task=this.tools.get(call)?.task;
    if(id(result?.backgroundTaskId)){
     this.background.delete('tool:'+call);this.background.add('task:'+result.backgroundTaskId);
    }
    const returnedTask=id(result?.task?.task_id)??task;
    const status=result?.task?.status??result?.status;
    if(returnedTask&&(!task||returnedTask===task)&&terminal.has(status))this.background.delete('task:'+returnedTask);
    // Without a structured end signal a detached job remains unproven.
   }
  }
  if(record.type==='system'&&record.subtype==='stop_hook_summary'&&this.observedInput&&this.final&&time>=this.final.at&&
    record.preventedContinuation===false&&Array.isArray(record.hookErrors)&&record.hookErrors.length===0&&this.background.size===0){
   let cursor=parent;const seen=new Set();
   while(cursor&&!seen.has(cursor)&&seen.size<64){
    if(cursor===this.final.uuid){this.endedAt=time;this.running=false;this.final=null;break;}
    seen.add(cursor);cursor=this.parents.get(cursor);
   }
  }
  if(this.background.size>1024){this.background.clear();this.background.add('unproven-overflow');}
 }
}
