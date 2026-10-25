import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { cleanupMetadataLogs } from "../convex/metadataLogsRetention.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import type {
    MetadataLogsBinding,
    MetadataLogsContext,
    MetadataLogsEvent,
    MetadataLogsGrant,
    MetadataLogsRecord,
} from "@neonflux/contracts/metadata-logs"
import { adapterFixture } from "./adapter-fixture.ts"
import { botCall } from "./bot-service.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"

const modules = {
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/metadataLogsRetention.ts": () => import("../convex/metadataLogsRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/protection.ts": () => import("../convex/protection.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
}
const owner = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const binding = (d: MetadataLogsBinding): MetadataLogsBinding => ({
    recordNo: d.recordNo,
    routeRevision: d.routeRevision,
    moduleRevision: d.moduleRevision,
    generation: d.generation,
    channelId: d.channelId,
    ownerId: d.ownerId,
    ...(d.routeEventType === undefined ? {} : { routeEventType: d.routeEventType }),
})
async function fixture(t: TestContext) {
    const f = await adapterFixture(t, modules)
    let sequence = 0
    const member = (userId: string, isBot = false) => ({
        userId,
        joinedAt: "2020-01-01T00:00:00.000001Z",
        roleIds: [],
        isBot,
        timeoutUntil: null,
        canView: true,
        canReadHistory: true,
    })
    const context = (userId = "10", channelId = "30"): MetadataLogsContext => ({
        observedAt: f.now(),
        actor: { ...owner, userId, isOwner: userId === "10", isAdministrator: userId === "11" },
        member: member(userId),
        channelId,
        channelType: 0,
        botId: "999",
        botAuthorized: true,
        actorAuthorized: true,
        actorKind: "human",
        botKind: "bot",
        botMember: member("999", true),
    })
    const privateRead = { channelId: "90", recipientIds: ["10", "999"], oneToOne: true }
    const post = (path: string, body: unknown, authorized = true) =>
        botCall(f.backend, path, body, authorized ? {} : { secret: null })
    async function read(response: Response) {
        assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
        return response.json() as Promise<any>
    }
    const query = (operation: unknown, proof = context()) =>
        post("/metadata-logs/query", { serverId: "1", context: proof, privateRead, operation })
    const manage = (operation: unknown, proof = context()) =>
        post("/metadata-logs/manage", { ...f.source(), context: proof, operation })
    const work = (operation: unknown) => post("/metadata-logs/work", { serverId: "1", operation })
    const settings = async () => (await read(await query({ type: "settings" }))).settings
    const counters = async () => (await read(await query({ type: "counters" }))).counters
    const event = (extra: Partial<MetadataLogsEvent> = {}): MetadataLogsEvent => ({
        category: "membership",
        type: "member-update",
        source: { kind: "observation", sessionId: "1".repeat(32), sequence: ++sequence },
        observedAt: f.now(),
        actor: { kind: "unknown" },
        resourceIds: ["20"],
        changedFields: ["roles"],
        count: 1,
        ...extra,
    })
    const admit = (e = event()) => post("/metadata-logs/admit", { serverId: "1", event: e })
    const admitted = async (e = event()): Promise<MetadataLogsRecord> => {
        const r = await read(await admit(e))
        assert(r.admitted)
        return r.record
    }
    const module = async (enabled: boolean) =>
        read(await manage({ type: "module", expectedRevision: (await settings()).revision, enabled }))
    const route = async (category = "membership", channelId = "30", ownerId = "10", enabled = true) => {
        const old = (await settings()).routes.find((r: { category: string }) => r.category === category)
        return read(
            await manage({
                type: "route",
                category,
                expectedRevision: old.revision,
                enabled,
                channelId,
                ownerId,
                recipientOwner: context(ownerId, channelId),
            }),
        )
    }
    const open = async () => {
        await route()
        await module(true)
    }
    const reserve = async (r: MetadataLogsRecord): Promise<MetadataLogsGrant> => {
        assert(r.delivery)
        return (
            await read(
                await work({
                    type: "reserve",
                    binding: binding(r.delivery),
                    context: context(r.delivery.ownerId, r.delivery.channelId),
                }),
            )
        ).grant
    }
    const claim = (g: MetadataLogsGrant, claimToken = "a".repeat(32)) =>
        work({ type: "claim", binding: binding(g), context: context(g.ownerId, g.channelId), claimToken })
    const outcome = (g: MetadataLogsGrant, result: string, messageId?: string, extra: object = {}) =>
        work({
            type: "outcome",
            binding: binding(g),
            claimToken: "a".repeat(32),
            outcome: result,
            observedAt: f.now(),
            ...(messageId ? { messageId } : {}),
            ...extra,
        })
    const show = async (no: number): Promise<MetadataLogsRecord> =>
        (await read(await query({ type: "show", recordNo: no }))).record
    const cleanup = () => f.backend.run((ctx) => retentionPass(ctx, cleanupMetadataLogs))
    const defcon = async (level: 1 | 2 | 3) => {
        await read(
            await post("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    }
    return {
        ...f,
        context,
        privateRead,
        post,
        read,
        query,
        manage,
        work,
        settings,
        counters,
        event,
        admit,
        admitted,
        module,
        route,
        open,
        reserve,
        claim,
        outcome,
        show,
        cleanup,
        defcon,
    }
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json()))
}

test("Metadata defaults and read-only reports create no records or settings, authenticate exact routes", async (t) => {
    const f = await fixture(t),
        initial = await f.settings()
    assert.equal(initial.enabled, false)
    assert(initial.routes.every((r: { enabled: boolean }) => !r.enabled))
    assert.equal(initial.capacity, 10000)
    await f.counters()
    assert.equal(
        await f.backend.run((ctx) => ctx.db.query("metadataLogSettings").collect()).then((rows) => rows.length),
        0,
    )
    for (const route of ["admit", "manage", "query", "work"]) {
        await status(await f.post(`/metadata-logs/${route}`, {}, false), 401)
        await status(await f.post(`/metadata-logs/${route}`, { serverId: "2" }), 403)
    }
    assert.deepEqual(await f.read(await f.admit()), { admitted: false, duplicate: false, reason: "disabled" })
})

test("Strict finite ingress rejects private bodies and invented attribution at every nesting level", async (t) => {
    const f = await fixture(t)
    await f.open()
    const forbidden = [
        "content",
        "reason",
        "attachments",
        "error",
        "stack",
        "changes",
        "contentHash",
        "birthday",
        "inviteCode",
    ]
    for (const key of forbidden)
        await status(
            await f.post("/metadata-logs/admit", {
                serverId: "1",
                event: { ...f.event(), [key]: "synthetic private value" },
            }),
            400,
        )
    for (const actor of [
        { kind: "audit", userId: "10" },
        { kind: "configuration", userId: "10" },
        { kind: "unknown", userId: "10" },
    ])
        await status(await f.admit(f.event({ actor } as Partial<MetadataLogsEvent>)), 400)
    for (const extra of [
        { observedAt: f.now() + 1001 },
        { resourceIds: Array(21).fill("20") },
        { changedFields: ["roles", "roles"] },
        { changedFields: ["content"] },
        { count: 2 },
        { type: "member-kick" },
        { source: { kind: "observation", sessionId: "bad", sequence: 1 } },
    ])
        await status(await f.admit({ ...f.event(), ...extra } as MetadataLogsEvent), 400)
    const row = await f.admitted()
    assert.deepEqual(row.event.actor, { kind: "unknown" })
    assert(!JSON.stringify(row).includes("synthetic private value"))
    // Details pass only with the keys their kind of record may carry, within their bounds
    const nickname = { field: "nickname", before: "Old", after: "New" }
    const changed = await f.admitted(f.event({ changedFields: ["nickname"], details: { changes: [nickname] } }))
    assert.deepEqual(changed.event.details, { changes: [nickname] })
    assert.match(changed.presentation!.embed.description, /\*\*Nickname\*\*: Old → New/)
    for (const details of [
        { text: "message text on a member record" },
        { changes: [{ ...nickname, field: "roles" }] },
        { changes: [{ field: "nickname" }] },
        { changes: [{ ...nickname, before: "x".repeat(301) }] },
        { changes: [nickname, nickname] },
        { unknown: true },
        {},
    ])
        await status(await f.admit(f.event({ changedFields: ["nickname"], details } as never)), 400)
})

test("Stable native IDs and raw join epochs dedupe separately from session observation sequences", async (t) => {
    const f = await fixture(t)
    await f.open()
    const observation = f.event()
    await f.admitted(observation)
    assert.equal((await f.read(await f.admit(observation))).reason, "duplicate")
    await f.admitted({ ...observation, source: { kind: "observation", sessionId: "2".repeat(32), sequence: 1 } })
    const joined = f.event({
        type: "member-add",
        changedFields: [],
        source: { kind: "member-add", userId: "20", joinedAt: new Date(f.now()).toISOString() },
    })
    await f.admitted(joined)
    assert.equal((await f.read(await f.admit(joined))).reason, "duplicate")
    const audit = f.event({
        category: "audit",
        type: "audit-entry",
        source: { kind: "audit", auditEntryId: "200" },
        actor: { kind: "audit", userId: "11" },
        changedFields: [],
        resourceIds: ["20"],
        auditAction: 22,
    })
    await f.admitted(audit)
    assert.equal((await f.read(await f.admit(audit))).reason, "duplicate")
    const after = await f.admitted()
    assert.deepEqual(after.event.actor, { kind: "unknown" })
    // Every audit action Fluxer lists is logged, and an entry without a target too
    for (const [auditAction, resourceIds] of [
        [72, ["20"]],
        [21, []],
    ] as const)
        await f.admitted({
            ...audit,
            auditAction,
            resourceIds: [...resourceIds],
            source: { kind: "audit", auditEntryId: String(auditAction) },
        })
    await status(await f.admit({ ...audit, auditAction: 99, source: { kind: "audit", auditEntryId: "99" } }), 400)
})

test("Security alerts have their own category, and name an actor only from their own audit entry or a new invite's event", async (t) => {
    const f = await fixture(t)
    await f.open()
    assert.deepEqual(
        (await f.settings()).routes.find((route: { category: string }) => route.category === "security"),
        { category: "security", enabled: false, revision: 1 },
    )
    const invite = f.event({
        category: "security",
        type: "invite-create",
        resourceIds: ["31"],
        changedFields: ["never-expires", "unlimited-uses"],
        actor: { kind: "event", userId: "12" },
    })
    const unrouted = await f.admitted({ ...invite, details: { inviteCode: "AbC123" } })
    assert.equal(unrouted.delivery, null)
    assert.deepEqual(unrouted.event.actor, { kind: "event", userId: "12" })
    assert.ok(unrouted.presentation!.embed.description.includes("Code: `AbC123`"))
    for (const inviteCode of ["has space", "back`tick", "x".repeat(65)])
        await status(
            await f.admit({
                ...invite,
                source: { kind: "observation", sessionId: "4".repeat(32), sequence: 1 },
                details: { inviteCode },
            }),
            400,
        )
    await f.route("security", "32")
    assert.equal(
        (await f.admitted(f.event({ category: "security", type: "bot-join", resourceIds: ["40"], changedFields: [] })))
            .delivery?.channelId,
        "32",
    )
    assert.equal((await f.counters()).categories.security, 2)
    const privilege = f.event({
        category: "security",
        type: "privilege-change",
        source: { kind: "audit", auditEntryId: "300" },
        actor: { kind: "audit", userId: "11" },
        resourceIds: ["41"],
        changedFields: ["role-permissions", "Administrator"],
    })
    const recorded = await f.admitted(privilege)
    assert.ok(recorded.presentation!.embed.title.endsWith("Dangerous permissions granted"))
    assert.equal((await f.read(await f.admit(privilege))).reason, "duplicate")
    // An audit actor needs its own audit entry, and only a new invite's event can name its creator
    for (const extra of [
        { source: { kind: "observation", sessionId: "3".repeat(32), sequence: 1 } },
        { type: "bot-join", source: { kind: "audit", auditEntryId: "301" }, changedFields: [] },
    ])
        await status(await f.admit({ ...privilege, ...extra } as MetadataLogsEvent), 400)
    await status(await f.admit({ ...invite, type: "invite-delete", changedFields: [] }), 400)
    await status(await f.admit({ ...invite, category: "resources" }), 400)
    await status(await f.admit({ ...invite, changedFields: ["content"] }), 400)
    await status(await f.admit({ ...invite, actor: { kind: "event", userId: "12" }, count: 2 }), 400)
})

test("Actual role and channel bulk projections admit one resource record with the provider payload count and 20 IDs", async (t) => {
    const f = await fixture(t)
    await f.open()
    const { projectMetadataEvent } = await import("../../bot/src/metadata-log-projector.ts")
    for (const [index, name] of ["guildRoleUpdateBulk", "guildChannelUpdateBulk"].entries()) {
        const count = index === 0 ? 25 : 1000,
            resources = Array.from({ length: count }, (_, i) => ({
                id: String(10000 + i),
                name: "synthetic private display value",
                topic: "synthetic private channel body",
                permissions: "8",
            }))
        const payload = { guildId: "1", [index === 0 ? "roles" : "channels"]: resources },
            scope = { serverId: "1", sessionId: "3".repeat(32), sequence: index + 1, observedAt: f.now() }
        const event = projectMetadataEvent(name, payload, scope)
        assert(event)
        const before = await f.counters(),
            row = await f.admitted(event),
            after = await f.counters()
        assert.equal(row.event.category, "resources")
        assert.equal(row.event.count, count)
        assert.equal(row.event.resourceIds.length, 20)
        assert.deepEqual(row.event.actor, { kind: "unknown" })
        assert.equal(after.categories.resources, before.categories.resources + 1)
        assert(!JSON.stringify(row).includes("synthetic private"))
        assert.equal((await f.read(await f.admit(event))).reason, "duplicate")
        // A larger batch is counted in full too, still with 20 IDs
        const larger = projectMetadataEvent(
            name,
            {
                guildId: "1",
                [index === 0 ? "roles" : "channels"]: [
                    ...resources,
                    ...Array.from({ length: 1001 - count }, (_, i) => ({ id: String(20000 + i) })),
                ],
            },
            { ...scope, sequence: index + 3 },
        )!
        const admittedLarger = await f.admitted(larger)
        assert.deepEqual([admittedLarger.event.count, admittedLarger.event.resourceIds.length], [1001, 20])
    }
})

test("Unknown-author deletes and bounded bulk summaries are admitted only with explicit ordinary-channel opt-in", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("messages", "35")
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            messageChannelIds: ["31", "30"],
            excludedChannelIds: ["32"],
        }),
    )
    const deletion = f.event({
        category: "messages",
        type: "message-delete",
        source: { kind: "message-delete", messageId: "500" },
        resourceIds: ["500"],
        changedFields: [],
        channelId: "31",
        authorBot: null,
        privateChannel: false,
    })
    await f.admitted(deletion)
    assert.equal((await f.read(await f.admit(deletion))).duplicate, true)
    await f.admitted(
        f.event({
            category: "messages",
            type: "message-bulk-delete",
            resourceIds: Array.from({ length: 20 }, (_, i) => String(600 + i)),
            changedFields: [],
            channelId: "31",
            authorBot: null,
            privateChannel: false,
            count: 1000,
        }),
    )
    for (const extra of [
        { authorBot: true },
        { privateChannel: true },
        { channelId: "30" },
        { channelId: "32" },
        { channelId: "33" },
    ])
        assert.equal(
            (
                await f.read(
                    await f.admit(
                        f.event({
                            ...deletion,
                            source: { kind: "message-delete", messageId: "501" },
                            resourceIds: ["501"],
                            ...extra,
                        }),
                    ),
                )
            ).reason,
            "excluded",
        )
    await f.admitted()
    await f.route("membership", "34")
    await f.read(
        await f.manage({
            type: "clear",
            category: "membership",
            expectedRevision: (await f.settings()).routes.find((r: { category: string }) => r.category === "membership")
                .revision,
        }),
    )
    assert.equal(
        (
            await f.read(
                await f.admit(
                    f.event({
                        ...deletion,
                        source: { kind: "message-delete", messageId: "502" },
                        resourceIds: ["502"],
                        channelId: "30",
                    }),
                ),
            )
        ).reason,
        "excluded",
    )
    const resource = await f.admitted(
        f.event({
            category: "resources",
            type: "channel-delete",
            resourceIds: ["30"],
            changedFields: [],
            channelId: "30",
        }),
    )
    assert.equal(resource.event.type, "channel-delete")
    assert.deepEqual(resource.event.actor, { kind: "unknown" })
})

