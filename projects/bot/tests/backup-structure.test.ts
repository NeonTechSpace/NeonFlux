import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot, createTestClient, type TestRoute } from "@neontechspace/fluxerly/effect/testing"
import { ChannelFlags, ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import {
    type BackupConfigObject,
    type BackupItem,
    type BackupNativeProof,
    type BackupQueryRequest,
    type BackupStructureObject,
    type BackupWorkRequest,
} from "@neonflux/contracts/backup"
import { createBotOptions } from "../src/bot.ts"
import { backupBinding, backupItemBinding, type BackupStore } from "../src/backup-store.ts"
import { nativeBackupEdit, processBackupPlanPass, reconcileBackupPlan } from "../src/backup.ts"
import { readBackupEvidence, readBackupNativeProof, snapshotBackupChannel } from "../src/backup-permissions.ts"
import { parseBackupCommand } from "../src/backup-command.ts"
import { platform, token } from "./moderation-fixture.ts"
import { ownerChanges, syntheticPlan, withClock } from "./backup-fixture.ts"

const f = createFixtures()
type TestBot = Effect.Success<ReturnType<typeof createTestBot>>
type Wire = ReturnType<TestBot["fixtures"]["channel"]>

test("match is a word of preview and plan and of nothing else", () => {
    assert.deepEqual(parseBackupCommand(["preview", "match"]), { type: "preview", match: true })
    assert.deepEqual(parseBackupCommand(["plan", "match"]), { type: "preview", match: true })
    for (const invalid of [
        ["items", "match"],
        ["confirm", "match"],
        ["preview", "match", "next"],
        ["preview", "all"],
    ])
        assert.match((parseBackupCommand(invalid) as { error: string }).error, /^Invalid backup command/)
})

/** The channel as an edit sees it, read through the SDK from a wire channel, and its snapshot */
const channelFrom = (wire: Wire) =>
    Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        native.rest.respond(`GET /channels/${wire.id}`, { body: wire })
        const channel = yield* native.client.channels.fetch(wire.id)
        return { channel, snapshot: snapshotBackupChannel(channel, 1) }
    })

test("an edit sends only what differs, keeps tag IDs by name and the other flag bits, and converts text to announcement", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const forum = f.channel({
                    type: ChannelType.Forum,
                    name: "help",
                    permission_overwrites: [],
                    flags: ChannelFlags.RequireTag | ChannelFlags.HideMediaDownloadOptions,
                    available_tags: [
                        { id: "7001", name: "Answered", moderated: false, emoji_id: null, emoji_name: null },
                        { id: "7002", name: "Open", moderated: true, emoji_id: null, emoji_name: "x" },
                    ],
                })
                const { channel, snapshot } = yield* channelFrom(forum)
                const wanted: BackupStructureObject = {
                    ...snapshot,
                    tags: [
                        { name: "Answered", moderated: true, emojiId: null, emojiName: null },
                        { name: "New", moderated: false, emojiId: null, emojiName: null },
                    ],
                    requireTag: false,
                }
                assert.deepEqual(nativeBackupEdit(channel, snapshot, wanted), {
                    availableTags: [
                        { id: "7001", name: "Answered", moderated: true, emojiId: null, emojiName: null },
                        { name: "New", moderated: false, emojiId: null, emojiName: null },
                    ],
                    flags: ChannelFlags.HideMediaDownloadOptions,
                })
                // Turning the required tag on keeps the other bits, and nothing else is sent
                assert.deepEqual(
                    nativeBackupEdit(channel, { ...snapshot, requireTag: false }, { ...snapshot, requireTag: true }),
                    { flags: ChannelFlags.RequireTag | ChannelFlags.HideMediaDownloadOptions },
                )
                const text = yield* channelFrom(f.channel({ name: "chat", permission_overwrites: [], topic: "old" }))
                assert.deepEqual(
                    nativeBackupEdit(text.channel, text.snapshot, {
                        ...text.snapshot,
                        type: "announcement",
                        topic: null,
                        overwrites: [{ id: f.ids.guild, type: "role", allow: "0", deny: "1024" }],
                    }),
                    {
                        type: ChannelType.Announcement,
                        topic: null,
                        permissionOverwrites: [{ id: f.ids.guild, type: "role", allow: 0n, deny: 1024n }],
                    },
                )
                assert.deepEqual(nativeBackupEdit(text.channel, text.snapshot, text.snapshot), {})
            }),
        ),
    )
})

type Behaviour = {
    /** What the server does with the edit: it takes it, takes the name only, ignores it or refuses it */
    edit?: "apply" | "name" | "ignore" | "refuse"
    move?: "apply" | "refuse"
    remove?: "apply" | "ignore" | "refuse"
    readBack?: "ok" | "fail"
    /** The channel changes right after the claim decided, before the bot reads it again */
    drift?: (wire: Wire) => Wire
    /** The server lists a channel inside the one written */
    children?: boolean
    /** A channel that follows the one written joins it right after the claim decided */
    lateChild?: boolean
    /** Another executor already holds the claim */
    held?: boolean
    /** Something happens on the server while the edit is answered */
    afterEdit?: (bot: TestBot, p: ReturnType<typeof platform>) => void
    /** Routes of the channels the write names besides its own */
    setup?: (bot: TestBot) => void
    during?: (bot: TestBot, p: ReturnType<typeof platform>, wire: Wire) => TestRoute
}
/**
 * One pass over one update or delete of a channel, against a server that keeps the channel in memory. The fake backend grants the claim with
 * the channel as the server has it and as the archive wants it
 */
