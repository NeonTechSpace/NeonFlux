import assert from "node:assert/strict"
import nodeTest, { type TestContext } from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { makeFunctionReference } from "convex/server"
import type { GeneralNickname } from "@neonflux/contracts/general"
import type { DashboardConfigurationSnapshot } from "../dashboard-contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { tokenHash } from "../convex/dashboard.ts"
import { createGeneralSettingsStore, missingNicknamePermission } from "../../bot/src/general-settings.ts"
import { BackendRequestError } from "../../bot/src/backend-http.ts"
import { processDashboardConfigurationPass } from "../../bot/src/dashboard-configuration.ts"

const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)
const modules = {
    "../convex/generalSettings.ts": () => import("../convex/generalSettings.ts"),
    "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/dashboardConfiguration.ts": () => import("../convex/dashboardConfiguration.ts"),
}
const sessionToken = "a".repeat(64)

async function sdk() {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Effect, Redacted } = await import(pathToFileURL(require.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(require.resolve("effect/testing")).href)
    const root = new URL("./", pathToFileURL(require.resolve("@neontechspace/fluxerly/effect")))
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
    const { Permissions } = await import(new URL(pkg.exports["./effect"].import, root).href)
    const { createTestBot } = await import(new URL(pkg.exports["./effect/testing"].import, root).href)
    return { Effect, Redacted, TestClock, Permissions, createTestBot }
}

