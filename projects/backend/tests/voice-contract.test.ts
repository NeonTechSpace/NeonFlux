import assert from "node:assert/strict"
import test from "node:test"
import { makeFunctionReference } from "convex/server"
import type { DashboardVoiceMember } from "../dashboard-contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { tokenHash } from "../convex/dashboard.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { createVoiceStore, VoiceStoreError } from "../../bot/src/voice-store.ts"

const modules = { "../convex/voice.ts": () => import("../convex/voice.ts") }

test("voice adapter round trips generators, rooms and authority through the real HTTP boundary", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createVoiceStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const owner = {
        originServerId: "1",
        userId: "10",
        roleIds: [],
        isOwner: true,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    }
    const member = { ...owner, userId: "20", isOwner: false, nativePermissionAuthorized: false }
    const manage = (operation: any, actor = owner) => store.manage({ ...f.source(), actor, operation })
    const generator = (
        await run(
            manage({
                type: "generator-add",
                channelId: "50",
                channelName: "Join to create",
                categoryId: "40",
                template: "{owner}'s room",
                userLimit: 3,
                region: "eu-west",
            }),
        )
    ).generator
    assert.deepEqual(
        [generator.channelId, generator.userLimit, generator.region, generator.revision],
        ["50", 3, "eu-west", 1],
    )
    assert.equal(
        (
            await run(
                manage({
                    type: "generator-set",
                    channelId: "50",
                    patch: { template: "{owner} plays", userLimit: null },
                }),
            )
        ).generator.template,
        "{owner} plays",
    )
    const room = (
        await run(
            store.rooms({
                serverId: "1",
                operation: { type: "create", channelId: "100", ownerId: "20", generatorChannelId: "50" },
            }),
        )
    ).room
    assert.deepEqual(room, { channelId: "100", ownerId: "20", generatorChannelId: "50", createdAt: f.now() })
    const moved = await run(
        store.rooms({
            serverId: "1",
            operation: { type: "transfer", channelId: "100", expectedOwnerId: "20", ownerId: "21" },
        }),
    )
    assert.deepEqual(moved, { type: "transferred", room: { ...room, ownerId: "21" } })
    assert.deepEqual(
        await run(
            store.rooms({
                serverId: "1",
                operation: { type: "transfer", channelId: "100", expectedOwnerId: "21", ownerId: "20" },
            }),
        ),
        { type: "transferred", room },
    )
    const state = await run(store.query({ serverId: "1", operation: { type: "state" } }))
    assert.equal(state.generators.length, 1)
    assert.deepEqual(state.rooms, [room])
    const authority = await run(store.query({ serverId: "1", operation: { type: "authority", actor: member } }))
    assert.deepEqual([authority.staff, authority.room, authority.rooms], [false, room, 1])
    assert.deepEqual(await run(store.rooms({ serverId: "1", operation: { type: "forget", channelId: "100" } })), {
        type: "forgotten",
        room: true,
        generator: false,
    })
    assert.deepEqual(await run(manage({ type: "generator-remove", channelId: "50" })), {
        type: "removed",
        channelId: "50",
    })

    await f.reject(
        manage(
            {
                type: "generator-add",
                channelId: "51",
                channelName: "Join",
                categoryId: null,
                template: "Room",
                userLimit: null,
                region: null,
            },
            member,
        ),
        VoiceStoreError,
        403,
    )
    await f.reject(manage({ type: "generator-remove", channelId: "50" }), VoiceStoreError, 404)
    await f.reject(
        createVoiceStore(f.wrongConfig).query({ serverId: "1", operation: { type: "state" } }),
        VoiceStoreError,
        401,
    )
    assert.deepEqual(
        f.calls.slice(-3).map((call) => call.status),
        [403, 404, 401],
    )
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})

