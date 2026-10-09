import type * as D from "@neonflux/backend/dashboard-contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Schema } from "effect"
import { moderationSettingsSchema, automodRuleSchema } from "./moderation-store.ts"
import { responseDefinitionSchema, responseReplySchema, responseTriggerSchema } from "./responses-store.ts"
import { publishingContentSchema, publishingEmbedSchema } from "./publishing-content.ts"
import { validNickname } from "./general-settings.ts"

const n = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const text = (max: number, min = 0) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const id = text(20, 1).check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = text(128, 1).check(Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const name = text(32, 1).check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))
const optional = Schema.optionalKey
const list = <A>(s: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(s)).check(Schema.isMaxLength(max))
const ids = (max = 20) => list(id, max).check(Schema.makeFilter(v => new Set(v).size === v.length))
const revision = n(), enabled = Schema.Boolean, kind = Schema.Literals(["draft", "template"])
const fold = Schema.Literals(["reject", "earlier", "later"]), zone = text(128, 1)
const localMinute = text(16, 16).check(Schema.isPattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/))
const recurrence = Schema.Union([Schema.Struct({ type: Schema.Literal("none") }), Schema.Struct({ type: Schema.Literals(["daily", "weekly"]), interval: n(1, 12), count: n(1, 26) })])
const calendarFields = { localMinute, zone, fold, recurrence }
const eventCalendar = Schema.Struct({ ...calendarFields, durationMinutes: n(1, 10080) })
const scheduleCalendar = Schema.Struct(calendarFields)
const template = Schema.Struct({ name, revision: n(1) }), source = Schema.Struct({ kind, name, revision: n(1) })
const milestoneKind = Schema.Literals(["birthday", "anniversary"])
const eventFields = { eventNo: n(1), expectedRevision: revision }, scheduleFields = { scheduleNo: n(1), expectedRevision: revision }
const routeFields = { kind: milestoneKind, expectedRevision: revision }
const op = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) => Schema.Struct({ type: Schema.Literal(type), ...fields })
const partial = <F extends Schema.Struct.Fields>(fields: F) => Schema.Struct(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, optional(v)])))
const { name: _ruleName, type: _ruleType, ...rulePatch } = automodRuleSchema.fields
const { kind: _responseKind, createdAt: _created, updatedAt: _updated, ...responseFields } = responseDefinitionSchema.fields
const responseSave = op("definition-create", { definition: Schema.Struct(responseFields) })
const responseUpdate = op("definition-update", { definition: Schema.Struct(responseFields) })
const commonResponse = [
    op("update", { name, field: Schema.Literal("response"), reply: responseReplySchema }),
    op("update", { name, field: Schema.Literal("channels"), channelIds: ids() }), op("update", { name, field: Schema.Literal("roles"), roleIds: ids() }),
    op("update", { name, field: Schema.Literal("cooldown"), cooldownSeconds: n(0, 3600) }),
    Schema.Struct({ type: Schema.Literals(["enable", "disable", "delete"]), name }), op("module", { enabled }), responseSave, responseUpdate,
]
const responses = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("custom"), operation: Schema.Union([...commonResponse, op("create", { name, reply: responseReplySchema })]) }),
    Schema.Struct({ kind: Schema.Literal("auto"), operation: Schema.Union([...commonResponse, op("create", { name, reply: responseReplySchema, trigger: responseTriggerSchema }),
        op("update", { name, field: Schema.Literal("trigger"), trigger: responseTriggerSchema }), op("update", { name, field: Schema.Literal("priority"), priority: n(-100, 100) })]) }),
]).check(Schema.makeFilter(v => v.operation.type !== "definition-create" && v.operation.type !== "definition-update"
    || (v.kind === "auto" ? v.operation.definition.trigger !== undefined : v.operation.definition.trigger === undefined)))
