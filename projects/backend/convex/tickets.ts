import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import { hasText } from "@neonflux/contracts/common"
import { canonicalBackupJson } from "@neonflux/contracts/backup"
import type { ServiceScope } from "@neonflux/contracts/service"
import {
    TICKET_CANNED_BYTES,
    TICKET_CATEGORY_PAGE,
    TICKET_CLOSE_PERMISSIONS,
    TICKET_SUPPORT_ROLES,
    ticketCannedBytes,
    TicketConfigurationOperation,
    TicketIntakeRequest,
    TicketManageRequest,
    TicketQueryRequest,
    type TicketManageResult,
    type TicketIntakeResult,
    type TicketQueryResult,
    type TicketCategory,
    type TicketIntakeCategory,
    type TicketOpenIntake,
    type TicketContext,
    type TicketManageOperation,
} from "@neonflux/contracts/tickets"
import type { Doc } from "./_generated/dataModel.js"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { internal } from "./_generated/api.js"
import { releaseUnknownCreateSlot } from "./ticketLifecycle.ts"
import { administrator, ownedPostingBits } from "./moderationDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import { currentTemplate } from "./publishing.ts"
import { roleSnapshots } from "./rolesDomain.ts"
import { decode, fail, ids, integer, name, object, source } from "./validation.ts"
import { ticketContext, intakeCategory, categorySummary, defaultTickets, TICKET_DAY } from "./ticketDomain.ts"
import {
    bodiesGone,
    ticketState,
    ticketNumber,
    protectTicketRoles,
    readTicketSettings,
    ticketAdmin,
    ticketPolicy,
    ticketStaff,
    ticketProtection,
    privateTicketChannel,
    privateTicketContext,
    privateDestinationAllows,
    requireTicketAccess,
    ticketReceipt,
    findTicket,
    findIntake,
    findCategory,
    publicIntake,
    publicTicket,
    publicEntry,
    publicAttempt,
    publicTranscript,
    transcriptPage,
    checkTicketGeneration,
    ownedChannelMatches,
    rejectExtraSend,
    rejectTicketAudience,
    reserveTicket,
    ticketAttemptBlocks,
    countActiveTickets,
} from "./ticketStore.ts"

function aliveBodies(ticket: Doc<"tickets">) {
    if (bodiesGone(ticket))
        fail(409, "This ticket's stored messages were erased, so it cannot be reopened or answered", "REFUSED")
}
function enabled(state: Doc<"ticketSettings">) {
    if (!state.config.enabled)
        fail(403, "Tickets are off. The server owner or an Administrator can turn them on", "REFUSED")
}
type Operation<T extends TicketManageOperation["type"]> = Extract<TicketManageOperation, { type: T }>
function categoryPatch(current: TicketCategory, patch: Operation<"category-update">["patch"]): TicketCategory {
    return {
        ...structuredClone(current),
        ...patch,
        ...(patch.supportRoleIds === undefined
            ? {}
            : { supportRoleIds: ids(patch.supportRoleIds, TICKET_SUPPORT_ROLES) }),
    }
}
// A category without support roles needs no role read, so the request may leave the snapshots out
function verifySupport(serverId: string, roles: unknown, supportRoleIds: string[]) {
    if (!supportRoleIds.length) return
    const snapshots = roleSnapshots(roles)
    for (const id of supportRoleIds)
        if (id === serverId || !snapshots.some((r) => r.roleId === id)) fail(400, "Invalid ticket support role")
}

