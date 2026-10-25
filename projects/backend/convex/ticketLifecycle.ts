import { v } from "convex/values"
import {
    TicketDispatchRequest,
    TicketOutcomeRequest,
    TicketReconcileRequest,
    ticketChannelsEqual,
    ticketOverwritesEqual,
    type TicketDispatchResult,
    type TicketOutcomeResult,
    type TicketReconcileResult,
    type TicketChannelSnapshot,
    type TicketActionGrant,
} from "@neonflux/contracts/tickets"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation } from "./serviceGuard.ts"
import { internal } from "./_generated/api.js"
import { administrator } from "./moderationDomain.ts"
import { decode, fail, integer, source } from "./validation.ts"
import { ticketContext, ticketChannel, TICKET_BATCH, TICKET_DAY } from "./ticketDomain.ts"
import {
    bodiesGone,
    boundTicketAttempt,
    findTicket,
    checkTicketGeneration,
    publicTicket,
    readTicketSettings,
    requireTicketAccess,
    ticketAdmin,
    ticketPolicy,
    ticketStaff,
    ticketProtection,
    ticketReceipt,
    protectTicketRoles,
    releaseTicketNative,
    ownedChannelMatches,
    rejectExtraSend,
    rejectTicketAudience,
    reserveTicket,
    ticketAttemptBlocks,
    ticketOwnsNativeResource,
    countActiveTickets,
} from "./ticketStore.ts"

export const dispatch = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TicketDispatchResult> => {
        const input = decode(TicketDispatchRequest, request),
            { ticket, attempt } = await boundTicketAttempt(ctx, input),
            context = ticketContext(input.context),
            token = input.claimToken,
            grant = attempt.grant!
        const result = {
            claimed: false,
            dispatchExpiresAt: attempt.dispatchExpiresAt,
            nativeDeadlineMs: 5000 as const,
        }
        if (
            attempt.outcome !== "pending" ||
            attempt.claimedAt !== undefined ||
            Date.now() >= attempt.dispatchExpiresAt ||
            ticket.currentAttemptId !== attempt._id ||
            ticket.generation !== attempt.generation
        )
            return result
        if (context.actor.userId !== attempt.actorId || context.botId !== ticket.botId || !context.botAuthorized)
            fail(403, "Ticket claim authority changed")
        const recovery =
                grant.action.startsWith("close-") || grant.action.startsWith("reopen-") || grant.action === "delete",
            staff = ticketStaff(context, ticket)
        await ticketPolicy(ctx, ticket.serverId, context, staff, recovery && administrator(context.actor))
        if (grant.action === "create") {
            // Staff create an escalated ticket, and the bot checked the requester's membership right before
            const creator = ticket.escalatedFrom
                ? staff
                : context.actor.userId === ticket.requesterId && context.actor.joinedAt === ticket.requesterJoinedAt
            if (!creator || (grant.parentId && context.parentVerified !== true))
                fail(409, "Ticket creation membership changed")
            await ticketProtection(ctx, ticket.serverId, context)
        } else {
            await requireTicketAccess(ctx, ticket, context, {
                staff: grant.action === "reply",
                critical: recovery && administrator(context.actor),
            })
            if (!context.channel || !ticket.channelId || context.channel.channelId !== ticket.channelId)
                fail(409, "Ticket channel required")
            rejectTicketAudience(ticket, context.channel)
            if (grant.expectedChannel && !ticketChannelsEqual(context.channel, grant.expectedChannel))
                fail(409, "Ticket dispatch snapshot changed")
            if (recovery) {
                rejectExtraSend(ticket, context.channel)
                if (!ownedChannelMatches(ticket, context.channel)) fail(409, "Ticket ownership changed")
            }
            if ((grant.action === "reply" || grant.action === "introduction") && !context.actor.canSend)
                fail(403, "Ticket send permission required")
            if (grant.action === "delete") await ticketAdmin(ctx, ticket.serverId, context, true)
            if (!staff) await ticketProtection(ctx, ticket.serverId, context)
        }
        if (
            (grant.action === "create" ||
                grant.action === "reply" ||
                grant.action === "introduction" ||
                grant.action.startsWith("reopen-")) &&
            !(await readTicketSettings(ctx, ticket.serverId))?.config.enabled
        )
            fail(403, "Tickets are off. The server owner or an Administrator can turn them on", "REFUSED")
        if (
            (grant.action === "reply" ||
                grant.action === "introduction" ||
                grant.action === "create" ||
                grant.action.startsWith("reopen-")) &&
            bodiesGone(ticket)
        )
            fail(409, "This ticket's stored messages were erased, so it cannot be reopened or answered", "REFUSED")
        await ctx.db.patch(attempt._id, {
            claimedAt: Date.now(),
            claimToken: token,
        })
        return { ...result, claimed: true }
    },
})

