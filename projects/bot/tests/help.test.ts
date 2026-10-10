import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { audiences, commandTable, helpPages, suggestCommand } from "../src/help.ts"
import { parseManagement } from "../src/response-command.ts"
import type { GeneralSettingsStore } from "../src/general-settings.ts"
import type { ResponseStore } from "../src/responses-store.ts"
import { platform } from "./moderation-fixture.ts"

const token = Redacted.make("synthetic-help-test-token")
const general = (prefix: string): GeneralSettingsStore => ({ get: () => Effect.succeed({ prefix, revision: 1 }), set: () => Effect.die("unused"),
    nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused") })
// A custom command named rules exists but is cooling down, and nothing else is defined
const responses: ResponseStore = { manage: () => Effect.die("unused"), evaluate: request => Effect.succeed(/^\?rules(\s|$)/.test(request.content) ? { send: false, defined: true } as const : { send: false } as const) }

function helpBot(options: { actorOwner?: boolean, actorPermissions?: bigint }) {
    return Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: createFixtures().ids.guild }, { general: general("?"), responses }))
        const native = platform(bot, options)
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () {
            const before = native.replies.requests().length
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
            yield* bot.idle()
            return native.replies.requests().slice(before).map(row => (row.body as { content: string }).content)
        })
        return { bot, say }
    })
}

test("help lists only the commands the member's permissions open, printed with the server prefix", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        const [index] = yield* say("?help")
        assert.match(index!, /^Commands you can use\. Send \?help <feature>/)
        assert.match(index!, /general: \?ping, \?help, \?afk, \?prefix, \?nickname\n/)
        assert.doesNotMatch(index!, /\?health|\?setup|\?mod\b|\?custom|\?cleanup/)
        const [moderation] = yield* say("?help moderation")
        assert.equal(moderation, "moderation commands\n?appeal cases|submit|list|show|withdraw ...\nAppeal a moderation case, in a one-to-one DM with NeonFlux")
        assert.deepEqual(yield* say("?help backup"), ["None of the backup commands are available to you here"])
        assert.match((yield* say("?help nothing-here"))[0]!, /^There is no feature or command with that name/)
        assert.equal(bot.failures().length, 0)
    })))
})

test("help for an administrator covers every command, and a command name opens its feature page", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* helpBot({ actorOwner: false, actorPermissions: Permissions.Administrator })
        const [index] = yield* say("?help")
        for (const entry of commandTable) assert.match(index!, new RegExp(`\\?${entry.name}\\b`))
        const pages = yield* say("?help mod")
        assert.match(pages[0]!, /^moderation commands\n\?mod warn\|kick/)
        assert.match(pages.join("\n"), /Run \?mod help for the full syntax/)
        assert.ok(pages.every(page => page.length <= 2000))
    })))
})

test("a mention of the bot followed by help answers like the help command", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        const [mentioned] = yield* say(`<@${bot.fixtures.ids.bot}> help`)
        assert.deepEqual([mentioned], yield* say("?help"))
        assert.deepEqual(yield* say(`<@${bot.fixtures.ids.bot}> help leveling`), yield* say("?help leveling"))
        // Another member's mention is ordinary chat
        assert.deepEqual(yield* say(`<@${bot.fixtures.ids.user}> help`), [])
    })))
})

test("an unknown command close to a built-in one gets one hint, while other text after the prefix stays quiet", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        assert.deepEqual(yield* say("?hepl"), ["Did you mean ?help? Send ?help to list the commands you can use"])
        assert.deepEqual(yield* say("?pign"), ["Did you mean ?ping? Send ?help to list the commands you can use"])
        assert.deepEqual(yield* say("?wow nice"), [])
        assert.deepEqual(yield* say("?!?"), [])
        // A custom command of that name exists, so roles is not suggested for it
        assert.deepEqual(yield* say("?rules"), [])
    })))
})

test("suggestions follow the SDK's edit limits and help pages fit one message", () => {
    assert.equal(suggestCommand("Tikcet"), "ticket")
    assert.equal(suggestCommand("leaderbord"), "leaderboard")
    assert.equal(suggestCommand("mo"), "mod")
    assert.equal(suggestCommand("xyz"), undefined)
    assert.equal(suggestCommand("bakcup"), "backup")
    const all = audiences(Permissions.Administrator)
    for (const topic of [undefined, ...new Set(commandTable.map(entry => entry.feature))]) {
        for (const page of helpPages("!!!!!", all, topic)!) assert.ok(page.length <= 2000)
    }
    assert.deepEqual([...audiences(Permissions.ManageGuild)].sort(), ["everyone", "manager"])
    assert.deepEqual([...audiences(Permissions.KickMembers)].sort(), ["everyone", "staff"])
})

test("every built-in command name is reserved from custom commands and autoresponders", () => {
    assert.ok(!("error" in parseManagement("custom", ["create", "hello", "text", "Synthetic reply"])))
    for (const { name } of commandTable) assert.ok("error" in parseManagement("custom", ["create", name, "text", "Synthetic reply"]), name)
})