test("Thread events are resource records that name their parent channel and the fields seen to change", async (t) => {
    const f = await fixture(t)
    await f.open()
    const thread = (
        type: "thread-create" | "thread-update" | "thread-delete",
        extra: Partial<MetadataLogsEvent> = {},
    ) =>
        f.event({
            category: "resources",
            type,
            resourceIds: ["41"],
            changedFields: [],
            parentChannelId: "31",
            ...extra,
        })
    const created = await f.admitted(thread("thread-create"))
    assert.match(created.presentation!.embed.title, /Thread created/)
    assert.match(created.presentation!.embed.description, /Parent channel: <#31>/)
    const updated = await f.admitted(thread("thread-update", { changedFields: ["name", "archived", "locked", "tags"] }))
    assert.deepEqual(updated.event.changedFields, ["name", "archived", "locked", "tags"])
    assert.match(updated.presentation!.embed.title, /: Thread changed$/)
    // A deleted parent takes its threads along, so one record counts the threads the bot knew
    const gone = await f.admitted(thread("thread-delete", { resourceIds: ["41", "42"], count: 2 }))
    assert.equal(gone.event.count, 2)
    assert.equal(gone.event.parentChannelId, "31")
    assert.match(gone.presentation!.embed.title, /Thread deleted/)
    const { parentChannelId: _omitted, ...orphan } = thread("thread-create")
    for (const event of [
        orphan,
        thread("thread-create", { parentChannelId: "41" }),
        thread("thread-create", { parentChannelId: "x" }),
    ])
        await status(await f.admit(event), 400)
})

test("Message events answer messages-off without writing until a message event is routed and a channel can be logged", async (t) => {
    const f = await fixture(t)
    await f.open()
    const deletion = (messageId: string, channelId = "31") =>
        f.event({
            category: "messages",
            type: "message-delete",
            source: { kind: "message-delete", messageId },
            resourceIds: [messageId],
            changedFields: [],
            channelId,
            authorBot: null,
            privateChannel: false,
            details: { authorId: "20", text: "synthetic member text" },
        })
    // The bot asks this when a server starts, and keeps message text only while it is true
    const logged = async () => ((await f.read(await f.work({ type: "messages" }))) as { logged: boolean }).logged
    const before = await f.settings()
    // A new server logs every channel, but no category or override sends message events anywhere yet
    assert.equal(before.allChannels, true)
    assert.equal(await logged(), false)
    assert.equal((await f.read(await f.admit(deletion("800")))).reason, "messages-off")
    assert.equal((await f.settings()).suppressed, before.suppressed)
    assert.equal(
        await f.backend
            .run((ctx) => ctx.db.query("metadataLogRecords").collect())
            .then((rows) => rows.filter((row) => row.event.category === "messages").length),
        0,
    )
    // An override for one message event is enough, and another unrouted message event stays out
    await f.read(
        await f.manage({
            type: "event-route",
            eventType: "message-delete",
            expectedRevision: (await f.settings()).configRevision,
            enabled: true,
            channelId: "35",
            ownerId: "10",
            recipientOwner: f.context("10", "35"),
        }),
    )
    assert.equal(await logged(), true)
    const admitted = await f.admitted(deletion("801", "36"))
    assert.match(admitted.presentation!.embed.description, /Author: <@20>/)
    // The author is stored on the record, so the member's own data request finds it
    assert.equal(
        await f.backend.run(
            async (ctx) =>
                (
                    await ctx.db
                        .query("metadataLogRecords")
                        .withIndex("by_member_data", (q) => q.eq("authorId", "20").eq("serverId", "1"))
                        .unique()
                )?.recordNo,
        ),
        admitted.recordNo,
    )
    assert.match(admitted.presentation!.embed.description, /Text:\n```\nsynthetic member text\n```/)
    const update = f.event({
        category: "messages",
        type: "message-update",
        resourceIds: ["802"],
        changedFields: ["update"],
        channelId: "36",
        authorBot: false,
        privateChannel: false,
    })
    assert.equal((await f.read(await f.admit(update))).reason, "excluded")
    // Listed mode with no channel logs nothing
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            allChannels: false,
            messageChannelIds: [],
            excludedChannelIds: [],
        }),
    )
    assert.equal((await f.settings()).allChannels, false)
    assert.equal(await logged(), false)
    assert.equal((await f.read(await f.admit(deletion("803")))).reason, "messages-off")
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            messageChannelIds: ["31"],
            excludedChannelIds: [],
        }),
    )
    assert.equal((await f.read(await f.admit(deletion("804")))).admitted, true)
    assert.equal((await f.read(await f.admit(deletion("805", "36")))).reason, "excluded")
    assert.equal(await logged(), true)
    // Logs that are off log no message events, whatever their routes say
    await f.read(await f.manage({ type: "module", expectedRevision: (await f.settings()).revision, enabled: false }))
    assert.equal(await logged(), false)
})
test("A messages route whose every message event is silenced logs no message events", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("messages", "35")
    const logged = async () => ((await f.read(await f.work({ type: "messages" }))) as { logged: boolean }).logged
    assert.equal(await logged(), true)
    const types = ["message-update", "message-delete", "message-bulk-delete"]
    for (const [index, eventType] of types.entries()) {
        await f.read(
            await f.manage({
                type: "event-route",
                eventType,
                expectedRevision: (await f.settings()).configRevision,
                enabled: false,
            }),
        )
        // The others still follow the category until the last one is silenced too
        assert.equal(await logged(), index < types.length - 1, eventType)
    }
    const deletion = f.event({
        category: "messages",
        type: "message-delete",
        source: { kind: "message-delete", messageId: "910" },
        resourceIds: ["910"],
        changedFields: [],
        channelId: "36",
        authorBot: null,
        privateChannel: false,
    })
    assert.equal((await f.read(await f.admit(deletion))).reason, "messages-off")
})
test("Every channel mode logs any channel except exclusions and log channels, and older rows keep their list", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("messages", "35")
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            allChannels: true,
            messageChannelIds: [],
            excludedChannelIds: ["32"],
        }),
    )
    const deletion = (messageId: string, channelId: string) =>
        f.event({
            category: "messages",
            type: "message-delete",
            source: { kind: "message-delete", messageId },
            resourceIds: [messageId],
            changedFields: [],
            channelId,
            authorBot: null,
            privateChannel: false,
        })
    assert.equal((await f.read(await f.admit(deletion("900", "36")))).admitted, true)
    for (const [messageId, channelId] of [
        ["901", "32"],
        ["902", "35"],
        ["903", "30"],
    ] as const)
        assert.equal((await f.read(await f.admit(deletion(messageId, channelId)))).reason, "excluded")
    // Listing channels together with every channel is refused
    await status(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            allChannels: true,
            messageChannelIds: ["31"],
            excludedChannelIds: [],
        }),
        400,
    )
    // A row from before the choice existed has no field and keeps listed mode
    await f.backend.run(async (ctx) => {
        const row = (await ctx.db.query("metadataLogSettings").collect())[0]!
        await ctx.db.patch(row._id, { allChannels: undefined, messageChannelIds: ["31"] })
    })
    assert.equal((await f.settings()).allChannels, false)
    assert.equal((await f.read(await f.admit(deletion("904", "36")))).reason, "excluded")
    assert.equal((await f.read(await f.admit(deletion("905", "31")))).admitted, true)
})
test("Message rules treat a thread as its parent channel for listed and excluded channels", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("messages", "35")
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            messageChannelIds: ["31"],
            excludedChannelIds: ["32"],
        }),
    )
    const deletion = (messageId: string, channelId: string, parentChannelId?: string) =>
        f.event({
            category: "messages",
            type: "message-delete",
            source: { kind: "message-delete", messageId },
            resourceIds: [messageId],
            changedFields: [],
            channelId,
            ...(parentChannelId ? { parentChannelId } : {}),
            authorBot: null,
            privateChannel: false,
        })
    // Thread 41 of the listed channel 31 is logged, and the presentation names the parent
    const admitted = await f.admitted(deletion("700", "41", "31"))
    assert.equal(admitted.event.parentChannelId, "31")
    assert.match(admitted.presentation!.embed.description, /Parent channel: <#31>/)
    assert.equal((await f.read(await f.admit(deletion("701", "41")))).reason, "excluded")
    // A thread of an excluded channel stays excluded even when the thread itself is listed
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            messageChannelIds: ["31", "42"],
            excludedChannelIds: ["32"],
        }),
    )
    assert.equal((await f.read(await f.admit(deletion("702", "42", "32")))).reason, "excluded")
    await status(await f.admit(deletion("703", "41", "41")), 400)
    await status(
        await f.admit(
            f.event({
                category: "resources",
                type: "channel-update",
                resourceIds: ["30"],
                changedFields: [],
                parentChannelId: "31",
            }),
        ),
        400,
    )
})

