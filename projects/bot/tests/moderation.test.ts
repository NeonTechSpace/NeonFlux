import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { MessageType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { performActionGrant } from "../src/moderation.ts"
import { parseSafetyCommand, safetyGateClass, safetyNames, type SafetyName } from "../src/moderation-command.ts"
import { caseHistoryCard, manageConfirmation, queryCard } from "../src/moderation-format.ts"
import { ModerationStoreError } from "../src/moderation-store.ts"
import { boundary, caseGrant, platform, token } from "./moderation-fixture.ts"

const safeMentions = { parse: [], users: [], roles: [], replied_user: false }
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, overrides = {}) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...overrides })).pipe(Effect.andThen(bot.idle()))
type Embed = { title?: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }
type Body = { content: string, embeds?: Embed[], allowed_mentions: unknown }
const bodies = (p: ReturnType<typeof platform>) => p.replies.requests().map((request) => request.body as Body)
/** A reply's text, from its content or its embeds' title, description, fields and footer */
const shown = (body: unknown) => {
    const { content, embeds } = body as Body
    return content ?? embeds!.map(e => [e.title, e.description, ...(e.fields ?? []).map(x => `${x.name}: ${x.value}`), e.footer?.text].filter(Boolean).join("\n")).join("\n")
}

test("an automod rule update answers with one line that names the setting and its new value", () => {
    const rule: C.AutomodRule = { name: "flood", type: "spam", enabled: true, priority: 0, action: "warn", threshold: 5, windowSeconds: 10, durationSeconds: 600, patterns: [], domainMode: "block",
        channelIds: [], exemptChannelIds: [], exemptRoleIds: [] }
    const line = (patch: Partial<Omit<C.AutomodRule, "name" | "type">>) => manageConfirmation({ duplicate: false, type: "rule", rule: { ...rule, ...patch } }, { type: "rule-update", name: rule.name, patch })
    assert.deepEqual([line({ enabled: false }), line({ threshold: 8 }), line({ action: "timeout", durationSeconds: 3600 }), line({ exemptRoleIds: ["123456789012345678"] }), line({ channelIds: [] }), line({ priority: -5 })], [
        "Automod rule flood is now off", "Automod rule flood now acts at 8 messages in 10 seconds", "Automod rule flood now acts with a timeout of 1 hour",
        "Automod rule flood now skips members with <@&123456789012345678>", "Automod rule flood now checks every channel", "Automod rule flood now has priority -5"])
    assert.equal(manageConfirmation({ duplicate: false, type: "rule", rule }, { type: "rule-create", rule }), "Automod rule flood created")
})