const writePass = (
    disposition: "update" | "delete",
    current: (bot: TestBot) => Wire,
    wanted: (snapshot: BackupStructureObject) => BackupStructureObject,
    behaviour: Behaviour = {},
) =>
    Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
            p = platform(bot)
        yield* bot.ready()
        behaviour.setup?.(bot)
        let server: Wire | undefined = current(bot)
        const wire = server
        const requests: { method: string; path: string; body: unknown }[] = []
        let late = false
        bot.rest.respond(`GET /channels/${wire.id}`, () =>
            !server || (behaviour.readBack === "fail" && requests.length)
                ? {
                      status: 404,
                      body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" },
                  }
                : { body: server },
        )
        bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => ({
            body: [
                ...(server ? [server] : []),
                ...(behaviour.children || (behaviour.lateChild && late)
                    ? [
                          {
                              ...bot.fixtures.channel({
                                  id: bot.fixtures.nextId(),
                                  name: "still-here",
                                  parent_id: wire.id,
                                  permission_overwrites: wire.permission_overwrites,
                              }),
                          },
                      ]
                    : []),
            ],
        }))
        bot.rest.respond(`PATCH /channels/${wire.id}`, (request) => {
            const body = request.body as Record<string, unknown>
            requests.push({ method: "PATCH", path: request.path, body })
            behaviour.afterEdit?.(bot, p)
            if (behaviour.edit === "refuse")
                return { status: 400, body: { code: "INVALID_FORM_BODY", message: "Invalid" } }
            if (behaviour.edit !== "ignore" && server)
                server = {
                    ...server,
                    ...(body["name"] !== undefined ? { name: body["name"] as string } : {}),
                    ...(behaviour.edit === "name"
                        ? {}
                        : "topic" in body
                          ? { topic: body["topic"] as string | null }
                          : {}),
                }
            return { body: server }
        })
        bot.rest.respond(`PATCH /guilds/${f.ids.guild}/channels`, (request) => {
            requests.push({ method: "PATCH", path: request.path, body: request.body })
            if (behaviour.move === "refuse")
                return { status: 400, body: { code: "INVALID_FORM_BODY", message: "Invalid" } }
            const [first] = request.body as { parent_id: string | null }[]
            if (server) server = { ...server, parent_id: first!.parent_id }
            return { status: 204 }
        })
        bot.rest.respond(`DELETE /channels/${wire.id}`, (request) => {
            requests.push({ method: "DELETE", path: request.path, body: undefined })
            if (behaviour.remove === "refuse")
                return { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Missing" } }
            if (behaviour.remove !== "ignore") server = undefined
            return { status: 204 }
        })
        const { snapshot } = yield* channelFrom(wire)
        const plan = syntheticPlan({
            planId: "synthetic-write-plan",
            createdAt: Date.now(),
            expiresAt: Date.now() + 900000,
            confirmedAt: Date.now(),
            itemCount: 1,
            counts: { create: 0, update: 0, delete: 0, skip: 0, blocked: 0, [disposition]: 1 },
            match: disposition === "delete",
        })
        const desired = disposition === "update" ? wanted(snapshot) : snapshot
        let item: BackupItem = {
            ...backupBinding(plan),
            itemNo: 1,
            generation: 1,
            category: "structure",
            family: "structure",
            sourceId: wire.id,
            disposition,
            reason: null,
            state: "planned",
            expectedHash: "c".repeat(64),
            desiredHash: "d".repeat(64),
            dependencyItemNo: null,
            mappedId: wire.id,
        }
        const writes: BackupWorkRequest["operation"][] = []
        const store = {
            query: (input: BackupQueryRequest) =>
                Effect.sync(() => {
                    const op = input.operation
                    if (op.type === "plan") return { type: "plan", plan }
                    if (op.type === "items") return { type: "items", items: [item] }
                    if (op.type === "origins") return { type: "origins", origins: [] }
                    if (op.type === "item")
                        // A delete is planned from the server's listing, which holds no permissions
                        return {
                            type: "item",
                            item,
                            object: disposition === "delete" ? { ...desired, overwrites: [] } : desired,
                        }
                    throw new Error(`Unexpected query ${op.type}`)
                }),
            work: (input: BackupWorkRequest) =>
                Effect.gen(function* () {
                    const op = input.operation
                    writes.push(op)
                    if (op.type === "claim") {
                        if (behaviour.during) behaviour.during(bot, p, wire)
                        // The claim hands over the channel as the server has it right now
                        const now = server ? (yield* channelFrom(server)).snapshot : snapshot
                        if (behaviour.drift && server) server = behaviour.drift(server)
                        late = true
                        item = { ...item, state: "claimed" }
                        return {
                            type: "grant",
                            item,
                            grant: {
                                ...backupItemBinding(item),
                                provider: plan.provider,
                                serverId: f.ids.guild,
                                ownerId: f.ids.user,
                                botId: f.ids.bot,
                                sourceId: wire.id,
                                action: disposition,
                                channel: disposition === "update" ? desired : now,
                                from: now,
                                dispatchExpiresAt: plan.expiresAt,
                                nativeDeadlineMs: 5000,
                            },
                            claimed: !behaviour.held,
                        }
                    }
                    if (op.type !== "outcome") throw new Error(`Unexpected work ${op.type}`)
                    item = { ...item, state: op.outcome, mappedId: op.mappedId }
                    return { type: "item", item }
                }),
        } as unknown as BackupStore
        yield* bot.idle()
        const config = { serverId: f.ids.guild } as Parameters<typeof processBackupPlanPass>[1]
        const exit = yield* Effect.exit(Effect.asVoid(processBackupPlanPass(store, config, bot.client, plan, p.dmId)))
        return {
            exit,
            requests,
            outcomes: writes.filter((op): op is Extract<typeof op, { type: "outcome" }> => op.type === "outcome"),
            claims: writes.filter((op) => op.type === "claim").length,
            server,
            snapshot,
        }
    })

const text = (bot: TestBot) => bot.fixtures.channel({ name: "old-name", topic: "old topic", permission_overwrites: [] })

test("an update is written with only what differs and settles as updated when the channel reads back as the grant says", async () => {
    const run = await Effect.runPromise(Effect.scoped(writePass("update", text, (s) => ({ ...s, name: "new-name" }))))
    assert.equal(run.exit._tag, "Success")
    assert.deepEqual(
        run.requests.map((x) => [x.method, x.body]),
        [["PATCH", { name: "new-name" }]],
    )
    assert.equal(run.outcomes.length, 1)
    const [done] = run.outcomes
    assert.equal(done!.outcome, "updated")
    assert.equal(done!.noDispatch, undefined)
    assert.equal(done!.mappedId, run.snapshot.sourceId)
    assert.equal(done!.channel!.name, "new-name")
    assert.equal(run.server!.name, "new-name")
})

test("an update the server only partly took is failed and says what applied, one it ignored changed nothing", async () => {
    const wanted = (s: BackupStructureObject) => ({ ...s, name: "new-name", topic: "new topic" })
    const partly = await Effect.runPromise(Effect.scoped(writePass("update", text, wanted, { edit: "name" })))
    assert.equal(partly.outcomes[0]!.outcome, "failed")
    assert.equal(partly.outcomes[0]!.reason, "Partly applied: name changed, topic not")
    assert.equal(partly.outcomes[0]!.noDispatch, undefined)
    const ignored = await Effect.runPromise(Effect.scoped(writePass("update", text, wanted, { edit: "ignore" })))
    assert.equal(ignored.outcomes[0]!.outcome, "failed")
    assert.equal(ignored.outcomes[0]!.reason, "Fluxer did not change it (name, topic)")
    const refused = await Effect.runPromise(Effect.scoped(writePass("update", text, wanted, { edit: "refuse" })))
    assert.equal(refused.outcomes[0]!.outcome, "failed")
    assert.equal(refused.outcomes[0]!.reason, "Fluxer did not change it (name, topic)")
})

