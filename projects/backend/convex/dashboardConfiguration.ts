import { v } from "convex/values"
import { action, query, internalMutation } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import type { DashboardConfigurationJob, DashboardConfigurationQueueResult, DashboardConfigurationSnapshot, DashboardConfigurationFamily, DashboardConfigurationCursors, DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { verifyProvider } from "./dashboardProvider.ts"
import { bumpConfigurationRevision, configurationFamily, configurationFamilyValidator, configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { configurationOperation, configurationCritical } from "./configurationDomain.ts"
import { configurationData } from "./configurationSnapshot.ts"
import { configurationNativeTarget, configurationNativeOperation } from "./configurationNative.ts"
import { applyResponseConfiguration } from "./configurationResponses.ts"
import { applyModerationConfiguration } from "./moderation.ts"
import { applyPublishingConfiguration } from "./publishing.ts"
import { applyGreetingConfiguration } from "./greetings.ts"
import { applyTicketConfiguration } from "./tickets.ts"
import { applyLevelingConfiguration } from "./leveling.ts"
import { applyMilestonesManagement } from "./milestones.ts"
import { applySuggestionsConfiguration } from "./suggestions.ts"
import { applyCleanupManagement } from "./cleanup.ts"
import { applyEventsManagement } from "./events.ts"
import { applySchedulesManagement } from "./schedules.ts"
import { writeNickname } from "./generalSettings.ts"
import { applyVoiceManagement } from "./voice.ts"
import { applyRolePickerConfiguration } from "./rolePicker.ts"
import { applyStickyManagement } from "./sticky.ts"
import { applyHelpDeskManagement } from "./helpDesk.ts"
import { applySidebarManagement } from "./sidebar.ts"
import { sidebarOperation } from "./sidebarDomain.ts"
import { applyTemporaryRoleConfiguration } from "./temporaryRoles.ts"
import { applyAlertsManagement } from "./alerts.ts"
import { applyOnboardingConfiguration } from "./onboarding.ts"
import { applyPreset } from "./presets.ts"
import { applyLfgSettings } from "./lfg.ts"
import type { ConfigurationChange } from "./configurationChange.ts"
import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, object, integer, text } from "./validation.ts"
import { ringWork } from "./workSignal.ts"
import type { EventsContext, CleanupContext } from "../contracts.js"

export function publicConfigurationJob(row:Doc<"dashboardConfigurationJobs">):DashboardConfigurationJob {
 return {id:row._id,family:row.family,actorId:row.actorId,expectedConfigRevision:row.expectedConfigRevision,operation:row.operation,state:row.state,createdAt:row.createdAt,expiresAt:row.expiresAt,...(row.error?{error:row.error}:{})} as DashboardConfigurationJob
}
const args={sessionToken:v.string(),serverId:v.string(),family:configurationFamilyValidator,requestId:v.string(),expectedConfigRevision:v.number(),operation:v.any()}
const key=(value:unknown):string=>JSON.stringify(value,(_,item:unknown)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)
export const snapshot=query({args:{sessionToken:v.string(),serverId:v.string(),family:configurationFamilyValidator,cursors:v.optional(v.any())},handler:async(ctx,input):Promise<DashboardConfigurationSnapshot>=>{
 await dashboardSession(ctx,input.sessionToken,input.serverId)
 const family=configurationFamily(input.family),data=await configurationData(ctx,input.serverId,family,input.cursors as DashboardConfigurationCursors|undefined)
 return {family,serverId:input.serverId,configRevision:await configurationRevision(ctx,input.serverId,family),...data,jobs:(await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family",q=>q.eq("serverId",input.serverId).eq("family",family)).order("desc").take(10)).map(publicConfigurationJob)} as DashboardConfigurationSnapshot
}})
export const queue=action({args,handler:async(ctx,input):Promise<DashboardConfigurationQueueResult>=>{
 const stored=await ctx.runQuery(internal.dashboard.secret,{sessionToken:input.sessionToken}),identity=await verifyProvider(stored.accessToken)
 if(identity.user.id!==stored.userId || !identity.servers.some(server=>server.id===input.serverId)) {await ctx.runMutation(internal.dashboard.revoke,{sessionToken:input.sessionToken});fail(403,"Manage Server permission required")}
 await ctx.runMutation(internal.dashboard.renew,{sessionToken:input.sessionToken,user:identity.user,servers:identity.servers})
 return ctx.runMutation(internal.dashboardConfiguration.enqueue,input)
}})
export const enqueue=internalMutation({args,handler:async(ctx,input):Promise<DashboardConfigurationQueueResult>=>{
 const session=await dashboardSession(ctx,input.sessionToken,input.serverId),family=configurationFamily(input.family),operation=configurationOperation(family,input.operation),revision=await configurationRevision(ctx,input.serverId,family)
 integer(input.expectedConfigRevision,0,Number.MAX_SAFE_INTEGER)
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId))fail(400,"Invalid configuration request")
 const existing=await ctx.db.query("dashboardConfigurationJobs").withIndex("by_request",q=>q.eq("sessionId",session._id).eq("serverId",input.serverId).eq("requestId",input.requestId)).unique()
 if(existing) {if(existing.family!==family || existing.expectedConfigRevision!==input.expectedConfigRevision || key(existing.operation)!==key(operation))fail(409,"Configuration request already used");return {queued:true,conflict:false,revision,jobId:existing._id}}
 if(revision!==input.expectedConfigRevision)return {queued:false,conflict:true,revision}
 const retained=await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family",q=>q.eq("serverId",input.serverId).eq("family",family)).take(201),createdAt=Date.now(),expiresAt=Math.min(createdAt+120000,session.expiresAt,session.lifetimeAt)
 if(retained.length>=200)fail(429,"Dashboard configuration capacity reached")
 if(retained.some(row=>row.state==="queued" && row.expiresAt>createdAt))fail(409,"A configuration change is still pending")
 const id=await ctx.db.insert("dashboardConfigurationJobs",{serverId:input.serverId,family,actorId:session.userId,sessionId:session._id,requestId:input.requestId,expectedConfigRevision:revision,operation,state:"queued",createdAt,expiresAt,cleanupAt:createdAt+86400000})
 await ctx.scheduler.runAt(expiresAt,internal.dashboardConfiguration.expire,{id});await ctx.scheduler.runAt(createdAt+86400000,internal.dashboardConfiguration.cleanup,{id})
 await ringWork(ctx)
 return {queued:true,conflict:false,revision,jobId:id}
}})
export const expire=internalMutation({args:{id:v.id("dashboardConfigurationJobs")},handler:async(ctx,{id})=>{const row=await ctx.db.get(id);if(row?.state==="queued" && row.expiresAt<=Date.now())await ctx.db.patch(id,{state:"failed",error:"Bot did not complete this change before its permission grant expired"})}})
export const cleanup=internalMutation({args:{id:v.id("dashboardConfigurationJobs")},handler:async(ctx,{id})=>{const row=await ctx.db.get(id);if(row && row.cleanupAt<=Date.now())await ctx.db.delete(id)}})
export const ready=serviceQuery({args:{request:v.any()},handler:async(ctx,{request})=>{
 const input=shape(request,["serverId"],["serverId"])
 // Member requests have their own bounded queue and worker route, see rolePicker.ts
 const rows=await ctx.db.query("dashboardConfigurationJobs").withIndex("by_work",q=>q.eq("serverId",String(input.serverId)).eq("state","queued")).filter(q=>q.neq(q.field("family"),"member")).take(4)
 return {jobs:(await Promise.all(rows.map(async row=>row.family==="member" || row.expiresAt<=Date.now()?null:({...publicConfigurationJob(row),native:await configurationNativeTarget(ctx,row.serverId,row.family,row.operation)})))).filter(job=>job!==null)}
}})
async function apply(ctx:MutationCtx,job:Doc<"dashboardConfigurationJobs">,input:Record<string,unknown>,change:Omit<ConfigurationChange,"operation">) {
 if(job.family==="member")fail(403,"Configuration grant mismatch")
 const {operation,context}=await configurationNativeOperation(ctx,job.serverId,job.family,job.operation,input),op=object(operation),now=Date.now(),identity={serverId:job.serverId,actorId:job.actorId,createdAt:job.createdAt,source:{kind:"dashboard" as const,jobId:job._id}}
 switch(job.family) {
 case "responses":return applyResponseConfiguration(ctx,job.serverId,operation as Parameters<typeof applyResponseConfiguration>[2],now)
 case "moderation":return applyModerationConfiguration(ctx,job.serverId,op,now)
 case "publishing":return applyPublishingConfiguration(ctx,job.serverId,op,now)
 case "greetings":return applyGreetingConfiguration(ctx,job.serverId,op,now)
 case "tickets":return applyTicketConfiguration(ctx,job.serverId,op)
 case "leveling":return applyLevelingConfiguration(ctx,job.serverId,op,now)
 case "milestones":return applyMilestonesManagement(ctx,identity,context as EventsContext|undefined,op,now)
 case "suggestions":return applySuggestionsConfiguration(ctx,identity,context as EventsContext|undefined,op)
 case "cleanup":return applyCleanupManagement(ctx,identity,context as CleanupContext|undefined,op)
 case "events":return applyEventsManagement(ctx,identity,context as EventsContext|undefined,op,now)
 case "schedules":return applySchedulesManagement(ctx,identity,context as EventsContext|undefined,op,now)
 // Execute bumps the family revision once after this, and the bot reports its native result for that revision
 case "nickname":{const nickname=op.type==="set"?String(op.nickname):null;await writeNickname(ctx,job.serverId,job.actorId,nickname,job.expectedConfigRevision+1);return {nickname}}
 case "voice":return applyVoiceManagement(ctx,identity,op)
 case "rolepicker":return applyRolePickerConfiguration(ctx,job.serverId,op)
 case "sticky":return applyStickyManagement(ctx,identity,operation as DashboardConfigurationOperationMap["sticky"])
 case "sidebar":return applySidebarManagement(ctx,identity,sidebarOperation(op.type==="add"?{type:"add",channelId:op.channelId,name:op.name}:op))
 // The bot applied the order natively before this request, and execute records it
 case "memberlist":return {}
 case "temproles":return applyTemporaryRoleConfiguration(ctx,job.serverId,op)
 // Invite jobs carry the list the bot read after it revoked or refreshed, see configurationNative.ts
 case "alerts":return applyAlertsManagement(ctx,job.serverId,job.actorId,operation as Parameters<typeof applyAlertsManagement>[3])
 case "helpdesk":return applyHelpDeskManagement(ctx,identity,operation as DashboardConfigurationOperationMap["helpdesk"])
 case "onboarding":return applyOnboardingConfiguration(ctx,job.serverId,op)
 case "presets":await applyPreset(ctx,identity,op.name,op.token,change);return {}
 case "lfg":return {settings:await applyLfgSettings(ctx,job.serverId,(operation as DashboardConfigurationOperationMap["lfg"]).patch)}
 }
}
export const execute=serviceMutation({args:{request:v.any()},handler:async(ctx,{request})=>{
 const input=shape(request,["serverId","jobId","actorId","managerAuthorized","observedAt","actor","context","recipientOwner","roles","display","calendar","references"],["serverId","jobId","actorId","managerAuthorized","observedAt","actor"])
 const id=ctx.db.normalizeId("dashboardConfigurationJobs",String(input.jobId)),job=id?await ctx.db.get(id):null
 if(!job || job.serverId!==input.serverId || job.actorId!==input.actorId || job.family==="member")fail(403,"Configuration grant mismatch")
 if(job.state!=="queued")return {job:publicConfigurationJob(job)}
 const session=await ctx.db.get(job.sessionId),now=Date.now()
 if(job.expiresAt<=now || !session || session.expiresAt<=now || session.lifetimeAt<=now || session.userId!==job.actorId || !session.servers.some(server=>server.id===job.serverId) || input.managerAuthorized!==true) {await ctx.db.patch(job._id,{state:"failed",error:"Manage Server permission grant expired or was revoked"});return {job:publicConfigurationJob((await ctx.db.get(job._id))!)}}
 integer(input.observedAt,Math.max(0,now-60000),now+60000)
 if(await configurationRevision(ctx,job.serverId,job.family)!==job.expectedConfigRevision) {await ctx.db.patch(job._id,{state:"conflict",error:"Configuration changed after this request was queued"});return {job:publicConfigurationJob((await ctx.db.get(job._id))!)}}
 const moderation=await ctx.db.query("moderationSettings").withIndex("by_server",q=>q.eq("serverId",job.serverId)).unique()
 if(moderation?.config.defcon===1 && !configurationCritical(job.family,job.operation))fail(403,"DEFCON restriction")
 const change={kind:"dashboard" as const,createdAt:job.createdAt,actor:{userId:job.actorId,name:session.userName,source:"website" as const}}
 // A preset records each family it changes on its own, so only its own revision moves here
 const result=job.family==="presets"?await apply(ctx,job,input,change).then(async value=>{await bumpConfigurationRevision(ctx,job.serverId,"presets",change);return value})
  :await changeConfiguration(ctx,job.serverId,job.family,{...change,operation:job.operation},()=>apply(ctx,job,input,change))
 await ctx.db.patch(job._id,{state:"applied"})
 await admitMetadata(ctx,job.serverId,metadataEvent({category:"settings",type:"settings-change",source:{kind:"dashboard",jobId:job._id,scope:job.family},observedAt:now,actor:{kind:"configuration",userId:job.actorId},resourceIds:[],changedFields:["configuration"],count:1,outcome:"accepted"},true))
 return {job:publicConfigurationJob((await ctx.db.get(job._id))!),...("grant" in result && result.grant?{grant:result.grant}:{})}
}})
export const failJob=serviceMutation({args:{request:v.any()},handler:async(ctx,{request})=>{
 const input=shape(request,["serverId","jobId","reason"],["serverId","jobId"]),id=ctx.db.normalizeId("dashboardConfigurationJobs",String(input.jobId)),job=id?await ctx.db.get(id):null
 if(!job || job.serverId!==input.serverId)fail(403,"Configuration grant mismatch")
 // The bot names the fix when it knows it, such as a forum without room for the suggestion status tags
 const reason=input.reason===undefined?undefined:text(input.reason,500)
 if(job.state==="queued")await ctx.db.patch(job._id,{state:"failed",error:reason??"The bot could not apply this change. Check the bot is online, its permissions and the selected channels and roles, then save again"})
 return null
}})
export async function dashboardConfigurationPublishingFence(ctx:MutationCtx,attempt:Doc<"publishingAttempts">,value:unknown) {
 const input=shape(value,["jobId","actorId","managerAuthorized","observedAt","botId","channelId"],["jobId","actorId","managerAuthorized","observedAt","botId","channelId"])
 if(attempt.source?.type!=="dashboard-configuration" || input.jobId!==attempt.source.jobId || input.botId!==attempt.botId || input.channelId!==attempt.channelId || input.managerAuthorized!==true || attempt.sourceId!==input.jobId)fail(403,"Configuration publishing grant mismatch")
 integer(input.observedAt,Math.max(0,Date.now()-60000),Date.now()+60000)
 const id=ctx.db.normalizeId("dashboardConfigurationJobs",String(input.jobId)),job=id?await ctx.db.get(id):null,session=job?await ctx.db.get(job.sessionId):null
 if(!job || job.family!=="events" || job.serverId!==attempt.serverId || job.actorId!==input.actorId || job.createdAt!==attempt.source.createdAt || job.state!=="applied" || job.expiresAt<=Date.now() || !session || session.userId!==job.actorId || session.expiresAt<=Date.now() || session.lifetimeAt<=Date.now() || !session.servers.some(server=>server.id===job.serverId) || await configurationRevision(ctx,job.serverId,"events")!==job.expectedConfigRevision+1)fail(403,"Configuration publishing permission expired or changed")
}