async function fixture(t: TestContext) {
    const f = await adapterFixture(t, modules)
    const store = createGeneralSettingsStore(f.config, "1"), wrongStore = createGeneralSettingsStore(f.wrongConfig, "1")
    const nickname = () => f.run<GeneralNickname>(store.nickname())
    // A signed-in manager session, admitted directly because provider verification is outside this contract
    await f.backend.mutation(makeFunctionReference<"mutation">("dashboard:store"), { tokenHash: await tokenHash(sessionToken), accessToken: "synthetic-provider-token", user: { id: "20", name: "Manager" }, servers: [{ id: "1", name: "Synthetic", icon: null }] })
    const snapshot = async () => {
        const value = await f.backend.query(makeFunctionReference<"query">("dashboardConfiguration:snapshot"), { sessionToken, serverId: "1", family: "nickname" }) as DashboardConfigurationSnapshot
        assert.equal(value.family, "nickname"); if (value.family !== "nickname") throw new Error("Wrong family")
        return value
    }
    let request = 0
    const queue = async (operation: { type: "set", nickname: string } | { type: "reset" }) => f.backend.mutation(makeFunctionReference<"mutation">("dashboardConfiguration:enqueue"),
        { sessionToken, serverId: "1", family: "nickname", operation, expectedConfigRevision: (await snapshot()).configRevision, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}` })
    return { ...f, store, wrongStore, nickname, snapshot, queue }
}

// The bot's real dashboard pass against the real backend, with Fluxer replaced by the SDK's in-memory transport
async function botPass(f: Awaited<ReturnType<typeof fixture>>, keep?: string) {
    const { Effect, Redacted, TestClock, Permissions, createTestBot } = await sdk(), edits: unknown[] = []
    await f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(f.now())
        const bot = yield* createTestBot({ token: "synthetic-general-adapter-sdk-token" }), native = bot.fixtures
        const managerRole = native.role({ permissions: Permissions.ManageGuild.toString() }), botRole = native.role({ permissions: Permissions.ViewChannel.toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /users/20", { body: native.user({ id: "20", bot: false, system: false }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [native.role({ id: "1", permissions: "0" }), managerRole, botRole] })
        bot.rest.respond("GET /guilds/1/members/20", { body: native.member({ user: native.user({ id: "20", bot: false, system: false }), roles: [managerRole.id], communication_disabled_until: null }) })
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], communication_disabled_until: null }) })
        bot.rest.respond("PATCH /guilds/1/members/@me", (request: { body: { nick: string | null } }) => {
            edits.push(request.body)
            return { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], nick: keep ?? request.body.nick }) }
        })
        yield* processDashboardConfigurationPass({ token: Redacted.make("synthetic-general-adapter-sdk-token"), serverId: "1", backend: f.config }, bot.client)
    })).pipe(Effect.provide(TestClock.layer())))
    return edits
}

test("chat nickname changes authenticate, validate and record only the latest result", async t => {
    const f = await fixture(t)
    assert.deepEqual(await f.nickname(), { nickname: null, revision: 0, result: null })
    await f.reject(f.wrongStore.setNickname("20", "Neon", f.now()), BackendRequestError, 401)
    for (const value of ["", " Neon", "x".repeat(33), "Neon\u0007", "Ne\u202eon"]) await f.reject(f.store.setNickname("20", value, f.now()), BackendRequestError, 400)
    await assert.rejects(f.backend.mutation(makeFunctionReference<"mutation">("generalSettings:nickname"), { request: { serverId: "1", actorId: "20", managerAuthorized: false, createdAt: f.now(), nickname: "Neon" } }))
    const first = await f.run<{ revision: number }>(f.store.setNickname("20", "Neon", f.now()))
    assert.deepEqual(await f.nickname(), { nickname: "Neon", revision: first.revision, result: { state: "pending", nickname: "Neon", at: f.now() } })
    const second = await f.run<{ revision: number }>(f.store.setNickname("20", null, f.now()))
    assert.deepEqual(await f.run(f.store.recordNickname(first.revision, "Neon", { state: "applied" })), { recorded: false })
    assert.deepEqual(await f.run(f.store.recordNickname(second.revision, "Neon", { state: "applied" })), { recorded: false })
    assert.deepEqual(await f.run(f.store.recordNickname(second.revision, null, { state: "failed", error: missingNicknamePermission })), { recorded: true })
    assert.deepEqual(await f.nickname(), { nickname: null, revision: second.revision, result: { state: "failed", nickname: null, at: f.now(), error: missingNicknamePermission } })
    // The prefix reader still decodes the shared general route
    assert.deepEqual(await f.run(f.store.get()), { prefix: "!", replyStyle: "embed", revision: 0 })
    // Chat changes the reply style alone, at the shared general revision, and a stale revision changes nothing
    assert.deepEqual(await f.run(f.store.set("20", { replyStyle: "text" }, 0)), { saved: true, revision: 1 })
    assert.deepEqual(await f.run(f.store.set("20", { replyStyle: "embed" }, 0)), { saved: false, conflict: true, revision: 1 })
    assert.deepEqual(await f.run(f.store.get()), { prefix: "!", replyStyle: "text", revision: 1 })
})

test("a website nickname change reaches the bot, which applies it natively and records what Fluxer kept", async t => {
    const f = await fixture(t)
    await assert.rejects(f.queue({ type: "set", nickname: " Neon" }))
    const queued = await f.queue({ type: "set", nickname: "Neon Helper" })
    assert.equal(queued.queued, true)
    assert.deepEqual(await botPass(f), [{ nick: "Neon Helper" }])
    let current = await f.snapshot()
    assert.equal(current.jobs[0]!.state, "applied")
    assert.deepEqual(current.data.settings, { nickname: "Neon Helper", revision: 1, result: { state: "applied", nickname: "Neon Helper", at: f.now() } })
    // Without Change Nickname, Fluxer answers with the old nickname and the result says so
    await f.queue({ type: "reset" })
    assert.deepEqual(await botPass(f, "Neon Helper"), [{ nick: null }])
    current = await f.snapshot()
    assert.deepEqual(current.data.settings, { nickname: null, revision: 2, result: { state: "failed", nickname: null, at: f.now(), error: missingNicknamePermission } })
    // A chat change made before the website change cannot overwrite it
    await f.reject(f.store.setNickname("20", "Older", f.now() - 1), BackendRequestError, 409)
    assert.deepEqual(await botPass(f), [])
})
