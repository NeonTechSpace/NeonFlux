import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { MessageType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { performActionGrant } from "../src/moderation.ts"
import { ModerationStoreError } from "../src/moderation-store.ts"
import { boundary, caseGrant, platform, token } from "./moderation-fixture.ts"

const safeMentions = { parse: [], users: [], roles: [], replied_user: false }
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, overrides = {}) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...overrides })).pipe(Effect.andThen(bot.idle()))
const bodies = (p: ReturnType<typeof platform>) => p.replies.requests().map((request) => request.body as { content: string, allowed_mentions: unknown })

test("disabled protections use the mandatory backend gate without platform permission reads and preserve ping before AFK", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { afk: {
            set: (userId, reason) => Effect.succeed({ userId, reason, since: 1 }),
            observe: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ cleared: true, statuses: [] })),
        }, moderation: b.store }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
        yield* Deferred.await(entered)
        assert.equal(replies.requests().length, 1)
        assert.equal((replies.requests()[0]!.body as { content: string }).content, "Pong!")
        assert.equal(b.calls.filter((call) => call.method === "gate").length, 1)
        assert.equal(b.calls.some((call) => call.method === "evaluate"), false)
        yield* Deferred.succeed(release, undefined)
        yield* bot.idle()
        assert.equal(replies.requests().length, 2)
        assert.equal(bot.failures().length, 0)
    })))
})

test("DEFCON blocks public commands and ordinary private appeals at level 1 while preserving silent AFK return clearing", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.defcon = 2
    let cleared = 0
    let sets = 0
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { afk: {
            set: (userId, reason) => Effect.sync(() => { sets++; return { userId, reason, since: 1 } }),
            observe: () => Effect.sync(() => { cleared++; return { cleared: true, statuses: [] } }),
        }, moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        for (const command of ["!ping", "!afk Away", "!unknown", "ordinary return"]) yield* emit(bot, command)
        assert.equal(sets, 0)
        assert.equal(cleared, 3)
        assert.equal(p.replies.requests().length, 0)
        b.current.defcon = 1
        yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: p.dmId })
        assert.equal(b.calls.some((call) => call.method === "memberAppeal"), false)
        yield* emit(bot, "!mod warn <@123456789012345679> reason")
        assert.equal(b.calls.some((call) => call.method === "manage"), false)
        yield* emit(bot, "!defcon status")
        assert.equal(b.calls.some((call) => call.method === "query"), true)
        assert.equal(bot.failures().length, 0)
    })))
})

test("DEFCON 2 allows security role lock with ManageRoles alone and the executor preserves unrelated overwrite bits", async () => {
    const f = createFixtures()
    let request: C.ModerationManageRequest | undefined
    const b = boundary({ manage: (input) => { request = input; return Effect.succeed(caseGrant(input, {
        overwrite: { exists: true, allow: "0", deny: Permissions.SendMessages.toString() },
        expectedOverwrite: { exists: false, allow: "0", deny: "0" },
    })) } })
    b.current.defcon = 2
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageRoles })
        b.current.staffRoleIds.security = [p.actorRole.id]
        const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
        yield* bot.ready()
        yield* emit(bot, `!security lock <#${f.ids.channel}> "pause chat"`)
        assert.equal(request?.actor.isOwner, false)
        assert.equal(request?.actor.isAdministrator, false)
        assert.equal(request?.actor.nativePermissionAuthorized, true)
        assert.equal(writes.requests().length, 1)
        assert.equal((writes.requests()[0]!.body as { deny: string }).deny, Permissions.SendMessages.toString())
        assert.match(bodies(p).at(-1)!.content, /succeeded/)
        assert.equal(bot.failures().length, 0)
    })))
})

test("a warning remains successful when the log acknowledgement is lost and its independently reserved private notice still sends", async () => {
    const f = createFixtures()
    const outcomes: C.ModerationOutcomeRequest[] = []
    const notices: C.ModerationNoticeOutcomeRequest[] = []
    let targetId = ""
    const b = boundary({
        manage: (input) => Effect.succeed(caseGrant(input)),
        outcome: (input) => { outcomes.push(input); return Effect.succeed({ recorded: true,
            log: { logId: input.actionId, caseNo: input.caseNo, channelId: f.ids.channel, action: "warn", outcome: "succeeded", targetId, reason: "private reason" },
            notice: { noticeId: input.actionId, caseNo: input.caseNo, targetId, reason: "private reason" },
        }) },
        logOutcome: () => Effect.fail(new ModerationStoreError({ operation: "log-outcome", status: null })),
        noticeOutcome: (input) => { notices.push(input); return Effect.succeed({ recorded: true }) },
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        targetId = p.targetId
        yield* bot.ready()
        yield* emit(bot, `!mod warn <@${targetId}> "private reason"`)
        assert.equal(outcomes[0]?.outcome, "succeeded")
        assert.equal(notices[0]?.outcome, "sent")
        assert.equal(p.open.requests().length, 1)
        const content = bodies(p).map((body) => body.content)
        assert.match(content[0]!, new RegExp(`actor ${f.ids.user}`))
        assert.ok(!content[0]!.includes("private reason"))
        assert.match(content[1]!, /Warning, case 1: private reason/)
        assert.match(content[2]!, /warn, succeeded.*acknowledgement is uncertain/)
        for (const body of bodies(p)) assert.deepEqual(body.allowed_mentions, safeMentions)
        assert.equal(bot.failures().length, 0)
    })))
})

