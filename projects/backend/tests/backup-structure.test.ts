import assert from "node:assert/strict"
import { test } from "node:test"
import { Schema } from "effect"
import { BackupItem, type BackupConfigObject, type BackupStructureObject } from "@neonflux/contracts/backup"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { state as moderationState } from "../convex/moderationStore.ts"
import { allPermissions, binding, fixture, installBackupEnv, read, status } from "./backup-fixture.ts"

installBackupEnv()

// Fluxer permission bits the tests name
const VIEW_CHANNEL = 1n << 10n,
    SEND_MESSAGES = 1n << 11n,
    MANAGE_CHANNELS = 1n << 4n,
    MANAGE_ROLES = 1n << 28n,
    ADMINISTRATOR = 1n << 3n

type Fixture = Awaited<ReturnType<typeof fixture>>
const onlyItem = (planned: { items: BackupItem[] }) => planned.items.find((x) => !x.extra)!
const zero = { allow: "0", deny: "0" }

/** The channel the server has: the archive's channel with a difference */
const live = (archive: BackupStructureObject, patch: Partial<BackupStructureObject>): BackupStructureObject => ({
    ...archive,
    ...patch,
})
async function decide(
    f: Fixture,
    archive: BackupStructureObject,
    current: BackupStructureObject,
    refs: ReturnType<Fixture["ref"]>[] = [],
) {
    const planned = await f.plan(f.manifest([], [], [archive]), f.proof([], refs, [f.seen(current)]))
    return { planned, item: onlyItem(planned) }
}
async function changesOf(f: Fixture, planned: { plan: { planId: string } }, itemNo: number) {
    const row = await f.db.run((ctx) =>
        ctx.db
            .query("backupChanges")
            .withIndex("by_plan", (q) => q.eq("planId", planned.plan.planId as never))
            .collect(),
    )
    return row.find((x) => x.itemNo === itemNo)?.changes ?? []
}

test("Every difference between an archive channel and the server's channel is an update that names it", async (t) => {
    const f = await fixture(t),
        text = f.channel("100"),
        voice = f.channel("101", "voice"),
        forum: BackupStructureObject = {
            ...f.channel("102", "forum"),
            topic: "help",
            nsfw: false,
            slowmodeSeconds: 0,
            tags: [{ name: "Answered", moderated: false, emojiId: null, emojiName: null }],
            defaultReaction: null,
            defaultAutoArchiveMinutes: 1440,
            sortOrder: null,
            layout: 1,
            requireTag: false,
        }
    const cases: [string, BackupStructureObject, Partial<BackupStructureObject>, string][] = [
        ["name", text, { name: "renamed" }, "name"],
        ["topic", text, { topic: "other" }, "topic"],
        ["nsfw", text, { nsfw: true }, "nsfw"],
        ["slowmode", text, { slowmodeSeconds: 30 }, "slowmodeSeconds"],
        ["bitrate", voice, { bitrate: 96000 }, "bitrate"],
        ["user limit", voice, { userLimit: 5 }, "userLimit"],
        ["tags", forum, { tags: [] }, "tags"],
        ["layout", forum, { layout: 0 }, "layout"],
        ["required tag", forum, { requireTag: true }, "requireTag"],
        ["reaction", forum, { defaultReaction: { emojiId: null, emojiName: "x" } }, "defaultReaction"],
        ["archive time", forum, { defaultAutoArchiveMinutes: 60 }, "defaultAutoArchiveMinutes"],
        ["sort order", forum, { sortOrder: 1 }, "sortOrder"],
    ]
    for (const [label, archive, patch, field] of cases) {
        const { item, planned } = await decide(f, archive, live(archive, patch))
        assert.equal(item.disposition, "update", label)
        assert.deepEqual(item.changed, [field], label)
        assert.equal(item.mappedId, archive.sourceId, label)
        const rows = await changesOf(f, planned, item.itemNo)
        assert(
            rows.some((x) => x.kind === "field" && x.path.startsWith(field)),
            label,
        )
        assert(!rows.some((x) => x.kind === "overwrite"), label)
        assert.equal(planned.plan.counts.update, 1, label)
    }
    // A channel that matches in every way is identical
    const same = await decide(f, text, live(text, { capturedAt: f.now() + 5 }))
    assert.equal(same.item.disposition, "skip")
    assert.equal(same.item.reason, null)
})

test("A channel that moves to another category is an update with its new parent", async (t) => {
    const f = await fixture(t),
        category = f.channel("200", "category"),
        other = f.channel("201", "category"),
        archive = f.channel("100", "text", "200"),
        current = live(archive, { parentId: "201" })
    const planned = await f.plan(
        f.manifest([], [], [category, other, archive]),
        f.proof(
            [],
            [f.ref("200", "category"), f.ref("201", "category")],
            [f.seen(category), f.seen(other), f.seen(current)],
        ),
    )
    const moved = planned.items.find((x) => x.sourceId === "100")!
    assert.equal(moved.disposition, "update")
    assert.deepEqual(moved.changed, ["parentId"])
    assert.equal(planned.items.find((x) => x.sourceId === "200")!.disposition, "skip")
})

test("An overwrite that is added, changed or removed is a change row with the permissions it gives", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [
                { id: "1", type: "role", allow: "0", deny: VIEW_CHANNEL.toString() },
                { id: "2", type: "role", allow: SEND_MESSAGES.toString(), deny: "0" },
                { id: "3", type: "member", allow: "0", deny: "0" },
            ],
        },
        // The server has the first overwrite changed, the second one removed and a fourth one the archive does not hold
        current = live(archive, {
            overwrites: [
                { id: "1", type: "role", allow: "0", deny: "0" },
                { id: "3", type: "member", allow: "0", deny: "0" },
                { id: "4", type: "member", allow: VIEW_CHANNEL.toString(), deny: "0" },
            ],
        }),
        refs = [f.ref("2"), f.ref("3", "member"), f.ref("4", "member")]
    const { item, planned } = await decide(f, archive, current, refs)
    assert.equal(item.disposition, "update")
    assert.deepEqual(item.changed, ["permissions"])
    assert.equal(item.gain, true)
    const rows = (await changesOf(f, planned, item.itemNo)).filter((x) => x.kind === "overwrite")
    assert.deepEqual(
        rows.map((x) => [x.id, x.kind === "overwrite" && x.gain]),
        [
            // The server did not deny view channel here, so the archive's deny gives nothing
            ["1", "0"],
            // The archive allows sending where the server's channel has no overwrite for the role
            ["2", SEND_MESSAGES.toString()],
            // The archive has no overwrite for a member that the server's channel gives view channel
            ["4", "0"],
        ],
    )
    assert.equal(planned.plan.gain.items, 1)
    assert.equal(BigInt(planned.plan.gain.bits), SEND_MESSAGES)
})

test("A restore never gains permissions silently: the row says so only when an overwrite gives more than the channel had", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [{ id: "1", type: "role", allow: "0", deny: VIEW_CHANNEL.toString() }],
        },
        // The server's channel denies more than the archive does
        stricter = live(archive, {
            overwrites: [{ id: "1", type: "role", allow: "0", deny: (VIEW_CHANNEL | SEND_MESSAGES).toString() }],
        })
    const lifted = await decide(f, archive, stricter)
    assert.equal(lifted.item.gain, true)
    // The server's channel allows more than the archive does, so the restore only takes away
    const looser = live(archive, {
        overwrites: [{ id: "1", type: "role", allow: SEND_MESSAGES.toString(), deny: VIEW_CHANNEL.toString() }],
    })
    const taken = await decide(f, archive, looser)
    assert.equal(taken.item.disposition, "update")
    assert.equal(taken.item.gain, undefined)
})