test("a rule reads as one sentence with exemptions only when set, and a case keeps to eight fields at most", () => {
    const command = (feature: string, rest: string) => `!${feature} ${rest}`, id = (n: number) => String(123456789012345670n + BigInt(n))
    const rule: C.AutomodRule = { name: "flood", type: "spam", enabled: true, priority: 0, action: "delete", threshold: 5, windowSeconds: 10, durationSeconds: 600, patterns: [], domainMode: "block",
        channelIds: [], exemptChannelIds: [], exemptRoleIds: [] }
    assert.deepEqual(queryCard({ type: "rule", rule }, "automod", command), { title: "Automod rule flood", description: "Spam rule, on: Deletes the message at 5 messages in 10 seconds, in every channel" })
    assert.equal(queryCard({ type: "rule", rule: { ...rule, type: "domains", enabled: false, action: "timeout", patterns: ["example.com"], domainMode: "allow", channelIds: [id(1)], exemptChannelIds: [id(2)], exemptRoleIds: [id(3)], priority: 5 } }, "automod", command).description,
        `Links to domains rule, off: Times the member out for 10 minutes when a message links to a domain other than \`example.com\`, in <#${id(1)}>, skipping <#${id(2)}> and members with <@&${id(3)}>. Priority 5`)
    // Every optional fact at once, with both deliveries missing, stays within eight fields and moves the edits to one note
    const record: C.ModerationCase = { actionId: "synthetic", caseNo: 7, sourceId: id(4), action: "purge", reason: "Spam wave", targetId: id(5), channelId: id(6), origin: "manual", actorId: id(7),
        createdAt: 1_700_000_000_000, expiresAt: 1_800_000_000_000, outcome: "uncertain", logOutcome: "failed", notificationOutcome: "uncertain", erased: false, voided: true, linkedCaseNo: 3,
        observation: { observedAt: 1_700_000_000_000, memberPresent: true }, corrections: [{ type: "void", actorId: id(7), createdAt: 1_700_000_000_000, previousReason: "Spam wave", reason: "Spam wave" }] } as C.ModerationCase
    const detail = queryCard({ type: "case", case: record }, "mod", command)
    assert.deepEqual(detail.fields!.map(([label]) => label), ["Result", "Member", "Channel", "By", "When", "Linked case", "Not delivered", "Last checked"])
    assert.equal(Object.fromEntries(detail.fields!)["Not delivered"], "Staff log failed, member notice not confirmed")
    assert.equal(detail.note, "Edited once. `!mod history 7`")
    assert.deepEqual(caseHistoryCard(record, 0), { card: { title: "Case #7 history", description: `Voided by <@${id(7)}> <t:1700000000:R>` }, next: undefined })
    assert.deepEqual(parseSafetyCommand("mod", ["history", "7"]), { kind: "history", caseNo: 7, page: { list: "history 7", next: false } })
    assert.deepEqual(parseSafetyCommand("mod", ["history", "7", "next"]), { kind: "history", caseNo: 7, page: { list: "history 7", next: true } })
    for (const [name, args] of [["logs", ["history", "7"]], ["mod", ["history", "x"]], ["mod", ["history", "7", "2"]]] as const) assert.ok("error" in parseSafetyCommand(name, args))
})

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
        yield* emit(bot, `!security lock <#${f.ids.channel}> pause chat`)
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
        yield* emit(bot, `!mod warn <@${targetId}> private reason`)
        assert.equal(outcomes[0]?.outcome, "succeeded")
        assert.equal(notices[0]?.outcome, "sent")
        assert.equal(p.open.requests().length, 1)
        const [log, notice, reply] = bodies(p)
        assert.deepEqual(log!.embeds, [{ color: 0x5560e6, title: "Case #1: Warning", fields: [{ name: "Result", value: "Done" }, { name: "Member", value: `<@${targetId}>` },
            { name: "By", value: `<@${f.ids.user}>` }, { name: "Details", value: "`!mod show 1`, sent by DM" }] }])
        assert.ok(!shown(log).includes("private reason"))
        assert.deepEqual(notice!.embeds, [{ color: 0x5560e6, title: "Warning, case #1", description: "private reason", fields: [{ name: "Appeal", value: "Reply here with `!appeal submit 1 <your reason>`" },
            { name: "Your cases", value: "Reply here with `!appeal cases`" }] }])
        assert.equal(reply!.content, `Case #1: Warning of <@${targetId}> succeeded. The staff log or the member's notice may not have arrived, and NeonFlux does not send them again`)
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
        assert.match(bodies(p).at(-1)!.content, /^Case #1: Warning of <@\d+> succeeded$/)
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
        yield* emit(bot, `!mod ban ${p.targetId} 1d ${"É".repeat(512)}`)
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
        const b = boundary({ query: () => Effect.succeed({ type: "recovery", recovery: { recoveryId: "owned_recovery", generation: 3, type: "timeout", caseNo: 7, status: "active", targetId: f.ids.user, createdAt: 1_700_000_000_000, expectedTimeoutUntil: expected } }),
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
    const record: C.ModerationCase = { ...caseGrant({ serverId: f.ids.guild, messageId: f.nextId(), createdAt: 1_700_000_000_000, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, operation: { type: "action", action: { type: "warn", targetId: f.ids.user, reason: "private narrative" }, context: { botId: f.ids.bot, botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false } } }).case,
        corrections: Array.from({ length: 20 }, () => ({ type: "reason", actorId: f.ids.user, createdAt: 1_700_000_000_000, previousReason: "x".repeat(512), reason: "y".repeat(512) })),
    }
    const lists: C.ModerationQueryOperation[] = []
    const b = boundary({ query: (input) => {
        if (input.operation.type === "case-list") lists.push(input.operation)
        return Effect.succeed(input.operation.type === "case-list" ? { type: "cases", cases: Array.from({ length: 10 }, (_, i) => ({ ...record, caseNo: 20 - i })), nextBeforeCaseNo: 11 } : { type: "case", case: record })
    } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        yield* emit(bot, `!mod list <@${f.ids.user}>`)
        assert.equal(p.replies.requests().length, 2)
        const list = bodies(p)[0]!.embeds![0]!
        assert.equal(list.title, "Cases")
        assert.equal(list.description!.split("\n")[0], `**#20** Warning of <@${f.ids.user}> by <@${f.ids.user}>, in progress, <t:1700000000:R>`)
        assert.deepEqual(list.fields, [{ name: "Details", value: "`!mod show <case>`" }, { name: "Next", value: `\`!mod list ${f.ids.user} next\`` }])
        assert.ok(!shown(bodies(p)[0]).includes("private narrative"))
        assert.equal(bodies(p)[1]!.content, "Details sent by DM")
        // next continues the same member's list from where the last page ended. The unfiltered list has no page to continue
        yield* emit(bot, "!mod list next")
        assert.equal(bodies(p).at(-1)!.content, "There is no next page to show. Send !mod list to start the list again")
        yield* emit(bot, `!mod list ${f.ids.user} next`)
        assert.deepEqual(lists, [{ type: "case-list", userId: f.ids.user }, { type: "case-list", userId: f.ids.user, beforeCaseNo: 11 }])
        yield* emit(bot, "!mod show 1")
        const privateBodies = p.replies.requests().filter((request) => request.path.includes(p.dmId)).map((request) => request.body as Body)
        const detail = privateBodies.find(body => body.embeds?.[0]?.title === "Case #1: Warning")!.embeds![0]!
        // A case shows its reason and four facts, and counts its edits with the command that lists them
        assert.equal(detail.description, "private narrative\nEdited 20 times. `!mod history 1`")
        assert.deepEqual(detail.fields!.map(x => [x.name, x.value]), [["Result", "In progress"], ["Member", `<@${f.ids.user}>`], ["By", `<@${f.ids.user}>`], ["When", "<t:1700000000:R>"]])
        assert.ok(!privateBodies.map(shown).join("\n").includes("x".repeat(512)))
        // The history pages the edits by DM, ten at a time
        const history = (content: string) => Effect.gen(function* () {
            const before = p.replies.requests().length
            yield* emit(bot, content)
            const sent = p.replies.requests().slice(before), embeds = sent.filter(request => request.path.includes(p.dmId)).flatMap(request => (request.body as Body).embeds ?? [])
            return { embeds, inServer: sent.filter(request => !request.path.includes(p.dmId)).map(request => (request.body as Body).content) }
        })
        const first = yield* history("!mod history 1")
        assert.equal(first.embeds[0]!.title, "Case #1 history")
        // Long edits split the page across embeds at line breaks
        const edits = (embeds: readonly Embed[]) => embeds.map(e => e.description ?? "").join("\n").split("\n").filter(Boolean)
        const lines = edits(first.embeds)
        assert.equal(lines.length, 10)
        assert.equal(lines[0], `Reason changed by <@${f.ids.user}> <t:1700000000:R>: ${"x".repeat(512)} → ${"y".repeat(512)}`)
        assert.deepEqual(first.embeds.flatMap(e => e.fields ?? []), [{ name: "Next", value: "`!mod history 1 next`" }])
        assert.deepEqual(first.inServer, ["Details sent by DM"])
        const second = yield* history("!mod history 1 next")
        assert.equal(edits(second.embeds).length, 10)
        assert.deepEqual(second.embeds.flatMap(e => e.fields ?? []), [])
        assert.deepEqual((yield* history("!mod history 1 next")).inServer, ["There is no next page to show. Send !mod history 1 to start the list again"])
        for (const request of p.replies.requests()) {
            const body = request.body as Body
            assert.ok((body.content ?? "").length <= 1900)
            if (request.path.includes(f.ids.channel)) assert.equal(shown(body).includes("private narrative"), false)
        }
        assert.equal(bot.failures().length, 0)
    })))
})