test("private warning delivery rejection records a failed notice without changing the durable warning outcome", async () => {
    const f = createFixtures()
    let targetId = ""
    let actionOutcome = ""
    let noticeOutcome = ""
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)),
        outcome: (input) => { actionOutcome = input.outcome; return Effect.succeed({ recorded: true, notice: { noticeId: input.actionId, caseNo: input.caseNo, targetId, reason: "reason" } }) },
        noticeOutcome: (input) => { noticeOutcome = input.outcome; return Effect.succeed({ recorded: true }) },
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        targetId = p.targetId
        bot.rest.respond(`POST /channels/${p.dmId}/messages`, { status: 403, body: { code: "MISSING_ACCESS", message: "synthetic private body" } })
        yield* bot.ready()
        yield* emit(bot, `!mod warn ${targetId} reason`)
        assert.equal(actionOutcome, "succeeded")
        assert.equal(noticeOutcome, "failed")
        assert.match(bodies(p).at(-1)!.content, /warn, succeeded/)
    })))
})

test("temporary ban uses the native duration and ASCII audit metadata while preserving a Unicode reason and provider expiry", async () => {
    const f = createFixtures()
    const outcomes: C.ModerationOutcomeRequest[] = []
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)), outcome: (input) => { outcomes.push(input); return Effect.succeed({ recorded: true }) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        const bans = bot.rest.respond("PUT /guilds/:id/bans/:id", { status: 204 })
        const expires = "2026-10-05T00:00:00.000Z"
        bot.rest.respond("GET /guilds/:id/bans", { body: [{ user: bot.fixtures.user({ id: p.targetId }), moderator_id: f.ids.user, banned_at: "2026-10-04T00:00:00.000Z", reason: "É", expires_at: expires }] })
        yield* bot.ready()
        yield* emit(bot, `!mod ban ${p.targetId} 1d "${"É".repeat(512)}"`)
        assert.equal(bans.requests().length, 1)
        const request = bans.requests()[0]!
        assert.equal((request.body as { ban_duration_seconds?: number }).ban_duration_seconds, 86400)
        assert.equal((request.body as { reason: string }).reason.length, 512)
        assert.ok(/^[\x20-\x7e]+$/.test(decodeURIComponent(String(request.headers["x-audit-log-reason"]))))
        assert.equal(outcomes[0]?.outcome, "succeeded")
        assert.equal(outcomes[0]?.banExpiresAt, expires)
    })))
})

test("fresh permission downgrade, channel overwrite denial and protected targets prevent native sanctions", async () => {
    for (const scenario of ["downgrade", "protected", "channel"] as const) {
        const f = createFixtures()
        const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot, { actorOwner: false, actorPermissions: scenario === "downgrade" ? 0n : Permissions.ManageChannels | Permissions.KickMembers,
                botPermissions: Permissions.ManageChannels | Permissions.KickMembers, ...(scenario === "protected" ? { targetPermissions: Permissions.Administrator } : {}),
                ...(scenario === "channel" ? { channelDeny: Permissions.ManageChannels } : {}),
            })
            const kick = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
            const edit = bot.rest.respond("PATCH /channels/:id", { body: bot.fixtures.channel() })
            yield* bot.ready()
            yield* emit(bot, scenario === "channel" ? `!mod slowmode ${f.ids.channel} 10 reason` : `!mod kick ${p.targetId} reason`)
            assert.equal(kick.requests().length, 0)
            assert.equal(edit.requests().length, 0)
            const outcome = b.calls.find((call) => call.method === "outcome")?.input as C.ModerationOutcomeRequest
            assert.equal(outcome?.outcome, "failed")
        })))
    }
})

test("release links its owned recovery and preserves a changed or still stronger timeout", async () => {
    for (const state of ["changed", "prior-future", "clear"] as const) {
        const f = createFixtures()
        const expected = "2099-01-01T00:00:00.000Z"
        let managed: C.ModerationManageRequest | undefined
        const b = boundary({ query: () => Effect.succeed({ type: "recovery", recovery: { recoveryId: "owned_recovery", generation: 3, type: "timeout", caseNo: 7, status: "active", targetId: f.ids.user, createdAt: 1, expectedTimeoutUntil: expected } }),
            manage: (input) => { managed = input; return Effect.succeed(caseGrant(input, { expectedTimeoutUntil: expected, restoreTimeoutUntil: state === "prior-future" ? expected : null, recoveryId: "owned_recovery" })) },
        })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot)
            bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), roles: [p.targetRole.id], communication_disabled_until: state === "changed" ? "2099-02-01T00:00:00.000Z" : expected }) })
            const writes = bot.rest.respond("PATCH /guilds/:id/members/:id", { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), communication_disabled_until: null }) })
            yield* bot.ready()
            yield* emit(bot, `!security release ${p.targetId} reason`)
            assert.equal(managed?.operation.type, "action")
            if (managed?.operation.type === "action") {
                assert.equal(managed.operation.action.linkedCaseNo, 7)
                assert.equal(managed.operation.context.recoveryGeneration, 3)
            }
            assert.equal(writes.requests().length, state === "clear" ? 1 : 0)
            const outcome = b.calls.find((call) => call.method === "outcome")?.input as C.ModerationOutcomeRequest
            assert.equal(outcome.outcome, state === "clear" ? "succeeded" : "failed")
        })))
    }
})