test("An edit needs what Fluxer's edit rule needs, read from NeonFlux's own permissions in that channel", async (t) => {
    const f = await fixture(t),
        gives: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [{ id: "1", type: "role", allow: SEND_MESSAGES.toString(), deny: "0" }],
        },
        has = live(gives, { overwrites: [] }),
        lifts: BackupStructureObject = { ...f.channel("101"), overwrites: [] },
        denied = live(lifts, { overwrites: [{ id: "1", type: "role", allow: "0", deny: VIEW_CHANNEL.toString() }] }),
        renames = live(f.channel("102"), { name: "old" })
    const reasonFor = async (archive: BackupStructureObject, current: BackupStructureObject, bits: bigint) => {
        const planned = await f.plan(f.manifest([], [], [archive]), f.proof([], [], [f.seen(current, bits.toString())]))
        const decided = onlyItem(planned)
        return [decided.disposition, decided.reason] as const
    }
    assert.deepEqual(await reasonFor(gives, has, SEND_MESSAGES | MANAGE_ROLES), [
        "blocked",
        "NeonFlux needs Manage channels in <#100>. Grant it to the NeonFlux role, then check again",
    ])
    assert.deepEqual(await reasonFor(gives, has, SEND_MESSAGES | MANAGE_CHANNELS), [
        "blocked",
        "NeonFlux needs Manage roles in <#100>. Grant it to the NeonFlux role, then check again",
    ])
    assert.deepEqual(await reasonFor(gives, has, MANAGE_CHANNELS | MANAGE_ROLES), [
        "blocked",
        "Its permissions would give Send messages, which NeonFlux does not have in <#100>. Grant it to the NeonFlux role there, then check again",
    ])
    assert.deepEqual(await reasonFor(gives, has, MANAGE_CHANNELS | MANAGE_ROLES | SEND_MESSAGES), ["update", null])
    // Administrator holds every permission
    assert.deepEqual(await reasonFor(gives, has, ADMINISTRATOR), ["update", null])
    // Lifting a deny is a gain too, so NeonFlux needs the permission that the deny held back
    assert.equal((await reasonFor(lifts, denied, MANAGE_CHANNELS | MANAGE_ROLES))[0], "blocked")
    assert.equal((await reasonFor(lifts, denied, MANAGE_CHANNELS | MANAGE_ROLES | VIEW_CHANNEL))[0], "update")
    // A rename touches no permission, so Manage channels is enough
    assert.deepEqual(await reasonFor(f.channel("102"), renames, MANAGE_CHANNELS), ["update", null])
    assert.equal((await reasonFor(f.channel("102"), renames, VIEW_CHANNEL))[0], "blocked")
})

test("A create needs Manage channels and Manage roles and no allow beyond NeonFlux's own where it goes", async (t) => {
    const f = await fixture(t),
        plain: BackupStructureObject = { ...f.channel("100"), overwrites: [] },
        allows: BackupStructureObject = {
            ...f.channel("101"),
            overwrites: [
                {
                    id: "1",
                    type: "role",
                    allow: SEND_MESSAGES.toString(),
                    deny: (VIEW_CHANNEL | MANAGE_ROLES).toString(),
                },
            ],
        }
    const reasonFor = async (
        archive: BackupStructureObject,
        bits: bigint,
        refs = [] as never[],
        listed = [] as never[],
    ) => {
        const planned = await f.plan(f.manifest([], [], [archive]), {
            ...f.proof([archive], refs, [], listed),
            botPermissions: bits.toString(),
        })
        return onlyItem(planned).reason
    }
    assert.equal(
        await reasonFor(plain, SEND_MESSAGES),
        "NeonFlux needs Manage channels, Manage roles. Grant them to the NeonFlux role, then check again",
    )
    // A create always sends its overwrite list, even an empty one, and Fluxer asks for Manage roles then
    assert.equal(
        await reasonFor(plain, MANAGE_CHANNELS),
        "NeonFlux needs Manage roles. Grant it to the NeonFlux role, then check again",
    )
    assert.equal(await reasonFor(plain, MANAGE_CHANNELS | MANAGE_ROLES), null)
    assert.equal(
        await reasonFor(allows, MANAGE_CHANNELS),
        "NeonFlux needs Manage roles. Grant it to the NeonFlux role, then check again",
    )
    // The deny of a permission NeonFlux lacks is not checked, and its allow within the server is
    assert.equal(
        await reasonFor(allows, MANAGE_CHANNELS | MANAGE_ROLES),
        "NeonFlux cannot allow Send messages in this channel's permissions, because it does not have it itself. Grant it to the NeonFlux role, then check again",
    )
    assert.equal(await reasonFor(allows, MANAGE_CHANNELS | MANAGE_ROLES | SEND_MESSAGES), null)
    // In a category the allow is measured by NeonFlux's permissions in that category, which its reference holds
    const category = f.channel("200", "category"),
        inside: BackupStructureObject = { ...allows, parentId: "200" }
    const withParent = async (parentBits: bigint) =>
        (
            await f.plan(f.manifest([], [], [category, inside]), {
                ...f.proof(
                    [inside],
                    [f.ref("200", "category", { permissions: parentBits.toString() })],
                    [f.seen(category)],
                ),
                botPermissions: (MANAGE_CHANNELS | MANAGE_ROLES).toString(),
            })
        ).items.find((x) => x.sourceId === "101")!
    assert.equal(
        (await withParent(MANAGE_CHANNELS | MANAGE_ROLES)).reason,
        "NeonFlux cannot allow Send messages in this channel's permissions, because it does not have it itself in <#200>. Grant it to the NeonFlux role, then check again",
    )
    assert.equal((await withParent(SEND_MESSAGES)).reason, null)
})

test("An overwrite for a role or member that is gone is left out and shown as dropped, and is no difference by itself", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [
                { id: "1", type: "role", allow: "0", deny: VIEW_CHANNEL.toString() },
                { id: "20", type: "member", allow: SEND_MESSAGES.toString(), deny: "0" },
            ],
        },
        gone = f.ref("20", "member", { exists: false }),
        // The server's channel has what is left of the archive's permissions
        current = live(archive, { overwrites: [archive.overwrites[0]!] })
    const identical = await decide(f, archive, current, [gone])
    assert.equal(identical.item.disposition, "skip")
    assert.equal(identical.item.reason, "Its permissions for <@20> are not restored, since the role or member is gone")
    assert.deepEqual(identical.item.changed, ["permissions"])
    assert.deepEqual(await changesOf(f, identical.planned, identical.item.itemNo), [
        {
            kind: "overwrite",
            id: "20",
            type: "member",
            before: { allow: SEND_MESSAGES.toString(), deny: "0" },
            after: zero,
            gain: "0",
            dropped: true,
        },
    ])
    assert.equal(identical.planned.plan.counts.skip, 1)
    // With another difference it is an update, and the dropped overwrite is a row beside the other changes
    const renamed = await decide(f, archive, live(current, { name: "old" }), [gone])
    assert.equal(renamed.item.disposition, "update")
    assert.deepEqual(renamed.item.changed, ["name", "permissions"])
    // A channel that is created comes without it, and the grant of its reservation says so
    const creates = await f.plan(f.manifest([], [], [archive]), f.proof([archive], [gone]))
    const item = onlyItem(creates)
    assert.equal(item.disposition, "create")
    await f.confirm(creates.plan)
    const proof = f.proof([archive], [gone])
    const reserved = await read(await f.reserve(item, proof))
    assert.deepEqual(
        reserved.grant.channel.overwrites.map((x: { id: string }) => x.id),
        ["1"],
    )
})