// Staff turn a help desk post into a ticket for its author, through the same creation path as an intake. The ticket has no
// intake answers, the bot read the author's membership just before, and staff run the creation, so the dispatch checks staff
// authority instead of the requester's
async function escalate(
    ctx: MutationCtx,
    identity: { serverId: string; messageId: string },
    context: TicketContext,
    state: Doc<"ticketSettings">,
    op: Operation<"escalate">,
): Promise<TicketManageResult> {
    enabled(state)
    const category = (await findCategory(ctx, identity.serverId, name(op.categoryName))).config
    if (!ticketStaff(context, { category })) fail(403, "Ticket support role required")
    await ticketPolicy(ctx, identity.serverId, context, true)
    if (!category.enabled) fail(409, "That ticket category is off. Staff can turn it on", "REFUSED")
    const { requesterId, requesterJoinedAt, postId } = op
    if (!context.botAuthorized || requesterId === context.botId) fail(403, "Ticket channel authority required")
    if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, true))) return { duplicate: true }
    const own = await ctx.db
        .query("tickets")
        .withIndex("by_user", (q) =>
            q.eq("serverId", identity.serverId).eq("requesterId", requesterId).eq("active", true),
        )
        .take(3)
    if (own.length >= 3) fail(429, "Requester active ticket limit")
    await protectTicketRoles(ctx, identity.serverId, category.supportRoleIds, "nativeOwnershipRefs", 1)
    await protectTicketRoles(ctx, identity.serverId, category.supportRoleIds, "privateBodyRefs", 1)
    const id = await ctx.db.insert("tickets", {
        serverId: identity.serverId,
        ticketNo: await ticketNumber(ctx, identity.serverId, "nextTicketNo"),
        intakeNo: 0,
        requesterId,
        requesterJoinedAt,
        category: { ...category, cannedReplies: [] },
        answers: [],
        state: "creating",
        generation: 0,
        botId: context.botId,
        createdAt: Date.now(),
        priority: "normal",
        entryCount: 0,
        active: true,
        nativeProtected: true,
        bodiesProtected: true,
        completedSteps: 0,
        erased: false,
        erasing: false,
        escalatedFrom: postId,
    })
    await countActiveTickets(ctx, identity.serverId, 1)
    const grant = await reserveTicket(ctx, (await ctx.db.get(id))!, "create", identity.messageId, context.actor.userId)
    return { duplicate: false, type: "ticket", ticket: await publicTicket(ctx, (await ctx.db.get(id))!), grant }
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request: value }): Promise<TicketManageResult> => {
        const input = decode(TicketManageRequest, value),
            identity = source(input, Date.now()),
            context = ticketContext(input.context),
            op = input.operation,
            state = await ticketState(ctx, identity.serverId)
        if (op.type === "escalate") return escalate(ctx, identity, context, state, op)
        if (
            op.type === "settings" ||
            op.type === "category-create" ||
            op.type === "category-update" ||
            op.type === "category-delete" ||
            op.type === "canned-set" ||
            op.type === "canned-remove"
        ) {
            await ticketAdmin(ctx, identity.serverId, context, op.type === "settings" && op.enabled === false)
            if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, true)))
                return { duplicate: true }
            return changeConfiguration(
                ctx,
                identity.serverId,
                "tickets",
                {
                    kind: "chat",
                    createdAt: identity.createdAt,
                    actor: { userId: context.actor.userId, source: "command" },
                    operation: op,
                },
                () => applyTicketConfiguration(ctx, identity.serverId, op),
            )
        }
        if (op.type === "panel-save" || op.type === "panel-remove") {
            await ticketAdmin(ctx, identity.serverId, context)
            if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, true)))
                return { duplicate: true }
            return changeConfiguration(
                ctx,
                identity.serverId,
                "tickets",
                {
                    kind: "chat",
                    createdAt: identity.createdAt,
                    actor: { userId: context.actor.userId, source: "command" },
                    operation: op,
                },
                () => changePanel(ctx, identity.serverId, op),
            )
        }
        let ticket = await findTicket(ctx, identity.serverId, op.ticketNo)
        const capture = op.type === "transcript-capture",
            recovery = ["close", "reopen", "delete", "erase", "abandon"].includes(String(op.type)),
            staff = await requireTicketAccess(ctx, ticket, context, {
                staff: !recovery && !capture,
                ...(op.type === "note" ? { audience: "staff" as const } : {}),
                history: capture,
                critical: recovery && administrator(context.actor),
                metadata: op.type === "erase" || op.type === "abandon",
            })
        if (op.type === "delete" || op.type === "erase" || op.type === "abandon")
            await ticketAdmin(ctx, identity.serverId, context, true)
        if (!recovery && !capture) enabled(state)
        if (!staff) {
            enabled(state)
            await ticketProtection(ctx, identity.serverId, context)
        }
        if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, staff)))
            return { duplicate: true }
        checkTicketGeneration(ticket, op.expectedGeneration)
        if (capture) {
            aliveBodies(ticket)
            if (!ticket.channelId || ticket.state === "retired" || ticket.state === "creating")
                fail(409, "Native ticket history required")
            await ctx.db.patch(ticket._id, {
                transcriptDueAt: Date.now(),
                transcriptFailures: undefined,
                transcriptFailed: undefined,
            })
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "abandon") {
            if (!(await releaseUnknownCreateSlot(ctx, ticket)))
                fail(409, "Abandon only applies to a ticket whose channel creation stayed unknown", "REFUSED")
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "erase") {
            await releaseUnknownCreateSlot(ctx, ticket)
            await ctx.db.patch(ticket._id, {
                erasing: true,
                answers: [],
                category: {
                    ...ticket.category,
                    questions: [],
                    cannedReplies: [],
                },
                bodyExpiresAt: undefined,
            })
            await ctx.scheduler.runAfter(0, internal.ticketLifecycle.erase, {
                serverId: ticket.serverId,
                ticketNo: ticket.ticketNo,
            })
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "claim" || op.type === "unclaim") {
            if (
                op.type === "claim" &&
                ticket.claimedBy &&
                ticket.claimedBy !== context.actor.userId &&
                !administrator(context.actor)
            )
                fail(409, "Ticket already claimed")
            if (
                op.type === "unclaim" &&
                ticket.claimedBy &&
                ticket.claimedBy !== context.actor.userId &&
                !administrator(context.actor)
            )
                fail(403, "Ticket claimant required")
            await ctx.db.patch(ticket._id, {
                claimedBy: op.type === "claim" ? context.actor.userId : undefined,
            })
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "priority") {
            await ctx.db.patch(ticket._id, {
                priority: op.priority,
            })
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "note" || op.type === "reply" || op.type === "canned-reply") {
            aliveBodies(ticket)
            if (op.type !== "note" && (ticket.state !== "open" || !context.actor.canSend))
                fail(409, "Ticket reply unavailable")
            if (op.type !== "note") {
                const current = ticket.currentAttemptId ? await ctx.db.get(ticket.currentAttemptId) : null
                if (ticketAttemptBlocks(current))
                    fail(
                        409,
                        "An earlier action on this ticket is not confirmed yet. Check it with the ticket reconcile command first",
                        "REFUSED",
                    )
                if (!context.channel || !context.botAuthorized || context.botId !== ticket.botId)
                    fail(403, "Ticket send authority required")
                rejectTicketAudience(ticket, context.channel)
            }
            // A canned reply is read from the ticket's category as it is now, so one added after the ticket opened answers too. Once
            // the category is deleted, the replies it had then still answer
            const canned =
                op.type === "canned-reply"
                    ? (
                          (
                              await ctx.db
                                  .query("ticketCategories")
                                  .withIndex("by_name", (q) =>
                                      q.eq("serverId", ticket.serverId).eq("config.name", ticket.category.name),
                                  )
                                  .unique()
                          )?.config.cannedReplies ??
                          (await retiredCanned(ctx, ticket.serverId, ticket.category.name))?.cannedReplies
                      )?.find((r) => r.name === name(op.cannedName))
                    : undefined
            if (op.type === "canned-reply" && !canned) fail(404, "Ticket canned reply not found")
            const content =
                    op.type === "note"
                        ? { content: op.content }
                        : op.type === "reply"
                          ? publishingContent(op.content, true)
                          : await cannedContent(ctx, ticket.serverId, canned!),
                entryNo = await ticketNumber(ctx, identity.serverId, "nextEntryNo")
            const grant =
                op.type === "note"
                    ? undefined
                    : await reserveTicket(
                          ctx,
                          ticket,
                          "reply",
                          identity.messageId,
                          context.actor.userId,
                          context.channel,
                          content,
                      )
            const id = await ctx.db.insert("ticketEntries", {
                serverId: ticket.serverId,
                ticketNo: ticket.ticketNo,
                entryNo,
                authorId: context.actor.userId,
                kind: op.type === "note" ? "note" : "reply",
                createdAt: Date.now(),
                content,
                erased: false,
                ...(grant ? { attemptNo: grant.attemptNo } : {}),
            })
            await ctx.db.patch(ticket._id, {
                entryCount: ticket.entryCount + 1,
            })
            if (!grant)
                return {
                    duplicate: false,
                    type: "entry",
                    entry: publicEntry((await ctx.db.get(id))!),
                }
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
                grant,
            }
        }
        if (
            !ticket.channelId ||
            !ticket.channel ||
            !context.channel ||
            !context.botAuthorized ||
            context.botId !== ticket.botId
        )
            fail(409, "Known ticket channel required")
        if (!ownedChannelMatches(ticket, context.channel)) fail(409, "Ticket channel changed")
        // A new close owns SendMessages and the thread bits the bot holds. Another grant of any of them would defeat it
        const closeBits = ownedPostingBits(TICKET_CLOSE_PERMISSIONS, context.botPostingPermissions)
        rejectExtraSend(ticket, context.channel, op.type === "close" && !ticket.transition ? closeBits : undefined)
        rejectTicketAudience(ticket, context.channel)
        const previous = ticket.currentAttemptId ? await ctx.db.get(ticket.currentAttemptId) : null
        if (ticketAttemptBlocks(previous))
            fail(
                409,
                "An earlier action on this ticket is not confirmed yet. Check it with the ticket reconcile command first",
                "REFUSED",
            )
        if (op.type === "delete") {
            if (ticket.state !== "closed") fail(409, "Closed ticket deletion confirmation required")
            // Deleting the channel would lose the messages its transcript is still saving
            if (ticket.transcriptDueAt !== undefined && !bodiesGone(ticket))
                fail(
                    409,
                    `The closing transcript of ticket #${ticket.ticketNo} is still being saved. Try again once the ticket no longer shows its transcript as Saving`,
                    "REFUSED",
                )
            await ctx.db.patch(ticket._id, { state: "deleting" })
            ticket = (await ctx.db.get(ticket._id))!
            const grant = await reserveTicket(
                ctx,
                ticket,
                "delete",
                identity.messageId,
                context.actor.userId,
                context.channel,
            )
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
                grant,
            }
        }
        if (op.type === "reopen") {
            enabled(state)
            aliveBodies(ticket)
        }
        if (ticket.transition && ticket.transition !== op.type) fail(409, "Ticket transition incomplete")
        if (!ticket.transition) {
            if ((op.type === "close" && ticket.state !== "open") || (op.type === "reopen" && ticket.state !== "closed"))
                fail(409, "Ticket transition unavailable")
            if (op.type === "reopen") {
                const ownActive = await ctx.db
                    .query("tickets")
                    .withIndex("by_user", (q) =>
                        q.eq("serverId", ticket.serverId).eq("requesterId", ticket.requesterId).eq("active", true),
                    )
                    .take(3)
                if (ownActive.length >= 3) fail(429, "Requester active ticket limit")
                await ctx.db.patch(ticket._id, { active: true })
                await countActiveTickets(ctx, ticket.serverId, ticket.active ? 0 : 1)
            }
            await ctx.db.patch(ticket._id, {
                transition: op.type,
                completedSteps: 0,
                state: op.type === "close" ? "closing" : "reopening",
                ...(op.type === "close"
                    ? { baselineOverwrites: context.channel.overwrites, ownedPermissions: String(closeBits) }
                    : {}),
                ...(op.type === "reopen" ? { bodyExpiresAt: undefined } : {}),
                channel: context.channel,
            })
        }
        ticket = (await ctx.db.get(ticket._id))!
        const action =
                op.type === "close"
                    ? ticket.completedSteps === 0
                        ? "close-everyone"
                        : "close-requester"
                    : ticket.completedSteps === 0
                      ? "reopen-requester"
                      : "reopen-everyone",
            grant = await reserveTicket(ctx, ticket, action, identity.messageId, context.actor.userId, context.channel)
        return {
            duplicate: false,
            type: "ticket",
            ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            grant,
        }
    },
})

