import type {
    TicketAction,
    TicketActionGrant,
    TicketAttempt,
    TicketBinding,
    TicketContext,
    TicketEntry,
    TicketIntake,
    TicketRecord,
    TicketTranscript,
} from "@neonflux/contracts/tickets"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { administrator } from "./moderationDomain.ts"
import { memberRecoveries } from "./moderationStore.ts"
import { protectedStaffRoles } from "./rolesStore.ts"
import { fail, integer } from "./validation.ts"
import {
    defaultTickets,
    envelope,
    ownBitsEqual,
    sameChannelIdentity,
    TICKET_DAY,
    TICKET_VIEW,
    TICKET_WINDOW,
    TRANSCRIPT_PAGE,
    ticketMask,
    ticketOverwrites,
} from "./ticketDomain.ts"
export type TicketRead = MutationCtx | QueryCtx
export function ticketOwnsNativeResource(action: TicketAction) {
    return action !== "reply" && action !== "introduction"
}
export function ticketAttemptBlocks(row: Doc<"ticketAttempts"> | null) {
    return Boolean(
        row &&
        (row.outcome === "pending" ||
            (row.outcome === "uncertain" && !row.resolved && row.grant && ticketOwnsNativeResource(row.grant.action))),
    )
}
export async function ticketProtection(ctx: TicketRead, serverId: string, context: TicketContext) {
    if (context.actor.timeoutUntil !== null && Date.parse(context.actor.timeoutUntil) > Date.now()) fail(403, "Ticket member restricted")
    const recoveries = await memberRecoveries(ctx, serverId, context.actor.userId)
    if (recoveries.count > 10) fail(403, "Ticket member restricted")
    if (recoveries.cases.some((action) => action?.action === "quarantine")) fail(403, "Ticket member restricted")
}
export const readTicketSettings = (ctx: TicketRead, serverId: string) =>
    ctx.db
        .query("ticketSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export async function ticketState(ctx: MutationCtx, serverId: string) {
    const old = await readTicketSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("ticketSettings", {
        serverId,
        config: defaultTickets(),
        nextCategoryRevision: 1,
        nextIntakeNo: 1,
        nextTicketNo: 1,
        nextEntryNo: 1,
        nextAttemptNo: 1,
        nextTranscriptNo: 1,
        activeTickets: 0,
    })
    return (await ctx.db.get(id))!
}
/** Applies a change of active tickets after the tickets were written. A server without a count is counted once by a bounded read, which already includes the change */
export async function countActiveTickets(ctx: MutationCtx, serverId: string, delta: number) {
    if (!delta) return
    const state = await readTicketSettings(ctx, serverId)
    if (!state) return
    if (state.activeTickets !== undefined) {
        await ctx.db.patch(state._id, { activeTickets: Math.max(0, state.activeTickets + delta) })
        return
    }
    const active = await ctx.db
        .query("tickets")
        .withIndex("by_active", (q) => q.eq("serverId", serverId).eq("active", true))
        .take(1001)
    if (active.length <= 1000) await ctx.db.patch(state._id, { activeTickets: active.length })
}
export async function ticketNumber(
    ctx: MutationCtx,
    serverId: string,
    field: "nextCategoryRevision" | "nextIntakeNo" | "nextTicketNo" | "nextEntryNo" | "nextAttemptNo" | "nextTranscriptNo",
) {
    const state = await ticketState(ctx, serverId),
        next = integer(state[field], 1, Number.MAX_SAFE_INTEGER - 1)
    await ctx.db.patch(state._id, { [field]: next + 1 })
    return next
}
export async function protectTicketRoles(
    ctx: MutationCtx,
    serverId: string,
    roleIds: string[],
    field: "configurationRefs" | "nativeOwnershipRefs" | "privateBodyRefs",
    delta: number,
) {
    if (delta > 0) await protectedStaffRoles(ctx, serverId, roleIds)
    for (const roleId of roleIds) {
        const old = await ctx.db
                .query("ticketRoleProtections")
                .withIndex("by_role", (q) => q.eq("serverId", serverId).eq("roleId", roleId))
                .unique(),
            next = (old?.[field] ?? 0) + delta
        if (next < 0) fail(409, "Ticket protection conflict")
        const values = {
            configurationRefs: old?.configurationRefs ?? 0,
            nativeOwnershipRefs: old?.nativeOwnershipRefs ?? 0,
            privateBodyRefs: old?.privateBodyRefs ?? 0,
            [field]: next,
        }
        const protectedValue = values.configurationRefs + values.nativeOwnershipRefs + values.privateBodyRefs > 0
        if (old) {
            if (!protectedValue) await ctx.db.delete(old._id)
            else await ctx.db.patch(old._id, { ...values, protected: true })
        } else if (protectedValue)
            await ctx.db.insert("ticketRoleProtections", {
                serverId,
                roleId,
                ...values,
                protected: true,
            })
    }
}
export function bodiesGone(ticket: Doc<"tickets">) {
    return ticket.erased || ticket.erasing || (ticket.bodyExpiresAt !== undefined && ticket.bodyExpiresAt <= Date.now())
}
export function ticketStaff(context: TicketContext, ticket: Pick<Doc<"tickets">, "category">) {
    return (
        administrator(context.actor) ||
        (context.actor.nativePermissionAuthorized && context.actor.roleIds.some((id) => ticket.category.supportRoleIds.includes(id)))
    )
}
export async function ticketPolicy(ctx: TicketRead, serverId: string, context: TicketContext, staff: boolean, critical = false) {
    const mod = await ctx.db
            .query("moderationSettings")
            .withIndex("by_server", (q) => q.eq("serverId", serverId))
            .unique(),
        defcon = mod?.config.defcon ?? 3
    if ((defcon === 1 && (!critical || !administrator(context.actor))) || (defcon === 2 && !staff)) fail(403, "DEFCON restriction")
}
export async function ticketAdmin(ctx: TicketRead, serverId: string, context: TicketContext, critical = false) {
    if (!administrator(context.actor)) fail(403, "Administrator permission required")
    await ticketPolicy(ctx, serverId, context, true, critical)
}
export function privateTicketContext(context: TicketContext) {
    if (!context.actor.privateChannelVerified || !context.actor.privateChannelId) fail(403, "Private ticket access required")
}
export async function requireTicketAccess(
    ctx: TicketRead,
    ticket: Doc<"tickets">,
    context: TicketContext,
    options: {
        staff?: boolean
        private?: boolean
        history?: boolean
        critical?: boolean
        metadata?: boolean
    } = {},
) {
    const staff = ticketStaff(context, ticket),
        own = context.actor.userId === ticket.requesterId
    if (!staff && (!own || options.staff)) fail(403, "Ticket access denied")
    await ticketPolicy(ctx, ticket.serverId, context, staff, options.critical)
    if (options.private) privateTicketContext(context)
    if (!options.metadata && ticket.state !== "retired") {
        if (!context.actor.canView || (options.history && !context.actor.canReadHistory)) fail(403, "Native ticket access required")
        if (
            ticket.channelId &&
            (!context.channel || context.channel.channelId !== ticket.channelId || context.channel.serverId !== ticket.serverId)
        )
            fail(403, "Native ticket context required")
    } else if (ticket.state === "retired" && !ticket.retiredAt) fail(403, "Ticket retirement unproven")
    return staff
}
export async function ticketReceipt(ctx: MutationCtx, serverId: string, messageId: string, context: TicketContext, staff: boolean) {
    const old = await ctx.db
        .query("ticketReceipts")
        .withIndex("by_source", (q) => q.eq("serverId", serverId).eq("messageId", messageId))
        .unique()
    if (old) {
        if (old.actorId !== context.actor.userId) fail(409, "Ticket source actor changed")
        return false
    }
    const kind = staff ? "staff" : "user",
        now = Date.now()
    if (!staff) {
        const own = await ctx.db
            .query("ticketReceipts")
            .withIndex("by_user", (q) =>
                q.eq("serverId", serverId).eq("actorId", context.actor.userId).eq("kind", "user").gt("expiresAt", now),
            )
            .take(100)
        if (own.length >= 100) fail(429, "Requester ticket rate reached")
    }
    await ctx.db.insert("ticketReceipts", {
        serverId,
        messageId,
        actorId: context.actor.userId,
        kind,
        expiresAt: now + TICKET_DAY,
    })
    return true
}
export async function findTicket(ctx: TicketRead, serverId: string, ticketNo: number) {
    const row = await ctx.db
        .query("tickets")
        .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("ticketNo", ticketNo))
        .unique()
    if (!row) fail(404, "Ticket not found")
    return row
}
export async function findIntake(ctx: TicketRead, serverId: string, intakeNo: number) {
    const row = await ctx.db
        .query("ticketIntakes")
        .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("intakeNo", intakeNo))
        .unique()
    if (!row) fail(404, "Ticket intake not found")
    return row
}
export async function findCategory(ctx: TicketRead, serverId: string, name: string) {
    const row = await ctx.db
        .query("ticketCategories")
        .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("config.name", name))
        .unique()
    if (!row) fail(404, "Ticket category not found")
    return row
}
export function publicIntake(row: Doc<"ticketIntakes">): TicketIntake {
    return {
        intakeNo: row.intakeNo,
        generation: row.generation,
        category: row.category,
        requesterId: row.requesterId,
        joinedAt: row.joinedAt,
        answers: row.answers,
        state: row.state,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        ...(row.ticketNo === undefined ? {} : { ticketNo: row.ticketNo }),
    }
}
export function publicAttempt(row: Doc<"ticketAttempts">, hidePayload = false): TicketAttempt {
    if (!row.grant) fail(409, "Ticket grant unavailable")
    const { content, ...grant } = row.grant
    return {
        ...grant,
        ...(!hidePayload && content ? { content } : {}),
        outcome: row.outcome,
        createdAt: row.createdAt,
        ...(row.claimedAt === undefined ? {} : { claimedAt: row.claimedAt }),
        ...(row.finishedAt === undefined ? {} : { finishedAt: row.finishedAt }),
        ...(row.noDispatch ? { noDispatch: true } : {}),
        ...(row.messageId ? { messageId: row.messageId } : {}),
        ...(row.observationAt === undefined ? {} : { observationAt: row.observationAt }),
        ...(row.resolved ? { resolved: row.resolved } : {}),
        ...(row.redacted ? { redacted: true } : {}),
        ...(row.nativeDeleteConfirmed ? { nativeDeleteConfirmed: true } : {}),
    }
}
export async function publicTicket(ctx: TicketRead, row: Doc<"tickets">): Promise<TicketRecord> {
    const a = row.currentAttemptId ? await ctx.db.get(row.currentAttemptId) : null
    return {
        ticketNo: row.ticketNo,
        requesterId: row.requesterId,
        requesterJoinedAt: row.requesterJoinedAt,
        categoryName: row.category.name,
        categoryRevision: row.category.revision,
        visibility: row.category.visibility,
        supportRoleIds: row.category.supportRoleIds,
        state: row.state,
        generation: row.generation,
        botId: row.botId,
        priority: row.priority,
        createdAt: row.createdAt,
        erased: bodiesGone(row),
        entryCount: row.entryCount,
        ...(row.channelId ? { channelId: row.channelId } : {}),
        ...(row.channel ? { channel: row.channel } : {}),
        ...(row.claimedBy ? { claimedBy: row.claimedBy } : {}),
        ...(row.closedAt === undefined ? {} : { closedAt: row.closedAt }),
        ...(row.retiredAt === undefined ? {} : { retiredAt: row.retiredAt }),
        ...(row.bodyExpiresAt === undefined ? {} : { bodyExpiresAt: row.bodyExpiresAt }),
        ...(a ? { currentAttempt: publicAttempt(a, true) } : {}),
        ...(row.transition ? { transition: row.transition, completedSteps: row.completedSteps } : {}),
    }
}
export function publicEntry(row: Doc<"ticketEntries">, erased = false): TicketEntry {
    return {
        entryNo: row.entryNo,
        ticketNo: row.ticketNo,
        authorId: row.authorId,
        kind: row.kind,
        createdAt: row.createdAt,
        erased: erased || row.erased,
        ...(!erased && row.content ? { content: row.content } : {}),
        ...(row.attemptNo === undefined ? {} : { attemptNo: row.attemptNo }),
    }
}
export function publicTranscript(row: Doc<"ticketTranscripts">, hideBody = false): TicketTranscript {
    const { transcriptNo, ticketNo, channelId, capturedAt, messageCount, truncated } = row,
        erased = hideBody || (row.body === undefined && row.pages === undefined)
    return {
        transcriptNo,
        ticketNo,
        channelId,
        capturedAt,
        messageCount,
        truncated,
        erased,
        pages: erased ? 1 : (row.pages ?? Math.max(1, Math.ceil(row.body!.length / TRANSCRIPT_PAGE))),
    }
}
/** Splits a rendered body into the pages that reads return */
export const transcriptPages = (body: string) =>
    Array.from({ length: Math.max(1, Math.ceil(body.length / TRANSCRIPT_PAGE)) }, (_, index) => body.slice(index * TRANSCRIPT_PAGE, (index + 1) * TRANSCRIPT_PAGE))