test("A role or member that NeonFlux did not read blocks the channel, and one that disappears before it runs changes the plan", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [{ id: "20", type: "member", allow: SEND_MESSAGES.toString(), deny: "0" }],
        }
    // NeonFlux cannot tell a gone member from one it did not read, so it blocks the channel
    const unread = await f.plan(f.manifest([], [], [archive]), f.proof([archive]))
    assert.equal(onlyItem(unread).disposition, "blocked")
    assert.equal(onlyItem(unread).reason, "NeonFlux could not read the member <@20> in its permissions. Check again")
    const planned = await f.plan(f.manifest([], [], [archive]), f.proof([archive], [f.ref("20", "member")]))
    const item = onlyItem(planned)
    assert.equal(item.disposition, "create")
    await f.confirm(planned.plan)
    // The member left after the preview, so the channel that would be made is another channel than the one shown
    const result = await read(await f.reserve(item, f.proof([archive], [f.ref("20", "member", { exists: false })])))
    assert.equal(result.item.state, "conflict")
    assert.equal(result.item.reason, "What it would restore changed since the preview")
})

const tables = (f: Fixture) => ({
    origins: () => f.db.run((ctx) => ctx.db.query("backupOrigins").collect()),
    items: () => f.db.run((ctx) => ctx.db.query("backupItems").collect()),
    audit: () => f.db.run((ctx) => ctx.db.query("auditLogEntries").collect()),
})

test("An update is claimed straight from planned, leaves no origin, and settles by what the bot read back", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = { ...f.channel("100"), name: "new-name", topic: "new topic" },
        current = live(archive, { name: "old-name", topic: "old topic" }),
        proof = f.proof([], [], [f.seen(current)])
    const planned = await f.plan(f.manifest([], [], [archive]), proof),
        item = onlyItem(planned)
    assert.equal(item.disposition, "update")
    await f.confirm(planned.plan)
    // An update needs no reservation
    await status(await f.reserve(item, proof), 400)
    const claimed = await read(await f.claim(item, proof))
    assert.equal(claimed.claimed, true)
    assert.equal(claimed.grant.action, "update")
    assert.equal(claimed.grant.sourceId, "100")
    assert.equal(claimed.grant.channel.name, "new-name")
    assert.equal(claimed.grant.from.name, "old-name")
    assert.equal(claimed.item.state, "claimed")
    // A repeated claim answers the grant it already holds
    assert.equal((await read(await f.claim(item, proof, "b".repeat(32)))).claimed, false)
    assert.deepEqual(await tables(f).origins(), [])
    assert.equal((await tables(f).items())[0]!.originId, undefined)
    // The read-back must be the channel that was granted, and the answer must come from the claimant
    await status(await f.outcome(item, "created", archive), 409)
    await status(await f.outcome(item, "updated", current), 409)
    await status(await f.outcome(item, "updated", archive, { claimToken: "b".repeat(32) }), 409)
    const done = await read(await f.outcome(item, "updated", archive))
    assert.equal(done.item.state, "updated")
    assert.equal(done.item.mappedId, "100")
    assert.deepEqual(await tables(f).origins(), [])
    assert.deepEqual(
        (await tables(f).audit()).map((x) => [x.feature, x.summary]),
        [["structure", "Updated channel new-name from a backup"]],
    )
    // Its Details show what the restore check compared, as a restored setting's do
    const details = await f.db.run(async (ctx) => {
        const entry = (await ctx.db.query("auditLogEntries").order("desc").first())!
        return {
            detail: entry.detail,
            changes: (
                await ctx.db
                    .query("auditLogChanges")
                    .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
                    .unique()
            )?.changes,
        }
    })
    assert.deepEqual(details, {
        detail: true,
        changes: [
            { path: "name", before: "old-name", after: "new-name" },
            { path: "topic", before: "old topic", after: "new topic" },
        ],
    })
    // The same answer again changes nothing, and a different one is refused
    assert.equal((await read(await f.outcome(item, "updated", archive))).item.state, "updated")
    await status(await f.outcome(item, "failed", null), 409)
})

test("A restored channel's Details name the role whose permissions changed with its permissions by name, and leave out one that is gone", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [
                { id: "5", type: "role", allow: "0", deny: VIEW_CHANNEL.toString() },
                { id: "20", type: "member", allow: SEND_MESSAGES.toString(), deny: "0" },
            ],
        },
        current = live(archive, { overwrites: [{ id: "5", type: "role", allow: VIEW_CHANNEL.toString(), deny: "0" }] }),
        proof = f.proof([], [f.ref("5"), f.ref("20", "member", { exists: false })], [f.seen(current)])
    const planned = await f.plan(f.manifest([], [], [archive]), proof),
        item = onlyItem(planned)
    assert.equal(item.disposition, "update")
    await f.confirm(planned.plan)
    await read(await f.claim(item, proof))
    const restored = live(archive, { overwrites: [archive.overwrites[0]!] })
    assert.equal((await read(await f.outcome(item, "updated", restored))).item.state, "updated")
    const changes = await f.db.run(async (ctx) => {
        const entry = (await ctx.db.query("auditLogEntries").order("desc").first())!
        return (
            await ctx.db
                .query("auditLogChanges")
                .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
                .unique()
        )?.changes
    })
    // The member who left is not restored, so only the role's permissions are a change
    assert.deepEqual(changes, [
        {
            path: "permissions for <@&5>",
            before: "Allow View channel. Deny none",
            after: "Allow none. Deny View channel",
        },
    ])
})

test("An update that the server did not take is failed with what applied, and one that was not confirmed is uncertain", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = { ...f.channel("100"), name: "new-name", topic: "new topic" },
        other: BackupStructureObject = { ...f.channel("101"), name: "another" },
        current = live(archive, { name: "old-name", topic: "old topic" }),
        elsewhere = live(other, { name: "old-other" }),
        proof = f.proof([], [], [f.seen(current), f.seen(elsewhere)])
    const planned = await f.plan(f.manifest([], [], [archive, other]), proof),
        [one, two] = planned.items
    await f.confirm(planned.plan)
    await read(await f.claim(one!, proof))
    await read(await f.claim(two!, proof))
    const partly = live(archive, { name: "new-name", topic: "old topic" })
    const failed = await read(
        await f.outcome(one!, "failed", partly, { reason: "Partly applied: name changed, topic not" }),
    )
    assert.equal(failed.item.state, "failed")
    assert.equal(failed.item.reason, "Partly applied: name changed, topic not")
    const unknown = await read(await f.outcome(two!, "uncertain", null))
    assert.equal(unknown.item.state, "uncertain")
    assert.equal(unknown.item.reason, "NeonFlux could not confirm whether this was applied")
    // Neither is an anchor: the plan can be forgotten and nothing is owed to an origin
    assert.equal((await read(await f.manage({ type: "forget", binding: binding(planned.plan) }))).type, "forgotten")
    assert.deepEqual(await tables(f).origins(), [])
    assert.deepEqual(await tables(f).audit(), [])
})

