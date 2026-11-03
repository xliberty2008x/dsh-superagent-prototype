import {randomUUID, createHash} from 'node:crypto';
import {mkdir, lstat, readFile, open, rename, unlink, link} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT=/^[a-zA-Z0-9_-]{1,200}$/;
const DIRECT='chatgpt.tokens.use.direct';
const SAFE_ERRORS=new Set(['invalid_id_token','identity_verification_unavailable','account_mismatch','invalid_grant','invalid_client','access_denied','cancelled','connection_changed']);
export class NativeChatGPTAuthError extends Error {
  constructor(code,message){super(message);this.name='NativeChatGPTAuthError';this.code=code;}
}
const error=(code,message)=>new NativeChatGPTAuthError(code,message);
const clone=value=>JSON.parse(JSON.stringify(value));
const fingerprint=c=>createHash('sha256').update(JSON.stringify([c.clientId,c.subject,c.credentials?.accessToken,c.credentials?.refreshToken,c.credentials?.expiresAt])).digest('hex');
function cleanFailure(cause,fallback){
  if(cause instanceof NativeChatGPTAuthError)return cause;
  const code=SAFE_ERRORS.has(cause?.code)?cause.code:fallback;
  return error(code,code==='identity_verification_unavailable'
    ?'ChatGPT identity verification is temporarily unavailable. The received refresh checkpoint is preserved.'
    :'ChatGPT authorization did not complete. Retry sign-in or inspect the non-secret status.');
}
function checkConnection(connection){
  const c=connection;
  if(c?.version!==1||c.status!=='connected'||!CLIENT.test(c.clientId??'')||c.clientId==='dynamic_agent_client'||typeof c.subject!=='string'||!c.subject||!Array.isArray(c.scopes)||!c.scopes.includes(DIRECT))
    throw error('PLAN_PERMISSION_REQUIRED','A validated ChatGPT connection with plan-usage permission is required.');
  if(typeof c.credentials?.accessToken!=='string'||!c.credentials.accessToken||typeof c.credentials.refreshToken!=='string'||!c.credentials.refreshToken||!Number.isFinite(c.credentials.expiresAt))
    throw error('RECONNECT_REQUIRED','ChatGPT did not return a refreshable plan connection. Sign in again.');
  return c;
}
export function toNativeGrant(connection,checkpointId=randomUUID()){
  const c=clone(checkConnection(connection));
  if(!UUID.test(checkpointId))throw error('INVALID_METADATA','Invalid native ChatGPT checkpoint identity.');
  return {type:'oauth',access:c.credentials.accessToken,refresh:c.credentials.refreshToken,expires:c.credentials.expiresAt,
    clientId:c.clientId,scopes:[...c.scopes],nativeChatGPT:{version:1,checkpointId,connection:c}};
}
export function fromNativeGrant(credential){
  if(credential?.type!=='oauth'||credential.nativeChatGPT?.version!==1||!UUID.test(credential.nativeChatGPT.checkpointId??''))
    throw error('RECONNECT_REQUIRED','This credential was not created by the validated native ChatGPT sign-in. Sign in again.');
  const c=checkConnection(credential.nativeChatGPT.connection);
  if(credential.access!==c.credentials.accessToken||credential.refresh!==c.credentials.refreshToken||credential.expires!==c.credentials.expiresAt)
    throw error('INVALID_METADATA','Native ChatGPT credential metadata does not match its connection.');
  return clone(c);
}

