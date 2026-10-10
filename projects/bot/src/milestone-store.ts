import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingContentSchema } from "./publishing-content.ts"
import { publishingGrantFields, publishingGrantSchema, publishingMilestoneBindingFields, publishingMilestoneConsumerSchema, publishingPostSchema } from "./publishing-store.ts"
import { milestoneMonthDay } from "./milestone-calendar.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.makeFilter(v => /^[a-zA-Z0-9_-]{1,128}$/.test(v)))
const kind = Schema.Literals(["birthday", "anniversary"])
const optional = Schema.optionalKey
const list = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
const cursorText = Schema.String.check(Schema.makeFilter(v => v.length > 0 && v.length <= 4096))
const epoch = publishingMilestoneBindingFields.joinedAt
const template = Schema.Struct({ name: Schema.String.check(Schema.makeFilter(v => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v))), revision: integer(1) })
const settings = Schema.Struct({ enabled: Schema.Boolean, revision: integer(1), activatedAt: integer() })
const zone = Schema.String.check(Schema.makeFilter(v => v.length <= 128 && (() => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true } catch { return false } })()))
const route = Schema.Struct({ kind, revision: integer(1), intentRevision: integer(1), audienceGeneration: integer(1), createdBy: id, channelId: id,
    zone, time: Schema.String.check(Schema.makeFilter(v => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))), fold: Schema.Literals(["earlier", "later", "reject"]), template,
    content: publishingContentSchema, canonicalContent: publishingContentSchema, enabled: Schema.Boolean, activatedAt: integer(), createdAt: integer(), updatedAt: integer() }).check(Schema.makeFilter(v => v.intentRevision <= v.revision && v.updatedAt >= v.createdAt && equalPublishingContent(v.canonicalContent, canonicalPublishingContent(v.content))))
const routes = list(route, 2).check(Schema.makeFilter(v => new Set(v.map(r => r.kind)).size === v.length))
const enrollment = Schema.Struct({ kind, revision: integer(1), joinedAt: epoch, audienceGeneration: integer(1), channelId: id, consentedAt: integer(), monthDay: optional(Schema.String.check(Schema.makeFilter(milestoneMonthDay))), needsReconsent: Schema.Boolean }).check(Schema.makeFilter(v => v.kind === "birthday" ? v.monthDay !== undefined : v.monthDay === undefined))
export const milestoneDeliverySchema = Schema.Struct({ ...publishingMilestoneBindingFields, channelId: id, zone, dueAt: integer(), offsetMinutes: integer(-1440, 1440),
    state: Schema.Literals(["queued", "blocked", "reserved", "sent", "failed", "uncertain", "skipped", "cancelled", "superseded"]), nextCheckAt: integer(), claimedAt: optional(integer()), postNo: optional(integer(1)), attemptId: optional(key),
    reason: optional(Schema.Literals(["activation-cutoff", "late-window", "superseded", "cancelled", "permission", "capacity", "dispatch-expired", "consent", "membership", "civil-gap", "civil-fold", "consumed"])) }).check(Schema.makeFilter(v =>
        (v.kind === "birthday" ? v.completedYears === 0 : v.completedYears >= 1) && (v.postNo === undefined) === (v.attemptId === undefined)
        && (v.claimedAt === undefined || v.postNo !== undefined) && (!["reserved", "sent", "uncertain"].includes(v.state) || v.postNo !== undefined)))
const rows = list(milestoneDeliverySchema, 20).check(Schema.makeFilter(v => new Set(v.map(d => d.deliveryId)).size === v.length))
const cursor = Schema.Struct({ cursor: cursorText, throughAt: integer() })
const memberCursor = Schema.Struct({ cursor: cursorText, userId: id, joinedAt: epoch, observedAt: integer() })
const memberTarget = Schema.Struct({ kind, userId: id, joinedAt: epoch, consentRevision: integer(1), consentedAt: integer() })
const grant = Schema.Struct({ ...publishingGrantFields, source: Schema.Struct({ type: Schema.Literal("milestone-timer"), deliveryId: key, dueAt: integer() }),
    provenance: Schema.Struct({ type: Schema.Literal("milestone"), kind, intentRevision: integer(1), template }), consumer: publishingMilestoneConsumerSchema })
    .check(Schema.makeFilter(v => { try { Schema.decodeUnknownSync(publishingGrantSchema, { onExcessProperty: "error" })(v); return true } catch { return false } }))
const manage = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("route"), route }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("cleared"), kind }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, post: publishingPostSchema }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), removed: integer() })])
const query = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings, routes }), Schema.Struct({ type: Schema.Literal("status"), settings, routes,
    accounts: integer(0, 1000), enrollments: integer(0, 2000), deliveries: integer(0, 4000), staffReceipts: integer(0, 1000), memberReceipts: integer(0, 10000),
    publishing: Schema.Struct({ enabled: Schema.Boolean }), limits: Schema.Struct({ accounts: Schema.Literal(1000), slotsPerAccount: Schema.Literal(2), deliveries: Schema.Literal(4000), staffReceipts: Schema.Literal(1000), memberReceipts: Schema.Literal(10000) }) }),
    Schema.Struct({ type: Schema.Literal("preview"), route, content: publishingContentSchema }), Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: rows, nextCursor: optional(cursorText) })])
const personal = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("me"), enrollments: list(enrollment, 2).check(Schema.makeFilter(v => new Set(v.map(e => e.kind)).size === v.length)), routes }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("enrollment"), enrollment }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("removed"), removed: integer(0, 2) })])
const delivery = Schema.Union([Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: rows, hasMore: Schema.Boolean, nextCursor: optional(cursor) }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literal("reserved"), grant }), Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literals(["waiting", "skipped", "cancelled", "terminal"]) }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, hasMore: optional(Schema.Boolean), nextCursor: optional(memberCursor) }),
    Schema.Struct({ type: Schema.Literal("member-targets"), targets: list(memberTarget, 20), hasMore: Schema.Boolean, nextCursor: optional(cursorText) })])