export const intake = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request: value }): Promise<TicketIntakeResult> => {
        const input = decode(TicketIntakeRequest, value),
            identity = source(input, Date.now()),
            context = ticketContext(input.context),
            op = input.operation,
            state = await ticketState(ctx, identity.serverId)
        privateTicketContext(context)
        await ticketPolicy(ctx, identity.serverId, context, administrator(context.actor))
        enabled(state)
        await ticketProtection(ctx, identity.serverId, context)
        if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, false)))
            return { duplicate: true }
        if (op.type === "open") {
            const category = (await findCategory(ctx, identity.serverId, name(op.categoryName))).config
            if (!category.enabled) fail(409, "That ticket category is off. Staff can turn it on", "REFUSED")
            if (category.revision !== op.expectedCategoryRevision)
                fail(409, "That ticket category just changed. Open the ticket again", "REFUSED")
            const own = await ctx.db
                .query("ticketIntakes")
                .withIndex("by_user_live", (q) =>
                    q
                        .eq("serverId", identity.serverId)
                        .eq("requesterId", context.actor.userId)
                        .eq("state", "draft")
                        .gt("expiresAt", Date.now()),
                )
                .take(3)
            if (own.length >= 3) fail(429, "Requester intake limit")
            const id = await ctx.db.insert("ticketIntakes", {
                serverId: identity.serverId,
                intakeNo: await ticketNumber(ctx, identity.serverId, "nextIntakeNo"),
                generation: 1,
                category: intakeCategory(category),
                requesterId: context.actor.userId,
                joinedAt: context.actor.joinedAt,
                answers: category.questions.map(() => ""),
                state: "draft",
                createdAt: Date.now(),
                expiresAt: Date.now() + TICKET_DAY,
            })
            return {
                duplicate: false,
                type: "intake",
                intake: publicIntake((await ctx.db.get(id))!),
            }
        }
        const draft = await findIntake(ctx, identity.serverId, op.intakeNo)
        if (draft.requesterId !== context.actor.userId || draft.joinedAt !== context.actor.joinedAt)
            fail(403, "Requester intake epoch required")
        if (draft.state !== "draft" || draft.expiresAt <= Date.now() || draft.generation !== op.expectedGeneration)
            fail(409, "This request expired or was already sent or cancelled. Open a new ticket", "REFUSED")
        // Clearing an answer lets a plain DM reply step back to that question
        if (op.type === "answer" || op.type === "clear") {
            const answers = [...draft.answers],
                index = integer(op.question, 1, draft.category.questions.length) - 1
            answers[index] = op.type === "answer" ? op.answer : ""
            await ctx.db.patch(draft._id, {
                answers,
                generation: draft.generation + 1,
            })
            return {
                duplicate: false,
                type: "intake",
                intake: publicIntake((await ctx.db.get(draft._id))!),
            }
        }
        if (op.type === "cancel") {
            await ctx.db.patch(draft._id, {
                state: "cancelled",
                answers: [],
                generation: draft.generation + 1,
            })
            return {
                duplicate: false,
                type: "intake",
                intake: publicIntake((await ctx.db.get(draft._id))!),
            }
        }
        const category = (await findCategory(ctx, identity.serverId, draft.category.name)).config
        // Only what the request holds counts, so a canned reply added to the category meanwhile changes nothing for it
        const asked = (value: TicketIntakeCategory) => canonicalBackupJson({ ...value, revision: 0 })
        if (
            !category.enabled ||
            asked(intakeCategory(category)) !== asked(draft.category) ||
            op.expectedCategoryRevision !== draft.category.revision
        )
            fail(
                409,
                "This ticket category changed or was turned off. Cancel this request and open a new ticket",
                "REFUSED",
            )
        if (op.visibility !== draft.category.visibility)
            fail(
                409,
                `This request opens a ${draft.category.visibility} conversation. Send submit ${draft.intakeNo} ${draft.category.visibility}`,
                "REFUSED",
            )
        if (draft.answers.some((a) => !hasText(a)))
            fail(400, "Answer every question first, then submit again", "REFUSED")
        if (
            !context.botAuthorized ||
            context.actor.userId === context.botId ||
            (category.parentId && context.parentVerified !== true)
        )
            fail(403, "Ticket channel authority required")
        const own = await ctx.db
            .query("tickets")
            .withIndex("by_user", (q) =>
                q.eq("serverId", identity.serverId).eq("requesterId", context.actor.userId).eq("active", true),
            )
            .take(3)
        if (own.length >= 3) fail(429, "Requester active ticket limit")
        await protectTicketRoles(ctx, identity.serverId, category.supportRoleIds, "nativeOwnershipRefs", 1)
        await protectTicketRoles(ctx, identity.serverId, category.supportRoleIds, "privateBodyRefs", 1)
        const ticketNo = await ticketNumber(ctx, identity.serverId, "nextTicketNo"),
            id = await ctx.db.insert("tickets", {
                serverId: identity.serverId,
                ticketNo,
                intakeNo: draft.intakeNo,
                requesterId: draft.requesterId,
                requesterJoinedAt: draft.joinedAt,
                // Canned replies are read from the category when one is sent, so the ticket keeps no copy of them
                category: { ...category, cannedReplies: [] },
                answers: draft.answers,
                state: "creating",
                generation: 0,
                botId: context.botId,
                createdAt: Date.now(),
                priority: "normal",
                entryCount: 0,
                active: true,
                nativeProtected: true,
                bodiesProtected: true,
                completedSteps: 0,
                erased: false,
                erasing: false,
            })
        await countActiveTickets(ctx, identity.serverId, 1)
        await ctx.db.patch(draft._id, {
            state: "submitted",
            ticketNo,
            generation: draft.generation + 1,
        })
        const grant = await reserveTicket(
            ctx,
            (await ctx.db.get(id))!,
            "create",
            identity.messageId,
            context.actor.userId,
        )
        return {
            duplicate: false,
            type: "ticket",
            ticket: await publicTicket(ctx, (await ctx.db.get(id))!),
            grant,
        }
    },
})

