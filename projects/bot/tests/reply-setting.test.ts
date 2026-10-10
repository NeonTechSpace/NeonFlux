import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { serverReplyStyle, type GeneralSettingsStore, type ReplyStyle } from "../src/general-settings.ts"
import { platform, token } from "./moderation-fixture.ts"

const f = createFixtures()
async function chat(actorPermissions: bigint, messages: string[], conflict = false) {
    let replyStyle: ReplyStyle = "embed", revision = 3
    const writes: unknown[] = [], contents: string[] = []
    const general: GeneralSettingsStore = {
        get: () => Effect.sync(() => ({ prefix: "!", replyStyle, revision })),
        set: (actorId, change, expected) => Effect.sync(() => {
            writes.push({ actorId, change, expected })
            if (conflict || expected !== revision) return { saved: false as const, conflict: true as const, revision }
            if ("replyStyle" in change) replyStyle = change.replyStyle
            return { saved: true as const, revision: ++revision }
        }),
        nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused"),
    }
    let style: ReplyStyle | undefined
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { general })), p = platform(bot, { actorOwner: false, actorPermissions })
        yield* bot.ready()
        for (const content of messages) yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        contents.push(...p.replies.requests().map(row => (row.body as { content: string }).content))
        // Reply style replies notify no one
        for (const row of p.replies.requests()) assert.deepEqual((row.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        style = serverReplyStyle(f.ids.guild)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
    return { writes, contents, style }
}

test("managers read and change the reply style in chat, and later replies use it at once", async () => {
    const result = await chat(Permissions.ManageGuild, ["!replies", "!replies text", "!replies"])
    assert.deepEqual(result.contents, ["Replies use embeds. Server managers can change it with `!replies embed` or `!replies text`", "Replies now use plain text",
        "Replies use plain text. Server managers can change it with `!replies embed` or `!replies text`"])
    assert.deepEqual(result.writes, [{ actorId: f.ids.user, change: { replyStyle: "text" }, expected: 3 }])
    assert.equal(result.style, "text")
})

test("members without Manage Server can read the reply style but not change it, and bad values or conflicts change nothing", async () => {
    const member = await chat(Permissions.ViewChannel, ["!replies", "!replies text"])
    assert.deepEqual(member.contents.slice(1), ["Only the server owner or members with Manage Server can change the reply style"])
    assert.deepEqual(member.writes, []); assert.equal(member.style, "embed")
    const usage = await chat(Permissions.ManageGuild, ["!replies fancy", "!replies text now"])
    assert.deepEqual(usage.contents, ["Use `!replies embed` or `!replies text`", "Use `!replies embed` or `!replies text`"]); assert.deepEqual(usage.writes, [])
    const raced = await chat(Permissions.ManageGuild, ["!replies text"], true)
    assert.deepEqual(raced.contents, ["The general settings changed while this command ran. Check the current reply style and try again"]); assert.equal(raced.style, "embed")
})