test("A claim decides again on the fresh evidence: settled needs no write, changed is a conflict, lost permission is blocked", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = { ...f.channel("100"), name: "new-name" },
        others = [f.channel("101"), f.channel("102"), f.channel("103")].map((x) => ({ ...x, name: `new-${x.name}` })),
        currents = [archive, ...others].map((x) => live(x, { name: `old-${x.name}` })),
        proof = f.proof(
            [],
            [],
            currents.map((x) => f.seen(x)),
        )
    const planned = await f.plan(f.manifest([], [], [archive, ...others]), proof)
    assert.deepEqual(
        planned.items.map((x) => x.disposition),
        ["update", "update", "update", "update"],
    )
    await f.confirm(planned.plan)
    const fresh = (channel: BackupStructureObject, bits = allPermissions) => f.proof([], [], [f.seen(channel, bits)])
    // The channel was renamed to what the archive holds since the preview, so there is nothing to write
    const settled = await read(await f.claim(planned.items[0]!, fresh(archive)))
    assert.equal(settled.type, "item")
    assert.equal(settled.item.state, "updated")
    // Somebody renamed it to something else, so the preview no longer describes it
    const changed = await read(await f.claim(planned.items[1]!, fresh(live(others[0]!, { name: "somebody-else" }))))
    assert.equal(changed.item.state, "conflict")
    assert.equal(changed.item.reason, "The channel changed since the preview")
    // NeonFlux lost its permission in the channel since the preview
    const lost = await read(await f.claim(planned.items[2]!, fresh(currents[2]!, "0")))
    assert.equal(lost.item.state, "blocked")
    assert.equal(
        lost.item.reason,
        "NeonFlux needs Manage channels in <#102>. Grant it to the NeonFlux role, then check again",
    )
    // The channel is gone
    const gone = await read(await f.claim(planned.items[3]!, f.proof([others[2]!])))
    assert.equal(gone.item.state, "conflict")
    assert.equal(gone.item.reason, "The channel is gone since the preview")
    assert.deepEqual(await tables(f).origins(), [])
})

test("Every write is claimed by the confirmed plan of the actual owner, and DEFCON 1 pauses it", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = { ...f.channel("100"), name: "new-name" },
        proof = f.proof([], [], [f.seen(live(archive, { name: "old-name" }))])
    const planned = await f.plan(f.manifest([], [], [archive]), proof),
        item = onlyItem(planned)
    // The plan is not confirmed yet
    await status(await f.claim(item, proof), 409)
    await f.confirm(planned.plan)
    await f.db.run(async (ctx) => {
        const state = await moderationState(ctx, "1")
        await ctx.db.patch(state._id, { config: { ...defaultSettings(), defcon: 1 } })
    })
    await status(await f.claim(item, proof), 403)
    assert.equal((await tables(f).items())[0]!.state, "planned")
})

/** Gives the server tickets and temporary voice rooms in these channels */
async function own(f: Fixture, tickets: string[], rooms: string[]) {
    await f.db.run(async (ctx) => {
        for (const [i, channelId] of tickets.entries())
            await ctx.db.insert("tickets", {
                serverId: "1",
                ticketNo: i + 1,
                intakeNo: i + 1,
                requesterId: "20",
                requesterJoinedAt: "2024-01-01T00:00:00Z",
                category: {
                    name: "support",
                    revision: 1,
                    enabled: true,
                    visibility: "private",
                    description: "",
                    parentId: null,
                    supportRoleIds: [],
                    questions: [],
                    cannedReplies: [],
                },
                answers: [],
                state: "open",
                generation: 1,
                botId: "999",
                createdAt: f.now(),
                channelId,
                priority: "normal",
                entryCount: 0,
                active: true,
                nativeProtected: false,
                bodiesProtected: false,
                completedSteps: 0,
                erased: false,
                erasing: false,
            })
        for (const channelId of rooms)
            await ctx.db.insert("voiceRooms", {
                serverId: "1",
                channelId,
                ownerId: "20",
                generatorChannelId: "999",
                createdAt: f.now(),
            })
    })
}

test("A channel that a restore made and somebody deleted since is made again, and its origin follows the new channel", async (t) => {
    const f = await fixture(t),
        archive = f.channel("100"),
        first = await f.plan(f.manifest([], [], [archive]), f.proof([archive])),
        item = onlyItem(first)
    await f.confirm(first.plan)
    await read(await f.reserve(item, f.proof([archive])))
    await read(await f.claim(item, f.proof([archive])))
    await read(await f.outcome(item, "created", { ...archive, sourceId: "500" }))
    assert.deepEqual(
        (await tables(f).origins()).map((x) => [x.sourceId, x.state, x.mappedId]),
        [["100", "created", "500"]],
    )
    assert.deepEqual(
        (await tables(f).audit()).map((x) => [x.feature, x.summary]),
        [["structure", "Created channel channel-100 from a backup"]],
    )
    // Channel 500 is deleted by somebody. The archive's channel is not on the server any more, and the earlier restore is no obstacle,
    // neither for the channel nor for a setting that names it
    const gone = { ...archive, sourceId: "500" },
        response: BackupConfigObject = {
            family: "response",
            sourceId: "custom_probe",
            value: {
                kind: "custom",
                name: "probe",
                reply: { type: "text", text: "Hi" },
                channelIds: ["100"],
                roleIds: [],
                cooldownSeconds: 5,
                priority: 0,
                enabled: true,
            },
        }
    const second = await f.plan(f.manifest([response], [], [{ ...archive, capturedAt: f.now() }]), f.proof([gone]))
    const again = onlyItem(second),
        setting = second.items.find((x) => x.category === "config")!
    assert.equal(again.disposition, "create")
    assert.deepEqual([setting.disposition, setting.reason], ["create", null])
    await f.confirm(second.plan)
    const reserved = await read(await f.reserve(again, f.proof([gone])))
    assert.equal(reserved.item.state, "reserved")
    // The mapping stays until the new channel exists, so what is claimed is the same channel that was decided
    assert.deepEqual(
        (await tables(f).origins()).map((x) => [x.state, x.mappedId, x.planId]),
        [["reserved", "500", second.plan.planId]],
    )
    await read(await f.claim(again, f.proof([gone])))
    await read(await f.outcome(again, "created", { ...archive, sourceId: "600" }))
    assert.deepEqual(
        (await tables(f).origins()).map((x) => [x.state, x.mappedId]),
        [["created", "600"]],
    )
    // The setting is written with the new channel
    const text = { ...f.ref("600"), type: "text" as const, permissions: allPermissions }
    assert.equal((await read(await f.apply(setting, f.proof([], [text])))).item.state, "created")
    assert.deepEqual(
        (await f.db.run((ctx) => ctx.db.query("responseDefinitions").collect())).map((x) => x.channelIds),
        [["600"]],
    )
    // The next check finds the new channel, equal to the archive
    const third = await f.plan(
        f.manifest([], [], [{ ...archive, capturedAt: f.now() }]),
        f.proof([], [], [f.seen({ ...archive, sourceId: "600" })]),
    )
    assert.equal(onlyItem(third).disposition, "skip")
    assert.equal(onlyItem(third).mappedId, "600")
})

test("A channel that tickets or temporary voice rooms own is never created, changed or deleted, found by the live lookup", async (t) => {
    const f = await fixture(t),
        created = f.channel("100"),
        changed: BackupStructureObject = { ...f.channel("101", "voice"), name: "new" },
        extra = f.channel("102")
    await own(f, ["100", "102"], ["101"])
    const planned = await f.plan(
        f.manifest([], [], [created, changed]),
        { ...f.proof([created], [], [f.seen(live(changed, { name: "old" }))], [f.listing(extra)]) },
        true,
    )
    const reasons = Object.fromEntries(planned.items.map((x) => [x.sourceId, [x.disposition, x.reason]]))
    assert.deepEqual(reasons, {
        "100": ["skip", "A ticket channel belongs to its ticket, so a restore leaves it alone"],
        "101": ["skip", "A temporary voice room ends with its call, so a restore leaves it alone"],
        "102": ["skip", "A ticket channel belongs to its ticket, so a restore leaves it alone"],
    })
    assert.equal(planned.plan.counts.skip, 3)
    assert.equal(planned.plan.counts.delete, 0)
    // The skip is settled as it was shown, and an extra needs no archive channel to be found
    await f.confirm(planned.plan)
    for (const item of planned.items)
        assert.equal((await read(await f.apply(item, f.proof([created, changed, extra])))).item.state, "skipped")
    assert.deepEqual(await tables(f).origins(), [])
})

