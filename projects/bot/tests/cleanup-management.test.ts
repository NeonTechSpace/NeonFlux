import type { CleanupManageRequest, CleanupQueryRequest, CleanupSettings, CleanupPolicy, CleanupQueryResult, CleanupManageResult, CleanupTarget, CleanupCounts, CleanupSweep } from "@neonflux/contracts/cleanup"
import assert from "node:assert/strict"
import test from "node:test"

import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import type { CleanupStore } from "../src/cleanup-store.ts"
import { ago, at } from "../src/reply-style.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"

const f = createFixtures()
function remote() {
    const calls: CleanupManageRequest[] = [], queries: CleanupQueryRequest["operation"][] = []
    const settings: CleanupSettings = { enabled: false, revision: 3, policies: 1, retainedTargets: 0, retainedSweeps: 0, receipts: 0, targetCapacity: 10000, quotaPaused: false }
    const policy: CleanupPolicy = { channelId: f.ids.channel, revision: 1, enabled: false, ageMs: 86400000, ownerId: f.ids.user, excludedAuthorIds: [], excludedMessageIds: [], nextCheckAt: 0 }
    const policies = [policy]
    const view = { status: (op: { beforeTargetNo?: number }): CleanupQueryResult => ({ type: "status", settings, policy, sweep: null, page: null, targets: [], ...(op.beforeTargetNo ? {} : { nextBeforeTargetNo: 7 }) }) }
    const store: CleanupStore = {
        query: input => Effect.sync((): CleanupQueryResult => { queries.push(input.operation); const op = input.operation
            if (op.type === "settings") return { type: "settings", settings }
            if (op.type === "list") return { type: "policies", policies }
            if (op.type === "status") return view.status(op)
            return { type: "policy", policy }
        }),
        work: input => Effect.succeed(input.operation.type === "list" ? { type: "policies", policies: [], hasMore: false, settings } : { type: "progress", recorded: true, complete: true }),
        manage: input => Effect.sync(() => { calls.push(input); const op = input.operation
            if (op.type === "enable") { policy.enabled = op.enabled; policy.revision++ }
            return { duplicate: false, type: "policy", policy } as CleanupManageResult
        }),
    }
    return { store, calls, queries, settings, policy, policies, view }
}
const options = (store: CleanupStore, moderation?: ReturnType<typeof boundary>["store"]) => createBotOptions({ token, serverId: f.ids.guild }, { moderation, cleanup: store })
test("gateway cleanup namespace warns before explicit enable and preserves mention suppression", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup enable <#${f.ids.channel}>` })); const warning = yield* p.replies.next(); yield* bot.idle()
        assert.match((warning.body as { content: string }).content, /existing messages older[^]*\nConfirm: !cleanup enable <#\d+> confirm$/); assert.equal(r.calls.length, 0); assert.equal(r.queries.length, 0)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup enable ${f.ids.channel} confirm` })); yield* p.replies.next(); yield* bot.idle()
        // The policy revision comes from the list read right before the write
        assert.deepEqual(r.queries, [{ type: "list" }])
        assert.equal(r.calls.length, 1); assert.deepEqual(r.calls[0]!.operation, { type: "enable", channelId: f.ids.channel, expectedRevision: 1, enabled: true, confirm: true })
        assert.equal(r.calls[0]!.context.actor.userId, f.ids.user); assert.equal(r.calls[0]!.context.actorKind, "human")
        assert(p.replies.requests().every(req => { assert.deepEqual((req.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false }); return true }))
        const before = r.calls.length
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: `!cleanup disable ${f.ids.channel}` })); yield* bot.idle()
        assert.equal(r.calls.length, before); assert.equal(bot.failures().length, 0)
    })))
})
test("current staff can disable cleanup while manual moderation is off at DEFCON 2", async () => {
    const r = remote(), moderation = boundary()
    moderation.current.manualModerationEnabled = false
    moderation.store.gate = () => Effect.succeed({ allowed: false, defcon: 2, messageProtectionEnabled: false, joinProtectionEnabled: false, botMessageProtectionEnabled: false })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store, moderation.store)), p = platform(bot, { targetPermissions: Permissions.Administrator })
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId, bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup disable ${f.ids.channel}` })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(r.calls.length, 1); assert.equal(r.calls[0]!.context.actor.userId, f.ids.user)
        assert.deepEqual(r.calls[0]!.operation, { type: "enable", channelId: f.ids.channel, expectedRevision: 1, enabled: false })
        assert.equal(bot.failures().length, 0)
    })))
})
test("a new policy starts from revision 0 and the module and exclusions use the current revisions", async () => {
    const r = remote()
    r.policies.length = 0
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        const replies: string[] = []
        for (const content of [`!cleanup configure <#${f.ids.channel}> 30d`, "!cleanup module on", `!cleanup exclude <#${f.ids.channel}> author add <@${f.ids.user}>`, `!cleanup exclude <#${f.ids.channel}> message add 4000000000000000001`]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); replies.push(((yield* p.replies.next()).body as { content: string }).content); yield* bot.idle()
            if (content.includes("configure")) r.policies.push(r.policy)
        }
        // Commands that name a channel use its mention as plain text, and no reply shows a raw ID
        assert.equal(replies[0], `Cleanup in <#${f.ids.channel}> now deletes messages older than 1 day. It is off until !cleanup enable <#${f.ids.channel}>`)
        assert.deepEqual(replies.slice(2), [`Messages by <@${f.ids.user}> now stay in <#${f.ids.channel}>`, `That message now stays in <#${f.ids.channel}>`])
        assert.deepEqual(r.queries, [{ type: "list" }, { type: "settings" }, { type: "list" }, { type: "list" }])
        assert.deepEqual(r.calls.map(c => c.operation), [{ type: "configure", channelId: f.ids.channel, ageMs: 2592000000, expectedRevision: 0 }, { type: "module", enabled: true, expectedRevision: 3 },
            { type: "exclude", channelId: f.ids.channel, kind: "author", add: true, id: f.ids.user, expectedRevision: 1 }, { type: "exclude", channelId: f.ids.channel, kind: "message", add: true, id: "4000000000000000001", expectedRevision: 1 }])
        assert.equal(bot.failures().length, 0)
    })))
})
type Embed = { title?: string, description?: string, fields?: { name: string, value: string }[] }
const fields = (embed: Embed) => (embed.fields ?? []).map(x => [x.name, x.value])
const rendered = (embed: Embed) => [embed.title, embed.description, ...fields(embed).map(([name, value]) => `${name}: ${value}`)].filter(Boolean).join("\n")
// The owner's limits for one reply: About 10 rendered lines, or a page of 10 with its title, header, hint and next, 8 fields, 3 commands,
// no internal words and no raw IDs outside mentions and links
function withinLimits(embed: Embed, lines = 10) {
    const text = rendered(embed)
    assert(text.split("\n").length <= lines, text); assert(fields(embed).length <= 8, text); assert((text.match(/!cleanup /g)?.length ?? 0) <= 3, text)
    assert.doesNotMatch(text, /Message ID|—|backend|revision|\bhub\b|dry-run|stale|tracked|payload|deployment|reconcile|\d{4}-\d\d-\d\dT/i)
    assert.doesNotMatch(text.replace(/<[#@]\d+>|\(https:\/\/fluxer\.app\/channels\/[\d/]+\)/g, ""), /\d{15,}/)
}
const jump = (n: number) => { const target = id("7000000000000000", n), channel = n % 2 ? id("8000000000000000", n) : f.ids.channel; return `https://fluxer.app/channels/${f.ids.guild}/${channel}/${target}` }
const open = (store: CleanupStore) => Effect.gen(function* () {
    const bot = yield* createTestBot(options(store)), p = platform(bot)
    bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
    yield* bot.ready()
    const send = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle()
        return reply.body as { content?: string, embeds?: Embed[] } })
    return { bot, send }
})
const id = (base: string, n: number) => `${base}${String(n).padStart(3, "0")}`
const T = 1_767_225_600_000
const states = ["queued", "reserved", "deleted", "failed", "uncertain", "absent", "skipped", "cancelled"] as const
/** A handled message in every state, every other one in a thread, each with a check result */
function target(n: number): CleanupTarget {
    const messageId = id("7000000000000000", n), threadId = n % 2 ? id("8000000000000000", n) : undefined
    return { channelId: f.ids.channel, policyRevision: 1, moduleRevision: 1, sweepNo: 1, pageNo: 1, targetNo: 100 - n, messageId, ...(threadId ? { threadId } : {}), ownerId: f.ids.user, state: states[n % states.length]!,
        message: { messageId, channelId: threadId ?? f.ids.channel, serverId: f.ids.guild, observedAt: T, createdAt: null, authorId: f.ids.user, authorBot: false, authorSystem: false, type: 0, pinned: false, webhookId: null },
        createdAt: T, updatedAt: T, ...(n === 9 ? { noDispatch: true as const } : {}), observation: { messageId, channelId: f.ids.channel, observedAt: T, status: (["present", "absent", "unknown"] as const)[n % 3]!, channelVisible: true } }
}
test("channel status sums up the channel and pages its messages with next", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, send } = yield* open(r.store)
        const summary = (yield* send(`!cleanup status <#${f.ids.channel}>`)).embeds![0]!
        assert.equal(summary.title, "Cleanup channel"); assert.equal(summary.fields, undefined)
        assert.equal(summary.description, `<#${f.ids.channel}>: Off. When on, it deletes messages older than 1 day\nCleanup is off for the whole server\nNo run yet`)
        assert.match((yield* send(`!cleanup status ${f.ids.channel} next`)).content!, /!cleanup help/)
        const page = (yield* send(`!cleanup status <#${f.ids.channel}> messages`)).embeds![0]!
        assert.equal(page.description, `<#${f.ids.channel}>: No messages handled yet`); assert.deepEqual(fields(page), [["Next", `!cleanup status <#${f.ids.channel}> messages next`]])
        assert.equal((yield* send(`!cleanup status <#${f.ids.channel}> messages next`)).embeds![0]!.fields, undefined)
        assert.equal((yield* send(`!cleanup status ${f.ids.channel} messages next`)).content, `There is no next page to show. Send !cleanup status <#${f.ids.channel}> messages to start the list again`)
        assert.deepEqual(r.queries, [{ type: "status", channelId: f.ids.channel }, { type: "status", channelId: f.ids.channel }, { type: "status", channelId: f.ids.channel, beforeTargetNo: 7 }])
        assert.equal(bot.failures().length, 0)
    })))
})
test("a stopped channel with every count and message state stays a short summary with one hint", async () => {
    const r = remote(), counts: CleanupCounts = { scanned: 1500, skipped: 300, attempted: 1200, submitted: 1200, acknowledged: 1100, observedAbsent: 40, unresolved: 30, failed: 20, cancelled: 10 }
    const sweep: CleanupSweep = { channelId: f.ids.channel, policyRevision: 1, moduleRevision: 1, sweepNo: 1, threadId: id("8000000000000000", 99), ownerId: f.ids.user, cutoffAt: T, before: "1", pageNo: 3, state: "active", counts, createdAt: T, updatedAt: T }
    Object.assign(r.settings, { enabled: true, quotaPaused: true }); Object.assign(r.policy, { enabled: true, blockedReason: "history" })
    r.view.status = op => ({ type: "status", settings: r.settings, policy: r.policy, sweep, page: null, targets: Array.from({ length: 10 }, (_, n) => target(n + (op.beforeTargetNo ? 10 : 0))), ...(op.beforeTargetNo ? {} : { nextBeforeTargetNo: 91 }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, send } = yield* open(r.store), messages = `!cleanup status <#${f.ids.channel}> messages`, hint = "NeonFlux never repeats a deletion that failed or is not confirmed, so check those messages yourself"
        const summary = (yield* send(`!cleanup status <#${f.ids.channel}>`)).embeds![0]!
        assert.equal(summary.description, [`<#${f.ids.channel}>: On, but stopped because the channel's messages could not be read. It tries again shortly`, "Cleanup is paused for the whole server because the deletion limit is reached",
            `Running, started ${ago(T)} and now in <#${id("8000000000000000", 99)}>. So far: 1100 deleted, 300 kept, 40 already gone, 20 failed, 30 not confirmed, 10 cancelled`, `${hint}. See them with ${messages}`].join("\n"))
        assert.equal(summary.fields, undefined); withinLimits(summary)
        const page = (yield* send(messages)).embeds![0]!, lines = page.description!.split("\n")
        assert.equal(lines.length, 12); assert.equal(lines[0], `<#${f.ids.channel}>, newest first`)
        assert.equal(lines[1], `[Message 1](${jump(0)}): Waiting, still there when checked`)
        assert.equal(lines[4], `[Message 4](${jump(3)}) in <#${id("8000000000000000", 3)}>: Failed, still there when checked`)
        assert.equal(lines[10], `[Message 10](${jump(9)}) in <#${id("8000000000000000", 9)}>: Not attempted, still there when checked`)
        assert.equal(lines[11], hint); assert.equal(rendered(page).split(hint).length, 2)
        assert.deepEqual(fields(page), [["Next", `${messages} next`]]); withinLimits(page, 14)
        const second = (yield* send(`${messages} next`)).embeds![0]!
        assert.equal(second.description!.split("\n")[1], `[Message 1](${jump(10)}): Deleted, gone when checked`); assert.equal(second.fields, undefined); withinLimits(second, 14)
        assert.deepEqual(r.queries.at(-1), { type: "status", channelId: f.ids.channel, beforeTargetNo: 91 })
        assert.equal(bot.failures().length, 0)
    })))
})
test("cleanup list pages 50 channels by 10 with next", async () => {
    const r = remote()
    r.policies.splice(0, 1, ...Array.from({ length: 50 }, (_, n) => ({ ...r.policy, channelId: id("6000000000000000", n), enabled: n % 2 === 0, ...(n % 4 === 0 ? { blockedReason: "quota" } : {}) })))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, send } = yield* open(r.store)
        const first = (yield* send("!cleanup list")).embeds![0]!, lines = first.description!.split("\n")
        assert.equal(lines.length, 11); assert.equal(lines[0], `<#${id("6000000000000000", 0)}>: On, stopped, deletes messages older than 1 day`)
        assert.equal(lines[1], `<#${id("6000000000000000", 1)}>: Off, deletes messages older than 1 day`); assert.equal(lines[10], "Details: `!cleanup status #channel`")
        assert.deepEqual(fields(first), [["Next", "`!cleanup list next`"]]); withinLimits(first, 13)
        for (let page = 2; page <= 5; page++) {
            const next = (yield* send("!cleanup list next")).embeds![0]!
            assert(next.description!.startsWith(`<#${id("6000000000000000", (page - 1) * 10)}>`)); assert.equal(fields(next).length, page < 5 ? 1 : 0); withinLimits(next, 13)
        }
        assert.equal((yield* send("!cleanup list next")).content, "There is no next page to show. Send !cleanup list to start the list again")
        assert.deepEqual(r.queries, Array.from({ length: 5 }, () => ({ type: "list" })))
        assert.equal(bot.failures().length, 0)
    })))
})
test("module and policy cards show a limit only once it is 80% used", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, send } = yield* open(r.store)
        const settings = (yield* send("!cleanup status")).embeds![0]!
        assert.equal(settings.description, "Off\n`!cleanup list` lists the channels and `!cleanup status #channel` shows one"); assert.deepEqual(fields(settings), [["Channels", "1"]]); withinLimits(settings)
        r.settings.policies = 40
        assert.deepEqual(fields((yield* send("!cleanup status")).embeds![0]!), [["Channels", "40 of 50"]])
        assert.deepEqual(fields((yield* send(`!cleanup show <#${f.ids.channel}>`)).embeds![0]!), [["Status", "Off"], ["Deletes messages older than", "1 day"], ["Owner", `<@${f.ids.user}>`]])
        Object.assign(r.policy, { enabled: true, blockedReason: "authority", nextCheckAt: T, excludedAuthorIds: Array.from({ length: 40 }, (_, n) => id("5000000000000000", n)), excludedMessageIds: Array.from({ length: 79 }, (_, n) => id("4000000000000000", n)) })
        const busy = (yield* send(`!cleanup show <#${f.ids.channel}>`)).embeds![0]!
        assert.deepEqual(fields(busy), [["Status", "On, stopped because the permissions could not be confirmed. It tries again shortly"], ["Deletes messages older than", "1 day"], ["Owner", `<@${f.ids.user}>`],
            ["Next check", at(T)], ["Excluded authors", "40 of 50"], ["Excluded messages", "79"]])
        withinLimits(busy)
        assert.equal(bot.failures().length, 0)
    })))
})