async function completed(
    ctx: MutationCtx,
    ticket: Doc<"tickets">,
    attempt: Doc<"ticketAttempts">,
    channel?: TicketChannelSnapshot,
): Promise<TicketActionGrant | undefined> {
    if (ticket.currentAttemptId !== attempt._id || ticket.generation !== attempt.generation) return
    const action = attempt.grant!.action
    if (action === "create") {
        if (!channel) fail(409, "Ticket creation readback required")
        await ctx.db.patch(ticket._id, {
            channelId: channel.channelId,
            channel,
            state: "open",
        })
        if (!bodiesGone(ticket))
            return reserveTicket(
                ctx,
                (await ctx.db.get(ticket._id))!,
                "introduction",
                attempt.sourceId,
                attempt.actorId,
                channel,
                {
                    content: ticket.escalatedFrom
                        ? `Ticket #${ticket.ticketNo} (${ticket.category.visibility}) opened from help post <#${ticket.escalatedFrom}>. Owners, administrators and the category's support roles can help`
                        : `Ticket #${ticket.ticketNo} (${ticket.category.visibility}) opened. Intake answers stay private. Owners, administrators and the category's support roles can help. NeonFlux saves a transcript of this channel when the ticket closes`,
                },
            )
    } else if (action.startsWith("close-") || action.startsWith("reopen-")) {
        if (!channel) fail(409, "Ticket transition readback required")
        const closing = action.startsWith("close-"),
            first = action === "close-everyone" || action === "reopen-requester"
        if (ticket.completedSteps !== (first ? 0 : 1) || ticket.transition !== (closing ? "close" : "reopen"))
            fail(409, "Ticket transition binding changed")
        await ctx.db.patch(ticket._id, {
            channel,
            completedSteps: first ? 1 : 2,
        })
        if (first) {
            // The next step consumes recovery capacity reserved before native work began
            return reserveTicket(
                ctx,
                (await ctx.db.get(ticket._id))!,
                closing ? "close-requester" : "reopen-everyone",
                attempt.sourceId,
                attempt.actorId,
                channel,
            )
        }
        const now = Date.now(),
            retention = (await readTicketSettings(ctx, ticket.serverId))!.config.retentionDays
        await ctx.db.patch(ticket._id, {
            state: closing ? "closed" : "open",
            active: !closing,
            transition: undefined,
            ...(closing
                ? {
                      closedAt: now,
                      // Every close brings the automatic transcript up to date
                      ...(!bodiesGone(ticket)
                          ? {
                                bodyExpiresAt: now + retention * TICKET_DAY,
                                ...(ticket.channelId
                                    ? {
                                          transcriptDueAt: now,
                                          transcriptFailures: undefined,
                                          transcriptFailed: undefined,
                                      }
                                    : {}),
                            }
                          : {}),
                  }
                : {
                      closedAt: undefined,
                      bodyExpiresAt: undefined,
                      baselineOverwrites: undefined,
                      ownedPermissions: undefined,
                  }),
        })
        await countActiveTickets(ctx, ticket.serverId, Number(!closing) - Number(ticket.active))
    } else if (action === "delete") await retireTicket(ctx, ticket)
}
async function retireTicket(ctx: MutationCtx, ticket: Doc<"tickets">) {
    await ctx.db.patch(ticket._id, {
        state: "retired",
        retiredAt: Date.now(),
        active: false,
        transition: undefined,
        // Bodies kept without an expiry, such as an open ticket's, start the configured retention now
        ...(!bodiesGone(ticket) && ticket.bodyExpiresAt === undefined
            ? {
                  bodyExpiresAt:
                      Date.now() + (await readTicketSettings(ctx, ticket.serverId))!.config.retentionDays * TICKET_DAY,
              }
            : {}),
        ...(ticket.erased ? { tombstoneExpiresAt: Date.now() + 30 * TICKET_DAY } : {}),
    })
    await countActiveTickets(ctx, ticket.serverId, -Number(ticket.active))
    await releaseTicketNative(ctx, ticket)
}
function createReadback(ticket: Doc<"tickets">, attempt: Doc<"ticketAttempts">, channel: TicketChannelSnapshot) {
    const grant = attempt.grant!
    if (
        channel.serverId !== ticket.serverId ||
        channel.name !== grant.channelName ||
        channel.parentId !== grant.parentId ||
        !grant.overwrites ||
        !ticketOverwritesEqual(channel.overwrites, grant.overwrites)
    )
        fail(409, "Ticket creation readback changed")
    if (ticket.channelId && ticket.channelId !== channel.channelId) fail(409, "Ticket channel identity changed")
    rejectTicketAudience(ticket, channel)
}
async function failedBefore(ctx: MutationCtx, ticket: Doc<"tickets">, attempt: Doc<"ticketAttempts">) {
    if (ticket.currentAttemptId !== attempt._id) return
    if (attempt.grant!.action === "create") {
        await ctx.db.patch(ticket._id, {
            state: "failed",
            active: false,
            bodyExpiresAt:
                Date.now() + (await readTicketSettings(ctx, ticket.serverId))!.config.retentionDays * TICKET_DAY,
        })
        await countActiveTickets(ctx, ticket.serverId, -Number(ticket.active))
        await releaseTicketNative(ctx, ticket)
    } else if (attempt.grant!.action === "delete") await ctx.db.patch(ticket._id, { state: "closed" })
    else if (attempt.grant!.action.startsWith("close-") || attempt.grant!.action.startsWith("reopen-")) {
        const closing = attempt.grant!.action.startsWith("close-")
        // A first step proven unchanged leaves the ticket as it was, while a second step keeps the first one's progress
        if (ticket.completedSteps !== 0)
            return void (await ctx.db.patch(ticket._id, { state: closing ? "closing" : "reopening" }))
        await ctx.db.patch(ticket._id, {
            state: closing ? "open" : "closed",
            transition: undefined,
            ...(closing
                ? { baselineOverwrites: undefined, ownedPermissions: undefined }
                : {
                      active: false,
                      ...(!bodiesGone(ticket)
                          ? {
                                bodyExpiresAt:
                                    (ticket.closedAt ?? Date.now()) +
                                    (await readTicketSettings(ctx, ticket.serverId))!.config.retentionDays * TICKET_DAY,
                            }
                          : {}),
                  }),
        })
        if (!closing) await countActiveTickets(ctx, ticket.serverId, -Number(ticket.active))
    }
}
async function unknownCreate(ctx: MutationCtx, ticket: Doc<"tickets">) {
    const attempt = ticket.currentAttemptId ? await ctx.db.get(ticket.currentAttemptId) : null
    const unknown =
        !ticket.channelId && attempt?.grant?.action === "create" && attempt.outcome === "uncertain" && !attempt.resolved
    return unknown ? attempt : undefined
}
/** Abandoning or erasing an unknown create releases only the requester's slot. A possibly created channel keeps its role protection and a late verified callback still binds it */
export async function releaseUnknownCreateSlot(ctx: MutationCtx, ticket: Doc<"tickets">) {
    if (!ticket.active || !(await unknownCreate(ctx, ticket))) return false
    await ctx.db.patch(ticket._id, { active: false })
    await countActiveTickets(ctx, ticket.serverId, -1)
    return true
}
export const outcome = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TicketOutcomeResult> => {
        const input = decode(TicketOutcomeRequest, request),
            { ticket, attempt } = await boundTicketAttempt(ctx, input),
            grant = attempt.grant!,
            now = Date.now()
        const capability = input.claimToken
        if (attempt.claimedAt === undefined) {
            if (capability !== undefined || input.outcome !== "failed" || input.noDispatch !== true)
                fail(409, "Ticket dispatch not claimed")
        } else if (capability !== attempt.claimToken) fail(409, "Ticket claim capability mismatch")
        if (input.outcome === "failed" && input.noDispatch !== true) fail(409, "Ticket non-dispatch evidence required")
        if (
            input.nativeDeleteConfirmed &&
            (grant.action !== "delete" || attempt.claimedAt === undefined || input.noDispatch)
        )
            fail(409, "Invalid ticket deletion acknowledgment")
        if (
            input.noDispatch &&
            (input.channel || input.channelId || input.messageId || input.channelAbsent || input.nativeDeleteConfirmed)
        )
            fail(409, "Conflicting ticket non-dispatch evidence")
        const channel = input.channel === undefined ? undefined : ticketChannel(input.channel),
            channelId = input.channelId ?? channel?.channelId
        if (channel && (channel.serverId !== ticket.serverId || (channelId && channel.channelId !== channelId)))
            fail(409, "Ticket outcome channel changed")
        if (channelId && ticket.channelId && channelId !== ticket.channelId)
            fail(409, "Ticket outcome identity changed")
        if (channelId && grant.action !== "create" && channelId !== grant.channelId)
            fail(409, "Ticket outcome identity changed")
        const messageId = input.messageId
        if (
            messageId &&
            (ticketOwnsNativeResource(grant.action) ||
                channelId !== grant.channelId ||
                (attempt.messageId && attempt.messageId !== messageId))
        )
            fail(409, "Ticket message identity changed")
        const observationAt =
            input.observedAt === undefined
                ? undefined
                : integer(input.observedAt, attempt.claimedAt ?? attempt.createdAt, now + 1000)
        if (input.outcome === "succeeded") {
            if (grant.action === "create") {
                if (!channel || observationAt === undefined) fail(409, "Ticket creation readback required")
                createReadback(ticket, attempt, channel)
            } else if (grant.action === "delete") {
                if (
                    !(input.nativeDeleteConfirmed || attempt.nativeDeleteConfirmed) ||
                    input.channelAbsent !== true ||
                    channel ||
                    channelId !== ticket.channelId ||
                    observationAt === undefined ||
                    observationAt < now - 60000
                )
                    fail(409, "Ticket deletion unproven")
            } else if (grant.action.startsWith("close-") || grant.action.startsWith("reopen-")) {
                if (
                    !channel ||
                    !grant.desiredChannel ||
                    observationAt === undefined ||
                    !ownedChannelMatches(ticket, channel, grant.desiredChannel)
                )
                    fail(409, "Ticket transition readback changed")
                rejectTicketAudience(ticket, channel)
                rejectExtraSend(ticket, channel)
            } else {
                if (!messageId) fail(400, "Invalid request")
                if (channelId !== ticket.channelId) fail(409, "Ticket message channel changed")
            }
        }
        // Retain independently verified create identity and delete acknowledgment even after aging
        if (channelId && grant.action === "create") {
            await ctx.db.patch(attempt._id, { channelId })
            if (!ticket.channelId) await ctx.db.patch(ticket._id, { channelId })
        }
        if (input.nativeDeleteConfirmed) await ctx.db.patch(attempt._id, { nativeDeleteConfirmed: true })
        if (attempt.outcome !== "pending") {
            if (attempt.outcome !== input.outcome && attempt.outcome !== "uncertain")
                fail(409, "Ticket outcome immutable")
            if (messageId && attempt.outcome === "uncertain" && !attempt.messageId)
                await ctx.db.patch(attempt._id, { messageId })
            return {
                recorded: false,
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        const outcome = input.outcome
        await ctx.db.patch(attempt._id, {
            outcome,
            finishedAt: now,
            ...(input.noDispatch ? { noDispatch: true as const } : {}),
            ...(messageId ? { messageId } : {}),
            ...(observationAt !== undefined ? { observationAt } : {}),
            ...(outcome !== "uncertain" || !ticketOwnsNativeResource(grant.action)
                ? { expiresAt: now + 30 * TICKET_DAY }
                : {}),
        })
        let next: TicketActionGrant | undefined
        if (outcome === "succeeded") next = await completed(ctx, (await ctx.db.get(ticket._id))!, attempt, channel)
        else if (outcome === "failed") await failedBefore(ctx, ticket, attempt)
        else if (ticket.currentAttemptId === attempt._id && grant.action !== "reply" && grant.action !== "introduction")
            await ctx.db.patch(ticket._id, { state: "uncertain" })
        return {
            recorded: true,
            ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            ...(next ? { grant: next } : {}),
        }
    },
})