const websiteModules = {
    ...modules,
    "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/dashboardConfiguration.ts": () => import("../convex/dashboardConfiguration.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
}
const sessionToken = "b".repeat(64)
const expireRequest = makeFunctionReference<"mutation", { id: string }>("voice:expireRequest"),
    voiceRequest = makeFunctionReference<"mutation">("voice:request"),
    voiceMember = makeFunctionReference<"query">("voice:member")

test("room records keep the panel and the bot's read of the room, generators keep the card setting, and DEFCON pauses room commands", async (t) => {
    const f = await adapterFixture(t, websiteModules)
    const store = createVoiceStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const owner = {
        originServerId: "1",
        userId: "10",
        roleIds: [],
        isOwner: true,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    }
    const added = await run(
        store.manage({
            ...f.source(),
            actor: owner,
            operation: {
                type: "generator-add",
                channelId: "50",
                channelName: "Join",
                categoryId: null,
                template: "Room",
                userLimit: null,
                region: null,
            },
        }),
    )
    assert.equal("panel" in added.generator, false)
    const off = await run(
        store.manage({
            ...f.source(),
            actor: owner,
            operation: { type: "generator-set", channelId: "50", patch: { panel: false } },
        }),
    )
    assert.equal(off.generator.panel, false)
    const on = await run(
        store.manage({
            ...f.source(),
            actor: owner,
            operation: { type: "generator-set", channelId: "50", patch: { panel: true } },
        }),
    )
    assert.equal("panel" in on.generator, false)
    const { room } = await run(
        store.rooms({
            serverId: "1",
            operation: { type: "create", channelId: "100", ownerId: "20", generatorChannelId: "50" },
        }),
    )
    const view = { name: "Study hall", userLimit: 4, hidden: false, locked: true, region: null, observedAt: f.now() }
    const updated = await run(
        store.rooms({ serverId: "1", operation: { type: "update", channelId: "100", panelMessageId: "900", view } }),
    )
    assert.deepEqual(updated, { type: "updated", room: { ...room, panelMessageId: "900", view } })
    assert.deepEqual(await run(store.rooms({ serverId: "1", operation: { type: "update", channelId: "101", view } })), {
        type: "updated",
        room: null,
    })
    const member = { ...owner, userId: "20", isOwner: false, nativePermissionAuthorized: false }
    const before = await run(store.query({ serverId: "1", operation: { type: "authority", actor: member } }))
    assert.equal("paused" in before, false)
    await f.backend.run(async (ctx) => {
        await ctx.db.insert("moderationSettings", {
            serverId: "1",
            config: { ...defaultSettings(), defcon: 2 },
            nextCaseNo: 1,
            nextAppealNo: 1,
        })
    })
    const after = await run(store.query({ serverId: "1", operation: { type: "authority", actor: member } }))
    assert.equal(after.paused, true)
})

test("a room owner's website requests queue for the bot, which finishes them, and a request after sign-out never reaches it", async (t) => {
    const f = await adapterFixture(t, websiteModules)
    const store = createVoiceStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const session = (expiresAt: number) => ({
        accessToken: "synthetic-provider-token",
        userId: "20",
        userName: "Member",
        servers: [],
        memberServers: [{ id: "1", name: "Server" }],
        expiresAt,
        lifetimeAt: f.now() + 28800000,
    })
    const sessionId = await f.backend.run(async (ctx) => {
        await ctx.db.insert("voiceGenerators", {
            serverId: "1",
            channelId: "50",
            categoryId: null,
            template: "Room",
            userLimit: null,
            region: null,
            revision: 1,
            createdAt: f.now(),
            updatedAt: f.now(),
        })
        await ctx.db.insert("voiceRooms", {
            serverId: "1",
            channelId: "100",
            ownerId: "20",
            generatorChannelId: "50",
            createdAt: f.now(),
        })
        return ctx.db.insert("dashboardSessions", {
            tokenHash: await tokenHash(sessionToken),
            ...session(f.now() + 300000),
        })
    })
    const ask = (requestId: string, operation: unknown) =>
        f.backend.mutation(voiceRequest, { sessionToken, serverId: "1", requestId, operation })
    const member = (await f.backend.query(voiceMember, { sessionToken, serverId: "1" })) as DashboardVoiceMember
    assert.deepEqual(
        member.rooms.map((row) => row.channelId),
        ["100"],
    )
    await assert.rejects(ask("00000000-0000-4000-8000-000000000009", { type: "lock" }))
    const { jobId } = (await ask("00000000-0000-4000-8000-000000000001", { type: "lock", roomId: "100" })) as {
        jobId: string
    }
    const ready = await run(store.memberReady({ serverId: "1" }))
    assert.deepEqual(
        ready.jobs.map((job: { id: string; operation: unknown }) => [job.id, job.operation]),
        [[jobId, { type: "lock", roomId: "100" }]],
    )
    const finished = await run(store.memberFinish({ serverId: "1", jobId, error: "Refused by the rule" }))
    assert.deepEqual([finished.job.state, finished.job.error], ["failed", "Refused by the rule"])
    // A finished request stays as it was
    assert.equal((await run(store.memberFinish({ serverId: "1", jobId }))).job.state, "failed")
    assert.deepEqual((await run(store.memberReady({ serverId: "1" }))).jobs, [])
    await ask("00000000-0000-4000-8000-000000000002", { type: "hide", roomId: "100" })
    await f.backend.run(async (ctx) => {
        await ctx.db.patch(sessionId, { expiresAt: f.now() - 1 })
    })
    assert.deepEqual((await run(store.memberReady({ serverId: "1" }))).jobs, [])
    await f.reject(store.memberFinish({ serverId: "1", jobId: "k".repeat(32) }), VoiceStoreError, 403)
})

test("the bot claims a website request once, a blocked room name is refused with the member's fresh roles, and a claimed request with no report expires as unconfirmed", async (t) => {
    const f = await adapterFixture(t, websiteModules)
    const store = createVoiceStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    await f.backend.run(async (ctx) => {
        await ctx.db.insert("voiceGenerators", {
            serverId: "1",
            channelId: "50",
            categoryId: null,
            template: "Room",
            userLimit: null,
            region: null,
            revision: 1,
            createdAt: f.now(),
            updatedAt: f.now(),
        })
        await ctx.db.insert("dashboardSessions", {
            tokenHash: await tokenHash(sessionToken),
            accessToken: "synthetic-provider-token",
            userId: "20",
            userName: "Member",
            servers: [],
            memberServers: [{ id: "1", name: "Server" }],
            expiresAt: f.now() + 300000,
            lifetimeAt: f.now() + 28800000,
        })
        await ctx.db.insert("moderationSettings", {
            serverId: "1",
            config: { ...defaultSettings(), automodEnabled: true },
            nextCaseNo: 1,
            nextAppealNo: 1,
        })
        await ctx.db.insert("automodRules", {
            serverId: "1",
            name: "blocked",
            rule: {
                name: "blocked",
                type: "words",
                enabled: true,
                priority: 0,
                action: "warn",
                threshold: 3,
                windowSeconds: 300,
                durationSeconds: 900,
                patterns: ["forbiddenword"],
                domainMode: "block",
                // A rule limited to one channel still guards a name, which shows across the server
                channelIds: ["999"],
                exemptChannelIds: [],
                exemptRoleIds: ["77"],
            },
        })
    })
    let request = 0
    const ask = async (operation: unknown) =>
        (
            (await f.backend.mutation(voiceRequest, {
                sessionToken,
                serverId: "1",
                requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`,
                operation,
            })) as { jobId: string }
        ).jobId
    const start = (jobId: string, roleIds: string[] = [], actorId = "20") =>
        run(store.memberStart({ serverId: "1", jobId, actorId, roleIds }))
    const row = (jobId: string) => f.backend.run((ctx) => ctx.db.get(jobId as never)) as Promise<any>
    // A jailed member controls no room from the website, whatever the operation
    const jailId = await f.backend.run((ctx) =>
        ctx.db.insert("jailRecords", {
            serverId: "1",
            userId: "20",
            state: "active",
            roleIds: [],
            caseNo: 1,
            createdAt: 1,
        }),
    )
    const jailed = await ask({ type: "rename", roomId: "100", name: "A jailed name" })
    assert.deepEqual(await start(jailed), { started: false })
    assert.match((await row(jailed)).error, /while you are jailed/)
    await f.backend.run((ctx) => ctx.db.delete(jailId))
    const blocked = await ask({ type: "rename", roomId: "100", name: "the forbiddenword room" })
    assert.deepEqual(await start(blocked), { started: false })
    assert.deepEqual(
        [(await row(blocked)).state, (await row(blocked)).error],
        ["failed", "The server's automod rule blocked blocked this room name. Choose another name"],
    )
    const exempt = await ask({ type: "rename", roomId: "100", name: "the forbiddenword room" })
    await f.reject(
        store.memberStart({ serverId: "1", jobId: exempt, actorId: "21", roleIds: [] }),
        VoiceStoreError,
        403,
    )
    assert.deepEqual(await start(exempt, ["77"]), { started: true })
    // Once claimed it is not offered again and a second claim does nothing, so a failed report cannot repeat the change
    assert.deepEqual((await run(store.memberReady({ serverId: "1" }))).jobs, [])
    assert.deepEqual(await start(exempt, ["77"]), { started: false })
    await f.backend.mutation(expireRequest, { id: exempt })
    assert.deepEqual(
        [(await row(exempt)).state, (await row(exempt)).error],
        ["failed", "The bot may have applied this but could not confirm it. Check your room before trying again"],
    )
    // A request the bot never claimed expires as not handled
    const unclaimed = await ask({ type: "hide", roomId: "100" })
    await f.backend.mutation(expireRequest, { id: unclaimed })
    assert.equal((await row(unclaimed)).error, "The bot did not handle this request in time. Try again")
})

test("a room record holds and clears the allow a lock took", async (t) => {
    const f = await adapterFixture(t, websiteModules)
    const store = createVoiceStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    await f.backend.run(async (ctx) => {
        await ctx.db.insert("voiceRooms", {
            serverId: "1",
            channelId: "100",
            ownerId: "20",
            generatorChannelId: "50",
            createdAt: f.now(),
        })
    })
    const update = (heldAllow: string) =>
        run(store.rooms({ serverId: "1", operation: { type: "update", channelId: "100", heldAllow } }))
    assert.equal((await update("1048576")).room.heldAllow, "1048576")
    assert.equal("heldAllow" in (await update("0")).room, false)
    const grants = (lockGrants: string[]) =>
        run(store.rooms({ serverId: "1", operation: { type: "update", channelId: "100", lockGrants } }))
    assert.deepEqual((await grants(["21", "22"])).room.lockGrants, ["21", "22"])
    assert.equal("lockGrants" in (await grants([])).room, false)
})
