import assert from "node:assert/strict"
import test from "node:test"
import type { SetupProblem } from "@neonflux/backend/dashboard-contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { createSetupStore, processSetupCheckPass, problemText, readSetupProblems, type SetupStore } from "../src/setup-check.ts"
import { platform, token } from "./moderation-fixture.ts"
import { mockBackend } from "./backend-fake.ts"

// Moderation is on, autorole needs setup and assigns the bot's own top role, and tickets are off
function setupStore(queued = false) {
    const recorded: (readonly SetupProblem[])[] = []
    let statusReads = 0, managedRoleId = ""
    const store: SetupStore = {
        status: () => Effect.sync(() => {
            statusReads++
            return { sections: [{ id: "moderation", state: "on" }, { id: "autorole", state: "setup" }, { id: "tickets", state: "off" }] as const, managedRoles: [{ feature: "autorole", roleIds: [managedRoleId] }] as const, staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] }, threadFeatures: [] }
        }),
        ready: () => Effect.succeed({ queued }),
        record: (_serverId, problems) => Effect.sync(() => { recorded.push(problems); return { recorded: true } }),
    }
    return { store, recorded, reads: () => statusReads, manage: (roleId: string) => { managedRoleId = roleId } }
}
const limited = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks | Permissions.ReadMessageHistory | Permissions.ManageRoles

function setupBot(store: SetupStore, options: Parameters<typeof platform>[1]) {
    return Effect.gen(function* () {
        const f = createFixtures()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { setup: store }))
        const p = platform(bot, options)
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () {
            const before = p.replies.requests().length
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
            return p.replies.requests().slice(before).map(row => (row.body as { content: string }).content)
        })
        return { bot, p, say }
    })
}

test("health names each missing permission of an enabled feature and each assigned role at or above the bot, with its fix", async () => {
    const setup = setupStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, p, say } = yield* setupBot(setup.store, { botPermissions: limited })
        setup.manage(p.botRole.id)
        const [reply] = yield* say("!health")
        const lines = reply!.split("\n")
        assert.equal(lines[0], "Health check")
        assert.equal(lines[1], "Backend: reachable")
        assert.match(lines[2]!, /^Gateway: Connected/)
        assert.deepEqual(lines.slice(3), ["Problems:", "- Moderation: Grant Kick Members, Ban Members, Manage Messages and Moderate Members to the NeonFlux role",
            `- Autorole: Move the NeonFlux role above <@&${p.botRole.id}>`])
        assert.equal(bot.failures().length, 0)
    })))
})

test("health audits dangerous roles of the everyone role or many members, staff roles lacking their class's permissions and the verification level bypass", async () => {
    let staffRoleId = ""
    const store: SetupStore = {
        status: () => Effect.sync(() => ({ sections: [{ id: "moderation", state: "on" }, { id: "autorole", state: "on" }, { id: "reaction", state: "on" }, { id: "rolepicker", state: "setup" }] as const,
            managedRoles: [], staffRoleIds: { moderation: [staffRoleId], cases: [staffRoleId], automod: [], security: [], appeals: [] }, threadFeatures: [] })),
        ready: () => Effect.succeed({ queued: false }),
        record: () => Effect.succeed({ recorded: true }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, p, say } = yield* setupBot(store, { botPermissions: limited, everyonePermissions: Permissions.MentionEveryone,
            targetPermissions: Permissions.BanMembers | Permissions.ManageWebhooks, guild: { verification_level: 2 } })
        staffRoleId = p.targetRole.id
        const counts = new Map([[p.targetRole.id, 25], [p.actorRole.id, 3]])
        const searches = bot.rest.respond("POST /guilds/:id/members-search", (request) => {
            const roleId = (request.body as { role_ids: string[] }).role_ids[0]!
            return { body: { guild_id: bot.fixtures.ids.guild, members: [], page_result_count: 0, total_result_count: counts.get(roleId) ?? 1, indexing: false } }
        })
        const [reply, more] = yield* say("!health")
        const lines = [reply, more].join("\n").split("\n").filter(line => line.startsWith("- Safety:"))
        assert.deepEqual(lines.slice(0, 3), [
            "- Safety: The everyone role gives Mention Everyone to every member. Remove it from the everyone role",
            `- Safety: <@&${p.targetRole.id}> gives Ban Members and Manage Webhooks to 25 members. Remove them from the role, or keep them on a role only trusted staff hold`,
            `- Safety: The moderation staff role <@&${p.targetRole.id}> lacks Kick Members, Manage Channels, Manage Messages and Moderate Members, so its members cannot run the !mod commands that need them. Grant them to the role, or choose other roles with !mod staff moderation`,
        ])
        assert.match(lines[3]!, /^- Safety: Fluxer skips its verification level for members who have any role, so Autorole and Reaction roles let members past it\. If you rely on the verification level/)
        assert.equal(lines.length, 4)
        // The Administrator role is counted first, and each search counts human members of one role
        assert.deepEqual(searches.requests().map(request => request.body), [p.actorRole.id, p.targetRole.id, p.botRole.id].map(id => ({ limit: 1, offset: 0, role_ids: [id], is_bot: false })))
        assert.equal(bot.failures().length, 0)
    })))
})