test("an update whose read-back fails after the write is uncertain, and one that never left is failed with no dispatch", async () => {
    const lost = await Effect.runPromise(
        Effect.scoped(writePass("update", text, (s) => ({ ...s, name: "new-name" }), { readBack: "fail" })),
    )
    assert.equal(lost.requests.length, 1)
    assert.equal(lost.outcomes[0]!.outcome, "uncertain")
    assert.equal(lost.outcomes[0]!.noDispatch, undefined)
    // A topic that Fluxer's rules refuse before any request is sent changes nothing
    const unsent = await Effect.runPromise(
        Effect.scoped(writePass("update", text, (s) => ({ ...s, name: "x".repeat(10001) }))),
    )
    assert.equal(unsent.requests.length, 0)
    assert.equal(unsent.outcomes[0]!.outcome, "failed")
    assert.equal(unsent.outcomes[0]!.noDispatch, true)
    assert.equal(unsent.outcomes[0]!.reason, "Fluxer was not reached, so nothing was written")
})

test("an update moves a channel to its category with a reorder after the edit, and a refused move is partly applied", async () => {
    // The category is a channel of the bot's own server, so its ID cannot be another one of the test's
    let parent = ""
    const category = (bot: TestBot) => {
            parent = bot.fixtures.nextId()
            bot.rest.respond(`GET /channels/${parent}`, {
                body: bot.fixtures.channel({ id: parent, type: ChannelType.Category, permission_overwrites: [] }),
            })
        },
        child = (bot: TestBot) => bot.fixtures.channel({ name: "old-name", permission_overwrites: [] })
    const moved = await Effect.runPromise(
        Effect.scoped(
            writePass("update", child, (s) => ({ ...s, name: "new-name", parentId: parent }), { setup: category }),
        ),
    )
    assert.deepEqual(
        moved.requests.map((x) => [x.method, x.path.split("/").slice(1, 3).join("/")]),
        [
            ["PATCH", `channels/${moved.snapshot.sourceId}`],
            ["PATCH", `guilds/${f.ids.guild}`],
        ],
    )
    assert.equal((moved.requests[1]!.body as { id: string; parent_id: string }[])[0]!.parent_id, parent)
    assert.equal(moved.outcomes[0]!.outcome, "updated")
    const refused = await Effect.runPromise(
        Effect.scoped(
            writePass("update", child, (s) => ({ ...s, name: "new-name", parentId: parent }), {
                move: "refuse",
                setup: category,
            }),
        ),
    )
    assert.equal(refused.outcomes[0]!.outcome, "failed")
    assert.equal(refused.outcomes[0]!.reason, "Partly applied: name changed, category not")
})

test("a delete settles as deleted when the channel is gone, and as failed when it is still there", async () => {
    const gone = await Effect.runPromise(Effect.scoped(writePass("delete", text, (s) => s)))
    assert.deepEqual(
        gone.requests.map((x) => x.method),
        ["DELETE"],
    )
    assert.equal(gone.outcomes[0]!.outcome, "deleted")
    assert.equal(gone.outcomes[0]!.channel, null)
    assert.equal(gone.outcomes[0]!.mappedId, gone.snapshot.sourceId)
    const still = await Effect.runPromise(Effect.scoped(writePass("delete", text, (s) => s, { remove: "ignore" })))
    assert.equal(still.outcomes[0]!.outcome, "failed")
    assert.equal(still.outcomes[0]!.reason, "Fluxer did not delete it")
    const refused = await Effect.runPromise(Effect.scoped(writePass("delete", text, (s) => s, { remove: "refuse" })))
    assert.equal(refused.outcomes[0]!.outcome, "failed")
})

test("a category with a channel left in it is not deleted", async () => {
    const run = await Effect.runPromise(
        Effect.scoped(
            writePass(
                "delete",
                (bot) => bot.fixtures.channel({ type: ChannelType.Category, name: "old", permission_overwrites: [] }),
                (s) => s,
                { children: true },
            ),
        ),
    )
    assert.equal(run.requests.length, 0)
    assert.equal(run.outcomes[0]!.outcome, "failed")
    assert.equal(run.outcomes[0]!.noDispatch, true)
})

test("a native proof lists the server's channels with their category, whether they follow it and whether NeonFlux manages them", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot, { botPermissions: Permissions.ManageChannels | Permissions.ViewChannel })
                yield* bot.ready()
                const deny = (bits: bigint) => [{ id: p.targetRole.id, type: 0, allow: "0", deny: bits.toString() }]
                const wire = (patch: Record<string, unknown>) => ({
                    ...bot.fixtures.channel({ id: bot.fixtures.nextId(), permission_overwrites: [], ...patch }),
                    default_thread_rate_limit_per_user: 0,
                })
                const category = wire({ type: 4, name: "Info", permission_overwrites: deny(1024n) }),
                    follows = wire({ name: "rules", parent_id: category.id, permission_overwrites: deny(1024n) }),
                    apart = wire({ name: "staff", parent_id: category.id, permission_overwrites: deny(2048n) }),
                    link = wire({
                        type: 998,
                        name: "dashboard",
                        parent_id: category.id,
                        permission_overwrites: deny(1024n),
                    }),
                    locked = wire({
                        type: 2,
                        name: "lounge",
                        permission_overwrites: [
                            { id: p.botRole.id, type: 0, allow: "0", deny: Permissions.ManageChannels.toString() },
                        ],
                    })
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, {
                    body: [category, follows, apart, link, locked],
                })
                bot.rest.respond(`GET /channels/${category.id}`, { body: category })
                yield* bot.idle()
                const evidence = yield* readBackupEvidence(bot.client, f.ids.guild, f.ids.user, p.dmId)
                const { snapshot } = yield* channelFrom(category as Wire)
                const proof = yield* readBackupNativeProof(
                    bot.client,
                    f.ids.guild,
                    evidence,
                    [snapshot],
                    new Map(),
                    [],
                    true,
                )
                assert.deepEqual(
                    proof.channels.map((c) => [c.name, c.type, c.parentId === category.id, c.synced, c.botCanManage]),
                    [
                        ["Info", "category", false, false, true],
                        ["rules", "text", true, true, true],
                        ["staff", "text", true, false, true],
                        ["dashboard", "link", true, true, true],
                        ["lounge", "voice", false, false, false],
                    ],
                )
                // The permissions NeonFlux has in the channel come with the channel it observed
                assert.equal(proof.observations[0]!.status, "present")
                assert.equal(
                    BigInt(proof.observations[0]!.botPermissions) & Permissions.ManageChannels,
                    Permissions.ManageChannels,
                )
                // Without the listing the proof has no channels
                const plain = yield* readBackupNativeProof(bot.client, f.ids.guild, evidence, [snapshot])
                assert.deepEqual(plain.channels, [])
            }),
        ),
    )
})

