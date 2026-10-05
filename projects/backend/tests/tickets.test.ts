import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import type { TicketActionGrant, TicketActor, TicketChannelSnapshot, TicketContext } from "../contracts.js"

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
    "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/tickets.ts": () => import("../convex/tickets.ts"),
    "../convex/ticketLifecycle.ts": () => import("../convex/ticketLifecycle.ts"),
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
    assert.equal(response.headers.get("cache-control"), "no-store")
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
    const t = convexTest({ schema, modules, transactionLimits: true })
    drainScheduled = () => t.finishAllScheduledFunctions(() => test.mock.timers.tick(0))
    const source = () => ({
        serverId: "1",
        messageId: String(++sequence),
        createdAt: now,
    })
    const context = (actor = requester, channel?: TicketChannelSnapshot): TicketContext => ({
        observedAt: now,
        actor,
        botId: "999",
        botAuthorized: true,
        parentVerified: true,
        ...(channel ? { channel } : {}),
    })
    const http = (path: string, body: unknown, auth = true) =>
        t.fetch(path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(auth ? { Authorization: "Bearer " + secret } : {}),
            },
            body: JSON.stringify(body),
        })
    const manage = (operation: any, actor = owner, channel?: TicketChannelSnapshot) =>
        http("/tickets/manage", {
            ...source(),
            context: context(actor, channel),
            operation,
        })
    const query = (operation: any, actor = requester, channel?: TicketChannelSnapshot) =>
        http("/tickets/query", {
            serverId: "1",
            context: context(actor, channel),
            operation,
        })
    const intake = (operation: any, actor = requester, extra = {}) =>
        http("/tickets/intake", {
            ...source(),
            context: { ...context(actor), ...extra },
            operation,
        })
    const configure = async (visibility = "private", questions = ["Synthetic question"], parentId: string | null = null) => {
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
    const transition = async (type: "close" | "reopen", ticket: any, channel: TicketChannelSnapshot, actor = requester) => {
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
    const reconcile = (ticket: any, attempt: TicketActionGrant, channel: TicketChannelSnapshot | null, actor = requester) =>
        http("/tickets/reconcile", {
            ...source(),
            context: context(actor, channel ?? undefined),
            ticketNo: ticket.ticketNo,
            expectedGeneration: ticket.generation,
            attemptId: attempt.attemptId,
            observation: {
                observedAt: now,
                channelId: ticket.channelId,
                channelAbsent: channel === null,
                ...(channel ? { channel } : {}),
            },
        })
    const upload = (ticket: any, channel: TicketChannelSnapshot, messages: any[], actor = requester, s = source(), truncated = false) =>
        http("/tickets/transcript", {
            ...s,
            context: context(actor, channel),
            ticketNo: ticket.ticketNo,
            expectedGeneration: ticket.generation,
            capturedAt: now,
            messages,
            truncated,
        })
    const cleanup = () => t.mutation(internal.ticketLifecycle.cleanup, {})
    const table = (name: any) => t.run((c) => c.db.query(name).collect())
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
        upload,
        cleanup,
        table,
        drain: () => drainScheduled!(),
        advance: (ms: number) => {
            now += ms
        },
        now: () => now,
    }
}

test("Ticket HTTP authenticates before parsing, binds server and starts disabled", async (test) => {
    const f = fixture(test)
    for (const route of ["manage", "query", "intake", "dispatch", "outcome", "reconcile", "transcript"]) {
        await status(await f.http("/tickets/" + route, "Synthetic malformed body", false), 401)
        await status(await f.http("/tickets/" + route, { serverId: "2" }), 403)
    }
    assert.deepEqual((await read(await f.query({ type: "settings" }, owner))).settings, { enabled: false, retentionDays: 30 })
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
    const privateBody = await read(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, support, open.channel))
    assert.deepEqual(privateBody.answers, ["Synthetic private answer"])
    await status(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...support, roleIds: ["41"] }, open.channel),
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
            actor: owner,
            operation: {
                type: "settings",
                patch: { staffRoleIds: { cases: ["41"] } },
            },
        }),
    )
    await status(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...support, roleIds: ["41"] }, open.channel),
        403,
    )
    await status(
        await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...support, canView: false }, open.channel),
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
        await f.query({ type: "transcripts", ticketNo: open.ticket.ticketNo }, { ...support, canReadHistory: false }, open.channel),
        403,
    )
    await status(await f.query({ type: "entries", ticketNo: open.ticket.ticketNo, kind: "note" }, requester, open.channel), 403)
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
        (await read(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, rejoined, open.channel))).answers,
        ["Synthetic private answer"],
    )
})

