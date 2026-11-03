import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createController,sameOrigin} from './index.mjs';
function fixture(){
 let beginCalls=0,connected=false,notices,finish,received;
 const entry={methods:[{id:'oauth',label:'Continue with ChatGPT'}],inFlight:false};
 const api=createController({key:'synthetic-key',authorization:{describe:()=>entry,begin:async request=>{beginCalls++;entry.inFlight=true;notices=request.interaction;return new Promise(r=>{finish=()=>{entry.inFlight=false;connected=true;r({status:'authorized'});};});},cancel:()=>{entry.inFlight=false;}},credentials:{describeRecord:async()=>({configured:connected,kind:connected?'grant':undefined})},source:()=>({ready:Promise.resolve(),configured:()=>true,receive:async trigger=>{received=trigger;return 'stored';},threads:{describe:()=>{}}})});
 return {api,get beginCalls(){return beginCalls;},get received(){return received;},get notices(){return notices;},finish:()=>finish(),setConnected:()=>{connected=true;}};
}
test('status never starts authorization or exposes credentials',async()=>{
 const f=fixture();assert.deepEqual(await f.api.status(),{available:true,connected:false,inFlight:false,phase:'idle'});assert.equal(f.beginCalls,0);
 await assert.rejects(f.api.submit('Task'),/Continue with ChatGPT/);assert.equal(f.received,undefined);
});
test('user-initiated flow relays only official browser URL, then native committed state',async()=>{
 const f=fixture();await f.api.start();assert.equal(f.beginCalls,1);
 f.notices.notify({url:'https://example.org/not-accepted',message:'ignored'});assert.equal((await f.api.status()).url,undefined);
 f.notices.notify({url:'https://auth.openai.com/api/accounts/authorize?state=synthetic',message:'Continue'});
 assert.match((await f.api.status()).url,/^https:\/\/auth.openai.com\//);
 f.finish();await new Promise(r=>setImmediate(r));assert.equal((await f.api.status()).connected,true);
});
test('submitted task is forwarded byte-for-byte to native Source intake',async()=>{
 const f=fixture();f.setConnected();const text='  Inspect both clips.\nKeep the original words.\n';const r=await f.api.submit(text);
 assert.equal(r.received,'stored');assert.equal(f.received.text,text);assert.equal(f.received.actor.id,'operator');assert.equal(f.received.addressed,'direct');
});
test('same-origin action headers required',()=>{
 assert.equal(sameOrigin({headers:{host:'127.0.0.1:3088','x-native-chatgpt-request':'1',origin:'http://127.0.0.1:3088'}},3088),true);
 assert.equal(sameOrigin({headers:{host:'127.0.0.1:3088','x-native-chatgpt-request':'1',origin:'https://example.org'}},3088),false);
 assert.equal(sameOrigin({headers:{host:'127.0.0.1:3088'}},3088),false);
});
