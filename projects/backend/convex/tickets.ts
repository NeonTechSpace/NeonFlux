import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import type {
    TicketManageResult,
    TicketIntakeResult,
    TicketQueryResult,
    TicketTranscriptUploadResult,
    TicketCategory,
    TicketOpenIntake,
    ServiceScope,
    TicketContext,
} from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { internal } from "./_generated/api.js"
import { releaseUnknownCreateSlot } from "./ticketLifecycle.ts"
import { administrator, ownedPostingBits } from "./moderationDomain.ts"
import { epoch, roleSnapshots } from "./rolesDomain.ts"
import { fail, requireId, requireServer, source } from "./validation.ts"
import {
    publishingContent,
    ids,
    integer,
    name,
    text,
    shape,
    visibility,
    ticketContext,
    ticketQuestions,
    intakeCategory,
    categorySummary,
    defaultTickets,
    TICKET_CLOSE_PERMISSIONS,
    TICKET_DAY,
    transcriptBody,
} from "./ticketDomain.ts"
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
    privateTicketContext,
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
    transcriptPages,
    checkTicketGeneration,
    ownedChannelMatches,
    rejectExtraSend,
    rejectTicketAudience,
    reserveTicket,
    ticketAttemptBlocks,
    countActiveTickets,
} from "./ticketStore.ts"

function request(value: unknown) {
    const input = shape(
            value,
            ["serverId", "messageId", "createdAt", "context", "operation"],
            ["serverId", "messageId", "createdAt", "context", "operation"],
        ),
        identity = source(input, Date.now()),
        context = ticketContext(input.context)
    return { identity, context, input }
}
function aliveBodies(ticket: Doc<"tickets">) {
    if (bodiesGone(ticket)) fail(409, "Ticket bodies erased")
}
function enabled(state: Doc<"ticketSettings">) {
    if (!state.config.enabled) fail(403, "Ticket module disabled")
}
function categoryPatch(current: TicketCategory, value: unknown): TicketCategory {
    const patch = shape(value, ["enabled", "visibility", "description", "parentId", "supportRoleIds", "questions"])
    if (!Object.keys(patch).length) fail(400, "Empty ticket category patch")
    const next = structuredClone(current)
    for (const [key, value] of Object.entries(patch)) {
        if (key === "enabled") {
            if (typeof value !== "boolean") fail(400, "Invalid ticket category")
            next.enabled = value
        } else if (key === "visibility") next.visibility = visibility(value)
        else if (key === "description") next.description = value === "" ? "" : text(value, 1000)
        else if (key === "parentId") next.parentId = value === null ? null : requireId(value)
        else if (key === "supportRoleIds") next.supportRoleIds = ids(value)
        else if (key === "questions") next.questions = ticketQuestions(value)
    }
    return next
}
function verifySupport(serverId: string, roles: unknown, supportRoleIds: string[]) {
    const snapshots = roleSnapshots(roles)
    for (const id of supportRoleIds)
        if (id === serverId || !snapshots.some((r) => r.roleId === id)) fail(400, "Invalid ticket support role")
}