test("banned users can discover and appeal their own cases in a verified DM without membership reads, while groups are rejected", async () => {
    const f = createFixtures()
    const memberCalls: C.AppealMemberRequest[] = []
    const b = boundary({ memberAppeal: (input) => { memberCalls.push(input); return Effect.succeed(input.operation.type === "cases" ? { duplicate: false, type: "cases", cases: [{ caseNo: 2, action: "ban", outcome: "succeeded", createdAt: 1_700_000_000_000, reason: "Own ban" }], ...(input.operation.beforeCaseNo ? {} : { nextBeforeCaseNo: 2 }) } : { duplicate: false, type: "appeal", appeal: { appealNo: 1, caseNo: 2, userId: input.requesterId, text: "Please review", createdAt: 1_700_000_000_000, status: "open", erased: false } }) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const dmId = bot.fixtures.nextId()
        const dm = { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null }
        bot.rest.respond(`GET /channels/${dmId}`, { body: dm })
        const replies = bot.rest.respond("POST /channels/:id/messages", (request) => ({ body: bot.fixtures.message({ channel_id: request.path.split("/")[2] }) }))
        yield* bot.ready()
        yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
        assert.deepEqual((replies.requests()[0]!.body as Body).embeds, [{ color: 0x5560e6, title: "Cases you can appeal", description: "**Case #2** Ban, <t:1700000000:R>: Own ban",
            fields: [{ name: "Appeal", value: "`!appeal submit <case> <your reason>`" }, { name: "Next", value: "`!appeal cases next`" }] }])
        yield* emit(bot, "!appeal cases next", { guild_id: undefined, channel_id: dmId })
        assert.doesNotMatch(shown(replies.requests()[1]!.body), /Next/)
        yield* emit(bot, "!appeal submit 2 Please review, I didn't post that link", { guild_id: undefined, channel_id: dmId })
        assert.deepEqual(memberCalls.map((input) => input.operation), [{ type: "cases" }, { type: "cases", beforeCaseNo: 2 }, { type: "submit", caseNo: 2, text: "Please review, I didn't post that link" }])
        assert.ok(memberCalls.every((input) => input.requesterId === f.ids.user && input.privateChannelVerified))
        assert.ok(b.calls.filter((call) => call.method === "gate").every((call) => (call.input as C.ModerationGateRequest).command === "appeal"))
        const group = bot.rest.respond(`GET /channels/${dmId}`, { body: { ...dm, type: 3, owner_id: f.ids.user, recipients: [bot.fixtures.user(), bot.fixtures.user({ id: bot.fixtures.nextId() })] } })
        yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
        assert.equal(memberCalls.length, 3)
        assert.equal(replies.requests().length, 3)
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
        assert.match(bodies(p)[0]!.content, /^Case #1: Kick of <@\d+> is not confirmed yet\. Run `!mod recover 1` to check it$/)
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

test("native management with free-text reasons exposes complete settings, rules, watchlist, security and appeal configuration flows", async () => {
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
            `!security watchlist add ${p.targetId} private watch note`, `!security watchlist update ${p.targetId} replacement note`, `!security watchlist remove ${p.targetId}`,
            `!security honeypot add <#${f.ids.channel}>`, `!security honeypot remove <#${f.ids.channel}>`, "!security honeypot module on", "!security honeypot module off",
            "!security joins threshold 5", "!security joins window 30", "!security joins raid-mode defcon2", "!security joins module on", "!security joins module off",
            "!security watchlist module on", "!security watchlist module off", "!security mode enforce", "!security module off", "!appeal module off", "!appeal module on",
            "!defcon set 2", "!defcon set 1", "!defcon set 3", "!mod erase 1", "!mod reason 1 fixed reason", "!mod void 1",
        ]
        for (const command of commands) yield* emit(bot, command)
        assert.equal(managed.length, commands.length)
        assert.ok(managed.every((input) => input.actor.isOwner && input.createdAt > 0))
        assert.ok(managed.some((input) => input.operation.type === "rule-create" && input.operation.rule.patterns[0] === "literal phrase"))
        assert.ok(managed.some((input) => input.operation.type === "watchlist-add" && input.operation.reason === "replacement note"))
        assert.ok(managed.some((input) => input.operation.type === "case-reason" && input.operation.reason === "fixed reason"))
        const count = managed.length
        // Typed page numbers, a link to a case without a reason and an extra word after a case number are not forms of these commands
        const malformed = ["!mod module sometimes", "!mod erase @someone", "!security watchlist list invalid", "!automod update badwords threshold 0", "!mod ban 123456789012345679 1s reason",
            "!automod list 2", "!security recovery list 2", "!mod warn 123456789012345679 case 4", "!mod void 1 now", '!mod warn 123456789012345679 "unclosed']
        for (const command of malformed) yield* emit(bot, command)
        assert.equal(managed.length, count)
        assert.ok(bodies(p).slice(-malformed.length, -1).every((body) => /Check quoting/.test(body.content)))
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
        record = caseGrant({ serverId: f.ids.guild, messageId: bot.fixtures.nextId(), createdAt: 1_700_000_000_000, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: true, nativePermissionAuthorized: true }, operation: { type: "action", action: { type: "kick", targetId: p.targetId, reason: "original" }, context: { botId: f.ids.bot, botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false } } }).case
        record.outcome = "uncertain"
        const writes = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
        yield* bot.ready()
        yield* emit(bot, "!mod recover 1")
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
                ? { recoveryId: "owned_recovery", generation: 3, type: "timeout", caseNo: 7, status: "active", targetId: f.ids.user, createdAt: 1_700_000_000_000, expectedTimeoutUntil: expected }
                : { recoveryId: "owned_lock", generation: 2, type: "lock", caseNo: 4, status: "active", channelId: f.ids.channel, createdAt: 1_700_000_000_000 } }),
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
            yield* emit(bot, action === "release" ? `!security release ${p.targetId} reason` : `!security unlock ${f.ids.channel} restore chat`)
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
        const b = boundary({ query: () => Effect.succeed({ type: "recovery", recovery: { recoveryId: "owned_lock", generation: 2, type: "lock", caseNo: 4, status: "active", channelId: f.ids.channel, createdAt: 1_700_000_000_000 } }),
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
            yield* emit(bot, `!security unlock ${f.ids.channel} restore chat`)
            assert.equal(sets.requests().length, state === "preserve" ? 1 : 0)
            assert.equal(removes.requests().length, state === "remove" ? 1 : 0)
            if (state === "preserve") assert.deepEqual(sets.requests()[0]!.body, { type: 0, allow: Permissions.ViewChannel.toString(), deny: "0" })
            assert.match(bodies(p).at(-1)!.content, state === "changed" ? /failed/ : /succeeded/)
        })))
    }
})

