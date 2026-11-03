import {writeFile,rename,readFile,unlink,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export const REOPEN_SIGNAL='SIGUSR2';
const dispatchers=new WeakMap();
function dispatcherFor(events){let slot=dispatchers.get(events);if(!slot){slot={active:undefined,tail:Promise.resolve()};events.on(REOPEN_SIGNAL,()=>slot.active?.());dispatchers.set(events,slot);}return slot;}
export async function installBrowserHandoff({file,host,port,authenticatedUrl,openBrowser,onError=()=>{},events=process,pid=process.pid}){
 let closed=false,opening,sequence=0;const generation=randomUUID();const dispatcher=dispatcherFor(events);
 const marker={version:1,pid,host,port,signal:REOPEN_SIGNAL,ready:true,generation,sequence,status:'ready'};
 const serialized=action=>{const task=dispatcher.tail.then(action);dispatcher.tail=task.catch(()=>{});return task;};
 const save=()=>serialized(async()=>{if(closed||dispatcher.active!==reopen)return;const temp=file+'.'+pid+'.'+generation+'.tmp';await writeFile(temp,JSON.stringify(marker)+'\n',{mode:0o600});await rename(temp,file);});
 const reopen=()=>{
  if(closed||opening)return;
  opening=(async()=>{
   try{await openBrowser(authenticatedUrl());marker.status='opened';}
   catch{marker.status='failed';onError();}
   marker.sequence=++sequence;if(!closed)await save();
  })().catch(()=>{onError();}).finally(()=>{opening=undefined;});
 };
 dispatcher.active=reopen;
 try{await save();}catch(error){if(dispatcher.active===reopen)dispatcher.active=undefined;throw error;}
 return async()=>{closed=true;if(dispatcher.active===reopen)dispatcher.active=undefined;await opening;await serialized(async()=>{try{const old=JSON.parse(await readFile(file,'utf8'));if(old.pid===pid&&old.generation===generation)await unlink(file);}catch{}})};
}
export async function requestBrowserHandoff(file,listenerPid,{sendSignal=(pid,signal)=>process.kill(pid,signal),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=5000}={}){
 const deadline=Date.now()+timeoutMs;let marker;
 const read=async()=>{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))throw new Error('Untrusted launcher state');return JSON.parse(await readFile(file,'utf8'));};
 while(Date.now()<deadline){
  try{const value=await read();if(value.version===1&&value.pid===listenerPid&&value.host==='127.0.0.1'&&value.port===3088&&value.signal===REOPEN_SIGNAL&&value.ready===true){marker=value;break;}}catch{}
  await pause(100);
 }
 if(!marker)return false;
 try{sendSignal(listenerPid,REOPEN_SIGNAL);}catch{return false;}
 const responseDeadline=Date.now()+timeoutMs;
 while(Date.now()<responseDeadline){
  try{const current=await read();if(current.pid!==listenerPid)return false;if((current.generation===marker.generation&&current.sequence>marker.sequence)||(current.generation!==marker.generation&&current.sequence>0))return current.status==='opened';}catch{}
  await pause(100);
 }
 return false;
}