test("a thread a setting names is checked through its parent, and one whose parent is gone blocks only its setting", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const thread = bot.fixtures.thread({ id: bot.fixtures.nextId(), type: 11, parent_id: f.ids.channel }),
                    orphan = bot.fixtures.thread({
                        id: bot.fixtures.nextId(),
                        type: 11,
                        parent_id: bot.fixtures.nextId(),
                    })
                bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
                bot.rest.respond(`GET /channels/${orphan.id}`, { body: orphan })
                bot.rest.respond(`GET /channels/${orphan.parent_id}`, {
                    status: 404,
                    body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" },
                })
                yield* bot.idle()
                const evidence = yield* readBackupEvidence(bot.client, f.ids.guild, f.ids.user, p.dmId)
                const leveling: BackupConfigObject = {
                    family: "leveling",
                    sourceId: "leveling",
                    value: {
                        enabled: true,
                        xpPerMessage: 10,
                        cooldownSeconds: 60,
                        excludedChannelIds: [thread.id, orphan.id],
                        excludedRoleIds: [],
                        mappings: [],
                    },
                }
                const proof = yield* readBackupNativeProof(bot.client, f.ids.guild, evidence, [leveling])
                assert.deepEqual(
                    proof.references.map((r) => [r.id, r.type, r.exists, r.actorCanAccess, r.botCanAccess]),
                    [
                        [thread.id, "text", true, true, true],
                        [orphan.id, "text", true, false, false],
                    ],
                )
                assert.equal(p.channel.requests().length, 1)
            }),
        ),
    )
})

test("an update and a delete read the Owner, the DM and the channel again after their claim and write nothing they refuse", async () => {
    for (const disposition of ["update", "delete"] as const) {
        const wanted = (s: BackupStructureObject) => ({ ...s, name: "new-name" })
        for (const [name, change] of Object.entries(ownerChanges)) {
            let changed: TestRoute | undefined
            const run = await Effect.runPromise(
                Effect.scoped(
                    writePass(disposition, text, wanted, {
                        during: (bot, p) => (changed = change(bot, p)),
                    }),
                ),
            )
            const label = `${disposition}: ${name}`
            assert.equal(run.claims, 1, label)
            assert.equal(changed!.requests().length > 0, true, label)
            assert.equal(run.requests.length, 0, label)
            assert.deepEqual(
                run.outcomes.map((o) => [o.outcome, o.noDispatch, o.reason]),
                [["failed", true, "Nothing was written: the channel or its permissions changed just before the write"]],
                label,
            )
        }
        // The channel is not the one the claim decided about
        const run = await Effect.runPromise(
            Effect.scoped(
                writePass(disposition, text, wanted, { drift: (wire) => ({ ...wire, name: "somebody-else" }) }),
            ),
        )
        assert.equal(run.requests.length, 0, disposition)
        assert.deepEqual(
            run.outcomes.map((o) => [o.outcome, o.noDispatch, o.reason]),
            [["failed", true, "Nothing was written: the channel or its permissions changed just before the write"]],
            disposition,
        )
        assert.equal(run.server!.name, "somebody-else")
    }
})

test("an update and a delete whose channel read after the claim fails say Fluxer could not be read, not that it changed", async () => {
    // The first read after the claim is the proof's, the second is the one the write is built from
    for (const disposition of ["update", "delete"] as const)
        for (const failing of [1, 2]) {
            let reads = 0
            const run = await Effect.runPromise(
                Effect.scoped(
                    writePass(disposition, text, (s) => ({ ...s, name: "new-name" }), {
                        during: (bot, _p, wire) =>
                            bot.rest.respond(`GET /channels/${wire.id}`, () =>
                                ++reads === failing
                                    ? {
                                          status: 429,
                                          body: { message: "Synthetic limit", retry_after: 120, global: false },
                                      }
                                    : { body: wire },
                            ),
                    }),
                ),
            )
            const label = `${disposition}: read ${failing}`
            assert.equal(reads >= failing, true, label)
            assert.equal(run.requests.length, 0, label)
            assert.deepEqual(
                run.outcomes.map((o) => [o.outcome, o.noDispatch, o.reason]),
                [["failed", true, "Nothing was written because Fluxer could not be read. A new preview retries it"]],
                label,
            )
        }
    // A channel deleted right before the write was read, and found changed
    for (const disposition of ["update", "delete"] as const) {
        let reads = 0
        const run = await Effect.runPromise(
            Effect.scoped(
                writePass(disposition, text, (s) => ({ ...s, name: "new-name" }), {
                    during: (bot, _p, wire) =>
                        bot.rest.respond(`GET /channels/${wire.id}`, () =>
                            ++reads === 2
                                ? { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } }
                                : { body: wire },
                        ),
                }),
            ),
        )
        assert.deepEqual(
            run.outcomes.map((o) => [o.outcome, o.noDispatch, o.reason]),
            [["failed", true, "Nothing was written: the channel or its permissions changed just before the write"]],
            disposition,
        )
    }
})

test("a reconcile reads only the channels a restore created, never an update or a delete that was not confirmed", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const plan = syntheticPlan({
                    planId: "synthetic-reconcile-plan",
                    createdAt: Date.now(),
                    expiresAt: Date.now() + 900000,
                    confirmedAt: Date.now(),
                    itemCount: 2,
                    counts: { create: 0, update: 1, delete: 1, skip: 0, blocked: 0 },
                    match: true,
                })
                const unknown = (itemNo: number, disposition: "update" | "delete"): BackupItem => ({
                    ...backupBinding(plan),
                    itemNo,
                    generation: 1,
                    category: "structure",
                    family: "structure",
                    sourceId: bot.fixtures.nextId(),
                    disposition,
                    reason: null,
                    state: "uncertain",
                    expectedHash: "c".repeat(64),
                    desiredHash: "d".repeat(64),
                    dependencyItemNo: null,
                    mappedId: bot.fixtures.nextId(),
                })
                const items = [unknown(1, "update"), unknown(2, "delete")]
                const calls: string[] = []
                const store = {
                    query: (input: BackupQueryRequest) =>
                        Effect.sync(() => {
                            calls.push(input.operation.type)
                            const op = input.operation
                            if (op.type === "plan") return { type: "plan", plan }
                            if (op.type === "items") return { type: "items", items }
                            if (op.type === "origins") return { type: "origins", origins: [] }
                            throw new Error(`Unexpected query ${op.type}`)
                        }),
                    work: () => Effect.sync(() => calls.push("work")),
                } as unknown as BackupStore
                yield* bot.idle()
                const config = { serverId: f.ids.guild } as Parameters<typeof reconcileBackupPlan>[1]
                const checked = yield* reconcileBackupPlan(store, config, bot.client, plan, p.dmId)
                assert.deepEqual(checked, [])
                assert.equal(calls.includes("work"), false)
                assert.equal(calls.includes("item"), false)
            }),
        ),
    )
})