// Staff turn a help desk post into a ticket for its author, through the same creation path as an intake. The ticket has no
// intake answers, the bot read the author's membership just before, and staff run the creation, so the dispatch checks staff
// authority instead of the requester's
async function escalate(ctx: MutationCtx, identity: { serverId: string, messageId: string }, context: TicketContext, state: Doc<"ticketSettings">, op: Record<string, unknown>): Promise<TicketManageResult> {
    shape(op, ["type", "categoryName", "requesterId", "requesterJoinedAt", "postId"], ["type", "categoryName", "requesterId", "requesterJoinedAt", "postId"])
    enabled(state)
    const category = (await findCategory(ctx, identity.serverId, name(op.categoryName))).config
    if (!ticketStaff(context, { category })) fail(403, "Ticket support role required")
    await ticketPolicy(ctx, identity.serverId, context, true)
    if (!category.enabled) fail(409, "Ticket category disabled")
    const requesterId = requireId(op.requesterId), requesterJoinedAt = epoch(op.requesterJoinedAt), postId = requireId(op.postId)
    if (!context.botAuthorized || requesterId === context.botId) fail(403, "Ticket channel authority required")
    if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, true))) return { duplicate: true }
    const own = await ctx.db.query("tickets").withIndex("by_user", (q) => q.eq("serverId", identity.serverId).eq("requesterId", requesterId).eq("active", true)).take(3)
    if (own.length >= 3) fail(429, "Requester active ticket limit")
    await protectTicketRoles(ctx, identity.serverId, category.supportRoleIds, "nativeOwnershipRefs", 1)
    await protectTicketRoles(ctx, identity.serverId, category.supportRoleIds, "privateBodyRefs", 1)
    const id = await ctx.db.insert("tickets", {
        serverId: identity.serverId,
        ticketNo: await ticketNumber(ctx, identity.serverId, "nextTicketNo"),
        intakeNo: 0,
        requesterId,
        requesterJoinedAt,
        category,
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
        const { identity, context, input } = request(value),
            op = shape(
                input.operation,
                [
                    "type",
                    "enabled",
                    "retentionDays",
                    "name",
                    "visibility",
                    "description",
                    "parentId",
                    "supportRoleIds",
                    "roles",
                    "expectedRevision",
                    "patch",
                    "cannedName",
                    "templateName",
                    "expectedTemplateRevision",
                    "ticketNo",
                    "expectedGeneration",
                    "priority",
                    "content",
                    "confirm",
                    "categoryName",
                    "requesterId",
                    "requesterJoinedAt",
                    "postId",
                ],
                ["type"],
            ),
            state = await ticketState(ctx, identity.serverId)
        if (op.type === "escalate") return escalate(ctx, identity, context, state, op)
        const configuration = ["settings", "category-create", "category-update", "category-delete", "canned-set", "canned-remove"].includes(
            String(op.type),
        )
        if (configuration) {
            await ticketAdmin(ctx, identity.serverId, context, op.type === "settings" && op.enabled === false)
            if (op.type !== "settings") privateTicketContext(context)
            if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, true))) return { duplicate: true }
            return changeConfiguration(ctx, identity.serverId, "tickets", { kind: "chat", createdAt: identity.createdAt, actor: { userId: context.actor.userId, source: "command" }, operation: op },
                () => applyTicketConfiguration(ctx, identity.serverId, op))
        }
        let ticket = await findTicket(ctx, identity.serverId, op.ticketNo)
        const recovery = ["close", "reopen", "delete", "erase", "abandon"].includes(String(op.type)),
            staff = await requireTicketAccess(ctx, ticket, context, {
                staff: !recovery,
                private: op.type === "note",
                critical: recovery && administrator(context.actor),
                metadata: op.type === "erase" || op.type === "abandon",
            })
        if (op.type === "delete" || op.type === "erase" || op.type === "abandon") await ticketAdmin(ctx, identity.serverId, context, true)
        if (!recovery) enabled(state)
        if (!staff) {
            enabled(state)
            await ticketProtection(ctx, identity.serverId, context)
        }
        if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, staff))) return { duplicate: true }
        checkTicketGeneration(ticket, op.expectedGeneration)
        if (op.type === "abandon") {
            shape(op, ["type", "ticketNo", "expectedGeneration"], ["type", "ticketNo", "expectedGeneration"])
            if (!(await releaseUnknownCreateSlot(ctx, ticket))) fail(409, "Only an active unknown ticket creation can be abandoned")
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "erase") {
            shape(op, ["type", "ticketNo", "expectedGeneration", "confirm"], ["type", "ticketNo", "expectedGeneration", "confirm"])
            if (op.confirm !== true) fail(400, "Ticket erasure confirmation required")
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
            shape(op, ["type", "ticketNo", "expectedGeneration"], ["type", "ticketNo", "expectedGeneration"])
            if (op.type === "claim" && ticket.claimedBy && ticket.claimedBy !== context.actor.userId && !administrator(context.actor))
                fail(409, "Ticket already claimed")
            if (op.type === "unclaim" && ticket.claimedBy && ticket.claimedBy !== context.actor.userId && !administrator(context.actor))
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
            shape(op, ["type", "ticketNo", "expectedGeneration", "priority"], ["type", "ticketNo", "expectedGeneration", "priority"])
            if (!["low", "normal", "high", "urgent"].includes(String(op.priority))) fail(400, "Invalid ticket priority")
            await ctx.db.patch(ticket._id, {
                priority: op.priority as Doc<"tickets">["priority"],
            })
            return {
                duplicate: false,
                type: "ticket",
                ticket: await publicTicket(ctx, (await ctx.db.get(ticket._id))!),
            }
        }
        if (op.type === "note" || op.type === "reply" || op.type === "canned-reply") {
            shape(op, ["type", "ticketNo", "expectedGeneration", "content", "cannedName"], ["type", "ticketNo", "expectedGeneration"])
            aliveBodies(ticket)
            if (ticket.entryCount >= 200) fail(429, "Ticket entry capacity reached")
            if (op.type !== "note" && (ticket.state !== "open" || !context.actor.canSend)) fail(409, "Ticket reply unavailable")
            if (op.type !== "note") {
                const current = ticket.currentAttemptId ? await ctx.db.get(ticket.currentAttemptId) : null
                if (ticketAttemptBlocks(current)) fail(409, "Ticket action unresolved")
                if (!context.channel || !context.botAuthorized || context.botId !== ticket.botId)
                    fail(403, "Ticket send authority required")
                rejectTicketAudience(ticket, context.channel)
            }
            const canned =
                op.type === "canned-reply" ? ticket.category.cannedReplies.find((r) => r.name === name(op.cannedName)) : undefined
            if (op.type === "canned-reply" && !canned) fail(404, "Ticket canned reply not found")
            const content =
                    op.type === "note" ? { content: text(op.content, 2000) } : (canned?.content ?? publishingContent(op.content, true)),
                entryNo = await ticketNumber(ctx, identity.serverId, "nextEntryNo")
            const grant =
                op.type === "note"
                    ? undefined
                    : await reserveTicket(ctx, ticket, "reply", identity.messageId, context.actor.userId, context.channel, content)
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
        if (op.type !== "close" && op.type !== "reopen" && op.type !== "delete") fail(400, "Unknown ticket operation")
        shape(op, ["type", "ticketNo", "expectedGeneration", "confirm"], ["type", "ticketNo", "expectedGeneration"])
        if (!ticket.channelId || !ticket.channel || !context.channel || !context.botAuthorized || context.botId !== ticket.botId)
            fail(409, "Known ticket channel required")
        if (!ownedChannelMatches(ticket, context.channel)) fail(409, "Ticket channel changed")
        // A new close owns SendMessages and the thread bits the bot holds. Another grant of any of them would defeat it
        const closeBits = ownedPostingBits(TICKET_CLOSE_PERMISSIONS, context.botPostingPermissions)
        rejectExtraSend(ticket, context.channel, op.type === "close" && !ticket.transition ? closeBits : undefined)
        rejectTicketAudience(ticket, context.channel)
        const previous = ticket.currentAttemptId ? await ctx.db.get(ticket.currentAttemptId) : null
        if (ticketAttemptBlocks(previous)) fail(409, "Ticket action unresolved")
        if (op.type === "delete") {
            if (op.confirm !== true || ticket.state !== "closed") fail(409, "Closed ticket deletion confirmation required")
            await ctx.db.patch(ticket._id, { state: "deleting" })
            ticket = (await ctx.db.get(ticket._id))!
            const grant = await reserveTicket(ctx, ticket, "delete", identity.messageId, context.actor.userId, context.channel)
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
                    .withIndex("by_user", (q) => q.eq("serverId", ticket.serverId).eq("requesterId", ticket.requesterId).eq("active", true))
                    .take(3)
                if (ownActive.length >= 3) fail(429, "Requester active ticket limit")
                await ctx.db.patch(ticket._id, { active: true })
                await countActiveTickets(ctx, ticket.serverId, ticket.active ? 0 : 1)
            }
            await ctx.db.patch(ticket._id, {
                transition: op.type,
                completedSteps: 0,
                state: op.type === "close" ? "closing" : "reopening",
                ...(op.type === "close" ? { baselineOverwrites: context.channel.overwrites, ownedPermissions: String(closeBits) } : {}),
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
        const { identity, context, input } = request(value),
            op = shape(
                input.operation,
                ["type", "categoryName", "expectedCategoryRevision", "intakeNo", "expectedGeneration", "question", "answer", "visibility"],
                ["type"],
            ),
            state = await ticketState(ctx, identity.serverId)
        privateTicketContext(context)
        await ticketPolicy(ctx, identity.serverId, context, administrator(context.actor))
        enabled(state)
        await ticketProtection(ctx, identity.serverId, context)
        if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, false))) return { duplicate: true }
        if (op.type === "open") {
            shape(op, ["type", "categoryName", "expectedCategoryRevision"], ["type", "categoryName", "expectedCategoryRevision"])
            const category = (await findCategory(ctx, identity.serverId, name(op.categoryName))).config
            if (!category.enabled || category.revision !== integer(op.expectedCategoryRevision, 1, Number.MAX_SAFE_INTEGER))
                fail(409, "Ticket category changed")
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
        if (
            draft.state !== "draft" ||
            draft.expiresAt <= Date.now() ||
            draft.generation !== integer(op.expectedGeneration, 1, Number.MAX_SAFE_INTEGER)
        )
            fail(409, "Ticket intake changed")
        // Clearing an answer lets a plain DM reply step back to that question
        if (op.type === "answer" || op.type === "clear") {
            const fields = ["type", "intakeNo", "expectedGeneration", "question", ...(op.type === "answer" ? ["answer"] : [])]
            shape(op, fields, fields)
            const answers = [...draft.answers],
                index = integer(op.question, 1, draft.category.questions.length) - 1
            answers[index] = op.type === "answer" ? text(op.answer, 2000) : ""
            if (answers.join("").length > 10000) fail(400, "Ticket answers too long")
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
            shape(op, ["type", "intakeNo", "expectedGeneration"], ["type", "intakeNo", "expectedGeneration"])
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
        if (op.type !== "submit") fail(400, "Unknown ticket intake operation")
        shape(
            op,
            ["type", "intakeNo", "expectedGeneration", "expectedCategoryRevision", "visibility"],
            ["type", "intakeNo", "expectedGeneration", "expectedCategoryRevision", "visibility"],
        )
        const category = (await findCategory(ctx, identity.serverId, draft.category.name)).config
        if (
            !category.enabled ||
            category.revision !== draft.category.revision ||
            category.revision !== integer(op.expectedCategoryRevision, 1, Number.MAX_SAFE_INTEGER) ||
            visibility(op.visibility) !== draft.category.visibility
        )
            fail(409, "Ticket audience changed")
        if (draft.answers.some((a) => !a.replace(/[\u000c\u202e]/g, "").trim())) fail(400, "Ticket answers incomplete")
        if (!context.botAuthorized || context.actor.userId === context.botId || (category.parentId && context.parentVerified !== true))
            fail(403, "Ticket channel authority required")
        const own = await ctx.db
            .query("tickets")
            .withIndex("by_user", (q) => q.eq("serverId", identity.serverId).eq("requesterId", context.actor.userId).eq("active", true))
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
                category,
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
        const grant = await reserveTicket(ctx, (await ctx.db.get(id))!, "create", identity.messageId, context.actor.userId)
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
        .withIndex("by_requester_live", (q) => q.eq("requesterId", userId).eq("state", "draft").gt("expiresAt", Date.now()))
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
const before = (value: unknown) => (value === undefined ? Number.MAX_SAFE_INTEGER : integer(value, 1, Number.MAX_SAFE_INTEGER))
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request: value }): Promise<TicketQueryResult> => {
        const input = shape(value, ["serverId", "context", "operation"], ["serverId", "context", "operation"]),
            serverId = requireId(input.serverId),
            context = ticketContext(input.context)
        requireServer(serverId)
        const op = shape(
            input.operation,
            [
                "type",
                "name",
                "intakeNo",
                "beforeIntakeNo",
                "ticketNo",
                "beforeTicketNo",
                "own",
                "kind",
                "beforeEntryNo",
                "attemptNo",
                "beforeTranscriptNo",
                "transcriptNo",
                "page",
            ],
            ["type"],
        )
        if (op.type === "settings" || op.type === "category-config") {
            await ticketAdmin(ctx, serverId, context, true)
            if (op.type === "settings")
                return {
                    type: "settings",
                    settings: (await readTicketSettings(ctx, serverId))?.config ?? defaultTickets(),
                }
            privateTicketContext(context)
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
            return {
                type: "categories",
                categories: (
                    await ctx.db
                        .query("ticketCategories")
                        .withIndex("by_name", (q) => q.eq("serverId", serverId))
                        .take(20)
                ).map((r) => categorySummary(r.config)),
            }
        }
        if (op.type === "intake" || op.type === "intakes") {
            privateTicketContext(context)
            await ticketPolicy(ctx, serverId, context, administrator(context.actor))
            if (op.type === "intake") {
                const draft = await findIntake(ctx, serverId, op.intakeNo)
                if (draft.requesterId !== context.actor.userId || draft.joinedAt !== context.actor.joinedAt)
                    fail(403, "Requester intake epoch required")
                if (draft.expiresAt <= Date.now()) fail(404, "Ticket intake expired")
                return {
                    type: "intake",
                    intake: await retainedIntake(ctx, draft),
                }
            }
            const rows = await ctx.db
                .query("ticketIntakes")
                .withIndex("by_number", (q) => q.eq("serverId", serverId).lt("intakeNo", before(op.beforeIntakeNo)))
                .order("desc")
                .take(21)
            const page = rows.slice(0, 20)
            return {
                type: "intakes",
                intakes: await Promise.all(
                    page
                        .filter(
                            (r) =>
                                r.requesterId === context.actor.userId && r.joinedAt === context.actor.joinedAt && r.expiresAt > Date.now(),
                        )
                        .map((r) => retainedIntake(ctx, r)),
                ),
                ...(rows.length > 20 ? { nextBeforeIntakeNo: page.at(-1)!.intakeNo } : {}),
            }
        }
        if (op.type === "tickets") {
            privateTicketContext(context)
            const rows = await ctx.db
                    .query("tickets")
                    .withIndex("by_number", (q) => q.eq("serverId", serverId).lt("ticketNo", before(op.beforeTicketNo)))
                    .order("desc")
                    .take(21),
                page = rows.slice(0, 20)
            const visible = page.filter((r) => (op.own !== true && ticketStaff(context, r)) || r.requesterId === context.actor.userId)
            for (const row of visible)
                await requireTicketAccess(ctx, row, context, {
                    metadata: true,
                    critical: administrator(context.actor),
                })
            return {
                type: "tickets",
                tickets: await Promise.all(visible.map((r) => publicTicket(ctx, r))),
                ...(rows.length > 20 ? { nextBeforeTicketNo: page.at(-1)!.ticketNo } : {}),
            }
        }
        const ticket = await findTicket(ctx, serverId, op.ticketNo),
            gone = bodiesGone(ticket)
        const privateRead = ["private-intake", "entries", "attempt", "transcripts", "transcript"].includes(String(op.type))
        await requireTicketAccess(ctx, ticket, context, {
            metadata: op.type === "locate" || op.type === "ticket",
            private: privateRead,
            staff: op.type === "entries" && op.kind === "note",
            history: op.type === "transcript" || op.type === "transcripts",
            critical: administrator(context.actor),
        })
        if (op.type === "locate")
            return {
                type: "locate",
                ticket: {
                    ticketNo: ticket.ticketNo,
                    requesterId: ticket.requesterId,
                    supportRoleIds: ticket.category.supportRoleIds,
                    state: ticket.state,
                    generation: ticket.generation,
                    botId: ticket.botId,
                    ...(ticket.channelId ? { channelId: ticket.channelId } : {}),
                    ...(ticket.retiredAt !== undefined ? { retiredAt: ticket.retiredAt } : {}),
                },
            }
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
            if (op.kind !== "reply" && op.kind !== "note") fail(400, "Invalid ticket entry kind")
            const rows = await ctx.db
                    .query("ticketEntries")
                    .withIndex("by_kind", (q) =>
                        q
                            .eq("serverId", serverId)
                            .eq("ticketNo", ticket.ticketNo)
                            .eq("kind", op.kind as "reply" | "note")
                            .lt("entryNo", before(op.beforeEntryNo)),
                    )
                    .order("desc")
                    .take(21),
                page = rows.slice(0, 20)
            return {
                type: "entries",
                entries: page.map((r) => publicEntry(r, gone)),
                ...(rows.length > 20 ? { nextBeforeEntryNo: page.at(-1)!.entryNo } : {}),
            }
        }
        if (op.type === "attempt") {
            const attempt = await ctx.db
                .query("ticketAttempts")
                .withIndex("by_number", (q) =>
                    q
                        .eq("serverId", serverId)
                        .eq("ticketNo", ticket.ticketNo)
                        .eq("attemptNo", integer(op.attemptNo, 1, Number.MAX_SAFE_INTEGER)),
                )
                .unique()
            if (!attempt) fail(404, "Ticket attempt not found")
            return { type: "attempt", attempt: publicAttempt(attempt, gone) }
        }
        if (op.type === "transcripts") {
            const rows = await ctx.db
                    .query("ticketTranscripts")
                    .withIndex("by_number", (q) =>
                        q.eq("serverId", serverId).eq("ticketNo", ticket.ticketNo).lt("transcriptNo", before(op.beforeTranscriptNo)),
                    )
                    .order("desc")
                    .take(21),
                page = rows.slice(0, 20)
            return {
                type: "transcripts",
                transcripts: page.map((r) => publicTranscript(r, gone)),
                ...(rows.length > 20 ? { nextBeforeTranscriptNo: page.at(-1)!.transcriptNo } : {}),
            }
        }
        if (op.type !== "transcript") fail(400, "Unknown ticket query")
        const transcript = await ctx.db
            .query("ticketTranscripts")
            .withIndex("by_number", (q) =>
                q
                    .eq("serverId", serverId)
                    .eq("ticketNo", ticket.ticketNo)
                    .eq("transcriptNo", integer(op.transcriptNo, 1, Number.MAX_SAFE_INTEGER)),
            )
            .unique()
        if (!transcript) fail(404, "Ticket transcript not found")
        const shown = publicTranscript(transcript, gone),
            page = op.page === undefined ? 1 : integer(op.page, 1, shown.pages)
        return {
            type: "transcript",
            transcript: shown,
            page,
            text: shown.erased ? "" : await transcriptPage(ctx, transcript, page),
        }
    },
})