/** Implements pi-ai's native OAuthAuth interface; no model transport or agent loop. */
export function createNativeChatGPTAuth({metadataDir,authorize,refreshConnection,readCurrentCredential,appName='DeepSeek Superagent',redirectPort=0,now=Date.now,minimumValidityMs=300000}){
  if(typeof authorize!=='function'||typeof refreshConnection!=='function')throw new TypeError('Official OAuth functions are required.');
  let serial=Promise.resolve();
  const exclusive=operation=>{const p=serial.then(operation);serial=p.catch(()=>{});return p;};
  const directory=async()=>{
    const dir=typeof metadataDir==='function'?metadataDir():metadataDir;
    if(typeof dir!=='string'||!isAbsolute(dir))throw error('INVALID_METADATA','An absolute native authentication metadata directory is required.');
    await mkdir(dir,{recursive:true,mode:0o700});
    const st=await lstat(dir);
    if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw error('INSECURE_METADATA','Native authentication metadata must be owner-only.');
    return dir;
  };
  const read=async(dir,name)=>{
    const path=join(dir,name);
    let st;try{st=await lstat(path);}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>1024*1024)throw error('INSECURE_METADATA','Native authentication metadata is not a private regular file.');
    return JSON.parse(await readFile(path,'utf8'));
  };
  const syncDirectory=async dir=>{const h=await open(dir,'r');try{await h.sync();}finally{await h.close();}};
  const write=async(dir,name,value,first=false)=>{
    const tmp=join(dir,'.tmp-'+randomUUID()),target=join(dir,name);
    let h;
    try{
      h=await open(tmp,'wx',0o600);await h.writeFile(JSON.stringify(value)+'\n');await h.sync();await h.close();h=undefined;
      if(first){try{await link(tmp,target);}catch(e){if(e.code!=='EEXIST')throw e;}}else await rename(tmp,target);
      await syncDirectory(dir);
    }finally{await h?.close().catch(()=>{});await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  };
  const remove=async(dir,name)=>{await unlink(join(dir,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});await syncDirectory(dir);};
  const hostId=async dir=>{
    let host=await read(dir,'host.json');
    if(!host){await write(dir,'host.json',{version:1,id:randomUUID()},true);host=await read(dir,'host.json');}
    if(host?.version!==1||!UUID.test(host.id??''))throw error('INVALID_METADATA','The saved ChatGPT host identity is invalid.');
    return 'urn:uuid:'+host.id.toLowerCase();
  };
  return {
    name:'OpenAI (ChatGPT subscription)',isSubscription:true,loginLabel:'Continue with ChatGPT',
    async login(interaction,options={}){
      return exclusive(async()=>{
        try{
          const signal=interaction.signal;signal.throwIfAborted();
          const dir=await directory();
          const current=options.previousCredential??await readCurrentCredential?.();
          let previous=current?.nativeChatGPT?fromNativeGrant(current):undefined;
          const registration=await read(dir,'registration.json');
          if(!previous&&registration){
            if(registration.version!==1||!CLIENT.test(registration.clientId??'')||registration.clientId==='dynamic_agent_client')throw error('INVALID_METADATA','The saved ChatGPT registration is invalid.');
            previous={version:1,clientId:registration.clientId,status:'disconnected',scopes:[],savedAt:registration.savedAt};
          }
          const connection=await authorize({appName,appId:'deepseek-superagent',redirectPort,sendHostId:true,
            openBrowser:async url=>{interaction.notify({type:'auth_url',url,instructions:'Continue in your browser to authorize ChatGPT plan usage.'});}},
            previous,await hostId(dir),signal,{onRegistration:async clientId=>{
              if(!CLIENT.test(clientId??'')||clientId==='dynamic_agent_client')throw error('INVALID_METADATA','ChatGPT returned an invalid registration identity.');
              await write(dir,'registration.json',{version:1,clientId,savedAt:new Date(now()).toISOString()});
            }});
          signal.throwIfAborted();
          return toNativeGrant(connection);
        }catch(e){throw cleanFailure(e,'SIGN_IN_FAILED');}
      });
    },
    async refresh(credential,signal){
      return exclusive(async()=>{
        try{
          signal.throwIfAborted();
          const dir=await directory(),current=fromNativeGrant(credential),id=credential.nativeChatGPT.checkpointId;
          const name='refresh-'+id+'.json',anchor=fingerprint(current);
          let checkpoint=await read(dir,name),base=current;
          if(checkpoint){
            if(checkpoint.version!==1||checkpoint.clientId!==current.clientId||typeof checkpoint.anchor!=='string')throw error('INVALID_METADATA','The refresh checkpoint does not match this ChatGPT connection.');
            if(checkpoint.successor&&fingerprint(current)===checkpoint.successorFingerprint){
              // Native stored credential now proves its predecessor was committed.
              await remove(dir,name);checkpoint=undefined;
            }else if(checkpoint.anchor===anchor){
              if(checkpoint.successor){
                base=checkConnection(checkpoint.successor);
                if(base.credentials.expiresAt>now()+minimumValidityMs)return toNativeGrant(base,id);
              }else if(checkpoint.rotation)base={...base,pendingRefresh:checkpoint.rotation};
            }else throw error('CONNECTION_CHANGED','The native ChatGPT credential changed while refresh recovery was pending.');
          }
          const originalAnchor=checkpoint?.anchor??anchor;
          const next=await refreshConnection(base,signal,async rotation=>{
            // Do not recurse into DSH's record lock: it already encloses refresh().
            await write(dir,name,{version:1,clientId:current.clientId,anchor:originalAnchor,rotation:clone(rotation)});
          });
          checkConnection(next);
          await write(dir,name,{version:1,clientId:current.clientId,anchor:originalAnchor,successor:clone(next),successorFingerprint:fingerprint(next)});
          // Retained until a later call supplies the committed successor credential.
          return toNativeGrant(next,id);
        }catch(e){throw cleanFailure(e,'REFRESH_FAILED');}
      });
    },
    async toAuth(credential){fromNativeGrant(credential);return {apiKey:credential.access};}
  };
}

export function withNativeChatGPTAuth(provider,options){
  if(provider?.id!=='openai')return provider;
  return {...provider,auth:{...provider.auth,oauth:createNativeChatGPTAuth(options)}};
}