test("An identical archive channel is decided again when it is applied, so a channel that changed or is gone is a conflict", async (t) => {
    const f = await fixture(t),
        archive = f.channel("100")
    const applyAfter = async (proof: ReturnType<Fixture["proof"]>) => {
        const planned = await f.plan(f.manifest([], [], [archive]), f.proof([], [], [f.seen(archive)]))
        const item = onlyItem(planned)
        assert.equal(item.disposition, "skip")
        await f.confirm(planned.plan)
        return (await read(await f.apply(item, proof))).item
    }
    const same = await applyAfter(f.proof([], [], [f.seen(archive)]))
    assert.equal(same.state, "skipped")
    assert.equal(same.mappedId, "100")
    const renamed = await applyAfter(f.proof([], [], [f.seen(live(archive, { name: "renamed" }))]))
    assert.equal(renamed.state, "conflict")
    const gone = await applyAfter(f.proof([archive]))
    assert.equal(gone.state, "conflict")
    assert.deepEqual(await tables(f).origins(), [])
})

/** A server with the channel the archive holds, extras of every kind and a category that holds one of them */
function serverWithExtras(f: Fixture) {
    const archive = f.channel("100"),
        category = f.channel("400", "category"),
        text = f.channel("300", "text", "400"),
        voice = f.channel("301", "voice"),
        forum = f.channel("302", "forum"),
        link = { ...f.channel("500"), name: "dashboard" }
    return {
        archive,
        category,
        text,
        voice,
        forum,
        link,
        listed: [
            f.listing(archive),
            f.listing(category),
            f.listing(text),
            f.listing(voice),
            f.listing(forum),
            f.listing(link, { type: "link" }),
        ],
    }
}

test("Match mode deletes the channels and categories the archive does not hold, and the default mode leaves them", async (t) => {
    const f = await fixture(t),
        s = serverWithExtras(f),
        proof = f.proof([], [], [f.seen(s.archive)], s.listed)
    const kept = await f.plan(f.manifest([], [], [s.archive]), proof)
    assert.deepEqual(kept.plan.counts, { create: 0, update: 0, delete: 0, skip: 1, blocked: 0 })
    assert.equal(kept.plan.match, false)
    const matched = await f.plan(f.manifest([], [], [s.archive]), proof, true)
    assert.equal(matched.plan.match, true)
    assert.deepEqual(matched.plan.counts, { create: 0, update: 0, delete: 4, skip: 1, blocked: 0 })
    // Channels go before the categories that held them, and a channel of another type is not listed at all
    assert.deepEqual(
        matched.items.map((x) => [x.sourceId, x.disposition, x.extra ?? false]),
        [
            ["100", "skip", false],
            ["300", "delete", true],
            ["301", "delete", true],
            ["302", "delete", true],
            ["400", "delete", true],
        ],
    )
    assert(matched.items.slice(1).every((x) => x.warning?.startsWith("Deletes the channel with its messages")))
    // A delete stores no changes, since its name and warning say what goes
    for (const item of matched.items.slice(1)) assert.deepEqual(await changesOf(f, matched, item.itemNo), [])
    // Problems come first on the page and a delete comes right after a blocked item
    const ranks = await tables(f).items()
    assert.deepEqual(
        ranks.filter((x) => x.planId === (matched.plan.planId as never)).map((x) => [x.sourceId, x.rank]),
        [
            ["100", 5],
            ["300", 1],
            ["301", 1],
            ["302", 1],
            ["400", 1],
        ],
    )
    // The mode is part of what the owner confirms, even when it changes no item
    const bare = f.proof([], [], [f.seen(s.archive)], [f.listing(s.archive)])
    const same = f.manifest([], [], [s.archive])
    const [asKept, asMatched] = [await f.plan(same, bare), await f.plan(same, bare, true)]
    assert.deepEqual(asMatched.plan.counts, asKept.plan.counts)
    assert.notEqual(asKept.plan.planHash, asMatched.plan.planHash)
    // The archive did not select structure, so a match restore has no channels to compare with and deletes none
    const config = f.manifest([], [{ sourceId: "20", userId: "20", xp: 1 }])
    assert.equal((await f.plan(config, proof, true)).plan.counts.delete, 0)
    // An archive that selected structure and holds no channel makes every channel an extra
    const empty = { ...f.manifest([], [], []), selected: ["structure" as const] }
    assert.equal((await f.plan(empty, proof, true)).plan.counts.delete, 5)
})

test("Match mode blocks a delete that would leave a category holding something or that NeonFlux cannot make", async (t) => {
    const f = await fixture(t),
        s = serverWithExtras(f),
        holder = f.channel("401", "category"),
        kept = f.channel("303", "text", "401"),
        pinned = f.channel("402", "category"),
        ticket = f.channel("304", "text", "402"),
        out = f.channel("305"),
        linked = { ...f.channel("501"), parentId: "403", name: "link-in-category" },
        withLink = f.channel("403", "category")
    await own(f, ["304"], [])
    const proof = f.proof(
        [],
        [],
        [f.seen(s.archive)],
        [
            f.listing(s.archive),
            // A category with a channel that is blocked itself, since NeonFlux cannot manage it
            f.listing(holder),
            f.listing(kept, { botCanManage: false }),
            f.listing(pinned),
            f.listing(ticket),
            f.listing(out, { botCanManage: false }),
            f.listing(withLink),
            f.listing(linked, { type: "link" }),
        ],
    )
    const matched = await f.plan(f.manifest([], [], [s.archive]), proof, true)
    const by = Object.fromEntries(matched.items.map((x) => [x.sourceId, [x.disposition, x.reason]]))
    assert.deepEqual(by, {
        "100": ["skip", null],
        "303": ["blocked", "NeonFlux needs Manage channels in <#303>. Grant it to the NeonFlux role, then check again"],
        "305": ["blocked", "NeonFlux needs Manage channels in <#305>. Grant it to the NeonFlux role, then check again"],
        "304": ["skip", "A ticket channel belongs to its ticket, so a restore leaves it alone"],
        "401": [
            "blocked",
            "The category would still hold channel-303, so NeonFlux does not delete it. Move them out in Server structure on the dashboard, then check again",
        ],
        "402": [
            "blocked",
            "The category would still hold channel-304, so NeonFlux does not delete it. Move them out in Server structure on the dashboard, then check again",
        ],
        "403": [
            "blocked",
            "The category would still hold link-in-category, so NeonFlux does not delete it. Move them out in Server structure on the dashboard, then check again",
        ],
    })
    // Nothing of them is a delete, and nothing blocked counts as one
    assert.equal(matched.plan.counts.delete, 0)
    assert.equal(matched.plan.counts.blocked, 5)
})

test("Match mode makes a plan of more than 500 items a refusal that says how many it would be", async (t) => {
    const f = await fixture(t),
        archive = f.channel("100"),
        profiles = Array.from({ length: 499 }, (_, i) => ({
            sourceId: String(1000 + i),
            userId: String(1000 + i),
            xp: i,
        })),
        extra = f.channel("300"),
        proof = f.proof([], [], [f.seen(archive)], [f.listing(archive), f.listing(extra)])
    const manifest = f.manifest([], profiles, [archive])
    // The archive alone fills the plan, and the default mode keeps to it
    assert.equal((await f.plan(manifest, proof)).plan.itemCount, 500)
    const body = {
        serverId: "1",
        context: f.context(),
        manifest,
        archiveDigest: "a".repeat(64),
        native: proof,
        archive: { channelId: "90", messageId: "700" },
        match: true,
    }
    const refused = await f.http("/backup/preview", body)
    await status(refused, 413)
    assert.equal(((await f.db.run((ctx) => ctx.db.query("backupPlans").collect())) as unknown[]).length, 1)
})

