// Offline migration of the native workspace v2 domain. No session/auth data.
import {realpath,stat} from 'node:fs/promises';
export async function relocateWorkspaces(document,fromRoots,toRoot){
  if(document?.unit?.name!=='workspace'||document.unit.version!==2||!document.tables?.workspaces)throw new Error('Unsupported workspace domain');
  const next=structuredClone(document);const changes=[];
  for(const [id,record] of Object.entries(next.tables.workspaces)){
    const from=fromRoots.find(root=>record.path===root||record.path.startsWith(root+'/'));
    if(!from)continue;
    const candidate=toRoot+record.path.slice(from.length);
    const canonical=await realpath(candidate);
    if(!(await stat(canonical)).isDirectory())throw new Error('Workspace target is not a directory');
    if(record.path!==canonical){changes.push({id,from:record.path,to:canonical});record.path=canonical;}
  }
  return {document:next,changes};
}
