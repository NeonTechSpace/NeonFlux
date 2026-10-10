import type { DashboardConfigurationCursors, DashboardConfigurationFamily, DashboardConfigurationDataMap } from "../dashboard-contracts.js"
import type { QueryCtx } from "./_generated/server.js"
import { configurationCursor, configurationCursorKey } from "./configurationCursor.ts"
import { definition } from "./responses.ts"
import { config, publicRule, readSettings } from "./moderationStore.ts"
import { publicDraft } from "./publishing.ts"
import { defaultGreetings } from "./greetingsDomain.ts"
import { defaultTickets } from "./ticketDomain.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { milestoneSettings, publicMilestoneRoute } from "./milestonesStore.ts"
import { suggestionSettings, publicSuggestionSettings } from "./suggestionsStore.ts"
import { cleanupSettings, publicCleanupPolicy, publicCleanupSettings } from "./cleanupStore.ts"
import { eventSettings, publicEvent } from "./eventsStore.ts"
import { scheduleSettings, publicSchedule } from "./schedulesStore.ts"
import { publicVoiceGenerator, readVoiceGenerators, readVoiceRooms } from "./voice.ts"
import { shape } from "./publishingDomain.ts"
import { fail } from "./validation.ts"
import { publicNickname, readGeneral } from "./generalSettings.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { readAccess } from "./memberAccess.ts"
import { ROLE_PICKER_FEATURE } from "./rolePickerDomain.ts"

