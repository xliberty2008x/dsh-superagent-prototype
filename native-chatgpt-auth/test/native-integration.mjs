// Standalone native seam verification. The only fetch implementation in this
// process is a fixed synthetic SSE responder; no original fetch is retained.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {toNativeGrant} from '../index.mjs';

const runtime=process.env.DSH_TEST_RUNTIME;
assert.ok(runtime?.startsWith('/'),'Set DSH_TEST_RUNTIME to the isolated DSH runtime directory.');
const home=mkdtempSync(join(tmpdir(),'native-dsh-oauth-integration-'));
process.env.DSH_HOME=home;process.env.HOME=home;
delete process.env.OPENAI_API_KEY;
const access='synthetic-native-oauth-bearer';
let requests=0,captured;
const message={id:'msg_synthetic_native',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Native OAuth integration OK.',annotations:[]}]};
const response={id:'resp_synthetic_native',object:'response',created_at:1,status:'completed',model:'gpt-6.1-terra',output:[message],usage:{input_tokens:10,output_tokens:5,total_tokens:15,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
const events=[
 {type:'response.created',response:{...response,status:'in_progress',output:[],usage:null}},
 {type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress',content:[]}},
 {type:'response.content_part.added',item_id:message.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
 {type:'response.output_text.delta',item_id:message.id,output_index:0,content_index:0,delta:'Native OAuth integration OK.'},
 {type:'response.output_text.done',item_id:message.id,output_index:0,content_index:0,text:'Native OAuth integration OK.'},
 {type:'response.content_part.done',item_id:message.id,output_index:0,content_index:0,part:message.content[0]},
 {type:'response.output_item.done',output_index:0,item:message},
 {type:'response.completed',response}
];
globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init);
  assert.equal(req.url,'https://api.openai.com/v1/responses','Unknown URL must never reach a transport');
  assert.equal(req.method,'POST');
  assert.equal(req.headers.get('authorization'),'Bearer '+access);
  requests++;captured=JSON.parse(await req.text());
  const body=events.map(data=>'event: '+data.type+'\ndata: '+JSON.stringify(data)+'\n\n').join('');
  return new Response(body,{status:200,headers:{'content-type':'text/event-stream','x-request-id':'req_syntheticnative0000'}});
};
let ctx;
const timeout=setTimeout(()=>{console.error('Native integration test exceeded 20 seconds.');process.exit(2);},20000);
try{
  const {boot}=await import(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
  const {createUserMessage}=await import(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-llm/lib/index.js')));
  const {credentialKey}=await import(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-credentials/lib/index.js')));
  const row=(id,name,config)=>({id,name:'@deepseek-ai/'+name,...config?{config}:{}});
  const config=join(home,'cordis.json');
  writeFileSync(config,JSON.stringify([
    row('timer','cordis-plugin-timer'),row('llm','dsh-llm'),
    row('credentials','dsh-credentials-local',{dshHome:home,watch:false}),
    row('authorization','dsh-authorization'),
    row('llm-pi-ai','dsh-llm-pi-ai',{providers:{openai:{}}})
  ]));
  ctx=await boot('native-oauth-test',config,[],undefined,pathToFileURL(runtime+'/').href);
  const connection={version:1,clientId:'synthetic_issued_client',status:'connected',subject:'synthetic_verified_subject',scopes:['openid','offline_access','chatgpt.tokens.use.direct'],savedAt:new Date().toISOString(),profileIdToken:'synthetic-id-token',credentials:{accessToken:access,refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000}};
  await ctx.credentials.modifyRecord(credentialKey('llm-pi-ai','openai'),async()=>({kind:'grant',payload:toNativeGrant(connection)}));
  const chunks=[];
  for await(const chunk of ctx.llm.stream({provider:'openai',model:'gpt-6.1-terra',reasoningEffort:'max',
    messages:[createUserMessage({content:[{type:'text',text:'Synthetic native request.'}],source:{kind:'user'}})],
    tools:[{name:'synthetic_echo',description:'Synthetic function schema only.',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}],
    signal:new AbortController().signal}))chunks.push(chunk);
  assert.equal(requests,1);
  assert.equal(captured.model,'gpt-6.1-terra');assert.equal(captured.reasoning.effort,'max');
  assert.equal(captured.store,false);assert.equal(captured.stream,true);
  assert.ok(JSON.stringify(captured.input).includes('Synthetic native request.'));
  const wireTools=[...(captured.tools??[]),...captured.input.filter(i=>i.type==='additional_tools').flatMap(i=>i.tools??[])];
  assert.ok(wireTools.some(t=>t.type==='function'&&t.name==='synthetic_echo'&&t.parameters.properties.value.type==='string'));
  assert.ok(chunks.some(c=>c.type==='text-delta'&&c.delta==='Native OAuth integration OK.')||JSON.stringify(chunks).includes('Native OAuth integration OK.'));
  assert.equal(chunks.findLast(c=>c.type==='finish')?.reason.kind,'stop');
  assert.equal(chunks.find(c=>c.type==='usage')?.usage.totalTokens,15);
  assert.equal(existsSync(join(home,'native-chatgpt-auth')),false,'Streaming a fresh stored grant must not start authentication or create auth metadata');
  console.log(JSON.stringify({passed:true,native_context:true,public_responses:true,oauth_bearer_verified:true,store_false:true,stream_true:true,text_preserved:true,function_tools_preserved:true,completed_finish:true,usage_tokens:15,mocked_fetch_calls:requests,real_network_calls:0,authorization_started:false,image_exercised:false}));
}finally{
  clearTimeout(timeout);
  await ctx?.fiber.dispose();
  rmSync(home,{recursive:true,force:true});
}