export const reconcile = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TicketReconcileResult> => {
        const input = decode(TicketReconcileRequest, request),
            identity = source(input, Date.now()),
            context = ticketContext(input.context),
            ticket = await findTicket(ctx, identity.serverId, input.ticketNo)
        await requireTicketAccess(ctx, ticket, context, {
            metadata: true,
            critical: administrator(context.actor),
        })
        if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, ticketStaff(context, ticket))))
            return { recorded: false, ticket: await publicTicket(ctx, ticket) }
        checkTicketGeneration(ticket, input.expectedGeneration)
        if (input.attemptId !== undefined && ticket.currentAttemptId !== input.attemptId)
            fail(409, "Ticket reconciliation generation changed")
        const attempt = input.attemptId === undefined ? null : await ctx.db.get(ticket.currentAttemptId!)
        // Retention removed the last action, or it failed before its claim and changed nothing, so nothing is left to
        // settle but a channel that is confirmed gone
        if (!attempt || (attempt.outcome === "failed" && attempt.claimedAt === undefined)) {
            if (
                (!attempt && ticket.currentAttemptId !== undefined) ||
                !ticket.channelId ||
                input.observation.channelId !== ticket.channelId ||
                !input.observation.channelAbsent
            )
                fail(409, "Ticket reconciliation unavailable")
            if (ticket.state === "retired") return { recorded: false, ticket: await publicTicket(ctx, ticket) }
            await retireTicket(ctx, ticket)
            return { recorded: true, ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!) }
        }
        if (!attempt.grant || attempt.outcome === "pending" || attempt.claimedAt === undefined)
            fail(409, "Ticket reconciliation unavailable")
        const observation = input.observation,
            observedAt = integer(
                observation.observedAt,
                Math.max(attempt.claimedAt, Date.now() - 60000),
                Date.now() + 1000,
            )
        if (!ticket.channelId || observation.channelId !== ticket.channelId) fail(409, "Known ticket identity required")
        // A channel confirmed gone still settles an attempt that was settled before
        if (attempt.resolved && observation.channelAbsent !== true)
            return { recorded: false, ticket: await publicTicket(ctx, ticket) }
        if (ticket.state === "retired") return { recorded: false, ticket: await publicTicket(ctx, ticket) }
        let resolution: "before" | "desired" | "absent" | undefined, channel: TicketChannelSnapshot | undefined
        // The contract names the channel snapshot exactly when the channel is present
        if (observation.channel === undefined) {
            // A known channel that is gone retires its ticket, except after a creation that was never confirmed or a
            // delete that was not confirmed
            if (
                attempt.grant.action === "delete"
                    ? attempt.nativeDeleteConfirmed
                    : observation.channelAbsent &&
                      (attempt.grant.action !== "create" ||
                          attempt.outcome === "succeeded" ||
                          attempt.resolved === "desired")
            )
                resolution = "absent"
        } else {
            channel = ticketChannel(observation.channel)
            if (
                channel.channelId !== ticket.channelId ||
                !context.channel ||
                !ticketChannelsEqual(channel, context.channel)
            )
                fail(409, "Ticket observation context changed")
            await requireTicketAccess(ctx, ticket, context, {
                critical: administrator(context.actor),
            })
            rejectTicketAudience(ticket, channel)
            if (attempt.grant.action === "create") {
                createReadback(ticket, attempt, channel)
                resolution = "desired"
            } else if (attempt.grant.action.startsWith("close-") || attempt.grant.action.startsWith("reopen-")) {
                rejectExtraSend(ticket, channel)
                if (attempt.grant.desiredChannel && ownedChannelMatches(ticket, channel, attempt.grant.desiredChannel))
                    resolution = "desired"
                else if (
                    attempt.grant.expectedChannel &&
                    ownedChannelMatches(ticket, channel, attempt.grant.expectedChannel)
                )
                    resolution = "before"
            } else if (
                attempt.grant.action === "delete" &&
                attempt.grant.expectedChannel &&
                ownedChannelMatches(ticket, channel, attempt.grant.expectedChannel) &&
                !attempt.nativeDeleteConfirmed
            )
                resolution = "before"
        }
        if (!resolution) return { recorded: false, ticket: await publicTicket(ctx, ticket) }
        await ctx.db.patch(attempt._id, {
            resolved: resolution,
            observationAt: observedAt,
            expiresAt: Date.now() + 30 * TICKET_DAY,
        })
        if (resolution === "before") {
            if (channel) await ctx.db.patch(ticket._id, { channel })
            await failedBefore(ctx, ticket, attempt)
        } else if (resolution === "absent" && attempt.grant.action !== "delete") await retireTicket(ctx, ticket)
        else {
            // Recovery records observed progress without authorizing another native write
            const action = attempt.grant.action
            if (action === "create") await ctx.db.patch(ticket._id, { channel, state: "open" })
            else if ((action === "close-everyone" || action === "reopen-requester") && ticket.completedSteps === 0)
                await ctx.db.patch(ticket._id, {
                    channel,
                    completedSteps: 1,
                    state: action === "close-everyone" ? "closing" : "reopening",
                })
            else await completed(ctx, ticket, attempt, channel)
        }
        return {
            recorded: true,
            ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
        }
    },
})