test("quarantine refuses a stronger existing timeout and untimeout checks its expected snapshot", async () => {
    const f = createFixtures()
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input, { expectedTimeoutUntil: input.operation.type === "action" && input.operation.action.type === "quarantine" ? "2099-01-01T00:00:00.000Z" : null })) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), roles: [p.targetRole.id], communication_disabled_until: "2099-01-01T00:00:00.000Z" }) })
        const writes = bot.rest.respond("PATCH /guilds/:id/members/:id", { body: bot.fixtures.member() })
        yield* bot.ready()
        yield* emit(bot, `!security quarantine ${p.targetId} 10m reason`)
        yield* emit(bot, `!mod untimeout ${p.targetId} reason`)
        assert.equal(writes.requests().length, 0)
        assert.deepEqual(b.calls.filter((call) => call.method === "outcome").map((call) => (call.input as C.ModerationOutcomeRequest).outcome), ["failed", "failed"])
    })))
})

test("case lists stay compact, details include actor audits, and private narratives never reach the invoking guild channel", async () => {
    const f = createFixtures()
    const record: C.ModerationCase = { ...caseGrant({ serverId: f.ids.guild, messageId: f.nextId(), createdAt: 1, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, operation: { type: "action", action: { type: "warn", targetId: f.ids.user, reason: "private narrative" }, context: { botId: f.ids.bot, botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false } } }).case,
        corrections: Array.from({ length: 20 }, () => ({ type: "reason", actorId: f.ids.user, createdAt: 1, previousReason: "x".repeat(512), reason: "y".repeat(512) })),
    }
    const b = boundary({ query: (input) => Effect.succeed(input.operation.type === "case-list" ? { type: "cases", cases: Array.from({ length: 10 }, (_, i) => ({ ...record, caseNo: 20 - i })), nextBeforeCaseNo: 11 } : { type: "case", case: record }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        yield* emit(bot, `!case list user ${f.ids.user}`)
        assert.equal(p.replies.requests().length, 2)
        assert.match(bodies(p)[0]!.content, new RegExp(`Next: !case list user ${f.ids.user} 11`))
        assert.ok(!bodies(p)[0]!.content.includes("private narrative"))
        yield* emit(bot, "!case show 1")
        const privateBodies = p.replies.requests().filter((request) => request.path.includes(p.dmId)).map((request) => (request.body as { content: string }).content)
        assert.ok(privateBodies.some((content) => content.includes(`Actor: ${f.ids.user}`)))
        assert.ok(privateBodies.some((content) => content.includes(`actor ${f.ids.user}`)))
        for (const request of p.replies.requests()) {
            const body = request.body as { content: string }
            assert.ok(body.content.length <= 1900)
            if (request.path.includes(f.ids.channel)) assert.equal(body.content.includes("private narrative"), false)
        }
        assert.equal(bot.failures().length, 0)
    })))
})