test("Close and reopen own only SendMessages bits and resume a proven partial step without replacing baseline", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        channel = {
            ...open.channel,
            overwrites: open.channel.overwrites.map((r) => (r.id === "20" ? { ...r, allow: (BigInt(r.allow) | 256n).toString() } : r)),
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
        (await read(await f.query({ type: "locate", ticketNo: open.ticket.ticketNo }, inaccessible))).ticket.channelId,
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
        await f.manage({ type: "close", ticketNo: open.ticket.ticketNo, expectedGeneration: open.ticket.generation }, requester, moved),
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
        (await read(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, requester, closed.channel))).answers,
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
            actor: owner,
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
    await status(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, requester, open.channel), 403)
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
        await f.upload(open.ticket, open.channel, [
            { messageId: "8500", authorId: "20", content: "Synthetic transcript erased", omittedAttachments: 0 },
        ]),
    )
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
    assert.deepEqual((await read(await f.query({ type: "intakes" }))).intakes[0].category.questions, [])
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
    assert.equal((await f.table("ticketTranscripts"))[0]!.body, undefined)
    assert.equal(tickets[0]!.nativeProtected, true)
    assert.equal((await f.table("ticketRoleProtections"))[0]!.privateBodyRefs, 0)
})

test("Deletion needs acknowledged same-operation delete and fresh absence before retained-body fallback", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        closed = await f.transition("close", open.ticket, open.channel)
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
    await status(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...requester, canView: false }), 403)
    const retired = await read(await f.reconcile(uncertain.ticket, g, null, owner))
    assert.equal(retired.ticket.state, "retired")
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
    await status(await f.query({ type: "private-intake", ticketNo: open.ticket.ticketNo }, { ...support, roleIds: [] }), 403)
})

test("Bare channel absence never retires unknown creation or grants private fallback", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        submitted = await read(await f.submit(await f.draft(c))),
        g = submitted.grant
    await read(await f.dispatch(g))
    const uncertain = await read(await f.outcome(g, "uncertain", { channelId: "301" }))
    assert.equal((await read(await f.reconcile(uncertain.ticket, g, null))).recorded, false)
    await status(await f.query({ type: "private-intake", ticketNo: submitted.ticket.ticketNo }, { ...requester, canView: false }), 403)
    assert.equal((await f.table("tickets"))[0]!.nativeProtected, true)
})

