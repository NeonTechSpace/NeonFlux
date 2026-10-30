import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { internal } from "../convex/_generated/api.js"
import type { TicketActionGrant, TicketActor, TicketChannelSnapshot, TicketContext } from "@neonflux/contracts/tickets"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { cleanupTickets, scheduleTicketPurges } from "../convex/ticketLifecycle.ts"
// SendMessages, CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads
const TICKET_CLOSE_PERMISSIONS = 2048n | (1n << 35n) | (1n << 36n) | (1n << 38n)

const secret = "synthetic-tickets-secret-not-a-credential-0000"
const oldServer = process.env.NEONFLUX_SERVER_ID,
    oldSecret = process.env.NEONFLUX_BOT_API_SECRET
let drainScheduled: (() => Promise<void>) | undefined
beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = "1"
    process.env.NEONFLUX_BOT_API_SECRET = secret
    drainScheduled = undefined
})
afterEach(async () => {
    await drainScheduled?.()
    if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = oldServer
    if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = oldSecret
})
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/tickets.ts": () => import("../convex/tickets.ts"),
    "../convex/ticketLifecycle.ts": () => import("../convex/ticketLifecycle.ts"),
    "../convex/ticketTranscripts.ts": () => import("../convex/ticketTranscripts.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/roles.ts": () => import("../convex/roles.ts"),
    "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const day = 86400000,
    epoch = "2023-11-14T22:13:20.000000Z",
    claimToken = "a".repeat(32)
const requester: TicketActor = {
    originServerId: "1",
    userId: "20",
    roleIds: [],
    isOwner: false,
    isAdministrator: false,
    nativePermissionAuthorized: true,
    joinedAt: epoch,
    isBot: false,
    timeoutUntil: null,
    privateChannelVerified: true,
    privateChannelId: "600",
    canView: true,
    canReadHistory: true,
    canSend: true,
}
const owner: TicketActor = { ...requester, userId: "10", isOwner: true }
// Moderation and roles requests carry only the moderation actor, without the ticket member read
const ownerActor = {
    originServerId: owner.originServerId,
    userId: owner.userId,
    roleIds: owner.roleIds,
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const support: TicketActor = { ...requester, userId: "21", roleIds: ["40"] }
const roleSnapshots = [
    {
        roleId: "40",
        permissions: "0",
        botCanManage: true,
        actorCanManage: true,
    },
    {
        roleId: "41",
        permissions: "0",
        botCanManage: true,
        actorCanManage: true,
    },
]
async function read(response: Response): Promise<any> {
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json()))
    assert.equal(JSON.stringify(await response.json()).includes(secret), false)
}
function fixture(test: TestContext) {
    let now = 1700000000000,
        sequence = 1000
    test.mock.method(Date, "now", () => now)
    test.mock.timers.enable({ apis: ["setTimeout"] })
    const t = convexBackend(modules)
    drainScheduled = () => t.finishAllScheduledFunctions(() => test.mock.timers.tick(0))
    const source = () => ({
        serverId: "1",
        messageId: String(++sequence),
        createdAt: now,
    })
    // The posting bits the bot reports holding server-wide. Undefined models a bot that reports none
    let botPosting: string | undefined = String(TICKET_CLOSE_PERMISSIONS)
    const context = (
        actor = requester,
        channel?: TicketChannelSnapshot,
        destination?: TicketChannelSnapshot,
    ): TicketContext => ({
        observedAt: now,
        actor,
        botId: "999",
        botAuthorized: true,
        ...(botPosting === undefined ? {} : { botPostingPermissions: botPosting }),
        parentVerified: true,
        ...(channel ? { channel } : {}),
        ...(destination ? { destination } : {}),
    })
    const http = (path: string, body: unknown, auth = true) => botCall(t, path, body, auth ? {} : { secret: null })
    const manage = (
        operation: any,
        actor = owner,
        channel?: TicketChannelSnapshot,
        destination?: TicketChannelSnapshot,
    ) =>
        http("/tickets/manage", {
            ...source(),
            context: context(actor, channel, destination),
            operation,
        })
    const query = (
        operation: any,
        actor = requester,
        channel?: TicketChannelSnapshot,
        destination?: TicketChannelSnapshot,
    ) =>
        http("/tickets/query", {
            serverId: "1",
            context: context(actor, channel, destination),
            operation,
        })
    const intake = (operation: any, actor = requester, extra = {}) =>
        http("/tickets/intake", {
            ...source(),
            context: { ...context(actor), ...extra },
            operation,
        })
    const configure = async (
        visibility = "private",
        questions = ["Synthetic question"],
        parentId: string | null = null,
    ) => {
        await read(await manage({ type: "settings", enabled: true }))
        const c = (
            await read(
                await manage({
                    type: "category-create",
                    name: "support",
                    visibility,
                    description: "Synthetic description",
                    parentId,
                    supportRoleIds: ["40"],
                    roles: roleSnapshots,
                }),
            )
        ).category
        return (
            await read(
                await manage({
                    type: "category-update",
                    name: c.name,
                    expectedRevision: c.revision,
                    patch: { questions },
                }),
            )
        ).category
    }
    const draft = async (category: any, actor = requester) => {
        let d = (
            await read(
                await intake(
                    {
                        type: "open",
                        categoryName: category.name,
                        expectedCategoryRevision: category.revision,
                    },
                    actor,
                ),
            )
        ).intake
        for (let i = 0; i < category.questions.length; i++)
            d = (
                await read(
                    await intake(
                        {
                            type: "answer",
                            intakeNo: d.intakeNo,
                            expectedGeneration: d.generation,
                            question: i + 1,
                            answer: "Synthetic private answer",
                        },
                        actor,
                    ),
                )
            ).intake
        return d
    }
    const submit = (d: any, actor = requester, extra = {}) =>
        intake(
            {
                type: "submit",
                intakeNo: d.intakeNo,
                expectedGeneration: d.generation,
                expectedCategoryRevision: d.category.revision,
                visibility: d.category.visibility,
            },
            actor,
            extra,
        )
    const binding = (g: TicketActionGrant) => ({
        serverId: "1",
        ticketNo: g.ticketNo,
        generation: g.generation,
        attemptId: g.attemptId,
        sourceId: g.sourceId,
    })
    const dispatch = (g: TicketActionGrant, actor = requester, channel?: TicketChannelSnapshot, extra = {}) =>
        http("/tickets/dispatch", {
            ...binding(g),
            claimToken,
            context: context(actor, channel),
            ...extra,
        })
    const outcome = (g: TicketActionGrant, value = "succeeded", extra: any = {}) =>
        http("/tickets/outcome", {
            ...binding(g),
            claimToken,
            outcome: value,
            ...extra,
        })
    const createdChannel = (g: TicketActionGrant): TicketChannelSnapshot => ({
        channelId: String(300 + g.ticketNo),
        serverId: "1",
        type: "text",
        name: g.channelName!,
        parentId: g.parentId!,
        overwrites: g.overwrites!,
    })
    const opened = async (category?: any, actor = requester) => {
        const c = category ?? (await configure()),
            d = await draft(c, actor),
            submitted = await read(await submit(d, actor)),
            g: TicketActionGrant = submitted.grant,
            channel = createdChannel(g)
        assert.equal((await read(await dispatch(g, actor))).claimed, true)
        const created = await read(await outcome(g, "succeeded", { channel, observedAt: now }))
        const intro: TicketActionGrant = created.grant
        assert(intro && !JSON.stringify(intro.content).includes("Synthetic private answer"))
        await read(await dispatch(intro, actor, channel))
        const final = await read(
            await outcome(intro, "succeeded", {
                messageId: String(++sequence),
                channelId: channel.channelId,
            }),
        )
        return {
            category: c,
            draft: d,
            channel,
            ticket: final.ticket,
            create: g,
            intro,
        }
    }
    const transition = async (
        type: "close" | "reopen",
        ticket: any,
        channel: TicketChannelSnapshot,
        actor = requester,
    ) => {
        const started = await read(
            await manage(
                {
                    type,
                    ticketNo: ticket.ticketNo,
                    expectedGeneration: ticket.generation,
                },
                actor,
                channel,
            ),
        )
        const first: TicketActionGrant = started.grant
        await read(await dispatch(first, actor, channel))
        const partial = await read(
            await outcome(first, "succeeded", {
                channel: first.desiredChannel,
                observedAt: now,
            }),
        )
        const second: TicketActionGrant = partial.grant
        await read(await dispatch(second, actor, first.desiredChannel))
        const final = await read(
            await outcome(second, "succeeded", {
                channel: second.desiredChannel,
                observedAt: now,
            }),
        )
        return {
            ticket: final.ticket,
            channel: second.desiredChannel!,
            first,
            second,
        }
    }
    const reconcile = (
        ticket: any,
        attempt: TicketActionGrant | undefined,
        channel: TicketChannelSnapshot | null,
        actor = requester,
    ) =>
        http("/tickets/reconcile", {
            ...source(),
            context: context(actor, channel ?? undefined),
            ticketNo: ticket.ticketNo,
            expectedGeneration: ticket.generation,
            ...(attempt ? { attemptId: attempt.attemptId } : {}),
            observation: {
                observedAt: now,
                channelId: ticket.channelId,
                channelAbsent: channel === null,
                ...(channel ? { channel } : {}),
            },
        })
    const table = (name: any) => t.run((c) => c.db.query(name).collect())
    const dueAt = async (ticketNo: number) =>
        (await table("tickets")).find((row: any) => row.ticketNo === ticketNo)?.transcriptDueAt as number | undefined
    // One chunk the bot's ticket worker appends, oldest first after the source's cursor
    const append = async (
        ticket: any,
        channel: TicketChannelSnapshot,
        messages: any[],
        after: string | null = null,
        source: { id: string; thread?: string } = { id: channel.channelId },
    ) =>
        http("/tickets/transcript-append", {
            serverId: "1",
            ticketNo: ticket.ticketNo,
            dueAt: (await dueAt(ticket.ticketNo)) ?? now,
            botId: "999",
            channel,
            source,
            after,
            messages,
        })
    const transcriptDone = async (ticketNo: number, outcome = "saved", at?: number) =>
        http("/tickets/transcript-done", {
            serverId: "1",
            ticketNo,
            dueAt: at ?? (await dueAt(ticketNo)) ?? 0,
            outcome,
        })
    const work = (operation: any) => http("/tickets/work", { serverId: "1", operation })
    const cleanup = () =>
        t.run(async (c) => {
            await cleanupTickets(c, now)
            await scheduleTicketPurges(c, now)
        })
    return {
        t,
        source,
        context,
        http,
        manage,
        query,
        intake,
        configure,
        draft,
        submit,
        binding,
        dispatch,
        outcome,
        createdChannel,
        opened,
        transition,
        reconcile,
        append,
        transcriptDone,
        work,
        dueAt,
        cleanup,
        table,
        drain: () => drainScheduled!(),
        advance: (ms: number) => {
            now += ms
        },
        now: () => now,
        botPosting: (value: string | undefined) => {
            botPosting = value
        },
    }
}

const transcriptMessage = (messageId: string, content = "Synthetic transcript text", extra = {}) => ({
    messageId,
    authorId: "20",
    authorName: "Synthetic member",
    createdAt: epoch,
    content,
    ...extra,
})
// Transcripts saved by the captures before automatic transcripts, each with two pages
async function seedTranscripts(f: ReturnType<typeof fixture>, ticketNo: number, count: number) {
    await f.t.run(async (c) => {
        for (let i = 0; i < count; i++) {
            const transcriptNo = 5000 + i
            await c.db.insert("ticketTranscripts", {
                serverId: "1",
                ticketNo,
                sourceId: String(7000 + i),
                actorId: "20",
                transcriptNo,
                channelId: String(300 + ticketNo),
                capturedAt: f.now(),
                messageCount: 1,
                truncated: false,
                pages: 2,
                createdAt: f.now(),
            })
            for (const pageNo of [1, 2])
                await c.db.insert("ticketTranscriptPages", {
                    serverId: "1",
                    ticketNo,
                    transcriptNo,
                    pageNo,
                    text: "Synthetic earlier capture",
                })
        }
    })
}