test("banned users can discover and appeal their own cases in a verified DM without membership reads, while groups are rejected", async () => {
    const f = createFixtures()
    const memberCalls: C.AppealMemberRequest[] = []
    const b = boundary({ memberAppeal: (input) => { memberCalls.push(input); return Effect.succeed(input.operation.type === "cases" ? { duplicate: false, type: "cases", cases: [{ caseNo: 2, action: "ban", outcome: "succeeded", createdAt: 1, reason: "Own ban" }] } : { duplicate: false, type: "appeal", appeal: { appealNo: 1, caseNo: 2, userId: input.requesterId, text: "Please review", createdAt: 1, status: "open", erased: false } }) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const dmId = bot.fixtures.nextId()
        const dm = { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null }
        bot.rest.respond(`GET /channels/${dmId}`, { body: dm })
        const replies = bot.rest.respond("POST /channels/:id/messages", (request) => ({ body: bot.fixtures.message({ channel_id: request.path.split("/")[2] }) }))
        yield* bot.ready()
        yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
        yield* emit(bot, '!appeal submit 2 "Please review"', { guild_id: undefined, channel_id: dmId })
        assert.equal(memberCalls.length, 2)
        assert.ok(memberCalls.every((input) => input.requesterId === f.ids.user && input.privateChannelVerified))
        const group = bot.rest.respond(`GET /channels/${dmId}`, { body: { ...dm, type: 3, owner_id: f.ids.user, recipients: [bot.fixtures.user(), bot.fixtures.user({ id: bot.fixtures.nextId() })] } })
        yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
        assert.equal(memberCalls.length, 2)
        assert.equal(replies.requests().length, 2)
        assert.equal(group.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("enabled protection supplies fresh native context for creates and edits and a blocked duplicate cannot reply publicly", async () => {
    const f = createFixtures()
    const evaluations: C.ModerationEvaluateRequest[] = []
    const b = boundary({ evaluate: (input) => { evaluations.push(input); return Effect.succeed({ duplicate: evaluations.length > 1, blocked: true }) } })
    b.current.automodEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        const message = bot.fixtures.message({ content: "!ping", mention_roles: [p.actorRole.id], mention_everyone: true })
        yield* bot.emit("MESSAGE_CREATE", message)
        yield* bot.idle()
        yield* bot.emit("MESSAGE_UPDATE", { ...message, content: "edited", edited_timestamp: "2026-10-04T01:00:00.000Z" })
        yield* bot.idle()
        assert.deepEqual(evaluations.map((input) => input.event), ["create", "edit"])
        assert.equal(evaluations[0]?.createdAt, Date.parse(message.timestamp!))
        assert.equal(evaluations[1]?.messageId, message.id)
        assert.equal(evaluations[1]?.editedAt, Date.parse("2026-10-04T01:00:00.000Z"))
        assert.equal(evaluations[0]?.mentionedEveryone, true)
        assert.deepEqual(evaluations[0]?.mentionedRoleIds, [p.actorRole.id])
        assert.match(evaluations[0]!.contentHash, /^[a-f0-9]{64}$/)
        assert.ok(evaluations[0]!.roleIds.includes(f.ids.guild))
        assert.ok(evaluations[0]!.context.botAuthorizedActions?.includes("timeout"))
        assert.equal(p.replies.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("unknown native action transport records uncertain once, and a duplicate source cannot replay the action", async () => {
    const f = createFixtures()
    const seen = new Set<string>()
    const b = boundary({ manage: (input) => {
        if (seen.has(input.messageId)) return Effect.succeed({ duplicate: true })
        seen.add(input.messageId)
        return Effect.succeed(caseGrant(input))
    } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        const writes = bot.rest.respond("DELETE /guilds/:id/members/:id", () => { throw new TypeError("synthetic transport loss") })
        yield* bot.ready()
        const message = bot.fixtures.message({ content: `!mod kick ${p.targetId} reason` })
        yield* bot.emit("MESSAGE_CREATE", message)
        yield* bot.idle()
        yield* bot.emit("MESSAGE_CREATE", message)
        yield* bot.idle()
        assert.equal(writes.requests().length, 1)
        assert.equal((b.calls.find((call) => call.method === "outcome")!.input as C.ModerationOutcomeRequest).outcome, "uncertain")
        assert.equal(p.replies.requests().length, 1)
        assert.match(bodies(p)[0]!.content, /uncertain/)
    })))
})

test("serialized management precedes a queued protective evaluation using barriers instead of elapsed time", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const order: string[] = []
        const b = boundary({ manage: () => Effect.gen(function* () {
            order.push("manage-start")
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            b.current.automodEnabled = true
            order.push("manage-end")
            return { duplicate: false, type: "settings", settings: b.current }
        }), evaluate: () => Effect.sync(() => { order.push("evaluate"); return { duplicate: false, blocked: false } }) })
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        platform(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!automod module on" }))
        yield* Deferred.await(entered)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "ordinary" }))
        assert.deepEqual(order, ["manage-start"])
        yield* Deferred.succeed(release, undefined)
        yield* bot.idle()
        assert.deepEqual(order, ["manage-start", "manage-end", "evaluate"])
    })))
})

