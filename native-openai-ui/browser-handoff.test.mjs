import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installBrowserHandoff,requestBrowserHandoff,REOPEN_SIGNAL} from './browser-handoff.mjs';
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'native-browser-handoff-'));try{await run(join(root,'state.json'));}finally{await rm(root,{recursive:true,force:true});}}
test('same-user reopen uses native URL only in memory and persists no authentication material',async()=>fixture(async file=>{
 const events=new EventEmitter();let computed=0,opened=0;
 const stop=await installBrowserHandoff({file,host:'127.0.0.1',port:3088,events,authenticatedUrl:()=>{computed++;return 'opaque-synthetic-handoff';},openBrowser:async url=>{assert.equal(url,'opaque-synthetic-handoff');opened++;}});
 assert.equal(computed,0);assert.equal(events.listenerCount('SIGUSR1'),0);assert.equal(REOPEN_SIGNAL,'SIGUSR2');
 const ok=await requestBrowserHandoff(file,process.pid,{sendSignal:(_pid,signal)=>events.emit(signal),timeoutMs:500});
 assert.equal(ok,true);assert.equal(opened,1);assert.equal(computed,1);
 const text=await readFile(file,'utf8');assert.ok(!text.includes('opaque-synthetic-handoff'));assert.ok(!text.includes('url'));assert.equal(JSON.parse(text).status,'opened');
 await stop();assert.equal(events.listenerCount(REOPEN_SIGNAL),1);events.emit(REOPEN_SIGNAL);assert.equal(opened,1);await assert.rejects(readFile(file),{code:'ENOENT'});
}));
test('native opener failure does not persist or log its potentially sensitive error body',async()=>fixture(async file=>{
 const events=new EventEmitter();const errors=[];
 const stop=await installBrowserHandoff({file,host:'127.0.0.1',port:3088,events,authenticatedUrl:()=> 'synthetic-hidden-value',openBrowser:async()=>{throw new Error('synthetic-hidden-value');},onError:(...args)=>errors.push(args)});
 assert.equal(await requestBrowserHandoff(file,process.pid,{sendSignal:(_pid,signal)=>events.emit(signal),timeoutMs:500}),false);
 assert.deepEqual(errors,[[]]);assert.ok(!(await readFile(file,'utf8')).includes('synthetic-hidden-value'));await stop();
}));
test('stale or mismatched listener metadata never signals another process',async()=>fixture(async file=>{
 let signals=0;await writeFile(file,JSON.stringify({version:1,pid:123,host:'127.0.0.1',port:3088,signal:REOPEN_SIGNAL,ready:true,sequence:0}),{mode:0o600});
 assert.equal(await requestBrowserHandoff(file,124,{sendSignal:()=>signals++,timeoutMs:20,pause:async()=>{}}),false);assert.equal(signals,0);
}));
test('nonprivate marker permissions and symlinks are rejected without signalling',async()=>fixture(async file=>{
 let signals=0;const data=JSON.stringify({version:1,pid:process.pid,host:'127.0.0.1',port:3088,signal:REOPEN_SIGNAL,ready:true,sequence:0});await writeFile(file,data,{mode:0o644});await chmod(file,0o644);
 const options={sendSignal:()=>signals++,timeoutMs:20,pause:async()=>{}};
 assert.equal(await requestBrowserHandoff(file,process.pid,options),false);
 await chmod(file,0o600);await symlink(file,file+'.link');assert.equal(await requestBrowserHandoff(file+'.link',process.pid,options),false);assert.equal(signals,0);
}));

test('late signals and old-generation cleanup cannot terminate or disable a replacement handoff',async()=>fixture(async file=>{
 const events=new EventEmitter();let opens=0;
 const options={file,host:'127.0.0.1',port:3088,events,authenticatedUrl:()=> 'opaque-synthetic',openBrowser:async()=>{opens++;}};
 const stopOld=await installBrowserHandoff(options);const old=JSON.parse(await readFile(file,'utf8'));
 const stopNew=await installBrowserHandoff(options);const current=JSON.parse(await readFile(file,'utf8'));assert.notEqual(old.generation,current.generation);
 await stopOld();assert.equal(JSON.parse(await readFile(file,'utf8')).generation,current.generation);
 assert.equal(await requestBrowserHandoff(file,process.pid,{sendSignal:(_pid,signal)=>events.emit(signal),timeoutMs:500}),true);assert.equal(opens,1);
 await stopNew();events.emit(REOPEN_SIGNAL);assert.equal(opens,1);assert.equal(events.listenerCount(REOPEN_SIGNAL),1);
}));

test('concurrent replacement and disposal preserve the newest ready marker',async()=>fixture(async file=>{
 const events=new EventEmitter();let opens=0;
 const options={file,host:'127.0.0.1',port:3088,events,authenticatedUrl:()=> 'opaque-synthetic',openBrowser:async()=>{opens++;}};
 let stop=await installBrowserHandoff(options);
 for(let i=0;i<12;i++){
  const replacement=installBrowserHandoff(options);const disposal=stop();
  stop=await replacement;await disposal;
  assert.equal(await requestBrowserHandoff(file,process.pid,{sendSignal:(_pid,signal)=>events.emit(signal),timeoutMs:500}),true);
 }
 assert.equal(opens,12);await stop();
}));

test('upstream startup prints the authenticated handoff URL, never the clean advertised root',async()=>{
 const native=await import('@deepseek-ai/dsh-web-app');const printed=[];const original=console.log;
 const url='http://127.0.0.1:3088/?synthetic-bootstrap=fixture';let generated=0;
 const root={};const context={root,webServer:{host:'127.0.0.1',protocol:'http:',getOrigin:()=> 'http://127.0.0.1:3088/'},provide:()=>{},plugin:()=>{},inject:(_keys,callback)=>callback({root,connection:{authenticatedUrl:base=>{assert.equal(base,'http://127.0.0.1:3088/');generated++;return url;}},get:()=>undefined})};
 try{console.log=line=>printed.push(line);native.apply(context,{openBrowser:false,printUrl:true,surfaceContext:false});}finally{console.log=original;}
 assert.equal(generated,1);assert.deepEqual(printed,['dsh web: '+url]);
});
