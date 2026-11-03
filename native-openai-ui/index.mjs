import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {credentialKey} from '@deepseek-ai/dsh-credentials';
import {internals as nativeWeb} from '@deepseek-ai/dsh-web-app';
import {isAbsolute} from 'node:path';
import {installBrowserHandoff} from './browser-handoff.mjs';

export const name='native-openai-ui';
export const inject=['webServer','webApp','connection','authorization','credentials','orchestrator'];
const KEY=credentialKey('llm-pi-ai','openai');
const LOCAL_KIND={kind:'local-ui',title:{en:'Local UI',zh:'本地界面'},description:{en:'Tasks submitted directly in Superagent.',zh:'在 Superagent 中直接提交的任务。'},schema:z.object({}).strict(),fields:[],health:['local-ui'],
 policy:{schema:z.object({allowed:z.array(z.object({id:z.string().min(1)}).strict()).default([])}).strict(),
  fields:[{key:'allowed',type:'rows',label:{en:'Local operators',zh:'本地操作员'},columns:[{key:'id',type:'text',label:{en:'Operator',zh:'操作员'}}]}],
  explicit:{en:'Direct local UI submission',zh:'本地界面直接提交'}}};

export function createController({authorization,credentials,source,key=KEY}){
 let phase='idle',url,error,active;
 const status=async()=>{
  const entry=authorization.describe(key),record=await credentials.describeRecord(key);
  return {available:!!entry?.methods.some(m=>m.id==='oauth'),connected:record.configured===true&&record.kind==='grant',inFlight:entry?.inFlight===true,phase,...url?{url}:{},...error?{error}:{}};
 };
 const start=async()=>{
  const current=await status();
  if(!current.available)throw new Error('ChatGPT sign-in is not available in this runtime.');
  if(current.inFlight||active)throw new Error('Finish or cancel the current sign-in first.');
  phase='connecting';url=error=undefined;
  const controller=new AbortController();
  active=controller;
  void authorization.begin({key,method:'oauth',signal:controller.signal,interaction:{
   notify:notice=>{
    if(!notice.url)return;
    const target=new URL(notice.url);
    if(target.origin!=='https://auth.openai.com')return;
    url=target.href;
   },
   prompt:async()=>{throw new Error('This ChatGPT connection uses the browser callback; no credential input is accepted here.');}
  }}).then(result=>{phase=result.status;url=undefined;},()=>{phase='failed';url=undefined;error='ChatGPT sign-in did not complete. You can retry or cancel.';}).finally(()=>{active=undefined;});
  return status();
 };
 const cancel=async()=>{active?.abort();authorization.cancel(key);return status();};
 const submit=async text=>{
  if(typeof text!=='string'||!text.trim())throw new Error('Enter a task.');
  if(!(await status()).connected)throw new Error('Continue with ChatGPT before submitting a task.');
  const context=source();await context.ready;
  if(!context.configured())throw new Error('Complete Superagent setup first.');
  const id=randomUUID();
  const received=await context.receive({id:'local-ui:'+id,source:'local-ui',threads:[{source:'local-ui',id}],actor:{source:'local-ui',id:'operator'},human:true,addressed:'direct',at:new Date().toISOString(),text,meta:{}});
  context.threads.describe('local-ui:'+id,{label:text.slice(0,100)});
  return {id:'local-ui:'+id,received};
 };
 return {status,start,cancel,submit,dispose:()=>{active?.abort();}};
}

export function sameOrigin(req,port){
 const expected='http://127.0.0.1:'+port;
 return req.headers.host==='127.0.0.1:'+port&&req.headers['x-native-chatgpt-request']==='1'&&(!req.headers.origin||req.headers.origin===expected);
}
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){
 let bytes=0,text='';
 for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024)throw new Error('Task request is too large.');text+=chunk;}
 return JSON.parse(text);
}
export function apply(ctx,config={}){
 if(config.launcherStatePath){
  if(!isAbsolute(config.launcherStatePath))throw new Error('Launcher state path must be absolute.');
  ctx.effect(()=>{let disposed=false,stop;
   void ctx.get('loader').await().then(async()=>{if(disposed)return;stop=await installBrowserHandoff({file:config.launcherStatePath,host:ctx.webServer.host,port:ctx.webServer.port,authenticatedUrl:()=>ctx.connection.authenticatedUrl(ctx.webApp.getAdvertisedUrl()),openBrowser:nativeWeb.openBrowser,onError:()=>ctx.logger.warn('Native browser handoff failed; details withheld.')});if(disposed)await stop();}).catch(()=>ctx.logger.warn('Native browser handoff is unavailable.'));
   return async()=>{disposed=true;await stop?.();};
  },'same-user native browser handoff');
 }
 if(ctx.webServer.host!=='127.0.0.1')throw new Error('Native ChatGPT UI requires the loopback Web profile.');
 ctx.effect(()=>ctx.orchestrator.sources.register(LOCAL_KIND),'local-ui: source kind');
 const source=()=>ctx.orchestrator.context(LOCAL_KIND);
 const controller=createController({authorization:ctx.authorization,credentials:ctx.credentials,source});
 ctx.effect(()=>{void source().ready.then(()=>{const c=source();c.report('local-ui',{state:c.configured()?'ready':'paused',detail:'Local UI task submissions'});});return()=>controller.dispose();});
 ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/native-chatgpt',handler:async(req,res)=>{
  if(!sameOrigin(req,ctx.webServer.port)){send(res,403,{error:'Same-origin UI request required.'});return;}
  const path=new URL(req.url??'/','http://127.0.0.1').pathname;
  try{
   if(req.method==='GET'&&path==='/native-chatgpt/status'){send(res,200,await controller.status());return;}
   if(req.method==='POST'&&path==='/native-chatgpt/start'){send(res,202,await controller.start());return;}
   if(req.method==='POST'&&path==='/native-chatgpt/cancel'){send(res,200,await controller.cancel());return;}
   if(req.method==='POST'&&path==='/native-chatgpt/task'){send(res,202,await controller.submit((await body(req)).text));return;}
   send(res,404,{error:'Unknown UI operation.'});
  }catch(e){send(res,400,{error:e.message==='Enter a task.'?e.message:'The requested UI action could not complete. Check connection and Superagent setup.'});}
 }}),'native ChatGPT UI routes');
}