test("shutdown interruption leaves a reserved native action unresolved without a false acknowledgement or replay", async () => {
    const f = createFixtures()
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        const writes = bot.rest.respond("DELETE /guilds/:id/members/:id", async () => {
            await Effect.runPromise(Deferred.succeed(entered, undefined))
            await Effect.runPromise(Deferred.await(release))
            return { status: 204 }
        })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!mod kick ${p.targetId} reason` }))
        yield* Deferred.await(entered)
        yield* bot.client.shutdown({ drainMs: 0 })
        yield* Deferred.succeed(release, undefined)
        assert.equal(writes.requests().length, 1)
        assert.equal(b.calls.some((call) => call.method === "outcome"), false)
        assert.equal(p.replies.requests().length, 0)
        assert.equal(bot.client.state, "Closed")
    })))
})

test("bots, webhooks, system messages and unrelated servers never enter moderation", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        yield* bot.ready()
        const baseline = b.calls.length
        for (const overrides of [{ author: bot.fixtures.botUser() }, { webhook_id: bot.fixtures.nextId() }, { type: MessageType.ChannelPinnedMessage }, { guild_id: bot.fixtures.nextId() }]) yield* emit(bot, "!mod status", overrides)
        assert.equal(b.calls.length, baseline)
        assert.equal(bot.failures().length, 0)
    })))
})

test("native quoted management exposes complete settings, rules, watchlist, security and appeal configuration flows", async () => {
    const f = createFixtures()
    const managed: C.ModerationManageRequest[] = []
    const b = boundary({ manage: (input) => {
        managed.push(input)
        if (input.operation.type === "settings") { Object.assign(b.current, input.operation.patch); return Effect.succeed({ duplicate: false, type: "settings", settings: b.current }) }
        if (input.operation.type === "rule-create") return Effect.succeed({ duplicate: false, type: "rule", rule: input.operation.rule })
        return Effect.succeed({ duplicate: true })
    } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        const commands = [
            "!mod module off", "!mod module on", `!mod staff security <@&${p.actorRole.id}>`,
            `!logs channel <#${f.ids.channel}>`, "!logs channel off", '!automod create badwords words warn "literal phrase"',
            '!automod update badwords patterns "different phrase"', "!automod update badwords threshold 2", "!automod update badwords window 30",
            "!automod update badwords duration 10m", "!automod update badwords priority -5", "!automod update badwords action timeout", "!automod update badwords domain-mode allow",
            `!automod update badwords channels <#${f.ids.channel}>`, `!automod update badwords exempt-channels <#${f.ids.channel}>`, `!automod update badwords exempt-roles <@&${p.actorRole.id}>`,
            "!automod disable badwords", "!automod enable badwords", "!automod delete badwords", "!automod mode enforce", "!automod module off",
            `!security watchlist add ${p.targetId} "private watch note"`, `!security watchlist update ${p.targetId} "replacement note"`, `!security watchlist remove ${p.targetId}`,
            `!security honeypot add <#${f.ids.channel}>`, `!security honeypot remove <#${f.ids.channel}>`, "!security honeypot module on", "!security honeypot module off",
            "!security joins threshold 5", "!security joins window 30", "!security joins raid-mode defcon2", "!security joins module on", "!security joins module off",
            "!security watchlist module on", "!security watchlist module off", "!security mode enforce", "!security module off", "!appeals module off", "!appeals module on",
            "!defcon set 2", "!defcon set 1", "!defcon set 3", "!mod erase 1", "!case reason 1 \"fixed reason\"", "!case void 1",
        ]
        for (const command of commands) yield* emit(bot, command)
        assert.equal(managed.length, commands.length)
        assert.ok(managed.every((input) => input.actor.isOwner && input.createdAt > 0))
        assert.ok(managed.some((input) => input.operation.type === "rule-create" && input.operation.rule.patterns[0] === "literal phrase"))
        const count = managed.length
        for (const malformed of ["!mod module sometimes", "!mod erase @someone", "!security watchlist list invalid", "!automod update badwords threshold 0", "!mod ban 123456789012345679 1s reason", '!mod warn 123456789012345679 "unclosed']) yield* emit(bot, malformed)
        assert.equal(managed.length, count)
        assert.ok(bodies(p).slice(-6, -1).every((body) => /Check quoting/.test(body.content)))
        assert.equal(bodies(p).at(-1)?.content, "A double quote was opened but never closed. Use !mod help for examples")
        assert.equal(bot.failures().length, 0)
    })))
})

test("ordinary uncertain case recovery observes current state without resending the sanction", async () => {
    const f = createFixtures()
    const queried: C.ModerationQueryRequest[] = []
    const observations: C.ModerationReconcileRequest[] = []
    let record: C.ModerationCase
    const b = boundary({ query: (input) => { queried.push(input); return Effect.succeed({ type: "case", case: record }) },
        reconcile: (input) => { observations.push(input); return Effect.succeed({ recorded: true, case: { ...record, observation: input.observation } }) },
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        record = caseGrant({ serverId: f.ids.guild, messageId: bot.fixtures.nextId(), createdAt: 1, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: true, nativePermissionAuthorized: true }, operation: { type: "action", action: { type: "kick", targetId: p.targetId, reason: "original" }, context: { botId: f.ids.bot, botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false } } }).case
        record.outcome = "uncertain"
        const writes = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
        yield* bot.ready()
        yield* emit(bot, "!case recover 1")
        yield* emit(bot, "!security recover 1")
        assert.deepEqual(queried.map((input) => input.operation.type), ["case-show", "recovery-case"])
        assert.ok(observations.every((input) => input.privateChannelVerified && input.observation.memberPresent === true))
        assert.equal(writes.requests().length, 0)
        assert.equal(b.calls.some((call) => call.method === "manage" || call.method === "outcome"), false)
        assert.equal(bot.failures().length, 0)
    })))
})