test("Admin mutator and eligible recipient owner are independently checked and source receipts keep exact identity", async (t) => {
    const f = await fixture(t),
        op = {
            type: "route",
            category: "membership",
            expectedRevision: 1,
            enabled: true,
            channelId: "30",
            ownerId: "11",
            recipientOwner: f.context("11"),
        },
        input = { ...f.source(), context: f.context(), operation: op }
    await f.read(await f.post("/metadata-logs/manage", input))
    assert.deepEqual(await f.read(await f.post("/metadata-logs/manage", input)), { duplicate: true })
    await status(await f.post("/metadata-logs/manage", { ...input, context: f.context("11") }), 409)
    await status(await f.post("/metadata-logs/manage", { ...input, operation: { ...op, channelId: "31" } }), 409)
    await status(await f.manage({ ...op, expectedRevision: 2, ownerId: "20", recipientOwner: f.context("10") }), 403)
    await status(await f.manage({ ...op, expectedRevision: 2, ownerId: "20", recipientOwner: f.context("20") }), 403)
    const receipts = await f.backend.run((ctx) => ctx.db.query("metadataLogReceipts").collect())
    assert(receipts.every((r) => r.actorId === "10"))
    assert(!JSON.stringify(receipts).includes("joinedAt"))
    f.advance(86400001)
    await f.cleanup()
    await status(await f.post("/metadata-logs/manage", { ...input, createdAt: f.now(), context: f.context() }), 409)
})