test("Ticket HTTP authenticates before parsing, binds server and starts disabled", async (test) => {
    const f = fixture(test)
    for (const route of [
        "manage",
        "query",
        "intake",
        "dispatch",
        "outcome",
        "reconcile",
        "transcript-append",
        "transcript-done",
        "work",
    ]) {
        await status(await f.http("/tickets/" + route, "Synthetic malformed body", false), 401)
        await status(await f.http("/tickets/" + route, { serverId: "2" }), 403)
    }
    assert.deepEqual((await read(await f.query({ type: "settings" }, owner))).settings, {
        enabled: false,
        retentionDays: 30,
    })
    await status(await f.query({ type: "settings" }), 403)
    await status(
        await f.http("/tickets/query", {
            serverId: "1",
            data: "x".repeat(262145),
        }),
        413,
    )
    await status(await f.manage({ type: "settings", enabled: true }, requester), 403)
    await status(
        await f.intake({
            type: "open",
            categoryName: "support",
            expectedCategoryRevision: 1,
        }),
        403,
    )
})

test("Public category and DM intake projections omit the canned library and immutable submitted ACL survives changes", async (test) => {
    const f = fixture(test),
        category = await f.configure("public")
    const s = f.source()
    await read(
        await f.http("/publishing/manage", {
            ...s,
            actor: owner,
            operation: {
                type: "draft-create",
                kind: "template",
                name: "answer",
            },
        }),
    )
    await read(
        await f.http("/publishing/manage", {
            ...f.source(),
            actor: owner,
            operation: {
                type: "draft-update",
                kind: "template",
                name: "answer",
                expectedRevision: 1,
                edit: { type: "content", content: "Synthetic canned secret" },
            },
        }),
    )
    const withCanned = (
        await read(
            await f.manage({
                type: "canned-set",
                name: category.name,
                expectedRevision: category.revision,
                cannedName: "answer",
                templateName: "answer",
                expectedTemplateRevision: 2,
            }),
        )
    ).category
    const publicCategory = (await read(await f.query({ type: "category", name: "support" }))).category
    assert.deepEqual(Object.keys(publicCategory).sort(), ["description", "enabled", "name", "revision", "visibility"])
    const d = await f.draft(withCanned)
    assert.equal(d.category.cannedReplies, undefined)
    assert.equal(d.category.supportRoleIds[0], "40")
    const open = await f.opened(withCanned, { ...requester, userId: "22" })
    await read(
        await f.manage({
            type: "category-update",
            name: "support",
            expectedRevision: withCanned.revision,
            patch: { visibility: "private", supportRoleIds: ["41"] },
            roles: roleSnapshots,
        }),
    )
    const privateBody = await read(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, support, open.channel),
    )
    assert.deepEqual(privateBody.answers, ["Synthetic private answer"])
    await status(
        await f.query(
            { type: "private-intake", ticketNo: open.ticket.ticketNo },
            { ...support, roleIds: ["41"] },
            open.channel,
        ),
        403,
    )
    const canned = await read(
        await f.manage(
            {
                type: "canned-reply",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                cannedName: "answer",
            },
            support,
            open.channel,
        ),
    )
    assert.equal(canned.grant.content.content, "Synthetic canned secret")
    assert.equal(JSON.stringify(canned.ticket).includes("Synthetic canned secret"), false)
})

test("Intake is always DM-only and fences requester raw epoch, stale generation, category and audience", async (test) => {
    const f = fixture(test),
        c = await f.configure("public", ["Synthetic question"], "90")
    await status(
        await f.intake(
            {
                type: "open",
                categoryName: c.name,
                expectedCategoryRevision: c.revision,
            },
            { ...requester, privateChannelVerified: false },
        ),
        403,
    )
    const d = await f.draft(c)
    await status(
        await f.submit(d, {
            ...requester,
            joinedAt: "2023-11-14T22:13:20.000001Z",
        }),
        403,
    )
    await status(await f.submit({ ...d, generation: d.generation - 1 }), 409)
    await status(
        await f.submit({
            ...d,
            category: { ...d.category, visibility: "private" },
        }),
        409,
    )
    await status(await f.submit(d, requester, { parentVerified: false }), 403)
    await read(
        await f.manage({
            type: "category-update",
            name: c.name,
            expectedRevision: c.revision,
            patch: { description: "Changed synthetic description" },
        }),
    )
    await status(await f.submit(d), 409)
})

test("Ticket source receipts bind actor and duplicate intake never creates twice", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        s = f.source()
    const operation = {
        type: "open",
        categoryName: c.name,
        expectedCategoryRevision: c.revision,
    }
    const request = { ...s, context: f.context(), operation }
    assert.equal((await read(await f.http("/tickets/intake", request))).duplicate, false)
    assert.equal((await read(await f.http("/tickets/intake", request))).duplicate, true)
    await status(
        await f.http("/tickets/intake", {
            ...request,
            context: f.context({ ...requester, userId: "22" }),
        }),
        409,
    )
    const d = await f.draft(c)
    const submit = {
        ...f.source(),
        context: f.context(),
        operation: {
            type: "submit",
            intakeNo: d.intakeNo,
            expectedGeneration: d.generation,
            expectedCategoryRevision: c.revision,
            visibility: c.visibility,
        },
    }
    await read(await f.http("/tickets/intake", submit))
    assert.equal((await read(await f.http("/tickets/intake", submit))).duplicate, true)
    assert.equal((await f.table("tickets")).length, 1)
})

test("Open intake lookup binds no server and lists only the member's live drafts in scope", async (test) => {
    const f = fixture(test),
        c = await f.configure()
    const open = async () => read(await f.http("/service/ticket-intakes", { userId: "20" }))
    const d = await f.draft(c)
    await f.draft(c, support)
    // A draft another server kept, which single mode never serves
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...row } = (await ctx.db.query("ticketIntakes").first())!
        await ctx.db.insert("ticketIntakes", { ...row, serverId: "2", intakeNo: 99 })
    })
    assert.deepEqual(await open(), [{ serverId: "1", intakeNo: d.intakeNo }])
    await read(await f.intake({ type: "cancel", intakeNo: d.intakeNo, expectedGeneration: d.generation }))
    assert.deepEqual(await open(), [])
    await f.draft(c)
    f.advance(day)
    assert.deepEqual(await open(), [])
    await status(await f.http("/service/ticket-intakes", { userId: "20" }, false), 401)
    await status(await f.http("/service/ticket-intakes", { userId: "synthetic" }), 400)
})

test("One-time claim and no-dispatch failure preserve both controlled race orderings", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        d = await f.draft(c),
        submitted = await read(await f.submit(d)),
        g = submitted.grant
    const claims = await Promise.all([f.dispatch(g), f.dispatch(g)])
    assert.deepEqual((await Promise.all(claims.map(read))).map((r) => r.claimed).sort(), [false, true])
    await status(
        await f.http("/tickets/outcome", {
            ...f.binding(g),
            outcome: "failed",
            noDispatch: true,
        }),
        409,
    )
    await status(await f.outcome(g, "failed"), 409)
    await read(await f.outcome(g, "failed", { noDispatch: true }))
    assert.equal((await read(await f.dispatch(g))).claimed, false)
    const other = await read(
        await f.submit(await f.draft(c, { ...requester, userId: "22" }), {
            ...requester,
            userId: "22",
        }),
    )
    await read(
        await f.http("/tickets/outcome", {
            ...f.binding(other.grant),
            outcome: "failed",
            noDispatch: true,
        }),
    )
    assert.equal((await read(await f.dispatch(other.grant, { ...requester, userId: "22" }))).claimed, false)
    assert.equal(
        (await f.table("tickets")).every((r) => !r.nativeProtected && r.state === "failed"),
        true,
    )
})

test("Expired unclaimed creation releases native protection while claimed unknown creation cannot replay or retire", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        unclaimed = await read(await f.submit(await f.draft(c)))
    const other = { ...requester, userId: "22" },
        claimed = await read(await f.submit(await f.draft(c, other), other))
    await read(await f.dispatch(claimed.grant, other))
    f.advance(180000)
    assert.equal((await read(await f.dispatch(unclaimed.grant))).claimed, false)
    f.advance(10000)
    await f.cleanup()
    const rows = await f.table("tickets")
    assert.equal(rows.find((r) => r.ticketNo === unclaimed.ticket.ticketNo)!.state, "failed")
    const unknown = rows.find((r) => r.ticketNo === claimed.ticket.ticketNo)!
    assert.equal(unknown.state, "uncertain")
    assert.equal(unknown.nativeProtected, true)
    await status(
        await f.manage(
            {
                type: "close",
                ticketNo: unknown.ticketNo,
                expectedGeneration: unknown.generation,
            },
            other,
        ),
        409,
    )
    const late = await read(await f.outcome(claimed.grant, "uncertain", { channelId: "322" }))
    assert.equal(late.recorded, false)
    assert.equal(late.ticket.channelId, "322")
    assert.equal(late.ticket.currentAttempt.outcome, "uncertain")
    await status(await f.outcome(claimed.grant, "uncertain", { channelId: "323" }), 409)
})

test("Create claim rechecks parent, membership and module policy without extending grant", async (test) => {
    const f = fixture(test),
        c = await f.configure("private", [], "90"),
        submitted = await read(await f.submit(await f.draft(c))),
        g = submitted.grant
    await status(
        await f.dispatch(g, {
            ...requester,
            joinedAt: "2023-11-14T22:13:20.000001Z",
        }),
        409,
    )
    await status(
        await f.dispatch(g, requester, undefined, {
            context: { ...f.context(), parentVerified: false },
        }),
        409,
    )
    await read(await f.manage({ type: "settings", enabled: false }))
    await status(await f.dispatch(g), 403)
    assert.equal((await f.table("ticketAttempts"))[0]!.claimedAt, undefined)
})

test("Disclosed support ACL is distinct from moderation staff and private bodies require fresh native view and history", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    await read(
        await f.http("/moderation/manage", {
            ...f.source(),
            actor: ownerActor,
            operation: {
                type: "settings",
                patch: { staffRoleIds: { cases: ["41"] } },
            },
        }),
    )
    await status(
        await f.query(
            { type: "private-intake", ticketNo: open.ticket.ticketNo },
            { ...support, roleIds: ["41"] },
            open.channel,
        ),
        403,
    )
    await status(
        await f.query(
            { type: "private-intake", ticketNo: open.ticket.ticketNo },
            { ...support, canView: false },
            open.channel,
        ),
        403,
    )
    await status(
        await f.query(
            { type: "private-intake", ticketNo: open.ticket.ticketNo },
            { ...support, privateChannelVerified: false },
            open.channel,
        ),
        403,
    )
    await status(
        await f.query(
            { type: "transcripts", ticketNo: open.ticket.ticketNo },
            { ...support, canReadHistory: false },
            open.channel,
        ),
        403,
    )
    await status(
        await f.query({ type: "entries", ticketNo: open.ticket.ticketNo, kind: "note" }, requester, open.channel),
        403,
    )
    await read(
        await f.manage(
            {
                type: "note",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                content: "Synthetic staff note",
            },
            support,
            open.channel,
        ),
    )
    assert.equal(
        (
            await read(
                await f.query(
                    {
                        type: "entries",
                        ticketNo: open.ticket.ticketNo,
                        kind: "note",
                    },
                    support,
                    open.channel,
                ),
            )
        ).entries[0].content.content,
        "Synthetic staff note",
    )
    assert.equal(
        JSON.stringify(
            await read(
                await f.query({
                    type: "ticket",
                    ticketNo: open.ticket.ticketNo,
                }),
            ),
        ).includes("Synthetic staff note"),
        false,
    )
    const rejoined = { ...requester, joinedAt: "2023-11-15T22:13:20.000001Z" }
    assert.deepEqual(
        (await read(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, rejoined, open.channel)))
            .answers,
        ["Synthetic private answer"],
    )
})