test("an update and a delete check the Owner and the DM once more after their last channel read, right before the write", async () => {
    // Each change lands while the channel is read the second time after the claim, after the post-claim proof's own Owner check
    for (const disposition of ["update", "delete"] as const)
        for (const [name, change] of Object.entries(ownerChanges)) {
            let changed: TestRoute | undefined,
                reads = 0
            const run = await Effect.runPromise(
                Effect.scoped(
                    writePass(disposition, text, (s) => ({ ...s, name: "new-name" }), {
                        during: (bot, p, wire) =>
                            bot.rest.respond(`GET /channels/${wire.id}`, () => {
                                if (++reads === 2) changed = change(bot, p)
                                return { body: wire }
                            }),
                    }),
                ),
            )
            const label = `${disposition}: ${name}`
            assert.equal(changed!.requests().length > 0, true, label)
            assert.equal(run.requests.length, 0, label)
            assert.deepEqual(
                run.outcomes.map((o) => [o.outcome, o.noDispatch, o.reason]),
                [["failed", true, "Nothing was written: the Owner or the DM check failed"]],
                label,
            )
        }
})

const everyone = [{ id: f.ids.guild, type: 0, allow: "0", deny: "1024" }]

test("a delete needs no references for the permissions of the channel it removes", async () => {
    const run = await Effect.runPromise(
        Effect.scoped(
            writePass(
                "delete",
                (bot) => bot.fixtures.channel({ name: "old", permission_overwrites: everyone }),
                (s) => s,
            ),
        ),
    )
    assert.deepEqual(
        run.requests.map((x) => x.method),
        ["DELETE"],
    )
    assert.equal(run.outcomes[0]!.outcome, "deleted")
})

test("an update does not write with a claim another executor holds", async () => {
    const run = await Effect.runPromise(
        Effect.scoped(writePass("update", text, (s) => ({ ...s, name: "new-name" }), { held: true })),
    )
    assert.equal(run.requests.length, 0)
    assert.equal(run.outcomes.length, 0)
})

test("a category's new permissions are not sent when a channel that follows it joined after the claim", async () => {
    const category = (bot: TestBot) =>
        bot.fixtures.channel({ type: ChannelType.Category, name: "Info", permission_overwrites: everyone })
    const wanted = (s: BackupStructureObject): BackupStructureObject => ({
        ...s,
        overwrites: [{ id: f.ids.guild, type: "role", allow: "0", deny: "0" }],
    })
    const quiet = await Effect.runPromise(Effect.scoped(writePass("update", category, wanted)))
    assert.equal(quiet.requests.length, 1, "without the late channel the change is written")
    const run = await Effect.runPromise(Effect.scoped(writePass("update", category, wanted, { lateChild: true })))
    assert.equal(run.requests.length, 0)
    assert.deepEqual(
        run.outcomes.map((o) => [o.outcome, o.noDispatch]),
        [["failed", true]],
    )
})