test("Actual core settings hooks are atomic, source-bound and replay-safe after receipt expiry", async (t) => {
    const f = await fixture(t)
    await f.open()
    const input = {
        ...f.source(),
        actor: owner,
        operation: { type: "settings", patch: { logChannelId: "35", defcon: 2 } },
    }
    await f.read(await f.post("/moderation/manage", input))
    const counts = await f.counters()
    assert.deepEqual(await f.read(await f.post("/moderation/manage", input)), { duplicate: true })
    assert.deepEqual(await f.counters(), counts)
    await status(
        await f.post("/moderation/manage", {
            ...input,
            operation: { type: "settings", patch: { logChannelId: "36", defcon: 2 } },
        }),
        409,
    )
    await status(
        await f.post("/moderation/manage", {
            ...input,
            actor: { ...owner, userId: "11", isAdministrator: true, isOwner: false },
        }),
        409,
    )
    await status(
        await f.post("/moderation/manage", {
            ...f.source(),
            actor: owner,
            operation: { type: "settings", patch: { logChannelId: "37", defcon: 0 } },
        }),
        400,
    )
    const rows = (await f.read(await f.query({ type: "list" }))).records.filter(
        (r: MetadataLogsRecord) => r.event.source.kind === "settings" && r.event.source.messageId === input.messageId,
    )
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].event.actor, { kind: "configuration", userId: "10" })
    assert.deepEqual(new Set(rows[0].event.changedFields), new Set(["logChannelId", "defcon"]))
    f.advance(86400001)
    await f.cleanup()
    await status(await f.post("/moderation/manage", { ...input, createdAt: f.now() - 86400001 }), 400)
    await status(await f.post("/moderation/manage", { ...input, createdAt: f.now() }), 409)
})

test("One-time claims reject duplicate workers", async (t) => {
    const f = await fixture(t)
    await f.open()
    const row = await f.admitted(),
        grant = await f.reserve(row)
    const results = await Promise.all([f.claim(grant), f.claim(grant, "b".repeat(32))]).then(async (values) =>
        Promise.all(values.map(f.read)),
    )
    assert.equal(results.filter((r) => r.claimed).length, 1)
    await f.read(await f.outcome(grant, "uncertain"))
    await status(await f.work({ type: "reserve", binding: binding(grant), context: f.context() }), 409)
    assert.equal((await f.counters()).uncertain, 1)
})

test("A post reported unsent permits at most three generations while every intent and terminal outcome is retained", async (t) => {
    const f = await fixture(t)
    await f.open()
    let row = await f.admitted()
    for (let generation = 1; generation <= 3; generation++) {
        const grant = await f.reserve(row)
        assert.equal(grant.generation, generation)
        await f.read(await f.claim(grant))
        await f.read(await f.outcome(grant, "failed", undefined, { unsent: true }))
        await status(await f.claim(grant), 409)
        row = await f.show(row.recordNo)
    }
    await status(await f.work({ type: "reserve", binding: binding(row.delivery!), context: f.context() }), 409)
    const attempts = await f.backend.run((ctx) => ctx.db.query("metadataLogAttempts").collect())
    assert.equal(attempts.length, 3)
    assert(attempts.every((r) => r.delivery.state === "failed" && r.delivery.noDispatch && r.delivery.grant))
    assert.equal((await f.counters()).failed, 1)
})

test("Old claimed outcomes survive route and module changes, age uncertain and retain late known-ID evidence", async (t) => {
    const f = await fixture(t)
    await f.open()
    const row = await f.admitted(),
        grant = await f.reserve(row)
    assert((await f.read(await f.claim(grant))).claimed)
    await f.route("membership", "31")
    await f.module(false)
    f.advance(130001)
    await f.cleanup()
    const aged = await f.show(row.recordNo)
    assert.equal(aged.delivery!.state, "uncertain")
    await f.read(await f.outcome(grant, "sent", "700"))
    const late = await f.show(row.recordNo)
    assert.equal(late.delivery!.state, "uncertain")
    assert.equal(late.delivery!.finishedAt, aged.delivery!.finishedAt)
    assert.equal(late.delivery!.messageId, "700")
    assert.equal(late.delivery!.channelId, "30")
    await status(await f.outcome(grant, "sent", "701"), 409)
    await f.read(
        await f.manage({
            type: "reconcile",
            binding: binding(grant),
            observation: {
                messageId: "700",
                channelId: "30",
                botId: "999",
                observedAt: f.now(),
                status: "match",
                content: grant.content,
                embed: grant.embed,
            },
        }),
    )
    assert.equal((await f.show(row.recordNo)).delivery!.resolution, "match")
    await f.read(await f.manage({ type: "forget", recordNo: row.recordNo, confirm: true }))
    assert.equal((await f.counters()).categories.membership, 0)
})

test("Absolute expiry prevents claim and route changes preserve queued destination, DEFCON pauses dispatch", async (t) => {
    const f = await fixture(t)
    await f.open()
    const row = await f.admitted()
    await f.route("membership", "31")
    const grant = await f.reserve(row)
    assert.equal(grant.channelId, "30")
    await f.defcon(1)
    await status(await f.claim(grant), 403)
    await f.read(await f.query({ type: "counters" }))
    await f.module(false)
    await f.defcon(3)
    await f.module(true)
    await status(await f.claim(grant), 409)
    f.advance(130001)
    await f.cleanup()
    const next = await f.show(row.recordNo)
    assert.equal(next.delivery!.noDispatch, true)
    const fresh = await f.reserve(next)
    assert.equal(fresh.channelId, "30")
    assert.equal(fresh.generation, 2)
    f.advance(120000)
    await status(await f.claim(fresh), 409)
})

test("A full record store evicts its oldest record instead of refusing new events", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.admitted()
    const records = async () =>
        (await f.backend.run((ctx) => ctx.db.query("metadataLogRecords").collect())).map((r) => r.recordNo)
    const before = await records()
    await f.backend.run(async (ctx) => {
        const state = await ctx.db
            .query("metadataLogSettings")
            .withIndex("by_server", (q) => q.eq("serverId", "1"))
            .unique()
        assert(state)
        await ctx.db.patch(state._id, { retained: 10000 })
    })
    const fresh = await f.admitted()
    assert.deepEqual(await records(), [...before.slice(1), fresh.recordNo])
    assert.equal((await f.counters()).retainedMetadataRecords, 10000)
})
test("Retention expires settled data while keeping unresolved anchors", async (t) => {
    const f = await fixture(t)
    await f.open()
    const sent = await f.admitted(),
        unknown = await f.admitted(),
        g = await f.reserve(sent),
        u = await f.reserve(unknown)
    await f.read(await f.claim(g))
    await f.read(await f.outcome(g, "sent", "700"))
    await f.read(await f.claim(u))
    await f.read(await f.outcome(u, "failed"))
    f.advance(2592000001)
    await f.cleanup()
    await status(await f.query({ type: "show", recordNo: sent.recordNo }), 404)
    assert.equal((await f.show(unknown.recordNo)).delivery!.state, "failed")
    assert.equal((await f.counters()).categories.membership, 1)
    await status(await f.manage({ type: "forget", recordNo: unknown.recordNo, confirm: true }), 409)
})