export async function configurationData(ctx:QueryCtx,serverId:string,family:DashboardConfigurationFamily,cursors:DashboardConfigurationCursors={}) {
 shape(cursors,["definitions","rules","watchlist","drafts","categories","routes","policies","events","schedules"])
 const nextCursors:DashboardConfigurationCursors={}
 const key=(collection:keyof DashboardConfigurationCursors)=>{const result=configurationCursorKey(`${serverId}:${family}:${collection}`,cursors[collection]);if(result!==undefined && typeof result!==(["events","schedules"].includes(collection)?"number":"string"))fail(400,"Invalid configuration cursor key");return result}
 const page=<T>(collection:keyof DashboardConfigurationCursors,result:T[],last:(row:T)=>string|number)=>{if(result.length>20)nextCursors[collection]=configurationCursor(`${serverId}:${family}:${collection}`,last(result[19]!));return result.slice(0,20)}
 let data:DashboardConfigurationDataMap[DashboardConfigurationFamily]
 switch(family) {
 case "responses": {const row=await ctx.db.query("responseSettings").withIndex("by_server",q=>q.eq("serverId",serverId)).unique(),after=key("definitions") as string|undefined,[afterKind,afterName]=(after??"custom:").split(":");let rows=[] as import("./_generated/dataModel.js").Doc<"responseDefinitions">[];for(const kind of ["custom","auto"] as const) {if(afterKind==="auto" && kind==="custom")continue;const names=kind===afterKind?afterName:undefined;rows.push(...await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name",q=>names?q.eq("serverId",serverId).eq("kind",kind).gt("name",names):q.eq("serverId",serverId).eq("kind",kind)).take(21-rows.length));if(rows.length>=21)break}data={settings:{customEnabled:row?.customEnabled??true,autoEnabled:row?.autoEnabled??true},definitions:page("definitions",rows,row=>`${row.kind}:${row.name}`).map(definition)};break}
 case "moderation": {const row=await readSettings(ctx,serverId);data={settings:config(row),privateDataRoleId:row?.privateDataRoleId??null,rules:page("rules",await ctx.db.query("automodRules").withIndex("by_server_name",q=>key("rules")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("name",key("rules") as string)).take(21),row=>row.name).map(publicRule),watchlist:page("watchlist",await ctx.db.query("securityWatchlist").withIndex("by_server_user",q=>key("watchlist")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("userId",key("watchlist") as string)).take(21),row=>row.userId).map(({userId,reason,createdAt})=>({userId,reason,createdAt}))};break}
 case "publishing": {const row=await ctx.db.query("publishingSettings").withIndex("by_server",q=>q.eq("serverId",serverId)).unique(),after=key("drafts") as string|undefined,[afterKind,afterName]=(after??"draft:").split(":");let rows=[] as import("./_generated/dataModel.js").Doc<"publishingDrafts">[];for(const kind of ["draft","template"] as const) {if(afterKind==="template" && kind==="draft")continue;const names=kind===afterKind?afterName:undefined;rows.push(...await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name",q=>names?q.eq("serverId",serverId).eq("kind",kind).gt("name",names):q.eq("serverId",serverId).eq("kind",kind)).take(21-rows.length));if(rows.length>=21)break}data={settings:{enabled:row?.enabled??true},drafts:page("drafts",rows,row=>`${row.kind}:${row.name}`).map(publicDraft)};break}
 case "greetings":data={settings:(await ctx.db.query("greetingSettings").withIndex("by_server",q=>q.eq("serverId",serverId)).unique())?.config??defaultGreetings()};break
 case "tickets":data={settings:(await ctx.db.query("ticketSettings").withIndex("by_server",q=>q.eq("serverId",serverId)).unique())?.config??defaultTickets(),categories:page("categories",await ctx.db.query("ticketCategories").withIndex("by_name",q=>key("categories")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("config.name",key("categories") as string)).take(21),row=>row.config.name).map(row=>row.config)};break
 case "leveling":data={settings:(await ctx.db.query("levelingSettings").withIndex("by_server",q=>q.eq("serverId",serverId)).unique())?.config??defaultLevelingSettings()};break
 case "milestones": {const row=await milestoneSettings(ctx,serverId);data={settings:{enabled:row?.enabled??false,revision:row?.revision??1,activatedAt:row?.activatedAt??0},routes:page("routes",await ctx.db.query("milestoneRoutes").withIndex("by_kind",q=>key("routes")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("kind",key("routes") as "birthday"|"anniversary")).take(21),row=>row.kind).filter(row=>row.configured).map(publicMilestoneRoute)};break}
 case "suggestions":data={settings:publicSuggestionSettings(await suggestionSettings(ctx,serverId))};break
 case "cleanup":data={settings:publicCleanupSettings(await cleanupSettings(ctx,serverId)),policies:page("policies",await ctx.db.query("cleanupPolicies").withIndex("by_channel",q=>key("policies")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("channelId",key("policies") as string)).take(21),row=>row.channelId).map(publicCleanupPolicy)};break
 case "events": {const row=await eventSettings(ctx,serverId);data={settings:{enabled:row?.enabled??false,revision:row?.revision??1},events:page("events",await ctx.db.query("events").withIndex("by_number",q=>key("events")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("eventNo",key("events") as number)).take(21),row=>row.eventNo).map(publicEvent)};break}
 case "schedules": {const row=await scheduleSettings(ctx,serverId);data={settings:{enabled:row?.enabled??false,revision:row?.revision??1,activatedAt:row?.activatedAt??0},schedules:page("schedules",await ctx.db.query("schedules").withIndex("by_number",q=>key("schedules")===undefined?q.eq("serverId",serverId):q.eq("serverId",serverId).gt("scheduleNo",key("schedules") as number)).take(21),row=>row.scheduleNo).map(publicSchedule)};break}
 case "nickname":data={settings:publicNickname(await readGeneral(ctx,serverId),await configurationRevision(ctx,serverId,"nickname"))};break
 case "voice":data={generators:(await readVoiceGenerators(ctx,serverId)).map(publicVoiceGenerator),rooms:(await readVoiceRooms(ctx,serverId)).length};break
 case "rolepicker":data={settings:await readRolePicker(ctx,serverId),access:await readAccess(ctx,serverId,ROLE_PICKER_FEATURE)};break
 }
 return {data,nextCursors}
}
