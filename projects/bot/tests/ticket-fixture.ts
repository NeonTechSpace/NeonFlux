import type {
    TicketAction,
    TicketActionGrant,
    TicketAttempt,
    TicketCategory,
    TicketChannelSnapshot,
    TicketEntry,
    TicketIntake,
    TicketOverwrite,
    TicketPanel,
    TicketRecord,
    TicketSettings,
    TicketSource,
    TicketTranscript,
    TicketTranscriptMessage,
} from "@neonflux/contracts/tickets"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Effect, type Types } from "effect"
import { TicketStoreError, type TicketStore } from "../src/ticket-store.ts"

// Close grants own closeBits, as the backend issues them: SendMessages and the thread bits the bot holds
// The fake keeps the backend's records in memory and changes them in place
type Model<A> = Types.DeepMutable<A>
const postingBits =
    Permissions.SendMessages |
    Permissions.SendMessagesInThreads |
    Permissions.CreatePublicThreads |
    Permissions.CreatePrivateThreads
export function ticketBoundary(overrides: Partial<TicketStore> = {}, closeBits: bigint = postingBits) {
    const calls: { method: string; input: unknown }[] = [],
        categories = new Map<string, Model<TicketCategory>>(),
        intakes = new Map<number, Model<TicketIntake>>(),
        tickets = new Map<number, Model<TicketRecord>>()
    const entries: Model<TicketEntry>[] = [],
        transcripts = new Map<number, { record: TicketTranscript; messages: TicketTranscriptMessage[]; body: string }>()
    // The automatic transcript's appends and the cursor of each source, like the backend's
    const appends: { ticketNo: number; sourceId: string; after: string | null; messages: TicketTranscriptMessage[] }[] =
            [],
        cursors = new Map<string, string>(),
        due = new Map<number, number>(),
        done: { ticketNo: number; outcome: string }[] = [],
        panels = new Map<string, Model<TicketPanel>>()
    const settings: Model<TicketSettings> = { enabled: true, retentionDays: 30 },
        claims = new Map<string, string>()
    const attempts = new Map<number, Model<TicketAttempt>>()
    const originalSend = new Map<number, TicketChannelSnapshot>(),
        intakeServers = new Map<number, string>()
    let serial = 0
    const cloned = <A>(value: A) => structuredClone(value)
    const fail = (method: string, status = 404) => Effect.fail(new TicketStoreError({ operation: method, status }))
    function grant(ticket: Model<TicketRecord>, source: TicketSource, action: TicketAction): Model<TicketActionGrant> {
        const base: Model<TicketActionGrant> = {
            attemptId: `synthetic_attempt_${++serial}`,
            attemptNo: serial,
            ticketNo: ticket.ticketNo,
            generation: ticket.generation,
            sourceId: source.messageId,
            actorId: source.context.actor.userId,
            botId: ticket.botId,
            requesterId: ticket.requesterId,
            requesterJoinedAt: ticket.requesterJoinedAt,
            visibility: ticket.visibility,
            supportRoleIds: ticket.supportRoleIds,
            action,
            dispatchExpiresAt: Number.MAX_SAFE_INTEGER,
            nativeDeadlineMs: 5000,
        }
        if (ticket.channel) {
            base.channelId = ticket.channel.channelId
            base.expectedChannel = cloned(ticket.channel)
        }
        if (action === "create") {
            const category = categories.get(ticket.categoryName)!
            const access = Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory
            base.channelName = `ticket-${ticket.ticketNo}`
            base.parentId = category.parentId
            const overwrites: TicketOverwrite[] = [
                {
                    id: source.serverId,
                    type: "role",
                    allow: ticket.visibility === "public" ? access.toString() : "0",
                    deny: ticket.visibility === "private" ? Permissions.ViewChannel.toString() : "0",
                },
                {
                    id: ticket.botId,
                    type: "member",
                    allow: (access | Permissions.ManageChannels | Permissions.ManageRoles).toString(),
                    deny: "0",
                },
                { id: ticket.requesterId, type: "member", allow: access.toString(), deny: "0" },
                ...ticket.supportRoleIds.map((id) => ({
                    id,
                    type: "role" as const,
                    allow: access.toString(),
                    deny: "0",
                })),
            ]
            base.overwrites = overwrites.sort((a, b) =>
                a.type < b.type ? -1 : a.type > b.type ? 1 : BigInt(a.id) < BigInt(b.id) ? -1 : 1,
            )
        } else if (action === "introduction")
            base.content = {
                content: `Ticket ${ticket.ticketNo}. ${ticket.visibility} conversation. Intake stays private`,
            }
        else if (action.startsWith("close") || action.startsWith("reopen")) {
            const id = action.endsWith("everyone") ? source.serverId : ticket.requesterId
            if (action === "close-everyone") originalSend.set(ticket.ticketNo, cloned(ticket.channel!))
            const original = (
                action.startsWith("reopen") ? originalSend.get(ticket.ticketNo)! : ticket.channel!
            ).overwrites.find((o) => o.id === id)!
            const closed = action.startsWith("close")
            const value = {
                ...original,
                allow: (closed ? BigInt(original.allow) & ~closeBits : BigInt(original.allow)).toString(),
                deny: (closed ? BigInt(original.deny) | closeBits : BigInt(original.deny)).toString(),
            }
            base.targetOverwrite = value
            base.desiredChannel = {
                ...cloned(ticket.channel!),
                overwrites: ticket.channel!.overwrites.map((o) => (o.id === id ? value : cloned(o))),
            }
            base.ownedPermissions = closeBits.toString()
        }
        ticket.currentAttempt = { ...base, outcome: "pending", createdAt: source.createdAt || 1_700_000_000_000 }
        attempts.set(ticket.currentAttempt.attemptNo, ticket.currentAttempt)
        return cloned(base)
    }
    const store: TicketStore = {
        query(input) {
            calls.push({ method: "query", input })
            const op = input.operation
            // Like the backend, intake drafts answer only in a DM and private reads outside one need a destination
            const dm = input.context.actor.privateChannelVerified
            if (op.type === "intake" && !dm) return fail("query", 403)
            if (
                ["private-intake", "entries", "transcripts", "transcript", "transcript-pages", "tickets"].includes(
                    op.type,
                ) &&
                !dm &&
                !input.context.destination
            )
                return fail("query", 403)
            if (op.type === "settings") return Effect.succeed({ type: "settings", settings: cloned(settings) })
            // Like the backend, categories page 10 at a time in name order, optionally only those that are on
            if (op.type === "categories") {
                const rows = [...categories.values()]
                    .filter((c) => (!op.enabled || c.enabled) && (op.after === undefined || c.name > op.after))
                    .sort((a, b) => (a.name < b.name ? -1 : 1))
                const page = rows.slice(0, 10)
                return Effect.succeed({
                    type: "categories",
                    categories: page.map((c) => ({
                        name: c.name,
                        revision: c.revision,
                        enabled: c.enabled,
                        visibility: c.visibility,
                        description: c.description,
                    })),
                    ...(rows.length > 10 ? { nextAfter: page.at(-1)!.name } : {}),
                })
            }
            if (op.type === "category" || op.type === "category-config") {
                const c = categories.get(op.name)
                if (!c) return fail("query")
                return op.type === "category-config"
                    ? Effect.succeed({ type: "category-config", category: cloned(c) })
                    : Effect.succeed({
                          type: "category",
                          category: {
                              name: c.name,
                              revision: c.revision,
                              enabled: c.enabled,
                              visibility: c.visibility,
                              description: c.description,
                          },
                      })
            }
            if (op.type === "intake") {
                const intake = intakes.get(op.intakeNo)
                return intake ? Effect.succeed({ type: "intake", intake: cloned(intake) }) : fail("query")
            }
            if (op.type === "tickets")
                return Effect.succeed({ type: "tickets", tickets: [...tickets.values()].map(cloned) })
            const ticket =
                "channelId" in op
                    ? [...tickets.values()].find((t) => t.channelId === op.channelId)
                    : tickets.get(op.ticketNo)
            if (!ticket) return fail("query")
            if (op.type === "ticket") return Effect.succeed({ type: op.type, ticket: cloned(ticket) })
            if (op.type === "private-intake") {
                const intake = [...intakes.values()].find((i) => i.ticketNo === ticket.ticketNo)!
                return Effect.succeed({
                    type: "private-intake",
                    ticketNo: ticket.ticketNo,
                    questions: intake.category.questions,
                    answers: intake.answers,
                    erased: ticket.erased,
                })
            }
            // Like the backend, entries page newest first, 5 at a time, below an optional number
            if (op.type === "entries") {
                const rows = entries
                    .filter(
                        (e) =>
                            e.ticketNo === ticket.ticketNo &&
                            e.kind === op.kind &&
                            e.entryNo < (op.beforeEntryNo ?? Infinity),
                    )
                    .sort((a, b) => b.entryNo - a.entryNo)
                return Effect.succeed({
                    type: "entries",
                    entries: rows.slice(0, 5).map(cloned),
                    ...(rows.length > 5 ? { nextBeforeEntryNo: rows[4]!.entryNo } : {}),
                })
            }
            if (op.type === "attempt") {
                const attempt = attempts.get(op.attemptNo)
                return attempt?.ticketNo === op.ticketNo
                    ? Effect.succeed({ type: "attempt", attempt: cloned(attempt) })
                    : fail("query")
            }
            if (op.type === "transcripts")
                return Effect.succeed({
                    type: "transcripts",
                    transcripts: [...transcripts.values()].map((v) => cloned(v.record)),
                })
            if (op.type === "transcript-pages") {
                const t = transcripts.get(op.transcriptNo)
                if (!t) return fail("query")
                const texts = Array.from({ length: t.record.pages }, (_, i) => t.body.slice(i * 1500, (i + 1) * 1500))
                const from = op.fromPage - 1
                return Effect.succeed({
                    type: "transcript-pages",
                    transcript: cloned(t.record),
                    texts: texts.slice(from, from + 100),
                    ...(from + 100 < texts.length ? { nextPage: op.fromPage + 100 } : {}),
                })
            }
            if (op.type === "transcript") {
                const t = transcripts.get(op.transcriptNo),
                    page = op.page ?? 1
                return t
                    ? Effect.succeed({
                          type: "transcript",
                          transcript: cloned(t.record),
                          page,
                          text: t.body.slice((page - 1) * 1500, page * 1500),
                      })
                    : fail("query")
            }
            return fail("query")
        },
        manage(input) {
            calls.push({ method: "manage", input })
            const op = input.operation
            if (op.type === "settings") {
                if (op.enabled !== undefined) settings.enabled = op.enabled
                if (op.retentionDays !== undefined) settings.retentionDays = op.retentionDays
                return Effect.succeed({ duplicate: false, type: "settings", settings: cloned(settings) })
            }
            if (op.type === "category-create") {
                const category: Model<TicketCategory> = {
                    name: op.name,
                    revision: 1,
                    enabled: true,
                    visibility: op.visibility,
                    description: op.description ?? "",
                    parentId: op.parentId ?? null,
                    supportRoleIds: op.supportRoleIds,
                    questions: [],
                    cannedReplies: [],
                }
                categories.set(category.name, category)
                return Effect.succeed({ duplicate: false, type: "category", category: cloned(category) })
            }
            if (["category-update", "category-delete", "canned-set", "canned-remove"].includes(op.type)) {
                if (!("name" in op)) return fail("manage")
                const c = categories.get(op.name)
                if (!c) return fail("manage")
                if (op.type === "category-delete") {
                    categories.delete(op.name)
                    return Effect.succeed({ duplicate: false, type: "deleted", name: op.name })
                }
                if (op.type === "category-update") Object.assign(c, op.patch)
                if (op.type === "canned-set")
                    c.cannedReplies.push({
                        name: op.cannedName,
                        templateName: op.templateName,
                        templateRevision: op.expectedTemplateRevision,
                        content: { content: "Canned reply" },
                    })
                if (op.type === "canned-remove")
                    c.cannedReplies = c.cannedReplies.filter((r) => r.name !== op.cannedName)
                c.revision++
                return Effect.succeed({ duplicate: false, type: "category", category: cloned(c) })
            }
            if (op.type === "panel-save") {
                const replaced = panels.get(op.categoryName)
                const panel = {
                    categoryName: op.categoryName,
                    channelId: op.channelId,
                    messageId: op.messageId,
                    createdAt: 1,
                }
                panels.set(op.categoryName, panel)
                return Effect.succeed({
                    duplicate: false,
                    type: "panel",
                    panel: cloned(panel),
                    ...(replaced ? { replaced: cloned(replaced) } : {}),
                })
            }
            if (op.type === "panel-remove") {
                const panel = panels.get(op.categoryName)
                if (!panel) return fail("manage")
                panels.delete(op.categoryName)
                return Effect.succeed({ duplicate: false, type: "panel-removed", panel: cloned(panel) })
            }
            if (!("ticketNo" in op)) return fail("manage")
            const ticket = tickets.get(op.ticketNo)
            if (!ticket) return fail("manage")
            if (op.type === "claim") ticket.claimedBy = input.context.actor.userId
            if (op.type === "unclaim") delete ticket.claimedBy
            if (op.type === "priority") ticket.priority = op.priority
            if (op.type === "erase") ticket.erased = true
            if (op.type === "transcript-capture") {
                due.set(ticket.ticketNo, input.createdAt)
                ticket.transcript = { state: "saving", messageCount: ticket.transcript?.messageCount ?? 0 }
            }
            if (op.type === "delete" && due.has(ticket.ticketNo))
                return Effect.fail(
                    new TicketStoreError({
                        operation: "manage",
                        status: 409,
                        code: "REFUSED",
                        reason: `The closing transcript of ticket #${ticket.ticketNo} is still being saved. Try again once the ticket no longer shows its transcript as Saving`,
                    }),
                )
            if (op.type === "note") {
                const entry: Model<TicketEntry> = {
                    entryNo: entries.length + 1,
                    ticketNo: ticket.ticketNo,
                    authorId: input.context.actor.userId,
                    kind: "note",
                    createdAt: input.createdAt,
                    content: { content: op.content },
                    erased: false,
                }
                entries.push(entry)
                return Effect.succeed({ duplicate: false, type: "entry", entry })
            }
            if (
                op.type === "close" ||
                op.type === "reopen" ||
                op.type === "delete" ||
                op.type === "reply" ||
                op.type === "canned-reply"
            ) {
                ticket.generation++
                const action =
                    op.type === "close"
                        ? "close-everyone"
                        : op.type === "reopen"
                          ? "reopen-requester"
                          : op.type === "delete"
                            ? "delete"
                            : "reply"
                const g = grant(ticket, input, action)
                if (action === "reply") g.content = op.type === "reply" ? op.content : { content: "Canned reply" }
                return Effect.succeed({ duplicate: false, type: "ticket", ticket: cloned(ticket), grant: g })
            }
            return Effect.succeed({ duplicate: false, type: "ticket", ticket: cloned(ticket) })
        },
        intake(input) {
            calls.push({ method: "intake", input })
            const op = input.operation
            if (op.type === "open") {
                const c = categories.get(op.categoryName)!
                const i: Model<TicketIntake> = {
                    intakeNo: intakes.size + 1,
                    generation: 1,
                    category: {
                        name: c.name,
                        revision: c.revision,
                        enabled: c.enabled,
                        visibility: c.visibility,
                        description: c.description,
                        parentId: c.parentId,
                        supportRoleIds: c.supportRoleIds,
                        questions: c.questions,
                    },
                    requesterId: input.context.actor.userId,
                    joinedAt: input.context.actor.joinedAt,
                    answers: [],
                    state: "draft",
                    createdAt: input.createdAt,
                    expiresAt: Number.MAX_SAFE_INTEGER,
                }
                intakes.set(i.intakeNo, i)
                intakeServers.set(i.intakeNo, input.serverId)
                return Effect.succeed({ duplicate: false, type: "intake", intake: cloned(i) })
            }
            const i = intakes.get(op.intakeNo)!
            i.generation++
            if (op.type === "answer") i.answers[op.question - 1] = op.answer
            if (op.type === "clear") i.answers[op.question - 1] = ""
            if (op.type === "cancel") i.state = "cancelled"
            if (op.type === "submit") {
                i.state = "submitted"
                const t: Model<TicketRecord> = {
                    ticketNo: tickets.size + 1,
                    requesterId: i.requesterId,
                    requesterJoinedAt: i.joinedAt,
                    categoryName: i.category.name,
                    categoryRevision: i.category.revision,
                    visibility: i.category.visibility,
                    supportRoleIds: i.category.supportRoleIds,
                    state: "creating",
                    generation: 1,
                    botId: input.context.botId,
                    priority: "normal",
                    createdAt: input.createdAt,
                    erased: false,
                    entryCount: 0,
                }
                tickets.set(t.ticketNo, t)
                i.ticketNo = t.ticketNo
                return Effect.succeed({
                    duplicate: false,
                    type: "ticket",
                    ticket: cloned(t),
                    grant: grant(t, input, "create"),
                })
            }
            return Effect.succeed({ duplicate: false, type: "intake", intake: cloned(i) })
        },
        dispatch(input) {
            calls.push({ method: "dispatch", input })
            const t = tickets.get(input.ticketNo),
                g = t?.currentAttempt
            if (!g || claims.has(input.attemptId))
                return Effect.succeed({
                    claimed: false,
                    dispatchExpiresAt: g?.dispatchExpiresAt ?? 0,
                    nativeDeadlineMs: 5000,
                })
            claims.set(input.attemptId, input.claimToken)
            return Effect.succeed({ claimed: true, dispatchExpiresAt: g.dispatchExpiresAt, nativeDeadlineMs: 5000 })
        },
        outcome(input) {
            calls.push({ method: "outcome", input })
            const t = tickets.get(input.ticketNo)!
            if (input.channelId) t.channelId = input.channelId
            if (input.channel) t.channel = cloned(input.channel)
            if (t.currentAttempt) t.currentAttempt.outcome = input.outcome
            if (input.outcome !== "succeeded") {
                t.state = "uncertain"
                return Effect.succeed({ recorded: true, ticket: cloned(t) })
            }
            const action = t.currentAttempt!.action,
                next =
                    action === "create"
                        ? "introduction"
                        : action === "close-everyone"
                          ? "close-requester"
                          : action === "reopen-requester"
                            ? "reopen-everyone"
                            : undefined
            if (next) {
                t.generation++
                return Effect.succeed({
                    recorded: true,
                    ticket: cloned(t),
                    grant: grant(
                        t,
                        {
                            serverId: input.serverId,
                            messageId: input.sourceId,
                            createdAt: 0,
                            context: {
                                observedAt: 0,
                                botId: t.botId,
                                botAuthorized: true,
                                actor: {
                                    userId: t.currentAttempt!.actorId,
                                    roleIds: [],
                                    isOwner: true,
                                    isAdministrator: true,
                                    nativePermissionAuthorized: true,
                                    joinedAt: t.requesterJoinedAt,
                                    isBot: false,
                                    timeoutUntil: null,
                                    privateChannelVerified: false,
                                    canView: true,
                                    canReadHistory: true,
                                    canSend: true,
                                },
                            },
                        },
                        next,
                    ),
                })
            }
            t.state = action === "delete" ? "retired" : action === "close-requester" ? "closed" : "open"
            if (action === "delete") t.retiredAt = 1
            return Effect.succeed({ recorded: true, ticket: cloned(t) })
        },
        reconcile(input) {
            calls.push({ method: "reconcile", input })
            return Effect.succeed({ recorded: true, ticket: cloned(tickets.get(input.ticketNo)!) })
        },
        transcriptAppend(input) {
            calls.push({ method: "transcriptAppend", input })
            const key = `${input.ticketNo}:${input.source.id}`
            if ((cursors.get(key) ?? null) !== input.after) return fail("transcriptAppend", 409)
            appends.push({
                ticketNo: input.ticketNo,
                sourceId: input.source.id,
                after: input.after,
                messages: cloned(input.messages),
            })
            cursors.set(key, input.messages.at(-1)!.messageId)
            return Effect.succeed({ duplicate: false, transcriptNo: 1 })
        },
        transcriptDone(input) {
            calls.push({ method: "transcriptDone", input })
            done.push({ ticketNo: input.ticketNo, outcome: input.outcome })
            if (due.get(input.ticketNo) !== input.dueAt) return Effect.succeed({ recorded: false })
            due.delete(input.ticketNo)
            return Effect.succeed({ recorded: true })
        },
        work(input) {
            calls.push({ method: "work", input })
            const op = input.operation
            // Like the backend, panels page in category order. The fake pages 2 at a time so tests reach later pages
            if (op.type === "panels") {
                const rows = [...panels.values()]
                    .filter((p) => op.after === undefined || p.categoryName > op.after)
                    .sort((a, b) => (a.categoryName < b.categoryName ? -1 : 1))
                const page = rows.slice(0, 2)
                return Effect.succeed({
                    type: "panels",
                    panels: page.map(cloned),
                    ...(rows.length > 2 ? { nextAfter: page.at(-1)!.categoryName } : {}),
                })
            }
            if (op.type === "cursor")
                return Effect.succeed({
                    type: "cursor",
                    lastMessageId: cursors.get(`${op.ticketNo}:${op.sourceId}`) ?? null,
                })
            return Effect.succeed({
                type: "due",
                tickets: [...due.entries()].map(([ticketNo, dueAt]) => ({
                    ticketNo,
                    dueAt,
                    channelId: tickets.get(ticketNo)!.channelId!,
                    botId: tickets.get(ticketNo)!.botId,
                })),
            })
        },
        openIntakes(input) {
            calls.push({ method: "openIntakes", input })
            return Effect.succeed(
                [...intakes.values()]
                    .filter((i) => i.state === "draft" && i.requesterId === input.userId)
                    .map((i) => ({ serverId: intakeServers.get(i.intakeNo)!, intakeNo: i.intakeNo })),
            )
        },
        ...overrides,
    }
    return {
        store,
        calls,
        categories,
        intakes,
        tickets,
        entries,
        transcripts,
        settings,
        grant,
        claims,
        attempts,
        appends,
        cursors,
        due,
        done,
        panels,
    }
}
