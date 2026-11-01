import assert from "node:assert/strict"
import test from "node:test"
import type {
    ClaimedReminder,
    Reminder,
    ReminderManageRequest,
    ReminderOperation,
    ReminderWorkOperation,
} from "@neonflux/contracts/reminders"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { parseRemindCommand, remindCritical, remindHelp, remindStaff } from "../src/remind-command.ts"
import { reminderList } from "../src/remind-management.ts"
import type { ReminderStore } from "../src/remind-store.ts"
import { deliverReminder, startReminderWorker } from "../src/remind-worker.ts"
import { platform } from "./moderation-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z")
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const parse = (source: string, args = source.split(" ").slice(1)) => parseRemindCommand(args, source)
const sent = (request: { path: string; body?: unknown }) => ({
    path: request.path,
    ...(request.body as { content: string; allowedMentions?: unknown }),
})
const silent = { parse: [], users: [], roles: [], replied_user: false }
const reminder = (fields: Partial<Reminder> = {}): Reminder => ({
    reminderNo: 1,
    text: "take out the bins",
    channelId: "5001",
    dueAt: now + 7200000,
    state: "active",
    createdAt: now,
    ...fields,
})

test("Commands take a duration and the text as typed, and list, cancel and settings forms", () => {
    assert.deepEqual(parse("remind 2h take out the bins"), { type: "create", seconds: 7200, text: "take out the bins" })
    assert.deepEqual(parse("remind 1d12h call"), { type: "create", seconds: 129600, text: "call" })
    assert.deepEqual(parse("remind 1M x"), { type: "create", seconds: 60, text: "x" })
    // Spaces, line breaks and quotes stay, and text whose quotes never close still works
    assert.deepEqual(parseRemindCommand(undefined, 'remind 1m  say "hi   there\nnow'), {
        type: "create",
        seconds: 60,
        text: 'say "hi   there\nnow',
    })
    assert.deepEqual(parse("remind 365d x"), { type: "create", seconds: 31536000, text: "x" })
    assert.deepEqual(parse("remind"), { type: "help" })
    assert.deepEqual(parse("remind help"), { type: "help" })
    assert.deepEqual(parse("remind list"), { type: "list", next: false })
    assert.deepEqual(parse("remind list next"), { type: "list", next: true })
    assert.deepEqual(parse("remind cancel 3"), { type: "cancel", reminderNo: 3 })
    assert.deepEqual(parse("remind cancel #3"), { type: "cancel", reminderNo: 3 })
    assert.deepEqual(parse("remind settings"), { type: "settings" })
    assert.deepEqual(parse("remind module off"), { type: "settings-set", patch: { enabled: false } })
    assert.deepEqual(parse("remind limit 5"), { type: "settings-set", patch: { memberLimit: 5 } })
    for (const source of [
        "remind 59s too soon",
        "remind 366d too late",
        "remind 2h",
        `remind 1h ${"x".repeat(501)}`,
        "remind cancel",
        "remind cancel x",
        "remind limit 0",
        "remind limit 26",
        "remind module",
        "remind fly",
    ])
        assert.ok("error" in parse(source), source)
    assert.deepEqual(parseRemindCommand(undefined, 'remind list "x'), { error: "Check the quoting. Use !remind help" })
    assert.equal(remindStaff(parse("remind module on")), true)
    assert.equal(remindStaff(parse("remind 1h x")), false)
    assert.equal(remindCritical(parse("remind module off")), true)
    assert.equal(remindCritical(parse("remind module on")), false)
    assert.match(remindHelp, /!remind <duration> <text>/)
})

function memory(rows: Reminder[] = []) {
    const operations: ReminderOperation[] = [],
        requests: ReminderManageRequest[] = []
    const store: ReminderStore = {
        query: (input) =>
            Effect.succeed({
                settings: { enabled: true, memberLimit: 25 },
                reminders: input.userId ? rows : [],
            }),
        manage: (input) =>
            Effect.sync(() => {
                operations.push(input.operation)
                requests.push(input)
                const op = input.operation
                if (op.type === "settings")
                    return { type: "settings" as const, settings: { enabled: false, memberLimit: 25 } }
                if (op.type === "cancel") return { type: "cancelled" as const, reminderNo: op.reminderNo }
                return { type: "created" as const, reminder: reminder({ text: op.text }) }
            }),
        work: () => Effect.die("Unexpected work"),
    }
    return { store, operations, requests }
}
function chat(store: ReminderStore, permissions: bigint = Permissions.SendMessages) {
    const f = createFixtures()
    return Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot(
            createBotOptions(
                { token: Redacted.make("synthetic-remind-token"), serverId: f.ids.guild },
                { reminders: store },
            ),
        )
        const p = platform(bot, { actorOwner: false, actorPermissions: permissions })
        yield* bot.ready()
        const say = (content: string) =>
            bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        return { bot, p, say, f: bot.fixtures }
    })
}