test("observed human joins reach enabled security with fresh identity while bot joins and disabled joins are excluded", async () => {
    const f = createFixtures()
    const joins: C.ModerationJoinRequest[] = []
    const b = boundary({ join: (input) => { joins.push(input); return Effect.succeed({ duplicate: false, settings: b.current }) } })
    b.current.securityEnabled = true
    b.current.joinEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId }) })
        yield* bot.ready()
        const member = bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), roles: [p.targetRole.id] })
        yield* bot.emit("GUILD_MEMBER_ADD", { ...member, guild_id: f.ids.guild })
        yield* bot.idle()
        assert.equal(joins.length, 1)
        assert.equal(joins[0]?.userId, p.targetId)
        assert.equal(joins[0]?.joinedAt, Date.parse(member.joined_at))
        assert.ok(joins[0]?.context.botAuthorizedActions?.includes("quarantine"))
        bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.botUser({ id: p.targetId }) })
        yield* bot.emit("GUILD_MEMBER_ADD", { ...member, guild_id: f.ids.guild })
        yield* bot.idle()
        b.current.joinEnabled = false
        yield* bot.emit("GUILD_MEMBER_ADD", { ...member, guild_id: f.ids.guild })
        yield* bot.idle()
        assert.equal(joins.length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("recovery writes re-read the target and channel after the reservation instead of reusing the command snapshot", async () => {
    for (const action of ["release", "unlock"] as const) {
        const f = createFixtures()
        const expected = "2099-01-01T00:00:00.000Z"
        const b = boundary({ query: () => Effect.succeed({ type: "recovery", recovery: action === "release"
                ? { recoveryId: "owned_recovery", generation: 3, type: "timeout", caseNo: 7, status: "active", targetId: f.ids.user, createdAt: 1, expectedTimeoutUntil: expected }
                : { recoveryId: "owned_lock", generation: 2, type: "lock", caseNo: 4, status: "active", channelId: f.ids.channel, createdAt: 1 } }),
            manage: (input) => Effect.succeed(caseGrant(input, action === "release" ? { expectedTimeoutUntil: expected, restoreTimeoutUntil: null, recoveryId: "owned_recovery" }
                : { recoveryId: "owned_lock", expectedOverwrite: { exists: true, allow: "0", deny: Permissions.SendMessages.toString() }, overwrite: { exists: false, allow: "0", deny: "0" } })),
        })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot)
            // Staff replace the timeout or add an unrelated overwrite bit after the command's authority read
            let memberReads = 0
            bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({ body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), roles: [p.targetRole.id],
                communication_disabled_until: ++memberReads === 1 ? expected : "2099-02-01T00:00:00.000Z" }) }))
            let channelReads = 0
            bot.rest.respond(`GET /channels/${f.ids.channel}`, () => ({ body: bot.fixtures.channel({ permission_overwrites: [{ id: f.ids.guild, type: 0,
                allow: ++channelReads === 1 ? "0" : Permissions.ViewChannel.toString(), deny: Permissions.SendMessages.toString() }] }) }))
            const clears = bot.rest.respond("PATCH /guilds/:id/members/:id", { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), communication_disabled_until: null }) })
            const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            const removes = bot.rest.respond("DELETE /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* emit(bot, action === "release" ? `!security release ${p.targetId} reason` : `!security unlock ${f.ids.channel} "restore chat"`)
            assert.equal(clears.requests().length, 0)
            assert.equal(removes.requests().length, 0)
            if (action === "unlock") assert.deepEqual(sets.requests()[0]!.body, { type: 0, allow: Permissions.ViewChannel.toString(), deny: "0" })
            else assert.equal((b.calls.find((call) => call.method === "outcome")?.input as C.ModerationOutcomeRequest).outcome, "failed")
        })))
    }
})

test("command authority older than 15 seconds aborts before dispatch", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-expired-authority-token" })
        const p = platform(bot)
        const kicks = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
        const grant: C.ModerationActionGrant = { actionId: "synthetic_case_id", caseNo: 1, sourceId: f.nextId(), action: "kick", reason: "Synthetic reason", targetId: p.targetId }
        const result = yield* performActionGrant(b.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant, undefined, undefined, Date.now() - 16000)
        assert.equal(result.outcome, "failed")
        assert.equal(result.expired, true)
        assert.equal(kicks.requests().length, 0)
        assert.equal((b.calls.find((call) => call.method === "outcome")?.input as C.ModerationOutcomeRequest).outcome, "failed")
    })))
})

test("unlock restores only its owned SendMessages bit, preserves later unrelated bits, and refuses a changed owned bit", async () => {
    for (const state of ["preserve", "remove", "changed"] as const) {
        const f = createFixtures()
        const b = boundary({ query: () => Effect.succeed({ type: "recovery", recovery: { recoveryId: "owned_lock", generation: 2, type: "lock", caseNo: 4, status: "active", channelId: f.ids.channel, createdAt: 1 } }),
            manage: (input) => Effect.succeed(caseGrant(input, { recoveryId: "owned_lock", expectedOverwrite: { exists: true, allow: "0", deny: Permissions.SendMessages.toString() }, overwrite: { exists: false, allow: "0", deny: "0" } })),
        })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot)
            bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: bot.fixtures.channel({ permission_overwrites: [{ id: f.ids.guild, type: 0,
                allow: state === "preserve" ? Permissions.ViewChannel.toString() : "0", deny: state === "changed" ? "0" : Permissions.SendMessages.toString() }] }) })
            const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            const removes = bot.rest.respond("DELETE /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* emit(bot, `!security unlock ${f.ids.channel} "restore chat"`)
            assert.equal(sets.requests().length, state === "preserve" ? 1 : 0)
            assert.equal(removes.requests().length, state === "remove" ? 1 : 0)
            if (state === "preserve") assert.deepEqual(sets.requests()[0]!.body, { type: 0, allow: Permissions.ViewChannel.toString(), deny: "0" })
            assert.match(bodies(p).at(-1)!.content, state === "changed" ? /failed/ : /succeeded/)
        })))
    }
})