// A plain DM names no server, so the bot finds the member's live drafts first. The answer carries no private body, and the
// intake functions still check membership, the private channel and policy before reading or changing a draft
export async function openIntakes(ctx: QueryCtx, scope: ServiceScope, userId: string): Promise<TicketOpenIntake[]> {
    const rows = await ctx.db
        .query("ticketIntakes")
        .withIndex("by_requester_live", (q) =>
            q.eq("requesterId", userId).eq("state", "draft").gt("expiresAt", Date.now()),
        )
        .take(10)
    return rows
        .filter((r) => scope.mode === "multi" || r.serverId === scope.serverIds[0])
        .map((r) => ({ serverId: r.serverId, intakeNo: r.intakeNo }))
}

async function retainedIntake(ctx: QueryCtx, row: Doc<"ticketIntakes">) {
    if (row.ticketNo !== undefined) {
        const ticket = await findTicket(ctx, row.serverId, row.ticketNo)
        if (bodiesGone(ticket))
            return publicIntake({
                ...row,
                answers: [],
                category: { ...row.category, description: "", questions: [] },
            })
    }
    return publicIntake(row)
}
const before = (value: number | undefined) => value ?? Number.MAX_SAFE_INTEGER
// Chat lists show 10 tickets or transcripts per page, or 5 staff notes, since a note can hold 2000 characters.
// A ticket page picks its visible tickets from the 25 newest ones before it. A ticket holds up to 25 answers of 2000 characters,
// so 26 of them stay within Convex's 8 MiB read limit
const TICKET_PAGE = 10,
    TICKET_SCAN = 25,
    NOTE_PAGE = 5,
    // A transcript file reads this many pages per call, far below Convex's read limit
    TRANSCRIPT_FILE_PAGES = 100
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request: value }): Promise<TicketQueryResult> => {
        const input = decode(TicketQueryRequest, value),
            serverId = input.serverId,
            context = ticketContext(input.context),
            op = input.operation
        if (op.type === "settings" || op.type === "category-config") {
            await ticketAdmin(ctx, serverId, context, true)
            if (op.type === "settings")
                return {
                    type: "settings",
                    settings: (await readTicketSettings(ctx, serverId))?.config ?? defaultTickets(),
                }
            return {
                type: "category-config",
                category: (await findCategory(ctx, serverId, name(op.name))).config,
            }
        }
        if (op.type === "categories" || op.type === "category") {
            await ticketPolicy(ctx, serverId, context, administrator(context.actor))
            if (op.type === "category")
                return {
                    type: "category",
                    category: categorySummary((await findCategory(ctx, serverId, name(op.name))).config),
                }
            // A page of categories in name order, or of those that are on, after the name the last page ended with
            const after = op.after === undefined ? undefined : name(op.after),
                rows = op.enabled
                    ? await ctx.db
                          .query("ticketCategories")
                          .withIndex("by_enabled", (q) =>
                              after === undefined
                                  ? q.eq("serverId", serverId).eq("config.enabled", true)
                                  : q.eq("serverId", serverId).eq("config.enabled", true).gt("config.name", after),
                          )
                          .take(TICKET_CATEGORY_PAGE + 1)
                    : await ctx.db
                          .query("ticketCategories")
                          .withIndex("by_name", (q) =>
                              after === undefined
                                  ? q.eq("serverId", serverId)
                                  : q.eq("serverId", serverId).gt("config.name", after),
                          )
                          .take(TICKET_CATEGORY_PAGE + 1),
                page = rows.slice(0, TICKET_CATEGORY_PAGE)
            return {
                type: "categories",
                categories: page.map((r) => categorySummary(r.config)),
                ...(rows.length > TICKET_CATEGORY_PAGE ? { nextAfter: page.at(-1)!.config.name } : {}),
            }
        }
        if (op.type === "intake") {
            privateTicketContext(context)
            await ticketPolicy(ctx, serverId, context, administrator(context.actor))
            const draft = await findIntake(ctx, serverId, op.intakeNo)
            if (draft.requesterId !== context.actor.userId || draft.joinedAt !== context.actor.joinedAt)
                fail(403, "Requester intake epoch required")
            if (draft.expiresAt <= Date.now()) fail(404, "Ticket intake expired")
            return {
                type: "intake",
                intake: await retainedIntake(ctx, draft),
            }
        }
        if (op.type === "tickets") {
            // Outside a DM a list shows only the tickets whose readers include everyone who can read the channel
            const dm = privateTicketChannel(context)
            if (!dm && !context.destination) fail(403, "Private ticket access required")
            const rows = await ctx.db
                    .query("tickets")
                    .withIndex("by_number", (q) => q.eq("serverId", serverId).lt("ticketNo", before(op.beforeTicketNo)))
                    .order("desc")
                    .take(TICKET_SCAN + 1),
                scanned = rows.slice(0, TICKET_SCAN)
            const own = scanned.filter((r) => ticketStaff(context, r) || r.requesterId === context.actor.userId),
                all = own.filter((r) => privateDestinationAllows(context, r, "readers")),
                visible = all.slice(0, TICKET_PAGE)
            for (const row of visible)
                await requireTicketAccess(ctx, row, context, {
                    metadata: true,
                    critical: administrator(context.actor),
                })
            return {
                type: "tickets",
                tickets: await Promise.all(visible.map((r) => publicTicket(ctx, r))),
                // A full page continues after its last ticket, a scan that ended on hidden ones after its last read
                ...(all.length > TICKET_PAGE || rows.length > TICKET_SCAN
                    ? { nextBeforeTicketNo: (all.length > TICKET_PAGE ? visible : scanned).at(-1)!.ticketNo }
                    : {}),
                ...(own.length > all.length ? { hidden: true as const } : {}),
            }
        }
        if (op.type === "ticket" && "channelId" in op) {
            const row = await ctx.db
                .query("tickets")
                .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", op.channelId))
                .first()
            if (!row) fail(404, "Ticket not found")
            await requireTicketAccess(ctx, row, context, { metadata: true, critical: administrator(context.actor) })
            return { type: "ticket", ticket: await publicTicket(ctx, row) }
        }
        const ticket = await findTicket(ctx, serverId, op.ticketNo),
            gone = bodiesGone(ticket)
        // Staff notes and intake answers answer only where the requester cannot read them. Replies and transcripts may
        // answer where the requester can
        const audience =
            op.type === "private-intake" || (op.type === "entries" && op.kind === "note")
                ? ("staff" as const)
                : op.type === "entries" || op.type.startsWith("transcript")
                  ? ("readers" as const)
                  : undefined
        await requireTicketAccess(ctx, ticket, context, {
            metadata: op.type === "ticket",
            ...(audience ? { audience } : {}),
            staff: op.type === "entries" && op.kind === "note",
            history: op.type.startsWith("transcript"),
            critical: administrator(context.actor),
        })
        if (op.type === "ticket") return { type: "ticket", ticket: await publicTicket(ctx, ticket) }
        if (op.type === "private-intake")
            return {
                type: "private-intake",
                ticketNo: ticket.ticketNo,
                questions: gone ? [] : ticket.category.questions,
                answers: gone ? [] : ticket.answers,
                erased: gone,
            }
        if (op.type === "entries") {
            const rows = await ctx.db
                    .query("ticketEntries")
                    .withIndex("by_kind", (q) =>
                        q
                            .eq("serverId", serverId)
                            .eq("ticketNo", ticket.ticketNo)
                            .eq("kind", op.kind)
                            .lt("entryNo", before(op.beforeEntryNo)),
                    )
                    .order("desc")
                    .take(NOTE_PAGE + 1),
                page = rows.slice(0, NOTE_PAGE)
            return {
                type: "entries",
                entries: page.map((r) => publicEntry(r, gone)),
                ...(rows.length > NOTE_PAGE ? { nextBeforeEntryNo: page.at(-1)!.entryNo } : {}),
            }
        }
        if (op.type === "attempt") {
            const attempt = await ctx.db
                .query("ticketAttempts")
                .withIndex("by_number", (q) =>
                    q.eq("serverId", serverId).eq("ticketNo", ticket.ticketNo).eq("attemptNo", op.attemptNo),
                )
                .unique()
            if (!attempt) fail(404, "Ticket attempt not found")
            // Outside a DM an attempt shows what happened without the text it posted
            return { type: "attempt", attempt: publicAttempt(attempt, gone || !privateTicketChannel(context)) }
        }
        if (op.type === "transcripts") {
            const rows = await ctx.db
                    .query("ticketTranscripts")
                    .withIndex("by_number", (q) =>
                        q
                            .eq("serverId", serverId)
                            .eq("ticketNo", ticket.ticketNo)
                            .lt("transcriptNo", before(op.beforeTranscriptNo)),
                    )
                    .order("desc")
                    .take(TICKET_PAGE + 1),
                page = rows.slice(0, TICKET_PAGE)
            return {
                type: "transcripts",
                transcripts: page.map((r) => publicTranscript(r, gone)),
                ...(rows.length > TICKET_PAGE ? { nextBeforeTranscriptNo: page.at(-1)!.transcriptNo } : {}),
            }
        }
        if (op.type !== "transcript" && op.type !== "transcript-pages") fail(400, "Unknown ticket query")
        const transcript = await ctx.db
            .query("ticketTranscripts")
            .withIndex("by_number", (q) =>
                q.eq("serverId", serverId).eq("ticketNo", ticket.ticketNo).eq("transcriptNo", op.transcriptNo),
            )
            .unique()
        if (!transcript) fail(404, "Ticket transcript not found")
        const shown = publicTranscript(transcript, gone)
        if (op.type === "transcript-pages") {
            const from = integer(op.fromPage, 1, shown.pages),
                rows = shown.erased
                    ? []
                    : await ctx.db
                          .query("ticketTranscriptPages")
                          .withIndex("by_page", (q) =>
                              q
                                  .eq("serverId", serverId)
                                  .eq("ticketNo", ticket.ticketNo)
                                  .eq("transcriptNo", transcript.transcriptNo)
                                  .gte("pageNo", from),
                          )
                          .take(TRANSCRIPT_FILE_PAGES)
            return {
                type: "transcript-pages",
                transcript: shown,
                texts: rows.map((row) => row.text),
                ...(from + rows.length <= shown.pages && rows.length === TRANSCRIPT_FILE_PAGES
                    ? { nextPage: from + rows.length }
                    : {}),
            }
        }
        const page = op.page === undefined ? 1 : integer(op.page, 1, shown.pages)
        return {
            type: "transcript",
            transcript: shown,
            page,
            text: shown.erased ? "" : await transcriptPage(ctx, transcript, page),
        }
    },
})