test("Closing denies posting in threads for everyone and the requester and reopen restores the earlier thread bits", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        publicThreads = 1n << 35n,
        // The requester had an explicit thread allow before closing
        channel = {
            ...open.channel,
            overwrites: open.channel.overwrites.map((r) =>
                r.id === "20" ? { ...r, allow: (BigInt(r.allow) | publicThreads).toString() } : r,
            ),
        }
    const closed = await f.transition("close", open.ticket, channel)
    assert.equal(closed.first.ownedPermissions, String(TICKET_CLOSE_PERMISSIONS))
    assert.equal(closed.second.ownedPermissions, String(TICKET_CLOSE_PERMISSIONS))
    for (const id of ["1", "20"]) {
        const row = closed.channel.overwrites.find((r) => r.id === id)!
        assert.equal(BigInt(row.deny) & TICKET_CLOSE_PERMISSIONS, TICKET_CLOSE_PERMISSIONS)
        assert.equal(BigInt(row.allow) & TICKET_CLOSE_PERMISSIONS, 0n)
    }
    const reopened = await f.transition("reopen", closed.ticket, closed.channel)
    assert.deepEqual(reopened.channel.overwrites, channel.overwrites)
    assert.equal((await f.table("tickets"))[0]!.ownedPermissions, undefined)
    // A thread grant for anyone else would defeat closing, so a new close refuses it
    await status(
        await f.manage(
            { type: "close", ticketNo: reopened.ticket.ticketNo, expectedGeneration: reopened.ticket.generation },
            requester,
            {
                ...reopened.channel,
                overwrites: [
                    ...reopened.channel.overwrites,
                    { id: "41", type: "role" as const, allow: String(publicThreads), deny: "0" },
                ],
            },
        ),
        409,
    )
    // A bot holding only some thread permissions owns only those, since it could not restore the others on reopen
    f.botPosting(String(2048n | (1n << 38n)))
    const partial = await f.transition("close", reopened.ticket, reopened.channel)
    assert.equal(partial.first.ownedPermissions, String(2048n | (1n << 38n)))
    const everyone = partial.channel.overwrites.find((r) => r.id === "1")!
    assert.equal(BigInt(everyone.deny) & TICKET_CLOSE_PERMISSIONS, 2048n | (1n << 38n))
})

test("A settled attempt that is still the current one expires with the others", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    await f.transition("close", open.ticket, open.channel)
    assert((await f.table("ticketAttempts")).length > 0)
    f.advance(31 * day)
    await f.cleanup()
    await f.drain()
    assert.deepEqual(await f.table("ticketAttempts"), [])
    assert.equal((await f.table("tickets"))[0]!.currentAttemptId, undefined)
})

test("A close owning SendMessages only reopens it alone and keeps later thread changes", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    // A bot holding no thread permission owns SendMessages only
    f.botPosting("2048")
    const closed = await f.transition("close", open.ticket, open.channel)
    assert.equal(closed.first.ownedPermissions, "2048")
    // Staff later stop everyone from starting public threads, which reopening must keep
    const changed = {
        ...closed.channel,
        overwrites: closed.channel.overwrites.map((r) =>
            r.id === "1" ? { ...r, deny: String(BigInt(r.deny) | (1n << 35n)) } : r,
        ),
    }
    const reopened = await f.transition("reopen", closed.ticket, changed)
    assert.equal(reopened.first.ownedPermissions, "2048")
    const everyone = reopened.channel.overwrites.find((r) => r.id === "1")!,
        original = open.channel.overwrites.find((r) => r.id === "1")!
    assert.equal(BigInt(everyone.deny) & (1n << 35n), 1n << 35n)
    assert.equal(BigInt(everyone.deny) & 2048n, BigInt(original.deny) & 2048n)
})

test("Close and reopen own only posting bits and resume a proven partial step without replacing baseline", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        channel = {
            ...open.channel,
            overwrites: open.channel.overwrites.map((r) =>
                r.id === "20" ? { ...r, allow: (BigInt(r.allow) | 256n).toString() } : r,
            ),
        }
    const started = await read(
            await f.manage(
                {
                    type: "close",
                    ticketNo: open.ticket.ticketNo,
                    expectedGeneration: open.ticket.generation,
                },
                requester,
                channel,
            ),
        ),
        first: TicketActionGrant = started.grant
    assert.equal(first.action, "close-everyone")
    await read(await f.dispatch(first, requester, channel))
    await read(await f.outcome(first, "uncertain"))
    const uncertain = (await read(await f.query({ type: "ticket", ticketNo: open.ticket.ticketNo }))).ticket
    const reconciled = await read(await f.reconcile(uncertain, first, first.desiredChannel!))
    assert.equal(reconciled.ticket.completedSteps, 1)
    const resumed = await read(
        await f.manage(
            {
                type: "close",
                ticketNo: uncertain.ticketNo,
                expectedGeneration: uncertain.generation,
            },
            support,
            first.desiredChannel,
        ),
    )
    const second: TicketActionGrant = resumed.grant
    assert.equal(second.action, "close-requester")
    await read(await f.dispatch(second, support, first.desiredChannel))
    const closed = await read(
        await f.outcome(second, "succeeded", {
            channel: second.desiredChannel,
            observedAt: f.now(),
        }),
    )
    assert.equal(closed.ticket.state, "closed")
    const reopened = await f.transition("reopen", closed.ticket, second.desiredChannel!, support)
    assert.equal(reopened.first.action, "reopen-requester")
    assert.equal(reopened.second.action, "reopen-everyone")
    assert.deepEqual(reopened.channel.overwrites, channel.overwrites)
    assert.equal(reopened.ticket.bodyExpiresAt, undefined)
})

test("Private audience and nonstaff send changes are native ownership conflicts while rename and move are not", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    for (const changed of [
        {
            ...open.channel,
            overwrites: [...open.channel.overwrites, { id: "41", type: "role" as const, allow: "2048", deny: "0" }],
        },
        {
            ...open.channel,
            overwrites: [...open.channel.overwrites, { id: "41", type: "role" as const, allow: "1024", deny: "0" }],
        },
    ])
        await status(
            await f.manage(
                {
                    type: "close",
                    ticketNo: open.ticket.ticketNo,
                    expectedGeneration: open.ticket.generation,
                },
                requester,
                changed,
            ),
            409,
        )
    const inaccessible = { ...owner, canView: false, canReadHistory: false }
    assert.equal(
        (await read(await f.query({ type: "ticket", ticketNo: open.ticket.ticketNo }, inaccessible))).ticket.channelId,
        open.channel.channelId,
    )
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                confirm: true,
            },
            inaccessible,
        ),
    )
    assert.equal(
        (
            await read(
                await f.query({
                    type: "ticket",
                    ticketNo: open.ticket.ticketNo,
                }),
            )
        ).ticket.erased,
        true,
    )
    const moved = { ...open.channel, name: "renamed-by-staff", parentId: "90" }
    const close = await read(
        await f.manage(
            { type: "close", ticketNo: open.ticket.ticketNo, expectedGeneration: open.ticket.generation },
            requester,
            moved,
        ),
    )
    assert.equal(close.grant.action, "close-everyone")
})

test("Logical closed-body expiry rejects reopen before cleanup while status and staff close/delete recovery survive disable", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    await read(await f.manage({ type: "settings", retentionDays: 1 }))
    const closed = await f.transition("close", open.ticket, open.channel)
    f.advance(day)
    assert.deepEqual(
        (
            await read(
                await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, requester, closed.channel),
            )
        ).answers,
        [],
    )
    await status(
        await f.manage(
            {
                type: "reopen",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: closed.ticket.generation,
            },
            requester,
            closed.channel,
        ),
        409,
    )
    await read(await f.manage({ type: "settings", enabled: false }))
    const deletion = await read(
        await f.manage(
            {
                type: "delete",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: closed.ticket.generation,
                confirm: true,
            },
            owner,
            closed.channel,
        ),
    )
    assert.equal(deletion.grant.action, "delete")
    await read(await f.dispatch(deletion.grant, owner, closed.channel))
    await f.cleanup()
    await f.drain()
    assert.equal((await f.table("tickets"))[0]!.erased, true)
    assert.equal((await f.table("tickets"))[0]!.nativeProtected, true)
})

test("DEFCON treats disclosed support separately and retains critical owner diagnostics and erasure", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    const defcon = (level: number) =>
        f.http("/moderation/manage", {
            ...f.source(),
            actor: ownerActor,
            operation: { type: "settings", patch: { defcon: level } },
        })
    await read(await defcon(2))
    await read(
        await f.manage(
            {
                type: "priority",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                priority: "high",
            },
            support,
            open.channel,
        ),
    )
    await status(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, requester, open.channel),
        403,
    )
    await read(await defcon(1))
    await status(
        await f.manage(
            {
                type: "priority",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                priority: "urgent",
            },
            support,
            open.channel,
        ),
        403,
    )
    await read(await f.query({ type: "settings" }, owner))
    await read(await f.manage({ type: "settings", enabled: false }))
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                confirm: true,
            },
            { ...owner, canView: false },
        ),
    )
})

test("Erasure hides submitted intake immediately, removes every retained narrative copy and late reply outcomes cannot restore text", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    await read(
        await f.manage(
            { type: "transcript-capture", ticketNo: open.ticket.ticketNo, expectedGeneration: open.ticket.generation },
            requester,
            open.channel,
        ),
    )
    await read(await f.append(open.ticket, open.channel, [transcriptMessage("8500", "Synthetic transcript erased")]))
    for (let i = 0; i < 35; i++)
        await read(
            await f.manage(
                {
                    type: "note",
                    ticketNo: open.ticket.ticketNo,
                    expectedGeneration: open.ticket.generation,
                    content: "Synthetic note " + i,
                },
                support,
                open.channel,
            ),
        )
    const reply = await read(
        await f.manage(
            {
                type: "reply",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                content: { content: "Synthetic dispatched reply" },
            },
            support,
            open.channel,
        ),
    )
    await read(await f.dispatch(reply.grant, support, open.channel))
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: reply.ticket.ticketNo,
                expectedGeneration: reply.ticket.generation,
                confirm: true,
            },
            owner,
        ),
    )
    assert.deepEqual(
        (
            await read(
                await f.query({
                    type: "intake",
                    intakeNo: open.draft.intakeNo,
                }),
            )
        ).intake.answers,
        [],
    )
    await f.drain()
    await read(
        await f.outcome(reply.grant, "succeeded", {
            messageId: "9000",
            channelId: open.channel.channelId,
        }),
    )
    const tickets = await f.table("tickets"),
        intakes = await f.table("ticketIntakes"),
        entries = await f.table("ticketEntries"),
        attempts = await f.table("ticketAttempts")
    assert.deepEqual(tickets[0]!.answers, [])
    assert.equal(tickets[0]!.category.description, "")
    assert.deepEqual(tickets[0]!.category.cannedReplies, [])
    assert.deepEqual(intakes[0]!.answers, [])
    assert.equal(intakes[0]!.category.description, "")
    assert(entries.every((r) => r.erased && r.content === undefined))
    assert(attempts.every((r) => r.redacted && r.grant?.content === undefined))
    assert.equal((await f.table("ticketTranscripts"))[0]!.pages, undefined)
    assert.equal((await f.table("ticketTranscriptCursors")).length, 0)
    assert.equal(tickets[0]!.transcriptDueAt, undefined)
    assert.equal(tickets[0]!.nativeProtected, true)
    assert.equal((await f.table("ticketRoleProtections"))[0]!.privateBodyRefs, 0)
})