export const transcript = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request: value }): Promise<TicketTranscriptUploadResult> => {
        const fields = ["serverId", "messageId", "createdAt", "context", "ticketNo", "expectedGeneration", "capturedAt", "messages", "truncated"]
        const input = shape(value, [...fields, "threads"], fields),
            identity = source(input, Date.now()),
            context = ticketContext(input.context),
            ticket = await findTicket(ctx, identity.serverId, input.ticketNo)
        const staff = await requireTicketAccess(ctx, ticket, context, {
            private: true,
            history: true,
        })
        aliveBodies(ticket)
        if (ticket.state === "retired" || !ticket.channelId || !context.channel) fail(409, "Native ticket history required")
        rejectTicketAudience(ticket, context.channel)
        checkTicketGeneration(ticket, input.expectedGeneration)
        if (!(await ticketReceipt(ctx, identity.serverId, identity.messageId, context, staff))) {
            const existing = await ctx.db
                .query("ticketTranscripts")
                .withIndex("by_source", (q) => q.eq("serverId", identity.serverId).eq("sourceId", identity.messageId))
                .unique()
            if (!existing || existing.ticketNo !== ticket.ticketNo) fail(409, "Transcript source changed")
            return { duplicate: true, transcript: publicTranscript(existing) }
        }
        if (typeof input.truncated !== "boolean") fail(400, "Invalid transcript")
        const { body, messageCount } = transcriptBody(input.messages, input.threads)
        const count = await ctx.db
            .query("ticketTranscripts")
            .withIndex("by_number", (q) => q.eq("serverId", ticket.serverId).eq("ticketNo", ticket.ticketNo))
            .take(20)
        if (count.length >= 20) fail(429, "Ticket transcript capacity reached")
        const pages = transcriptPages(body),
            transcriptNo = await ticketNumber(ctx, ticket.serverId, "nextTranscriptNo")
        const id = await ctx.db.insert("ticketTranscripts", {
            serverId: ticket.serverId,
            ticketNo: ticket.ticketNo,
            sourceId: identity.messageId,
            actorId: context.actor.userId,
            transcriptNo,
            channelId: ticket.channelId,
            capturedAt: integer(input.capturedAt, Date.now() - 300000, Date.now() + 1000),
            messageCount,
            truncated: input.truncated,
            pages: pages.length,
            createdAt: Date.now(),
        })
        for (const [index, text] of pages.entries())
            await ctx.db.insert("ticketTranscriptPages", { serverId: ticket.serverId, ticketNo: ticket.ticketNo, transcriptNo, pageNo: index + 1, text })
        return { duplicate: false, transcript: publicTranscript((await ctx.db.get(id))!) }
    },
})

