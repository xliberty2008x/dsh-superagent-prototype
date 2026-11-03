import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const runtime=process.env.DSH_TEST_RUNTIME;assert.ok(runtime,'Set DSH_TEST_RUNTIME');
const {composeEntries,loadOverlayPatches}=await import(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
test('native profile composer disables auto and mounts exactly one browse pair without name-mismatch warnings',()=>{
 const base=[{insert:[{id:'directory-picker',name:'@deepseek-ai/dsh-host-directory-picker-auto'}]}];
 const overlay=loadOverlayPatches('picker-test',fileURLToPath(new URL('./browser-picker.cordis.patch.yml',import.meta.url)));
 const warnings=[];const rows=composeEntries([base,overlay],line=>warnings.push(line));
 assert.deepEqual(warnings,[]);assert.equal(rows.find(row=>row.id==='directory-picker').disabled,true);
 const active=rows.filter(row=>row.disabled!==true);
 assert.equal(active.filter(row=>row.name==='@deepseek-ai/dsh-host-directory-picker-browse').length,1);
 assert.equal(active.filter(row=>row.name==='@deepseek-ai/dsh-client-ui-directory-picker-browse').length,1);
 assert.equal(active.filter(row=>row.name.includes('picker-auto')||row.name.includes('picker-native')).length,0);
});
