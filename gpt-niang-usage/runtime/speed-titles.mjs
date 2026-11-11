// `name` is the sidebar name; `title` can still contain the entire first prompt.
export function displayThreadName(row){
  if(typeof row.name==='string'&&row.name.trim())return row.name.trim().slice(0,160);
  let value=String(row.title??'').trim();
  const request=value.match(/## My request:\s*([\s\S]*)/);
  if(request)value=request[1].trim();
  if(/^(?:# Files (?:mentioned|pasted) by the user:|<in-app-browser-context\b|<environment_context\b|<external_codex_apps_)/.test(value))return '未命名聊天';
  return value.split('\n').find(line=>line.trim())?.trim().slice(0,160)||'未命名聊天';
}
export function isUserConversation(row){
  const source=String(row.source??'');
  if(source==='subagent'||source==='guardian')return false;
  try{if(JSON.parse(source)?.subagent)return false;}catch{}
  return source!=='exec'||Boolean(row.name?.trim());
}
export const userThreadsSQL=`SELECT id,name,title,source,rollout_path FROM threads
 WHERE archived=0 AND source NOT LIKE '%"subagent"%' AND source NOT IN ('subagent','guardian')
 AND (source!='exec' OR (name IS NOT NULL AND trim(name)!=''))
 ORDER BY updated_at DESC LIMIT 12;`;
