import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import type { MetadataLogsAdmitRequest, MetadataLogsEvent } from "@neonflux/contracts/metadata-logs"
import {
    MetadataLogsEvent as EventSchema,
    metadataEventLabel,
    metadataLogContent,
} from "@neonflux/contracts/metadata-logs"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, Schema } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { readCosts } from "../src/costs.ts"
import { createMessageRevisions } from "../src/message-revisions.ts"
import { metadataLogHelpAll, parseMetadataLogCommand } from "../src/metadata-log-command.ts"
import { createMetadataGatewayAdmission } from "../src/metadata-log-events.ts"
import { projectMetadataEvent } from "../src/metadata-log-projector.ts"
import { MetadataLogsStoreError, type MetadataLogsStore } from "../src/metadata-log-store.ts"
import { startMetadataLogsWorker } from "../src/metadata-log-worker.ts"
import { createOptionalWork, optionalWorkLimits } from "../src/optional-work.ts"

const f = createFixtures(),
    now = Date.parse("2026-10-04T20:00:00Z"),
    token = Redacted.make("synthetic-webhook-log-token"),
    webhookId = f.nextId(),
    scope = {
        serverId: f.ids.guild,
        sessionId: "a".repeat(32),
        sequence: 1,
        observedAt: now,
        botId: f.ids.bot,
    }
const decode = Schema.decodeUnknownSync(EventSchema, { onExcessProperty: "error" })
const payload = (overrides: Record<string, unknown> = {}) => ({
    guildId: f.ids.guild,
    channelId: f.ids.channel,
    id: f.nextId(),
    content: "Synthetic webhook text",
    attachments: [],
    webhookId,
    author: { id: webhookId, username: "Synthetic *Feed*", isBot: true },
    ...overrides,
})
const lines = (event: MetadataLogsEvent) => metadataLogContent(1, event, f.ids.guild).split("\n")

test("a webhook's edit, deletion and post are records of their own with the webhook's escaped name as the author", () => {
    const edited = decode(
        projectMetadataEvent("messageUpdate", payload({ content: "After" }), scope, { text: "Before" }),
    ) as MetadataLogsEvent
    assert.equal(edited.type, "webhook-message-update")
    assert.equal(edited.category, "messages")
    assert.equal(edited.authorBot, false)
    assert.deepEqual(edited.details, {
        webhookId,
        webhookName: "Synthetic \\*Feed\\*",
        before: "Before",
        text: "After",
    })
    assert.ok(lines(edited).includes(`Author: Synthetic \\*Feed\\* (webhook ${webhookId})`))
    assert.ok(lines(edited).some((line) => line.startsWith("Message: [Jump to message]")))
    assert.equal(metadataEventLabel("webhook-message-update"), "Webhook message edited")

    const deletion = payload()
    const deleted = decode(
        projectMetadataEvent(
            "messageDelete",
            { guildId: f.ids.guild, channelId: f.ids.channel, id: deletion.id },
            scope,
            { webhookId, webhookName: "Synthetic Feed", text: "Kept text" },
        ),
    ) as MetadataLogsEvent
    assert.equal(deleted.type, "webhook-message-delete")
    assert.deepEqual(deleted.source, { kind: "message-delete", messageId: deletion.id })
    assert.deepEqual(deleted.details, { webhookId, webhookName: "Synthetic Feed", text: "Kept text" })

    const posted = decode(projectMetadataEvent("messageCreate", payload(), scope)) as MetadataLogsEvent
    assert.equal(posted.type, "webhook-message-create")
    assert.equal(posted.details?.text, "Synthetic webhook text")
    // These records have no member author, so member data rights find nothing of a webhook's
    for (const event of [edited, deleted, posted]) assert.equal(event.details?.authorId, undefined)
})