export const erase = internalMutation({
    args: { serverId: v.string(), ticketNo: v.number() },
    handler: async (ctx, args) => {
        const ticket = await findTicket(ctx, args.serverId, args.ticketNo)
        if (!ticket.erasing && !bodiesGone(ticket)) return
        await ctx.db.patch(ticket._id, {
            erasing: true,
            answers: [],
            category: {
                ...ticket.category,
                description: "",
                questions: [],
                cannedReplies: [],
            },
            bodyExpiresAt: undefined,
        })
        const intake = await ctx.db
            .query("ticketIntakes")
            .withIndex("by_number", (q) => q.eq("serverId", ticket.serverId).eq("intakeNo", ticket.intakeNo))
            .unique()
        if (intake)
            await ctx.db.patch(intake._id, {
                answers: [],
                category: {
                    ...intake.category,
                    description: "",
                    questions: [],
                },
            })
        const entries = await ctx.db
            .query("ticketEntries")
            .withIndex("by_payload", (q) =>
                q.eq("serverId", ticket.serverId).eq("ticketNo", ticket.ticketNo).eq("erased", false),
            )
            .take(TICKET_BATCH)
        for (const row of entries) await ctx.db.patch(row._id, { erased: true, content: undefined })
        const attempts = await ctx.db
            .query("ticketAttempts")
            .withIndex("by_payload", (q) =>
                q.eq("serverId", ticket.serverId).eq("ticketNo", ticket.ticketNo).eq("redacted", false),
            )
            .take(TICKET_BATCH)
        for (const row of attempts) {
            const grant = row.grant ? { ...row.grant } : undefined
            if (grant) delete grant.content
            await ctx.db.patch(row._id, { grant, redacted: true })
            if (
                row.outcome === "pending" &&
                row.claimedAt === undefined &&
                (row.grant?.action === "reply" ||
                    row.grant?.action === "introduction" ||
                    row.grant?.action === "create")
            ) {
                await ctx.db.patch(row._id, {
                    outcome: "failed",
                    noDispatch: true,
                    finishedAt: Date.now(),
                    expiresAt: Date.now() + 30 * TICKET_DAY,
                })
                await failedBefore(ctx, (await ctx.db.get(ticket._id))!, row)
            }
        }
        // Erasure stops saving, hides each transcript and deletes its pages and cursors in bounded batches
        if (ticket.transcriptDueAt !== undefined) await ctx.db.patch(ticket._id, { transcriptDueAt: undefined })
        const transcripts = (
            await ctx.db
                .query("ticketTranscripts")
                .withIndex("by_number", (q) => q.eq("serverId", ticket.serverId).eq("ticketNo", ticket.ticketNo))
                .collect()
        ).filter((row) => row.pages !== undefined)
        for (const row of transcripts.slice(0, TICKET_BATCH)) await ctx.db.patch(row._id, { pages: undefined })
        const pages = await ctx.db
            .query("ticketTranscriptPages")
            .withIndex("by_page", (q) => q.eq("serverId", ticket.serverId).eq("ticketNo", ticket.ticketNo))
            .take(TICKET_BATCH)
        for (const row of pages) await ctx.db.delete(row._id)
        const cursors = await ticketCursors(ctx, ticket.serverId, ticket.ticketNo)
        for (const row of cursors) await ctx.db.delete(row._id)
        if (
            entries.length === TICKET_BATCH ||
            attempts.length === TICKET_BATCH ||
            transcripts.length > TICKET_BATCH ||
            pages.length === TICKET_BATCH ||
            cursors.length === TICKET_BATCH
        )
            await ctx.scheduler.runAfter(0, internal.ticketLifecycle.erase, args)
        else {
            if (ticket.bodiesProtected)
                await protectTicketRoles(ctx, ticket.serverId, ticket.category.supportRoleIds, "privateBodyRefs", -1)
            const current = (await ctx.db.get(ticket._id))!
            await ctx.db.patch(ticket._id, {
                erasing: false,
                erased: true,
                bodiesProtected: false,
                answers: [],
                bodyExpiresAt: undefined,
                ...(!current.nativeProtected && (current.state === "retired" || current.state === "failed")
                    ? { tombstoneExpiresAt: Date.now() + 30 * TICKET_DAY }
                    : {}),
            })
        }
    },
})