test("Deletion needs acknowledged same-operation delete and fresh absence before retained-body fallback", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        closed = await f.transition("close", open.ticket, open.channel)
    await read(await f.transcriptDone(closed.ticket.ticketNo))
    await status(
        await f.manage(
            {
                type: "delete",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: closed.ticket.generation,
                confirm: true,
            },
            support,
            closed.channel,
        ),
        403,
    )
    const deleting = await read(
            await f.manage(
                {
                    type: "delete",
                    ticketNo: closed.ticket.ticketNo,
                    expectedGeneration: closed.ticket.generation,
                    confirm: true,
                },
                owner,
                closed.channel,
            ),
        ),
        g = deleting.grant
    await read(await f.dispatch(g, owner, closed.channel))
    await status(
        await f.outcome(g, "succeeded", {
            channelId: closed.channel.channelId,
            channelAbsent: true,
            observedAt: f.now(),
        }),
        409,
    )
    const uncertain = await read(
        await f.outcome(g, "uncertain", {
            channelId: closed.channel.channelId,
            nativeDeleteConfirmed: true,
        }),
    )
    assert.equal(uncertain.ticket.currentAttempt.nativeDeleteConfirmed, true)
    await status(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...requester, canView: false }),
        403,
    )
    const bodyExpiry = (await f.table("tickets"))[0]!.bodyExpiresAt
    assert(bodyExpiry !== undefined)
    f.advance(60000)
    const retired = await read(await f.reconcile(uncertain.ticket, g, null, owner))
    assert.equal(retired.ticket.state, "retired")
    // Retirement keeps the expiry the close already set
    assert.equal((await f.table("tickets"))[0]!.bodyExpiresAt, bodyExpiry)
    assert.equal((await f.table("tickets"))[0]!.nativeProtected, false)
    assert.equal((await f.table("ticketRoleProtections"))[0]!.privateBodyRefs, 1)
    assert.deepEqual(
        (
            await read(
                await f.query(
                    { type: "private-intake", ticketNo: open.ticket.ticketNo },
                    { ...requester, canView: false, canReadHistory: false },
                ),
            )
        ).answers,
        ["Synthetic private answer"],
    )
    await status(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...support, roleIds: [] }),
        403,
    )
})

const unsettledClose = async (f: ReturnType<typeof fixture>) => {
    const open = await f.opened()
    const started = await read(
            await f.manage(
                { type: "close", ticketNo: open.ticket.ticketNo, expectedGeneration: open.ticket.generation },
                requester,
                open.channel,
            ),
        ),
        first: TicketActionGrant = started.grant
    await read(await f.dispatch(first, requester, open.channel))
    await read(await f.outcome(first, "uncertain"))
    const uncertain = (await read(await f.query({ type: "ticket", ticketNo: open.ticket.ticketNo }))).ticket
    assert.equal(uncertain.state, "uncertain")
    return { first, uncertain }
}
test("A close seen in its before state leaves the ticket open, ready for a new close", async (test) => {
    const f = fixture(test),
        { first, uncertain } = await unsettledClose(f)
    const reconciled = await read(await f.reconcile(uncertain, first, first.expectedChannel!))
    assert.equal(reconciled.recorded, true)
    assert.equal(reconciled.ticket.state, "open")
    const retried = await read(
        await f.manage(
            { type: "close", ticketNo: uncertain.ticketNo, expectedGeneration: reconciled.ticket.generation },
            requester,
            first.expectedChannel,
        ),
    )
    assert.equal(retried.grant.action, "close-everyone")
})

test("A failed reopen that is reconciled and erased leaves a closed ticket that can be deleted", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        closed = await f.transition("close", open.ticket, open.channel)
    const started = await read(
            await f.manage(
                { type: "reopen", ticketNo: closed.ticket.ticketNo, expectedGeneration: closed.ticket.generation },
                requester,
                closed.channel,
            ),
        ),
        first: TicketActionGrant = started.grant
    await read(await f.dispatch(first, requester, closed.channel))
    await read(await f.outcome(first, "uncertain"))
    const uncertain = (await read(await f.query({ type: "ticket", ticketNo: closed.ticket.ticketNo }))).ticket
    const reconciled = await read(await f.reconcile(uncertain, first, first.expectedChannel!))
    assert.equal(reconciled.ticket.state, "closed")
    assert.equal((await f.table("tickets"))[0]!.active, false)
    // The slot reserved when the reopen began is freed and the bodies get their expiry back
    assert.equal((await f.table("ticketSettings"))[0]!.activeTickets, 0)
    assert((await f.table("tickets"))[0]!.bodyExpiresAt !== undefined)
    const erased = await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: reconciled.ticket.generation,
                confirm: true,
            },
            owner,
            closed.channel,
        ),
    )
    const deleting = await read(
        await f.manage(
            {
                type: "delete",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: erased.ticket.generation,
                confirm: true,
            },
            owner,
            closed.channel,
        ),
    )
    assert.equal(deleting.grant.action, "delete")
})

test("An open ticket whose channel was deleted by hand is retired and frees its slot", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    assert.equal((await f.table("tickets"))[0]!.active, true)
    const gone = await read(await f.reconcile(open.ticket, open.intro, null))
    assert.equal(gone.recorded, true)
    assert.equal(gone.ticket.state, "retired")
    assert.equal((await f.table("tickets"))[0]!.active, false)
    // Its stored bodies start the configured retention instead of staying for good
    assert((await f.table("tickets"))[0]!.bodyExpiresAt !== undefined)
})

test("A ticket whose last action retention removed still retires once its channel is confirmed gone", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    f.advance(31 * day)
    await f.cleanup()
    await f.drain()
    const aged = (await read(await f.query({ type: "ticket", ticketNo: open.ticket.ticketNo }))).ticket
    assert.equal(aged.currentAttempt, undefined)
    // With the channel still there there is nothing to settle
    await status(await f.reconcile(aged, undefined, open.channel), 409)
    const gone = await read(await f.reconcile(aged, undefined, null))
    assert.equal(gone.ticket.state, "retired")
    assert.equal((await f.table("tickets"))[0]!.active, false)
})

test("A channel confirmed gone settles an attempt that an earlier reconcile already settled", async (test) => {
    const f = fixture(test),
        { first, uncertain } = await unsettledClose(f)
    const before = await read(await f.reconcile(uncertain, first, first.expectedChannel!))
    assert.equal(before.ticket.state, "open")
    const gone = await read(await f.reconcile(before.ticket, first, null))
    assert.equal(gone.ticket.state, "retired")
})

test("A close left unconfirmed retires the ticket once its channel is gone", async (test) => {
    const f = fixture(test),
        { first, uncertain } = await unsettledClose(f)
    const reconciled = await read(await f.reconcile(uncertain, first, null))
    assert.equal(reconciled.recorded, true)
    assert.equal(reconciled.ticket.state, "retired")
    assert.equal((await f.table("tickets"))[0]!.active, false)
    // A ticket that is gone is no longer mid-close
    assert.equal(reconciled.ticket.transition, undefined)
    assert.equal((await f.table("tickets"))[0]!.transition, undefined)
})

test("A ticket whose last action failed before its claim retires once its channel is deleted by hand", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    const started = await read(
            await f.manage(
                { type: "close", ticketNo: open.ticket.ticketNo, expectedGeneration: open.ticket.generation },
                requester,
                open.channel,
            ),
        ),
        first: TicketActionGrant = started.grant
    await read(await f.http("/tickets/outcome", { ...f.binding(first), outcome: "failed", noDispatch: true }))
    const refused = (await read(await f.query({ type: "ticket", ticketNo: open.ticket.ticketNo }))).ticket
    // With the channel still there there is nothing to settle
    await status(await f.reconcile(refused, first, open.channel), 409)
    const gone = await read(await f.reconcile(refused, first, null))
    assert.equal(gone.recorded, true)
    assert.equal(gone.ticket.state, "retired")
    assert.equal((await f.table("tickets"))[0]!.active, false)
})

test("A ticket request still submits after its category's canned replies change", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        d = await f.draft(c)
    const publishing = (operation: any) => f.http("/publishing/manage", { ...f.source(), actor: owner, operation })
    await read(await publishing({ type: "draft-create", kind: "template", name: "answer" }))
    await read(
        await publishing({
            type: "draft-set",
            kind: "template",
            name: "answer",
            expectedRevision: 1,
            content: { content: "Synthetic canned text" },
        }),
    )
    const changed = (
        await read(
            await f.manage({
                type: "canned-set",
                name: c.name,
                expectedRevision: c.revision,
                cannedName: "answer",
                templateName: "answer",
                expectedTemplateRevision: 2,
            }),
        )
    ).category
    assert.notEqual(changed.revision, d.category.revision)
    const submitted = await f.submit(d)
    assert.equal(submitted.status, 200, JSON.stringify(await submitted.clone().json()))
})

test("Intake refusals say whether the category changed, is off, or the request is spent", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        d = await f.draft(c)
    const refusal = async (response: Response) => {
        const answer = (await response.json()) as { code?: string; error?: string }
        assert.equal(response.status, 409)
        assert.equal(answer.code, "REFUSED")
        return answer.error!
    }
    // The category was edited after the member answered, so submitting is refused for the category
    await read(
        await f.manage({
            type: "category-update",
            name: c.name,
            expectedRevision: c.revision,
            patch: { description: "Edited after the member started" },
        }),
    )
    assert.match(await refusal(await f.submit(d)), /category changed or was turned off/)
    // A request that was already cancelled is spent
    await read(await f.intake({ type: "cancel", intakeNo: d.intakeNo, expectedGeneration: d.generation }))
    assert.match(await refusal(await f.submit(d)), /expired or was already sent or cancelled/)
    // Opening on an off category is refused for the category
    const edited = (await read(await f.query({ type: "category", name: c.name }))).category
    await read(
        await f.manage({
            type: "category-update",
            name: c.name,
            expectedRevision: edited.revision,
            patch: { enabled: false },
        }),
    )
    assert.match(
        await refusal(
            await f.intake({ type: "open", categoryName: c.name, expectedCategoryRevision: edited.revision + 1 }),
        ),
        /category is off/,
    )
})

test("Submitting with the other audience word is refused for the word, not blamed on the category", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        d = await f.draft(c)
    const wrong = await f.intake({
        type: "submit",
        intakeNo: d.intakeNo,
        expectedGeneration: d.generation,
        expectedCategoryRevision: d.category.revision,
        visibility: d.category.visibility === "private" ? "public" : "private",
    })
    const answer = (await wrong.json()) as { code?: string; error?: string }
    assert.deepEqual([wrong.status, answer.code], [409, "REFUSED"])
    assert.match(
        answer.error!,
        new RegExp(`opens a (private|public) conversation. Send submit ${d.intakeNo} (private|public)$`),
    )
})

test("A creation that reconcile found present retires once its channel is deleted by hand", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        submitted = await read(await f.submit(await f.draft(c))),
        g = submitted.grant,
        channel = f.createdChannel(g)
    await read(await f.dispatch(g))
    const uncertain = await read(await f.outcome(g, "uncertain", { channelId: channel.channelId }))
    const seen = await read(await f.reconcile(uncertain.ticket, g, channel))
    assert.equal(seen.ticket.state, "open")
    const gone = await read(await f.reconcile(seen.ticket, g, null))
    assert.equal(gone.ticket.state, "retired")
})

test("Bare channel absence never retires unknown creation or grants private fallback", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        submitted = await read(await f.submit(await f.draft(c))),
        g = submitted.grant
    await read(await f.dispatch(g))
    const uncertain = await read(await f.outcome(g, "uncertain", { channelId: "301" }))
    assert.equal((await read(await f.reconcile(uncertain.ticket, g, null))).recorded, false)
    await status(await f.reconcile(uncertain.ticket, undefined, null), 409)
    await status(
        await f.query(
            { type: "private-intake", ticketNo: submitted.ticket.ticketNo },
            { ...requester, canView: false },
        ),
        403,
    )
    assert.equal((await f.table("tickets"))[0]!.nativeProtected, true)
})