test("other bots, system messages and NeonFlux's own posts stay out on every path", () => {
    const bot = { id: f.nextId(), username: "Another bot", isBot: true }
    const own = { id: f.ids.bot, username: "NeonFlux", isBot: true }
    for (const name of ["messageCreate", "messageUpdate"]) {
        assert.equal(projectMetadataEvent(name, payload({ webhookId: undefined, author: bot }), scope), undefined)
        assert.equal(projectMetadataEvent(name, payload({ webhookId: undefined, author: own }), scope), undefined)
        // A post whose author is NeonFlux stays out even with a webhook's ID on it
        assert.equal(projectMetadataEvent(name, payload({ author: own }), scope), undefined)
        assert.equal(
            projectMetadataEvent(
                name,
                payload({ author: { id: webhookId, username: "System", isBot: true, isSystem: true } }),
                scope,
            ),
            undefined,
        )
    }
    // A member's message is never logged as posted
    assert.equal(
        projectMetadataEvent(
            "messageCreate",
            payload({ webhookId: undefined, author: { id: f.ids.user, username: "Member", isBot: false } }),
            scope,
        ),
        undefined,
    )
    const deletion = { guildId: f.ids.guild, channelId: f.ids.channel, id: f.nextId() }
    assert.equal(projectMetadataEvent("messageDelete", deletion, scope, { authorBot: true }), undefined)
    assert.equal(projectMetadataEvent("messageDelete", { ...deletion, authorId: f.ids.bot }, scope), undefined)
    assert.equal(projectMetadataEvent("messageDelete", deletion, scope, { authorId: f.ids.bot }), undefined)
})

test("NeonFlux creates no webhook of its own, so no webhook needs leaving out by its ID", () => {
    const folder = new URL("../src/", import.meta.url)
    for (const file of readdirSync(folder))
        if (file.endsWith(".ts"))
            assert.doesNotMatch(readFileSync(new URL(file, folder), "utf8"), /webhooks\.create\(/, file)
})

test("the memory keeps a webhook message's text under the keeping rule, and another bot's stays out", () => {
    const revisions = createMessageRevisions()
    const message = (id: string, author: object, webhook?: string) =>
        ({
            id,
            guildId: f.ids.guild,
            channelId: f.ids.channel,
            content: "Synthetic text",
            attachments: [],
            editedAt: null,
            pinned: false,
            flags: 0,
            author,
            ...(webhook ? { webhookId: webhook } : {}),
        }) as never
    const hook = { id: webhookId, username: "Synthetic Feed", isBot: true }
    revisions.created(message("10", hook, webhookId))
    // While the server's text is not kept, the deletion is still known to be the webhook's, without text
    assert.deepEqual(
        { ...revisions.deleted("10") },
        {
            editedAt: null,
            pinned: false,
            flags: 0,
            webhookId,
            webhookName: "Synthetic Feed",
            guildId: f.ids.guild,
            revision: "|false|0",
            bytes: 28,
        },
    )
    revisions.keepText(f.ids.guild, true)
    revisions.created(message("11", hook, webhookId))
    const kept = revisions.deleted("11")
    assert.equal(kept?.text, "Synthetic text")
    assert.equal(kept?.authorId, undefined)
    revisions.created(message("12", { id: f.nextId(), username: "Another bot", isBot: true }))
    const other = revisions.deleted("12")
    assert.equal(other?.authorBot, true)
    assert.equal(other?.text, undefined)
})

test("the webhook-posts command parses on and off only", () => {
    assert.deepEqual(parseMetadataLogCommand(["metadata", "webhook-posts", "on"]), {
        type: "manage",
        operation: { type: "webhook-posts", enabled: true },
    })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "webhook-posts", "off"]), {
        type: "manage",
        operation: { type: "webhook-posts", enabled: false },
    })
    assert.ok("error" in parseMetadataLogCommand(["metadata", "webhook-posts"]))
    // Help states the limit on webhook edits and deletions rather than promising they are always logged
    const help = metadataLogHelpAll.find((line) => line.includes("webhook-posts"))!
    assert.match(help, /30 at once, then one a minute/)
    assert.doesNotMatch(help, /always/)
    assert.ok("error" in parseMetadataLogCommand(["metadata", "webhook-posts", "maybe"]))
})

/** A store that answers the start read and records admissions */
function logs(messages: { logged: boolean; webhookPosts: boolean }) {
    const admissions: MetadataLogsAdmitRequest[] = []
    let reads = 0
    const store = {
        admit: (input: MetadataLogsAdmitRequest) =>
            Effect.sync(() => {
                admissions.push(input)
                return { admitted: true, duplicate: false, record: {} } as never
            }),
        work: (input: { operation: { type: string } }) =>
            Effect.sync(() => {
                if (input.operation.type === "messages") {
                    reads++
                    return { type: "messages", ...messages } as const
                }
                return { type: "work", records: [] } as const
            }),
    } as unknown as MetadataLogsStore
    return { store, admissions, reads: () => reads }
}
const run = <A, E>(work: Effect.Effect<A, E, import("effect").Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const startBot = (store: MetadataLogsStore) =>
    Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: store }))
        bot.rest.respond("GET /users/@me", { body: bot.fixtures.botUser() })
        bot.rest.respond("GET /channels/:id", (request) => ({
            body: bot.fixtures.channel({ id: request.path.split("/").at(-1)! }),
        }))
        yield* bot.ready()
        yield* bot.idle()
        return bot
    })
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const webhookMessage = (bot: Bot, overrides: Record<string, unknown> = {}) =>
    bot.fixtures.message({
        id: f.nextId(),
        content: "Synthetic webhook text",
        author: bot.fixtures.user({ id: webhookId, username: "Synthetic Feed", bot: true, system: false }),
        webhook_id: webhookId,
        ...overrides,
    })