test("A member sets a reminder in a channel, as typed, and the reply repeats none of it", async () => {
    const m = memory()
    await controlled(
        Effect.gen(function* () {
            const { p, say, f } = yield* chat(m.store)
            yield* say('!remind 2h call "mom   now')
            assert.deepEqual(m.operations, [
                { type: "create", seconds: 7200, text: 'call "mom   now', channelId: f.ids.channel },
            ])
            assert.equal(m.requests[0]!.managerAuthorized, false)
            const reply = sent(p.replies.requests()[0]!)
            assert.match(reply.content, /Reminder #1 set for <t:\d+:f>\. NeonFlux will DM you/)
            assert.doesNotMatch(reply.content, /mom/)
        }),
    )
})

test("The list goes by DM, so its text stays out of the channel", async () => {
    const m = memory([reminder({ text: "private words" }), reminder({ reminderNo: 2, state: "uncertain" })])
    await controlled(
        Effect.gen(function* () {
            const { p, say, f } = yield* chat(m.store)
            yield* say("!remind list")
            const posts = p.replies.requests().map(sent)
            assert.equal(posts.length, 2)
            assert.equal(posts[0]!.path, `/channels/${p.dmId}/messages`)
            assert.match(JSON.stringify(posts[0]), /private words/)
            assert.match(JSON.stringify(posts[0]), /not confirmed as sent/)
            assert.equal(posts[1]!.path, `/channels/${f.ids.channel}/messages`)
            assert.match(posts[1]!.content, /You have 2 reminders here/)
            assert.doesNotMatch(JSON.stringify(posts[1]), /private words/)
        }),
    )
})

test("A closed DM keeps the list out of the channel too", async () => {
    const m = memory([reminder({ text: "private words" })])
    await controlled(
        Effect.gen(function* () {
            const { bot, say, p } = yield* chat(m.store)
            bot.rest.respond("POST /users/@me/channels", {
                status: 403,
                body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic refusal" },
            })
            yield* say("!remind list")
            const posts = p.replies.requests().map(sent)
            assert.equal(posts.length, 1)
            assert.match(posts[0]!.content, /could not DM you/)
            assert.doesNotMatch(JSON.stringify(posts), /private words/)
        }),
    )
})

test("A command sent in a DM gets the one line that says where it works", async () => {
    const m = memory()
    await controlled(
        Effect.gen(function* () {
            const { bot, p } = yield* chat(m.store)
            const { guild_id: _guild, ...direct } = bot.fixtures.message({
                channel_id: p.dmId,
                content: "!remind 2h take out the bins",
            })
            yield* bot.emit("MESSAGE_CREATE", direct).pipe(Effect.andThen(bot.idle()))
            assert.deepEqual(m.operations, [])
            assert.match(
                sent(p.replies.requests()[0]!).content,
                /Send `!remind` in the server\. It does not work in a DM/,
            )
        }),
    )
})

test("Long lists page with next", () => {
    const rows = Array.from({ length: 10 }, (_, i) => reminder({ reminderNo: i + 1 }))
    const first = reminderList(rows, 1, 2, "!")
    assert.deepEqual(first.fields, [["Next", "`!remind list next`"]])
    assert.equal(reminderList(rows, 2, 2, "!").fields, undefined)
    assert.match(reminderList([], 1, 1, "?").description!, /`\?remind 2h take out the bins`/)
})

test("Settings need a manager, and cancelling needs nobody else", async () => {
    for (const manager of [false, true]) {
        const m = memory()
        await controlled(
            Effect.gen(function* () {
                const { say, p } = yield* chat(m.store, manager ? Permissions.ManageGuild : Permissions.SendMessages)
                yield* say("!remind module off")
                yield* say("!remind cancel 2")
                const ops = m.operations.map((op) => op.type)
                assert.deepEqual(ops, manager ? ["settings", "cancel"] : ["cancel"])
                assert.match(
                    sent(p.replies.requests()[0]!).content,
                    manager ? /Reminders are off/ : /Only the server owner or members with Manage community/,
                )
                assert.match(sent(p.replies.requests()[1]!).content, /Reminder #2 cancelled/)
                if (manager) assert.equal(m.requests[0]!.managerAuthorized, true)
            }),
        )
    }
})

test("A refusal says what to do", async () => {
    for (const [reason, limit, text] of [
        ["off", undefined, /Reminders are off/],
        ["member-limit", 25, /already keep 25 reminders/],
        ["server-limit", 5000, /keeps as many reminders as it can/],
        ["missing", undefined, /no reminder with that number/],
    ] as const) {
        const m = memory()
        const store: ReminderStore = {
            ...m.store,
            manage: () => Effect.succeed({ type: "refused" as const, reason, ...(limit ? { limit } : {}) }),
        }
        await controlled(
            Effect.gen(function* () {
                const { say, p } = yield* chat(store)
                yield* say("!remind 1h x")
                assert.match(sent(p.replies.requests()[0]!).content, text)
            }),
        )
    }
})

const claimed = (fields: Partial<ClaimedReminder> = {}, userId?: string): ClaimedReminder => ({
    userId: userId ?? "4001",
    reminderNo: 7,
    text: "take <@&5> out @everyone",
    channelId: "5001",
    ...fields,
})
/** The worker's side of the backend, recording every operation */
function workStore(allowed = true) {
    const operations: ReminderWorkOperation[] = []
    const store: ReminderStore = {
        query: () => Effect.die("Unexpected query"),
        manage: () => Effect.die("Unexpected management"),
        work: (input) =>
            Effect.sync(() => {
                operations.push(input.operation)
                return input.operation.type === "check"
                    ? { type: "check" as const, allowed }
                    : { type: "recorded" as const, recorded: true }
            }),
    }
    return { store, operations }
}
const delivery = (allowed = true) =>
    Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-remind-token" }),
            f = bot.fixtures,
            p = platform(bot),
            s = workStore(allowed)
        const r = claimed({ channelId: f.ids.channel }, p.targetId)
        return { bot, f, p, ...s, r, deliver: () => deliverReminder(s.store, bot.client, f.ids.guild, r) }
    })