test("A close sets the automatic transcript due, and appends bring it up to date from each source's cursor once", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    await read(
        await f.manage(
            {
                type: "note",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                content: "Synthetic note excluded",
            },
            support,
            open.channel,
        ),
    )
    // Nothing is due before the close, so an append is refused
    await status(await f.append(open.ticket, open.channel, [transcriptMessage("8000")]), 409)
    const closed = await f.transition("close", open.ticket, open.channel)
    const due = await f.dueAt(closed.ticket.ticketNo)
    assert.equal(due, f.now())
    assert.deepEqual((await read(await f.work({ type: "due" }))).tickets, [
        { ticketNo: closed.ticket.ticketNo, dueAt: due, channelId: closed.channel.channelId, botId: "999" },
    ])
    assert.deepEqual(closed.ticket.transcript, { state: "saving", messageCount: 0 })
    const first = [
        transcriptMessage("8000", "Synthetic channel message 🦊", {
            attachments: [{ filename: "synthetic.png", size: 48211, url: "https://example.invalid/synthetic.png" }],
            embeds: ["Synthetic embed title. Synthetic field: value"],
            stickers: ["Synthetic sticker"],
        }),
        transcriptMessage("8001", "x".repeat(8000)),
    ]
    await status(await f.append(closed.ticket, closed.channel, [transcriptMessage("8000", "x".repeat(8001))]), 400)
    await status(await f.append(closed.ticket, closed.channel, [...first].reverse()), 400)
    const appended = await read(await f.append(closed.ticket, closed.channel, first))
    assert.equal(appended.duplicate, false)
    // The same chunk again is stored once, and a chunk that skips past the cursor is a conflict
    assert.deepEqual(await read(await f.append(closed.ticket, closed.channel, first)), {
        duplicate: true,
        transcriptNo: appended.transcriptNo,
    })
    await status(await f.append(closed.ticket, closed.channel, [transcriptMessage("8100")], "8050"), 409)
    // 600 messages more in six appends, past the old 500-message and 200,000-character bounds
    let after = "8001"
    for (let chunk = 0; chunk < 6; chunk++) {
        const messages = Array.from({ length: 100 }, (_, i) =>
            transcriptMessage(String(9000 + chunk * 100 + i), "y".repeat(400)),
        )
        await read(await f.append(closed.ticket, closed.channel, messages, after))
        after = messages.at(-1)!.messageId
    }
    await read(
        await f.append(closed.ticket, closed.channel, [transcriptMessage("8601", "Synthetic thread text")], null, {
            id: "8600",
            thread: "Synthetic thread",
        }),
    )
    assert.deepEqual(
        (await read(await f.work({ type: "cursor", ticketNo: closed.ticket.ticketNo, sourceId: "8600" })))
            .lastMessageId,
        "8601",
    )
    // A done for an earlier due time changes nothing, and the current one settles the save
    assert.equal((await read(await f.transcriptDone(closed.ticket.ticketNo, "saved", due! - 1))).recorded, false)
    assert.equal((await read(await f.transcriptDone(closed.ticket.ticketNo))).recorded, true)
    assert.equal(await f.dueAt(closed.ticket.ticketNo), undefined)
    const listed = (
        await read(await f.query({ type: "transcripts", ticketNo: closed.ticket.ticketNo }, requester, closed.channel))
    ).transcripts
    assert.equal(listed.length, 1)
    assert.equal(listed[0].automatic, true)
    assert.equal(listed[0].messageCount, 603)
    assert.equal(listed[0].truncated, false)
    assert.deepEqual(
        (await read(await f.query({ type: "ticket", ticketNo: closed.ticket.ticketNo }))).ticket.transcript,
        { state: "saved", messageCount: 603 },
    )
    let text = ""
    for (let from: number | undefined = 1; from !== undefined;) {
        const pages: any = await read(
            await f.query(
                {
                    type: "transcript-pages",
                    ticketNo: closed.ticket.ticketNo,
                    transcriptNo: appended.transcriptNo,
                    fromPage: from,
                },
                requester,
                closed.channel,
            ),
        )
        text += pages.texts.join("")
        from = pages.nextPage
    }
    const lines = text.split("\n")
    assert.equal(lines[0], `[${epoch}] Synthetic member (20) (8000): Synthetic channel message 🦊`)
    assert.deepEqual(lines.slice(1, 4), [
        "  Attachment: synthetic.png (48211 bytes) https://example.invalid/synthetic.png",
        "  Embed: Synthetic embed title. Synthetic field: value",
        "  Sticker: Synthetic sticker",
    ])
    assert(lines[4]!.endsWith("x".repeat(8000)))
    assert.equal(
        lines.at(-1),
        `[${epoch}] [thread Synthetic thread] Synthetic member (20) (8601): Synthetic thread text`,
    )
    assert.equal(lines.length, 4 + 1 + 600 + 1)
    assert(!text.includes("Synthetic note excluded") && !text.includes("Synthetic private answer"))
    // Closing again after a reopen appends only what is new
    const reopened = await f.transition("reopen", closed.ticket, closed.channel)
    const again = await f.transition("close", reopened.ticket, reopened.channel)
    await read(await f.append(again.ticket, again.channel, [transcriptMessage("9700")], after))
    await read(await f.transcriptDone(again.ticket.ticketNo))
    assert.equal((await f.table("ticketTranscripts")).length, 1)
    assert.equal((await f.table("ticketTranscripts"))[0]!.messageCount, 604)
})

test("A failed save retries in 10 minutes and stops after 6, and a capture asks again", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        closed = await f.transition("close", open.ticket, open.channel)
    const ticketNo = closed.ticket.ticketNo
    for (let failure = 1; failure < 6; failure++) {
        const due = (await f.dueAt(ticketNo))!
        assert.equal((await read(await f.transcriptDone(ticketNo, "failed"))).recorded, true)
        assert.equal(await f.dueAt(ticketNo), f.now() + 600000)
        assert.equal(due <= f.now(), true)
        // A failed save waits for its retry time
        assert.deepEqual((await read(await f.work({ type: "due" }))).tickets, [])
        f.advance(600000)
    }
    await read(await f.transcriptDone(ticketNo, "failed"))
    assert.equal(await f.dueAt(ticketNo), undefined)
    assert.deepEqual((await read(await f.query({ type: "ticket", ticketNo }))).ticket.transcript, {
        state: "failed",
        messageCount: 0,
    })
    const captured = await read(
        await f.manage(
            { type: "transcript-capture", ticketNo, expectedGeneration: closed.ticket.generation },
            requester,
            closed.channel,
        ),
    )
    assert.deepEqual(captured.ticket.transcript, { state: "saving", messageCount: 0 })
    // A capture asked for during a save runs again, since the earlier save's done no longer matches
    const running = (await f.dueAt(ticketNo))!
    f.advance(1000)
    await read(
        await f.manage(
            { type: "transcript-capture", ticketNo, expectedGeneration: closed.ticket.generation },
            support,
            closed.channel,
        ),
    )
    assert.equal((await read(await f.transcriptDone(ticketNo, "saved", running))).recorded, false)
    assert.equal(await f.dueAt(ticketNo), f.now())
    // A requester without history access cannot ask for a capture
    await status(
        await f.manage(
            { type: "transcript-capture", ticketNo, expectedGeneration: closed.ticket.generation },
            { ...requester, canReadHistory: false },
            closed.channel,
        ),
        403,
    )
    // A gone channel settles the save without a failure
    assert.equal((await read(await f.transcriptDone(ticketNo, "absent"))).recorded, true)
    assert.equal((await f.table("tickets"))[0]!.transcriptFailed, undefined)
})

test("Deleting a closed ticket waits while its closing transcript is being saved", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        closed = await f.transition("close", open.ticket, open.channel)
    const deletion = {
        type: "delete",
        ticketNo: closed.ticket.ticketNo,
        expectedGeneration: closed.ticket.generation,
        confirm: true,
    }
    const refused = await f.manage(deletion, owner, closed.channel)
    assert.equal(refused.status, 409)
    assert.deepEqual(await refused.json(), {
        error: `The closing transcript of ticket #${closed.ticket.ticketNo} is still being saved. Try again once the ticket no longer shows its transcript as Saving`,
        code: "REFUSED",
    })
    await read(await f.transcriptDone(closed.ticket.ticketNo))
    assert.equal((await read(await f.manage(deletion, owner, closed.channel))).grant.action, "delete")
})

test("Transcript lists, pages and file reads read page rows, and erasure removes every transcript, page and cursor", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        closed = await f.transition("close", open.ticket, open.channel)
    let after: string | null = null
    for (let chunk = 0; chunk < 10; chunk++) {
        const messages = Array.from({ length: 100 }, (_, i) =>
            transcriptMessage(String(100000 + chunk * 100 + i), "y".repeat(360)),
        )
        await read(await f.append(closed.ticket, closed.channel, messages, after))
        after = messages.at(-1)!.messageId
    }
    await seedTranscripts(f, closed.ticket.ticketNo, 25)
    const measure = (operation: Record<string, unknown>) =>
        f.t.run(async (ctx) => {
            await ctx.runQuery(internal.tickets.query, {
                request: { serverId: "1", context: f.context(requester, closed.channel), operation },
            })
            const metrics = await ctx.meta.getTransactionMetrics()
            return { read: metrics.documentsRead.used, bytes: metrics.bytesRead.used }
        })
    const list = await measure({ type: "transcripts", ticketNo: closed.ticket.ticketNo })
    assert(list.bytes < 100000, `Listing read ${list.bytes} bytes`)
    const automatic = (await f.table("ticketTranscripts")).find((row: any) => row.automatic)!
    assert(automatic.pages! > 200)
    const last = await measure({
        type: "transcript",
        ticketNo: closed.ticket.ticketNo,
        transcriptNo: automatic.transcriptNo,
        page: automatic.pages,
    })
    assert(last.bytes < 50000, `Page read ${last.bytes} bytes`)
    const file = (fromPage: number) =>
        f.query(
            {
                type: "transcript-pages",
                ticketNo: closed.ticket.ticketNo,
                transcriptNo: automatic.transcriptNo,
                fromPage,
            },
            requester,
            closed.channel,
        )
    const batch = await read(await file(1))
    assert.equal(batch.texts.length, 100)
    assert.equal(batch.nextPage, 101)
    let pages = 0
    for (let from: number | undefined = 1; from !== undefined;) {
        const next: any = await read(await file(from))
        pages += next.texts.length
        from = next.nextPage
    }
    assert.equal(pages, automatic.pages)
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: closed.ticket.generation,
                confirm: true,
            },
            owner,
        ),
    )
    // Every transcript reads as erased at once, and each erase pass removes one bounded batch
    assert(
        (
            await read(
                await f.query({ type: "transcripts", ticketNo: closed.ticket.ticketNo }, requester, closed.channel),
            )
        ).transcripts.every((row: any) => row.erased),
    )
    await f.drain()
    assert((await f.table("ticketTranscripts")).every((row: any) => row.pages === undefined))
    assert.equal((await f.table("ticketTranscripts")).length, 26)
    assert.equal((await f.table("ticketTranscriptPages")).length, 0)
    assert.equal((await f.table("ticketTranscriptCursors")).length, 0)
    await status(await f.append(closed.ticket, closed.channel, [transcriptMessage("200000")], after), 409)
})

test("Role protection is bidirectional, survives category deletion and native retirement until body erasure", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        roleOperation = {
            type: "panel-create",
            name: "selfservice",
            kind: "reaction",
            mappings: [
                {
                    emoji: "✅",
                    roleId: "40",
                    prerequisiteRoleIds: [],
                    exclusionRoleIds: [],
                },
            ],
            roles: roleSnapshots,
        }
    await status(
        await f.http("/roles/manage", {
            ...f.source(),
            actor: ownerActor,
            operation: roleOperation,
        }),
        403,
    )
    await read(
        await f.manage({
            type: "category-delete",
            name: open.category.name,
            expectedRevision: open.category.revision,
        }),
    )
    const closed = await f.transition("close", open.ticket, open.channel)
    await read(await f.transcriptDone(closed.ticket.ticketNo))
    const deleting = await read(
        await f.manage(
            {
                type: "delete",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: closed.ticket.generation,
                confirm: true,
            },
            owner,
            closed.channel,
        ),
    )
    await read(await f.dispatch(deleting.grant, owner, closed.channel))
    const retired = await read(
        await f.outcome(deleting.grant, "succeeded", {
            channelId: closed.channel.channelId,
            nativeDeleteConfirmed: true,
            channelAbsent: true,
            observedAt: f.now(),
        }),
    )
    await status(
        await f.http("/roles/manage", {
            ...f.source(),
            actor: ownerActor,
            operation: roleOperation,
        }),
        403,
    )
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: retired.ticket.ticketNo,
                expectedGeneration: retired.ticket.generation,
                confirm: true,
            },
            owner,
        ),
    )
    await f.drain()
    assert.equal((await f.table("ticketRoleProtections")).length, 0)
    await read(
        await f.http("/roles/manage", {
            ...f.source(),
            actor: ownerActor,
            operation: roleOperation,
        }),
    )
    await status(
        await f.manage({
            type: "category-create",
            name: "blocked",
            visibility: "private",
            supportRoleIds: ["40"],
            roles: roleSnapshots,
        }),
        409,
    )
})