/**
 * Saves a whole ticket category, as a backup restore does. The category gets the next revision, so tickets that opened under the old one keep
 * theirs, and the support roles it no longer names stop being protected while the new ones start. The caller has checked the roles
 */
export async function saveTicketCategory(
    ctx: MutationCtx,
    serverId: string,
    row: Doc<"ticketCategories"> | null,
    value: Omit<TicketCategory, "revision">,
) {
    const old = row?.config.supportRoleIds ?? []
    await protectTicketRoles(
        ctx,
        serverId,
        value.supportRoleIds.filter((id) => !old.includes(id)),
        "configurationRefs",
        1,
    )
    await protectTicketRoles(
        ctx,
        serverId,
        old.filter((id) => !value.supportRoleIds.includes(id)),
        "configurationRefs",
        -1,
    )
    const config = { ...value, revision: await ticketNumber(ctx, serverId, "nextCategoryRevision") }
    if (row) await ctx.db.patch(row._id, { config })
    else await ctx.db.insert("ticketCategories", { serverId, config })
}

// Chat, dashboard jobs and presets carry the same operation. A dashboard job sets roles to undefined when the bot sent none
export async function applyTicketConfiguration(
    ctx: MutationCtx,
    serverId: string,
    value: unknown,
): Promise<TicketManageResult> {
    const op = decode(
        TicketConfigurationOperation,
        Object.fromEntries(Object.entries(object(value)).filter(([, field]) => field !== undefined)),
    )
    const identity = { serverId },
        state = await ticketState(ctx, serverId)
    if (op.type === "settings") {
        const config = { ...state.config }
        if (op.enabled !== undefined) config.enabled = op.enabled
        if (op.retentionDays !== undefined) config.retentionDays = op.retentionDays
        await ctx.db.patch(state._id, { config })
        return { duplicate: false, type: "settings", settings: config }
    }
    const categoryName = name(op.name)
    if (op.type === "category-create") {
        if (
            await ctx.db
                .query("ticketCategories")
                .withIndex("by_name", (q) => q.eq("serverId", identity.serverId).eq("config.name", categoryName))
                .unique()
        )
            fail(409, "A ticket category with that name already exists. Choose another name", "REFUSED")
        // The new category's canned replies answer for tickets of a deleted one of the same name, as its other settings do
        const retired = await retiredCanned(ctx, identity.serverId, categoryName)
        if (retired) await ctx.db.delete(retired._id)
        const supportRoleIds = ids(op.supportRoleIds, TICKET_SUPPORT_ROLES)
        verifySupport(identity.serverId, op.roles, supportRoleIds)
        await protectTicketRoles(ctx, identity.serverId, supportRoleIds, "configurationRefs", 1)
        const category: TicketCategory = {
            name: categoryName,
            revision: await ticketNumber(ctx, identity.serverId, "nextCategoryRevision"),
            enabled: true,
            visibility: op.visibility,
            description: op.description ?? "",
            parentId: op.parentId ?? null,
            supportRoleIds,
            questions: [],
            cannedReplies: [],
        }
        await ctx.db.insert("ticketCategories", {
            serverId: identity.serverId,
            config: category,
        })
        return { duplicate: false, type: "category", category }
    }
    const row = await findCategory(ctx, identity.serverId, categoryName)
    if (op.expectedRevision !== row.config.revision) fail(409, "Ticket category changed")
    if (op.type === "category-delete") {
        await protectTicketRoles(ctx, identity.serverId, row.config.supportRoleIds, "configurationRefs", -1)
        await ctx.db.delete(row._id)
        // Open tickets of the category keep its canned replies. A restore may have made the category again over earlier ones
        const retired = await retiredCanned(ctx, identity.serverId, categoryName)
        if (retired) await ctx.db.delete(retired._id)
        if (row.config.cannedReplies.length)
            await ctx.db.insert("ticketRetiredCanned", {
                serverId: identity.serverId,
                name: categoryName,
                cannedReplies: row.config.cannedReplies,
            })
        const panel = await categoryPanel(ctx, identity.serverId, categoryName)
        if (panel) await ctx.db.delete(panel._id)
        return {
            duplicate: false,
            type: "deleted",
            name: categoryName,
            ...(panel ? { panel: publicPanel(panel) } : {}),
        }
    }
    let category: TicketCategory
    if (op.type === "category-update") {
        category = categoryPatch(row.config, op.patch)
        if (JSON.stringify(category.supportRoleIds) !== JSON.stringify(row.config.supportRoleIds)) {
            verifySupport(identity.serverId, op.roles, category.supportRoleIds)
            await protectTicketRoles(
                ctx,
                identity.serverId,
                category.supportRoleIds.filter((id) => !row.config.supportRoleIds.includes(id)),
                "configurationRefs",
                1,
            )
            await protectTicketRoles(
                ctx,
                identity.serverId,
                row.config.supportRoleIds.filter((id) => !category.supportRoleIds.includes(id)),
                "configurationRefs",
                -1,
            )
        }
    } else {
        category = structuredClone(row.config)
        const cannedName = name(op.cannedName),
            index = category.cannedReplies.findIndex((r) => r.name === cannedName)
        if (op.type === "canned-remove") {
            if (index < 0) fail(404, "Ticket canned reply not found")
            category.cannedReplies.splice(index, 1)
        } else {
            const template = await ctx.db
                .query("publishingDrafts")
                .withIndex("by_server_kind_name", (q) =>
                    q.eq("serverId", identity.serverId).eq("kind", "template").eq("name", name(op.templateName)),
                )
                .unique()
            if (!template) fail(404, "Ticket template not found")
            if (template.revision !== op.expectedTemplateRevision) fail(409, "Ticket template changed")
            const canned = {
                name: cannedName,
                templateName: template.name,
                templateRevision: template.revision,
                content: publishingContent(template.content, true),
            }
            if (index < 0) category.cannedReplies.push(canned)
            else category.cannedReplies[index] = canned
            if (ticketCannedBytes(category.cannedReplies) > TICKET_CANNED_BYTES)
                fail(
                    409,
                    "This category's canned replies would pass 256 KiB, the most one category holds. Remove a canned reply or choose a shorter template",
                    "REFUSED",
                )
        }
    }
    category = { ...category, revision: await ticketNumber(ctx, identity.serverId, "nextCategoryRevision") }
    await ctx.db.patch(row._id, { config: category })
    return { duplicate: false, type: "category", category }
}