test("Transcript capture stores one bounded body with paginated reads and only stored captures use capacity", async (test) => {
    const f = fixture(test),
        open = await f.opened(),
        s = f.source()
    await read(
        await f.manage(
            { type: "note", ticketNo: open.ticket.ticketNo, expectedGeneration: open.ticket.generation, content: "Synthetic note excluded" },
            support,
            open.channel,
        ),
    )
    const messages = [{ messageId: "8000", authorId: "20", createdAt: epoch, content: "Synthetic channel message 🦊", omittedAttachments: 2 }]
    await status(await f.upload(open.ticket, open.channel, [{ ...messages[0], content: "x".repeat(2001) }], requester, s), 400)
    await status(await f.upload(open.ticket, open.channel, messages, { ...requester, canReadHistory: false }), 403)
    const first = await read(await f.upload(open.ticket, open.channel, messages, requester, s))
    assert.equal((await read(await f.upload(open.ticket, open.channel, messages, requester, s))).duplicate, true)
    assert.deepEqual(first.transcript, {
        transcriptNo: first.transcript.transcriptNo,
        ticketNo: open.ticket.ticketNo,
        channelId: open.channel.channelId,
        capturedAt: f.now(),
        messageCount: 1,
        truncated: false,
        erased: false,
        pages: 1,
    })
    const shown = await read(
        await f.query({ type: "transcript", ticketNo: open.ticket.ticketNo, transcriptNo: first.transcript.transcriptNo }, requester, open.channel),
    )
    assert.equal(shown.page, 1)
    assert(shown.text.includes("Synthetic channel message 🦊") && shown.text.includes("[2 attachments omitted]"))
    assert(!shown.text.includes("Synthetic note excluded") && !shown.text.includes("Synthetic private answer"))
    const long = Array.from({ length: 500 }, (_, i) => ({ messageId: String(9000 + i), authorId: "20", content: "y".repeat(300), omittedAttachments: 0 }))
    const big = (await read(await f.upload(open.ticket, open.channel, long, requester, f.source(), true))).transcript
    assert.equal(big.messageCount, 500)
    assert.equal(big.truncated, true)
    assert(big.pages > 1)
    const last = await read(
        await f.query({ type: "transcript", ticketNo: open.ticket.ticketNo, transcriptNo: big.transcriptNo, page: big.pages }, requester, open.channel),
    )
    assert(last.text.length > 0 && last.text.length <= 1500)
    await status(
        await f.query({ type: "transcript", ticketNo: open.ticket.ticketNo, transcriptNo: big.transcriptNo, page: big.pages + 1 }, requester, open.channel),
        400,
    )
    await status(await f.upload(open.ticket, open.channel, [...long, { ...long[0], messageId: "9999" }]), 400)
    for (let i = 2; i < 20; i++) await read(await f.upload(open.ticket, open.channel, messages))
    await status(await f.upload(open.ticket, open.channel, messages), 429)
    assert.equal((await f.table("ticketTranscripts")).length, 20)
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
            actor: owner,
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
            actor: owner,
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
            actor: owner,
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

test("Support discovery uses bounded filtered twenty-row pages and numeric continuation", async (test) => {
    const f = fixture(test),
        c = await f.configure("private", [])
    for (let i = 0; i < 22; i++) {
        const actor = { ...requester, userId: String(100 + i) }
        await read(await f.submit(await f.draft(c, actor), actor))
    }
    const unrelated = { ...support, roleIds: [] },
        first = await read(await f.query({ type: "tickets" }, unrelated))
    assert.deepEqual(first.tickets, [])
    assert.equal(typeof first.nextBeforeTicketNo, "number")
    const all = await read(await f.query({ type: "tickets" }, support))
    assert.equal(all.tickets.length, 20)
    assert.equal((await read(await f.query({ type: "tickets", beforeTicketNo: all.nextBeforeTicketNo }, support))).tickets.length, 2)
    assert.equal((await read(await f.query({ type: "tickets", own: true }, support))).tickets.length, 0)
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

test("Private configuration is DM-only and requester timeout protection fences intake", async (test) => {
    const f = fixture(test),
        c = await f.configure()
    await status(await f.query({ type: "category-config", name: c.name }, { ...owner, privateChannelVerified: false }), 403)
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
    await read(await f.query({ type: "category-config", name: c.name }, owner))
})

test("Every full category mutation requires private context before reserving source receipt", async (test) => {
    const f = fixture(test),
        c = await f.configure(),
        publicOwner = { ...owner, privateChannelVerified: false }
    const before = (await f.table("ticketReceipts")).length
    for (const operation of [
        { type: "category-create", name: "publicblocked", visibility: "private", supportRoleIds: ["40"], roles: roleSnapshots },
        { type: "category-update", name: c.name, expectedRevision: c.revision, patch: { description: "Hidden configuration" } },
        { type: "category-delete", name: c.name, expectedRevision: c.revision },
        {
            type: "canned-set",
            name: c.name,
            expectedRevision: c.revision,
            cannedName: "answer",
            templateName: "missing",
            expectedTemplateRevision: 1,
        },
        { type: "canned-remove", name: c.name, expectedRevision: c.revision, cannedName: "answer" },
    ])
        await status(await f.manage(operation, publicOwner), 403)
    assert.equal((await f.table("ticketReceipts")).length, before)
    assert.equal((await f.table("ticketCategories")).length, 1)
    await read(await f.manage({ type: "settings", enabled: false }, publicOwner))
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
})