test("A category without support roles needs no role snapshots to be created or to drop its last support role", async (test) => {
    const f = fixture(test)
    await f.configure()
    const created = await read(
        await f.manage({ type: "category-create", name: "noroles", visibility: "private", supportRoleIds: [] }),
    )
    assert.deepEqual(created.category.supportRoleIds, [])
    const withRole = await read(
        await f.manage({
            type: "category-create",
            name: "staffed",
            visibility: "private",
            supportRoleIds: ["40"],
            roles: roleSnapshots,
        }),
    )
    const cleared = await read(
        await f.manage({
            type: "category-update",
            name: "staffed",
            expectedRevision: withRole.category.revision,
            patch: { supportRoleIds: [] },
        }),
    )
    assert.deepEqual(cleared.category.supportRoleIds, [])
})

test("Requester limit holds until owner abandonment or erasure releases an unknown creation", async (test) => {
    const f = fixture(test),
        c = await f.configure()
    const grants: TicketActionGrant[] = []
    for (let i = 0; i < 3; i++) grants.push((await read(await f.submit(await f.draft(c)))).grant)
    await status(await f.submit(await f.draft(c)), 429)
    assert.equal((await f.table("ticketRoleProtections"))[0]!.nativeOwnershipRefs, 3)
    for (const g of grants.slice(0, 2)) {
        await read(await f.dispatch(g))
        await read(await f.outcome(g, "uncertain"))
    }
    const target = (g: TicketActionGrant) => ({ ticketNo: g.ticketNo, expectedGeneration: g.generation })
    await status(await f.manage({ type: "abandon", ...target(grants[2]!) }), 409)
    await status(await f.manage({ type: "abandon", ...target(grants[0]!) }, requester), 403)
    const abandoned = await read(await f.manage({ type: "abandon", ...target(grants[0]!) }))
    assert.equal(abandoned.ticket.state, "uncertain")
    // The create may have succeeded with its response lost, so a late verified callback still binds the protected channel
    await read(await f.outcome(grants[0]!, "succeeded", { channel: f.createdChannel(grants[0]!), observedAt: f.now() }))
    await read(await f.manage({ type: "erase", ...target(grants[1]!), confirm: true }))
    await f.drain()
    const rows = await f.table("tickets")
    assert.deepEqual(
        rows.slice(0, 2).map((r) => [r.state, r.active, r.nativeProtected, r.channelId]),
        [
            ["uncertain", false, true, f.createdChannel(grants[0]!).channelId],
            ["uncertain", false, true, undefined],
        ],
    )
    assert.equal((await f.table("ticketRoleProtections"))[0]!.nativeOwnershipRefs, 3)
    await read(await f.submit(await f.draft(c)))
    await read(await f.submit(await f.draft(c)))
    await status(await f.submit(await f.draft(c)), 429)
})

test("Support discovery shows ten visible tickets a page and continues by ticket number", async (test) => {
    const f = fixture(test),
        c = await f.configure("private", [])
    for (let i = 0; i < 12; i++) {
        const actor = { ...requester, userId: String(100 + i) }
        await read(await f.submit(await f.draft(c, actor), actor))
    }
    const unrelated = { ...support, roleIds: [] },
        first = await read(await f.query({ type: "tickets" }, unrelated))
    assert.deepEqual(first.tickets, [])
    assert.equal(first.nextBeforeTicketNo, undefined)
    const all = await read(await f.query({ type: "tickets" }, support))
    assert.equal(all.tickets.length, 10)
    assert.equal(
        (await read(await f.query({ type: "tickets", beforeTicketNo: all.nextBeforeTicketNo }, support))).tickets
            .length,
        2,
    )
})

test("A requester's ticket is found among other requesters' tickets, also past two scans of 25", async (test) => {
    const f = fixture(test),
        c = await f.configure("private", [])
    await read(await f.submit(await f.draft(c)))
    for (let i = 0; i < 10; i++) {
        const actor = { ...requester, userId: String(100 + i) }
        await read(await f.submit(await f.draft(c, actor), actor))
    }
    const listed = await read(await f.query({ type: "tickets" }))
    assert.deepEqual([listed.tickets.length, listed.nextBeforeTicketNo], [1, undefined])
    for (let i = 10; i < 55; i++) {
        const actor = { ...requester, userId: String(100 + i) }
        await read(await f.submit(await f.draft(c, actor), actor))
    }
    // 55 newer tickets of others: the first two pages each look through 25 and find none, and the third finds it
    const first = await read(await f.query({ type: "tickets" }))
    assert.deepEqual([first.tickets, first.nextBeforeTicketNo], [[], 32])
    const second = await read(await f.query({ type: "tickets", beforeTicketNo: first.nextBeforeTicketNo }))
    assert.deepEqual([second.tickets, second.nextBeforeTicketNo], [[], 7])
    const third = await read(await f.query({ type: "tickets", beforeTicketNo: second.nextBeforeTicketNo }))
    assert.deepEqual([third.tickets.length, third.nextBeforeTicketNo], [1, undefined])
})

test("Thirty-day terminal purge removes erased proven-never-dispatched records and preserves unknown native ownership", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        submitted = await read(await f.submit(await f.draft(c))),
        g = submitted.grant
    await read(
        await f.http("/tickets/outcome", {
            ...f.binding(g),
            outcome: "failed",
            noDispatch: true,
        }),
    )
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: submitted.ticket.ticketNo,
                expectedGeneration: submitted.ticket.generation,
                confirm: true,
            },
            owner,
        ),
    )
    await f.drain()
    f.advance(30 * day)
    await f.cleanup()
    await f.drain()
    assert.equal((await f.table("tickets")).length, 0)
    const unknown = await read(
        await f.submit(await f.draft(c, { ...requester, userId: "22" }), {
            ...requester,
            userId: "22",
        }),
    )
    await read(await f.dispatch(unknown.grant, { ...requester, userId: "22" }))
    await read(await f.outcome(unknown.grant, "uncertain"))
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: unknown.ticket.ticketNo,
                expectedGeneration: unknown.ticket.generation,
                confirm: true,
            },
            owner,
        ),
    )
    await f.drain()
    f.advance(31 * day)
    await f.cleanup()
    await f.drain()
    assert.equal((await f.table("tickets")).length, 1)
    assert.equal((await f.table("tickets"))[0]!.nativeProtected, true)
})

test("Aged uncertain replies permit independent channel work and retain late exact message identity without changing newer generation", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    const reply = await read(
        await f.manage(
            {
                type: "reply",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                content: { content: "Synthetic uncertain reply" },
            },
            support,
            open.channel,
        ),
    )
    await read(await f.dispatch(reply.grant, support, open.channel))
    await status(
        await f.manage(
            {
                type: "close",
                ticketNo: reply.ticket.ticketNo,
                expectedGeneration: reply.ticket.generation,
            },
            support,
            open.channel,
        ),
        409,
    )
    f.advance(190000)
    await f.cleanup()
    const closed = await f.transition("close", reply.ticket, open.channel, support)
    const before = (await f.table("tickets"))[0]!
    const late = await read(
        await f.outcome(reply.grant, "succeeded", {
            messageId: "9001",
            channelId: open.channel.channelId,
        }),
    )
    assert.equal(late.recorded, false)
    assert.equal(late.ticket.generation, closed.ticket.generation)
    assert.equal(late.ticket.state, "closed")
    assert.equal((await f.table("tickets"))[0]!.currentAttemptId, before.currentAttemptId)
    const original = (
        await read(
            await f.query(
                {
                    type: "attempt",
                    ticketNo: open.ticket.ticketNo,
                    attemptNo: reply.grant.attemptNo,
                },
                support,
                closed.channel,
            ),
        )
    ).attempt
    assert.equal(original.outcome, "uncertain")
    assert.equal(original.messageId, "9001")
    await status(
        await f.outcome(reply.grant, "uncertain", {
            messageId: "9002",
            channelId: open.channel.channelId,
        }),
        409,
    )
})

test("Uncertain ephemeral current attempts expire after thirty days without releasing native or private access protection", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    const reply = await read(
        await f.manage(
            {
                type: "reply",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                content: { content: "Synthetic unknown ephemeral send" },
            },
            support,
            open.channel,
        ),
    )
    await read(await f.dispatch(reply.grant, support, open.channel))
    await read(await f.outcome(reply.grant, "uncertain"))
    const before = (await f.table("tickets"))[0]!
    f.advance(30 * day)
    await f.cleanup()
    await f.drain()
    const after = (await f.table("tickets"))[0]!
    assert.equal(after.currentAttemptId, undefined)
    assert.equal(after.generation, before.generation)
    assert.equal(after.nativeProtected, true)
    assert.equal(after.bodiesProtected, true)
    assert.deepEqual(after.channel, before.channel)
    await status(
        await f.query(
            {
                type: "attempt",
                ticketNo: after.ticketNo,
                attemptNo: reply.grant.attemptNo,
            },
            support,
            open.channel,
        ),
        404,
    )
    const second = await read(
        await f.manage(
            {
                type: "reply",
                ticketNo: after.ticketNo,
                expectedGeneration: after.generation,
                content: { content: "New explicit synthetic reply" },
            },
            support,
            open.channel,
        ),
    )
    assert.notEqual(second.grant.attemptId, reply.grant.attemptId)
})

test("Category configuration answers an administrator outside a DM, and requester timeout protection fences intake", async (test) => {
    const f = fixture(test),
        c = await f.configure()
    await read(await f.query({ type: "category-config", name: c.name }, { ...owner, privateChannelVerified: false }))
    await status(await f.query({ type: "category-config", name: c.name }, requester), 403)
    await status(
        await f.intake(
            {
                type: "open",
                categoryName: c.name,
                expectedCategoryRevision: c.revision,
            },
            {
                ...requester,
                timeoutUntil: new Date(f.now() + 10000).toISOString(),
            },
        ),
        403,
    )
})

test("Every category change works in a server channel for an administrator and is refused before its receipt for others", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        publicOwner = { ...owner, privateChannelVerified: false },
        member = { ...requester, privateChannelVerified: false }
    const operations = [
        {
            type: "category-create",
            name: "server",
            visibility: "private",
            supportRoleIds: ["40"],
            roles: roleSnapshots,
        },
        {
            type: "category-update",
            name: c.name,
            expectedRevision: c.revision,
            patch: { description: "Server configuration" },
        },
        { type: "category-delete", name: c.name, expectedRevision: c.revision },
    ]
    const before = (await f.table("ticketReceipts")).length
    for (const operation of operations) await status(await f.manage(operation, member), 403)
    assert.equal((await f.table("ticketReceipts")).length, before)
    await read(await f.manage(operations[0], publicOwner))
    const updated = (await read(await f.manage(operations[1], publicOwner))).category
    await read(await f.manage({ ...operations[2], expectedRevision: updated.revision }, publicOwner))
    assert.deepEqual(
        (await f.table("ticketCategories")).map((row: any) => row.config.name),
        ["server"],
    )
})