test("an update keeps the overwrite of a member who is gone and that the channel already holds", async () => {
    let gone = ""
    const run = await Effect.runPromise(
        Effect.scoped(
            writePass(
                "update",
                (bot) =>
                    bot.fixtures.channel({
                        name: "old-name",
                        permission_overwrites: [{ id: gone, type: 1, allow: "0", deny: "1024" }],
                    }),
                (s) => ({ ...s, name: "new-name" }),
                {
                    setup: (bot) => {
                        gone = bot.fixtures.nextId()
                        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${gone}`, {
                            status: 404,
                            body: { code: "UNKNOWN_MEMBER", message: "Unknown Member" },
                        })
                    },
                },
            ),
        ),
    )
    assert.deepEqual(
        run.requests.map((x) => x.body),
        [{ name: "new-name" }],
    )
    assert.equal(run.outcomes[0]!.outcome, "updated")
})

test("an update checks the Owner again before its second request", async () => {
    // The change lands while the edit is answered, so the move that follows it is not sent and what applied is read back
    let parent = ""
    const between = await Effect.runPromise(
        Effect.scoped(
            writePass(
                "update",
                (bot) => bot.fixtures.channel({ name: "old-name", permission_overwrites: [] }),
                (s) => ({
                    ...s,
                    name: "new-name",
                    parentId: parent,
                }),
                {
                    setup: (bot) => {
                        parent = bot.fixtures.nextId()
                        bot.rest.respond(`GET /channels/${parent}`, {
                            body: bot.fixtures.channel({
                                id: parent,
                                type: ChannelType.Category,
                                permission_overwrites: [],
                            }),
                        })
                    },
                    afterEdit: (bot, p) => ownerChanges["the server changed owner"]!(bot, p),
                },
            ),
        ),
    )
    assert.deepEqual(
        between.requests.map((x) => x.path.startsWith("/channels/")),
        [true],
    )
    assert.equal(between.outcomes[0]!.outcome, "failed")
    assert.equal(between.outcomes[0]!.reason, "Partly applied: name changed, category not")
})

test("an update does not write once its grant has run out", async () => {
    // The clock stands still until a read of the channel moves it past the grant
    let now = 0,
        reads = 0
    const late = await Effect.runPromise(
        Effect.scoped(
            withClock(() => now)(
                writePass("update", text, (s) => ({ ...s, name: "new-name" }), {
                    during: (bot, _p, wire) =>
                        bot.rest.respond(`GET /channels/${wire.id}`, () => {
                            if (++reads === 2) now = Date.now() + 900_001
                            return { body: wire }
                        }),
                }),
            ),
        ),
    )
    assert.equal(late.requests.length, 0)
    assert.equal(late.outcomes[0]!.reason, "Nothing was written: the step ran out of time")
    assert.deepEqual(
        late.outcomes.map((o) => [o.outcome, o.noDispatch]),
        [["failed", true]],
    )
})

type Kind =
    "identical channel" | "identical setting" | "identical xp" | "channel update" | "setting update" | "xp update"
/**
 * One pass over a plan that holds the items named, against a server that keeps the channels in memory. It counts the requests the pass sent to
 * Fluxer by route. Like the backend, the store refuses a context, and a proof with any observation or reference, older than 60 seconds. Every item
 * it settles moves the clock on by stepMs, every page of items or of the origins it holds, 20 to a page, by pageMs, and when memberMs is set every
 * channel allows `members` members of its own, whose reads take memberMs, and when authorityMs is set each of the four reads of an Owner and DM
 * check, which is the server, its roles and the two members, takes that long. queryMs is what each read of an item from the backend takes, listMs the read of the server's channels, applyMs the request that settles an item before the backend judges its evidence, and with
 * shared every channel names the same members
 */
const costPass = (
    kinds: readonly Kind[],
    {
        stepMs = 0,
        pageMs = 0,
        origins = 0,
        memberMs = 0,
        members = 1,
        authorityMs = 0,
        queryMs = 0,
        listMs = 0,
        applyMs = 0,
        shared = false,
    } = {},
) =>
    Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
            p = platform(bot)
        yield* bot.ready()
        const time = { now: Date.now() }
        if (authorityMs) {
            const slow = (body: unknown) => () => {
                time.now += authorityMs
                return { body }
            }
            bot.rest.respond(`GET /guilds/${f.ids.guild}`, slow(bot.fixtures.guild({ owner_id: f.ids.user })))
            bot.rest.respond(`GET /guilds/${f.ids.guild}/roles`, slow(p.roles))
            bot.rest.respond(
                `GET /guilds/${f.ids.guild}/members/${f.ids.user}`,
                slow(bot.fixtures.member({ roles: [p.actorRole.id], communication_disabled_until: null })),
            )
            bot.rest.respond(
                `GET /guilds/${f.ids.guild}/members/${f.ids.bot}`,
                slow(
                    bot.fixtures.member({
                        user: bot.fixtures.botUser(),
                        roles: [p.botRole.id],
                        communication_disabled_until: null,
                    }),
                ),
            )
        }
        const servers = new Map<string, Wire>()
        let sharing: { id: string; type: number; allow: string; deny: string }[] | undefined
        const overwritesFor = () =>
            memberMs
                ? Array.from({ length: members }, () => {
                      const memberId = bot.fixtures.nextId()
                      bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${memberId}`, () => {
                          time.now += memberMs
                          return {
                              body: bot.fixtures.member({
                                  user: bot.fixtures.user({ id: memberId }),
                                  roles: [],
                                  communication_disabled_until: null,
                              }),
                          }
                      })
                      return { id: memberId, type: 1, allow: "1024", deny: "0" }
                  })
                : []
        const channelFor = () => {
            const overwrites = shared ? (sharing ??= overwritesFor()) : overwritesFor()
            const wire = bot.fixtures.channel({ name: "old-name", permission_overwrites: overwrites })
            servers.set(wire.id, wire)
            bot.rest.respond(`GET /channels/${wire.id}`, () => ({ body: servers.get(wire.id) }))
            return wire
        }
        bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
            time.now += listMs
            return { body: [...servers.values()] }
        })
        bot.rest.respond("PATCH /channels/:id", (request) => {
            const id = request.path.split("/")[2]!,
                body = request.body as { name: string }
            servers.set(id, { ...servers.get(id)!, name: body.name })
            return { body: servers.get(id) }
        })
        const plan = syntheticPlan({
            planId: "synthetic-cost-plan",
            createdAt: Date.now(),
            expiresAt: Date.now() + 900000,
            confirmedAt: Date.now(),
            itemCount: kinds.length,
            counts: { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 },
        })
        // The cleanup policies name this channel, which their proof reads
        const named = channelFor()
        const rows = yield* Effect.forEach(kinds, (kind, i) =>
            Effect.gen(function* () {
                const channel = kind.endsWith("channel") || kind === "channel update" ? channelFor() : undefined,
                    id = channel?.id ?? bot.fixtures.nextId()
                const item: BackupItem = {
                    ...backupBinding(plan),
                    itemNo: i + 1,
                    generation: 1,
                    category: channel ? "structure" : kind.includes("xp") ? "xp" : "config",
                    family: channel ? "structure" : kind.includes("xp") ? "xp" : "cleanupPolicy",
                    sourceId: id,
                    disposition: kind.startsWith("identical") ? "skip" : "update",
                    reason: null,
                    state: "planned",
                    expectedHash: "c".repeat(64),
                    desiredHash: "d".repeat(64),
                    dependencyItemNo: null,
                    mappedId: channel?.id ?? null,
                }
                if (channel) {
                    const { snapshot } = yield* channelFrom(channel)
                    return { item, object: kind === "channel update" ? { ...snapshot, name: "new-name" } : snapshot }
                }
                return {
                    item,
                    object: kind.includes("xp")
                        ? { sourceId: id, userId: f.ids.user, xp: 5 }
                        : { family: "cleanupPolicy", sourceId: id, value: { channelId: named.id, enabled: true } },
                }
            }),
        )
        const items = rows.map((r) => r.item)
        const natives: (BackupNativeProof | null)[] = []
        const fresh = (context: { observedAt: number }, native?: BackupNativeProof | null) => {
            const stamps = native
                ? [
                      native.observedAt,
                      ...native.references.map((r) => r.observedAt),
                      ...native.observations.map((o) => o.observedAt),
                  ]
                : []
            if ([context.observedAt, ...stamps].some((at) => at < time.now - 60000)) throw new Error("Stale evidence")
        }
        // A page of 20, with the clock moved on by what reading it took
        const page = <T>(all: readonly T[], cursor: string | undefined) => {
            time.now += pageMs
            const start = Number(cursor ?? 0)
            return {
                page: all.slice(start, start + 20),
                ...(start + 20 < all.length ? { nextCursor: String(start + 20) } : {}),
            }
        }
        const held = Array.from({ length: origins }, (_, i) => ({
            category: "structure",
            sourceId: String(9000000 + i),
            mappedId: String(9500000 + i),
        }))
        const store = {
            query: (input: BackupQueryRequest) =>
                Effect.sync(() => {
                    fresh(input.context)
                    const op = input.operation
                    if (op.type === "plan") return { type: "plan", plan }
                    if (op.type === "items") {
                        const { page: shown, nextCursor } = page(items, op.cursor)
                        return { type: "items", items: shown, ...(nextCursor ? { nextCursor } : {}) }
                    }
                    if (op.type === "origins") {
                        const { page: shown, nextCursor } = page(held, op.cursor)
                        return { type: "origins", origins: shown, ...(nextCursor ? { nextCursor } : {}) }
                    }
                    if (op.type === "item") {
                        time.now += queryMs
                        return {
                            type: "item",
                            item: items[op.binding.itemNo - 1],
                            object: rows[op.binding.itemNo - 1]!.object,
                        }
                    }
                    throw new Error(`Unexpected query ${op.type}`)
                }),
            work: (input: BackupWorkRequest) =>
                Effect.gen(function* () {
                    const op = input.operation,
                        i = (op.binding as { itemNo: number }).itemNo - 1
                    if (op.type !== "outcome") time.now += applyMs
                    if (op.type !== "outcome") fresh(op.context, "native" in op ? op.native : undefined)
                    if (op.type === "apply") {
                        natives.push(op.native)
                        time.now += stepMs
                        items[i] = { ...items[i]!, state: items[i]!.disposition === "skip" ? "skipped" : "updated" }
                        return { type: "item", item: items[i] }
                    }
                    if (op.type === "claim") {
                        items[i] = { ...items[i]!, state: "claimed" }
                        return {
                            type: "grant",
                            item: items[i],
                            grant: {
                                ...backupItemBinding(items[i]!),
                                provider: plan.provider,
                                serverId: f.ids.guild,
                                ownerId: f.ids.user,
                                botId: f.ids.bot,
                                sourceId: items[i]!.sourceId,
                                action: "update",
                                channel: rows[i]!.object,
                                from: (yield* channelFrom(servers.get(items[i]!.sourceId)!)).snapshot,
                                dispatchExpiresAt: plan.expiresAt,
                                nativeDeadlineMs: 5000,
                            },
                            claimed: true,
                        }
                    }
                    if (op.type !== "outcome") throw new Error(`Unexpected work ${op.type}`)
                    items[i] = { ...items[i]!, state: op.outcome, mappedId: op.mappedId }
                    return { type: "item", item: items[i] }
                }),
        } as unknown as BackupStore
        yield* bot.idle()
        const before = bot.requests().length
        const config = { serverId: f.ids.guild } as Parameters<typeof processBackupPlanPass>[1]
        const exit = yield* Effect.exit(
            Effect.asVoid(processBackupPlanPass(store, config, bot.client, plan, p.dmId)).pipe(
                withClock(() => time.now),
            ),
        )
        const routes: Record<string, number> = {}
        for (const request of bot.requests().slice(before)) {
            const route = `${request.method} ${request.path.replace(/\d{6,}/g, ":id")}`
            routes[route] = (routes[route] ?? 0) + 1
        }
        return { exit, routes, total: bot.requests().length - before, states: items.map((x) => x.state), natives }
    })