test("A message record whose post is not confirmed still goes with its member text when it expires", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("messages", "35")
    const text = await f.admitted(
            f.event({
                category: "messages",
                type: "message-delete",
                source: { kind: "message-delete", messageId: "800" },
                resourceIds: ["800"],
                changedFields: [],
                channelId: "31",
                authorBot: false,
                privateChannel: false,
                details: { authorId: "20", text: "synthetic member text" },
            }),
        ),
        anchor = await f.admitted()
    for (const record of [text, anchor]) {
        const grant = await f.reserve(record)
        await f.read(await f.claim(grant))
        await f.read(await f.outcome(grant, "failed"))
    }
    f.advance(2592000001)
    await f.cleanup()
    await status(await f.query({ type: "show", recordNo: text.recordNo }), 404)
    assert.equal((await f.show(anchor.recordNo)).delivery!.state, "failed")
})
test("A post reported unsent is tried again, unlike one whose result is unknown", async (t) => {
    const f = await fixture(t)
    await f.open()
    const record = await f.admitted(),
        grant = await f.reserve(record)
    await f.read(await f.claim(grant))
    await f.read(await f.outcome(grant, "failed", undefined, { unsent: true }))
    const shown = await f.show(record.recordNo)
    assert.equal(shown.delivery!.state, "failed")
    assert.equal(shown.delivery!.noDispatch, true)
    // It waits a minute, so the tries do not all fall inside one rate-limit window
    assert.equal((await f.read(await f.work({ type: "discover" }))).records.length, 0)
    f.advance(60000)
    assert.equal((await f.read(await f.work({ type: "discover" }))).records.length, 1)
    // A fresh reservation for the next generation is allowed
    assert.equal((await f.reserve(record)).generation, 2)
})
test("An uncertain post that has a message can be checked, so it is not forgotten", async (t) => {
    const f = await fixture(t)
    await f.open()
    const record = await f.admitted(),
        grant = await f.reserve(record)
    await f.read(await f.claim(grant))
    await f.read(await f.outcome(grant, "uncertain", "700"))
    f.advance(200000)
    await status(await f.manage({ type: "forget", recordNo: record.recordNo, confirm: true }), 409)
})
test("Indexed pages advance past twenty deferred entries without conflating query and work cursors", async (t) => {
    const f = await fixture(t)
    await f.open()
    for (let i = 0; i < 21; i++) await f.admitted()
    const first = await f.read(await f.work({ type: "discover" }))
    assert.equal(first.records.length, 20)
    assert(first.nextCursor)
    const last = await f.read(await f.work({ type: "discover", cursor: first.nextCursor }))
    assert.equal(last.records.length, 1)
    for (const r of first.records as MetadataLogsRecord[])
        await f.read(await f.work({ type: "defer", binding: binding(r.delivery!) }))
    const fair = await f.read(await f.work({ type: "discover" }))
    assert.equal(fair.records.length, 1)
    assert.equal(fair.records[0].recordNo, last.records[0].recordNo)
    // !logs events list shows pages of 10
    const list = await f.read(await f.query({ type: "list" }))
    assert.equal(list.records.length, 10)
    assert(list.nextBeforeRecordNo)
})

test("A post whose log channel is gone fails for good, while a deferred post comes back for its next try", async (t) => {
    const f = await fixture(t)
    await f.open()
    const gone = await f.admitted(),
        later = await f.admitted(),
        reserved = await f.admitted(),
        claimed = await f.admitted()
    const missing = (r: MetadataLogsRecord) => f.work({ type: "destination-missing", binding: binding(r.delivery!) })
    const settled: MetadataLogsRecord = (await f.read(await missing(gone))).record
    assert.equal(settled.delivery!.state, "failed")
    assert.equal(settled.delivery!.noDispatch, true)
    assert.equal(settled.delivery!.problem, "channel")
    // A repeated report changes nothing, and the settled post is never reserved or deferred again
    assert.deepEqual((await f.read(await missing(gone))).record, settled)
    await status(
        await f.work({ type: "reserve", binding: binding(gone.delivery!), context: f.context("10", "30") }),
        409,
    )
    await status(await f.work({ type: "defer", binding: binding(gone.delivery!) }), 409)
    // A reservation nothing claimed settles the same way, while a claimed post keeps its unknown outcome
    await f.reserve(reserved)
    assert.equal((await f.read(await missing(reserved))).record.delivery.problem, "channel")
    await f.read(await f.claim(await f.reserve(claimed)))
    await status(await missing(claimed), 409)
    await f.read(await f.work({ type: "defer", binding: binding(later.delivery!) }))
    f.advance(2592000000 - 1)
    const due = await f.read(await f.work({ type: "discover" }))
    assert.deepEqual(
        due.records.map((r: MetadataLogsRecord) => r.recordNo),
        [later.recordNo],
    )
    const counters = await f.counters()
    assert.equal(counters.failed, 2)
    assert.equal(counters.queued, 1)
    // Staff can forget a post that was never sent
    await f.read(await f.manage({ type: "forget", recordNo: gone.recordNo, confirm: true }))
})

test("Posts wait without polling while DEFCON 1 holds them or logging or their route is off, and come back when allowed again", async (t) => {
    const f = await fixture(t)
    await f.open()
    const discover = async () => {
        const due: number[] = []
        let cursor: string | undefined
        do {
            const page = await f.read(await f.work({ type: "discover", ...(cursor ? { cursor } : {}) }))
            due.push(...page.records.map((r: MetadataLogsRecord) => r.recordNo))
            cursor = page.nextCursor
        } while (cursor)
        return due
    }
    // What the work dispatcher counts as due, which wakes the bot
    const due = () =>
        f.backend.run(
            async (ctx) =>
                (
                    await ctx.db
                        .query("metadataLogRecords")
                        .withIndex("by_global_work", (q) => q.eq("actionable", true).lte("nextCheckAt", f.now()))
                        .collect()
                ).length,
        )
    const turnedOn = () => f.backend.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    // More posts than one wake batch, so allowing delivery again continues in later transactions
    const waiting: number[] = []
    for (let i = 0; i < 101; i++) waiting.push((await f.admitted()).recordNo)
    for (const [pause, resume] of [
        [() => f.module(false), () => f.module(true)],
        [() => f.route("membership", "30", "10", false), () => f.route()],
        // DEFCON 2 allows delivery again
        [() => f.defcon(1), () => f.defcon(2)],
    ] as const) {
        await pause()
        assert.deepEqual(await discover(), [])
        f.advance(3600000)
        assert.equal(await due(), 0)
        assert.deepEqual(await discover(), [])
        await resume()
        await turnedOn()
        assert.equal(await due(), waiting.length)
        assert.deepEqual(await discover(), waiting)
    }
    // Posts that stay paused still expire with their records
    await f.module(false)
    await discover()
    f.advance(2592000000)
    for (let i = 0; i < 6; i++) await f.cleanup()
    assert.equal((await f.counters()).queued, 0)
})

test("Leaving DEFCON 1 wakes held posts only once logging and their route are on again", async (t) => {
    const f = await fixture(t)
    await f.open()
    const discover = async () =>
        (await f.read(await f.work({ type: "discover" }))).records.map((r: MetadataLogsRecord) => r.recordNo)
    const settle = () => f.backend.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    const signal = () => f.backend.run(async (ctx) => (await ctx.db.query("workSignal").first())?.version ?? 0)
    const post = (await f.admitted()).recordNo
    // DEFCON 1 straight to 3. The scheduled wake itself rings the work signal, on top of the DEFCON change's own ring, so the
    // bot dispatches at once
    await f.defcon(1)
    assert.deepEqual(await discover(), [])
    await f.defcon(3)
    const before = await signal()
    await settle()
    assert((await signal()) > before)
    assert.deepEqual(await discover(), [post])
    // DEFCON 1 to 2 rings nothing itself, so only the scheduled wake raises the signal
    await f.defcon(1)
    assert.deepEqual(await discover(), [])
    await f.defcon(2)
    const unchanged = await signal()
    await settle()
    assert((await signal()) > unchanged)
    assert.deepEqual(await discover(), [post])
    // A post that also waits for logging stays parked at DEFCON 2 until logging is on, and its wake rings nothing
    await f.module(false)
    await f.defcon(1)
    assert.deepEqual(await discover(), [])
    await f.defcon(2)
    const parked = await signal()
    await settle()
    assert.equal(await signal(), parked)
    f.advance(3600000)
    const row = await f.backend.run(async (ctx) =>
        (await ctx.db.query("metadataLogRecords").collect()).find((r) => r.recordNo === post)!,
    )
    assert.equal(row.nextCheckAt, row.expiresAt)
    assert.deepEqual(await discover(), [])
    await f.module(true)
    await settle()
    assert.deepEqual(await discover(), [post])
})