export const sameMilestoneBinding = (a: C.MilestonesDeliveryBinding, b: C.MilestonesDeliveryBinding) => Object.keys(publishingMilestoneBindingFields).every(k => a[k as keyof C.MilestonesDeliveryBinding] === b[k as keyof C.MilestonesDeliveryBinding])
export class MilestonesStoreError extends Data.TaggedError("MilestonesStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface MilestonesStore {
    manage(input: C.MilestonesManageRequest): Effect.Effect<C.MilestonesManageResult, MilestonesStoreError>
    query(input: C.MilestonesQueryRequest): Effect.Effect<C.MilestonesQueryResult, MilestonesStoreError>
    personal(input: C.MilestonesPersonalRequest): Effect.Effect<C.MilestonesPersonalResult, MilestonesStoreError>
    delivery(input: C.MilestonesDeliveryRequest): Effect.Effect<C.MilestonesDeliveryResult, MilestonesStoreError>
}
export function createMilestonesStore(config: BackendConfig): MilestonesStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/milestones/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new MilestonesStoreError({ operation, status: null })),
        Effect.mapError(error => new MilestonesStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, manage, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return v.type === "settings" && v.settings.enabled === op.enabled && v.settings.revision === op.expectedRevision + 1
            if (op.type === "clear") return v.type === "cleared" && v.kind === op.kind
            if (op.type === "forget") return v.type === "forgotten"
            if (op.type === "reconcile") return v.type === "reconciled" && v.post.consumer?.type === "milestone" && sameMilestoneBinding(v.post.consumer, op.binding)
                && v.post.generation === op.expectedGeneration && v.post.attempt.attemptId === op.attemptId && v.post.messageId === op.observation.messageId && v.post.channelId === op.observation.channelId && v.post.botId === op.observation.botId
            if (v.type !== "route" || v.route.kind !== op.kind || (op.type === "configure" && op.expectedRevision === 0 ? v.route.revision < 1 : v.route.revision !== op.expectedRevision + 1)) return false
            const r = v.route
            if (op.type === "configure") return r.channelId === op.channelId && r.zone === op.zone && r.time === op.time && r.fold === op.fold && r.template.name === op.template.name && r.template.revision === op.template.revision
            return r.enabled === (op.type === "enable")
        }),
        query: input => call("query", input, query, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "status") return v.type === op.type
            if (op.type === "preview") return v.type === "preview" && v.route.kind === op.kind
            return op.type === "deliveries" && v.type === "deliveries" && v.deliveries.every(d => d.kind === op.kind) && (!v.nextCursor || v.nextCursor !== op.cursor)
        }),
        personal: input => call("personal", input, personal, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "me") return v.type === "me"
            if (op.type === "remove") return v.type === "removed"
            return v.type === "enrollment" && v.enrollment.kind === op.kind && v.enrollment.joinedAt === op.participant.member.joinedAt && v.enrollment.channelId === op.confirmChannelId
                && !v.enrollment.needsReconsent && (op.kind !== "birthday" || v.enrollment.monthDay === op.monthDay)
        }),
        delivery: input => call("delivery", input, delivery, v => {
            const op = input.operation
            if (op.type === "list") return v.type === "deliveries" && v.hasMore === (v.nextCursor !== undefined) && (!v.nextCursor || !op.cursor || v.nextCursor.throughAt === op.cursor.throughAt && v.nextCursor.cursor !== op.cursor.cursor)
            if (op.type === "defer") return v.type === "progress" && v.nextCursor === undefined
            if (op.type === "membership") return v.type === "progress" && (v.hasMore === undefined && v.nextCursor === undefined || v.hasMore === (v.nextCursor !== undefined))
                && (!v.nextCursor || v.nextCursor.userId === op.binding.userId && v.nextCursor.joinedAt === op.binding.joinedAt && v.nextCursor.observedAt === op.observation.observedAt && v.nextCursor.cursor !== op.cursor?.cursor)
            if (op.type === "member-observation") return v.type === "progress" && v.nextCursor === undefined
            if (op.type === "member-targets") return v.type === "member-targets" && v.targets.every(t => t.userId === op.userId) && v.hasMore === (v.nextCursor !== undefined) && (!v.nextCursor || v.nextCursor !== op.cursor)
            if (v.type !== "reservation") return false
            if (v.status !== "reserved") return true
            const g = v.grant
            return g.consumer?.type === "milestone" && sameMilestoneBinding(g.consumer, op.binding) && g.actorId === op.context.automation.botId && g.channelId === op.context.automation.channelId && g.botId === op.context.automation.botId
        }),
    }
}
export function milestonesErrorMessage(error: MilestonesStoreError) {
    if (error.status === 403) return "Current milestone permissions, consent, membership, verification or DEFCON policy rejected this operation"
    if (error.status === 404) return "That route or retained delivery was not found. Status shows the configured routes"
    if (error.status === 409) return "Milestone state changed while this command ran, or the work is still pending. Send the command again if it still applies. Uncertain work cannot replay or be forgotten"
    if (error.status === 400) return "Check the destination confirmation and syntax in !milestone help"
    if (error.status === 429) return "Milestone or publishing capacity is full. Inspect status and selectively forget settled posts. Personal removal remains available"
    return "Milestone persistence could not be confirmed. Read current private state before repeating a change"
}