test("timeout records the actual provider deadline and slowmode compares its fresh prewrite snapshot", async () => {
    const f = createFixtures()
    const until = "2026-10-04T05:00:00.000Z"
    const outcomes: C.ModerationOutcomeRequest[] = []
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input, input.operation.type === "action" && input.operation.action.type === "slowmode" ? { expectedSlowmodeSeconds: 0 } : { expectedTimeoutUntil: null })),
        outcome: (input) => { outcomes.push(input); return Effect.succeed({ recorded: true }) },
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        const timeout = bot.rest.respond("PATCH /guilds/:id/members/:id", { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), communication_disabled_until: until }) })
        const slowmode = bot.rest.respond("PATCH /channels/:id", { body: bot.fixtures.channel({ rate_limit_per_user: 10 }) })
        bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: bot.fixtures.channel({ rate_limit_per_user: 0, permission_overwrites: [] }) })
        yield* bot.ready()
        yield* emit(bot, `!mod timeout ${p.targetId} 10m reason`)
        yield* emit(bot, `!mod slowmode ${f.ids.channel} 10 reason`)
        assert.equal(timeout.requests().length, 1)
        assert.equal(outcomes[0]?.timeoutUntil, until)
        assert.equal(slowmode.requests().length, 1)
        assert.deepEqual(slowmode.requests()[0]!.body, { rate_limit_per_user: 10 })
        assert.equal(outcomes[1]?.outcome, "succeeded")
        bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: bot.fixtures.channel({ rate_limit_per_user: 20, permission_overwrites: [] }) })
        yield* emit(bot, `!mod slowmode ${f.ids.channel} 10 reason`)
        assert.equal(slowmode.requests().length, 1)
        assert.equal(outcomes[2]?.outcome, "failed")
    })))
})

test("purge reserves the exact native preview selection before one deletion operation and excludes the command", async () => {
    const f = createFixtures()
    let managed: C.ModerationManageRequest | undefined
    const b = boundary({ manage: (input) => { managed = input; return Effect.succeed(caseGrant(input)) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        platform(bot)
        const first = bot.fixtures.message({ content: "synthetic first" })
        const second = bot.fixtures.message({ content: "synthetic second" })
        const command = bot.fixtures.message({ content: '!mod purge 2 "cleanup"' })
        bot.rest.respond("GET /channels/:id/messages", { body: [command, second, first] })
        const bulk = bot.rest.respond("POST /channels/:id/messages/bulk-delete", { status: 204 })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", command)
        yield* bot.idle()
        assert.equal(managed?.operation.type, "action")
        if (managed?.operation.type === "action") assert.deepEqual(managed.operation.action.messageIds, [second.id, first.id])
        assert.equal(bulk.requests().length, 1)
        assert.deepEqual((bulk.requests()[0]!.body as { message_ids: string[] }).message_ids, [second.id, first.id])
        assert.equal(bot.failures().length, 0)
    })))
})

