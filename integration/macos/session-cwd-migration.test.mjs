import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateEffectiveCwd} from './session-cwd-migration.mjs';
test('uses official cwd setter only for legacy path and preserves immutable header',async()=>{
 const target=await mkdtemp(join(tmpdir(),'session-cwd-test-'));
 try{const header={cwd:'/legacy/app'},agent={session:{header}};let setCalls=0;
 const host={sessionController:{resolveAgent:async()=>({agent})},workingDirectory:{get:()=>'/legacy/app',set:async(a,path)=>{assert.equal(a,agent);setCalls++;return path;}}};
 const result=await migrateEffectiveCwd(host,{sessionId:'known',fromRoots:['/legacy/app'],toRoot:target});
 assert.equal(result.after,await realpath(target));assert.equal(setCalls,1);assert.deepEqual(header,{cwd:'/legacy/app'});
 }finally{await rm(target,{recursive:true,force:true});}
});
test('does not reset a session already migrated or deliberately moved by the user',async()=>{
 const agent={session:{header:{cwd:'/legacy/app'}}};
 const host={sessionController:{resolveAgent:async()=>({agent})},workingDirectory:{get:()=>'/durable/user-chosen',set:()=>{throw new Error('must not reset user cwd');}}};
 assert.equal((await migrateEffectiveCwd(host,{sessionId:'known',fromRoots:['/legacy/app'],toRoot:'/durable'})).changed,false);
});