const retiredCanned = (ctx: MutationCtx, serverId: string, categoryName: string) =>
    ctx.db
        .query("ticketRetiredCanned")
        .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", categoryName))
        .unique()

// A canned reply follows its template by name, so template edits apply to the next reply. The saved copy answers when the
// template is gone or no longer valid for a reply
async function cannedContent(ctx: MutationCtx, serverId: string, canned: TicketCategory["cannedReplies"][number]) {
    const template = await currentTemplate(ctx, serverId, canned.templateName)
    if (!template) return canned.content
    try {
        return publishingContent(template.content, true)
    } catch {
        return canned.content
    }
}

const categoryPanel = (ctx: QueryCtx, serverId: string, categoryName: string) =>
    ctx.db
        .query("ticketPanels")
        .withIndex("by_category", (q) => q.eq("serverId", serverId).eq("categoryName", categoryName))
        .unique()
export function publicPanel(row: Doc<"ticketPanels">) {
    const { categoryName, channelId, messageId, createdAt } = row
    return { categoryName, channelId, messageId, createdAt }
}
/** One reaction panel per category. A new one replaces the old, whose message the bot deletes once */
async function changePanel(
    ctx: MutationCtx,
    serverId: string,
    op: Operation<"panel-save"> | Operation<"panel-remove">,
): Promise<TicketManageResult> {
    const categoryName = name(op.categoryName),
        old = await categoryPanel(ctx, serverId, categoryName)
    if (op.type === "panel-remove") {
        if (!old) fail(404, "Ticket panel not found")
        await ctx.db.delete(old._id)
        return { duplicate: false, type: "panel-removed", panel: publicPanel(old) }
    }
    await findCategory(ctx, serverId, categoryName)
    if (old) await ctx.db.delete(old._id)
    const id = await ctx.db.insert("ticketPanels", {
        serverId,
        categoryName,
        channelId: op.channelId,
        messageId: op.messageId,
        createdAt: Date.now(),
    })
    return {
        duplicate: false,
        type: "panel",
        panel: publicPanel((await ctx.db.get(id))!),
        ...(old ? { replaced: publicPanel(old) } : {}),
    }
}