test("a webhook's edit and deletion reach metadata logs with its kept text, whether or not Fluxer marks it a bot", () =>
    run(
        Effect.gen(function* () {
            for (const bot of [true, false]) {
                const r = logs({ logged: true, webhookPosts: false }),
                    running = yield* startBot(r.store)
                const message = webhookMessage(running, {
                    author: running.fixtures.user({ id: webhookId, username: "Synthetic Feed", bot, system: false }),
                })
                yield* running.emit("MESSAGE_CREATE", message)
                yield* running.idle()
                assert.equal(r.admissions.length, 0, "a post with its switch off costs no backend call")
                yield* running.emit("MESSAGE_UPDATE", {
                    ...message,
                    content: "Edited webhook text",
                    edited_timestamp: new Date(now + 1000).toISOString(),
                })
                yield* running.idle()
                yield* running.emit("MESSAGE_DELETE", {
                    id: message.id,
                    channel_id: message.channel_id,
                    guild_id: f.ids.guild,
                })
                yield* running.idle()
                assert.deepEqual(
                    r.admissions.map(({ event }) => [event.type, event.details?.before, event.details?.text]),
                    [
                        ["webhook-message-update", "Synthetic webhook text", "Edited webhook text"],
                        ["webhook-message-delete", undefined, "Edited webhook text"],
                    ],
                )
                assert.equal(running.failures().length, 0)
            }
        }),
    ))

test("with message events not logged a webhook's post, edit and deletion cost no backend call and no read", () =>
    run(
        Effect.gen(function* () {
            const r = logs({ logged: false, webhookPosts: true }),
                bot = yield* startBot(r.store),
                before = bot.requests().length,
                reads = r.reads()
            const message = webhookMessage(bot)
            yield* bot.emit("MESSAGE_CREATE", message)
            yield* bot.idle()
            yield* bot.emit("MESSAGE_UPDATE", {
                ...message,
                content: "Edited",
                edited_timestamp: new Date(now + 1000).toISOString(),
            })
            yield* bot.idle()
            yield* bot.emit("MESSAGE_DELETE", {
                id: message.id,
                channel_id: message.channel_id,
                guild_id: f.ids.guild,
            })
            yield* bot.idle()
            assert.equal(r.admissions.length, 0)
            assert.equal(r.reads(), reads)
            assert.deepEqual(bot.requests().slice(before), [])
        }),
    ))

test("with the switch on a webhook's post is recorded, and a member's message or another bot's is not", () =>
    run(
        Effect.gen(function* () {
            const r = logs({ logged: true, webhookPosts: true }),
                bot = yield* startBot(r.store)
            yield* bot.emit("MESSAGE_CREATE", webhookMessage(bot))
            yield* bot.idle()
            yield* bot.emit(
                "MESSAGE_CREATE",
                bot.fixtures.message({
                    id: f.nextId(),
                    author: bot.fixtures.user({ id: f.nextId(), bot: true, system: false }),
                }),
            )
            yield* bot.idle()
            yield* bot.emit(
                "MESSAGE_CREATE",
                bot.fixtures.message({
                    id: f.nextId(),
                    content: "A member's text",
                    author: bot.fixtures.user({ bot: false, system: false }),
                }),
            )
            yield* bot.idle()
            assert.deepEqual(
                r.admissions.map(({ event }) => [event.type, event.details?.webhookId, event.details?.webhookName]),
                [["webhook-message-create", webhookId, "Synthetic Feed"]],
            )
        }),
    ))