test("lock and unlock grants own the thread bits too and keep unrelated overwrite bits", async () => {
    const owned = Permissions.SendMessages | Permissions.SendMessagesInThreads | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads
    for (const action of ["lock", "unlock"] as const) {
        const f = createFixtures()
        // Before the lock the everyone overwrite explicitly allowed public threads. Staff later allowed ViewChannel
        const before = { exists: true, allow: Permissions.CreatePublicThreads.toString(), deny: "0" }
        const locked = { exists: true, allow: "0", deny: owned.toString() }
        const b = boundary({ query: () => Effect.succeed({ type: "recovery", recovery: { recoveryId: "owned_lock", generation: 2, type: "lock", caseNo: 4, status: "active", channelId: f.ids.channel, createdAt: 1_700_000_000_000 } }),
            manage: (input) => Effect.succeed(caseGrant(input, { ownedPermissions: owned.toString(), ...(action === "lock" ? { overwrite: locked, expectedOverwrite: before }
                : { recoveryId: "owned_lock", overwrite: { exists: true, allow: (Permissions.ViewChannel | Permissions.CreatePublicThreads).toString(), deny: "0" }, expectedOverwrite: { ...locked, allow: Permissions.ViewChannel.toString() } }) })),
        })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot)
            const current = action === "lock" ? { allow: Permissions.CreatePublicThreads | Permissions.AddReactions, deny: 0n } : { allow: Permissions.ViewChannel, deny: owned }
            bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: bot.fixtures.channel({ permission_overwrites: [{ id: f.ids.guild, type: 0, allow: current.allow.toString(), deny: current.deny.toString() }] }) })
            const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* emit(bot, `!security ${action} ${f.ids.channel} thread safety`)
            assert.equal(sets.requests().length, 1)
            assert.deepEqual(sets.requests()[0]!.body, action === "lock" ? { type: 0, allow: Permissions.AddReactions.toString(), deny: owned.toString() }
                : { type: 0, allow: (Permissions.ViewChannel | Permissions.CreatePublicThreads).toString(), deny: "0" })
            assert.match(bodies(p).at(-1)!.content, action === "lock" ? /succeeded.*sending in threads and starting threads/ : /succeeded/)
            assert.equal(bot.failures().length, 0)
        })))
    }
})