test("Private DM reports bind the reading admin, the bot and that DM", async (t) => {
    const f = await fixture(t),
        dm = { ...f.context("10", "90"), channelType: 1 as const }
    await f.read(await f.query({ type: "counters" }, dm))
    await f.read(await f.query({ type: "settings" }, dm))
    await f.read(await f.query({ type: "list" }, dm))
    // The contract requires oneToOne: true, so a false value is rejected during decoding
    await status(
        await f.post("/metadata-logs/query", {
            serverId: "1",
            context: dm,
            privateRead: { ...f.privateRead, oneToOne: false },
            operation: { type: "counters" },
        }),
        400,
    )
    for (const privateRead of [
        { ...f.privateRead, recipientIds: ["10", "999", "20"] },
        { ...f.privateRead, channelId: "91" },
    ])
        await status(
            await f.post("/metadata-logs/query", {
                serverId: "1",
                context: dm,
                privateRead,
                operation: { type: "counters" },
            }),
            403,
        )
    await status(await f.query({ type: "diagnose", section: "core" }, dm), 400)
    assert.equal((await f.counters()).retainedMetadataRecords, 0)
    // Status and counters may answer in a server channel, without a private proof
    for (const operation of [{ type: "counters" }, { type: "settings" }])
        await f.read(await f.post("/metadata-logs/query", { serverId: "1", context: f.context(), operation }))
})

test("Current ticket-slot and moderation-case counters use owning indexed state rather than open-only scans", async (t) => {
    const f = await fixture(t)
    await f.backend.run(async (ctx) => {
        // Cases are numbered by the moderation settings row, which the counter reads
        const moderation = await ctx.db
            .query("moderationSettings")
            .withIndex("by_server", (q) => q.eq("serverId", "1"))
            .unique()
        if (moderation) await ctx.db.patch(moderation._id, { nextCaseNo: 10 })
        else
            await ctx.db.insert("moderationSettings", {
                serverId: "1",
                config: defaultSettings(),
                nextCaseNo: 10,
                nextAppealNo: 1,
            })
        for (let caseNo = 1; caseNo <= 9; caseNo++)
            await ctx.db.insert("moderationCases", {
                serverId: "1",
                caseNo,
                sourceId: String(1000 + caseNo),
                action: "log",
                origin: "manual",
                reason: "Synthetic case",
                createdAt: 1,
                expiresAt: 2,
                outcome: "succeeded",
                logOutcome: "none",
                notificationOutcome: "none",
                erased: false,
                voided: false,
                blocksPublic: false,
                correctionCount: 0,
            })
        const category = {
            name: "help",
            revision: 1,
            enabled: true,
            visibility: "private" as const,
            description: "",
            parentId: null,
            supportRoleIds: [],
            questions: [],
            cannedReplies: [],
        }
        for (let ticketNo = 1; ticketNo <= 6; ticketNo++)
            await ctx.db.insert("tickets", {
                serverId: "1",
                ticketNo,
                intakeNo: ticketNo,
                requesterId: "2",
                requesterJoinedAt: "2026-01-01T00:00:00.000Z",
                category,
                answers: [],
                state: "open",
                generation: 1,
                botId: "3",
                createdAt: 0,
                priority: "normal",
                entryCount: 0,
                active: ticketNo <= 5,
                nativeProtected: false,
                bodiesProtected: false,
                completedSteps: 0,
                erased: false,
                erasing: false,
            })
        // Active tickets are counted by the ticket settings row, which the counter reads
        await ctx.db.insert("ticketSettings", {
            serverId: "1",
            config: { enabled: true, retentionDays: 30 },
            nextCategoryRevision: 2,
            nextIntakeNo: 7,
            nextTicketNo: 7,
            nextEntryNo: 1,
            nextAttemptNo: 1,
            nextTranscriptNo: 1,
            activeTickets: 5,
        })
    })
    const counts = await f.counters()
    assert.equal(counts.retainedModerationCases, 9)
    assert.equal(counts.activeTicketSlots, 5)
    assert.match(counts.definitions.tickets, /reserved and recovery/)
})

test("Automatic security DEFCON settings hooks use exact backend transactions with no invented human actor", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.read(
        await f.post("/moderation/manage", {
            ...f.source(),
            actor: owner,
            operation: {
                type: "settings",
                patch: {
                    securityEnabled: true,
                    securityMode: "enforce",
                    joinEnabled: true,
                    joinThreshold: 2,
                    joinDefcon2: true,
                },
            },
        }),
    )
    const join = async (userId: string) =>
        f.read(
            await f.post("/moderation/join", {
                serverId: "1",
                userId,
                joinedAt: f.now(),
                targetIsStaff: false,
                context: {
                    botActionAuthorized: true,
                    actorCanManageTarget: true,
                    botCanManageTarget: true,
                    targetProtected: false,
                    botId: "999",
                },
            }),
        )
    await join("20")
    const first = await join("21")
    assert.equal(first.settings.defcon, 2)
    const logs = (await f.read(await f.query({ type: "list" }))).records.filter(
        (r: MetadataLogsRecord) => r.event.source.kind === "settings" && r.event.source.scope === "security",
    )
    assert.equal(logs.length, 1)
    assert.deepEqual(logs[0].event.actor, { kind: "unknown" })
    assert.equal(logs[0].event.source.messageId, String(first.case.caseNo))
    assert.deepEqual(logs[0].event.changedFields, ["defcon"])
    await join("21")
    assert.equal((await f.counters()).categories.settings, 3)
    await f.defcon(3)
    f.advance(11000)
    await join("22")
    const second = await join("23")
    assert.equal(second.settings.defcon, 2)
    const final = (await f.read(await f.query({ type: "list" }))).records.filter(
        (r: MetadataLogsRecord) => r.event.source.kind === "settings" && r.event.source.scope === "security",
    )
    assert.equal(final.length, 2)
    assert.notEqual(final[0].event.source.messageId, final[1].event.source.messageId)
})

test("Route disable remains available at DEFCON one while new destination configuration stays guarded", async (t) => {
    const f = await fixture(t)
    await f.open()
    const r = await f.admitted()
    await f.defcon(1)
    await f.route("membership", "30", "10", false)
    const row = await f.show(r.recordNo)
    assert.equal(row.delivery!.state, "queued")
    await status(await f.work({ type: "reserve", binding: binding(row.delivery!), context: f.context() }), 409)
    await status(
        await f.manage({
            type: "route",
            category: "membership",
            expectedRevision: (await f.settings()).routes.find((r: { category: string }) => r.category === "membership")
                .revision,
            channelId: "31",
            ownerId: "10",
            enabled: false,
            recipientOwner: f.context("10", "31"),
        }),
        403,
    )
})

test("Event overrides inherit groups, explicitly disable and restore inheritance with shared revision fencing", async (t) => {
    const f = await fixture(t)
    await f.open()
    const old = await f.admitted(),
        config = (await f.settings()).configRevision
    const disabled = { type: "event-route", eventType: "member-update", expectedRevision: config, enabled: false }
    await f.read(await f.manage(disabled))
    assert.equal((await f.admitted()).delivery, null)
    assert.equal((await f.reserve(old)).channelId, "30", "Already admitted group work keeps its original binding")
    await status(await f.manage(disabled), 409)
    await f.read(
        await f.manage({
            type: "event-clear",
            eventType: "member-update",
            expectedRevision: (await f.settings()).configRevision,
        }),
    )
    assert.equal((await f.admitted()).delivery!.channelId, "30")
    await status(await f.manage(disabled), 409)
    const current = (await f.settings()).configRevision
    await f.read(
        await f.manage({
            type: "event-route",
            eventType: "member-update",
            expectedRevision: current,
            enabled: true,
            channelId: "31",
            ownerId: "11",
            recipientOwner: f.context("11", "31"),
        }),
    )
    await f.read(
        await f.manage({
            type: "clear",
            category: "membership",
            expectedRevision: (await f.settings()).routes.find((r: { category: string }) => r.category === "membership")
                .revision,
        }),
    )
    const routed = await f.admitted(),
        grant = await f.reserve(routed)
    assert.equal(grant.channelId, "31")
    assert.equal(grant.routeEventType, "member-update")
    await f.read(
        await f.manage({
            type: "event-clear",
            eventType: "member-update",
            expectedRevision: (await f.settings()).configRevision,
        }),
    )
    await status(await f.claim(grant), 409)
    assert.equal((await f.show(routed.recordNo)).delivery!.channelId, "31")
})