const outcomeOf = (operations: ReminderWorkOperation[]) => operations.find((op) => op.type === "outcome")

test("A delivered reminder goes by DM with no ping and is deleted", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            assert.equal(yield* d.deliver(), "delivered")
            const [dm] = d.p.replies.requests().map(sent)
            assert.equal(dm!.path, `/channels/${d.p.dmId}/messages`)
            assert.match(dm!.content, /Reminder from .*: take <@&5> out @everyone/)
            assert.deepEqual(
                (d.p.replies.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions,
                silent,
            )
            assert.equal(d.p.replies.requests().length, 1)
            assert.deepEqual(outcomeOf(d.operations), {
                type: "outcome",
                userId: d.p.targetId,
                reminderNo: 7,
                outcome: "delivered",
            })
        }),
    )
})

test("A member who left is skipped, and a failed member read sends nothing and waits", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            d.bot.rest.respond(`GET /guilds/${d.f.ids.guild}/members/${d.p.targetId}`, {
                status: 404,
                body: { code: "UNKNOWN_MEMBER", message: "Synthetic" },
            })
            assert.equal(yield* d.deliver(), "skipped")
            assert.equal(d.p.replies.requests().length, 0)
        }),
    )
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            d.bot.rest.respond(`GET /guilds/${d.f.ids.guild}/members/${d.p.targetId}`, {
                status: 403,
                body: { code: "MISSING_ACCESS", message: "Synthetic" },
            })
            assert.equal(yield* d.deliver(), "retry")
            assert.equal(d.p.replies.requests().length, 0)
        }),
    )
})

const refuseDm = (d: Effect.Success<ReturnType<typeof delivery>>) =>
    d.bot.rest.respond("POST /users/@me/channels", {
        status: 403,
        body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic refusal" },
    })

test("A DM Fluxer refused becomes one post in the channel, checked first, as a mention that does not notify", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            refuseDm(d)
            assert.equal(yield* d.deliver(), "delivered")
            const check = d.operations.find((op) => op.type === "check")
            assert.deepEqual(check, {
                type: "check",
                userId: d.p.targetId,
                reminderNo: 7,
                roleIds: [d.p.targetRole.id],
            })
            const [post] = d.p.replies.requests()
            assert.equal(post!.path, `/channels/${d.f.ids.channel}/messages`)
            assert.match(
                (post!.body as { content: string }).content,
                new RegExp(`^<@${d.p.targetId}> NeonFlux could not DM you`),
            )
            assert.deepEqual((post!.body as { allowed_mentions: unknown }).allowed_mentions, silent)
        }),
    )
})

test("Text a content rule catches is not posted, and the reminder stays undelivered", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery(false)
            refuseDm(d)
            assert.equal(yield* d.deliver(), "undelivered")
            assert.equal(d.p.replies.requests().length, 0)
        }),
    )
})