test("a lock owns only the thread permissions NeonFlux holds and says which stay open", async () => {
    const f = createFixtures()
    let request: C.ModerationManageRequest | undefined
    const b = boundary({ manage: (input) => {
        request = input
        const owned = input.operation.type === "action" ? input.operation.context.botPostingPermissions : undefined
        return Effect.succeed(caseGrant(input, { ownedPermissions: owned!, overwrite: { exists: true, allow: "0", deny: owned! }, expectedOverwrite: { exists: false, allow: "0", deny: "0" } }))
    } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot, { botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages | Permissions.SendMessagesInThreads })
        const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
        yield* bot.ready()
        yield* emit(bot, `!security lock ${f.ids.channel} thread safety`)
        assert.equal(request?.operation.type === "action" && request.operation.context.botPostingPermissions, (Permissions.SendMessages | Permissions.SendMessagesInThreads).toString())
        assert.equal((writes.requests()[0]!.body as { deny: string }).deny, (Permissions.SendMessages | Permissions.SendMessagesInThreads).toString())
        assert.match(bodies(p).at(-1)!.content, /NeonFlux lacks Create Public Threads, Create Private Threads in this server, so those stay open/)
        assert.equal(bot.failures().length, 0)
    })))
})

test("message protection sends a thread's parent channel without another channel read", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.automodEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        const thread = bot.fixtures.thread()
        const reads = bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
        yield* bot.ready()
        yield* emit(bot, "synthetic thread message", { channel_id: thread.id })
        const evaluated = b.calls.filter((call) => call.method === "evaluate").map((call) => call.input as C.ModerationEvaluateRequest)
        assert.deepEqual(evaluated.map((input) => [input.channelId, input.parentChannelId]), [[thread.id, f.ids.channel]])
        // The permission read fetched the thread and its parent once each
        assert.equal(reads.requests().length, 1)
        assert.equal(p.channel.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("lock and unlock aimed at a thread name its parent and change nothing", async () => {
    for (const action of ["lock", "unlock"] as const) {
        const f = createFixtures()
        const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
            const p = platform(bot)
            const thread = bot.fixtures.thread()
            bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
            const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* emit(bot, `!security ${action} ${thread.id} thread safety`)
            assert.equal(b.calls.some((call) => call.method === "manage" || call.method === "query" && (call.input as C.ModerationQueryRequest).operation.type === "recovery-channel"), false)
            assert.equal(writes.requests().length, 0)
            assert.match(bodies(p).at(-1)!.content, new RegExp(`Threads follow their parent channel's permissions\\. ${action === "lock" ? "Lock" : "Unlock"} <#${f.ids.channel}> instead`))
            assert.equal(bot.failures().length, 0)
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
        const command = bot.fixtures.message({ content: "!mod purge 2 cleanup" })
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
        const command = bot.fixtures.message({ channel_id: thread.id, content: "!mod purge 1 cleanup" })
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
    const b = boundary({ staffAppeal: (input) => { requests.push(input); return Effect.succeed({ duplicate: false, type: "appeal", appeal: { appealNo: 3, caseNo: 2, userId: f.nextId(), text: "confidential appeal narrative", createdAt: 1_700_000_000_000, status: input.operation.type === "decide" ? input.operation.decision : "open", decisionReason: "private decision", erased: false } }) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        yield* emit(bot, "!appeal approve 3 private decision")
        assert.equal(requests[0]?.privateChannelVerified, true)
        assert.equal(requests[0]?.actor.isOwner, true)
        const dm = p.replies.requests().filter((request) => request.path.includes(p.dmId))
        const guild = p.replies.requests().filter((request) => request.path.includes(f.ids.channel))
        assert.match(shown(dm[0]!.body), /confidential appeal narrative/)
        assert.equal(guild.length, 1)
        assert.equal((guild[0]!.body as Body).content, "Appeal #3 accepted. Details sent by DM")
        assert.deepEqual(requests[0]?.operation, { type: "decide", appealNo: 3, decision: "accepted", reason: "private decision" })
        assert.equal(b.calls.some((call) => call.method === "manage"), false)
        assert.equal(bot.failures().length, 0)
    })))
})

test("staff review appeals with !appeal in a server channel or a verified DM, the review list pages with next and member forms stay in DMs", async () => {
    const f = createFixtures()
    const requests: C.AppealStaffRequest[] = []
    const b = boundary({ staffAppeal: (input) => { requests.push(input); return Effect.succeed(input.operation.type === "list"
        ? { duplicate: false, type: "appeals", appeals: [], page: input.operation.page ?? 1, totalPages: 2 }
        : { duplicate: false, type: "appeal", appeal: { appealNo: 3, caseNo: 2, userId: f.nextId(), text: "confidential appeal narrative", createdAt: 1_700_000_000_000, status: "open", erased: false } }) } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        const sent = (channelId: string) => p.replies.requests().filter((request) => request.path.includes(channelId)).map((request) => shown(request.body))
        yield* emit(bot, "!appeal review")
        assert.equal(sent(p.dmId)[0]!, "Appeals\nNo appeals yet\nNext: `!appeal review next`")
        assert.deepEqual(sent(f.ids.channel), ["Appeal list sent by DM"])
        yield* emit(bot, "!appeal review next")
        assert.doesNotMatch(sent(p.dmId)[1]!, /Next/)
        yield* emit(bot, "!appeal review next")
        assert.equal(sent(f.ids.channel).at(-1), "There is no next page to show. Send !appeal review to start the list again")
        // A verified DM needs no acknowledgement in the server
        yield* emit(bot, "!appeal review 3", { guild_id: undefined, channel_id: p.dmId })
        assert.match(sent(p.dmId).at(-1)!, /confidential appeal narrative/)
        assert.equal(sent(f.ids.channel).length, 3)
        assert.deepEqual(requests.map((input) => input.operation), [{ type: "list" }, { type: "list", page: 2 }, { type: "show", appealNo: 3 }])
        assert.ok(requests.every((input) => input.actor.isOwner && input.privateChannelVerified))
        assert.deepEqual(b.calls.filter((call) => call.method === "gate").map((call) => (call.input as C.ModerationGateRequest).command), ["staff", "staff", "staff", "staff"])
        yield* emit(bot, "!appeal cases")
        assert.equal(sent(f.ids.channel).at(-1), "Send `!appeal` commands in a private one-to-one DM with NeonFlux")
        assert.equal(b.calls.some((call) => call.method === "memberAppeal"), false)
        assert.equal(bot.failures().length, 0)
    })))
})