// A category that is private on the server and public in the archive, with channels that follow it
const privateOverwrites = [{ id: "2", type: "role" as const, allow: "0", deny: VIEW_CHANNEL.toString() }],
    publicOverwrites = [{ id: "2", type: "role" as const, allow: "0", deny: "0" }]
const copied = (names: string) =>
    `Fluxer would also copy these permissions to ${names}. Move them out of the category in Server structure on the dashboard, check again and restore, then move them back (moving does not sync them)`

function cascadeScene(f: Fixture) {
    const category: BackupStructureObject = { ...f.channel("200", "category"), overwrites: publicOverwrites },
        child: BackupStructureObject = { ...f.channel("101", "text", "200"), overwrites: publicOverwrites },
        nowCategory = live(category, { overwrites: privateOverwrites }),
        nowChild = live(child, { overwrites: privateOverwrites })
    const plan = (
        archive: BackupStructureObject[],
        present: BackupStructureObject[],
        listed: ReturnType<Fixture["listing"]>[],
        match = false,
    ) =>
        f.plan(
            f.manifest([], [], archive),
            f.proof(
                [],
                [f.ref("2")],
                present.map((x) => f.seen(x)),
                listed,
            ),
            match,
        )
    return { category, child, nowCategory, nowChild, plan }
}

test("A category's permission change passes when every channel that follows it ends with the same permissions anyway", async (t) => {
    const f = await fixture(t),
        s = cascadeScene(f)
    const planned = await s.plan(
        [s.category, s.child],
        [s.nowCategory, s.nowChild],
        [f.listing(s.nowCategory), f.listing(s.nowChild, { synced: true })],
    )
    const [category, child] = planned.items
    // Before and gain stay what the server has now: the category's own row, not the channels it will reach
    assert.deepEqual([category!.sourceId, category!.disposition, category!.gain], ["200", "update", true])
    assert.deepEqual([child!.sourceId, child!.disposition, child!.gain], ["101", "update", true])
    assert.deepEqual(
        (await changesOf(f, planned, category!.itemNo)).map((x) => x.kind === "overwrite" && [x.before, x.after]),
        [[{ allow: "0", deny: VIEW_CHANNEL.toString() }, zero]],
    )
    assert.equal(planned.plan.gain.items, 2)
    const stored = await tables(f).items()
    // Only a channel that a cascade will reach takes a second state
    assert.equal(stored.find((x) => x.sourceId === "200")!.cascadeHash, undefined)
    assert.equal(typeof stored.find((x) => x.sourceId === "101")!.cascadeHash, "string")
    await f.confirm(planned.plan)
    // The category changes first and the cascade copies its permissions to the channel
    const done = await read(
        await f.claim(
            category!,
            f.proof(
                [],
                [f.ref("2")],
                [f.seen(s.nowCategory)],
                [f.listing(s.nowCategory), f.listing(s.nowChild, { synced: true })],
            ),
        ),
    )
    assert.equal(done.claimed, true)
    await read(await f.outcome(category!, "updated", s.category))
    // The channel already has what the archive holds, so there is nothing left to write
    const settled = await read(
        await f.claim(
            child!,
            f.proof([], [f.ref("2")], [f.seen(s.child)], [f.listing(s.category), f.listing(s.child)]),
        ),
    )
    assert.equal(settled.type, "item")
    assert.equal(settled.item.state, "updated")
    assert.deepEqual(await tables(f).origins(), [])
})

test("A channel that a cascade has reached still gets its own rename, and any other change is a conflict", async (t) => {
    const f = await fixture(t),
        s = cascadeScene(f),
        renamed: BackupStructureObject = { ...s.child, name: "renamed" },
        topical: BackupStructureObject = { ...s.child, name: "renamed", topic: "other" }
    const planned = await s.plan(
        [s.category, renamed],
        [s.nowCategory, s.nowChild],
        [f.listing(s.nowCategory), f.listing(s.nowChild, { synced: true })],
    )
    const child = planned.items[1]!
    assert.deepEqual(child.changed, ["name", "permissions"])
    await f.confirm(planned.plan)
    // After the cascade the channel has the category's permissions and its old name
    const cascaded = live(renamed, { name: s.child.name })
    const claimed = await read(await f.claim(child, f.proof([], [f.ref("2")], [f.seen(cascaded)])))
    assert.equal(claimed.claimed, true)
    assert.equal(claimed.grant.from.name, s.child.name)
    assert.deepEqual(claimed.grant.from.overwrites, publicOverwrites)
    assert.equal(claimed.grant.channel.name, "renamed")
    // Another channel of the same plan finds a topic that neither state of the preview had
    const other = await s.plan(
        [s.category, renamed],
        [s.nowCategory, s.nowChild],
        [f.listing(s.nowCategory), f.listing(s.nowChild, { synced: true })],
    )
    await f.confirm(other.plan)
    const drift = await read(
        await f.claim(other.items[1]!, f.proof([], [f.ref("2")], [f.seen(live(topical, { name: s.child.name }))])),
    )
    assert.equal(drift.item.state, "conflict")
})

test("A category's permission change is blocked when Fluxer would also change a channel that the archive does not give them", async (t) => {
    const f = await fixture(t),
        s = cascadeScene(f)
    const extra: BackupStructureObject = {
            ...f.channel("300", "text", "200"),
            name: "side-room",
            overwrites: privateOverwrites,
        },
        owned = { ...f.channel("102", "voice", "200"), managed: "voiceRoom" as const, overwrites: publicOverwrites },
        privateChild: BackupStructureObject = { ...f.channel("103", "text", "200"), overwrites: privateOverwrites }
    const reasonOf = async (
        archive: BackupStructureObject[],
        present: BackupStructureObject[],
        listed: ReturnType<Fixture["listing"]>[],
        match = false,
    ) => (await s.plan(archive, present, listed, match)).items.find((x) => x.sourceId === "200")!
    // A kept channel that follows the category would be changed on the side
    const kept = await reasonOf(
        [s.category],
        [s.nowCategory],
        [f.listing(s.nowCategory), f.listing(extra, { synced: true })],
    )
    assert.deepEqual([kept.disposition, kept.reason], ["blocked", copied("side-room")])
    // A channel that tickets or voice rooms own is left alone, so it would be changed on the side too
    await own(f, [], ["102"])
    const protectedChild = await reasonOf(
        [s.category, owned],
        [s.nowCategory, live(owned, { overwrites: privateOverwrites })],
        [f.listing(s.nowCategory), f.listing(owned, { synced: true })],
    )
    assert.deepEqual([protectedChild.disposition, protectedChild.reason], ["blocked", copied("channel-102")])
    // An archived channel that keeps its private permissions under a category that becomes public is the case Fluxer would break
    const hidden = await reasonOf(
        [s.category, privateChild],
        [s.nowCategory, live(privateChild, { overwrites: privateOverwrites })],
        [f.listing(s.nowCategory), f.listing(privateChild, { synced: true })],
    )
    assert.deepEqual([hidden.disposition, hidden.reason], ["blocked", copied("channel-103")])
    // An archived channel that the plan itself moves to another category needs nothing by hand, only a second check
    const elsewhere: BackupStructureObject = { ...f.channel("104", "text", "201"), overwrites: privateOverwrites }
    const inside = live(elsewhere, { parentId: "200" })
    const moving = await reasonOf(
        [s.category, elsewhere],
        [s.nowCategory, inside],
        [f.listing(s.nowCategory), f.listing(inside, { synced: true })],
    )
    assert.deepEqual(
        [moving.disposition, moving.reason],
        ["blocked", "This run moves channel-104 out first. Check again after it"],
    )
    // The same private channel does not follow the category, so nothing reaches it
    const apart = await reasonOf(
        [s.category, privateChild],
        [s.nowCategory, live(privateChild, { overwrites: privateOverwrites })],
        [f.listing(s.nowCategory), f.listing(privateChild, { synced: false })],
    )
    assert.equal(apart.disposition, "update")
    // A kept channel does not matter while the category's permissions stay as they are
    const renamed = await reasonOf(
        [{ ...s.category, name: "renamed", overwrites: privateOverwrites }],
        [s.nowCategory],
        [f.listing(s.nowCategory), f.listing(extra, { synced: true })],
    )
    assert.deepEqual([renamed.disposition, renamed.changed], ["update", ["name"]])
    // Match mode deletes the extra, but only after the category, so the first check asks for a second one
    const deleting = await reasonOf(
        [s.category],
        [s.nowCategory],
        [f.listing(s.nowCategory), f.listing(extra, { synced: true })],
        true,
    )
    assert.deepEqual(
        [deleting.disposition, deleting.reason],
        ["blocked", "This run deletes side-room first. Check again after it"],
    )
})

