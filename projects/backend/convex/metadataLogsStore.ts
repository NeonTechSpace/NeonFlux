import type { MetadataLogsBinding, MetadataLogsCategory, MetadataLogsEventSelector, MetadataLogsContext, MetadataLogsCounters, MetadataLogsDelivery, MetadataLogsEvent, MetadataLogsRecord, MetadataLogsSettings } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { cleanupAdmin, cleanupAuthority, cleanupAutomation } from "./cleanupStore.ts"
import { metadataCategories, metadataCategory, metadataContent, metadataContext, metadataEvent, metadataEventSelector, metadataIds, metadataNumber, metadataPresentation, metadataSourceKey, METADATA_CAPACITY, METADATA_DAY, METADATA_RETENTION } from "./metadataLogsDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, requireId, bool, integer } from "./validation.ts"
import { auditedChange, type AuditActor } from "./auditLog.ts"

export type MetadataRead = MutationCtx | QueryCtx
export const readMetadataSettings = (ctx: MetadataRead, serverId: string) => ctx.db.query("metadataLogSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const emptyMetadataCategories = () => ({ membership: 0, resources: 0, messages: 0, audit: 0, settings: 0, operations: 0 })
export const defaultMetadataRoutes = () => metadataCategories.map(category => ({ category, enabled: false, revision: 1 }))
export async function metadataState(ctx: MutationCtx, serverId: string) {
    const old = await readMetadataSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("metadataLogSettings", { serverId, enabled: false, revision: 1, routes: defaultMetadataRoutes(), messageChannelIds: [], excludedChannelIds: [], retained: 0, nextRecordNo: 1, categories: emptyMetadataCategories(), queued: 0, reserved: 0, failed: 0, uncertain: 0, admissions: 0, admissionWindowStartedAt: Date.now(), refused: 0, suppressed: 0, operationNextAt: 0, receipts: 0 })
    return (await ctx.db.get(id))!
}
export function publicMetadataSettings(row: Doc<"metadataLogSettings"> | null): MetadataLogsSettings {
    return { enabled: row?.enabled ?? false, revision: row?.revision ?? 1, configRevision: row?.configRevision ?? 0, routes: row?.routes ?? defaultMetadataRoutes(), eventRoutes: row?.eventRoutes ?? [], messageChannelIds: row?.messageChannelIds ?? [], excludedChannelIds: row?.excludedChannelIds ?? [], retained: row?.retained ?? 0, admissions: row?.admissions ?? 0, admissionWindowStartedAt: row?.admissionWindowStartedAt ?? 0, capacity: METADATA_CAPACITY, admissionCapacity: METADATA_CAPACITY, retentionMs: METADATA_RETENTION, quotaPaused: false, refused: row?.refused ?? 0, suppressed: row?.suppressed ?? 0 }
}
export function publicMetadataRecord(row: Doc<"metadataLogRecords">): MetadataLogsRecord {
    return { recordNo: row.recordNo, event: row.event as MetadataLogsEvent, admittedAt: row.admittedAt, expiresAt: row.expiresAt, ...(row.presentation ? { presentation: row.presentation } : {}), delivery: row.delivery }
}
export const readMetadataRecord = (ctx: MetadataRead, serverId: string, recordNo: number) => ctx.db.query("metadataLogRecords").withIndex("by_number", q => q.eq("serverId", serverId).eq("recordNo", recordNo)).unique()
export async function metadataRecord(ctx: MetadataRead, serverId: string, recordNo: number) { const row = await readMetadataRecord(ctx, serverId, recordNo); if (!row) fail(404, "Metadata record not found"); return row }
export async function metadataBoundRecord(ctx: MetadataRead, serverId: string, binding: MetadataLogsBinding) {
    const row = await metadataRecord(ctx, serverId, binding.recordNo), d = row.delivery
    if (!d || ["recordNo", "routeRevision", "moduleRevision", "generation", "channelId", "ownerId", "routeEventType"].some(key => d[key as keyof MetadataLogsBinding] !== binding[key as keyof MetadataLogsBinding])) fail(409, "Metadata delivery binding changed")
    return row as typeof row & { delivery: NonNullable<typeof row.delivery> }
}
export async function metadataAdmin(ctx: MetadataRead, serverId: string, context: MetadataLogsContext, critical = false) { await cleanupAdmin(ctx, serverId, { ...context, channelType: 0 }, critical) }
export async function metadataAuthority(ctx: MetadataRead, serverId: string, context: MetadataLogsContext, channelId: string, ownerId: string) { if (context.channelType === 1) fail(403, "Public metadata destination required"); await cleanupAuthority(ctx, serverId, { ...context, channelType: context.channelType }, channelId, ownerId) }
export async function metadataAutomation(ctx: MetadataRead, serverId: string, context: MetadataLogsContext, channelId: string) { if (context.channelType === 1) fail(403, "Public metadata destination required"); await cleanupAutomation(ctx, serverId, { ...context, channelType: context.channelType }, channelId) }
const nonNegative = <T extends Record<string, number>>(counts: T) => Object.fromEntries(Object.entries(counts).map(([key, n]) => [key, Math.max(0, n)])) as T
export async function metadataDelivery(ctx: MutationCtx, row: Doc<"metadataLogRecords">, delivery: MetadataLogsDelivery, extras: { claimToken?: string | undefined, cleanupAt?: number | undefined } = {}) {
    const state = await metadataState(ctx, row.serverId), counts = { queued: state.queued, reserved: state.reserved, failed: state.failed, uncertain: state.uncertain }
    if (row.delivery && row.delivery.state in counts) counts[row.delivery.state as keyof typeof counts]--
    if (delivery.state in counts) counts[delivery.state as keyof typeof counts]++
    await ctx.db.patch(state._id, nonNegative(counts))
    const actionable = delivery.state === "queued" || delivery.state === "reserved" || delivery.state === "failed" && delivery.noDispatch === true && delivery.generation < 3 && row.expiresAt > Date.now()
    const unresolved = delivery.state === "uncertain" && !delivery.resolution || delivery.state === "failed" && !delivery.noDispatch && !delivery.resolution
    await ctx.db.patch(row._id, { delivery, actionable, nextCheckAt: delivery.nextCheckAt, cleanupAt: actionable || unresolved ? undefined : row.expiresAt, ...extras })
    return publicMetadataRecord((await ctx.db.get(row._id))!)
}
export async function removeMetadataRecord(ctx: MutationCtx, row: Doc<"metadataLogRecords">) {
    const state = await metadataState(ctx, row.serverId), category = row.event.category, counts = { queued: state.queued, reserved: state.reserved, failed: state.failed, uncertain: state.uncertain }
    if (row.delivery && row.delivery.state in counts) counts[row.delivery.state as keyof typeof counts]--
    // Counters are informational. Drift never blocks retention or admission
    await ctx.db.patch(state._id, { retained: Math.max(0, state.retained - 1), categories: { ...state.categories, [category]: Math.max(0, state.categories[category] - 1) }, ...nonNegative(counts) })
    const attempts = await ctx.db.query("metadataLogAttempts").withIndex("by_record", q => q.eq("serverId", row.serverId).eq("recordNo", row.recordNo)).take(3)
    for (const attempt of attempts) await ctx.db.delete(attempt._id)
    await ctx.db.delete(row._id)
}
export async function admitMetadata(ctx: MutationCtx, serverId: string, event: MetadataLogsEvent, forceEnabled = false): Promise<import("../contracts.js").MetadataLogsAdmitResult> {
    const old = await ctx.db.query("metadataLogRecords").withIndex("by_source", q => q.eq("serverId", serverId).eq("sourceKey", metadataSourceKey(event))).unique()
    if (old) return { admitted: false, duplicate: true, reason: "duplicate" }
    let state = await metadataState(ctx, serverId)
    const now = Date.now()
    if (!state.enabled && !forceEnabled) return { admitted: false, duplicate: false, reason: "disabled" }
    if (event.category === "messages" && event.channelId) {
        // A message in a thread counts as in its parent channel too, so a ticket's or log destination's threads stay private
        const channels = event.parentChannelId ? [event.channelId, event.parentChannelId] : [event.channelId]
        const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
        let ticket = false, retainedDestination = false
        for (const channelId of channels) {
            ticket ||= !!await ctx.db.query("tickets").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId)).first()
            retainedDestination ||= !!await ctx.db.query("metadataLogRecords").withIndex("by_destination", q => q.eq("serverId", serverId).eq("delivery.channelId", channelId)).first()
        }
        const listed = (list: readonly (string | null | undefined)[]) => channels.some(id => list.includes(id))
        if (listed(state.excludedChannelIds) || listed([...state.routes, ...state.eventRoutes ?? []].map(r => r.channelId)) || retainedDestination || listed([moderation?.config.logChannelId]) || ticket || !listed(state.messageChannelIds) || event.authorBot === true || event.privateChannel !== false) {
            await ctx.db.patch(state._id, { suppressed: state.suppressed + 1 }); return { admitted: false, duplicate: false, reason: "excluded" }
        }
    }
    if (event.category === "operations" && state.operationNextAt > now) { await ctx.db.patch(state._id, { suppressed: state.suppressed + 1 }); return { admitted: false, duplicate: false, reason: "rate-limited" } }
    // Storage stays bounded by evicting the oldest record, never by refusing new events
    if (state.retained >= METADATA_CAPACITY) {
        const oldest = await ctx.db.query("metadataLogRecords").withIndex("by_number", q => q.eq("serverId", serverId)).first()
        if (oldest) await removeMetadataRecord(ctx, oldest)
        state = (await ctx.db.get(state._id))!
    }
    const eventRoute = (event.auditAction === undefined ? undefined : state.eventRoutes?.find(r => r.eventType === `audit-entry:${event.auditAction}`)) ?? state.eventRoutes?.find(r => r.eventType === event.type), route = eventRoute ?? state.routes.find(r => r.category === event.category)!, recordNo = state.nextRecordNo
    if (!Number.isSafeInteger(recordNo + 1)) fail(503, "Metadata sequence exhausted")
    const delivery: MetadataLogsDelivery | null = route.enabled && route.channelId && route.ownerId ? { recordNo, routeRevision: route.revision, moduleRevision: state.revision, generation: 1, channelId: route.channelId, ownerId: route.ownerId, ...(eventRoute ? { routeEventType: eventRoute.eventType } : {}), state: "queued", nextCheckAt: now } : null
    const id = await ctx.db.insert("metadataLogRecords", { serverId, recordNo, sourceKey: metadataSourceKey(event), event, admittedAt: now, expiresAt: now + METADATA_RETENTION, presentation: metadataPresentation(recordNo, event), ...(delivery ? {} : { cleanupAt: now + METADATA_RETENTION }), delivery, actionable: delivery !== null, nextCheckAt: now })
    await ctx.db.insert("metadataLogAdmissions", { serverId, expiresAt: now + METADATA_DAY })
    await ctx.db.patch(state._id, { retained: state.retained + 1, nextRecordNo: recordNo + 1, categories: { ...state.categories, [event.category]: state.categories[event.category] + 1 }, queued: state.queued + (delivery ? 1 : 0), admissions: state.admissions + 1, admissionWindowStartedAt: state.admissions === 0 ? now : state.admissionWindowStartedAt, ...(event.category === "operations" ? { operationNextAt: now + 60000 } : {}) })
    return { admitted: true, duplicate: false, record: publicMetadataRecord((await ctx.db.get(id))!) }
}
// Reads the settings rows' counts instead of counting tickets and cases. A ticket count from before counting is read as before, up to 1,000
export async function metadataCounters(ctx: MetadataRead, serverId: string): Promise<MetadataLogsCounters> {
    const [state, tickets, moderation] = await Promise.all([readMetadataSettings(ctx, serverId), ctx.db.query("ticketSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(), ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()])
    const activeTicketSlots = tickets?.activeTickets ?? (await ctx.db.query("tickets").withIndex("by_active", q => q.eq("serverId", serverId).eq("active", true)).take(1000)).length
    const retainedModerationCases = moderation ? Math.max(0, moderation.nextCaseNo - 1 - (moderation.casesRemoved ?? 0)) : 0
    return { activeTicketSlots, retainedModerationCases, retainedMetadataRecords: state?.retained ?? 0, categories: state?.categories ?? emptyMetadataCategories(), queued: state?.queued ?? 0, reserved: state?.reserved ?? 0, failed: state?.failed ?? 0, uncertain: state?.uncertain ?? 0, refused: state?.refused ?? 0, suppressed: state?.suppressed ?? 0, definitions: { tickets: "Active slots including reserved and recovery work", moderation: "Retained manual, event and critical cases", metadata: "Retained admitted records, not unique causal actions", deliveries: "Current delivery states, independent of event admission" } }
}
export const metadataOperationKey = (operation: unknown) => JSON.stringify(operation, (key, value) => key === "recipientOwner" ? undefined : value)
export async function metadataReceipt(ctx: MutationCtx, identity: { serverId: string, messageId: string, createdAt: number }, actorId: string, operation: unknown) {
    const state = await metadataState(ctx, identity.serverId), old = await ctx.db.query("metadataLogReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique(), operationKey = metadataOperationKey(operation)
    if (old) { if (old.actorId !== actorId || old.operationKey !== operationKey) fail(409, "Metadata source receipt changed"); return false }
    if (state.acceptedCreatedAt !== undefined && (identity.createdAt < state.acceptedCreatedAt || BigInt(identity.messageId) <= BigInt(state.acceptedMessageId!))) fail(409, "Stale metadata source")
    if (state.receipts >= 1000) fail(429, "Metadata configuration receipt capacity reached")
    await ctx.db.insert("metadataLogReceipts", { serverId: identity.serverId, messageId: identity.messageId, actorId, operationKey, expiresAt: Date.now() + METADATA_DAY })
    await ctx.db.patch(state._id, { receipts: state.receipts + 1, acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId })
    return true
}
export async function metadataSettingsEvent(ctx: MutationCtx, identity: { serverId: string, messageId: string }, actorId: string | null, scope: "moderation" | "metadata" | "security", changedFields: string[], forceEnabled = false) {
    const event: MetadataLogsEvent = { category: "settings", type: "settings-change", source: { kind: "settings", messageId: identity.messageId, scope }, observedAt: Date.now(), actor: actorId ? { kind: "configuration", userId: actorId } : { kind: "unknown" }, resourceIds: [], changedFields, count: 1, outcome: "accepted" }
    return admitMetadata(ctx, identity.serverId, metadataEvent(event, true), forceEnabled)
}
export async function metadataCoreReceipt(ctx: MutationCtx, identity: { serverId: string, messageId: string, createdAt: number }, actorId: string, patch: unknown, duplicate: boolean) {
    const key = `moderation:${identity.messageId}`, operationKey = metadataOperationKey(patch)
    const existing = await ctx.db.query("metadataLogReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", key)).unique()
    if (existing) { if (existing.actorId !== actorId || existing.operationKey !== operationKey) fail(409, "Core settings source receipt changed"); return false }
    const fence = await ctx.db.query("metadataLogCoreFences").withIndex("by_scope", q => q.eq("serverId", identity.serverId).eq("scope", "moderation")).unique()
    if (fence && (identity.createdAt < fence.createdAt || BigInt(identity.messageId) <= BigInt(fence.messageId))) fail(409, "Stale core settings source")
    if (duplicate) fail(409, "Core settings source has no matching accepted operation")
    const state = await metadataState(ctx, identity.serverId)
    if (state.receipts >= 1000) fail(429, "Core settings receipt capacity reached")
    await ctx.db.insert("metadataLogReceipts", { serverId: identity.serverId, messageId: key, actorId, operationKey, expiresAt: Date.now() + METADATA_DAY })
    await ctx.db.patch(state._id, { receipts: state.receipts + 1 })
    const values = { serverId: identity.serverId, scope: "moderation" as const, createdAt: identity.createdAt, messageId: identity.messageId, actorId, operationKey }
    if (fence) await ctx.db.patch(fence._id, values)
    else await ctx.db.insert("metadataLogCoreFences", values)
    return true
}
export const metadataCanonicalContent = (row: Doc<"metadataLogRecords">) => metadataContent(row.recordNo, row.event as MetadataLogsEvent)
export const metadataCanonicalPayload = (row: Doc<"metadataLogRecords">) => row.presentation ? { content: "", embed: row.presentation.embed } : { content: metadataCanonicalContent(row) }

export type MetadataConfigurationOperation =
    | { type: "module", expectedRevision: number, enabled: boolean }
    | { type: "channels", expectedRevision: number, messageChannelIds: string[], excludedChannelIds: string[] }
    | { type: "route", category: MetadataLogsCategory, expectedRevision: number, enabled: boolean, channelId: string, ownerId: string }
    | { type: "clear", category: MetadataLogsCategory, expectedRevision: number }
    | { type: "event-route", eventType: MetadataLogsEventSelector, expectedRevision: number, enabled: boolean, channelId?: string, ownerId?: string }
    | { type: "event-clear", eventType: MetadataLogsEventSelector, expectedRevision: number }
/** The same finite settings operations serve chat and session-bound dashboard jobs */
export function metadataConfigurationOperation(value: unknown): MetadataConfigurationOperation {
    const r = shape(value, ["type", "expectedRevision", "enabled", "category", "eventType", "channelId", "ownerId", "messageChannelIds", "excludedChannelIds"], ["type", "expectedRevision"])
    const expectedRevision = integer(r.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
    if (r.type === "module") {
        shape(r, ["type", "expectedRevision", "enabled"], ["type", "expectedRevision", "enabled"])
        return { type: "module", expectedRevision, enabled: bool(r.enabled) }
    }
    if (r.type === "channels") {
        shape(r, ["type", "expectedRevision", "messageChannelIds", "excludedChannelIds"], ["type", "expectedRevision", "messageChannelIds", "excludedChannelIds"])
        return { type: "channels", expectedRevision, messageChannelIds: metadataIds(r.messageChannelIds, 50), excludedChannelIds: metadataIds(r.excludedChannelIds, 50) }
    }
    if (r.type === "clear") {
        shape(r, ["type", "expectedRevision", "category"], ["type", "expectedRevision", "category"])
        return { type: "clear", expectedRevision, category: metadataCategory(r.category) }
    }
    if (r.type === "route") {
        shape(r, ["type", "expectedRevision", "category", "enabled", "channelId", "ownerId"], ["type", "expectedRevision", "category", "enabled", "channelId", "ownerId"])
        return { type: "route", expectedRevision, category: metadataCategory(r.category), enabled: bool(r.enabled), channelId: requireId(r.channelId), ownerId: requireId(r.ownerId) }
    }
    if (r.type === "event-clear") {
        shape(r, ["type", "expectedRevision", "eventType"], ["type", "expectedRevision", "eventType"])
        return { type: "event-clear", expectedRevision, eventType: metadataEventSelector(r.eventType) }
    }
    if (r.type === "event-route") {
        const enabled = bool(r.enabled)
        shape(r, enabled ? ["type", "expectedRevision", "eventType", "enabled", "channelId", "ownerId"] : ["type", "expectedRevision", "eventType", "enabled"], enabled ? ["type", "expectedRevision", "eventType", "enabled", "channelId", "ownerId"] : ["type", "expectedRevision", "eventType", "enabled"])
        return { type: "event-route", expectedRevision, eventType: metadataEventSelector(r.eventType), enabled, ...(enabled ? { channelId: requireId(r.channelId), ownerId: requireId(r.ownerId) } : {}) }
    }
    fail(400, "Unknown metadata configuration operation")
}

export function metadataConfigurationCritical(op: MetadataConfigurationOperation) {
    return op.type === "clear" || op.type === "event-clear" || (op.type === "module" || op.type === "route" || op.type === "event-route") && !op.enabled
}

/** Chat and the website both change logging here, which records each change in the audit log */
export function applyMetadataConfiguration(ctx: MutationCtx, serverId: string, actor: AuditActor, operation: unknown, recipientOwner?: unknown) {
    return auditedChange(ctx, serverId, actor, "logs", operation, async () => publicMetadataSettings(await readMetadataSettings(ctx, serverId)), () => applyMetadata(ctx, serverId, operation, recipientOwner))
}
/** Caller authorization is separate from the genuine native authority of a route owner */
async function applyMetadata(ctx: MutationCtx, serverId: string, operation: unknown, recipientOwner?: unknown) {
    const op = metadataConfigurationOperation(operation), state = await metadataState(ctx, serverId), configRevision = integer((state.configRevision ?? 0) + 1, 1, Number.MAX_SAFE_INTEGER)
    const changedFields: string[] = []
    if (op.type === "module" || op.type === "channels") {
        if (state.revision !== op.expectedRevision) fail(409, "Metadata module revision changed")
        const revision = metadataNumber(state.revision + 1)
        if (op.type === "module") { await ctx.db.patch(state._id, { enabled: op.enabled, revision, configRevision }); changedFields.push("enabled") }
        else { await ctx.db.patch(state._id, { messageChannelIds: op.messageChannelIds, excludedChannelIds: op.excludedChannelIds, revision, configRevision }); changedFields.push("messageChannelIds", "excludedChannelIds") }
    } else if (op.type === "route" || op.type === "clear") {
        const route = state.routes.find(r => r.category === op.category)!
        if (route.revision !== op.expectedRevision) fail(409, "Metadata route revision changed")
        let next: typeof route
        if (op.type === "clear") next = { category: op.category, enabled: false, revision: metadataNumber(route.revision + 1) }
        else {
            const recipient = metadataContext(recipientOwner)
            if (!op.enabled && route.channelId === op.channelId && route.ownerId === op.ownerId) {
                await metadataAdmin(ctx, serverId, recipient, true)
                if (recipient.actor.userId !== op.ownerId || recipient.channelId !== op.channelId) fail(403, "Metadata recipient owner mismatch")
            } else await metadataAuthority(ctx, serverId, recipient, op.channelId, op.ownerId)
            next = { category: op.category, enabled: op.enabled, revision: metadataNumber(route.revision + 1), channelId: op.channelId, ownerId: op.ownerId }
        }
        await ctx.db.patch(state._id, { routes: state.routes.map(r => r.category === op.category ? next : r), configRevision }); changedFields.push("route")
    } else {
        // The shared revision fences removal and recreation without an ABA window
        if ((state.configRevision ?? 0) !== op.expectedRevision) fail(409, "Metadata configuration revision changed")
        const routes = state.eventRoutes ?? []
        if (op.type === "event-clear") await ctx.db.patch(state._id, { eventRoutes: routes.filter(r => r.eventType !== op.eventType), configRevision })
        else {
            if (op.enabled) await metadataAuthority(ctx, serverId, metadataContext(recipientOwner), op.channelId!, op.ownerId!)
            else if (recipientOwner !== undefined) fail(400, "Disabled event route has no destination")
            const next = { eventType: op.eventType, enabled: op.enabled, revision: configRevision, ...(op.enabled ? { channelId: op.channelId!, ownerId: op.ownerId! } : {}) }
            await ctx.db.patch(state._id, { eventRoutes: [...routes.filter(r => r.eventType !== op.eventType), next], configRevision })
        }
        changedFields.push("route")
    }
    return { settings: publicMetadataSettings((await ctx.db.get(state._id))!), changedFields, previouslyEnabled: state.enabled }
}
