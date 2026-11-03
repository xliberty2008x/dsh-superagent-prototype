import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {relocateWorkspaces} from './workspace-paths.mjs';
const runtime=process.env.DSH_TEST_RUNTIME;
assert.ok(runtime,'Set DSH_TEST_RUNTIME');
const {WorkspaceEntity}=await import(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-workspace/lib/types/entity.js')));
const domain=path=>({unit:{name:'workspace',version:2},global:{workspaceIds:['stable'],pinnedSessionIds:['old']},tables:{workspaces:{stable:{path,title:'Preserved',sessionIds:['old'],createdAt:'before',updatedAt:'before'}}}});
function entity(record,cwd){let stored=record;return new WorkspaceEntity({readSessionHeader:async()=>({cwd}),rememberSessionPath:()=>{},candidateMatches:()=>true,table:()=>({update:async(_id,fn)=>stored=fn(stored)})},'stable',record);}
test('native attach rejects moved symlink spelling; migration preserves identity and repairs attach',async()=>{
 const base=await mkdtemp(join(tmpdir(),'workspace-migration-test-'));
 try{
  const actual=join(base,'durable');await mkdir(actual);const old=join(base,'old');await symlink(actual,old);
  const original=domain(old);await assert.rejects(entity(original.tables.workspaces.stable,old).attachSession('new'),/cwd resolves/);
  const result=await relocateWorkspaces(original,[old],actual);
  await assert.doesNotReject(entity(result.document.tables.workspaces.stable,old).attachSession('new'));
  assert.equal(result.changes.length,1);assert.equal(original.tables.workspaces.stable.path,old);
  const expected=structuredClone(original);expected.tables.workspaces.stable.path=await import('node:fs/promises').then(m=>m.realpath(actual));
  assert.deepEqual(result.document,expected);
  assert.equal((await relocateWorkspaces(result.document,[old],actual)).changes.length,0);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('unrelated prefix-lookalike records and all other metadata remain untouched',async()=>{
 const original=domain('/tmp/old-looking/state');
 assert.deepEqual((await relocateWorkspaces(original,['/tmp/old'],'/nonexistent')).document,original);
});
test('unsupported schema and missing targets fail without mutating input',async()=>{
 await assert.rejects(relocateWorkspaces({unit:{name:'workspace',version:3}},[],''),/Unsupported/);
 const original=domain('/tmp/old/state');const before=structuredClone(original);
 await assert.rejects(relocateWorkspaces(original,['/tmp/old'],'/does-not-exist'));
 assert.deepEqual(original,before);
});