test("A channel of a type a restore does not archive follows its category and is named on the category's row", async (t) => {
    const f = await fixture(t),
        s = cascadeScene(f),
        link = { ...f.channel("500", "text", "200"), name: "dashboard", overwrites: privateOverwrites }
    const planned = await s.plan(
        [s.category],
        [s.nowCategory],
        [f.listing(s.nowCategory), f.listing(link, { type: "link", synced: true })],
        true,
    )
    const category = planned.items[0]!
    assert.equal(category.disposition, "update")
    assert.deepEqual(category.changed, ["permissions"])
    assert.equal(planned.plan.counts.delete, 0)
    const named = (await changesOf(f, planned, category.itemNo)).find((x) => x.kind === "field")
    assert.deepEqual(named, {
        kind: "field",
        path: "linkChannels[dashboard]",
        before: privateOverwrites,
        after: publicOverwrites,
    })
    // The plan's gain counts the permissions once, whoever receives them
    assert.equal(planned.plan.gain.items, 1)
    assert.equal(BigInt(planned.plan.gain.bits), VIEW_CHANNEL)
    await f.confirm(planned.plan)
    // A channel that follows the category since the preview changes what the claim binds, so it is a conflict
    const added = await read(
        await f.claim(
            category,
            f.proof(
                [],
                [f.ref("2")],
                [f.seen(s.nowCategory)],
                [
                    f.listing(s.nowCategory),
                    f.listing(link, { type: "link", synced: true }),
                    f.listing({ ...link, sourceId: "501", name: "second" }, { type: "link", synced: true }),
                ],
            ),
        ),
    )
    assert.equal(added.item.state, "conflict")
    assert.equal(added.item.reason, "The channel changed since the preview")
})

test("A channel that follows the category since the preview and would be changed on the side blocks the claim", async (t) => {
    const f = await fixture(t),
        s = cascadeScene(f),
        late = { ...f.channel("300", "text", "200"), name: "late", overwrites: privateOverwrites }
    const planned = await s.plan([s.category], [s.nowCategory], [f.listing(s.nowCategory)])
    await f.confirm(planned.plan)
    const result = await read(
        await f.claim(
            planned.items[0]!,
            f.proof(
                [],
                [f.ref("2")],
                [f.seen(s.nowCategory)],
                [f.listing(s.nowCategory), f.listing(late, { synced: true })],
            ),
        ),
    )
    assert.equal(result.item.state, "blocked")
    assert.equal(result.item.reason, copied("late"))
})

test("A delete is claimed from planned with the channel as it is, and settles when the channel is gone", async (t) => {
    const f = await fixture(t),
        s = serverWithExtras(f),
        proof = f.proof([], [], [f.seen(s.archive)], s.listed)
    const planned = await f.plan(f.manifest([], [], [s.archive]), proof, true)
    const voice = planned.items.find((x) => x.sourceId === "301")!,
        text = planned.items.find((x) => x.sourceId === "300")!
    assert.equal(voice.disposition, "delete")
    await f.confirm(planned.plan)
    const fresh = (channel: BackupStructureObject, listed = s.listed) => f.proof([], [], [f.seen(channel)], listed)
    await status(await f.reserve(voice, fresh(s.voice)), 400)
    const claimed = await read(await f.claim(voice, fresh(s.voice)))
    assert.equal(claimed.claimed, true)
    assert.equal(claimed.grant.action, "delete")
    assert.equal(claimed.grant.sourceId, "301")
    assert.equal(claimed.grant.channel.name, "channel-301")
    assert.deepEqual(claimed.grant.from, claimed.grant.channel)
    // The channel is deleted, which is the only answer a delete accepts besides failed and uncertain
    await status(await f.outcome(voice, "updated", s.voice), 409)
    await status(await f.outcome(voice, "deleted", s.voice), 409)
    const done = await read(await f.outcome(voice, "deleted", null))
    assert.equal(done.item.state, "deleted")
    assert.equal(done.item.mappedId, "301")
    assert.deepEqual(await tables(f).origins(), [])
    assert.deepEqual(
        (await tables(f).audit()).map((x) => x.summary),
        ["Deleted channel channel-301 from a backup"],
    )
    // A channel that was deleted since the preview is as good as deleted
    const vanished = await read(await f.claim(text, f.proof([s.text])))
    assert.equal(vanished.item.state, "deleted")
    // A channel that is not the one the preview showed is a conflict
    const forum = planned.items.find((x) => x.sourceId === "302")!
    const renamed = { ...s.forum, name: "other" }
    const conflict = await read(await f.claim(forum, fresh(renamed, [f.listing(s.archive), f.listing(renamed)])))
    assert.equal(conflict.item.state, "conflict")
    assert.equal(conflict.item.reason, "The channel changed since the preview")
})

test("A delete is skipped when a ticket took the channel since the preview, and blocked while a category holds a channel", async (t) => {
    const f = await fixture(t),
        s = serverWithExtras(f),
        proof = f.proof([], [], [f.seen(s.archive)], s.listed)
    const planned = await f.plan(f.manifest([], [], [s.archive]), proof, true)
    const forum = planned.items.find((x) => x.sourceId === "302")!,
        category = planned.items.find((x) => x.sourceId === "400")!
    await f.confirm(planned.plan)
    await own(f, ["302"], [])
    const skipped = await read(await f.claim(forum, f.proof([], [], [f.seen(s.forum)], s.listed)))
    assert.equal(skipped.item.state, "skipped")
    // The category is claimed after its channels, but one of them is still there
    const holds = await read(await f.claim(category, f.proof([], [], [f.seen(s.category)], s.listed)))
    assert.equal(holds.item.state, "blocked")
    assert.equal(
        holds.item.reason,
        "The category would still hold channel-300, so NeonFlux does not delete it. Move them out in Server structure on the dashboard, then check again",
    )
})