test("free-text reasons, linked cases, paged lists and the merged appeal command parse to the same backend operations", () => {
    const user = "123456789012345679", channel = "223456789012345679"
    const action = (name: SafetyName, ...args: string[]) => {
        const parsed = parseSafetyCommand(name, args)
        return "kind" in parsed && parsed.kind === "action" ? parsed.action : parsed
    }
    assert.deepEqual(safetyNames, ["mod", "logs", "automod", "security", "defcon", "appeal"])
    assert.deepEqual(action("mod", "warn", `<@${user}>`, "don't", "spam", "links"), { type: "warn", reason: "don't spam links", targetId: user })
    assert.deepEqual(action("mod", "ban", user, "case", "4", "repeat", "offense"), { type: "ban", reason: "repeat offense", targetId: user, linkedCaseNo: 4 })
    assert.deepEqual(action("mod", "ban", user, "1d", "case", "4", "cool", "off"), { type: "ban", reason: "cool off", targetId: user, durationSeconds: 86400, linkedCaseNo: 4 })
    assert.deepEqual(action("mod", "timeout", user, "10m", "case", "closed", "early"), { type: "timeout", reason: "case closed early", targetId: user, durationSeconds: 600 })
    assert.deepEqual(action("mod", "slowmode", `<#${channel}>`, "10", "calm", "down"), { type: "slowmode", channelId: channel, slowmodeSeconds: 10, reason: "calm down" })
    assert.deepEqual(action("security", "quarantine", user, "10m", "case", "2", "raid", "account"), { type: "quarantine", reason: "raid account", targetId: user, durationSeconds: 600, linkedCaseNo: 2 })
    assert.deepEqual(action("security", "release", user, "cleared"), { type: "release", reason: "cleared", targetId: user })
    assert.deepEqual(action("security", "lock", `<#${channel}>`, "raid", "in", "progress"), { type: "lock", reason: "raid in progress", channelId: channel })
    assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", `<@${user}>`, "raid", "cleanup"]), { kind: "purge", count: 20, reason: "raid cleanup", userId: user })
    assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", `<@${user}>`]), { kind: "purge", count: 20, reason: `<@${user}>` })
    assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", "spam", "wave"]), { kind: "purge", count: 20, reason: "spam wave" })
    assert.deepEqual(parseSafetyCommand("mod", ["reason", "3", "corrected", "reason"]), { kind: "manage", operation: { type: "case-reason", caseNo: 3, reason: "corrected reason" } })
    assert.deepEqual(parseSafetyCommand("mod", ["void", "3"]), { kind: "manage", operation: { type: "case-void", caseNo: 3 } })
    assert.deepEqual(parseSafetyCommand("mod", ["show", "3"]), { kind: "query", operation: { type: "case-show", caseNo: 3 }, private: true })
    assert.deepEqual(parseSafetyCommand("mod", ["recover", "3"]), { kind: "recover", caseNo: 3 })
    assert.deepEqual(parseSafetyCommand("mod", ["list"]), { kind: "query", operation: { type: "case-list" }, private: true, page: { list: "list", next: false } })
    assert.deepEqual(parseSafetyCommand("mod", ["list", `<@${user}>`, "next"]), { kind: "query", operation: { type: "case-list", userId: user }, private: true, page: { list: `list ${user}`, next: true } })
    assert.deepEqual(parseSafetyCommand("logs", ["list", "next"]), { kind: "query", operation: { type: "case-list" }, private: true, page: { list: "list", next: true } })
    assert.deepEqual(parseSafetyCommand("automod", ["list", "next"]), { kind: "query", operation: { type: "rule-list" }, private: false, page: { list: "list", next: true } })
    assert.deepEqual(parseSafetyCommand("security", ["watchlist", "list"]), { kind: "query", operation: { type: "watchlist-list" }, private: true, page: { list: "watchlist list", next: false } })
    assert.deepEqual(parseSafetyCommand("security", ["recovery", "list", "next"]), { kind: "query", operation: { type: "recovery-list" }, private: true, page: { list: "recovery list", next: true } })
    assert.deepEqual(parseSafetyCommand("security", ["watchlist", "add", user, "known", "raid", "alt"]), { kind: "manage", operation: { type: "watchlist-add", userId: user, reason: "known raid alt" } })
    assert.deepEqual(parseSafetyCommand("appeal", ["cases", "next"]), { kind: "member-appeal", operation: { type: "cases" }, page: { list: "cases", next: true } })
    assert.deepEqual(parseSafetyCommand("appeal", ["list"]), { kind: "member-appeal", operation: { type: "list" }, page: { list: "list", next: false } })
    assert.deepEqual(parseSafetyCommand("appeal", ["submit", "12", "Please", "review", "this"]), { kind: "member-appeal", operation: { type: "submit", caseNo: 12, text: "Please review this" } })
    assert.deepEqual(parseSafetyCommand("appeal", ["withdraw", "3"]), { kind: "member-appeal", operation: { type: "withdraw", appealNo: 3 } })
    assert.deepEqual(parseSafetyCommand("appeal", ["review", "next"]), { kind: "staff-appeal", operation: { type: "list" }, page: { list: "review", next: true } })
    assert.deepEqual(parseSafetyCommand("appeal", ["review", "3"]), { kind: "staff-appeal", operation: { type: "show", appealNo: 3 } })
    assert.deepEqual(parseSafetyCommand("appeal", ["reject", "3", "the", "ban", "stands"]), { kind: "staff-appeal", operation: { type: "decide", appealNo: 3, decision: "rejected", reason: "the ban stands" } })
    for (const [name, ...args] of [["mod", "list", user, "11"], ["mod", "list", "user", user], ["logs", "list", `<@${user}>`], ["logs", "list", "11"],
        ["mod", "warn", user], ["mod", "ban", user, "1d"], ["mod", "slowmode", channel, "10"], ["mod", "purge", "20"], ["mod", "reason", "3"], ["security", "watchlist", "add", user],
        ["appeal", "cases", "11"], ["appeal", "list", "2"], ["appeal", "review", "2", "next"], ["appeal", "submit", "12"], ["appeal", "submit", "12", "x".repeat(2001)], ["appeal", "approve", "3"]] as [SafetyName, ...string[]][])
        assert.ok("error" in parseSafetyCommand(name, args), [name, ...args].join(" "))
    // A member's own appeal forms keep the appeal class. Staff review is staff work, and reading or turning off the module is critical
    const gate = (...args: string[]) => safetyGateClass("appeal", parseSafetyCommand("appeal", args))
    assert.deepEqual([gate("cases"), gate("submit", "12", "text"), gate("help"), gate("unknown")], ["appeal", "appeal", "appeal", "appeal"])
    assert.deepEqual([gate("review"), gate("review", "3"), gate("approve", "3", "ok"), gate("module", "on"), gate("module", "off"), gate("status")], ["staff", "staff", "staff", "staff", "critical", "critical"])
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

test("an unreadable DEFCON state shows do not disturb with no custom status text", async () => {
    const f = createFixtures()
    const b = boundary({ observe: () => Effect.fail(new ModerationStoreError({ operation: "observe", status: null })) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        yield* bot.ready()
        const identify = bot.commands().find((command) => command.op === 2)?.d as { presence?: { status: string, custom_status: unknown } }
        assert.equal(identify.presence?.status, "dnd")
        assert.equal(identify.presence?.custom_status, null)
    })))
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
            yield* emit(bot, staffClass === "cases" ? "!mod list" : "!appeal review")
            assert.ok(bodies(p).some((body) => /sent by DM$/.test(body.content ?? "")))
            yield* emit(bot, staffClass === "cases" ? "!appeal review" : "!mod list")
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

test("each safety status command shows its own feature, and !appeal status shows appeals only", async () => {
    const f = createFixtures()
    const b = boundary(), query = b.store.query
    // Only !appeal status asks the backend to count open appeals
    b.store.query = input => input.operation.type === "settings" && input.operation.appeals ? Effect.succeed({ type: "settings", settings: b.current, openAppeals: 2 }) : query(input)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        b.current.staffRoleIds.appeals = [p.actorRole.id]
        b.current.honeypotChannelIds = [f.ids.channel]
        yield* bot.ready()
        const status = (content: string) => Effect.gen(function* () { yield* emit(bot, content); return bodies(p).at(-1)!.embeds![0]! })
        assert.deepEqual(yield* status("!appeal status"), { color: 0x5560e6, title: "Appeals", fields: [{ name: "Status", value: "On" }, { name: "Reviewers", value: `<@&${p.actorRole.id}>` },
            { name: "Waiting for review", value: "2. Run `!appeal review` for the list, sent by DM" }] })
        const fields = (embed: Embed) => Object.fromEntries(embed.fields!.map(x => [x.name, x.value]))
        const automod = yield* status("!automod status")
        assert.equal(automod.title, "Automod")
        assert.deepEqual(fields(automod), { Status: "Off", Mode: "Test mode (logs only, no action)", "Bot and webhook messages": "Not checked", "Automod staff": "Owner and Administrators only", Rules: "`!automod list`" })
        // Security status is three lines, with its staff only when set
        assert.deepEqual(yield* status("!security status"), { color: 0x5560e6, title: "Security", description: "Off\nJoin protection off\nHoneypots off, watchlist off" })
        Object.assign(b.current, { securityEnabled: true, joinEnabled: true, joinDefcon2: true, honeypotEnabled: true, staffRoleIds: { ...b.current.staffRoleIds, security: [p.actorRole.id] } })
        assert.equal((yield* status("!security status")).description, ["On, test mode (logs only, no action)", "Join protection on at 5 joins in 10 seconds, and a join burst sets DEFCON 2",
            `Honeypots on in <#${f.ids.channel}>, watchlist off`, `Security staff: <@&${p.actorRole.id}>`].join("\n"))
        Object.assign(b.current, { securityEnabled: false, joinEnabled: false, joinDefcon2: false, honeypotEnabled: false, staffRoleIds: { ...b.current.staffRoleIds, security: [] } })
        assert.deepEqual(yield* status("!security honeypot list"), { color: 0x5560e6, title: "Honeypots", fields: [{ name: "Status", value: "Off" }, { name: "Channels", value: `<#${f.ids.channel}>` }] })
        assert.deepEqual(fields(yield* status("!defcon status")), { Level: "3: Normal operation" })
        assert.equal((yield* status("!defcon diagnose")).title, "DEFCON check")
        assert.deepEqual(fields(yield* status("!logs status")), { "Log channel": "Not set. Run `!logs channel #channel`", "Case readers": "Owner and Administrators only" })
        const mod = yield* status("!mod status")
        assert.deepEqual([mod.title, mod.fields![0]!.name, fields(mod).Status, fields(mod)["Appeal reviewers"]], ["Moderation", "Status", "On", `<@&${p.actorRole.id}>`])
        // No status mentions another feature's settings
        for (const body of bodies(p)) assert.equal(body.content, undefined)
        assert.ok(!shown(bodies(p)[0]).match(/DEFCON|Automod|Security|Log channel/))
        assert.equal(bot.failures().length, 0)
    })))
})