test("a pass opens with one read of the Owner and the DM, reads nothing for an identical item and checks again only before a write", async () => {
    const cost = async (kinds: Kind[]) => {
        const run = await Effect.runPromise(Effect.scoped(costPass(kinds)))
        assert.equal(run.exit._tag, "Success")
        return run
    }
    // The opening check reads the server, its roles, the Owner, the bot and the DM
    const opening = await cost([])
    assert.deepEqual(opening.routes, {
        "GET /guilds/:id": 1,
        "GET /guilds/:id/roles": 1,
        "GET /guilds/:id/members/:id": 2,
        "GET /channels/:id": 1,
    })
    for (const kind of ["identical setting", "identical xp"] as const) {
        const run = await cost([kind, kind, kind])
        assert.equal(run.total, opening.total, kind)
        assert.deepEqual(run.states, ["skipped", "skipped", "skipped"], kind)
        assert.deepEqual(run.natives, [null, null, null], kind)
    }
    // An identical archive channel is decided again, so the pass observes them all from one read of the server's channels and sends that evidence
    const channels = await cost(["identical channel", "identical channel", "identical channel"])
    assert.equal(channels.total, opening.total + 1)
    assert.deepEqual(channels.states, ["skipped", "skipped", "skipped"])
    assert.deepEqual(
        channels.natives.map((n) => n?.observations.map((o) => o.status)),
        [
            ["present", "present", "present"],
            ["present", "present", "present"],
            ["present", "present", "present"],
        ],
    )
    assert.equal(new Set(channels.natives).size, 1)
    // A channel write can change the channels after it, so the identical ones that follow are read again
    const between = await cost(["identical channel", "channel update", "identical channel"])
    assert.equal(between.total, opening.total + 1 + 22 + 1)
    assert.equal(new Set(between.natives.filter((n) => n)).size, 2)
    // A write checks again before it records anything and right before each request, and a channel also reads itself and the server's channels
    // for the proof before and after its claim. A setting reads what it names, and an XP correction needs only the last check
    const extra = async (kind: Kind) => (await cost([kind])).total - opening.total
    assert.equal(await extra("channel update"), 22)
    assert.equal(await extra("setting update"), 6)
    assert.equal(await extra("xp update"), 5)
})

test("a plan of eighteen items with two changes costs the opening check and those two writes", async () => {
    const identical: Kind[] = [
        ...Array.from({ length: 7 }, () => "identical channel" as const),
        ...Array.from({ length: 5 }, () => "identical setting" as const),
        ...Array.from({ length: 4 }, () => "identical xp" as const),
    ]
    const run = await Effect.runPromise(Effect.scoped(costPass([...identical, "channel update", "setting update"])))
    assert.equal(run.exit._tag, "Success")
    assert.deepEqual(new Set(run.states.slice(0, 16)), new Set(["skipped"]))
    assert.deepEqual(run.states.slice(16), ["updated", "updated"])
    assert.equal(run.total, 5 + 1 + 22 + 6)
})

test("a pass reads the Owner, the DM and the identical channels again once they are 30 seconds old, so the backend never sees them stale", async () => {
    const cost = async (kinds: Kind[], stepMs: number) => {
        const run = await Effect.runPromise(Effect.scoped(costPass(kinds, { stepMs })))
        assert.equal(run.exit._tag, "Success")
        return run
    }
    // Each item takes 61 seconds, as a pass does that waits out rate limits. Without a new read the backend refuses the next item's evidence
    const slow = await cost(["setting update", "setting update", "identical xp"], 61_000)
    assert.deepEqual(slow.states, ["updated", "updated", "skipped"])
    // The opening check, each setting's own check and a new opening check before the second setting and the XP item
    assert.equal(slow.total, 5 + 6 + 5 + 6 + 5)
    // The channels' read is renewed with it, and a pass that moves fast reads neither again
    const channels = await cost(["identical channel", "identical xp", "identical channel"], 31_000)
    assert.equal(new Set(channels.natives.filter((n) => n)).size, 2)
    assert.deepEqual(channels.states, ["skipped", "skipped", "skipped"])
    const fast = await cost(["setting update", "setting update"], 1_000)
    assert.equal(fast.total, 5 + 6 + 6)
})