test("Uncertain introduction settles without blocking a fresh reply and second-step non-dispatch resumes original baseline", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        submitted = await read(await f.submit(await f.draft(c))),
        g = submitted.grant,
        channel = f.createdChannel(g)
    await read(await f.dispatch(g))
    const created = await read(await f.outcome(g, "succeeded", { channel, observedAt: f.now() }))
    await read(await f.dispatch(created.grant, requester, channel))
    await read(await f.outcome(created.grant, "uncertain"))
    const reply = await read(
        await f.manage(
            {
                type: "reply",
                ticketNo: created.ticket.ticketNo,
                expectedGeneration: created.ticket.generation,
                content: { content: "New explicit reply" },
            },
            support,
            channel,
        ),
    )
    await read(
        await f.http("/tickets/outcome", {
            ...f.binding(reply.grant),
            outcome: "failed",
            noDispatch: true,
        }),
    )
    const started = await read(
        await f.manage(
            {
                type: "close",
                ticketNo: reply.ticket.ticketNo,
                expectedGeneration: reply.ticket.generation,
            },
            support,
            channel,
        ),
    )
    await read(await f.dispatch(started.grant, support, channel))
    const partial = await read(
        await f.outcome(started.grant, "succeeded", {
            channel: started.grant.desiredChannel,
            observedAt: f.now(),
        }),
    )
    await read(
        await f.http("/tickets/outcome", {
            ...f.binding(partial.grant),
            outcome: "failed",
            noDispatch: true,
        }),
    )
    const saved = (await f.table("tickets"))[0]!
    assert.equal(saved.completedSteps, 1)
    const resumed = await read(
        await f.manage(
            {
                type: "close",
                ticketNo: partial.ticket.ticketNo,
                expectedGeneration: partial.ticket.generation,
            },
            support,
            started.grant.desiredChannel,
        ),
    )
    assert.equal(resumed.grant.action, "close-requester")
    assert.deepEqual((await f.table("tickets"))[0]!.baselineOverwrites, saved.baselineOverwrites)
    await read(await f.dispatch(resumed.grant, support, started.grant.desiredChannel))
    const closed = await read(
        await f.outcome(resumed.grant, "succeeded", {
            channel: resumed.grant.desiredChannel,
            observedAt: f.now(),
        }),
    )
    assert.equal(closed.ticket.state, "closed")
})

test("Erased retired purge removes all bounded child pages including unknown ephemeral send audits", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    let ticket = open.ticket
    for (let i = 0; i < 35; i++) {
        const reply = await read(
            await f.manage(
                {
                    type: "reply",
                    ticketNo: ticket.ticketNo,
                    expectedGeneration: ticket.generation,
                    content: { content: "Synthetic retained reply " + i },
                },
                support,
                open.channel,
            ),
        )
        await read(await f.dispatch(reply.grant, support, open.channel))
        ticket = (await read(await f.outcome(reply.grant, "uncertain"))).ticket
    }
    const closed = await f.transition("close", ticket, open.channel, support)
    // The closing transcript holds 25 appends, and 70 earlier captures outnumber what the other batches would carry, so
    // purge must go on while transcripts remain
    for (let i = 0; i < 25; i++)
        await read(
            await f.append(
                closed.ticket,
                closed.channel,
                [transcriptMessage(String(20000 + i), "Synthetic purged text")],
                i ? String(20000 + i - 1) : null,
            ),
        )
    await seedTranscripts(f, closed.ticket.ticketNo, 70)
    await read(await f.transcriptDone(closed.ticket.ticketNo))
    const deleting = await read(
        await f.manage(
            {
                type: "delete",
                ticketNo: closed.ticket.ticketNo,
                expectedGeneration: closed.ticket.generation,
                confirm: true,
            },
            owner,
            closed.channel,
        ),
    )
    await read(await f.dispatch(deleting.grant, owner, closed.channel))
    const retired = await read(
        await f.outcome(deleting.grant, "succeeded", {
            channelId: closed.channel.channelId,
            nativeDeleteConfirmed: true,
            channelAbsent: true,
            observedAt: f.now(),
        }),
    )
    await read(
        await f.manage(
            {
                type: "erase",
                ticketNo: retired.ticket.ticketNo,
                expectedGeneration: retired.ticket.generation,
                confirm: true,
            },
            owner,
        ),
    )
    await f.drain()
    assert((await f.table("ticketAttempts")).length > 32)
    f.advance(30 * day)
    await f.t.mutation(internal.ticketLifecycle.purge, {
        serverId: "1",
        ticketNo: ticket.ticketNo,
    })
    await f.drain()
    assert.equal((await f.table("tickets")).length, 0)
    assert.equal((await f.table("ticketEntries")).length, 0)
    assert.equal((await f.table("ticketAttempts")).length, 0)
    for (const name of ["ticketTranscripts", "ticketTranscriptPages", "ticketTranscriptCursors"])
        assert.equal((await f.table(name)).length, 0, name)
})

test("Staff escalate a help post into a ticket for its author, and staff run its creation", async (test) => {
    const f = fixture(test)
    const category = await f.configure()
    const escalate = (actor: TicketActor, extra = {}) =>
        f.manage(
            {
                type: "escalate",
                categoryName: category.name,
                requesterId: "20",
                requesterJoinedAt: epoch,
                postId: "700",
                ...extra,
            },
            actor,
        )
    // Only owners, administrators and the category's support roles may escalate
    await status(await escalate(requester), 403)
    await status(await escalate({ ...support, userId: "22", roleIds: ["41"] }), 403)
    await status(await escalate(support, { requesterJoinedAt: "yesterday" }), 400)
    await status(await escalate(support, { requesterId: "999" }), 403)
    const escalated = await read(await escalate(support))
    const g: TicketActionGrant = escalated.grant
    assert.deepEqual([g.action, g.actorId, g.requesterId, g.escalatedFrom], ["create", "21", "20", "700"])
    assert.equal(escalated.ticket.requesterJoinedAt, epoch)
    // Staff run the creation they started
    assert.equal((await read(await f.dispatch(g, support))).claimed, true)
    const channel = f.createdChannel(g)
    const created = await read(await f.outcome(g, "succeeded", { channel, observedAt: f.now() }))
    // The introduction links back to the post, and the ticket counts against the author's three active tickets
    assert.equal(created.grant.content.content.includes("<#700>"), true)
    assert.equal(created.ticket.requesterId, "20")
    await read(await escalate(support))
    await read(await escalate(support))
    await status(await escalate(support), 429)
})

test("An escalated ticket is not created once the staff member lost the support role", async (test) => {
    const f = fixture(test)
    const category = await f.configure()
    const g: TicketActionGrant = (
        await read(
            await f.manage(
                {
                    type: "escalate",
                    categoryName: category.name,
                    requesterId: "20",
                    requesterJoinedAt: epoch,
                    postId: "700",
                },
                support,
            ),
        )
    ).grant
    await status(await f.dispatch(g, { ...support, roleIds: [] }), 409)
})

// A channel only the ticket's support roles and the bot see, and a channel every member sees
const staffChannel: TicketChannelSnapshot = {
    channelId: "700",
    serverId: "1",
    type: "text",
    name: "staff",
    parentId: null,
    overwrites: [
        { id: "40", type: "role", allow: "1024", deny: "0" },
        { id: "1", type: "role", allow: "0", deny: "1024" },
    ],
}
const publicChannel: TicketChannelSnapshot = { ...staffChannel, channelId: "701", name: "general", overwrites: [] }

test("Private ticket text answers outside a DM only in a channel its audience allows", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        ticketNo = open.ticket.ticketNo
    const staff = { ...support, privateChannelVerified: false },
        member = { ...requester, privateChannelVerified: false }
    delete (staff as any).privateChannelId
    delete (member as any).privateChannelId
    const note = (destination?: TicketChannelSnapshot) =>
        f.manage(
            { type: "note", ticketNo, expectedGeneration: open.ticket.generation, content: "Synthetic staff note" },
            staff,
            open.channel,
            destination,
        )
    // The requester can read the ticket channel, so notes and intake answers never answer there
    await status(await note(), 403)
    await status(await note(open.channel), 403)
    await status(await note(publicChannel), 403)
    await read(await note(staffChannel))
    await status(await f.query({ type: "private-intake", ticketNo }, staff, open.channel, open.channel), 403)
    assert.deepEqual(
        (await read(await f.query({ type: "private-intake", ticketNo }, staff, open.channel, staffChannel))).answers,
        ["Synthetic private answer"],
    )
    await status(await f.query({ type: "entries", ticketNo, kind: "note" }, staff, open.channel, open.channel), 403)
    // Transcripts may answer where the requester reads, so the private ticket channel works and a public one does not
    await read(await f.query({ type: "transcripts", ticketNo }, member, open.channel, open.channel))
    await status(await f.query({ type: "transcripts", ticketNo }, member, open.channel, publicChannel), 403)
    // An attempt answers anywhere, without the text it posted outside a DM
    const reply = await read(
        await f.manage(
            {
                type: "reply",
                ticketNo,
                expectedGeneration: open.ticket.generation,
                content: { content: "Synthetic posted reply" },
            },
            support,
            open.channel,
        ),
    )
    const attempt = (actor: TicketActor) =>
        f.query({ type: "attempt", ticketNo, attemptNo: reply.grant.attemptNo }, actor, open.channel)
    assert.equal((await read(await attempt(staff))).attempt.content, undefined)
    assert.equal((await read(await attempt(support))).attempt.content.content, "Synthetic posted reply")
    // A list outside a DM leaves out the tickets whose readers do not cover the channel and says so
    const listed = (destination?: TicketChannelSnapshot) => f.query({ type: "tickets" }, staff, undefined, destination)
    await status(await listed(), 403)
    const inStaff = await read(await listed(staffChannel))
    assert.deepEqual(
        inStaff.tickets.map((row: any) => row.ticketNo),
        [ticketNo],
    )
    assert.equal(inStaff.hidden, undefined)
    const inPublic = await read(await listed(publicChannel))
    assert.deepEqual(inPublic.tickets, [])
    assert.equal(inPublic.hidden, true)
    // In a ticket's own channel the ticket is found by its channel
    assert.equal(
        (await read(await f.query({ type: "ticket", channelId: open.channel.channelId }, member))).ticket.ticketNo,
        ticketNo,
    )
    await status(await f.query({ type: "ticket", channelId: "799" }, member), 404)
})

test("A ticket keeps every staff note past the old 200 entries", async (test) => {
    const f = fixture(test),
        open = await f.opened()
    for (let i = 0; i < 201; i++)
        await read(
            await f.manage(
                {
                    type: "note",
                    ticketNo: open.ticket.ticketNo,
                    expectedGeneration: open.ticket.generation,
                    content: "Synthetic note " + i,
                },
                support,
                open.channel,
            ),
        )
    assert.equal((await f.table("ticketEntries")).length, 201)
    assert.equal((await read(await f.query({ type: "ticket", ticketNo: open.ticket.ticketNo }))).ticket.entryCount, 201)
})

test("A canned reply sends its template's latest text and the saved copy once the template is gone", async (test) => {
    const f = fixture(test),
        category = await f.configure()
    const publishing = (operation: any) => f.http("/publishing/manage", { ...f.source(), actor: owner, operation })
    await read(await publishing({ type: "draft-create", kind: "template", name: "answer" }))
    await read(
        await publishing({
            type: "draft-set",
            kind: "template",
            name: "answer",
            expectedRevision: 1,
            content: { content: "Synthetic first text" },
        }),
    )
    const withCanned = (
        await read(
            await f.manage({
                type: "canned-set",
                name: category.name,
                expectedRevision: category.revision,
                cannedName: "answer",
                templateName: "answer",
                expectedTemplateRevision: 2,
            }),
        )
    ).category
    const open = await f.opened(withCanned)
    let ticket = open.ticket
    const send = async () => {
        const result = await read(
            await f.manage(
                {
                    type: "canned-reply",
                    ticketNo: ticket.ticketNo,
                    expectedGeneration: ticket.generation,
                    cannedName: "answer",
                },
                support,
                open.channel,
            ),
        )
        await read(await f.dispatch(result.grant, support, open.channel))
        ticket = (
            await read(
                await f.outcome(result.grant, "succeeded", {
                    messageId: String(f.now()),
                    channelId: open.channel.channelId,
                }),
            )
        ).ticket
        f.advance(1)
        return result.grant.content.content
    }
    await read(
        await publishing({
            type: "draft-set",
            kind: "template",
            name: "answer",
            expectedRevision: 2,
            content: { content: "Synthetic edited text" },
        }),
    )
    assert.equal(await send(), "Synthetic edited text")
    await read(await publishing({ type: "draft-delete", kind: "template", name: "answer", expectedRevision: 3 }))
    assert.equal(await send(), "Synthetic first text")
})