test("purge inside a thread checks permissions through the thread's parent channel", async () => {
    const f = createFixtures()
    let managed: C.ModerationManageRequest | undefined
    const b = boundary({ manage: (input) => { managed = input; return Effect.succeed(caseGrant(input)) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        platform(bot)
        const thread = bot.fixtures.thread()
        const threadRead = bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
        const first = bot.fixtures.message({ channel_id: thread.id, content: "synthetic first" })
        const command = bot.fixtures.message({ channel_id: thread.id, content: '!mod purge 1 "cleanup"' })
        bot.rest.respond(`GET /channels/${thread.id}/messages`, { body: [command, first] })
        const bulk = bot.rest.respond(`POST /channels/${thread.id}/messages/bulk-delete`, { status: 204 })
        const single = bot.rest.respond(`DELETE /channels/${thread.id}/messages/:id`, { status: 204 })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", command)
        yield* bot.idle()
        assert.ok(threadRead.requests().length > 0)
        assert.equal(managed?.operation.type, "action")
        if (managed?.operation.type === "action") assert.deepEqual(managed.operation.action.messageIds, [first.id])
        assert.equal(bulk.requests().length + single.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("staff appeal decisions and text are delivered privately while guild confirmations carry only appeal metadata", async () => {
    const f = createFixtures()
    const requests: C.AppealStaffRequest[] = []
    const b = boundary({ staffAppeal: (input) => { requests.push(input); return Effect.succeed({ duplicate: false, type: "appeal", appeal: { appealNo: 3, caseNo: 2, userId: f.nextId(), text: "confidential appeal narrative", createdAt: 1, status: input.operation.type === "decide" ? input.operation.decision : "open", decisionReason: "private decision", erased: false } }) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        yield* emit(bot, '!appeals approve 3 "private decision"')
        assert.equal(requests[0]?.privateChannelVerified, true)
        assert.equal(requests[0]?.actor.isOwner, true)
        const dm = p.replies.requests().filter((request) => request.path.includes(p.dmId))
        const guild = p.replies.requests().filter((request) => request.path.includes(f.ids.channel))
        assert.match((dm[0]!.body as { content: string }).content, /confidential appeal narrative/)
        assert.equal(guild.length, 1)
        assert.equal((guild[0]!.body as { content: string }).content.includes("private decision"), false)
        assert.equal((guild[0]!.body as { content: string }).content.includes("confidential"), false)
        assert.equal(b.calls.some((call) => call.method === "manage"), false)
        assert.equal(bot.failures().length, 0)
    })))
})

test("a dry-run log grant records a finding without target membership or hierarchy and backend gate failure blocks public work", async () => {
    const f = createFixtures()
    const b = boundary({ evaluate: (input) => {
        const result = caseGrant({ serverId: input.serverId, messageId: input.messageId, createdAt: input.createdAt,
            actor: { userId: input.context.botId, roleIds: [], isOwner: false, isAdministrator: true, nativePermissionAuthorized: true },
            operation: { type: "action", action: { type: "log", targetId: input.userId, reason: "dry-run match" }, context: input.context } })
        return Effect.succeed({ duplicate: false, blocked: false, case: { ...result.case, origin: "automod" }, grant: result.grant! })
    } })
    b.current.automodEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        yield* emit(bot, "ordinary flagged message")
        assert.equal((b.calls.find((call) => call.method === "outcome")?.input as C.ModerationOutcomeRequest).outcome, "succeeded")
        assert.equal(p.actor.requests().length, 1)
        assert.equal(p.replies.requests().length, 0)
        b.store.gate = () => Effect.fail(new ModerationStoreError({ operation: "gate", status: null }))
        yield* emit(bot, "!ping")
        assert.equal(p.replies.requests().length, 0)
        assert.equal(bot.failures().length, 1)
    })))
})

test("durable DEFCON presence is restored before gateway Identify, and normal mode explicitly clears an absent custom status", async () => {
    for (const level of [1, 2, 3] as const) {
        const f = createFixtures()
        const b = boundary()
        b.current.defcon = level
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            yield* bot.ready()
            const identify = bot.commands().find((command) => command.op === 2)?.d as { presence?: { status: string, custom_status: unknown } }
            assert.equal(identify.presence?.status, level === 3 ? "online" : "dnd")
            assert.deepEqual(identify.presence?.custom_status, level === 3 ? null : { text: `DEFCON ${level}` })
            assert.equal(b.calls[0]?.method, "observe")
        })))
    }
})

test("cases and appeals staff without timeout permission can read their class and are denied an unconfigured class", async () => {
    for (const staffClass of ["cases", "appeals"] as const) {
        const f = createFixtures()
        let currentRole = ""
        const b = boundary({ query: (input) => {
            if (!input.actor.roleIds.some((role) => b.current.staffRoleIds.cases.includes(role))) return Effect.fail(new ModerationStoreError({ operation: "query", status: 403 }))
            assert.equal(input.actor.nativePermissionAuthorized, true)
            return Effect.succeed({ type: "cases", cases: [] })
        }, staffAppeal: (input) => {
            if (!input.actor.roleIds.some((role) => b.current.staffRoleIds.appeals.includes(role))) return Effect.fail(new ModerationStoreError({ operation: "staff", status: 403 }))
            assert.equal(input.actor.nativePermissionAuthorized, true)
            return Effect.succeed({ duplicate: false, type: "appeals", appeals: [], page: 1, totalPages: 1 })
        } })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot, { actorOwner: false, actorPermissions: 0n })
            currentRole = p.actorRole.id
            b.current.staffRoleIds[staffClass] = [currentRole]
            yield* bot.ready()
            yield* emit(bot, staffClass === "cases" ? "!case list" : "!appeals list")
            assert.ok(bodies(p).some((body) => /Private.*sent by DM/.test(body.content)))
            yield* emit(bot, staffClass === "cases" ? "!appeals list" : "!case list")
            assert.match(bodies(p).at(-1)!.content, /current permissions/)
            assert.equal(bot.failures().length, 0)
        })))
    }
})

test("a protection failure skips public replies for the message without failing the event", async () => {
    const f = createFixtures()
    let evaluations = 0
    const b = boundary({ evaluate: () => { evaluations++; return Effect.fail(new ModerationStoreError({ operation: "evaluate", status: null })) } })
    b.current.automodEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        yield* emit(bot, "!ping")
        assert.equal(evaluations, 1)
        assert.equal(p.replies.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("messages with an unchanged DEFCON level do not resend presence", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        platform(bot)
        yield* bot.ready()
        const updates = () => bot.commands().filter((command) => command.op === 3).length
        // The SDK flushes the startup presence on its own pacing, so counting starts after one handled message
        yield* emit(bot, "first message")
        const before = updates()
        yield* emit(bot, "ordinary message")
        yield* emit(bot, "another ordinary message")
        assert.equal(updates(), before)
    })))
})