test("a pass renews its Owner and DM check between the pages of the plan's items and of the origins, so the backend never sees it stale", async () => {
    const cost = async (kinds: Kind[], options: { pageMs?: number; origins?: number }) => {
        const run = await Effect.runPromise(Effect.scoped(costPass(kinds, options)))
        assert.equal(run.exit._tag, "Success")
        return run
    }
    // 22 pages of items at 3 seconds each is 66 seconds, so the opening check is renewed twice on the way and the first 20 items settle
    const manyItems = await cost(
        Array.from({ length: 440 }, () => "identical xp" as const),
        { pageMs: 3_000 },
    )
    assert.deepEqual(manyItems.states.slice(0, 20), Array(20).fill("skipped"))
    assert.deepEqual(new Set(manyItems.states.slice(20)), new Set(["planned"]))
    assert.equal(manyItems.total, 5 + 2 * 5)
    // The same for the origin mappings of earlier restores, read after the items
    const manyOrigins = await cost(["setting update", "setting update"], { pageMs: 3_000, origins: 440 })
    assert.deepEqual(manyOrigins.states, ["updated", "updated"])
    assert.equal(manyOrigins.total, 5 + 2 * 5 + 6 + 6)
    // Quick pages keep the opening check
    const quick = await cost(
        Array.from({ length: 440 }, () => "identical xp" as const),
        { pageMs: 100 },
    )
    assert.equal(quick.total, 5)
})

test("a pass observes its identical channels from one read of the server's channels and renews that read once it is 30 seconds old", async () => {
    // Twenty identical channels, each settled two seconds after the one before. The backend checks every observation, so a batch that was not renewed would be refused
    const run = await Effect.runPromise(
        Effect.scoped(
            costPass(
                Array.from({ length: 20 }, () => "identical channel" as const),
                { stepMs: 2_000 },
            ),
        ),
    )
    assert.equal(run.exit._tag, "Success")
    assert.deepEqual(run.states, Array(20).fill("skipped"))
    // One list read and one opening check, and after 30 seconds one more of each, with no read of a single channel
    assert.equal(run.total, 5 + 1 + 5 + 1)
    assert.equal(new Set(run.natives).size, 2)
    // The only reads of a channel by ID are the DM checks
    assert.equal(run.routes["GET /channels/:id"], 2)
})

test("a pass keeps the proof of identical channels fresh when each channel names a member whose read takes four seconds", async () => {
    // Twenty channels, one member each, 4 seconds a read. Read as one batch they would take 80 seconds, so a batch holds four members, and the
    // Owner and DM check is renewed after each collection
    const run = await Effect.runPromise(
        Effect.scoped(
            costPass(
                Array.from({ length: 20 }, () => "identical channel" as const),
                { memberMs: 4_000 },
            ),
        ),
    )
    assert.equal(run.exit._tag, "Success")
    assert.deepEqual(run.states, Array(20).fill("skipped"))
    // Five batches, each one list read and four member reads, and the pass's own check
    assert.equal(new Set(run.natives).size, 5)
    assert.equal(run.routes[`GET /guilds/:id/channels`], 5)
    assert.equal(run.routes["GET /guilds/:id/members/:id"]! - 2 * run.routes["GET /guilds/:id"]!, 20)
})

test("a proof read from the channel list takes a channel and the category it names from that one read", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const wire = (patch: Record<string, unknown>) =>
                    bot.fixtures.channel({ id: bot.fixtures.nextId(), permission_overwrites: [], ...patch })
                const category = wire({ type: 4, name: "Info" }),
                    child = wire({ name: "rules", parent_id: category.id }),
                    gone = wire({ name: "gone", parent_id: bot.fixtures.nextId() })
                const list = bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: [category, child] })
                yield* bot.idle()
                const evidence = yield* readBackupEvidence(bot.client, f.ids.guild, f.ids.user, p.dmId)
                const objects = [
                    (yield* channelFrom(child)).snapshot,
                    { ...(yield* channelFrom(gone)).snapshot, sourceId: gone.id },
                ]
                const channelReads = () => bot.requests().filter((r) => r.path.startsWith("/channels/")).length,
                    before = channelReads()
                const proof = yield* readBackupNativeProof(
                    bot.client,
                    f.ids.guild,
                    evidence,
                    objects,
                    new Map(),
                    [],
                    false,
                    true,
                )
                assert.equal(list.requests().length, 1)
                // No channel is read by its ID, and a category the list lacks is a missing reference
                assert.equal(channelReads(), before)
                assert.deepEqual(
                    proof.observations.map((o) => [o.sourceId, o.status]),
                    [
                        [child.id, "present"],
                        [gone.id, "absent"],
                    ],
                )
                assert.deepEqual(
                    proof.references
                        .filter((r) => r.type === "category" || r.type === "text")
                        .map((r) => [r.id, r.exists]),
                    [
                        [category.id, true],
                        [gone.parent_id, false],
                    ],
                )
            }),
        ),
    )
})

test("a pass keeps the proof of identical channels fresh across a slow renewal of its Owner and DM check", async () => {
    // Four channels with two members each. Every read of an Owner and DM check takes 11.25 seconds, within its budget, so a renewal takes 45
    // seconds, and a member read takes 4. A group of two channels takes 16 seconds to collect, and the check is renewed before it, so what
    // the backend sees is never older than that
    const run = await Effect.runPromise(
        Effect.scoped(
            costPass(
                Array.from({ length: 4 }, () => "identical channel" as const),
                { memberMs: 4_000, members: 2, authorityMs: 11_250 },
            ),
        ),
    )
    assert.equal(run.exit._tag, "Success")
    assert.deepEqual(run.states, Array(4).fill("skipped"))
    assert.equal(new Set(run.natives).size, 2)
})

test("a pass renews its Owner and DM check right before it collects identical channels, after the backend reads of their items", async () => {
    // Seven channels naming the same four members. Each backend read, the list read, each member read and each apply takes 4.9 seconds, so the
    // seven item reads take 34.3 seconds. A check renewed before them would be 63.7 seconds old at the first apply
    const run = await Effect.runPromise(
        Effect.scoped(
            costPass(
                Array.from({ length: 7 }, () => "identical channel" as const),
                { memberMs: 4_900, members: 4, shared: true, queryMs: 4_900, listMs: 4_900, applyMs: 4_900 },
            ),
        ),
    )
    assert.equal(run.exit._tag, "Success")
    assert.deepEqual(run.states, Array(7).fill("skipped"))
})