export async function applyTicketConfiguration(ctx: MutationCtx, serverId: string, op: Record<string, unknown>): Promise<TicketManageResult> {
    const identity = { serverId }, state = await ticketState(ctx, serverId)
    if (op.type === "settings") {
        shape(op, ["type", "enabled", "retentionDays"], ["type"])
        if (op.enabled === undefined && op.retentionDays === undefined) fail(400, "Empty ticket settings")
        const config = { ...state.config }
        if (op.enabled !== undefined) {
            if (typeof op.enabled !== "boolean") fail(400, "Invalid ticket switch")
            config.enabled = op.enabled
        }
        if (op.retentionDays !== undefined) config.retentionDays = integer(op.retentionDays, 1, 365)
        await ctx.db.patch(state._id, { config })
        return { duplicate: false, type: "settings", settings: config }
    }
    const categoryName = name(op.name)
    if (op.type === "category-create") {
        shape(
            op,
            ["type", "name", "visibility", "description", "parentId", "supportRoleIds", "roles"],
            ["type", "name", "visibility", "supportRoleIds", "roles"],
        )
        if (
            await ctx.db
                .query("ticketCategories")
                .withIndex("by_name", (q) => q.eq("serverId", identity.serverId).eq("config.name", categoryName))
                .unique()
        )
            fail(409, "Ticket category already exists")
        const existing = await ctx.db
            .query("ticketCategories")
            .withIndex("by_name", (q) => q.eq("serverId", identity.serverId))
            .take(20)
        if (existing.length >= 20) fail(429, "Ticket category capacity reached")
        const supportRoleIds = ids(op.supportRoleIds)
        verifySupport(identity.serverId, op.roles, supportRoleIds)
        await protectTicketRoles(ctx, identity.serverId, supportRoleIds, "configurationRefs", 1)
        const category: TicketCategory = {
            name: categoryName,
            revision: await ticketNumber(ctx, identity.serverId, "nextCategoryRevision"),
            enabled: true,
            visibility: visibility(op.visibility),
            description: op.description === undefined || op.description === "" ? "" : text(op.description, 1000),
            parentId: op.parentId === undefined || op.parentId === null ? null : requireId(op.parentId),
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
    if (integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) !== row.config.revision) fail(409, "Ticket category changed")
    if (op.type === "category-delete") {
        shape(op, ["type", "name", "expectedRevision"], ["type", "name", "expectedRevision"])
        await protectTicketRoles(ctx, identity.serverId, row.config.supportRoleIds, "configurationRefs", -1)
        await ctx.db.delete(row._id)
        return { duplicate: false, type: "deleted", name: categoryName }
    }
    let category: TicketCategory
    if (op.type === "category-update") {
        shape(op, ["type", "name", "expectedRevision", "patch", "roles"], ["type", "name", "expectedRevision", "patch"])
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
        shape(
            op,
            ["type", "name", "expectedRevision", "cannedName", "templateName", "expectedTemplateRevision"],
            ["type", "name", "expectedRevision", "cannedName"],
        )
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
            if (template.revision !== integer(op.expectedTemplateRevision, 1, Number.MAX_SAFE_INTEGER))
                fail(409, "Ticket template changed")
            if (index < 0 && category.cannedReplies.length >= 20) fail(429, "Ticket canned reply capacity reached")
            const canned = {
                name: cannedName,
                templateName: template.name,
                templateRevision: template.revision,
                content: publishingContent(template.content, true),
            }
            if (index < 0) category.cannedReplies.push(canned)
            else category.cannedReplies[index] = canned
        }
    }
    category.revision = await ticketNumber(ctx, identity.serverId, "nextCategoryRevision")
    await ctx.db.patch(row._id, { config: category })
    return { duplicate: false, type: "category", category }
}