/** One page of a transcript, read from its page row or from a body stored before page storage */
export async function transcriptPage(ctx: TicketRead, row: Doc<"ticketTranscripts">, page: number) {
    if (row.body !== undefined) return row.body.slice((page - 1) * TRANSCRIPT_PAGE, page * TRANSCRIPT_PAGE)
    const stored = await ctx.db
        .query("ticketTranscriptPages")
        .withIndex("by_page", (q) => q.eq("serverId", row.serverId).eq("ticketNo", row.ticketNo).eq("transcriptNo", row.transcriptNo).eq("pageNo", page))
        .unique()
    return stored?.text ?? ""
}
export function checkTicketGeneration(row: Doc<"tickets">, expectedGeneration: number) {
    if (expectedGeneration !== row.generation) fail(409, "Ticket generation changed")
}
export function ownedChannelMatches(ticket: Doc<"tickets">, channel: NonNullable<TicketContext["channel"]>, expected = ticket.channel) {
    if (!expected || !sameChannelIdentity(channel, expected)) return false
    for (const target of [
        { id: ticket.serverId, type: "role" },
        { id: ticket.requesterId, type: "member" },
    ] as const) {
        const a = channel.overwrites.find((x) => x.id === target.id && x.type === target.type),
            b = expected.overwrites.find((x) => x.id === target.id && x.type === target.type)
        if (!ownBitsEqual(a, b, ticketMask(ticket))) return false
    }
    return true
}
/** Another grant of an owned bit would defeat closing. A new close passes the bits it is about to own */
export function rejectExtraSend(ticket: Doc<"tickets">, channel: NonNullable<TicketContext["channel"]>, mask = ticketMask(ticket)) {
    for (const row of channel.overwrites)
        if (
            (BigInt(row.allow) & mask) !== 0n &&
            !(
                (row.type === "role" && (row.id === ticket.serverId || ticket.category.supportRoleIds.includes(row.id))) ||
                (row.type === "member" && (row.id === ticket.botId || row.id === ticket.requesterId))
            )
        )
            fail(409, "Ticket closure permission conflict")
}
export function rejectTicketAudience(ticket: Doc<"tickets">, channel: NonNullable<TicketContext["channel"]>) {
    if (ticket.category.visibility !== "private") return
    const everyone = channel.overwrites.find((r) => r.type === "role" && r.id === ticket.serverId)
    if (!everyone || (BigInt(everyone.deny) & TICKET_VIEW) === 0n) fail(409, "Ticket audience changed")
    for (const row of channel.overwrites)
        if (
            (BigInt(row.allow) & TICKET_VIEW) !== 0n &&
            !(
                (row.type === "role" && ticket.category.supportRoleIds.includes(row.id)) ||
                (row.type === "member" && (row.id === ticket.botId || row.id === ticket.requesterId))
            )
        )
            fail(409, "Ticket audience changed")
}
export async function reserveTicket(
    ctx: MutationCtx,
    ticket: Doc<"tickets">,
    action: TicketAction,
    sourceId: string,
    actorId: string,
    channel?: NonNullable<TicketContext["channel"]>,
    content?: TicketActionGrant["content"],
) {
    const attemptNo = await ticketNumber(ctx, ticket.serverId, "nextAttemptNo"),
        generation = ticket.generation + 1,
        now = Date.now(),
        dispatchExpiresAt = now + TICKET_WINDOW
    const id = await ctx.db.insert("ticketAttempts", {
        serverId: ticket.serverId,
        ticketNo: ticket.ticketNo,
        attemptNo,
        generation,
        sourceId,
        actorId,
        outcome: "pending",
        createdAt: now,
        dispatchExpiresAt,
        redacted: false,
    })
    let desiredChannel = channel,
        targetOverwrite: TicketActionGrant["targetOverwrite"],
        ownedPermissions: string | undefined
    if (action.startsWith("close-") || action.startsWith("reopen-")) {
        if (!channel) fail(409, "Ticket channel required")
        const owned = ticketMask(ticket)
        ownedPermissions = String(owned)
        const target = {
                id: action.endsWith("everyone") ? ticket.serverId : ticket.requesterId,
                type: action.endsWith("everyone") ? ("role" as const) : ("member" as const),
            },
            old = channel.overwrites.find((r) => r.id === target.id && r.type === target.type)
        if (!old) fail(409, "Ticket target overwrite missing")
        const original = ticket.baselineOverwrites?.find((r) => r.id === target.id && r.type === target.type)
        if (action.startsWith("reopen-") && !original) fail(409, "Ticket close baseline missing")
        const allow = action.startsWith("close-")
                ? BigInt(old.allow) & ~owned
                : (BigInt(old.allow) & ~owned) | (BigInt(original!.allow) & owned),
            deny = action.startsWith("close-")
                ? BigInt(old.deny) | owned
                : (BigInt(old.deny) & ~owned) | (BigInt(original!.deny) & owned)
        if (allow > 9223372036854775807n || deny > 9223372036854775807n) fail(409, "Ticket overwrite cannot be written")
        targetOverwrite = {
            ...target,
            allow: allow.toString(),
            deny: deny.toString(),
        }
        desiredChannel = {
            ...channel,
            overwrites: ticketOverwrites(
                channel.overwrites.map((r) => (r.id === target.id && r.type === target.type ? targetOverwrite! : r)),
            ),
        }
    }
    const grant: TicketActionGrant = {
        attemptId: id,
        attemptNo,
        ticketNo: ticket.ticketNo,
        generation,
        sourceId,
        actorId,
        botId: ticket.botId,
        requesterId: ticket.requesterId,
        requesterJoinedAt: ticket.requesterJoinedAt,
        visibility: ticket.category.visibility,
        supportRoleIds: ticket.category.supportRoleIds,
        action,
        dispatchExpiresAt,
        nativeDeadlineMs: 5000,
        ...(ticket.channelId ? { channelId: ticket.channelId } : {}),
        ...(channel ? { expectedChannel: channel } : {}),
        ...(desiredChannel && (action.startsWith("close-") || action.startsWith("reopen-")) ? { desiredChannel } : {}),
        ...(targetOverwrite ? { targetOverwrite } : {}),
        ...(ownedPermissions !== undefined ? { ownedPermissions } : {}),
        ...(action === "create"
            ? {
                  channelName: `ticket-${ticket.ticketNo}`,
                  parentId: ticket.category.parentId,
                  overwrites: envelope(
                      ticket.serverId,
                      ticket.botId,
                      ticket.requesterId,
                      ticket.category.supportRoleIds,
                      ticket.category.visibility,
                  ),
                  ...(ticket.escalatedFrom ? { escalatedFrom: ticket.escalatedFrom } : {}),
              }
            : {}),
        ...(content ? { content } : {}),
    }
    await ctx.db.patch(id, { grant })
    await ctx.db.patch(ticket._id, { generation, currentAttemptId: id })
    return grant
}
export async function boundTicketAttempt(ctx: TicketRead, input: TicketBinding) {
    const ticket = await findTicket(ctx, input.serverId, input.ticketNo),
        id = ctx.db.normalizeId("ticketAttempts", input.attemptId),
        attempt = id ? await ctx.db.get(id) : null
    if (
        !attempt ||
        attempt.serverId !== ticket.serverId ||
        attempt.ticketNo !== ticket.ticketNo ||
        attempt.generation !== input.generation ||
        attempt.sourceId !== input.sourceId
    )
        fail(409, "Ticket attempt binding changed")
    return { ticket, attempt }
}
export async function releaseTicketNative(ctx: MutationCtx, ticket: Doc<"tickets">) {
    if (ticket.nativeProtected) {
        await protectTicketRoles(ctx, ticket.serverId, ticket.category.supportRoleIds, "nativeOwnershipRefs", -1)
        await ctx.db.patch(ticket._id, { nativeProtected: false })
    }
}