test("A claimed update or delete that is never answered ages to uncertain without an origin, and keeps nothing", async (t) => {
    const f = await fixture(t),
        archive: BackupStructureObject = { ...f.channel("100"), name: "new" },
        extra = f.channel("300"),
        proof = f.proof([], [], [f.seen(live(archive, { name: "old" }))], [f.listing(archive), f.listing(extra)])
    const planned = await f.plan(f.manifest([], [], [archive]), proof, true),
        [update, remove] = planned.items
    assert.deepEqual([update!.disposition, remove!.disposition], ["update", "delete"])
    await f.confirm(planned.plan)
    await read(await f.claim(update!, proof))
    await read(await f.claim(remove!, f.proof([], [], [f.seen(extra)], [f.listing(archive), f.listing(extra)])))
    // A live claim keeps the plan, as an unresolved item
    await status(await f.manage({ type: "forget", binding: binding(planned.plan) }), 409)
    f.advance(130001)
    assert.deepEqual(await f.clean(), { aged: 2, removed: 0, more: false })
    const items = await tables(f).items()
    for (const item of items) {
        assert.equal(item.state, "uncertain")
        assert.equal(item.reason, "NeonFlux could not confirm whether this was applied")
        assert.equal(item.historicalOutcome, undefined)
    }
    assert.deepEqual(await tables(f).origins(), [])
    // A late answer does not turn an aged claim into an outcome, and the plan can be forgotten and cleaned
    await status(await f.outcome(update!, "updated", archive), 409)
    assert.equal((await read(await f.manage({ type: "forget", binding: binding(planned.plan) }))).type, "forgotten")
    f.advance(604800000 + 900001)
    for (let pass = 0; pass < 4; pass++) await f.clean()
    assert.equal(((await f.db.run((ctx) => ctx.db.query("backupPlans").collect())) as unknown[]).length, 0)
})

test("A gone member's overwrite that the server's channel holds too is left as it is, and is no change", async (t) => {
    const f = await fixture(t),
        deny = { id: "20", type: "member" as const, allow: "0", deny: VIEW_CHANNEL.toString() },
        archive: BackupStructureObject = { ...f.channel("100"), overwrites: [deny] },
        gone = f.ref("20", "member", { exists: false })
    // The server holds the archive's overwrite for a member who left, so there is nothing to restore and nothing to lift
    const same = await decide(f, archive, live(archive, {}), [gone])
    assert.equal(same.item.disposition, "skip")
    assert.equal(same.item.reason, null)
    assert.equal(same.item.gain, undefined)
    assert.deepEqual(await changesOf(f, same.planned, same.item.itemNo), [])
    // With a rename to make, the write keeps the overwrite instead of lifting the deny
    const renamed = await decide(f, archive, live(archive, { name: "old" }), [gone])
    assert.equal(renamed.item.disposition, "update")
    assert.deepEqual(renamed.item.changed, ["name"])
    assert.equal(renamed.item.gain, undefined)
    await f.confirm(renamed.planned.plan)
    const claimed = await read(
        await f.claim(renamed.item, f.proof([], [gone], [f.seen(live(archive, { name: "old" }))])),
    )
    assert.deepEqual(claimed.grant.channel.overwrites, [deny])
    // The server holds another value for him, which stays too, and the archive's value is shown as not restored
    const other = { ...deny, deny: SEND_MESSAGES.toString() },
        differs = await decide(f, archive, live(archive, { overwrites: [other] }), [gone])
    assert.equal(differs.item.disposition, "skip")
    assert.equal(differs.item.reason, "Its permissions for <@20> are not restored, since the role or member is gone")
})

test("Match mode counts only the archive channels that leave a category as leaving it", async (t) => {
    const f = await fixture(t),
        category = f.channel("400", "category"),
        stays: BackupStructureObject = { ...f.channel("101", "text", "400"), name: "renamed" },
        leaves: BackupStructureObject = f.channel("102", "text")
    const listed = [
        f.listing(category),
        f.listing({ ...stays, name: "old" }),
        f.listing({ ...leaves, parentId: "400" }),
    ]
    const plan = (archive: BackupStructureObject[], present: BackupStructureObject[]) =>
        f.plan(
            f.manifest([], [], archive),
            f.proof(
                [],
                [],
                present.map((x) => f.seen(x)),
                listed,
            ),
            true,
        )
    // The renamed channel stays in the category that the archive does not hold, so the category cannot go
    const kept = await plan([stays], [{ ...stays, name: "old" }])
    const held = kept.items.find((x) => x.sourceId === "400")!
    assert.equal(held.disposition, "blocked")
    assert.equal(held.reason?.startsWith("The category would still hold"), true)
    // A channel that the archive takes out of it lets the category go
    const moved = await plan([leaves], [{ ...leaves, parentId: "400" }])
    assert.deepEqual(
        moved.items.map((x) => [x.sourceId, x.disposition]),
        [
            ["102", "update"],
            ["101", "delete"],
            ["400", "delete"],
        ],
    )
})

test("A permission refusal names a few permissions and stays within the reason limit of the shared decoder", async (t) => {
    const f = await fixture(t),
        wide = ((1n << 55n) - 1n) & ~ADMINISTRATOR & ~MANAGE_CHANNELS & ~MANAGE_ROLES,
        archive: BackupStructureObject = {
            ...f.channel("100"),
            overwrites: [{ id: "1", type: "role", allow: wide.toString(), deny: "0" }],
        },
        current = live(archive, { overwrites: [] })
    const bits = (MANAGE_CHANNELS | MANAGE_ROLES).toString()
    const update = await f.plan(f.manifest([], [], [archive]), f.proof([], [], [f.seen(current, bits)]))
    const create = await f.plan(f.manifest([], [], [archive]), {
        ...f.proof([archive]),
        botPermissions: bits,
    })
    for (const item of [onlyItem(update), onlyItem(create)]) {
        assert.equal(item.disposition, "blocked")
        assert.match(item.reason!, /^[^]*, [^]*, [^]*, [^]* and \d+ more[^]*$/)
        assert(item.reason!.length < 512, `${item.reason!.length} characters`)
        assert.doesNotThrow(() => Schema.decodeUnknownSync(BackupItem)(item))
    }
})

test("A category's reason stays within the limit of an item's reason, whatever channels follow it", async (t) => {
    const f = await fixture(t),
        s = cascadeScene(f),
        long = (n: number) => `${"n".repeat(96)}${String(n).padStart(4, "0")}`
    // Four channels of each kind, each with the longest name: kept channels, channels match deletes, channels the plan moves out
    const extra = (id: number, manages: boolean) =>
        f.listing({ ...f.channel(String(id), "text", "200"), name: long(id) }, { synced: true, botCanManage: manages })
    const away = [0, 1, 2, 3].map((n): BackupStructureObject => ({
        ...f.channel(String(400 + n), "text", "201"),
        name: long(400 + n),
        overwrites: privateOverwrites,
    }))
    const inside = away.map((x) => live(x, { parentId: "200" }))
    const reasonOf = async (listed: ReturnType<Fixture["listing"]>[]) => {
        const planned = await s.plan(
            [s.category, ...away],
            [s.nowCategory, ...inside],
            [f.listing(s.nowCategory), ...inside.map((x) => f.listing(x, { synced: true })), ...listed],
            true,
        )
        return planned.items.find((x) => x.sourceId === "200")!
    }
    const both = await reasonOf([...[0, 1, 2, 3].map((n) => extra(300 + n, true))])
    assert.equal(both.disposition, "blocked")
    assert.match(
        both.reason!,
        /^This run deletes .* and 1 more first\. Check again after it\. This run moves .* and 1 more out first/,
    )
    const all = await reasonOf([
        ...[0, 1, 2, 3].map((n) => extra(300 + n, true)),
        ...[0, 1, 2, 3].map((n) => extra(310 + n, false)),
    ])
    // The manual move-out is the one to read first, and the rest shows on the next check
    assert.match(all.reason!, /^Fluxer would also copy these permissions to .* and 1 more\. Move them out/)
    for (const item of [both, all]) {
        assert(item.reason!.length < 512, `${item.reason!.length} characters`)
        assert.doesNotThrow(() => Schema.decodeUnknownSync(BackupItem)(item))
    }
})
