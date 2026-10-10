import assert from "node:assert/strict"
import test from "node:test"
import type { SetupProblem } from "@neonflux/backend/dashboard-contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { processSetupCheckPass, problemText, type SetupStore } from "../src/setup-check.ts"
import { platform, token } from "./moderation-fixture.ts"

// Moderation is on, autorole needs setup and assigns the bot's own top role, and tickets are off
function setupStore(queued = false) {
    const recorded: (readonly SetupProblem[])[] = []
    let statusReads = 0, managedRoleId = ""
    const store: SetupStore = {
        status: () => Effect.sync(() => {
            statusReads++
            return { sections: [{ id: "moderation", state: "on" }, { id: "autorole", state: "setup" }, { id: "tickets", state: "off" }] as const, managedRoles: [{ feature: "autorole", roleIds: [managedRoleId] }] as const }
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

test("setup lists every feature as on, off or needs setup with its next step, and both checks are for server managers", async () => {
    const setup = setupStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* setupBot(setup.store, { botPermissions: limited })
        assert.deepEqual(yield* say("!setup"), [["Setup checklist. Send !health to check the bot's permissions", "Moderation: on",
            "Autorole: needs setup. Next: Add a role with !autorole add @role", "Tickets: off. Next: Turn it on with !ticket module on"].join("\n")])
    })))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* setupBot(setup.store, { actorOwner: false, actorPermissions: 0n, botPermissions: limited })
        for (const content of ["!setup", "!health"]) assert.deepEqual(yield* say(content), ["Only the server owner or members with Manage Server can run this check"])
    })))
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