test("One reaction panel per category: a new one replaces the old, and removal or category deletion forgets it", async (test) => {
    const f = fixture(test),
        category = await f.configure()
    const panel = (operation: any, actor = owner) => f.manage(operation, actor)
    await status(
        await panel({ type: "panel-save", categoryName: "support", channelId: "700", messageId: "800" }, requester),
        403,
    )
    await status(await panel({ type: "panel-save", categoryName: "missing", channelId: "700", messageId: "800" }), 404)
    const first = await read(
        await panel({ type: "panel-save", categoryName: "Support", channelId: "700", messageId: "800" }),
    )
    assert.equal(first.replaced, undefined)
    assert.deepEqual(
        { ...first.panel, createdAt: 0 },
        { categoryName: "support", channelId: "700", messageId: "800", createdAt: 0 },
    )
    const second = await read(
        await panel({ type: "panel-save", categoryName: "support", channelId: "701", messageId: "801" }),
    )
    assert.equal(second.replaced.messageId, "800")
    assert.deepEqual(
        (await read(await f.work({ type: "panels" }))).panels.map((row: any) => row.messageId),
        ["801"],
    )
    const removed = await read(await panel({ type: "panel-remove", categoryName: "support" }))
    assert.equal(removed.panel.messageId, "801")
    await status(await panel({ type: "panel-remove", categoryName: "support" }), 404)
    await read(await panel({ type: "panel-save", categoryName: "support", channelId: "700", messageId: "802" }))
    const deleted = await read(
        await f.manage({ type: "category-delete", name: category.name, expectedRevision: category.revision }),
    )
    assert.equal(deleted.panel.messageId, "802")
    assert.deepEqual((await read(await f.work({ type: "panels" }))).panels, [])
})

test("Ticket setup takes any number of categories, lists them 10 a page by name and opens a ticket in the 21st", async (test) => {
    const f = fixture(test)
    await f.configure()
    const names = Array.from({ length: 24 }, (_, i) => `c${String(i).padStart(2, "0")}`)
    const created: Record<string, any> = {}
    for (const name of names)
        created[name] = (
            await read(await f.manage({ type: "category-create", name, visibility: "private", supportRoleIds: [] }))
        ).category
    // Every page reads the next 10 names after the last one, so all 25 come back once and in order
    const pages = async (operation: any) => {
        const seen: string[][] = []
        let after: string | undefined
        do {
            const page = await read(await f.query({ ...operation, ...(after ? { after } : {}) }))
            seen.push(page.categories.map((row: any) => row.name))
            after = page.nextAfter
        } while (after)
        return seen
    }
    const all = await pages({ type: "categories" })
    assert.deepEqual(
        all.map((page) => page.length),
        [10, 10, 5],
    )
    assert.deepEqual(all.flat(), [...names, "support"])
    // With all but one category off, the categories that are on are that one
    for (const name of names.filter((name) => name !== "c20"))
        await read(
            await f.manage({
                type: "category-update",
                name,
                expectedRevision: created[name].revision,
                patch: { enabled: false },
            }),
        )
    const support = (await read(await f.query({ type: "category-config", name: "support" }, owner))).category
    await read(
        await f.manage({
            type: "category-update",
            name: "support",
            expectedRevision: support.revision,
            patch: { enabled: false },
        }),
    )
    assert.deepEqual(await pages({ type: "categories", enabled: true }), [["c20"]])
    const opened = await f.opened(created.c20)
    assert.equal(opened.ticket.categoryName, "c20")
    assert.equal(opened.ticket.state, "open")
})

test("A category takes a 21st canned reply and a ticket sends it, also one added after the ticket opened", async (test) => {
    const f = fixture(test)
    let category = await f.configure()
    const publishing = (operation: any) => f.http("/publishing/manage", { ...f.source(), actor: owner, operation })
    await read(await publishing({ type: "draft-create", kind: "template", name: "answer" }))
    await read(
        await publishing({
            type: "draft-set",
            kind: "template",
            name: "answer",
            expectedRevision: 1,
            content: { content: "Synthetic canned text" },
        }),
    )
    const add = async (cannedName: string) =>
        (category = (
            await read(
                await f.manage({
                    type: "canned-set",
                    name: category.name,
                    expectedRevision: category.revision,
                    cannedName,
                    templateName: "answer",
                    expectedTemplateRevision: 2,
                }),
            )
        ).category)
    for (let i = 0; i < 20; i++) await add(`reply${i}`)
    const open = await f.opened(category)
    await add("reply20")
    assert.equal(category.cannedReplies.length, 21)
    // The ticket keeps no copy of the canned replies, so the one added after it opened answers
    assert.deepEqual((await f.table("tickets"))[0]!.category.cannedReplies, [])
    const sent = await read(
        await f.manage(
            {
                type: "canned-reply",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                cannedName: "reply20",
            },
            support,
            open.channel,
        ),
    )
    assert.equal(sent.grant.content.content, "Synthetic canned text")
})

test("An open ticket keeps its canned replies once its category is deleted, until a category of that name takes over", async (test) => {
    const f = fixture(test)
    let category = await f.configure()
    const publishing = (operation: any) => f.http("/publishing/manage", { ...f.source(), actor: owner, operation })
    await read(await publishing({ type: "draft-create", kind: "template", name: "answer" }))
    await read(
        await publishing({
            type: "draft-set",
            kind: "template",
            name: "answer",
            expectedRevision: 1,
            content: { content: "Synthetic canned text" },
        }),
    )
    category = (
        await read(
            await f.manage({
                type: "canned-set",
                name: category.name,
                expectedRevision: category.revision,
                cannedName: "answer",
                templateName: "answer",
                expectedTemplateRevision: 2,
            }),
        )
    ).category
    const open = await f.opened(category)
    await read(await f.manage({ type: "category-delete", name: category.name, expectedRevision: category.revision }))
    const sent = await read(
        await f.manage(
            {
                type: "canned-reply",
                ticketNo: open.ticket.ticketNo,
                expectedGeneration: open.ticket.generation,
                cannedName: "answer",
            },
            support,
            open.channel,
        ),
    )
    assert.equal(sent.grant.content.content, "Synthetic canned text")
    // A new category of that name answers for the ticket from then on, with its own canned replies
    await read(
        await f.manage({ type: "category-create", name: category.name, visibility: "private", supportRoleIds: [] }),
    )
    assert.deepEqual(await f.table("ticketRetiredCanned"), [])
})

test("A category refuses canned replies past 256 KiB with the reason and keeps the ones it has", async (test) => {
    const f = fixture(test)
    let category = await f.configure()
    const publishing = (operation: any) => f.http("/publishing/manage", { ...f.source(), actor: owner, operation })
    await read(await publishing({ type: "draft-create", kind: "template", name: "long" }))
    // The longest text a template holds, in characters of three bytes each: about 24 KB of JSON a reply
    await read(
        await publishing({
            type: "draft-set",
            kind: "template",
            name: "long",
            expectedRevision: 1,
            content: {
                content: "界".repeat(2000),
                embed: { title: "界".repeat(256), description: "界".repeat(4096), footer: { text: "界".repeat(1648) } },
            },
        }),
    )
    const add = (cannedName: string) =>
        f.manage({
            type: "canned-set",
            name: category.name,
            expectedRevision: category.revision,
            cannedName,
            templateName: "long",
            expectedTemplateRevision: 2,
        })
    let count = 0
    for (;;) {
        const response = await add(`reply${count}`)
        if (response.status !== 200) {
            assert.equal(response.status, 409)
            assert.equal(
                (await response.json()).error,
                "This category's canned replies would pass 256 KiB, the most one category holds. Remove a canned reply or choose a shorter template",
            )
            break
        }
        category = (await response.json()).category
        count++
    }
    assert.equal(count, 10)
    const stored = (await f.table("ticketCategories"))[0]!
    assert.equal(stored.config.cannedReplies.length, 10)
})

test("The bot reads ticket panels a page of 500 at a time in category order", async (test) => {
    const f = fixture(test)
    await f.t.run(async (c) => {
        for (let i = 0; i < 501; i++)
            await c.db.insert("ticketPanels", {
                serverId: "1",
                categoryName: `c${String(i).padStart(3, "0")}`,
                channelId: "700",
                messageId: String(10000 + i),
                createdAt: f.now(),
            })
    })
    const first = await read(await f.work({ type: "panels" }))
    assert.equal(first.panels.length, 500)
    assert.equal(first.nextAfter, "c499")
    const second = await read(await f.work({ type: "panels", after: first.nextAfter }))
    assert.deepEqual(
        second.panels.map((row: any) => row.messageId),
        ["10500"],
    )
    assert.equal(second.nextAfter, undefined)
})

test("A category change reads only that category for the settings history, so many large categories still change", async (test) => {
    const f = fixture(test)
    const category = await f.configure()
    // 40 categories with canned replies near the 256 KiB a category holds, far more than one change may read in all
    const reply = {
        name: "long",
        templateName: "long",
        templateRevision: 1,
        content: { content: "x".repeat(2000), embed: { description: "x".repeat(4000) } },
    }
    await f.t.run(async (c) => {
        for (let i = 0; i < 40; i++)
            await c.db.insert("ticketCategories", {
                serverId: "1",
                config: {
                    name: `big${String(i).padStart(2, "0")}`,
                    revision: 100 + i,
                    enabled: true,
                    visibility: "private",
                    description: "",
                    parentId: null,
                    supportRoleIds: [],
                    questions: [],
                    cannedReplies: Array.from({ length: 40 }, (_, n) => ({ ...reply, name: `long${n}` })),
                },
            })
    })
    await read(
        await f.manage({
            type: "category-update",
            name: category.name,
            expectedRevision: category.revision,
            patch: { description: "Synthetic changed description" },
        }),
    )
    const audit = await f.table("auditLogEntries")
    assert(audit.some((row: any) => row.feature === "tickets" && row.summary.includes("support")))
})

test("A category asks 25 questions and takes 250 support roles, and its ticket channel holds every one of them", async (test) => {
    const f = fixture(test)
    await read(await f.manage({ type: "settings", enabled: true }))
    const roleIds = Array.from({ length: 250 }, (_, i) => String(5000 + i)),
        roles = roleIds.map((roleId) => ({ roleId, permissions: "0", botCanManage: true, actorCanManage: true }))
    const created = (
        await read(
            await f.manage({
                type: "category-create",
                name: "large",
                visibility: "private",
                supportRoleIds: roleIds,
                roles,
            }),
        )
    ).category
    assert.equal(created.supportRoleIds.length, 250)
    const questions = Array.from({ length: 25 }, (_, i) => `Synthetic question ${i + 1}`)
    const category = (
        await read(
            await f.manage({
                type: "category-update",
                name: "large",
                expectedRevision: created.revision,
                patch: { questions },
            }),
        )
    ).category
    assert.deepEqual(category.questions, questions)
    await status(
        await f.manage({
            type: "category-update",
            name: "large",
            expectedRevision: category.revision,
            patch: { questions: [...questions, "Synthetic question 26"] },
        }),
        400,
    )
    const opened = await f.opened(category)
    // The everyone role, NeonFlux, the requester and all 250 support roles
    assert.equal(opened.create.overwrites!.length, 253)
    assert.equal(opened.ticket.supportRoleIds.length, 250)
    const stored = (await f.table("tickets"))[0]!
    assert.equal(stored.answers.length, 25)
    assert(stored.answers.every((answer: string) => answer === "Synthetic private answer"))
})