test("setup lists every feature as on, off or needs setup with its next step, and both checks are for server managers", async () => {
    const setup = setupStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* setupBot(setup.store, { botPermissions: limited })
        assert.deepEqual(yield* say("!setup"), [["Setup checklist. Send !health to check the bot's permissions", "Moderation: on",
            "Autorole: needs setup. Next: Add a role with !autorole add @role", "Tickets: off. Next: Turn it on with !ticket module on", "Start from a preset of these settings with !preset list"].join("\n")])
    })))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* setupBot(setup.store, { actorOwner: false, actorPermissions: 0n, botPermissions: limited })
        for (const content of ["!setup", "!health"]) assert.deepEqual(yield* say(content), ["Only the server owner or members with Manage Server can run this check"])
    })))
})

test("the backend's setup status decodes every overview section, including sticky messages, the dashboard link and security alerts", async t => {
    mockBackend(t, call => {
        assert.equal(call.path, "/setup/status")
        return { sections: [{ id: "sticky", state: "on" }, { id: "sidebar", state: "off" }, { id: "alerts", state: "setup" }], managedRoles: [], staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] }, threadFeatures: [] }
    })
    const status = await Effect.runPromise(createSetupStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") }).status("10"))
    assert.deepEqual(status.sections.map(row => row.id), ["sticky", "sidebar", "alerts"])
    assert.equal(problemText({ kind: "permissions", feature: "alerts", permissions: ["ViewAuditLog", "ManageGuild"] }), "Security alerts: Grant View Audit Log and Manage Server to the NeonFlux role")
})

test("the dashboard check answers only a waiting request, with the bot's own reads", async () => {
    for (const queued of [true, false]) {
        const setup = setupStore(queued)
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const { bot, p } = yield* setupBot(setup.store, { botPermissions: limited | Permissions.KickMembers | Permissions.BanMembers | Permissions.ManageMessages | Permissions.ModerateMembers })
            setup.manage(p.targetRole.id)
            yield* processSetupCheckPass(setup.store, bot.fixtures.ids.guild, bot.client)
        })))
        assert.deepEqual(setup.recorded, queued ? [[]] : [])
        assert.equal(setup.reads(), queued ? 1 : 0)
    }
    assert.equal(problemText({ kind: "permissions", feature: "general", permissions: ["SendMessages"] }), "Replies: Grant Send Messages to the NeonFlux role")
    assert.match(problemText({ kind: "gateway", state: "Recovering" }), /^Gateway: Recovering\. NeonFlux reconnects on its own/)
})

test("events with discussion threads on need Create Public Threads", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-setup-token" })
        platform(bot, { botPermissions: limited })
        const status = (threadFeatures: "events"[]) => ({ sections: [{ id: "events" as const, state: "on" as const }], managedRoles: [],
            staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] }, threadFeatures })
        const events = (problems: readonly SetupProblem[]) => problems.filter(problem => "feature" in problem && problem.feature === "events")
        assert.deepEqual(events(yield* readSetupProblems(bot.client, bot.fixtures.ids.guild, status([]))), [])
        assert.deepEqual(events(yield* readSetupProblems(bot.client, bot.fixtures.ids.guild, status(["events"]))), [{ kind: "permissions", feature: "events", permissions: ["CreatePublicThreads"] }])
    })))
})