test("Individual audit actions override the audit catchall and group without inferring departure causes", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("audit", "32")
    const configure = async (eventType: string, enabled: boolean, channelId?: string) =>
        f.read(
            await f.manage({
                type: "event-route",
                eventType,
                expectedRevision: (await f.settings()).configRevision,
                enabled,
                ...(enabled ? { channelId, ownerId: "10", recipientOwner: f.context("10", channelId) } : {}),
            }),
        )
    await configure("audit-entry", true, "33")
    await configure("audit-entry:20", true, "34")
    await configure("audit-entry:22", false)
    const audit = (action: number): MetadataLogsEvent =>
        f.event({
            category: "audit",
            type: "audit-entry",
            source: { kind: "audit", auditEntryId: String(500 + action) },
            actor: { kind: "audit", userId: "11" },
            auditAction: action,
            changedFields: [],
        })
    const kicked = await f.admitted(audit(20)),
        unbanned = await f.admitted(audit(23)),
        banned = await f.admitted(audit(22))
    assert.equal(kicked.delivery!.channelId, "34")
    assert.equal(kicked.delivery!.routeEventType, "audit-entry:20")
    assert.equal(unbanned.delivery!.channelId, "33")
    assert.equal(banned.delivery, null)
    assert.match(kicked.presentation!.embed.title, /Member kicked/)
    assert.match(unbanned.presentation!.embed.title, /: Audit: Member unbanned$/)
    const departure = await f.admitted(f.event({ type: "member-remove", changedFields: [] }))
    assert.match(departure.presentation!.embed.description, /Departure cause: Unknown/)
    assert.doesNotMatch(departure.presentation!.embed.title, /kick|voluntary/i)
    await status(
        await f.manage({
            type: "event-route",
            eventType: "audit-entry:99",
            expectedRevision: (await f.settings()).configRevision,
            enabled: false,
        }),
        400,
    )
})

test("New immutable embeds preserve category hues and semantic tones", async (t) => {
    const f = await fixture(t)
    await f.open()
    const { metadataEventTypes, metadataEventSelectors, metadataPalette, metadataPresentation, metadataContent } =
        await import("../convex/metadataLogsDomain.ts")
    assert.equal(metadataEventTypes.length, 29)
    assert.equal(metadataEventSelectors.length, 67)
    const addition = await f.admitted(f.event({ type: "member-add", changedFields: [] })),
        departure = await f.admitted(f.event({ type: "member-remove", changedFields: [] })),
        modification = await f.admitted()
    assert.equal(addition.presentation!.embed.color, metadataPalette.membership[0])
    assert.equal(departure.presentation!.embed.color, metadataPalette.membership[1])
    assert.equal(modification.presentation!.embed.color, metadataPalette.membership[2])
    assert.ok(
        addition.presentation!.embed.description.includes(
            `When: <t:${Math.floor(addition.event.observedAt / 1000)}:f>`,
        ),
    )
    assert.ok(
        metadataContent(addition.recordNo, addition.event).endsWith(
            `When: <t:${Math.floor(addition.event.observedAt / 1000)}:f>`,
        ),
    )
    const disconnected = f.event({
        category: "operations",
        type: "gateway-discontinuity",
        outcome: "disconnected",
        changedFields: [],
        resourceIds: [],
    })
    assert.equal(metadataPresentation(1, disconnected, "1").embed.color, metadataPalette.operations[3])
    assert.equal(
        metadataPresentation(1, { ...disconnected, outcome: "reconnected" }, "1").embed.color,
        metadataPalette.operations[0],
    )
    const ambiguous = { ...disconnected }
    delete ambiguous.outcome
    assert.equal(metadataPresentation(1, ambiguous, "1").embed.color, metadataPalette.operations[1])
    const grant = await f.reserve(addition)
    assert.equal(grant.content, "")
    assert.deepEqual(grant.embed, addition.presentation!.embed)
    await f.route("membership", "35")
    assert.deepEqual((await f.show(addition.recordNo)).presentation, addition.presentation)
})

test("A record's text names members, roles and channels as mentions with a timestamp, and the bot's copy matches it exactly", async () => {
    const { metadataContent } = await import("../convex/metadataLogsDomain.ts")
    const { metadataLogContent } = await import("@neonflux/contracts/metadata-logs")
    const source = { kind: "observation", sessionId: "1".repeat(32), sequence: 1 } as const,
        audit = { kind: "audit", auditEntryId: "50" } as const,
        by = { kind: "audit", userId: "10" } as const
    const event = (extra: Partial<MetadataLogsEvent>): MetadataLogsEvent => ({
        category: "membership",
        type: "member-update",
        source,
        observedAt: Date.parse("2026-10-04T20:00:00Z"),
        actor: { kind: "unknown" },
        resourceIds: ["20"],
        changedFields: [],
        count: 1,
        ...extra,
    })
    const cases: [MetadataLogsEvent, string][] = [
        [
            event({ changedFields: ["roles"] }),
            "Event: member-update (membership)\nBy: Unknown\nAbout: <@20>\nChanged: roles\nSource: Fluxer event",
        ],
        [
            event({ category: "audit", type: "audit-entry", source: audit, actor: by, auditAction: 20 }),
            "Event: audit-entry (audit)\nBy: <@10>\nAbout: <@20>\nSource: Audit log",
        ],
        [
            event({
                category: "audit",
                type: "audit-entry",
                source: audit,
                actor: by,
                resourceIds: ["30"],
                auditAction: 32,
            }),
            "About: <@&30>",
        ],
        [
            event({
                category: "audit",
                type: "audit-entry",
                source: audit,
                actor: by,
                resourceIds: ["31"],
                auditAction: 12,
            }),
            "About: <#31>",
        ],
        ...(
            [
                [72, "Messages: 31"],
                [50, "Webhook: 31"],
                [61, "Emoji: 31"],
                [92, "Sticker: 31"],
                [111, "About: <#31>"],
            ] as const
        ).map(([auditAction, about]): [MetadataLogsEvent, string] => [
            event({
                category: "audit",
                type: "audit-entry",
                source: audit,
                actor: by,
                resourceIds: ["31"],
                auditAction,
            }),
            `By: <@10>\n${about}\nSource: Audit log`,
        ]),
        [
            event({
                category: "audit",
                type: "audit-entry",
                source: audit,
                actor: by,
                resourceIds: [],
                auditAction: 21,
            }),
            "Event: audit-entry (audit)\nBy: <@10>\nSource: Audit log",
        ],
        [event({ category: "resources", type: "server-update", resourceIds: ["1"] }), "About: This server"],
        [
            event({
                category: "resources",
                type: "thread-delete",
                resourceIds: ["41", "42"],
                parentChannelId: "31",
                count: 3,
            }),
            "About: <#41>, <#42>\nCount: 3",
        ],
        [
            event({
                category: "messages",
                type: "message-bulk-delete",
                resourceIds: ["600", "601"],
                channelId: "31",
                authorBot: null,
                privateChannel: false,
                count: 2,
            }),
            "Messages: 600, 601\nChannel: <#31>\nCount: 2",
        ],
        [
            event({
                category: "security",
                type: "privilege-change",
                source: audit,
                actor: by,
                resourceIds: ["20", "30"],
                changedFields: ["member-roles", "Administrator"],
            }),
            "About: <@20>, <@&30>\nChanged: member-roles, Administrator",
        ],
        [
            event({
                category: "security",
                type: "webhook-change",
                source: audit,
                actor: by,
                resourceIds: ["70"],
                changedFields: ["created"],
            }),
            "Webhook: 70",
        ],
        [
            event({
                category: "settings",
                type: "settings-change",
                source: { kind: "dashboard-setting", scope: "general", revision: 2 },
                actor: { kind: "configuration", userId: "10" },
                resourceIds: [],
                changedFields: ["configuration"],
            }),
            "Event: settings-change (settings)\nBy: <@10>\nChanged: configuration\nSource: Dashboard",
        ],
    ]
    for (const [value, expected] of cases) {
        const text = metadataContent(7, value)
        assert.equal(metadataLogContent(7, value), text)
        assert.ok(
            text.startsWith("Metadata #7\n") && text.endsWith("\nWhen: <t:1791144000:f>") && text.includes(expected),
            text,
        )
    }
})