test("A channel NeonFlux cannot post in leaves the reminder undelivered without asking the content rules", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-remind-token" }),
                f = bot.fixtures,
                p = platform(bot, { botPermissions: Permissions.ViewChannel }),
                s = workStore()
            bot.rest.respond("POST /users/@me/channels", {
                status: 403,
                body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic refusal" },
            })
            const r = claimed({ channelId: f.ids.channel }, p.targetId)
            assert.equal(yield* deliverReminder(s.store, bot.client, f.ids.guild, r), "undelivered")
            assert.equal(s.operations.filter((op) => op.type === "check").length, 0)
            assert.equal(p.replies.requests().length, 0)
        }),
    )
})

test("An unknown DM outcome stays uncertain and is not followed by a post", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            const dm = d.bot.rest.respond(`POST /channels/${d.p.dmId}/messages`, {
                status: 500,
                body: { message: "Synthetic failure" },
            })
            assert.equal(yield* d.deliver(), "uncertain")
            assert.equal(dm.requests().length, 1)
            assert.equal(d.p.replies.requests().length, 0)
            assert.equal(d.operations.filter((op) => op.type === "check").length, 0)
        }),
    )
})

const rateLimited = {
    status: 429,
    headers: { "retry-after": "6" },
    body: { message: "Synthetic rate limit", retry_after: 6, global: false },
}

test("A rate limit on the DM sends nothing to the channel and tries again later", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            const dm = d.bot.rest.respond(`POST /channels/${d.p.dmId}/messages`, rateLimited)
            assert.equal(yield* d.deliver(), "retry")
            assert.equal(dm.requests().length, 1)
            assert.equal(d.p.replies.requests().length, 0)
            assert.equal(d.operations.filter((op) => op.type === "check").length, 0)
        }),
    )
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            d.bot.rest.respond("POST /users/@me/channels", rateLimited)
            assert.equal(yield* d.deliver(), "retry")
            assert.equal(d.p.replies.requests().length, 0)
        }),
    )
})

test("A connection failure before the DM was sent keeps its text out of the channel and tries again later", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            d.bot.rest.respond("POST /users/@me/channels", () => {
                throw new Error("Synthetic connection failure")
            })
            assert.equal(yield* d.deliver(), "retry")
            assert.equal(d.p.replies.requests().length, 0)
            assert.equal(d.operations.filter((op) => op.type === "check").length, 0)
        }),
    )
})

test("A connection failure while the DM was on its way is uncertain, and is neither repeated nor posted", async () => {
    await controlled(
        Effect.gen(function* () {
            const d = yield* delivery()
            d.bot.rest.respond(`POST /channels/${d.p.dmId}/messages`, () => {
                throw new Error("Synthetic connection failure")
            })
            assert.equal(yield* d.deliver(), "uncertain")
            assert.equal(d.operations.filter((op) => op.type === "check").length, 0)
        }),
    )
})

test("After a refused DM, a post Fluxer refuses is undelivered and a rate limited one tries again", async () => {
    for (const [response, expected] of [
        [{ status: 403, body: { code: "MISSING_PERMISSIONS", message: "Synthetic" } }, "undelivered"],
        [rateLimited, "retry"],
        [{ status: 500, body: { message: "Synthetic" } }, "uncertain"],
    ] as const) {
        await controlled(
            Effect.gen(function* () {
                const d = yield* delivery()
                refuseDm(d)
                const post = d.bot.rest.respond(`POST /channels/${d.f.ids.channel}/messages`, response)
                assert.equal(yield* d.deliver(), expected)
                assert.equal(post.requests().length, 1)
            }),
        )
    }
})

test("A worker pass sends each claimed reminder once, and one that fails leaves the rest", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-remind-token" }),
                f = bot.fixtures,
                p = platform(bot)
            const done = yield* Deferred.make<void>(),
                operations: ReminderWorkOperation[] = []
            let reported = 0
            const page = [
                claimed({ reminderNo: 1, channelId: f.ids.channel }, p.targetId),
                claimed({ reminderNo: 2, channelId: f.ids.channel }, p.targetId),
            ]
            const store: ReminderStore = {
                query: () => Effect.die("Unexpected query"),
                manage: () => Effect.die("Unexpected management"),
                work: (input) =>
                    Effect.gen(function* () {
                        operations.push(input.operation)
                        if (input.operation.type === "claim")
                            return {
                                type: "claimed" as const,
                                reminders: operations.filter((op) => op.type === "claim").length === 1 ? page : [],
                            }
                        if (++reported === 2) yield* Deferred.succeed(done, undefined)
                        return { type: "recorded" as const, recorded: true }
                    }),
            }
            const worker = yield* startReminderWorker(store, f.ids.guild, bot.client)
            yield* worker.notify()
            yield* Deferred.await(done)
            assert.deepEqual(
                operations.map((op) => op.type),
                ["claim", "outcome", "outcome"],
            )
            assert.equal(p.replies.requests().length, 2)
        }),
    )
})
