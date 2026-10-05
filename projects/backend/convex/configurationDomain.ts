import { DashboardConfigurationOperationMap, type DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import { rule } from "./moderationDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import { responseConfigurationOperation } from "./configurationResponses.ts"
import { levelMappings } from "./levelingDomain.ts"
import { milestoneCivil } from "./milestonesDomain.ts"
import { decode, fail } from "./validation.ts"

export function configurationOperation<F extends DashboardConfigurationFamily>(family:F,value:unknown):DashboardConfigurationOperationMap[F] {
 if(JSON.stringify(value)?.length>65536) fail(400,"Configuration is too large")
 return operation(family,value) as DashboardConfigurationOperationMap[F]
}
// Each job stores its operation as the family applies it: decoded by the family's own helper where it has one, otherwise by its
// dashboard schema, with automod rules, draft content and level rewards in their normalized form
function operation(family:DashboardConfigurationFamily,value:unknown) {
 switch(family) {
 case "responses":return responseConfigurationOperation(value)
 case "moderation":{const op=decode(DashboardConfigurationOperationMap.moderation,value);return op.type==="rule-create"?{...op,rule:rule(op.rule)}:op}
 case "publishing":{const op=decode(DashboardConfigurationOperationMap.publishing,value);return op.type==="draft-set" || op.type==="draft-create" && op.content?{...op,content:publishingContent(op.content,true)}:op}
 case "leveling":{const op=decode(DashboardConfigurationOperationMap.leveling,value);return op.type==="mappings"?{...op,mappings:levelMappings(op.mappings)}:op}
 // A zone and time must also resolve on an ordinary day in the zone database
 case "milestones":{const op=decode(DashboardConfigurationOperationMap.milestones,value);if(op.type==="configure")milestoneCivil({zone:op.zone,time:op.time,fold:op.fold});return op}
 default:return decode(DashboardConfigurationOperationMap[family],value)
 }
}
type Critical={type:string,enabled?:unknown,patch?:Record<string,unknown>,mappings?:unknown[]}
// Takes a stored operation, which configurationOperation decoded when it was queued
export function configurationCritical(family:DashboardConfigurationFamily,value:unknown) {
 const op=(family==="responses"?(value as {operation:unknown}).operation:value) as Critical,patch=Object.entries(op.patch??{})
 if(family==="leveling" && op.type==="mappings" && op.mappings?.length===0)return true
 if(op.type==="settings" && op.patch!==undefined && patch.length && patch.every(([key,value])=>(key==="enabled" || key.endsWith("Enabled")) && value===false || family==="moderation" && key==="defcon"))return true
 return ["disable","clear","cancel","delete","rule-delete","watchlist-remove","draft-delete","category-delete","canned-remove","policy-delete","forget"].includes(op.type) || op.enabled===false || op.type==="settings" && patch.length>0 && patch.every(([key,value])=>key.endsWith("Enabled") && value===false)
}