test("Full immutable embed reconciliation rejects changed colors, fields and presentation downgrades", async (t) => {
    const f = await fixture(t)
    await f.open()
    const row = await f.admitted(),
        grant = await f.reserve(row)
    await f.read(await f.claim(grant))
    await f.read(await f.outcome(grant, "uncertain", "700"))
    f.advance(130001)
    const observation = {
        messageId: "700",
        channelId: "30",
        botId: "999",
        observedAt: f.now(),
        status: "match",
        content: grant.content,
        embed: grant.embed,
    }
    for (const embed of [
        undefined,
        { ...grant.embed!, color: grant.embed!.color + 1 },
        { ...grant.embed!, description: "Synthetic altered description" },
        { ...grant.embed!, footer: "Synthetic private footer" },
    ]) {
        await status(
            await f.manage({ type: "reconcile", binding: binding(grant), observation: { ...observation, embed } }),
            embed && "footer" in embed ? 400 : 409,
        )
    }
    await f.read(await f.manage({ type: "reconcile", binding: binding(grant), observation }))
    assert.equal((await f.show(row.recordNo)).delivery!.resolution, "match")
})

test("Every override destination is excluded from message admission", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.route("messages", "35")
    await f.read(
        await f.manage({
            type: "event-route",
            eventType: "member-add",
            expectedRevision: (await f.settings()).configRevision,
            enabled: true,
            channelId: "31",
            ownerId: "10",
            recipientOwner: f.context("10", "31"),
        }),
    )
    await f.read(
        await f.manage({
            type: "channels",
            expectedRevision: (await f.settings()).revision,
            messageChannelIds: ["31"],
            excludedChannelIds: [],
        }),
    )
    const deletion = f.event({
        category: "messages",
        type: "message-delete",
        source: { kind: "message-delete", messageId: "800" },
        resourceIds: ["800"],
        changedFields: [],
        channelId: "31",
        authorBot: null,
        privateChannel: false,
    })
    assert.equal((await f.read(await f.admit(deletion))).reason, "excluded")
})

test("Message posts show the author, a jump link, both texts in code blocks and the attachments", async () => {
    const { metadataPresentation } = await import("../convex/metadataLogsDomain.ts")
    const { metadataMessageLink } = await import("@neonflux/contracts/metadata-logs")
    const edit: MetadataLogsEvent = {
        category: "messages",
        type: "message-update",
        source: { kind: "observation", sessionId: "1".repeat(32), sequence: 1 },
        observedAt: Date.parse("2026-10-04T20:00:00Z"),
        actor: { kind: "unknown" },
        resourceIds: ["789"],
        changedFields: ["update"],
        count: 1,
        channelId: "456",
        authorBot: false,
        privateChannel: false,
        details: {
            authorId: "123",
            before: "old text",
            text: "new ``` text",
            attachments: [
                { name: "cat*.png", size: 122880, url: "https://cdn.example.invalid/cat.png" },
                { name: "a (1).png", size: 1024, url: "https://cdn.example.invalid/a (1).png" },
            ],
        },
    }
    const text = metadataPresentation(42, edit, "1").embed.description
    assert.equal(metadataMessageLink("1", "456", "789"), "https://fluxer.app/channels/1/456/789")
    for (const line of [
        "Author: <@123>",
        "Channel: <#456>",
        "Message: [Jump to message](https://fluxer.app/channels/1/456/789)",
        "Attachment: [cat\\*.png](https://cdn.example.invalid/cat.png) (120 KB)",
        "Attachment: [a \\(1\\).png](https://cdn.example.invalid/a%20%281%29.png) (1 KB)",
        "Before:\n```\nold text\n```",
        "After:\n```\nnew `\u200b`\u200b` text\n```",
        "Changed: update",
    ])
        assert.ok(text.includes(line), `${line}\n---\n${text}`)
    // No run of backticks, however long, can close a block
    for (const ticks of ["````", "``````", "end`"]) {
        const fenced = metadataPresentation(46, { ...edit, details: { before: ticks, text: "x" } }, "1").embed
        const inside = fenced.description.split("Before:\n```\n")[1]!.split("\n```")[0]!
        assert.equal(inside.replaceAll("\u200b", ""), ticks)
        assert.doesNotMatch(inside, /``/)
    }
    // A pin of a remembered message keeps its text, which shows once instead of as unavailable earlier text
    const pinned = metadataPresentation(
        47,
        { ...edit, changedFields: ["pinned"], details: { authorId: "123", text: "same text" } },
        "1",
    ).embed.description
    assert.match(pinned, /Text:\n```\nsame text\n```/)
    assert.doesNotMatch(pinned, /Before|After/)
    const unknown = metadataPresentation(43, { ...edit, details: { text: "now", earlierUnknown: true } }, "1").embed
    assert.match(unknown.description, /Before: Earlier text unavailable\nAfter:\n```\nnow\n```/)
    const deleted = metadataPresentation(
        44,
        {
            ...edit,
            type: "message-delete",
            source: { kind: "message-delete", messageId: "789" },
            changedFields: [],
            details: { text: "" },
        },
        "1",
    ).embed
    assert.match(deleted.description, /Text: \(no text\)/)
    assert.match(
        metadataPresentation(
            45,
            {
                ...edit,
                type: "message-delete",
                source: { kind: "message-delete", messageId: "789" },
                changedFields: [],
                details: undefined,
            } as never,
            "1",
        ).embed.description,
        /Text: Unavailable/,
    )
})

test("The largest records stay within one embed description, counting what does not fit", async () => {
    const { metadataPresentation } = await import("../convex/metadataLogsDomain.ts")
    const { metadataPlain, MetadataLogsEvent: schema } = await import("@neonflux/contracts/metadata-logs")
    const { Schema } = await import("effect")
    const valid = Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })
    const message: MetadataLogsEvent = valid({
        category: "messages",
        type: "message-update",
        source: { kind: "observation", sessionId: "1".repeat(32), sequence: 1 },
        observedAt: Date.parse("2026-10-04T20:00:00Z"),
        actor: { kind: "unknown" },
        resourceIds: ["789"],
        changedFields: ["update", "pinned", "flags"],
        count: 1,
        channelId: "456",
        parentChannelId: "455",
        authorBot: false,
        privateChannel: false,
        details: {
            authorId: "123",
            before: "b".repeat(4000),
            text: "a".repeat(4000),
            attachments: Array.from({ length: 10 }, (_, i) => ({
                name: `${i}${"n".repeat(255)}`,
                size: 52428800,
                url: `https://cdn.example.invalid/${"u".repeat(480)}`,
            })),
            attachmentCount: 1000,
        },
    })
    const posted = metadataPresentation(9007199254740991, message, "1").embed.description
    assert.ok(posted.length <= 4096, String(posted.length))
    assert.match(posted, /Before:\n```\nb+…\n```/)
    assert.match(posted, /After:\n```\na+…\n```/)
    assert.match(posted, /\d+ more attachments/)
    assert.match(posted, /When: <t:\d+:f>\nParent channel: <#455>$/)
    const audit: MetadataLogsEvent = valid({
        category: "audit",
        type: "audit-entry",
        source: { kind: "audit", auditEntryId: "50" },
        observedAt: Date.parse("2026-10-04T20:00:00Z"),
        actor: { kind: "audit", userId: "10" },
        resourceIds: ["20"],
        changedFields: [],
        count: 1,
        auditAction: 31,
        details: {
            changes: Array.from({ length: 20 }, (_, i) => ({
                field: `key_${i}`,
                before: "x".repeat(300),
                after: "y".repeat(300),
            })),
            moreChanges: 30,
            reason: "r".repeat(512),
        },
    })
    const audited = metadataPresentation(1, audit, "1").embed.description
    assert.ok(audited.length <= 4096, String(audited.length))
    assert.match(audited, /Reason:\n```\nr+\n```/)
    assert.match(audited, /\d+ more changes/)
    assert.match(audited, /\*\*Key_0\*\*: x+ → y+/)
    // A member-chosen name cannot start a line, a mention or formatting
    assert.equal(metadataPlain("**Boss**\n<@1> [x](y)"), "\\*\\*Boss\\*\\* \\<\\@1\\> \\[x\\]\\(y\\)")
    assert.equal(metadataPlain("abcdef", 4), "abc…")
})
