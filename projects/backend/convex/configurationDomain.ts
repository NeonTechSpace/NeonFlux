import type { DashboardConfigurationFamily, DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { rule, rulePatch, settingsPatch, defaultSettings } from "./moderationDomain.ts"
import { shape, publishingContent, publishingKind, editPublishingContent } from "./publishingDomain.ts"
import { responseConfigurationOperation } from "./configurationResponses.ts"
import { defaultLevelingSettings, levelMappings, settingsPatch as levelingPatch } from "./levelingDomain.ts"
import { milestoneCivil, milestoneKind } from "./milestonesDomain.ts"
import { scheduleContentSource } from "./schedulesDomain.ts"
import { eventCapacity, eventOffsets } from "./eventsDomain.ts"
import { ticketQuestions, visibility } from "./ticketDomain.ts"
import { voiceCategory, voiceChannelName, voicePatch, voiceRegion, voiceTemplate, voiceUserLimit } from "./voiceDomain.ts"
import { fail, object, requireId, bool, ids, integer, name, text } from "./validation.ts"
import { requireNickname } from "./generalSettings.ts"
import { rolePickerOperation } from "./rolePickerDomain.ts"

const revision = (value: unknown) => integer(value, 0, Number.MAX_SAFE_INTEGER)
const fields: Record<Exclude<DashboardConfigurationFamily,"responses"|"rolepicker">, Record<string,string[]>> = {
 moderation:{settings:["patch"],"rule-create":["rule"],"rule-update":["name","patch"],"rule-delete":["name"],"watchlist-add":["userId","reason"],"watchlist-remove":["userId"]},
 publishing:{settings:["patch"],"draft-create":["kind","name","content?"],"draft-set":["kind","name","expectedRevision","content"],"draft-clone":["kind","name","expectedRevision","toKind","toName"],"draft-delete":["kind","name","expectedRevision"],"draft-update":["kind","name","expectedRevision","edit"]},
 greetings:{configure:["route","templateName","expectedTemplateRevision","channelId?","timing?"],module:["route","enabled"],clear:["route"],settings:["claimsPerMinute?","retentionDays?"]},
 tickets:{settings:["enabled?","retentionDays?"],"category-create":["name","visibility","description?","parentId?","supportRoleIds"],"category-update":["name","expectedRevision","patch"],"category-delete":["name","expectedRevision"],"canned-set":["name","expectedRevision","cannedName","templateName","expectedTemplateRevision"],"canned-remove":["name","expectedRevision","cannedName"]},
 leveling:{settings:["expectedRevision","patch"],mappings:["expectedMappingRevision","mappings"]},
 milestones:{settings:["expectedRevision","enabled"],configure:["kind","expectedRevision","channelId","zone","time","fold","template"],enable:["kind","expectedRevision"],disable:["kind","expectedRevision"],clear:["kind","expectedRevision"]},
 suggestions:{settings:["expectedRevision","enabled"],configure:["expectedRevision","channelId","ownerId"]},
 cleanup:{module:["expectedRevision","enabled"],configure:["channelId","expectedRevision","ageMs","ownerId"],enable:["channelId","expectedRevision","enabled","confirm?"],exclude:["channelId","expectedRevision","kind","id","add"],owner:["channelId","expectedRevision","ownerId"],"policy-delete":["channelId","expectedRevision","confirm"]},
 events:{settings:["expectedRevision","enabled"],create:["name","title","description?","channelId","ownerId"],calendar:["eventNo","expectedRevision","calendar"],content:["eventNo","expectedRevision","title","description"],capacity:["eventNo","expectedRevision","capacity"],reminders:["eventNo","expectedRevision","offsets"],template:["eventNo","expectedRevision","templateName","expectedTemplateRevision?"],destination:["eventNo","expectedRevision","channelId"],publish:["eventNo","expectedRevision"],cancel:["eventNo","expectedRevision"],forget:["eventNo","expectedRevision","confirm"]},
 voice:{"generator-add":["channelName","categoryId","template","userLimit","region"],"generator-set":["channelId","expectedRevision","patch"],"generator-remove":["channelId","expectedRevision"]},
 schedules:{settings:["expectedRevision","enabled"],create:["name","source","channelId","calendar"],content:["scheduleNo","expectedRevision","source"],calendar:["scheduleNo","expectedRevision","calendar"],destination:["scheduleNo","expectedRevision","channelId"],enable:["scheduleNo","expectedRevision"],disable:["scheduleNo","expectedRevision"],cancel:["scheduleNo","expectedRevision"],forget:["scheduleNo","expectedRevision","confirm","occurrenceNos?"]},
 nickname:{set:["nickname"],reset:[]},
}
function browserCalendar(value:unknown,event:boolean) {
 const r=shape(value,["localMinute","zone","fold","recurrence",...(event?["durationMinutes"]:[])],["localMinute","zone","fold","recurrence",...(event?["durationMinutes"]:[])])
 if(typeof r.localMinute!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(r.localMinute)) fail(400,"Invalid local minute")
 text(r.zone,128); try {new Intl.DateTimeFormat("en",{timeZone:String(r.zone)})} catch {fail(400,"Invalid time zone")}
 if(!["reject","earlier","later"].includes(String(r.fold))) fail(400,"Invalid fold policy")
 const recurrence=object(r.recurrence)
 if(recurrence.type==="none") shape(recurrence,["type"],["type"])
 else {shape(recurrence,["type","interval","count"],["type","interval","count"]);if(!["daily","weekly"].includes(String(recurrence.type))) fail(400,"Invalid recurrence");integer(recurrence.interval,1,12);integer(recurrence.count,1,26)}
 if(event) integer(r.durationMinutes,1,10080)
 return r
}
export function configurationOperation<F extends DashboardConfigurationFamily>(family:F,value:unknown):DashboardConfigurationOperationMap[F] {
 if(JSON.stringify(value)?.length>65536) fail(400,"Configuration is too large")
 if(family==="responses") return responseConfigurationOperation(value) as DashboardConfigurationOperationMap[F]
 if(family==="rolepicker") return rolePickerOperation(value,true) as DashboardConfigurationOperationMap[F]
 const raw=object(value),spec=fields[family as Exclude<F,"responses"|"rolepicker">]?.[String(raw.type)]
 if(!spec) fail(400,"Unsupported configuration operation")
 const op=shape(raw,["type",...spec.map(k=>k.replace(/\?$/,""))],["type",...spec.filter(k=>!k.endsWith("?"))])
 for(const key of ["expectedRevision","expectedMappingRevision","expectedTemplateRevision"]) if(op[key]!==undefined) revision(op[key])
 for(const key of ["eventNo","scheduleNo"]) if(op[key]!==undefined) integer(op[key],1,Number.MAX_SAFE_INTEGER)
 for(const key of ["channelId","ownerId","userId","id"]) if(op[key]!==undefined) requireId(op[key])
 for(const key of ["name","toName","templateName","cannedName"]) if(op[key]!==undefined && op[key]!==null) name(op[key])
 if(op.enabled!==undefined) bool(op.enabled)
 if(family==="moderation") {
  if(op.type==="settings") settingsPatch(defaultSettings(),op.patch)
  if(op.type==="rule-create") op.rule=rule(op.rule)
  if(op.type==="rule-update") {const patch=object(op.patch);rulePatch(rule({name:"validation",type:"spam",enabled:true,priority:0,action:"delete",durationSeconds:1,patterns:[],domainMode:"block",channelIds:[],exemptChannelIds:[],exemptRoleIds:[],threshold:1,windowSeconds:1}),patch)}
  if(op.reason!==undefined) text(op.reason,512)
 } else if(family==="publishing") {
  if(op.type==="settings") {const patch=shape(op.patch,["enabled","retentionDays"]);if(!Object.keys(patch).length) fail(400,"Choose a setting");if(patch.enabled!==undefined)bool(patch.enabled);if(patch.retentionDays!==undefined)integer(patch.retentionDays,30,3650)}
  if(op.kind!==undefined) publishingKind(op.kind);if(op.toKind!==undefined) publishingKind(op.toKind)
  if(op.content!==undefined) op.content=publishingContent(op.content,true)
  if(op.edit!==undefined) {const edit=object(op.edit);const edits:Record<string,string[]>={content:["content"],embed:["embed"],"embed-clear":[],"embed-property":["field","value"],"field-add":["field"],"field-set":["index","field"],"field-remove":["index"],"fields-clear":[]};const keys=edits[String(edit.type)];if(!keys)fail(400,"Invalid draft edit");shape(edit,["type",...keys],["type",...keys]);if(edit.index!==undefined)integer(edit.index,1,25);const dummy={content:"validation",embed:{fields:Array.from({length:edit.type==="field-add"?0:25},()=>({name:"validation",value:""}))}};editPublishingContent(dummy,edit)}
 } else if(family==="greetings") {
  if(op.route!==undefined && !["welcome","dm","goodbye"].includes(String(op.route))) fail(400,"Invalid greeting route")
  if(op.timing!==undefined && !["join","verified"].includes(String(op.timing))) fail(400,"Invalid greeting timing")
  if(op.claimsPerMinute!==undefined)integer(op.claimsPerMinute,1,60);if(op.retentionDays!==undefined)integer(op.retentionDays,30,3650)
  if(op.type==="settings" && op.claimsPerMinute===undefined && op.retentionDays===undefined)fail(400,"Choose a setting")
 } else if(family==="tickets") {
  if(op.retentionDays!==undefined)integer(op.retentionDays,1,365)
  const patch=op.type==="category-update"?shape(op.patch,["enabled","visibility","description","parentId","supportRoleIds","questions"]):op
  if(op.type==="category-update" && !Object.keys(patch).length)fail(400,"Choose a category setting")
  if(patch.enabled!==undefined)bool(patch.enabled);if(patch.visibility!==undefined)visibility(patch.visibility)
  if(patch.description!==undefined && patch.description!=="")text(patch.description,1000);if(patch.parentId!==undefined && patch.parentId!==null)requireId(patch.parentId)
  if(patch.supportRoleIds!==undefined)ids(patch.supportRoleIds);if(patch.questions!==undefined)ticketQuestions(patch.questions)
  if(op.type==="settings" && op.enabled===undefined && op.retentionDays===undefined)fail(400,"Choose a setting")
 } else if(family==="leveling") {
  if(op.type==="settings")levelingPatch(defaultLevelingSettings(),op.patch);else op.mappings=levelMappings(op.mappings)
 } else if(family==="milestones") {
  if(op.kind!==undefined)milestoneKind(op.kind)
  if(op.type==="configure") {milestoneCivil({zone:op.zone,time:op.time,fold:op.fold});const template=shape(op.template,["name","revision"],["name","revision"]);name(template.name);integer(template.revision,1,Number.MAX_SAFE_INTEGER)}
 } else if(family==="cleanup") {
  if(op.ageMs!==undefined)integer(op.ageMs,3600000,31536000000)
  if(op.add!==undefined)bool(op.add)
  if(op.type==="exclude" && !["author","message"].includes(String(op.kind)))fail(400,"Invalid exclusion")
  if(op.confirm!==undefined && op.confirm!==true)fail(400,"Confirmation required")
 } else if(family==="nickname") {
  if(op.type==="set" && requireNickname(op.nickname)===null)fail(400,"Use reset to clear the nickname")
 } else if(family==="voice") {
  if(op.type==="generator-add") {voiceChannelName(op.channelName);voiceCategory(op.categoryId);voiceTemplate(op.template);voiceUserLimit(op.userLimit);voiceRegion(op.region)}
  if(op.type==="generator-set") op.patch=voicePatch(op.patch)
 } else if(family==="events" || family==="schedules") {
  if(op.calendar!==undefined)browserCalendar(op.calendar,family==="events")
  if(op.title!==undefined && !text(op.title,256).length)fail(400,"Title required")
  if(op.description!==undefined && op.description!=="")text(op.description,3500)
  if(op.capacity!==undefined)eventCapacity(op.capacity);if(op.offsets!==undefined)eventOffsets(op.offsets)
  if(op.source!==undefined)scheduleContentSource(op.source)
  if(op.type==="forget" && op.confirm!=="forget")fail(400,"Confirmation required")
  if(op.occurrenceNos!==undefined) {if(!Array.isArray(op.occurrenceNos) || op.occurrenceNos.length>26)fail(400,"Invalid occurrences");op.occurrenceNos.forEach(x=>integer(x,1,Number.MAX_SAFE_INTEGER))}
 }
 return op as DashboardConfigurationOperationMap[F]
}
export function configurationCritical(family:DashboardConfigurationFamily,value:unknown) {
 const raw=object(value),op=family==="responses"?object(raw.operation):raw
 if(family==="leveling" && op.type==="mappings" && Array.isArray(op.mappings) && !op.mappings.length)return true
 if(op.type==="settings" && op.patch!==undefined) {const patch=object(op.patch),entries=Object.entries(patch);if(entries.length && entries.every(([key,value])=>(key==="enabled" || key.endsWith("Enabled")) && value===false || family==="moderation" && key==="defcon"))return true}
 return ["disable","clear","cancel","delete","rule-delete","watchlist-remove","draft-delete","category-delete","canned-remove","policy-delete","forget","menu-remove"].includes(String(op.type)) || op.enabled===false || op.type==="settings" && Object.entries(object(op.patch??{})).length>0 && Object.entries(object(op.patch)).every(([key,value])=>key.endsWith("Enabled") && value===false)
}