export async function cleanupTickets(ctx: MutationCtx, now: number) {
    const receipts = await ctx.db
        .query("ticketReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(TICKET_BATCH)
    for (const row of receipts) await ctx.db.delete(row._id)
    const intakes = await ctx.db
        .query("ticketIntakes")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(TICKET_BATCH)
    for (const row of intakes) await ctx.db.delete(row._id)
    const expiring = await ctx.db
        .query("tickets")
        .withIndex("by_body_expiry", (q) => q.gt("bodyExpiresAt", 0).lte("bodyExpiresAt", now))
        .take(TICKET_BATCH)
    for (const row of expiring) {
        await ctx.db.patch(row._id, {
            erasing: true,
            bodyExpiresAt: undefined,
        })
        await ctx.scheduler.runAfter(0, internal.ticketLifecycle.erase, {
            serverId: row.serverId,
            ticketNo: row.ticketNo,
        })
    }
    const pending = await ctx.db
        .query("ticketAttempts")
        .withIndex("by_pending", (q) => q.eq("outcome", "pending").lte("dispatchExpiresAt", now - 10000))
        .take(TICKET_BATCH)
    for (const row of pending) {
        const ticket = await findTicket(ctx, row.serverId, row.ticketNo),
            unclaimed = row.claimedAt === undefined
        await ctx.db.patch(row._id, {
            outcome: unclaimed ? "failed" : "uncertain",
            finishedAt: now,
            ...(unclaimed ? { noDispatch: true as const } : {}),
            ...(unclaimed || (row.grant && !ticketOwnsNativeResource(row.grant.action))
                ? { expiresAt: now + 30 * TICKET_DAY }
                : {}),
        })
        if (unclaimed) await failedBefore(ctx, ticket, row)
        else if (
            ticket.currentAttemptId === row._id &&
            row.grant?.action !== "reply" &&
            row.grant?.action !== "introduction"
        )
            await ctx.db.patch(ticket._id, { state: "uncertain" })
    }
    const terminal = await ctx.db
        .query("ticketAttempts")
        .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
        .take(TICKET_BATCH)
    for (const row of terminal) {
        const ticket = await findTicket(ctx, row.serverId, row.ticketNo)
        if (ticketAttemptBlocks(row)) await ctx.db.patch(row._id, { expiresAt: undefined })
        else {
            if (ticket.currentAttemptId === row._id)
                await ctx.db.patch(ticket._id, {
                    currentAttemptId: undefined,
                })
            await ctx.db.delete(row._id)
        }
    }
    return { more: [receipts, intakes, expiring, pending, terminal].some((page) => page.length === TICKET_BATCH) }
}

/** Schedules purges for settled tombstones. A purge that finds its ticket still protected leaves it for a later pass, so this never reports more */
export async function scheduleTicketPurges(ctx: MutationCtx, now: number) {
    const expired = await ctx.db
        .query("tickets")
        .withIndex("by_tombstone_expiry", (q) => q.gt("tombstoneExpiresAt", 0).lte("tombstoneExpiresAt", now))
        .take(4)
    for (const row of expired)
        await ctx.scheduler.runAfter(0, internal.ticketLifecycle.purge, {
            serverId: row.serverId,
            ticketNo: row.ticketNo,
        })
    return { more: false }
}

export const purge = internalMutation({
    args: { serverId: v.string(), ticketNo: v.number() },
    handler: async (ctx, args) => {
        const ticket = await ctx.db
            .query("tickets")
            .withIndex("by_number", (q) => q.eq("serverId", args.serverId).eq("ticketNo", args.ticketNo))
            .unique()
        if (
            !ticket ||
            !ticket.erased ||
            ticket.erasing ||
            ticket.nativeProtected ||
            ticket.bodiesProtected ||
            !ticket.tombstoneExpiresAt ||
            ticket.tombstoneExpiresAt > Date.now() ||
            (ticket.state !== "retired" && ticket.state !== "failed")
        )
            return
        if (ticket.state === "retired" ? !ticket.retiredAt : Boolean(ticket.channelId)) return
        // Check the whole ticket's unresolved ownership by index before deleting any child page
        const pending = await ctx.db
            .query("ticketAttempts")
            .withIndex("by_ticket_outcome", (q) =>
                q.eq("serverId", args.serverId).eq("ticketNo", args.ticketNo).eq("outcome", "pending"),
            )
            .first()
        if (pending) return
        for (const action of [
            "create",
            "close-everyone",
            "close-requester",
            "reopen-requester",
            "reopen-everyone",
            "delete",
        ] as const) {
            const uncertain = await ctx.db
                .query("ticketAttempts")
                .withIndex("by_ticket_outcome", (q) =>
                    q
                        .eq("serverId", args.serverId)
                        .eq("ticketNo", args.ticketNo)
                        .eq("outcome", "uncertain")
                        .eq("resolved", undefined)
                        .eq("grant.action", action),
                )
                .first()
            if (uncertain) return
        }
        const entries = await ctx.db
            .query("ticketEntries")
            .withIndex("by_ticket", (q) => q.eq("serverId", args.serverId).eq("ticketNo", args.ticketNo))
            .take(TICKET_BATCH)
        for (const entry of entries) await ctx.db.delete(entry._id)
        const attempts = await ctx.db
            .query("ticketAttempts")
            .withIndex("by_number", (q) => q.eq("serverId", args.serverId).eq("ticketNo", args.ticketNo))
            .take(TICKET_BATCH)
        for (const attempt of attempts) await ctx.db.delete(attempt._id)
        const transcripts = await ctx.db
            .query("ticketTranscripts")
            .withIndex("by_number", (q) => q.eq("serverId", args.serverId).eq("ticketNo", args.ticketNo))
            .take(TICKET_BATCH)
        for (const transcript of transcripts) await ctx.db.delete(transcript._id)
        const pages = await ctx.db
            .query("ticketTranscriptPages")
            .withIndex("by_page", (q) => q.eq("serverId", args.serverId).eq("ticketNo", args.ticketNo))
            .take(TICKET_BATCH)
        for (const page of pages) await ctx.db.delete(page._id)
        const cursors = await ticketCursors(ctx, args.serverId, args.ticketNo)
        for (const cursor of cursors) await ctx.db.delete(cursor._id)
        if ([entries, attempts, transcripts, pages, cursors].some((batch) => batch.length === TICKET_BATCH))
            await ctx.scheduler.runAfter(0, internal.ticketLifecycle.purge, args)
        else await ctx.db.delete(ticket._id)
    },
})

const ticketCursors = (ctx: MutationCtx, serverId: string, ticketNo: number) =>
    ctx.db
        .query("ticketTranscriptCursors")
        .withIndex("by_source", (q) => q.eq("serverId", serverId).eq("ticketNo", ticketNo))
        .take(TICKET_BATCH)
