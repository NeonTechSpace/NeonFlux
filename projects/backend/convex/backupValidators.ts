import { v } from "convex/values"
import { moderationSettings, automodRule } from "./moderationValidators.ts"
import { responseReply, responseTrigger, responseKind } from "./responseValidators.ts"
import { publishingContent, publishingKind } from "./publishingValidators.ts"
import { rolesSettings, rolesKind, rolesMapping } from "./rolesValidators.ts"
import { greetingsSettings } from "./greetingsValidators.ts"
import { ticketSettings, ticketCategory } from "./ticketValidators.ts"
import { levelingSettings } from "./levelingValidators.ts"
import { milestoneKind, milestoneFold, milestoneTemplate } from "./milestonesValidators.ts"
import { metadataRouteValidator, metadataEventRouteValidator } from "./metadataLogsValidators.ts"

const { defcon: _defcon, ...moderation } = moderationSettings.fields
const { revision: _rolesRevision, ...roles } = rolesSettings.fields
const { revision: _ticketRevision, ...category } = ticketCategory.fields
const { revision: _levelRevision, mappingRevision: _mappingRevision, scoreEpoch: _scoreEpoch, ...leveling } = levelingSettings.fields
const { revision: _metadataRevision, ...metadataRoute } = metadataRouteValidator.fields
const { revision: _metadataEventRevision, ...metadataEventRoute } = metadataEventRouteValidator.fields
const { revision: _greetingRevision, ...greetingRoute } = greetingsSettings.fields.routes.fields.welcome.fields
export const backupConfigValues = {
    moderation: v.object(moderation), responses: v.object({ customEnabled: v.boolean(), autoEnabled: v.boolean() }),
    response: v.object({ kind: responseKind, name: v.string(), reply: responseReply, trigger: v.optional(responseTrigger), channelIds: v.array(v.string()), roleIds: v.array(v.string()), cooldownSeconds: v.number(), priority: v.number(), enabled: v.boolean() }),
    automod: automodRule, publishing: v.object({ enabled: v.boolean(), retentionDays: v.number() }),
    draft: v.object({ kind: publishingKind, name: v.string(), content: publishingContent }), roles: v.object(roles),
    panel: v.object({ name: v.string(), kind: rolesKind, enabled: v.boolean(), exclusive: v.boolean(), mappings: v.array(rolesMapping) }),
    greetings: v.object({ claimsPerMinute: v.number(), retentionDays: v.number(), routes: v.object({ welcome: v.object(greetingRoute), dm: v.object(greetingRoute), goodbye: v.object(greetingRoute) }) }),
    tickets: ticketSettings, ticketCategory: v.object(category), leveling: v.object(leveling), milestones: v.object({ enabled: v.boolean() }),
    milestoneRoute: v.object({ kind: milestoneKind, channelId: v.string(), zone: v.string(), time: v.string(), fold: milestoneFold, template: milestoneTemplate, content: publishingContent, enabled: v.boolean() }),
    suggestions: v.object({ enabled: v.boolean(), channelId: v.optional(v.string()), ownerId: v.optional(v.string()) }), cleanup: v.object({ enabled: v.boolean() }),
    cleanupPolicy: v.object({ channelId: v.string(), enabled: v.boolean(), ageMs: v.number(), ownerId: v.string(), excludedAuthorIds: v.array(v.string()), excludedMessageIds: v.array(v.string()) }),
    metadata: v.object({ enabled: v.boolean(), routes: v.array(v.object(metadataRoute)), eventRoutes: v.optional(v.array(v.object(metadataEventRoute))), messageChannelIds: v.array(v.string()), excludedChannelIds: v.array(v.string()) }),
    events: v.object({ enabled: v.boolean() }), schedules: v.object({ enabled: v.boolean() }),
}
const entry = <K extends keyof typeof backupConfigValues>(family: K) => v.object({ family: v.literal(family), sourceId: v.string(), value: backupConfigValues[family] })
export const backupConfigObject = v.union(entry("moderation"), entry("responses"), entry("response"), entry("automod"), entry("publishing"), entry("draft"), entry("roles"), entry("panel"), entry("greetings"), entry("tickets"), entry("ticketCategory"), entry("leveling"), entry("milestones"), entry("milestoneRoute"), entry("suggestions"), entry("cleanup"), entry("cleanupPolicy"), entry("metadata"), entry("events"), entry("schedules"))
export const backupXpObject = v.object({ sourceId: v.string(), userId: v.string(), xp: v.number() })
export const backupOverwrite = v.object({ id: v.string(), type: v.union(v.literal("role"), v.literal("member")), allow: v.string(), deny: v.string() })
export const backupStructureObject = v.object({ sourceId: v.string(), type: v.union(v.literal("category"), v.literal("text"), v.literal("voice")), name: v.string(), parentId: v.union(v.string(), v.null()), overwrites: v.array(backupOverwrite), topic: v.optional(v.union(v.string(), v.null())), nsfw: v.optional(v.boolean()), slowmodeSeconds: v.optional(v.number()), bitrate: v.optional(v.number()), userLimit: v.optional(v.number()), capturedAt: v.number() })
export const backupObject = v.union(backupConfigObject, backupXpObject, backupStructureObject)
export const backupCategory = v.union(v.literal("config"), v.literal("xp"), v.literal("structure"))
export const backupDisposition = v.union(v.literal("create"), v.literal("skip"), v.literal("conflict"), v.literal("blocked"))
export const backupItemState = v.union(...(["planned", "reserved", "claimed", "created", "skipped", "conflict", "blocked", "failed", "uncertain"] as const).map(x => v.literal(x)))
export const backupOriginState = v.union(...(["reserved", "claimed", "created", "uncertain", "failed"] as const).map(x => v.literal(x)))
export const backupResolution = v.union(v.literal("match"), v.literal("absent"), v.literal("conflict"))