test("a server's bucket limits logged posts and counts what it skips, and the bill guard pauses them", () =>
    run(
        Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const r = logs({ logged: true, webhookPosts: true })
            let paused = false
            const optional = createOptionalWork(() => paused),
                admit = createMetadataGatewayAdmission(r.store, f.ids.guild, () => Effect.void, {
                    posts: optional("webhook-posts"),
                    edits: optional("webhook-edits"),
                }),
                { client } = yield* startBot(logs({ logged: false, webhookPosts: false }).store)
            yield* admit.start(client)
            const post = () =>
                admit.webhookPost(
                    {
                        id: f.nextId(),
                        guildId: f.ids.guild,
                        channelId: f.ids.channel,
                        content: "Synthetic",
                        attachments: [],
                        webhookId,
                        author: { id: webhookId, username: "Synthetic Feed", isBot: true },
                    } as never,
                    client,
                )
            const { burst, perMinute } = optionalWorkLimits["webhook-posts"],
                skipped = readCosts().optionalSkipped
            for (let index = 0; index < burst + 5; index++) yield* post()
            assert.equal(r.admissions.length, burst)
            assert.equal(readCosts().optionalSkipped - skipped, 5)
            yield* TestClock.adjust(60000 / perMinute)
            yield* post()
            assert.equal(r.admissions.length, burst + 1)
            // The guard pauses it without counting a skip
            yield* TestClock.adjust("1 hour")
            paused = true
            const during = readCosts().optionalSkipped
            yield* post()
            assert.equal(r.admissions.length, burst + 1)
            assert.equal(readCosts().optionalSkipped, during)
        }),
    ))

test("a status webhook's edits spend their own bucket, also with its deletions, and the bill guard pauses them", () =>
    run(
        Effect.gen(function* () {
            const r = logs({ logged: true, webhookPosts: false }),
                bot = yield* startBot(r.store)
            const { burst, perMinute } = optionalWorkLimits["webhook-edits"],
                message = webhookMessage(bot),
                skipped = readCosts().optionalSkipped
            yield* bot.emit("MESSAGE_CREATE", message)
            yield* bot.idle()
            let edit = 0
            const edited = () =>
                bot
                    .emit("MESSAGE_UPDATE", {
                        ...message,
                        content: `Status ${++edit}`,
                        edited_timestamp: new Date(now + edit * 1000).toISOString(),
                    })
                    .pipe(Effect.andThen(bot.idle()))
            for (let index = 0; index < burst + 2; index++) yield* edited()
            assert.equal(r.admissions.length, burst, "the bucket holds this many at once")
            assert.equal(readCosts().optionalSkipped - skipped, 2)
            // A minute refills one, and a skipped edit still updated the kept text, so the logged edit shows it as the earlier text
            yield* TestClock.adjust(60000 / perMinute)
            yield* edited()
            assert.equal(r.admissions.length, burst + 1)
            assert.equal(r.admissions.at(-1)!.event.details?.before, `Status ${edit - 1}`)
            // A deletion takes the same bucket
            yield* bot.emit("MESSAGE_DELETE", {
                id: message.id,
                channel_id: message.channel_id,
                guild_id: f.ids.guild,
            })
            yield* bot.idle()
            assert.equal(r.admissions.length, burst + 1)
        }),
    ))

test("the bill guard pauses webhook edits and deletions, which the admission asks for each", () =>
    run(
        Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const r = logs({ logged: true, webhookPosts: true })
            let paused = true
            const optional = createOptionalWork(() => paused),
                admit = createMetadataGatewayAdmission(r.store, f.ids.guild, () => Effect.void, {
                    posts: optional("webhook-posts"),
                    edits: optional("webhook-edits"),
                }),
                { client } = yield* startBot(logs({ logged: false, webhookPosts: false }).store)
            yield* admit.start(client)
            const message = payload()
            yield* admit("messageUpdate", message, client, { text: "Before" })
            yield* admit("messageDelete", { guildId: f.ids.guild, channelId: f.ids.channel, id: message.id }, client, {
                webhookId,
                text: "Kept",
            })
            assert.equal(r.admissions.length, 0)
            paused = false
            yield* admit("messageUpdate", message, client, { text: "Before" })
            assert.equal(r.admissions.length, 1)
        }),
    ))

