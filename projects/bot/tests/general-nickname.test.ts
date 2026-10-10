import assert from "node:assert/strict"
import test from "node:test"
import type * as D from "@neonflux/backend/dashboard-contracts"
import type { GeneralNickname } from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { missingNicknamePermission, type GeneralSettingsStore, type NicknameOutcome } from "../src/general-settings.ts"
import { BackendRequestError } from "../src/backend-http.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { mockBackend } from "./backend-fake.ts"
import { platform, token } from "./moderation-fixture.ts"

// An in-memory general adapter that keeps the latest explicit change and its reported result
function memoryStore(conflict = false) {
    let state: GeneralNickname = { nickname: null, revision: 0, result: null }
    const writes: Array<{ actorId: string, value: string | null }> = [], results: Array<{ revision: number, value: string | null } & NicknameOutcome> = []
    const store: GeneralSettingsStore = {
        get: () => Effect.succeed({ prefix: "!", revision: 0 }), set: () => Effect.die("unused"),
        nickname: () => Effect.sync(() => state),
        setNickname: (actorId, value) => conflict ? Effect.fail(new BackendRequestError({ status: 409 })) : Effect.sync(() => {
            writes.push({ actorId, value })
            state = { nickname: value, revision: state.revision + 1, result: { state: "pending", nickname: value, at: 1 } }
            return { revision: state.revision }
        }),
        recordNickname: (revision, value, result) => Effect.sync(() => {
            results.push({ revision, value, ...result })
            if (revision === state.revision) state = { ...state, result: { nickname: value, at: 2, ...result } }
            return { recorded: true }
        }),
    }
    return { store, writes, results, state: () => state }
}

async function chat(options: { actorPermissions: bigint, keep?: string | null, conflict?: boolean }, messages: string[]) {
    const memory = memoryStore(options.conflict), edits: unknown[] = []
    let contents: string[] = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: createFixtures().ids.guild }, { general: memory.store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: options.actorPermissions })
        bot.rest.respond("PATCH /guilds/:id/members/@me", (request: { path: string, body: unknown }) => {
            edits.push({ path: request.path, body: request.body })
            const requested = (request.body as { nick: string | null }).nick
            return { body: bot.fixtures.member({ user: bot.fixtures.botUser(), nick: options.keep === undefined ? requested : options.keep }) }
        })
        yield* bot.ready()
        for (const content of messages) yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        contents = p.replies.requests().map(row => (row.body as { content: string }).content)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
    return { ...memory, edits, contents }
}

test("Managers set, show and reset the bot nickname from chat and each apply result is recorded", async () => {
    const result = await chat({ actorPermissions: Permissions.ManageGuild }, ["!nickname set Neon Helper", "!nickname", "!nickname reset", "!nickname"])
    assert.deepEqual(result.edits.map(edit => (edit as { body: unknown }).body), [{ nick: "Neon Helper" }, { nick: null }])
    assert.deepEqual(result.writes.map(write => write.value), ["Neon Helper", null])
    assert.deepEqual(result.results, [{ revision: 1, value: "Neon Helper", state: "applied" }, { revision: 2, value: null, state: "applied" }])
    assert.deepEqual(result.contents, ["Bot nickname set to Neon Helper", "Bot nickname: Neon Helper\nLast change: applied",
        "Bot nickname reset. The bot's username is shown", "Bot nickname: none, so the bot's username is shown\nLast change: applied"])
})

test("A nickname Fluxer silently keeps is reported as a missing Change Nickname permission", async () => {
    const result = await chat({ actorPermissions: Permissions.ManageGuild, keep: "Old name" }, ["!nickname set Neon", "!nickname"])
    assert.equal(result.edits.length, 1)
    assert.deepEqual(result.results, [{ revision: 1, value: "Neon", state: "failed", error: missingNicknamePermission }])
    assert.deepEqual(result.contents, [`The nickname was not applied. ${missingNicknamePermission}`, `Bot nickname: Neon\nLast change failed: ${missingNicknamePermission}`])
})

test("Changing the nickname follows the prefix permission rule and rejects invalid names before any write", async () => {
    const denied = await chat({ actorPermissions: Permissions.ViewChannel }, ["!nickname set Neon", "!nickname reset"])
    assert.deepEqual(denied.contents, ["Only the server owner or members with Manage Server can change the bot nickname", "Only the server owner or members with Manage Server can change the bot nickname"])
    assert.equal(denied.writes.length, 0); assert.equal(denied.edits.length, 0)
    const invalid = await chat({ actorPermissions: Permissions.Administrator }, ["!nickname set", `!nickname set ${"x".repeat(33)}`, "!nickname set \" Neon\"", "!nickname reset now", "!nickname rename Neon"])
    assert(invalid.contents.every(content => content.startsWith("Use nickname to show")), JSON.stringify(invalid.contents))
    assert.equal(invalid.contents.length, 5); assert.equal(invalid.writes.length, 0); assert.equal(invalid.edits.length, 0)
})

test("A chat change that predates a website change is not applied natively", async () => {
    const result = await chat({ actorPermissions: Permissions.ManageGuild, conflict: true }, ["!nickname set Neon"])
    assert.deepEqual(result.contents, ["The nickname changed on the website while this command ran. Check the current nickname and try again"])
    assert.equal(result.edits.length, 0); assert.equal(result.results.length, 0)
})

test("A dashboard nickname job is applied natively by the bot and its result is reported for that revision", async t => {
    for (const scenario of [{ keep: undefined, expected: { state: "applied" } }, { keep: "Old name", expected: { state: "failed", error: missingNicknamePermission } }] as const) await t.test(scenario.expected.state, async st => {
        const reported: unknown[] = [], failures: unknown[] = [], executions: unknown[] = [], edits: unknown[] = []
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
            platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageGuild })
            bot.rest.respond(`GET /users/${f.ids.user}`, { body: f.user({ bot: undefined, system: undefined }) })
            bot.rest.respond("PATCH /guilds/:id/members/@me", (request: { body: unknown }) => {
                edits.push(request.body)
                return { body: f.member({ user: f.botUser(), nick: scenario.keep ?? (request.body as { nick: string }).nick }) }
            })
            const job: D.DashboardConfigurationReadyJob = { family: "nickname", operation: { type: "set", nickname: "Neon" }, native: {}, id: "synthetic_nickname_job", actorId: f.ids.user,
                expectedConfigRevision: 6, state: "queued", createdAt: 0, expiresAt: 120000 }
            mockBackend(st, (call) => {
                const { path, body } = call
                if (path === "/dashboard-configuration/ready") return { jobs: [job] }
                if (path === "/dashboard-configuration/fail") { failures.push(body); return null }
                if (path === "/general/nickname-result") { reported.push(body); return { recorded: true } }
                assert.equal(path, "/dashboard-configuration/execute")
                executions.push(body)
                const { native: _native, ...stored } = job
                return { job: { ...stored, state: "applied" } }
            })
            yield* processDashboardConfigurationPass({ token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic") } }, bot.client)
            assert.equal(executions.length, 1)
            assert.deepEqual(edits, [{ nick: "Neon" }])
            assert.deepEqual(reported, [{ serverId: f.ids.guild, originServerId: f.ids.guild, revision: 7, nickname: "Neon", ...scenario.expected }])
            assert.deepEqual(failures, [])
        })).pipe(Effect.provide(TestClock.layer())))
    })
})
