// One-time operator migration; never part of the normal runtime profile.
import {realpath,writeFile} from 'node:fs/promises';
export const inject=['orchestrator','sessionController','workingDirectory'];
export async function migrateEffectiveCwd(host,config){
 const result=await host.sessionController.resolveAgent(config.sessionId);
 if('error' in result)throw new Error('Session resolution failed: '+result.error.code);
 const agent=result.agent;const before=host.workingDirectory.get(agent.session);
 const from=config.fromRoots.find(root=>before===root||before.startsWith(root+'/'));
 if(!from)return {sessionId:config.sessionId,before,after:before,changed:false};
 const target=await realpath(config.toRoot+before.slice(from.length));
 const after=await host.workingDirectory.set(agent,target);
 return {sessionId:config.sessionId,before,after,changed:before!==after};
}
export async function apply(ctx,config){
 await ctx.orchestrator.ready;
 const report=await migrateEffectiveCwd(ctx,config);
 await writeFile(config.report,JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
