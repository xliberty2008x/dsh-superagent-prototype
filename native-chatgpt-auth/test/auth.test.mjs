import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,access,rm,readdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNativeChatGPTAuth,toNativeGrant,fromNativeGrant,withNativeChatGPTAuth} from '../index.mjs';

const now=()=>Date.now();
const connection=(suffix='one')=>({version:1,clientId:'issued_client',status:'connected',subject:'verified-subject',identity:{name:'Example'},
  profileIdToken:'synthetic-id-token-'+suffix,scopes:['openid','offline_access','chatgpt.tokens.use.direct'],savedAt:new Date().toISOString(),
  credentials:{accessToken:'synthetic-access-'+suffix,refreshToken:'synthetic-refresh-'+suffix,expiresAt:now()+3600000}});
const interaction=()=>({signal:new AbortController().signal,notify(){}});
async function temporary(run){const base=await mkdtemp(join(tmpdir(),'native-chatgpt-auth-test-'));try{await run(join(base,'auth'));}finally{await rm(base,{recursive:true,force:true});}}

test('factory and provider adaptation do no IO; native model transport stays identical',async()=>temporary(async dir=>{
  let called=0;
  const params={metadataDir:dir,authorize:async()=>{called++;return connection();},refreshConnection:async()=>{called++;return connection();}};
  const stream=()=>{},provider={id:'openai',stream,auth:{apiKey:{name:'Existing API method'}}};
  const adapted=withNativeChatGPTAuth(provider,params);
  assert.equal(adapted.stream,stream);assert.equal(adapted.auth.apiKey,provider.auth.apiKey);
  assert.equal(withNativeChatGPTAuth({id:'other'},params).id,'other');
  assert.equal(called,0);await assert.rejects(access(dir));
}));

test('issued client ID survives failed exchange; next login reuses host and registration',async()=>temporary(async dir=>{
  const seen=[];
  let reads=0;
  const authorize=async(config,previous,host,signal,options)=>{
    seen.push({config,previous,host});
    assert.equal(config.appName,'DeepSeek Superagent');assert.equal(config.sendHostId,true);
    await options.onRegistration('issued_client');
    if(seen.length===1)throw new Error('Provider raw body synthetic-secret-must-not-leak');
    return connection();
  };
  const auth=createNativeChatGPTAuth({metadataDir:dir,authorize,refreshConnection:async()=>connection(),readCurrentCredential:async()=>{reads++;}});
  assert.equal(reads,0);
  await assert.rejects(auth.login(interaction()),e=>e.code==='SIGN_IN_FAILED'&&!e.message.includes('synthetic-secret')&&e.cause===undefined);
  const grant=await auth.login(interaction());
  assert.equal(seen[0].previous,undefined);
  assert.equal(seen[1].previous.clientId,'issued_client');
  assert.equal(seen[0].host,seen[1].host);assert.match(seen[1].host,/^urn:uuid:/);
  assert.equal(reads,2);assert.equal(grant.type,'oauth');
  assert.deepEqual(fromNativeGrant(grant),grant.nativeChatGPT.connection);
  assert.equal((await stat(dir)).mode&0o777,0o700);
  for(const f of await readdir(dir))assert.equal((await stat(join(dir,f))).mode&0o777,0o600);
}));

test('reauthorization receives full validated native connection and toAuth stays a bearer derivation',async()=>temporary(async dir=>{
  const initial=toNativeGrant(connection());let previous;
  const auth=createNativeChatGPTAuth({metadataDir:dir,authorize:async(_c,p)=>{previous=p;return connection('two');},refreshConnection:async()=>connection()});
  const next=await auth.login(interaction(),{previousCredential:initial});
  assert.deepEqual(previous,initial.nativeChatGPT.connection);
  assert.equal(next.access,'synthetic-access-two');
  assert.deepEqual(await auth.toAuth(next),{apiKey:next.access});
  assert.throws(()=>fromNativeGrant({...next,access:'different'}),e=>e.code==='INVALID_METADATA');
}));

test('received rotation is durable before verification failure and recovers without a second rotation',async()=>temporary(async dir=>{
  const old=toNativeGrant(connection()),next=connection('rotated');
  const rotation={credentials:next.credentials,scopes:next.scopes,idToken:next.profileIdToken,receivedAt:now()};
  let rotations=0,verifications=0;
  const failure=Object.assign(new Error('raw token response must not leak'),{code:'identity_verification_unavailable'});
  const first=createNativeChatGPTAuth({metadataDir:dir,authorize:async()=>connection(),refreshConnection:async(_previous,_signal,persist)=>{
    rotations++;await persist(rotation);
    const checkpoint=JSON.parse(await readFile(join(dir,'refresh-'+old.nativeChatGPT.checkpointId+'.json'),'utf8'));
    assert.deepEqual(checkpoint.rotation,rotation);assert.equal((await stat(join(dir,'refresh-'+old.nativeChatGPT.checkpointId+'.json'))).mode&0o777,0o600);
    throw failure;
  }});
  await assert.rejects(first.refresh(old,new AbortController().signal),e=>e.code==='identity_verification_unavailable'&&!e.message.includes('raw token'));
  const recovered=createNativeChatGPTAuth({metadataDir:dir,authorize:async()=>connection(),refreshConnection:async(previous)=>{
    verifications++;assert.deepEqual(previous.pendingRefresh,rotation);return next;
  }});
  const result=await recovered.refresh(old,new AbortController().signal);
  assert.equal(result.refresh,next.credentials.refreshToken);assert.equal(rotations,1);assert.equal(verifications,1);
  const checkpointPath=join(dir,'refresh-'+old.nativeChatGPT.checkpointId+'.json');
  let checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));
  assert.equal(checkpoint.successor.credentials.refreshToken,next.credentials.refreshToken);
  // A failed native store commit presents the old grant again: use retained successor.
  assert.deepEqual(await recovered.refresh(old,new AbortController().signal),result);
  assert.equal(verifications,1);await access(checkpointPath);
  // Only a caller presenting the committed successor permits predecessor cleanup.
  const later=connection('later');let secondVerified=false;
  const committed=createNativeChatGPTAuth({metadataDir:dir,authorize:async()=>connection(),refreshConnection:async previous=>{
    secondVerified=true;assert.equal(previous.credentials.refreshToken,next.credentials.refreshToken);
    await assert.rejects(access(checkpointPath));return later;
  }});
  assert.equal((await committed.refresh(result,new AbortController().signal)).access,later.credentials.accessToken);
  assert.equal(secondVerified,true);checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));
  assert.equal(checkpoint.successor.credentials.accessToken,later.credentials.accessToken);
}));

test('missing plan scope or insecure metadata fails before usable grant; errors never expose provider bodies',async()=>temporary(async dir=>{
  let calls=0;
  const auth=createNativeChatGPTAuth({metadataDir:dir,authorize:async()=>{calls++;return {...connection(),scopes:['openid']};},refreshConnection:async()=>connection()});
  await assert.rejects(auth.login(interaction()),e=>e.code==='PLAN_PERMISSION_REQUIRED');
  await chmod(dir,0o755);
  await assert.rejects(auth.login(interaction()),e=>e.code==='INSECURE_METADATA');
  assert.equal(calls,1);
}));