test("a channel answered excluded costs no token and no backend call until the next logs change", () =>
    run(
        Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const r = logs({ logged: true, webhookPosts: true }),
                admissions: string[] = []
            r.store.admit = (input) =>
                Effect.sync(() => {
                    admissions.push(input.event.channelId!)
                    return { admitted: false, duplicate: false, reason: "excluded" } as const
                })
            let tokens = 0
            const spend = Effect.sync(() => {
                    tokens++
                    return true
                }),
                admit = createMetadataGatewayAdmission(r.store, f.ids.guild, () => Effect.void, {
                    posts: spend,
                    edits: spend,
                }),
                { client } = yield* startBot(logs({ logged: false, webhookPosts: false }).store)
            yield* admit.start(client)
            const post = (channelId: string) =>
                admit.webhookPost(
                    {
                        id: f.nextId(),
                        guildId: f.ids.guild,
                        channelId,
                        content: "Synthetic",
                        attachments: [],
                        webhookId,
                        author: { id: webhookId, username: "Synthetic Feed", isBot: true },
                    } as never,
                    client,
                )
            const excluded = f.nextId(),
                other = f.nextId()
            yield* post(excluded)
            yield* post(excluded)
            assert.deepEqual([admissions, tokens], [[excluded], 1])
            yield* post(other)
            assert.deepEqual([admissions, tokens], [[excluded, other], 2])
            // Another kind of event in that channel has its own answer, since its route may differ
            yield* admit("messageUpdate", { ...payload(), channelId: excluded }, client, { text: "Before" })
            assert.equal(tokens, 3)
            yield* admit.recheck()
            yield* post(excluded)
            assert.equal(tokens, 4)
        }),
    ))

test("after the backend refuses a log cursor the worker starts a new walk and posts again", () =>
    run(
        Effect.gen(function* () {
            const asked: (string | undefined)[] = []
            let answer = 0
            const store = {
                admit: () => Effect.succeed({ admitted: false, duplicate: false, reason: "disabled" } as const),
                work: (input: { operation: { cursor?: string } }) =>
                    Effect.suspend(() => {
                        asked.push(input.operation.cursor)
                        answer++
                        // The first page hands out a cursor, the next call refuses it as Convex does, and a fresh walk works
                        return answer === 2
                            ? Effect.fail(new MetadataLogsStoreError({ operation: "work", status: 500 }))
                            : Effect.succeed({
                                  type: "work",
                                  records: [],
                                  ...(answer === 1 ? { nextCursor: "stale" } : {}),
                              } as const)
                    }),
            } as unknown as MetadataLogsStore
            const { client } = yield* startBot(logs({ logged: false, webhookPosts: false }).store)
            const worker = yield* startMetadataLogsWorker(store, f.ids.guild, client)
            for (let pass = 0; pass < 3; pass++) {
                yield* worker.notify()
                for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow
            }
            assert.deepEqual(asked, [undefined, "stale", undefined])
        }),
    ))

const audit = (bot: Bot, id: string, action: number, target: string, changes: object[] = []) =>
    bot
        .emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
            id,
            guild_id: f.ids.guild,
            action_type: action,
            user_id: f.ids.user,
            target_id: target,
            changes,
        })
        .pipe(Effect.andThen(bot.idle()))
test("an audit entry shows its webhook's name, from the entry, then the memory, then one read, and a failed read shows the ID", () =>
    run(
        Effect.gen(function* () {
            const r = logs({ logged: true, webhookPosts: false }),
                bot = yield* startBot(r.store)
            const named = f.nextId(),
                read = f.nextId(),
                failed = f.nextId()
            const reads = bot.rest.respond(`GET /webhooks/${read}`, {
                body: {
                    id: read,
                    guild_id: f.ids.guild,
                    channel_id: f.ids.channel,
                    type: 1,
                    name: "Read *name*",
                    avatar: null,
                },
            })
            const failing = bot.rest.respond(`GET /webhooks/${failed}`, { status: 403 })
            yield* audit(bot, f.nextId(), 50, named, [{ key: "name", new_value: "Entry name" }])
            yield* audit(bot, f.nextId(), 51, named)
            yield* audit(bot, f.nextId(), 51, read)
            yield* audit(bot, f.nextId(), 51, read)
            yield* audit(bot, f.nextId(), 51, failed)
            yield* audit(bot, f.nextId(), 52, named)
            yield* audit(bot, f.nextId(), 52, f.nextId(), [{ key: "name", old_value: "Old name" }])
            assert.deepEqual(
                r.admissions.map(({ event }) => event.details?.webhookName),
                ["Entry name", "Entry name", "Read \\*name\\*", "Read \\*name\\*", undefined, "Entry name", "Old name"],
            )
            assert.equal(reads.requests().length, 1)
            assert.equal(failing.requests().length, 1)
            const shown = r.admissions.map(({ event }) =>
                metadataLogContent(1, event as never, f.ids.guild)
                    .split("\n")
                    .find((line) => line.startsWith("Webhook:")),
            )
            assert.equal(shown[0], `Webhook: Entry name (${named})`)
            assert.equal(shown[4], `Webhook: ${failed}`)
        }),
    ))