const moderation = Schema.Union([
    op("settings", { patch: partial({ ...moderationSettingsSchema.fields, staffRoleIds: partial(moderationSettingsSchema.fields.staffRoleIds.fields) }) }),
    op("rule-create", { rule: automodRuleSchema }), op("rule-update", { name, patch: partial(rulePatch) }), op("rule-delete", { name }),
    op("watchlist-add", { userId: id, reason: text(512) }), op("watchlist-remove", { userId: id }),
])
const field = Schema.Struct({ name: text(256, 1), value: text(1024), inline: optional(Schema.Boolean) })
const draftEdit = Schema.Union([
    op("content", { content: text(2000) }), op("embed", { embed: publishingEmbedSchema }), op("embed-clear", {}),
    ...Object.entries(publishingEmbedSchema.fields).filter(([k]) => k !== "fields").map(([k, schema]) => op("embed-property", { field: Schema.Literal(k), value: Schema.NullOr(schema.schema) })),
    op("field-add", { field }), op("field-set", { index: n(1, 25), field }), op("field-remove", { index: n(1, 25) }), op("fields-clear", {}),
])
const publishing = Schema.Union([
    op("settings", { patch: partial({ enabled }) }), op("draft-create", { kind, name, content: optional(publishingContentSchema) }),
    op("draft-set", { kind, name, expectedRevision: revision, content: publishingContentSchema }),
    op("draft-clone", { kind, name, expectedRevision: revision, toKind: kind, toName: name }),
    op("draft-delete", { kind, name, expectedRevision: revision }), op("draft-update", { kind, name, expectedRevision: revision, edit: draftEdit }),
])
const greetingRoute = Schema.Literals(["welcome", "dm", "goodbye"])
const greetings = Schema.Union([
    op("configure", { route: greetingRoute, templateName: name, expectedTemplateRevision: revision, channelId: optional(id), timing: optional(Schema.Literals(["join", "verified"])) }),
    op("module", { route: greetingRoute, enabled }), op("clear", { route: greetingRoute }), op("settings", { claimsPerMinute: optional(n(1, 60)), retentionDays: optional(n(30, 3650)) }),
])
const visibility = Schema.Literals(["private", "public"])
const tickets = Schema.Union([
    op("settings", { enabled: optional(enabled), retentionDays: optional(n(1, 365)) }),
    op("category-create", { name, visibility, description: optional(text(1000)), parentId: optional(Schema.NullOr(id)), supportRoleIds: ids() }),
    op("category-update", { name, expectedRevision: revision, patch: partial({ enabled, visibility, description: text(1000), parentId: Schema.NullOr(id), supportRoleIds: ids(), questions: list(text(200, 1), 5) }) }),
    op("category-delete", { name, expectedRevision: revision }), op("canned-set", { name, expectedRevision: revision, cannedName: name, templateName: name, expectedTemplateRevision: revision }),
    op("canned-remove", { name, expectedRevision: revision, cannedName: name }),
])
const leveling = Schema.Union([
    op("settings", { expectedRevision: revision, patch: partial({ enabled, xpPerMessage: n(1, 100), cooldownSeconds: n(15, 3600), excludedChannelIds: ids(50), excludedRoleIds: ids(50) }) }),
    op("mappings", { expectedMappingRevision: revision, mappings: list(Schema.Struct({ level: n(1, 1000), roleId: id }), 20).check(Schema.makeFilter(v => new Set(v.map(m => m.level)).size === v.length && new Set(v.map(m => m.roleId)).size === v.length)) }),
])
const milestones = Schema.Union([
    op("settings", { expectedRevision: revision, enabled }),
    op("configure", { ...routeFields, channelId: id, zone, time: text(5, 5).check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)), fold, template }),
    Schema.Struct({ type: Schema.Literals(["enable", "disable", "clear"]), ...routeFields }),
])
const suggestions = Schema.Union([op("settings", { expectedRevision: revision, enabled }), op("configure", { expectedRevision: revision, channelId: id, ownerId: id })])
const channelRevision = { channelId: id, expectedRevision: revision }
const cleanup = Schema.Union([
    op("module", { expectedRevision: revision, enabled }), op("configure", { ...channelRevision, ageMs: n(3600000, 31536000000), ownerId: id }),
    op("enable", { ...channelRevision, enabled, confirm: optional(Schema.Literal(true)) }), op("exclude", { ...channelRevision, kind: Schema.Literals(["author", "message"]), id, add: Schema.Boolean }),
    op("owner", { ...channelRevision, ownerId: id }), op("policy-delete", { ...channelRevision, confirm: Schema.Literal(true) }),
])
const events = Schema.Union([
    op("settings", { expectedRevision: revision, enabled }), op("create", { name, title: text(256, 1), description: optional(text(3500)), channelId: id, ownerId: id }),
    op("calendar", { ...eventFields, calendar: eventCalendar }), op("content", { ...eventFields, title: text(256, 1), description: text(3500) }),
    op("capacity", { ...eventFields, capacity: Schema.NullOr(n(1, 500)) }), op("reminders", { ...eventFields, offsets: list(n(1, 10080), 2) }),
    op("template", { ...eventFields, templateName: Schema.NullOr(name), expectedTemplateRevision: optional(revision) }), op("owner", { ...eventFields, ownerId: id }),
    op("destination", { ...eventFields, channelId: id }), Schema.Struct({ type: Schema.Literals(["publish", "cancel"]), ...eventFields }), op("forget", { ...eventFields, confirm: Schema.Literal("forget") }),
])
const schedules = Schema.Union([
    op("settings", { expectedRevision: revision, enabled }), op("create", { name, source, channelId: id, calendar: scheduleCalendar }),
    op("content", { ...scheduleFields, source }), op("calendar", { ...scheduleFields, calendar: scheduleCalendar }), op("destination", { ...scheduleFields, channelId: id }),
    Schema.Struct({ type: Schema.Literals(["enable", "disable", "cancel"]), ...scheduleFields }),
    op("forget", { ...scheduleFields, confirm: Schema.Literal("forget"), occurrenceNos: optional(list(n(1), 26)) }),
])
const nickname = Schema.Union([op("set", { nickname: Schema.String.check(Schema.makeFilter(validNickname)) }), op("reset", {})])
const voiceFields = { channelName: text(100, 1), categoryId: Schema.NullOr(id), template: text(100, 1), userLimit: Schema.NullOr(n(1, 99)), region: Schema.NullOr(text(64, 1).check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))) }
const voice = Schema.Union([
    op("generator-add", voiceFields), op("generator-set", { channelId: id, expectedRevision: revision, patch: partial(voiceFields) }), op("generator-remove", { channelId: id, expectedRevision: revision }),
])
const menuRoles = list(id, 25).check(Schema.makeFilter(v => new Set(v).size === v.length)), accessIds = ids(100)
const rolepicker = Schema.Union([
    op("module", { enabled }), op("menu-set", { name, description: optional(text(200, 1)), mode: Schema.Literals(["single", "multi"]), roleIds: menuRoles }), op("menu-remove", { name }),
    op("access-set", { allowRoleIds: accessIds, blockRoleIds: accessIds, allowUserIds: accessIds, blockUserIds: accessIds }),
])
const operations = { responses, moderation, publishing, greetings, tickets, leveling, milestones, suggestions, cleanup, events, schedules, nickname, voice, rolepicker }
const jobFields = { id: key, actorId: id, expectedConfigRevision: n(), state: Schema.Literals(["queued", "applied", "failed", "conflict"]), createdAt: n(), expiresAt: n(), error: optional(text(512)) }
const native = Schema.Struct({ ownerId: optional(id), channelId: optional(id), channelIds: optional(ids(100)), parentId: optional(Schema.NullOr(id)), roleIds: optional(ids(1000)), hasEmbed: optional(Schema.Boolean), requiresOwnerAdmin: optional(Schema.Boolean) })
export const dashboardConfigurationJobSchema = Schema.Union(Object.entries(operations).map(([family, operation]) => Schema.Struct({ ...jobFields, family: Schema.Literal(family), operation }))) as unknown as Schema.Codec<D.DashboardConfigurationJob>
export const dashboardConfigurationReadyJobSchema = Schema.Union(Object.entries(operations).map(([family, operation]) => Schema.Struct({ ...jobFields, family: Schema.Literal(family), operation, native }))) as unknown as Schema.Codec<D.DashboardConfigurationReadyJob>
