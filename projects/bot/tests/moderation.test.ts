import assert from "node:assert/strict"
import test from "node:test"
import type { AppealMemberRequest, AppealStaffRequest } from "@neonflux/contracts/appeal"
import type {
    AutomodRule,
    ModerationActionGrant,
    ModerationCase,
    ModerationEvaluateRequest,
    ModerationGateRequest,
    ModerationJoinRequest,
    ModerationManageRequest,
    ModerationNoticeOutcomeRequest,
    ModerationOutcomeRequest,
    ModerationQueryOperation,
    ModerationQueryRequest,
    ModerationReconcileRequest,
} from "@neonflux/contracts/moderation"
import { MessageType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import type { GeneralSettingsStore } from "../src/general-settings.ts"
import { createBotOptions } from "../src/bot.ts"
import { performActionGrant } from "../src/moderation.ts"
import { parseSafetyCommand, safetyGateClass, safetyNames, type SafetyName } from "../src/moderation-command.ts"
import { caseHistoryCard, manageConfirmation, queryCard } from "../src/moderation-format.ts"
import { ModerationStoreError } from "../src/moderation-store.ts"
import { boundary, caseGrant, platform, token } from "./moderation-fixture.ts"

const safeMentions = { parse: [], users: [], roles: [], replied_user: false }
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, overrides = {}) =>
    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...overrides })).pipe(Effect.andThen(bot.idle()))
type Embed = {
    title?: string
    description?: string
    fields?: { name: string; value: string }[]
    footer?: { text: string }
}
type Body = { content: string; embeds?: Embed[]; allowed_mentions: unknown }
const bodies = (p: ReturnType<typeof platform>) => p.replies.requests().map((request) => request.body as Body)
/** A reply's text, from its content or its embeds' title, description, fields and footer */
const shown = (body: unknown) => {
    const { content, embeds } = body as Body
    return (
        content ??
        embeds!
            .map((e) =>
                [e.title, e.description, ...(e.fields ?? []).map((x) => `${x.name}: ${x.value}`), e.footer?.text]
                    .filter(Boolean)
                    .join("\n"),
            )
            .join("\n")
    )
}

test("an automod rule update answers with one line that names the setting and its new value", () => {
    const rule: AutomodRule = {
        name: "flood",
        type: "spam",
        enabled: true,
        priority: 0,
        action: "warn",
        threshold: 5,
        windowSeconds: 10,
        durationSeconds: 600,
        patterns: [],
        domainMode: "block",
        channelIds: [],
        exemptChannelIds: [],
        exemptRoleIds: [],
    }
    const line = (patch: Partial<Omit<AutomodRule, "name" | "type">>) =>
        manageConfirmation(
            { duplicate: false, type: "rule", rule: { ...rule, ...patch } },
            { type: "rule-update", name: rule.name, patch },
        )
    assert.deepEqual(
        [
            line({ enabled: false }),
            line({ threshold: 8 }),
            line({ action: "timeout", durationSeconds: 3600 }),
            line({ exemptRoleIds: ["123456789012345678"] }),
            line({ channelIds: [] }),
            line({ priority: -5 }),
            line({ durationSeconds: 5400 }),
            line({ action: "timeout", durationSeconds: 900 }),
        ],
        [
            "Automod rule flood is now off",
            "Automod rule flood now acts at 8 messages in 10 seconds",
            "Automod rule flood now acts with a timeout of 1 hour",
            "Automod rule flood now skips members with <@&123456789012345678>",
            "Automod rule flood now checks every channel",
            "Automod rule flood now has priority -5",
            "Automod rule flood now times out for 90 minutes, once its action is a timeout",
            "Automod rule flood now acts with a timeout of 15 minutes",
        ],
    )
    assert.equal(
        manageConfirmation({ duplicate: false, type: "rule", rule }, { type: "rule-create", rule }),
        "Automod rule flood created",
    )
})

test("a rule reads as one sentence with exemptions only when set, and a case keeps to eight fields at most", () => {
    const command = (feature: string, rest: string) => `!${feature} ${rest}`,
        id = (n: number) => String(123456789012345670n + BigInt(n))
    const rule: AutomodRule = {
        name: "flood",
        type: "spam",
        enabled: true,
        priority: 0,
        action: "delete",
        threshold: 5,
        windowSeconds: 10,
        durationSeconds: 600,
        patterns: [],
        domainMode: "block",
        channelIds: [],
        exemptChannelIds: [],
        exemptRoleIds: [],
    }
    assert.deepEqual(queryCard({ type: "rule", rule }, "automod", command), {
        title: "Automod rule flood",
        description: "Spam rule, on: Deletes the message at 5 messages in 10 seconds, in every channel",
    })
    assert.equal(
        queryCard(
            {
                type: "rule",
                rule: {
                    ...rule,
                    type: "domains",
                    enabled: false,
                    action: "timeout",
                    patterns: ["example.com"],
                    domainMode: "allow",
                    channelIds: [id(1)],
                    exemptChannelIds: [id(2)],
                    exemptRoleIds: [id(3)],
                    priority: 5,
                },
            },
            "automod",
            command,
        ).description,
        `Links to domains rule, off: Times the member out for 10 minutes when a message links to a domain other than \`example.com\`, in <#${id(1)}>, skipping <#${id(2)}> and members with <@&${id(3)}>. Priority 5`,
    )
    // Every optional fact at once, with both deliveries missing, stays within eight fields and moves the edits to one note
    const record: ModerationCase = {
        actionId: "synthetic",
        caseNo: 7,
        sourceId: id(4),
        action: "purge",
        reason: "Spam wave",
        targetId: id(5),
        channelId: id(6),
        origin: "manual",
        actorId: id(7),
        createdAt: 1_700_000_000_000,
        expiresAt: 1_800_000_000_000,
        outcome: "uncertain",
        logOutcome: "failed",
        notificationOutcome: "uncertain",
        erased: false,
        voided: true,
        linkedCaseNo: 3,
        observation: { observedAt: 1_700_000_000_000, memberPresent: true },
        corrections: [
            {
                type: "void",
                actorId: id(7),
                createdAt: 1_700_000_000_000,
                previousReason: "Spam wave",
                reason: "Spam wave",
            },
        ],
    } as ModerationCase
    const detail = queryCard({ type: "case", case: record }, "mod", command)
    assert.deepEqual(
        detail.fields!.map(([label]) => label),
        ["Result", "Member", "Channel", "By", "When", "Linked case", "Not delivered", "Last checked"],
    )
    assert.equal(Object.fromEntries(detail.fields!)["Not delivered"], "Staff log failed, member notice not confirmed")
    assert.equal(detail.note, "Edited once. `!mod history 7`")
    assert.deepEqual(caseHistoryCard(record, 0), {
        card: { title: "Case #7 history", description: `Voided by <@${id(7)}> <t:1700000000:R>` },
        next: undefined,
    })
    assert.deepEqual(parseSafetyCommand("mod", ["history", "7"]), {
        kind: "history",
        caseNo: 7,
        page: { list: "history 7", next: false },
    })
    assert.deepEqual(parseSafetyCommand("mod", ["history", "7", "next"]), {
        kind: "history",
        caseNo: 7,
        page: { list: "history 7", next: true },
    })
    for (const [name, args] of [
        ["logs", ["history", "7"]],
        ["mod", ["history", "x"]],
        ["mod", ["history", "7", "2"]],
    ] as const)
        assert.ok("error" in parseSafetyCommand(name, args))
})

test("disabled protections use the mandatory backend gate without platform permission reads and preserve ping before AFK", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>()
                const release = yield* Deferred.make<void>()
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        {
                            afk: {
                                set: (userId, reason) => Effect.succeed({ userId, reason, since: 1 }),
                                observe: () =>
                                    Deferred.succeed(entered, undefined).pipe(
                                        Effect.andThen(Deferred.await(release)),
                                        Effect.as({ cleared: true, statuses: [] }),
                                    ),
                            },
                            moderation: b.store,
                        },
                    ),
                )
                const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
                yield* bot.ready()
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
                yield* Deferred.await(entered)
                assert.equal(replies.requests().length, 1)
                assert.equal((replies.requests()[0]!.body as { content: string }).content, "Pong!")
                assert.equal(b.calls.filter((call) => call.method === "gate").length, 1)
                assert.equal(
                    b.calls.some((call) => call.method === "evaluate"),
                    false,
                )
                yield* Deferred.succeed(release, undefined)
                yield* bot.idle()
                assert.equal(replies.requests().length, 2)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("DEFCON blocks public commands and ordinary private appeals at level 1 while preserving silent AFK return clearing", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.defcon = 2
    let cleared = 0
    let sets = 0
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        {
                            afk: {
                                set: (userId, reason) =>
                                    Effect.sync(() => {
                                        sets++
                                        return { userId, reason, since: 1 }
                                    }),
                                observe: () =>
                                    Effect.sync(() => {
                                        cleared++
                                        return { cleared: true, statuses: [] }
                                    }),
                            },
                            moderation: b.store,
                        },
                    ),
                )
                const p = platform(bot)
                yield* bot.ready()
                for (const command of ["!ping", "!afk Away", "!unknown", "ordinary return"]) yield* emit(bot, command)
                assert.equal(sets, 0)
                assert.equal(cleared, 3)
                assert.equal(p.replies.requests().length, 0)
                b.current.defcon = 1
                yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: p.dmId })
                assert.equal(
                    b.calls.some((call) => call.method === "memberAppeal"),
                    false,
                )
                yield* emit(bot, "!mod warn <@123456789012345679> reason")
                assert.equal(
                    b.calls.some((call) => call.method === "manage"),
                    false,
                )
                yield* emit(bot, "!defcon status")
                assert.equal(
                    b.calls.some((call) => call.method === "query"),
                    true,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a staff command reads its author before the gate only while DEFCON is raised, and once more after a refusal the last answer did not expect", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                const gates = () =>
                    b.calls
                        .filter((call) => call.method === "gate")
                        .map((call) => (call.input as ModerationGateRequest).actor.isOwner)
                yield* emit(bot, "!defcon status")
                // DEFCON 3 admits the command without the author's authority, so only the handler reads the author
                assert.deepEqual(gates(), [false])
                assert.equal(p.actor.requests().length, 1)
                // A level raised without the bot's knowledge refuses the first gate, and the author's authority then decides
                b.current.defcon = 1
                yield* emit(bot, "!defcon status")
                assert.deepEqual(gates(), [false, false, true])
                yield* emit(bot, "!defcon status")
                assert.deepEqual(gates(), [false, false, true, true])
                assert.equal(bodies(p).length, 3)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("at DEFCON 1 the owner still gets the recovery inbox and a preset's own refusal", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.defcon = 1
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, "!recovery")
                yield* emit(bot, "!preset list")
                // Without stores both handlers still answer, which a public or staff command could not do at DEFCON 1
                assert.equal(bodies(p).length, 2)
                yield* emit(bot, "!ping")
                assert.equal(bodies(p).length, 2)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("DEFCON 2 still answers the owner's manager commands and settings changes", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.defcon = 2
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                const commands = ["!health", "!setup", "!stats", "!prefix", "!prefix ?", "!replies", "!nickname"]
                for (const command of commands) yield* emit(bot, command)
                assert.equal(bodies(p).length, commands.length)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("DEFCON 2 allows security role lock with ManageRoles alone and the executor preserves unrelated overwrite bits", async () => {
    const f = createFixtures()
    let request: ModerationManageRequest | undefined
    const b = boundary({
        manage: (input) => {
            request = input
            return Effect.succeed(
                caseGrant(input, {
                    ownedPermissions: Permissions.SendMessages.toString(),
                    overwrite: { exists: true, allow: "0", deny: Permissions.SendMessages.toString() },
                    expectedOverwrite: { exists: false, allow: "0", deny: "0" },
                }),
            )
        },
    })
    b.current.defcon = 2
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
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
            }),
        ),
    )
})

test("a warning remains successful when the log acknowledgement is lost and its independently reserved private notice still sends", async () => {
    const f = createFixtures()
    const outcomes: ModerationOutcomeRequest[] = []
    const notices: ModerationNoticeOutcomeRequest[] = []
    let targetId = ""
    const b = boundary({
        manage: (input) => Effect.succeed(caseGrant(input)),
        outcome: (input) => {
            outcomes.push(input)
            return Effect.succeed({
                recorded: true,
                log: {
                    logId: input.actionId,
                    caseNo: input.caseNo,
                    channelId: f.ids.channel,
                    action: "warn",
                    outcome: "succeeded",
                    targetId,
                    reason: "private reason",
                },
                notice: { noticeId: input.actionId, caseNo: input.caseNo, targetId, reason: "private reason" },
            })
        },
        logOutcome: () => Effect.fail(new ModerationStoreError({ operation: "log-outcome", status: null })),
        noticeOutcome: (input) => {
            notices.push(input)
            return Effect.succeed({ recorded: true })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                targetId = p.targetId
                yield* bot.ready()
                yield* emit(bot, `!mod warn <@${targetId}> private reason`)
                assert.equal(outcomes[0]?.outcome, "succeeded")
                assert.equal(notices[0]?.outcome, "sent")
                assert.equal(p.open.requests().length, 1)
                const [log, notice, reply] = bodies(p)
                assert.deepEqual(log!.embeds, [
                    {
                        color: 0x5560e6,
                        title: "Case #1: Warning",
                        fields: [
                            { name: "Result", value: "Done" },
                            { name: "Member", value: `<@${targetId}>` },
                            { name: "By", value: `<@${f.ids.user}>` },
                            { name: "Details", value: "`!mod show 1`, sent by DM" },
                        ],
                    },
                ])
                assert.ok(!shown(log).includes("private reason"))
                assert.deepEqual(notice!.embeds, [
                    {
                        color: 0x5560e6,
                        title: "Warning, case #1",
                        description: "private reason",
                        fields: [
                            { name: "Appeal", value: "Reply here with `!appeal submit 1 <your reason>`" },
                            { name: "Your cases", value: "Reply here with `!appeal cases`" },
                        ],
                    },
                ])
                assert.equal(
                    reply!.content,
                    `Case #1: Warning of <@${targetId}> succeeded. The staff log or the member's notice may not have arrived, and NeonFlux does not send them again`,
                )
                for (const body of bodies(p)) assert.deepEqual(body.allowed_mentions, safeMentions)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("private warning delivery rejection records an uncertain notice without changing the durable warning outcome", async () => {
    const f = createFixtures()
    let targetId = ""
    let actionOutcome = ""
    let noticeOutcome = ""
    const b = boundary({
        manage: (input) => Effect.succeed(caseGrant(input)),
        outcome: (input) => {
            actionOutcome = input.outcome
            return Effect.succeed({
                recorded: true,
                notice: { noticeId: input.actionId, caseNo: input.caseNo, targetId, reason: "reason" },
            })
        },
        noticeOutcome: (input) => {
            noticeOutcome = input.outcome
            return Effect.succeed({ recorded: true })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                targetId = p.targetId
                bot.rest.respond(`POST /channels/${p.dmId}/messages`, {
                    status: 403,
                    body: { code: "MISSING_ACCESS", message: "synthetic private body" },
                })
                yield* bot.ready()
                yield* emit(bot, `!mod warn ${targetId} reason`)
                assert.equal(actionOutcome, "succeeded")
                assert.equal(noticeOutcome, "uncertain")
                assert.match(bodies(p).at(-1)!.content, /^Case #1: Warning of <@\d+> succeeded$/)
            }),
        ),
    )
})

test("temporary ban uses the native duration and ASCII audit metadata while preserving a Unicode reason and provider expiry", async () => {
    const f = createFixtures()
    const outcomes: ModerationOutcomeRequest[] = []
    const b = boundary({
        manage: (input) => Effect.succeed(caseGrant(input)),
        outcome: (input) => {
            outcomes.push(input)
            return Effect.succeed({ recorded: true })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                const bans = bot.rest.respond("PUT /guilds/:id/bans/:id", { status: 204 })
                const expires = "2026-10-05T00:00:00.000Z"
                bot.rest.respond("GET /guilds/:id/bans", {
                    body: [
                        {
                            user: bot.fixtures.user({ id: p.targetId }),
                            moderator_id: f.ids.user,
                            banned_at: "2026-10-04T00:00:00.000Z",
                            reason: "É",
                            expires_at: expires,
                        },
                    ],
                })
                yield* bot.ready()
                yield* emit(bot, `!mod ban ${p.targetId} 1d ${"É".repeat(512)}`)
                assert.equal(bans.requests().length, 1)
                const request = bans.requests()[0]!
                assert.equal((request.body as { ban_duration_seconds?: number }).ban_duration_seconds, 86400)
                assert.equal((request.body as { reason: string }).reason.length, 512)
                assert.ok(/^[\x20-\x7e]+$/.test(decodeURIComponent(String(request.headers["x-audit-log-reason"]))))
                assert.equal(outcomes[0]?.outcome, "succeeded")
                assert.equal(outcomes[0]?.banExpiresAt, expires)
                // The reply says how long the ban lasts, so a permanent one cannot pass for a temporary one
                assert.match(bodies(p).at(-1)!.content, /^Case #\d+: Ban of <@\d+> for 1 day succeeded/)
                yield* emit(bot, `!mod ban ${p.targetId} no length given`)
                assert.equal(bans.requests().length, 2)
                assert.equal((bans.requests()[1]!.body as { ban_duration_seconds?: number }).ban_duration_seconds, 0)
                assert.match(bodies(p).at(-1)!.content, /^Case #\d+: Permanent ban of <@\d+> succeeded/)
            }),
        ),
    )
})

test("fresh permission downgrade, channel overwrite denial and protected targets prevent native sanctions", async () => {
    for (const scenario of ["downgrade", "protected", "channel"] as const) {
        const f = createFixtures()
        const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot, {
                        actorOwner: false,
                        actorPermissions:
                            scenario === "downgrade" ? 0n : Permissions.ManageChannels | Permissions.KickMembers,
                        botPermissions: Permissions.ManageChannels | Permissions.KickMembers,
                        ...(scenario === "protected" ? { targetPermissions: Permissions.Administrator } : {}),
                        ...(scenario === "channel" ? { channelDeny: Permissions.ManageChannels } : {}),
                    })
                    const kick = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
                    const edit = bot.rest.respond("PATCH /channels/:id", { body: bot.fixtures.channel() })
                    yield* bot.ready()
                    yield* emit(
                        bot,
                        scenario === "channel"
                            ? `!mod slowmode ${f.ids.channel} 10 reason`
                            : `!mod kick ${p.targetId} reason`,
                    )
                    assert.equal(kick.requests().length, 0)
                    assert.equal(edit.requests().length, 0)
                    const outcome = b.calls.find((call) => call.method === "outcome")?.input as ModerationOutcomeRequest
                    assert.equal(outcome?.outcome, "failed")
                }),
            ),
        )
    }
})

test("voiding a case confirms the void instead of reporting its log case", async () => {
    const f = createFixtures()
    const b = boundary({
        manage: (input) =>
            input.operation.type === "case-void"
                ? Effect.succeed(
                      caseGrant({
                          ...input,
                          operation: {
                              type: "action",
                              action: { type: "log", targetId: f.ids.user, reason: "Case 5 voided", linkedCaseNo: 5 },
                              context: {
                                  botId: f.ids.bot,
                                  botActionAuthorized: true,
                                  actorCanManageTarget: true,
                                  botCanManageTarget: true,
                                  targetProtected: false,
                                  currentTimeoutUntil: null,
                              },
                          },
                      }),
                  )
                : Effect.die("Synthetic void required"),
        outcome: () => Effect.succeed({ recorded: true }),
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, "!mod void 5")
                assert.equal(bodies(p).at(-1)!.content, "Case #5 voided. Logged as case #1")
            }),
        ),
    )
})

test("a command never kicks another bot and records no case", async () => {
    const f = createFixtures()
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot, { targetIsBot: true })
                const kick = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
                yield* bot.ready()
                yield* emit(bot, `!mod kick ${p.targetId} reason`)
                assert.equal(kick.requests().length, 0)
                assert.equal(b.calls.filter((call) => call.method === "manage").length, 0)
                assert.equal(bodies(p).at(-1)!.content, "NeonFlux never moderates other bots")
            }),
        ),
    )
})

test("a command aimed at NeonFlux itself gets the protected target answer", async () => {
    const f = createFixtures()
    const b = boundary({
        manage: () =>
            Effect.fail(new ModerationStoreError({ operation: "manage", status: 403, code: "TARGET_PROTECTED" })),
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, `!mod kick ${f.ids.bot} reason`)
                assert.equal(
                    bodies(p).at(-1)!.content,
                    "NeonFlux never acts on itself, the server owner, Administrators or the member who sent the command",
                )
            }),
        ),
    )
})

test("release links its owned recovery and preserves a changed or still stronger timeout", async () => {
    for (const state of ["changed", "prior-future", "clear"] as const) {
        const f = createFixtures()
        const expected = "2099-01-01T00:00:00.000Z"
        let managed: ModerationManageRequest | undefined
        const b = boundary({
            query: () =>
                Effect.succeed({
                    type: "recovery",
                    recovery: {
                        recoveryId: "owned_recovery",
                        generation: 3,
                        type: "timeout",
                        caseNo: 7,
                        status: "active",
                        targetId: f.ids.user,
                        createdAt: 1_700_000_000_000,
                        expectedTimeoutUntil: expected,
                    },
                }),
            manage: (input) => {
                managed = input
                return Effect.succeed(
                    caseGrant(input, {
                        expectedTimeoutUntil: expected,
                        restoreTimeoutUntil: state === "prior-future" ? expected : null,
                        recoveryId: "owned_recovery",
                    }),
                )
            },
        })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot)
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                        body: bot.fixtures.member({
                            user: bot.fixtures.user({ id: p.targetId }),
                            roles: [p.targetRole.id],
                            communication_disabled_until: state === "changed" ? "2099-02-01T00:00:00.000Z" : expected,
                        }),
                    })
                    const writes = bot.rest.respond("PATCH /guilds/:id/members/:id", {
                        body: bot.fixtures.member({
                            user: bot.fixtures.user({ id: p.targetId }),
                            communication_disabled_until: null,
                        }),
                    })
                    yield* bot.ready()
                    yield* emit(bot, `!security release ${p.targetId} reason`)
                    assert.equal(managed?.operation.type, "action")
                    if (managed?.operation.type === "action") {
                        assert.equal(managed.operation.action.linkedCaseNo, 7)
                        assert.equal(managed.operation.context.recoveryGeneration, 3)
                    }
                    assert.equal(writes.requests().length, state === "clear" ? 1 : 0)
                    const outcome = b.calls.find((call) => call.method === "outcome")?.input as ModerationOutcomeRequest
                    assert.equal(outcome.outcome, state === "clear" ? "succeeded" : "failed")
                }),
            ),
        )
    }
})

test("quarantine refuses a stronger existing timeout and untimeout checks its expected snapshot", async () => {
    const f = createFixtures()
    const b = boundary({
        manage: (input) =>
            Effect.succeed(
                caseGrant(input, {
                    expectedTimeoutUntil:
                        input.operation.type === "action" && input.operation.action.type === "quarantine"
                            ? "2099-01-01T00:00:00.000Z"
                            : null,
                }),
            ),
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: p.targetId }),
                        roles: [p.targetRole.id],
                        communication_disabled_until: "2099-01-01T00:00:00.000Z",
                    }),
                })
                const writes = bot.rest.respond("PATCH /guilds/:id/members/:id", { body: bot.fixtures.member() })
                yield* bot.ready()
                yield* emit(bot, `!security quarantine ${p.targetId} 10m reason`)
                yield* emit(bot, `!mod untimeout ${p.targetId} reason`)
                assert.equal(writes.requests().length, 0)
                assert.deepEqual(
                    b.calls
                        .filter((call) => call.method === "outcome")
                        .map((call) => (call.input as ModerationOutcomeRequest).outcome),
                    ["failed", "failed"],
                )
            }),
        ),
    )
})

test("case lists stay compact, details include actor audits, and private narratives never reach the invoking guild channel", async () => {
    const f = createFixtures()
    const record: ModerationCase = {
        ...caseGrant({
            serverId: f.ids.guild,
            messageId: f.nextId(),
            createdAt: 1_700_000_000_000,
            actor: {
                userId: f.ids.user,
                roleIds: [],
                isOwner: true,
                isAdministrator: false,
                nativePermissionAuthorized: true,
            },
            operation: {
                type: "action",
                action: { type: "warn", targetId: f.ids.user, reason: "private narrative" },
                context: {
                    botId: f.ids.bot,
                    botActionAuthorized: true,
                    actorCanManageTarget: true,
                    botCanManageTarget: true,
                    targetProtected: false,
                },
            },
        }).case,
        corrections: Array.from({ length: 20 }, () => ({
            type: "reason",
            actorId: f.ids.user,
            createdAt: 1_700_000_000_000,
            previousReason: "x".repeat(512),
            reason: "y".repeat(512),
        })),
    }
    const lists: ModerationQueryOperation[] = []
    const b = boundary({
        query: (input) => {
            if (input.operation.type === "case-list") lists.push(input.operation)
            return Effect.succeed(
                input.operation.type === "case-list"
                    ? {
                          type: "cases",
                          cases: Array.from({ length: 10 }, (_, i) => ({ ...record, caseNo: 20 - i })),
                          nextBeforeCaseNo: 11,
                      }
                    : { type: "case", case: record },
            )
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, `!mod list <@${f.ids.user}>`)
                assert.equal(p.replies.requests().length, 2)
                const list = bodies(p)[0]!.embeds![0]!
                assert.equal(list.title, "Cases")
                assert.equal(
                    list.description!.split("\n")[0],
                    `**#20** Warning of <@${f.ids.user}> by <@${f.ids.user}>, in progress, <t:1700000000:R>`,
                )
                assert.deepEqual(list.fields, [
                    { name: "Details", value: "`!mod show <case>`" },
                    { name: "Next", value: `\`!mod list ${f.ids.user} next\`` },
                ])
                assert.ok(!shown(bodies(p)[0]).includes("private narrative"))
                assert.equal(bodies(p)[1]!.content, "Details sent by DM")
                // next continues the same member's list from where the last page ended. The unfiltered list has no page to continue
                yield* emit(bot, "!mod list next")
                assert.equal(
                    bodies(p).at(-1)!.content,
                    "There is no next page to show. Send !mod list to start the list again",
                )
                yield* emit(bot, `!mod list ${f.ids.user} next`)
                assert.deepEqual(lists, [
                    { type: "case-list", userId: f.ids.user },
                    { type: "case-list", userId: f.ids.user, beforeCaseNo: 11 },
                ])
                yield* emit(bot, "!mod show 1")
                const privateBodies = p.replies
                    .requests()
                    .filter((request) => request.path.includes(p.dmId))
                    .map((request) => request.body as Body)
                const detail = privateBodies.find((body) => body.embeds?.[0]?.title === "Case #1: Warning")!.embeds![0]!
                // A case shows its reason and four facts, and counts its edits with the command that lists them
                assert.equal(detail.description, "private narrative\nEdited 20 times. `!mod history 1`")
                assert.deepEqual(
                    detail.fields!.map((x) => [x.name, x.value]),
                    [
                        ["Result", "In progress"],
                        ["Member", `<@${f.ids.user}>`],
                        ["By", `<@${f.ids.user}>`],
                        ["When", "<t:1700000000:R>"],
                    ],
                )
                assert.ok(!privateBodies.map(shown).join("\n").includes("x".repeat(512)))
                // The history pages the edits by DM, ten at a time
                const history = (content: string) =>
                    Effect.gen(function* () {
                        const before = p.replies.requests().length
                        yield* emit(bot, content)
                        const sent = p.replies.requests().slice(before),
                            embeds = sent
                                .filter((request) => request.path.includes(p.dmId))
                                .flatMap((request) => (request.body as Body).embeds ?? [])
                        return {
                            embeds,
                            inServer: sent
                                .filter((request) => !request.path.includes(p.dmId))
                                .map((request) => (request.body as Body).content),
                        }
                    })
                const first = yield* history("!mod history 1")
                assert.equal(first.embeds[0]!.title, "Case #1 history")
                // Long edits split the page across embeds at line breaks
                const edits = (embeds: readonly Embed[]) =>
                    embeds
                        .map((e) => e.description ?? "")
                        .join("\n")
                        .split("\n")
                        .filter(Boolean)
                const lines = edits(first.embeds)
                assert.equal(lines.length, 10)
                assert.equal(
                    lines[0],
                    `Reason changed by <@${f.ids.user}> <t:1700000000:R>: ${"x".repeat(512)} → ${"y".repeat(512)}`,
                )
                assert.deepEqual(
                    first.embeds.flatMap((e) => e.fields ?? []),
                    [{ name: "Next", value: "`!mod history 1 next`" }],
                )
                assert.deepEqual(first.inServer, ["Details sent by DM"])
                const second = yield* history("!mod history 1 next")
                assert.equal(edits(second.embeds).length, 10)
                assert.deepEqual(
                    second.embeds.flatMap((e) => e.fields ?? []),
                    [],
                )
                assert.deepEqual((yield* history("!mod history 1 next")).inServer, [
                    "There is no next page to show. Send !mod history 1 to start the list again",
                ])
                for (const request of p.replies.requests()) {
                    const body = request.body as Body
                    assert.ok((body.content ?? "").length <= 1900)
                    if (request.path.includes(f.ids.channel))
                        assert.equal(shown(body).includes("private narrative"), false)
                }
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("banned users can discover and appeal their own cases in a verified DM without membership reads, while groups are rejected", async () => {
    const f = createFixtures()
    const memberCalls: AppealMemberRequest[] = []
    const b = boundary({
        memberAppeal: (input) => {
            memberCalls.push(input)
            return Effect.succeed(
                input.operation.type === "cases"
                    ? {
                          duplicate: false,
                          type: "cases",
                          cases: [
                              {
                                  caseNo: 2,
                                  action: "ban",
                                  outcome: "succeeded",
                                  createdAt: 1_700_000_000_000,
                                  reason: "Own ban",
                              },
                          ],
                          ...(input.operation.beforeCaseNo ? {} : { nextBeforeCaseNo: 2 }),
                      }
                    : {
                          duplicate: false,
                          type: "appeal",
                          appeal: {
                              appealNo: 1,
                              caseNo: 2,
                              userId: input.requesterId,
                              text: "Please review",
                              createdAt: 1_700_000_000_000,
                              status: "open",
                              erased: false,
                          },
                      },
            )
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const dmId = bot.fixtures.nextId()
                const dm = { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null }
                bot.rest.respond(`GET /channels/${dmId}`, { body: dm })
                const replies = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2] }),
                }))
                yield* bot.ready()
                yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
                assert.deepEqual((replies.requests()[0]!.body as Body).embeds, [
                    {
                        color: 0x5560e6,
                        title: "Cases you can appeal",
                        description: "**Case #2** Ban, <t:1700000000:R>: Own ban",
                        fields: [
                            { name: "Appeal", value: "`!appeal submit <case> <your reason>`" },
                            { name: "Next", value: "`!appeal cases next`" },
                        ],
                    },
                ])
                yield* emit(bot, "!appeal cases next", { guild_id: undefined, channel_id: dmId })
                assert.doesNotMatch(shown(replies.requests()[1]!.body), /Next/)
                yield* emit(bot, "!appeal submit 2 Please review, I didn't post that link", {
                    guild_id: undefined,
                    channel_id: dmId,
                })
                assert.deepEqual(
                    memberCalls.map((input) => input.operation),
                    [
                        { type: "cases" },
                        { type: "cases", beforeCaseNo: 2 },
                        { type: "submit", caseNo: 2, text: "Please review, I didn't post that link" },
                    ],
                )
                assert.ok(
                    memberCalls.every((input) => input.requesterId === f.ids.user && input.privateChannelVerified),
                )
                assert.ok(
                    b.calls
                        .filter((call) => call.method === "gate")
                        .every((call) => (call.input as ModerationGateRequest).command === "appeal"),
                )
                const group = bot.rest.respond(`GET /channels/${dmId}`, {
                    body: {
                        ...dm,
                        type: 3,
                        owner_id: f.ids.user,
                        recipients: [bot.fixtures.user(), bot.fixtures.user({ id: bot.fixtures.nextId() })],
                    },
                })
                yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
                assert.equal(memberCalls.length, 3)
                assert.equal(replies.requests().length, 3)
                assert.equal(group.requests().length, 1)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("!appeal cases says a page has no appealable cases while older cases follow, and next finds them", async () => {
    const f = createFixtures()
    const operations: AppealMemberRequest["operation"][] = []
    // The backend ends a page early after a long run of newer automod log cases, as it does past 200 of them
    const b = boundary({
        memberAppeal: (input) => {
            operations.push(input.operation)
            return Effect.succeed(
                input.operation.type === "cases" && input.operation.beforeCaseNo === undefined
                    ? { duplicate: false, type: "cases", cases: [], nextBeforeCaseNo: 2 }
                    : {
                          duplicate: false,
                          type: "cases",
                          cases: [
                              {
                                  caseNo: 1,
                                  action: "warn",
                                  outcome: "succeeded",
                                  createdAt: 1_700_000_000_000,
                                  reason: "Older warning",
                              },
                          ],
                      },
            )
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const dmId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null },
                })
                const replies = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2] }),
                }))
                yield* bot.ready()
                yield* emit(bot, "!appeal cases", { guild_id: undefined, channel_id: dmId })
                assert.deepEqual((replies.requests()[0]!.body as Body).embeds, [
                    {
                        color: 0x5560e6,
                        title: "Cases you can appeal",
                        description: "No appealable cases on this page",
                        fields: [{ name: "Next", value: "`!appeal cases next`" }],
                    },
                ])
                yield* emit(bot, "!appeal cases next", { guild_id: undefined, channel_id: dmId })
                assert.match(shown(replies.requests()[1]!.body), /Case #1\*\* Warning, <t:1700000000:R>: Older warning/)
                assert.deepEqual(operations, [{ type: "cases" }, { type: "cases", beforeCaseNo: 2 }])
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("enabled protection supplies fresh native context for creates and edits and a blocked duplicate cannot reply publicly", async () => {
    const f = createFixtures()
    const evaluations: ModerationEvaluateRequest[] = []
    const b = boundary({
        evaluate: (input) => {
            evaluations.push(input)
            return Effect.succeed({ duplicate: evaluations.length > 1, blocked: true })
        },
    })
    b.current.automodEnabled = true
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                const message = bot.fixtures.message({
                    content: "!ping",
                    mention_roles: [p.actorRole.id],
                    mention_everyone: true,
                })
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* bot.idle()
                yield* bot.emit("MESSAGE_UPDATE", {
                    ...message,
                    content: "edited",
                    edited_timestamp: "2026-10-04T01:00:00.000Z",
                })
                yield* bot.idle()
                assert.deepEqual(
                    evaluations.map((input) => input.event),
                    ["create", "edit"],
                )
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
            }),
        ),
    )
})

test("unknown native action transport records uncertain once, and a duplicate source cannot replay the action", async () => {
    const f = createFixtures()
    const seen = new Set<string>()
    const b = boundary({
        manage: (input) => {
            if (seen.has(input.messageId)) return Effect.succeed({ duplicate: true })
            seen.add(input.messageId)
            return Effect.succeed(caseGrant(input))
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                const writes = bot.rest.respond("DELETE /guilds/:id/members/:id", () => {
                    throw new TypeError("synthetic transport loss")
                })
                yield* bot.ready()
                const message = bot.fixtures.message({ content: `!mod kick ${p.targetId} reason` })
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* bot.idle()
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* bot.idle()
                assert.equal(writes.requests().length, 1)
                assert.equal(
                    (b.calls.find((call) => call.method === "outcome")!.input as ModerationOutcomeRequest).outcome,
                    "uncertain",
                )
                assert.equal(p.replies.requests().length, 1)
                assert.match(
                    bodies(p)[0]!.content,
                    /^Case #1: Kick of <@\d+> is not confirmed yet\. Run `!mod recover 1` to check it$/,
                )
            }),
        ),
    )
})

test("serialized management precedes a queued protective evaluation using barriers instead of elapsed time", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>()
                const release = yield* Deferred.make<void>()
                const order: string[] = []
                const b = boundary({
                    manage: () =>
                        Effect.gen(function* () {
                            order.push("manage-start")
                            yield* Deferred.succeed(entered, undefined)
                            yield* Deferred.await(release)
                            b.current.automodEnabled = true
                            order.push("manage-end")
                            return { duplicate: false, type: "settings", settings: b.current }
                        }),
                    evaluate: () =>
                        Effect.sync(() => {
                            order.push("evaluate")
                            return { duplicate: false, blocked: false }
                        }),
                })
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                platform(bot)
                yield* bot.ready()
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!automod module on" }))
                yield* Deferred.await(entered)
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "ordinary" }))
                assert.deepEqual(order, ["manage-start"])
                yield* Deferred.succeed(release, undefined)
                yield* bot.idle()
                assert.deepEqual(order, ["manage-start", "manage-end", "evaluate"])
            }),
        ),
    )
})

test("shutdown interruption leaves a reserved native action unresolved without a false acknowledgement or replay", async () => {
    const f = createFixtures()
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>()
                const release = yield* Deferred.make<void>()
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
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
                assert.equal(
                    b.calls.some((call) => call.method === "outcome"),
                    false,
                )
                assert.equal(p.replies.requests().length, 0)
                assert.equal(bot.client.state, "Closed")
            }),
        ),
    )
})

test("bots, webhooks, system messages and unrelated servers never enter moderation", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                yield* bot.ready()
                const baseline = b.calls.length
                for (const overrides of [
                    { author: bot.fixtures.botUser() },
                    { webhook_id: bot.fixtures.nextId() },
                    { type: MessageType.ChannelPinnedMessage },
                    { guild_id: bot.fixtures.nextId() },
                ])
                    yield* emit(bot, "!mod status", overrides)
                assert.equal(b.calls.length, baseline)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("native management with free-text reasons exposes complete settings, rules, watchlist, security and appeal configuration flows", async () => {
    const f = createFixtures()
    const managed: ModerationManageRequest[] = []
    const b = boundary({
        manage: (input) => {
            managed.push(input)
            if (input.operation.type === "settings") {
                Object.assign(b.current, input.operation.patch)
                return Effect.succeed({ duplicate: false, type: "settings", settings: b.current })
            }
            if (input.operation.type === "rule-create")
                return Effect.succeed({ duplicate: false, type: "rule", rule: input.operation.rule })
            return Effect.succeed({ duplicate: true })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                const commands = [
                    "!mod module off",
                    "!mod module on",
                    `!mod staff security <@&${p.actorRole.id}>`,
                    `!logs channel <#${f.ids.channel}>`,
                    "!logs channel off",
                    '!automod create badwords words warn "literal phrase"',
                    '!automod update badwords patterns "different phrase"',
                    "!automod update badwords threshold 2",
                    "!automod update badwords window 30",
                    "!automod update badwords duration 10m",
                    "!automod update badwords priority -5",
                    "!automod update badwords action timeout",
                    "!automod update badwords domain-mode allow",
                    `!automod update badwords channels <#${f.ids.channel}>`,
                    `!automod update badwords exempt-channels <#${f.ids.channel}>`,
                    `!automod update badwords exempt-roles <@&${p.actorRole.id}>`,
                    "!automod disable badwords",
                    "!automod enable badwords",
                    "!automod delete badwords",
                    "!automod mode enforce",
                    "!automod module off",
                    `!security watchlist add ${p.targetId} private watch note`,
                    `!security watchlist update ${p.targetId} replacement note`,
                    `!security watchlist remove ${p.targetId}`,
                    `!security honeypot add <#${f.ids.channel}>`,
                    `!security honeypot remove <#${f.ids.channel}>`,
                    "!security honeypot module on",
                    "!security honeypot module off",
                    "!security joins threshold 5",
                    "!security joins window 30",
                    "!security joins raid-mode defcon2",
                    "!security joins module on",
                    "!security joins module off",
                    "!security watchlist module on",
                    "!security watchlist module off",
                    "!security mode enforce",
                    "!security module off",
                    "!appeal module off",
                    "!appeal module on",
                    "!defcon set 2",
                    "!defcon set 1",
                    "!defcon set 3",
                    "!mod erase 1",
                    "!mod reason 1 fixed reason",
                    "!mod void 1",
                ]
                for (const command of commands) yield* emit(bot, command)
                assert.equal(managed.length, commands.length)
                assert.ok(managed.every((input) => input.actor.isOwner && input.createdAt > 0))
                assert.ok(
                    managed.some(
                        (input) =>
                            input.operation.type === "rule-create" &&
                            input.operation.rule.patterns[0] === "literal phrase",
                    ),
                )
                assert.ok(
                    managed.some(
                        (input) =>
                            input.operation.type === "watchlist-add" && input.operation.reason === "replacement note",
                    ),
                )
                assert.ok(
                    managed.some(
                        (input) => input.operation.type === "case-reason" && input.operation.reason === "fixed reason",
                    ),
                )
                const count = managed.length
                // Typed page numbers, a link to a case without a reason and an extra word after a case number are not forms of these commands
                const malformed = [
                    "!mod module sometimes",
                    "!mod erase @someone",
                    "!security watchlist list invalid",
                    "!automod update badwords threshold 0",
                    "!mod ban 123456789012345679 1s reason",
                    "!automod list 2",
                    "!security recovery list 2",
                    "!mod warn 123456789012345679 case 4",
                    "!mod void 1 now",
                    '!mod warn 123456789012345679 "unclosed',
                ]
                for (const command of malformed) yield* emit(bot, command)
                assert.equal(managed.length, count)
                assert.ok(
                    bodies(p)
                        .slice(-malformed.length, -1)
                        .every((body) => /Check quoting/.test(body.content)),
                )
                assert.equal(
                    bodies(p).at(-1)?.content,
                    "A double quote was opened but never closed. Use !mod help for examples",
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("honeypot add and remove check only the named channel, so a deleted stored channel does not block them", async () => {
    const f = createFixtures()
    const managed: ModerationManageRequest[] = []
    const b = boundary({
        manage: (input) => {
            managed.push(input)
            if (input.operation.type !== "settings") return Effect.succeed({ duplicate: true })
            Object.assign(b.current, input.operation.patch)
            return Effect.succeed({ duplicate: false, type: "settings", settings: b.current })
        },
    })
    // Neither channel exists any more, so reading either one fails
    b.current.honeypotChannelIds = ["123456789012345671", "123456789012345672"]
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                platform(bot)
                yield* bot.ready()
                yield* emit(bot, `!security honeypot add <#${f.ids.channel}>`)
                yield* emit(bot, "!security honeypot remove 123456789012345671")
                assert.deepEqual(
                    managed.map((input) => input.operation.type === "settings" && input.operation.patch),
                    [
                        { honeypotChannelIds: ["123456789012345671", "123456789012345672", f.ids.channel] },
                        { honeypotChannelIds: ["123456789012345672", f.ids.channel] },
                    ],
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("ordinary uncertain case recovery observes current state without resending the sanction", async () => {
    const f = createFixtures()
    const queried: ModerationQueryRequest[] = []
    const observations: ModerationReconcileRequest[] = []
    let record: ModerationCase
    const b = boundary({
        query: (input) => {
            queried.push(input)
            return Effect.succeed({ type: "case", case: record })
        },
        reconcile: (input) => {
            observations.push(input)
            return Effect.succeed({ recorded: true, case: { ...record, observation: input.observation } })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                record = {
                    ...caseGrant({
                        serverId: f.ids.guild,
                        messageId: bot.fixtures.nextId(),
                        createdAt: 1_700_000_000_000,
                        actor: {
                            userId: f.ids.user,
                            roleIds: [],
                            isOwner: true,
                            isAdministrator: true,
                            nativePermissionAuthorized: true,
                        },
                        operation: {
                            type: "action",
                            action: { type: "kick", targetId: p.targetId, reason: "original" },
                            context: {
                                botId: f.ids.bot,
                                botActionAuthorized: true,
                                actorCanManageTarget: true,
                                botCanManageTarget: true,
                                targetProtected: false,
                            },
                        },
                    }).case,
                    outcome: "uncertain",
                }
                const writes = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
                yield* bot.ready()
                yield* emit(bot, "!mod recover 1")
                yield* emit(bot, "!security recover 1")
                assert.deepEqual(
                    queried.map((input) => input.operation.type),
                    ["case-show", "recovery-case"],
                )
                assert.ok(
                    observations.every(
                        (input) => input.privateChannelVerified && input.observation.memberPresent === true,
                    ),
                )
                assert.equal(writes.requests().length, 0)
                assert.equal(
                    b.calls.some((call) => call.method === "manage" || call.method === "outcome"),
                    false,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("observed human joins reach enabled security with fresh identity while bot joins and disabled joins are excluded", async () => {
    const f = createFixtures()
    const joins: ModerationJoinRequest[] = []
    const b = boundary({
        join: (input) => {
            joins.push(input)
            return Effect.succeed({ duplicate: false, settings: b.current })
        },
    })
    b.current.securityEnabled = true
    b.current.joinEnabled = true
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId }) })
                yield* bot.ready()
                const member = bot.fixtures.member({
                    user: bot.fixtures.user({ id: p.targetId }),
                    roles: [p.targetRole.id],
                })
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
            }),
        ),
    )
})

test("recovery writes re-read the target and channel after the reservation instead of reusing the command snapshot", async () => {
    for (const action of ["release", "unlock"] as const) {
        const f = createFixtures()
        const expected = "2099-01-01T00:00:00.000Z"
        const b = boundary({
            query: () =>
                Effect.succeed({
                    type: "recovery",
                    recovery:
                        action === "release"
                            ? {
                                  recoveryId: "owned_recovery",
                                  generation: 3,
                                  type: "timeout",
                                  caseNo: 7,
                                  status: "active",
                                  targetId: f.ids.user,
                                  createdAt: 1_700_000_000_000,
                                  expectedTimeoutUntil: expected,
                              }
                            : {
                                  recoveryId: "owned_lock",
                                  generation: 2,
                                  type: "lock",
                                  caseNo: 4,
                                  status: "active",
                                  channelId: f.ids.channel,
                                  createdAt: 1_700_000_000_000,
                              },
                }),
            manage: (input) =>
                Effect.succeed(
                    caseGrant(
                        input,
                        action === "release"
                            ? {
                                  expectedTimeoutUntil: expected,
                                  restoreTimeoutUntil: null,
                                  recoveryId: "owned_recovery",
                              }
                            : {
                                  recoveryId: "owned_lock",
                                  ownedPermissions: Permissions.SendMessages.toString(),
                                  expectedOverwrite: {
                                      exists: true,
                                      allow: "0",
                                      deny: Permissions.SendMessages.toString(),
                                  },
                                  overwrite: { exists: false, allow: "0", deny: "0" },
                              },
                    ),
                ),
        })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot)
                    // Staff replace the timeout or add an unrelated overwrite bit after the command's authority read
                    let memberReads = 0
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: bot.fixtures.member({
                            user: bot.fixtures.user({ id: p.targetId }),
                            roles: [p.targetRole.id],
                            communication_disabled_until: ++memberReads === 1 ? expected : "2099-02-01T00:00:00.000Z",
                        }),
                    }))
                    let channelReads = 0
                    bot.rest.respond(`GET /channels/${f.ids.channel}`, () => ({
                        body: bot.fixtures.channel({
                            permission_overwrites: [
                                {
                                    id: f.ids.guild,
                                    type: 0,
                                    allow: ++channelReads === 1 ? "0" : Permissions.ViewChannel.toString(),
                                    deny: Permissions.SendMessages.toString(),
                                },
                            ],
                        }),
                    }))
                    const clears = bot.rest.respond("PATCH /guilds/:id/members/:id", {
                        body: bot.fixtures.member({
                            user: bot.fixtures.user({ id: p.targetId }),
                            communication_disabled_until: null,
                        }),
                    })
                    const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
                    const removes = bot.rest.respond("DELETE /channels/:id/permissions/:id", { status: 204 })
                    yield* bot.ready()
                    yield* emit(
                        bot,
                        action === "release"
                            ? `!security release ${p.targetId} reason`
                            : `!security unlock ${f.ids.channel} restore chat`,
                    )
                    assert.equal(clears.requests().length, 0)
                    assert.equal(removes.requests().length, 0)
                    if (action === "unlock")
                        assert.deepEqual(sets.requests()[0]!.body, {
                            type: 0,
                            allow: Permissions.ViewChannel.toString(),
                            deny: "0",
                        })
                    else
                        assert.equal(
                            (b.calls.find((call) => call.method === "outcome")?.input as ModerationOutcomeRequest)
                                .outcome,
                            "failed",
                        )
                }),
            ),
        )
    }
})

test("command authority older than 15 seconds aborts before dispatch", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-expired-authority-token" })
                const p = platform(bot)
                const kicks = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
                const grant: ModerationActionGrant = {
                    actionId: "synthetic_case_id",
                    caseNo: 1,
                    sourceId: f.nextId(),
                    action: "kick",
                    reason: "Synthetic reason",
                    targetId: p.targetId,
                }
                const result = yield* performActionGrant(
                    b.store,
                    bot.fixtures.ids.guild,
                    bot.fixtures.ids.user,
                    bot.client,
                    grant,
                    undefined,
                    undefined,
                    Date.now() - 16000,
                )
                assert.equal(result.outcome, "failed")
                assert.equal(result.expired, true)
                assert.equal(kicks.requests().length, 0)
                assert.equal(
                    (b.calls.find((call) => call.method === "outcome")?.input as ModerationOutcomeRequest).outcome,
                    "failed",
                )
            }),
        ),
    )
})

test("unlock restores only its owned SendMessages bit, preserves later unrelated bits, and refuses a changed owned bit", async () => {
    for (const state of ["preserve", "remove", "changed"] as const) {
        const f = createFixtures()
        const b = boundary({
            query: () =>
                Effect.succeed({
                    type: "recovery",
                    recovery: {
                        recoveryId: "owned_lock",
                        generation: 2,
                        type: "lock",
                        caseNo: 4,
                        status: "active",
                        channelId: f.ids.channel,
                        createdAt: 1_700_000_000_000,
                    },
                }),
            manage: (input) =>
                Effect.succeed(
                    caseGrant(input, {
                        recoveryId: "owned_lock",
                        ownedPermissions: Permissions.SendMessages.toString(),
                        expectedOverwrite: { exists: true, allow: "0", deny: Permissions.SendMessages.toString() },
                        overwrite: { exists: false, allow: "0", deny: "0" },
                    }),
                ),
        })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot)
                    bot.rest.respond(`GET /channels/${f.ids.channel}`, {
                        body: bot.fixtures.channel({
                            permission_overwrites: [
                                {
                                    id: f.ids.guild,
                                    type: 0,
                                    allow: state === "preserve" ? Permissions.ViewChannel.toString() : "0",
                                    deny: state === "changed" ? "0" : Permissions.SendMessages.toString(),
                                },
                            ],
                        }),
                    })
                    const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
                    const removes = bot.rest.respond("DELETE /channels/:id/permissions/:id", { status: 204 })
                    yield* bot.ready()
                    yield* emit(bot, `!security unlock ${f.ids.channel} restore chat`)
                    assert.equal(sets.requests().length, state === "preserve" ? 1 : 0)
                    assert.equal(removes.requests().length, state === "remove" ? 1 : 0)
                    if (state === "preserve")
                        assert.deepEqual(sets.requests()[0]!.body, {
                            type: 0,
                            allow: Permissions.ViewChannel.toString(),
                            deny: "0",
                        })
                    assert.match(bodies(p).at(-1)!.content, state === "changed" ? /failed/ : /succeeded/)
                }),
            ),
        )
    }
})

test("lock and unlock grants own the thread bits too and keep unrelated overwrite bits", async () => {
    const owned =
        Permissions.SendMessages |
        Permissions.SendMessagesInThreads |
        Permissions.CreatePublicThreads |
        Permissions.CreatePrivateThreads
    for (const action of ["lock", "unlock"] as const) {
        const f = createFixtures()
        // Before the lock the everyone overwrite explicitly allowed public threads. Staff later allowed ViewChannel
        const before = { exists: true, allow: Permissions.CreatePublicThreads.toString(), deny: "0" }
        const locked = { exists: true, allow: "0", deny: owned.toString() }
        const b = boundary({
            query: () =>
                Effect.succeed({
                    type: "recovery",
                    recovery: {
                        recoveryId: "owned_lock",
                        generation: 2,
                        type: "lock",
                        caseNo: 4,
                        status: "active",
                        channelId: f.ids.channel,
                        createdAt: 1_700_000_000_000,
                    },
                }),
            manage: (input) =>
                Effect.succeed(
                    caseGrant(input, {
                        ownedPermissions: owned.toString(),
                        ...(action === "lock"
                            ? { overwrite: locked, expectedOverwrite: before }
                            : {
                                  recoveryId: "owned_lock",
                                  overwrite: {
                                      exists: true,
                                      allow: (Permissions.ViewChannel | Permissions.CreatePublicThreads).toString(),
                                      deny: "0",
                                  },
                                  expectedOverwrite: { ...locked, allow: Permissions.ViewChannel.toString() },
                              }),
                    }),
                ),
        })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot)
                    const current =
                        action === "lock"
                            ? { allow: Permissions.CreatePublicThreads | Permissions.AddReactions, deny: 0n }
                            : { allow: Permissions.ViewChannel, deny: owned }
                    bot.rest.respond(`GET /channels/${f.ids.channel}`, {
                        body: bot.fixtures.channel({
                            permission_overwrites: [
                                {
                                    id: f.ids.guild,
                                    type: 0,
                                    allow: current.allow.toString(),
                                    deny: current.deny.toString(),
                                },
                            ],
                        }),
                    })
                    const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
                    yield* bot.ready()
                    yield* emit(bot, `!security ${action} ${f.ids.channel} thread safety`)
                    assert.equal(sets.requests().length, 1)
                    assert.deepEqual(
                        sets.requests()[0]!.body,
                        action === "lock"
                            ? { type: 0, allow: Permissions.AddReactions.toString(), deny: owned.toString() }
                            : {
                                  type: 0,
                                  allow: (Permissions.ViewChannel | Permissions.CreatePublicThreads).toString(),
                                  deny: "0",
                              },
                    )
                    assert.match(
                        bodies(p).at(-1)!.content,
                        action === "lock" ? /succeeded.*sending in threads and starting threads/ : /succeeded/,
                    )
                    assert.equal(bot.failures().length, 0)
                }),
            ),
        )
    }
})

test("a lock owns only the thread permissions NeonFlux holds and says which stay open", async () => {
    const f = createFixtures()
    let request: ModerationManageRequest | undefined
    const b = boundary({
        manage: (input) => {
            request = input
            const owned = input.operation.type === "action" ? input.operation.context.botPostingPermissions : undefined
            return Effect.succeed(
                caseGrant(input, {
                    ownedPermissions: owned!,
                    overwrite: { exists: true, allow: "0", deny: owned! },
                    expectedOverwrite: { exists: false, allow: "0", deny: "0" },
                }),
            )
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot, {
                    botPermissions:
                        Permissions.ManageRoles |
                        Permissions.ViewChannel |
                        Permissions.SendMessages |
                        Permissions.SendMessagesInThreads,
                })
                const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
                yield* bot.ready()
                yield* emit(bot, `!security lock ${f.ids.channel} thread safety`)
                const owned = Permissions.SendMessages | Permissions.SendMessagesInThreads
                assert.equal(
                    request?.operation.type === "action" && request.operation.context.botPostingPermissions,
                    owned.toString(),
                )
                // The bot first allows itself the bits the lock denies, so Fluxer lets it lift the lock later
                assert.deepEqual(
                    writes.requests().map((write) => write.body),
                    [
                        { type: 1, allow: owned.toString(), deny: "0" },
                        { type: 0, allow: "0", deny: owned.toString() },
                    ],
                )
                assert.match(
                    bodies(p).at(-1)!.content,
                    /NeonFlux lacks Create public threads, Create private threads in this server, so those stay open/,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("message protection sends a thread's parent channel without another channel read", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.automodEnabled = true
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                const thread = bot.fixtures.thread()
                const reads = bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
                yield* bot.ready()
                yield* emit(bot, "synthetic thread message", { channel_id: thread.id })
                const evaluated = b.calls
                    .filter((call) => call.method === "evaluate")
                    .map((call) => call.input as ModerationEvaluateRequest)
                assert.deepEqual(
                    evaluated.map((input) => [input.channelId, input.parentChannelId]),
                    [[thread.id, f.ids.channel]],
                )
                // The permission read fetched the thread and its parent once each
                assert.equal(reads.requests().length, 1)
                assert.equal(p.channel.requests().length, 1)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("lock and unlock aimed at a thread name its parent and change nothing", async () => {
    for (const action of ["lock", "unlock"] as const) {
        const f = createFixtures()
        const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot)
                    const thread = bot.fixtures.thread()
                    bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
                    const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
                    yield* bot.ready()
                    yield* emit(bot, `!security ${action} ${thread.id} thread safety`)
                    assert.equal(
                        b.calls.some(
                            (call) =>
                                call.method === "manage" ||
                                (call.method === "query" &&
                                    (call.input as ModerationQueryRequest).operation.type === "recovery-channel"),
                        ),
                        false,
                    )
                    assert.equal(writes.requests().length, 0)
                    assert.match(
                        bodies(p).at(-1)!.content,
                        new RegExp(
                            `Threads follow their parent channel's permissions\\. ${action === "lock" ? "Lock" : "Unlock"} <#${f.ids.channel}> instead`,
                        ),
                    )
                    assert.equal(bot.failures().length, 0)
                }),
            ),
        )
    }
})

test("timeout records the actual provider deadline and slowmode compares its fresh prewrite snapshot", async () => {
    const f = createFixtures()
    const until = "2026-10-04T05:00:00.000Z"
    const outcomes: ModerationOutcomeRequest[] = []
    const b = boundary({
        manage: (input) =>
            Effect.succeed(
                caseGrant(
                    input,
                    input.operation.type === "action" && input.operation.action.type === "slowmode"
                        ? { expectedSlowmodeSeconds: 0 }
                        : { expectedTimeoutUntil: null },
                ),
            ),
        outcome: (input) => {
            outcomes.push(input)
            return Effect.succeed({ recorded: true })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                const timeout = bot.rest.respond("PATCH /guilds/:id/members/:id", {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: p.targetId }),
                        communication_disabled_until: until,
                    }),
                })
                const slowmode = bot.rest.respond("PATCH /channels/:id", {
                    body: bot.fixtures.channel({ rate_limit_per_user: 10 }),
                })
                bot.rest.respond(`GET /channels/${f.ids.channel}`, {
                    body: bot.fixtures.channel({ rate_limit_per_user: 0, permission_overwrites: [] }),
                })
                yield* bot.ready()
                yield* emit(bot, `!mod timeout ${p.targetId} 10m reason`)
                assert.match(bodies(p).at(-1)!.content, /^Case #\d+: Timeout of <@\d+> for 10 minutes succeeded/)
                yield* emit(bot, `!mod slowmode ${f.ids.channel} 10 reason`)
                assert.equal(timeout.requests().length, 1)
                assert.equal(outcomes[0]?.timeoutUntil, until)
                assert.equal(slowmode.requests().length, 1)
                assert.deepEqual(slowmode.requests()[0]!.body, { rate_limit_per_user: 10 })
                assert.equal(outcomes[1]?.outcome, "succeeded")
                bot.rest.respond(`GET /channels/${f.ids.channel}`, {
                    body: bot.fixtures.channel({ rate_limit_per_user: 20, permission_overwrites: [] }),
                })
                yield* emit(bot, `!mod slowmode ${f.ids.channel} 10 reason`)
                assert.equal(slowmode.requests().length, 1)
                assert.equal(outcomes[2]?.outcome, "failed")
            }),
        ),
    )
})

test("purge reserves the exact native preview selection before one deletion operation and excludes the command", async () => {
    const f = createFixtures()
    let managed: ModerationManageRequest | undefined
    const b = boundary({
        manage: (input) => {
            managed = input
            return Effect.succeed(caseGrant(input))
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                platform(bot)
                const first = bot.fixtures.message({ content: "synthetic first" })
                const second = bot.fixtures.message({ content: "synthetic second" })
                // The history above the two older messages is the preview and the confirm, newest first, as they were sent
                const newer: Array<{ id: string }> = []
                bot.rest.respond("GET /channels/:id/messages", () => ({ body: [...newer, second, first] }))
                const bulk = bot.rest.respond("POST /channels/:id/messages/bulk-delete", { status: 204 })
                yield* bot.ready()
                // The purge of everyone runs when its preview is repeated with confirm
                const preview = bot.fixtures.message({ content: "!mod purge 2 cleanup" })
                newer.unshift(preview)
                yield* bot.emit("MESSAGE_CREATE", preview)
                yield* bot.idle()
                assert.equal(bulk.requests().length, 0)
                const command = bot.fixtures.message({ content: "!mod purge 2 cleanup confirm" })
                newer.unshift(command)
                yield* bot.emit("MESSAGE_CREATE", command)
                yield* bot.idle()
                assert.equal(managed?.operation.type, "action")
                if (managed?.operation.type === "action")
                    assert.deepEqual(managed.operation.action.messageIds, [second.id, first.id])
                assert.equal(bulk.requests().length, 1)
                assert.deepEqual((bulk.requests()[0]!.body as { message_ids: string[] }).message_ids, [
                    second.id,
                    first.id,
                ])
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a ban with a length that is not read is refused and bans nobody", async () => {
    const f = createFixtures()
    const b = boundary({ manage: (input) => Effect.succeed(caseGrant(input)) })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                const ban = bot.rest.respond("PUT /guilds/:id/bans/:id", { status: 204 })
                yield* bot.ready()
                const target = p.targetId
                // The target is a real member here, so only the refusal keeps these from banning
                for (const text of [
                    "1.5h spam",
                    "-1h spam",
                    "1h500ms spam",
                    "7days spam",
                    "7 days spam",
                    "1 week spam",
                    "800d spam",
                    '"7 days" spam',
                    '"1 week"',
                    "7\\ days spam",
                    "1 h30m spam",
                    "7d, spam",
                    "7 days, spam",
                    '" 7d" spam',
                    '" 7 days" spam',
                    "“7 days” spam",
                    "“7d” spam",
                    "`7d` spam",
                    "(7d) spam",
                    "‘7d’",
                    "case 12 7d spam",
                    "case 12 ½d spam",
                    "½h spam",
                    "½ day spam",
                    "¼d spam",
                    "⁷d",
                    "①d spam",
                    "[7d]",
                    "1,5d spam",
                    "7-day spam",
                    "2 accounts",
                    "3 strikes",
                    "24/7 spam",
                    "1st warning",
                    "2fa required",
                ]) {
                    yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!mod ban ${target} ${text}` }))
                    yield* bot.idle()
                    assert.match(shown(bodies(p).at(-1)), /from 1m to 730d, such as 7d or 1h30m/, text)
                }
                assert.equal(ban.requests().length, 0)
                // A reason that starts with a word stays a reason, so these are permanent bans
                const reasons = ["spam", "Männer beleidigt", "raid with 3 alts", "after 3 strikes"]
                for (const reason of reasons) {
                    yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!mod ban ${target} ${reason}` }))
                    yield* bot.idle()
                }
                assert.equal(ban.requests().length, reasons.length)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

/** A server with a channel history that holds the newest message of a member and an older one of another author */
function purgeWorld(
    body: (world: {
        bot: Bot
        p: ReturnType<typeof platform>
        member: string
        /** Another staff member, and another channel the actor may purge in */
        second: string
        channel: string
        mine: { id: string }
        other: { id: string }
        send: (
            content: string,
            as?: { author?: string; channel?: string; id?: string },
        ) => Effect.Effect<string, unknown>
        /** A command message in the channel's history that is not delivered yet, and delivering a message, possibly twice */
        write: (content: string) => { id: string }
        deliver: (message: { id: string }) => Effect.Effect<string, unknown>
        /** The ids of the history above the two older messages, newest first */
        trailIds: () => string[]
        /** A message of another author lands in the channel, or one of a given author */
        post: (author?: string) => { id: string }
        deleted: () => string[]
        reads: () => number
        /** What the bot replied so far, oldest first */
        replied: () => string[]
        /** The next replies the bot sends are refused by Fluxer */
        rejectReplies: (count: number) => void
        /** The next reply waits until the returned function is called, and the request is awaited with arrived */
        holdReply: () => () => void
        arrived: () => Effect.Effect<unknown, unknown>
        /** The ids of the older messages still in the channel, newest first */
        older: () => string[]
    }) => Effect.Effect<void, unknown>,
    options: {
        general?: GeneralSettingsStore
        platform?: Parameters<typeof platform>[1]
        /** Ids of the two older messages, to test ids of different lengths */
        targetIds?: [string, string]
        /** Ids of the first replies the bot sends, in order */
        replyIds?: string[]
        /** More older messages below the two, so several purges have targets */
        extraTargets?: number
        /** The first this many manual actions fail in the backend */
        failManage?: number
    } = {},
) {
    const f = createFixtures()
    let failures = options.failManage ?? 0
    const b = boundary({
        manage: (input) =>
            failures-- > 0
                ? Effect.fail(new ModerationStoreError({ operation: "manage", status: null }))
                : Effect.succeed(caseGrant(input)),
    })
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: b.store, ...(options.general ? { general: options.general } : {}) },
                    ),
                )
                const p = platform(bot, options.platform)
                const member = p.targetId
                const second = bot.fixtures.nextId(),
                    channel = bot.fixtures.nextId()
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${second}`, {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: second }),
                        roles: [p.actorRole.id],
                        communication_disabled_until: null,
                    }),
                })
                bot.rest.respond(`GET /channels/${channel}`, { body: bot.fixtures.channel({ id: channel }) })
                const extras = Array.from({ length: options.extraTargets ?? 0 }, () =>
                    bot.fixtures.message({
                        content: "synthetic extra",
                        author: bot.fixtures.user({ id: bot.fixtures.nextId() }),
                    }),
                )
                const other = bot.fixtures.message({
                    ...(options.targetIds ? { id: options.targetIds[1] } : {}),
                    content: "synthetic other",
                    author: bot.fixtures.user({ id: bot.fixtures.nextId() }),
                })
                const mine = bot.fixtures.message({
                    ...(options.targetIds ? { id: options.targetIds[0] } : {}),
                    content: "synthetic member",
                    author: bot.fixtures.user({ id: member }),
                })
                // The channel's messages, newest first: every command sent and every reply of the bot sit above the older two
                const trail: Array<{ id: string; channel_id: string }> = []
                const olders = [mine, other, ...extras.reverse()]
                const replyIds = [...(options.replyIds ?? [])]
                let rejected = 0
                let held: Promise<void> | undefined
                p.replies.remove()
                const replies = bot.rest.respond("POST /channels/:id/messages", async (request) => {
                    const waiting = held
                    held = undefined
                    await waiting
                    if (rejected > 0) {
                        rejected--
                        return { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Synthetic refusal" } }
                    }
                    const reply = bot.fixtures.message({
                        ...(replyIds.length ? { id: replyIds.shift()! } : {}),
                        channel_id: request.path.split("/")[2]!,
                        author: bot.fixtures.botUser(),
                    })
                    trail.unshift(reply)
                    return { body: reply }
                })
                // Only the newest page holds messages, as a real history does
                const history = bot.rest.respond("GET /channels/:id/messages", (request) => ({
                    body: request.query.before
                        ? []
                        : [...trail, ...olders].filter((item) => item.channel_id === request.path.split("/")[2]),
                }))
                // A deleted message leaves the history
                const remove = (ids: string[]) => {
                    for (const list of [trail, olders])
                        for (const id of ids) {
                            const at = list.findIndex((item) => item.id === id)
                            if (at >= 0) list.splice(at, 1)
                        }
                }
                const bulk = bot.rest.respond("POST /channels/:id/messages/bulk-delete", (request) => {
                    remove((request.body as { message_ids: string[] }).message_ids)
                    return { status: 204 }
                })
                const single = bot.rest.respond("DELETE /channels/:id/messages/:id", (request) => {
                    remove([request.path.split("/").at(-1)!])
                    return { status: 204 }
                })
                const deliver = (command: { id: string }) =>
                    bot.emit("MESSAGE_CREATE", command as never).pipe(
                        Effect.andThen(bot.idle()),
                        Effect.map(() => (replies.requests().at(-1)!.body as { content: string }).content),
                    )
                yield* bot.ready()
                yield* body({
                    bot,
                    p,
                    member,
                    second,
                    channel,
                    mine,
                    other,
                    send: (content, as) => {
                        const command = bot.fixtures.message({
                            ...(as?.id ? { id: as.id } : {}),
                            content,
                            ...(as?.author ? { author: bot.fixtures.user({ id: as.author }) } : {}),
                            ...(as?.channel ? { channel_id: as.channel } : {}),
                        })
                        trail.unshift(command)
                        return deliver(command)
                    },
                    write: (content) => {
                        const command = bot.fixtures.message({ content })
                        trail.unshift(command)
                        return command
                    },
                    deliver,
                    trailIds: () => trail.map((item) => item.id),
                    post: (author) => {
                        const posted = bot.fixtures.message({
                            content: "synthetic spam",
                            author: bot.fixtures.user({ id: author ?? bot.fixtures.nextId() }),
                        })
                        trail.unshift(posted)
                        return posted
                    },
                    replied: () => replies.requests().map((request) => (request.body as { content: string }).content),
                    rejectReplies: (count) => {
                        rejected = count
                    },
                    holdReply: () => {
                        let release!: () => void
                        held = new Promise<void>((resolve) => {
                            release = resolve
                        })
                        return release
                    },
                    arrived: () => replies.next({ timeoutMs: 5000 }),
                    older: () => olders.map((item) => item.id),
                    deleted: () => [
                        ...bulk
                            .requests()
                            .flatMap((request) => (request.body as { message_ids: string[] }).message_ids),
                        ...single.requests().map((request) => request.path.split("/").at(-1)!),
                    ],
                    reads: () => history.requests().length,
                })
                assert.equal(bot.failures().length, 0)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
}
const previewOf = (count: number, echo: string) =>
    `No member was named, so this would delete up to ${count} recent ${count === 1 ? "message" : "messages"} from everyone in this channel. Confirm within 2 minutes\n${echo.includes("`") || echo.includes("\n") ? `\`\`\`\n${echo}\n\`\`\`` : `\`${echo}\``}`

test("a purge of everyone runs only when its preview was repeated by the same actor in the same channel within two minutes", async () => {
    await purgeWorld(({ send, deleted, reads, second, channel }) =>
        Effect.gen(function* () {
            // A confirm with no preview before it only previews, whatever makes its last word look like one
            for (const content of [
                "!mod purge 2 @spammer please confirm",
                '!mod purge 2 spam a "CONFIRM"',
                "!mod purge 2 spam b \\confirm",
                "!mod purge 2 cleanup confirm",
            ])
                assert.equal(yield* send(content), previewOf(2, content))
            assert.equal(reads(), 0)
            assert.deepEqual(deleted(), [])
            // The preview is the reply, and repeating it with confirm deletes every author's messages
            assert.equal(yield* send("!mod purge 2 cleanup"), previewOf(2, "!mod purge 2 cleanup confirm"))
            assert.equal(reads(), 0)
            yield* send("!mod purge 2 cleanup confirm")
            assert.equal(deleted().length, 2)
            // A used preview is gone, so the same confirm only previews again
            const before = deleted().length
            assert.equal(yield* send("!mod purge 2 cleanup confirm"), previewOf(2, "!mod purge 2 cleanup confirm"))
            assert.equal(deleted().length, before)
            // A different count or reason only previews
            yield* send("!mod purge 2 cleanup")
            assert.match(
                yield* send("!mod purge 3 cleanup confirm"),
                /^No member was named, so this would delete up to 3/,
            )
            yield* send("!mod purge 2 cleanup")
            assert.match(yield* send("!mod purge 2 other reason confirm"), /^No member was named/)
            // Another actor's or another channel's confirm only previews
            yield* send("!mod purge 2 cleanup")
            assert.match(yield* send("!mod purge 2 cleanup confirm", { author: second }), /^No member was named/)
            assert.match(yield* send("!mod purge 2 cleanup confirm", { channel }), /^No member was named/)
            assert.equal(deleted().length, before)
            // A preview expires after two minutes
            yield* send("!mod purge 2 cleanup")
            yield* TestClock.adjust("2 minutes")
            assert.match(yield* send("!mod purge 2 cleanup confirm"), /^No member was named/)
            assert.equal(deleted().length, before)
            // Within the two minutes the matching confirm runs
            yield* send("!mod purge 2 cleanup")
            yield* TestClock.adjust("119 seconds")
            yield* send("!mod purge 2 cleanup confirm")
            assert.equal(deleted().length, before + 2)
        }),
    )
})

test("a purge confirm never counts or deletes its own preview exchange", async () => {
    await purgeWorld(({ send, deleted, mine, other, replied }) =>
        Effect.gen(function* () {
            // The history holds the confirm, the bot's preview and the preview command above the two older messages, newest first
            yield* send("!mod purge 2 cleanup")
            assert.equal(replied().length, 1)
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
})

test("a retyped, expired or changed-count purge preview still deletes exactly its targets and none of the exchange", async () => {
    // A preview typed again
    await purgeWorld(({ send, deleted, mine, other }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 cleanup")
            yield* send("!mod purge 2 cleanup")
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
    // A preview that expired, whose confirm previews again, and a second confirm
    await purgeWorld(({ send, deleted, mine, other }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 cleanup")
            yield* TestClock.adjust("121 seconds")
            assert.match(yield* send("!mod purge 2 cleanup confirm"), /^No member was named/)
            assert.deepEqual(deleted(), [])
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
    // A retry with another count
    await purgeWorld(({ send, deleted, mine, other }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 3 cleanup")
            assert.match(
                yield* send("!mod purge 2 cleanup confirm"),
                /^No member was named, so this would delete up to 2/,
            )
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
})

test("a purge deletes the newest messages before the confirm that are not part of its exchange, however old the preview was", async () => {
    // An abandoned preview, spam five minutes later and a new preview nine minutes in
    await purgeWorld(({ send, post, deleted, trailIds }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 abandoned cleanup")
            yield* TestClock.adjust("5 minutes")
            const spam = [post(), post()]
            yield* TestClock.adjust("4 minutes")
            yield* send("!mod purge 2 spam wave")
            assert.equal(trailIds().length, 6)
            yield* send("!mod purge 2 spam wave confirm")
            assert.deepEqual(deleted().sort(), spam.map((item) => item.id).sort())
        }),
    )
    // A second purge right after a completed one does not spend its count on the first exchange or its result
    await purgeWorld(
        ({ send, deleted, mine, other, older, replied }) =>
            Effect.gen(function* () {
                const extras = older().slice(2)
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup confirm")
                assert.match(replied().at(-1)!, /^Case #\d+: Purge/)
                assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
                // The deleted messages left the history, so the next purge reaches the ones below them
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup confirm")
                assert.deepEqual(deleted().slice(2).sort(), extras.sort())
            }),
        { extraTargets: 2 },
    )
})

test("a purge preview delivered again, or out of order, never confirms itself", async () => {
    await purgeWorld(({ write, deliver, deleted, reads }) =>
        Effect.gen(function* () {
            const a = write("!mod purge 2 cleanup"),
                b = write("!mod purge 3 cleanup confirm"),
                c = write("!mod purge 2 cleanup confirm")
            for (const message of [a, b, c, a, c]) assert.match(yield* deliver(message), /^No member was named/)
            assert.equal(reads(), 0)
            assert.deepEqual(deleted(), [])
        }),
    )
    // Identical confirms delivered newest first only preview, and a new one then deletes just the targets
    await purgeWorld(({ write, deliver, send, deleted, mine, other }) =>
        Effect.gen(function* () {
            const x = write("!mod purge 2 cleanup confirm"),
                y = write("!mod purge 2 cleanup confirm")
            assert.match(yield* deliver(y), /^No member was named/)
            assert.match(yield* deliver(x), /^No member was named/)
            assert.deepEqual(deleted(), [])
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
    // A confirm that previewed again because its count differed does not confirm itself when delivered again
    await purgeWorld(({ send, write, deliver, deleted, reads }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 cleanup")
            const other = write("!mod purge 3 cleanup confirm")
            assert.match(yield* deliver(other), /^No member was named, so this would delete up to 3/)
            assert.match(yield* deliver(other), /^No member was named, so this would delete up to 3/)
            assert.equal(reads(), 0)
            assert.deepEqual(deleted(), [])
        }),
    )
})

test("one moderator's purge messages are never counted by another moderator's confirm", async () => {
    await purgeWorld(
        ({ send, deleted, second, mine, other, older }) =>
            Effect.gen(function* () {
                const extras = older().slice(2)
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup", { author: second })
                yield* send("!mod purge 2 cleanup confirm")
                assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
                // The second moderator's confirm skips the first moderator's exchange as well as its own
                yield* send("!mod purge 2 cleanup confirm", { author: second })
                assert.deepEqual(deleted().slice(2).sort(), extras.sort())
            }),
        { extraTargets: 2 },
    )
})

test("the empty and error replies of a purge join its exchange, so a retry does not count them", async () => {
    // Nothing is left to delete, so the third purge finds no target and must not delete the second one's reply
    await purgeWorld(({ send, deleted, replied }) =>
        Effect.gen(function* () {
            for (let index = 0; index < 3; index++) {
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup confirm")
            }
            assert.equal(deleted().length, 2)
            assert.equal(replied().at(-1), "No matching messages were selected")
        }),
    )
    // A failed confirm answers with an error, and the retry deletes both targets and not that answer
    await purgeWorld(
        ({ send, deleted, mine, other, replied }) =>
            Effect.gen(function* () {
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup confirm")
                assert.match(replied().at(-1)!, /^The command could not be completed|^NeonFlux/)
                assert.deepEqual(deleted(), [])
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup confirm")
                assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
            }),
        { failManage: 1 },
    )
})

test("a purge confirm reaches only messages older than itself", async () => {
    await purgeWorld(({ write, send, post, deliver, deleted, mine, other }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 cleanup")
            const confirm = write("!mod purge 2 cleanup confirm")
            // A message lands after the confirm and before the history is read
            const late = post()
            yield* deliver(confirm)
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
            assert.ok(!deleted().includes(late.id))
        }),
    )
})

test("a purge preview's two minutes start when its reply was sent, not when its command arrived", async () => {
    await purgeWorld(({ bot, holdReply, arrived, write, deliver, send, deleted }) =>
        Effect.gen(function* () {
            const release = holdReply()
            const preview = write("!mod purge 2 cleanup")
            const sending = yield* Effect.forkChild(deliver(preview))
            yield* arrived()
            yield* TestClock.adjust("25 seconds")
            release()
            yield* Fiber.join(sending)
            yield* bot.idle()
            yield* TestClock.adjust("100 seconds")
            // 125 seconds after the command, but 100 after its reply
            yield* send("!mod purge 2 cleanup confirm")
            assert.equal(deleted().length, 2)
        }),
    )
})

test("a purge of a member joins the same exchange as a purge of everyone", async () => {
    // A member purge, then a purge of everyone, spends the second one's count only on its targets
    await purgeWorld(({ send, member, deleted, mine, other, replied }) =>
        Effect.gen(function* () {
            yield* send(`!mod purge 1 ${member} spam`)
            assert.match(replied().at(-1)!, /^Case #\d+: Purge/)
            assert.deepEqual(deleted(), [mine.id])
            yield* send("!mod purge 1 cleanup")
            yield* send("!mod purge 1 cleanup confirm")
            assert.deepEqual(deleted().slice(1), [other.id])
        }),
    )
})

test("a purge refused for the bot's missing permission, and its fix reply, are not counted when it is retried", async () => {
    await purgeWorld(
        ({ bot, p, send, deleted, mine, other, replied }) =>
            Effect.gen(function* () {
                assert.match(yield* send("!mod purge 2 cleanup"), /Manage messages/)
                assert.equal(replied().length, 1)
                // The bot is granted the permission, and the retry previews and confirms
                p.rolesRoute.remove()
                bot.rest.respond("GET /guilds/:id/roles", {
                    body: [
                        bot.fixtures.role({ id: bot.fixtures.ids.guild, permissions: "0" }),
                        p.actorRole,
                        { ...p.botRole, permissions: Permissions.Administrator.toString() },
                    ],
                })
                yield* send("!mod purge 2 cleanup")
                yield* send("!mod purge 2 cleanup confirm")
                assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
            }),
        { platform: { botPermissions: Permissions.ViewChannel | Permissions.SendMessages } },
    )
})

test("a purge keeps its exchange while exchanges follow within ten minutes", async () => {
    // Previews at 0, 4 and 8 minutes keep the exchange for twelve minutes, with no command since the last
    await purgeWorld(({ send, deleted, mine, other }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 cleanup")
            for (let index = 0; index < 2; index++) {
                yield* TestClock.adjust("4 minutes")
                yield* send("!mod purge 2 cleanup")
            }
            yield* TestClock.adjust("4 minutes")
            yield* send("!mod purge 2 cleanup")
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
})

test("a purge of a member selects that member's newest messages, even when they are purge replies", async () => {
    await purgeWorld(({ bot, send, post, deleted, trailIds }) =>
        Effect.gen(function* () {
            const botId = bot.fixtures.ids.bot
            const older = post(botId)
            yield* send("!mod purge 1 cleanup")
            const preview = trailIds()[0]!
            yield* send(`!mod purge 1 ${botId} cleanup`)
            assert.deepEqual(deleted(), [preview])
            assert.ok(!deleted().includes(older.id))
        }),
    )
})

test("a purge compares the id of its preview reply as a number too", async () => {
    // The reply's id has fewer digits than the confirm's, and sorts after it as text
    await purgeWorld(
        ({ send, deleted, mine, other }) =>
            Effect.gen(function* () {
                yield* send("!mod purge 2 cleanup", { id: "800000000000000000" })
                yield* send("!mod purge 2 cleanup confirm", { id: "1500000000000000000" })
                assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
            }),
        { targetIds: ["80000000000000002", "80000000000000001"], replyIds: ["900000000000000000"] },
    )
})

test("a member's message posted before a purge command arrived is not deleted", async () => {
    // The member posts after the command was written and before it arrived
    await purgeWorld(({ member, write, post, deliver, deleted, mine }) =>
        Effect.gen(function* () {
            const command = write(`!mod purge 1 ${member} spam`)
            const late = post(member)
            yield* deliver(command)
            assert.deepEqual(deleted(), [mine.id])
            assert.ok(!deleted().includes(late.id))
        }),
    )
})

test("a purge remembers at most twenty exchange messages per channel, and forgets them after ten idle minutes", async () => {
    // Eleven previews and the confirm are twenty-three messages, so the three oldest drop out and the newest two of them are counted
    // again, which spends the count on the actor's and NeonFlux's own purge messages and never on the targets
    await purgeWorld(({ send, deleted, trailIds }) =>
        Effect.gen(function* () {
            for (let index = 0; index < 11; index++) yield* send(`!mod purge 2 cleanup ${index}`)
            const forgotten = trailIds().slice(-3, -1)
            yield* send("!mod purge 2 cleanup 10 confirm")
            assert.deepEqual(deleted().sort(), forgotten.sort())
        }),
    )
    // Nine previews are eighteen messages, all remembered, so the confirm reaches the targets
    await purgeWorld(({ send, deleted, mine, other }) =>
        Effect.gen(function* () {
            for (let index = 0; index < 9; index++) yield* send(`!mod purge 2 cleanup ${index}`)
            yield* send("!mod purge 2 cleanup 8 confirm")
            assert.deepEqual(deleted().sort(), [mine.id, other.id].sort())
        }),
    )
    // After ten idle minutes the exchange is forgotten, so its messages count like any other
    await purgeWorld(({ send, deleted, trailIds }) =>
        Effect.gen(function* () {
            yield* send("!mod purge 2 cleanup")
            const earlier = trailIds()
            yield* TestClock.adjust("10 minutes")
            yield* send("!mod purge 2 cleanup")
            yield* send("!mod purge 2 cleanup confirm")
            assert.deepEqual(deleted().sort(), earlier.sort())
        }),
    )
})

test("a purge preview says message in the singular for one", async () => {
    await purgeWorld(({ send }) =>
        Effect.gen(function* () {
            assert.equal(yield* send("!mod purge 1 cleanup"), previewOf(1, "!mod purge 1 cleanup confirm"))
        }),
    )
})

test("a preview whose reply Fluxer refused authorizes nothing, and a confirm of it only previews", async () => {
    await purgeWorld(({ send, deleted, reads, rejectReplies }) =>
        Effect.gen(function* () {
            rejectReplies(1)
            yield* send("!mod purge 2 cleanup")
            assert.match(yield* send("!mod purge 2 cleanup confirm"), /^No member was named/)
            assert.equal(reads(), 0)
            assert.deepEqual(deleted(), [])
        }),
    )
})

test("a confirm without a preview stores its reason without confirm and echoes itself, and only a reason that is valid without confirm is offered", async () => {
    await purgeWorld(({ send, deleted, replied }) =>
        Effect.gen(function* () {
            // 512 letters is the longest reason, so the echo of a confirm with that reason is offered and then runs as it is
            const longest = `!mod purge 2 ${"a".repeat(512)} confirm`
            assert.equal(yield* send(longest), previewOf(2, longest))
            assert.deepEqual(deleted(), [])
            yield* send(longest)
            assert.equal(deleted().length, 2)
            // One more letter is no valid reason, so nothing is offered
            const tooLong = `!mod purge 2 ${"a".repeat(513)} confirm`
            assert.match(yield* send(tooLong), /^Check quoting and values/)
            assert.doesNotMatch(replied().at(-1)!, /No member was named/)
            assert.equal(deleted().length, 2)
        }),
    )
})

test("a purge names its member right after the count and needs a reason, and nothing else makes it narrower or wider", async () => {
    await purgeWorld(({ send, deleted, reads, member, mine }) =>
        Effect.gen(function* () {
            // A member with no reason is refused like any missing reason, never previewed as everyone
            for (const content of [
                `!mod purge 2 ${member}`,
                `!mod purge 2 <@${member}>`,
                "!mod purge 2",
                "!mod purge 2 confirm",
            ])
                assert.match(yield* send(content), /^Check quoting and values/, content)
            // Text that is not a member is a reason, and the reply shows the exact confirm command
            for (const reason of ["spammer spam", "@spammer spam", `<@&${member}> spam`, `${member}0 spam`, "all spam"])
                assert.equal(yield* send(`!mod purge 2 ${reason}`), previewOf(2, `!mod purge 2 ${reason} confirm`))
            assert.equal(reads(), 0)
            assert.deepEqual(deleted(), [])
            // A member runs at once and touches only their messages, even with confirm as the last word of the reason
            yield* send(`!mod purge 2 ${member} spam confirm`)
            assert.deepEqual(deleted(), [mine.id])
        }),
    )
})

test("the confirm command is the moderator's own message with confirm added, so quotes, backslashes and a custom prefix replay as typed", async () => {
    const general: GeneralSettingsStore = {
        get: () => Effect.succeed({ prefix: "::", replyStyle: "text", revision: 1 }),
        set: () => Effect.die("unused"),
        nickname: () => Effect.die("unused"),
        setNickname: () => Effect.die("unused"),
        recordNickname: () => Effect.die("unused"),
    }
    await purgeWorld(
        ({ send, deleted, member }) =>
            Effect.gen(function* () {
                const quoted = `::mod purge 2 "<@${member}> spam" it's a \\\\ backslash and "two  spaces"`
                const reply = yield* send(quoted)
                assert.equal(reply, previewOf(2, `${quoted} confirm`))
                // Sending the echo as it is deletes everyone's messages, and it never narrows to the member in the quotes
                yield* send(`${quoted} confirm`)
                assert.equal(deleted().length, 2)
                // A backtick or a line break in the echo is shown in a code block that cannot close early
                const risky = "::mod purge 2 a `tick` and\nline"
                assert.equal(yield* send(risky), previewOf(2, `${risky} confirm`))
                yield* send(`${risky} confirm`)
                assert.equal(deleted().length, 4)
                // A run of three backticks in the echo needs a longer fence
                const fenced = "::mod purge 2 see ```x``` end"
                const preview = yield* send(fenced)
                assert.equal(
                    preview,
                    `${previewOf(2, `${fenced} confirm`).split("\n")[0]}\n\`\`\`\`\n${fenced} confirm\n\`\`\`\``,
                )
            }),
        { general, extraTargets: 2 },
    )
})

test("a purge is refused before any preview when the actor or the bot lacks the permission, or outside a server channel", async () => {
    await purgeWorld(
        ({ send, deleted, reads }) =>
            Effect.gen(function* () {
                const reply = yield* send("!mod purge 2 cleanup")
                assert.doesNotMatch(reply, /No member was named/)
                assert.equal(reply, "You need Manage messages for this action")
                assert.equal(reads(), 0)
                assert.deepEqual(deleted(), [])
            }),
        { platform: { actorOwner: false, actorPermissions: 0n } },
    )
    // A DM names no channel to purge
    await purgeWorld(({ bot, p, deleted, reads, replied }) =>
        Effect.gen(function* () {
            const { guild_id, ...raw } = bot.fixtures.message({ content: "!mod purge 2 cleanup", channel_id: p.dmId })
            void guild_id
            yield* bot.emit("MESSAGE_CREATE", raw as never)
            yield* bot.idle()
            assert.deepEqual(replied(), ["Send `!mod purge` in the channel whose messages it should delete"])
            assert.equal(reads(), 0)
            assert.deepEqual(deleted(), [])
        }),
    )
    await purgeWorld(
        ({ send, deleted }) =>
            Effect.gen(function* () {
                const reply = yield* send("!mod purge 2 cleanup")
                assert.doesNotMatch(reply, /No member was named/)
                assert.match(reply, /Manage messages/)
                assert.deepEqual(deleted(), [])
            }),
        { platform: { botPermissions: Permissions.ViewChannel | Permissions.SendMessages } },
    )
})

test("purge inside a thread checks permissions through the thread's parent channel", async () => {
    const f = createFixtures()
    let managed: ModerationManageRequest | undefined
    const b = boundary({
        manage: (input) => {
            managed = input
            return Effect.succeed(caseGrant(input))
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                platform(bot)
                const thread = bot.fixtures.thread()
                const threadRead = bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
                const first = bot.fixtures.message({ channel_id: thread.id, content: "synthetic first" })
                const newer: Array<{ id: string }> = []
                bot.rest.respond(`GET /channels/${thread.id}/messages`, () => ({ body: [...newer, first] }))
                const bulk = bot.rest.respond(`POST /channels/${thread.id}/messages/bulk-delete`, { status: 204 })
                const single = bot.rest.respond(`DELETE /channels/${thread.id}/messages/:id`, { status: 204 })
                yield* bot.ready()
                const preview = bot.fixtures.message({ channel_id: thread.id, content: "!mod purge 1 cleanup" })
                newer.unshift(preview)
                yield* bot.emit("MESSAGE_CREATE", preview)
                yield* bot.idle()
                const command = bot.fixtures.message({ channel_id: thread.id, content: "!mod purge 1 cleanup confirm" })
                newer.unshift(command)
                yield* bot.emit("MESSAGE_CREATE", command)
                yield* bot.idle()
                assert.ok(threadRead.requests().length > 0)
                assert.equal(managed?.operation.type, "action")
                if (managed?.operation.type === "action")
                    assert.deepEqual(managed.operation.action.messageIds, [first.id])
                assert.equal(bulk.requests().length + single.requests().length, 1)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("staff appeal decisions and text are delivered privately while guild confirmations carry only appeal metadata", async () => {
    const f = createFixtures()
    const requests: AppealStaffRequest[] = []
    const b = boundary({
        staffAppeal: (input) => {
            requests.push(input)
            return Effect.succeed({
                duplicate: false,
                type: "appeal",
                appeal: {
                    appealNo: 3,
                    caseNo: 2,
                    userId: f.nextId(),
                    text: "confidential appeal narrative",
                    createdAt: 1_700_000_000_000,
                    status: input.operation.type === "decide" ? input.operation.decision : "open",
                    decisionReason: "private decision",
                    erased: false,
                },
            })
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, "!appeal approve 3 private decision")
                assert.equal(requests[0]?.privateChannelVerified, true)
                assert.equal(requests[0]?.actor.isOwner, true)
                const dm = p.replies.requests().filter((request) => request.path.includes(p.dmId))
                const guild = p.replies.requests().filter((request) => request.path.includes(f.ids.channel))
                assert.match(shown(dm[0]!.body), /confidential appeal narrative/)
                assert.match(
                    shown(dm[0]!.body),
                    /Approving does not undo the sanction\. Check it with !mod show 2, then reverse it with the matching command and case 2, such as unban, untimeout, security release or mod void$/,
                )
                assert.equal(guild.length, 1)
                assert.equal((guild[0]!.body as Body).content, "Appeal #3 accepted. Details sent by DM")
                assert.deepEqual(requests[0]?.operation, {
                    type: "decide",
                    appealNo: 3,
                    decision: "accepted",
                    reason: "private decision",
                })
                assert.equal(
                    b.calls.some((call) => call.method === "manage"),
                    false,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("staff review appeals with !appeal in a server channel or a verified DM, the review list pages with next and member forms stay in DMs", async () => {
    const f = createFixtures()
    const requests: AppealStaffRequest[] = []
    const b = boundary({
        staffAppeal: (input) => {
            requests.push(input)
            return Effect.succeed(
                input.operation.type === "list"
                    ? {
                          duplicate: false,
                          type: "appeals",
                          appeals: [],
                          ...(input.operation.beforeAppealNo ? {} : { nextBeforeAppealNo: 21 }),
                      }
                    : {
                          duplicate: false,
                          type: "appeal",
                          appeal: {
                              appealNo: 3,
                              caseNo: 2,
                              userId: f.nextId(),
                              text: "confidential appeal narrative",
                              createdAt: 1_700_000_000_000,
                              status: "open",
                              erased: false,
                          },
                      },
            )
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                const sent = (channelId: string) =>
                    p.replies
                        .requests()
                        .filter((request) => request.path.includes(channelId))
                        .map((request) => shown(request.body))
                yield* emit(bot, "!appeal review")
                assert.equal(sent(p.dmId)[0]!, "Appeals\nNo appeals yet\nNext: `!appeal review next`")
                assert.deepEqual(sent(f.ids.channel), ["Appeal list sent by DM"])
                yield* emit(bot, "!appeal review next")
                assert.doesNotMatch(sent(p.dmId)[1]!, /Next/)
                yield* emit(bot, "!appeal review next")
                assert.equal(
                    sent(f.ids.channel).at(-1),
                    "There is no next page to show. Send !appeal review to start the list again",
                )
                // A verified DM needs no acknowledgement in the server
                yield* emit(bot, "!appeal review 3", { guild_id: undefined, channel_id: p.dmId })
                assert.match(sent(p.dmId).at(-1)!, /confidential appeal narrative/)
                assert.equal(sent(f.ids.channel).length, 3)
                assert.deepEqual(
                    requests.map((input) => input.operation),
                    [{ type: "list" }, { type: "list", beforeAppealNo: 21 }, { type: "show", appealNo: 3 }],
                )
                assert.ok(requests.every((input) => input.actor.isOwner && input.privateChannelVerified))
                assert.deepEqual(
                    b.calls
                        .filter((call) => call.method === "gate")
                        .map((call) => (call.input as ModerationGateRequest).command),
                    ["staff", "staff", "staff", "staff"],
                )
                yield* emit(bot, "!appeal cases")
                assert.equal(
                    sent(f.ids.channel).at(-1),
                    "Send `!appeal` commands in a private one-to-one DM with NeonFlux",
                )
                assert.equal(
                    b.calls.some((call) => call.method === "memberAppeal"),
                    false,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("!appeal review open lists only waiting appeals oldest first, pages with next and a rejected decision keeps the plain footer", async () => {
    const f = createFixtures()
    const requests: AppealStaffRequest[] = []
    const waiting = (appealNo: number) => ({
        appealNo,
        caseNo: 2,
        userId: f.nextId(),
        text: `waiting appeal ${appealNo}`,
        createdAt: 1_700_000_000_000,
        status: "open" as const,
        erased: false,
    })
    const b = boundary({
        staffAppeal: (input) => {
            requests.push(input)
            const op = input.operation
            return Effect.succeed(
                op.type === "queue"
                    ? {
                          duplicate: false,
                          type: "appeals",
                          appeals: op.afterAppealNo ? [] : [waiting(4)],
                          ...(op.afterAppealNo ? {} : { nextAfterAppealNo: 4 }),
                      }
                    : {
                          duplicate: false,
                          type: "appeal",
                          appeal: { ...waiting(4), status: "rejected" as const },
                      },
            )
        },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                const sent = (channelId: string) =>
                    p.replies
                        .requests()
                        .filter((request) => request.path.includes(channelId))
                        .map((request) => shown(request.body))
                yield* emit(bot, "!appeal review open")
                assert.match(sent(p.dmId)[0]!, /^Appeals waiting\n\*\*#4\*\* Case #2 by .*, waiting for review/)
                assert.match(sent(p.dmId)[0]!, /Next: `!appeal review open next`$/)
                assert.deepEqual(sent(f.ids.channel), ["Appeal list sent by DM"])
                yield* emit(bot, "!appeal review open next")
                assert.equal(sent(p.dmId)[1]!, "Appeals waiting\nNo appeals wait for review")
                yield* emit(bot, "!appeal reject 4 not enough")
                assert.match(sent(p.dmId)[2]!, /A decision does not undo the sanction\. Staff reverse it separately$/)
                assert.deepEqual(
                    requests.map((input) => input.operation),
                    [
                        { type: "queue" },
                        { type: "queue", afterAppealNo: 4 },
                        { type: "decide", appealNo: 4, decision: "rejected", reason: "not enough" },
                    ],
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("free-text reasons, linked cases, paged lists and the merged appeal command parse to the same backend operations", () => {
    const user = "123456789012345679",
        channel = "223456789012345679"
    const action = (name: SafetyName, ...args: string[]) => {
        const parsed = parseSafetyCommand(name, args)
        return "kind" in parsed && parsed.kind === "action" ? parsed.action : parsed
    }
    assert.deepEqual(safetyNames, ["mod", "logs", "automod", "security", "defcon", "appeal"])
    assert.deepEqual(action("mod", "warn", `<@${user}>`, "don't", "spam", "links"), {
        type: "warn",
        reason: "don't spam links",
        targetId: user,
    })
    assert.deepEqual(action("mod", "ban", user, "case", "4", "repeat", "offense"), {
        type: "ban",
        reason: "repeat offense",
        targetId: user,
        linkedCaseNo: 4,
    })
    assert.deepEqual(action("mod", "ban", user, "1d", "case", "4", "cool", "off"), {
        type: "ban",
        reason: "cool off",
        targetId: user,
        durationSeconds: 86400,
        linkedCaseNo: 4,
    })
    assert.deepEqual(action("mod", "timeout", user, "10m", "case", "closed", "early"), {
        type: "timeout",
        reason: "case closed early",
        targetId: user,
        durationSeconds: 600,
    })
    assert.deepEqual(action("mod", "slowmode", `<#${channel}>`, "-0", "calm", "down"), {
        type: "slowmode",
        channelId: channel,
        slowmodeSeconds: 0,
        reason: "calm down",
    })
    assert.deepEqual(action("mod", "slowmode", `<#${channel}>`, "10", "calm", "down"), {
        type: "slowmode",
        channelId: channel,
        slowmodeSeconds: 10,
        reason: "calm down",
    })
    assert.deepEqual(action("security", "quarantine", user, "10m", "case", "2", "raid", "account"), {
        type: "quarantine",
        reason: "raid account",
        targetId: user,
        durationSeconds: 600,
        linkedCaseNo: 2,
    })
    assert.deepEqual(action("security", "release", user, "cleared"), {
        type: "release",
        reason: "cleared",
        targetId: user,
    })
    assert.deepEqual(action("security", "lock", `<#${channel}>`, "raid", "in", "progress"), {
        type: "lock",
        reason: "raid in progress",
        channelId: channel,
    })
    // A member right after the count is always the filter, and a purge of a member is never held for a confirm
    assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", `<@${user}>`, "raid", "cleanup"]), {
        kind: "purge",
        count: 20,
        reason: "raid cleanup",
        userId: user,
        confirmed: false,
    })
    assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", user, "confirm"]), {
        kind: "purge",
        count: 20,
        reason: "confirm",
        userId: user,
        confirmed: false,
    })
    // A member without a reason is refused like any missing reason, and never becomes a purge of everyone
    for (const word of [user, `<@${user}>`, `<@!${user}>`])
        assert.ok("error" in parseSafetyCommand("mod", ["purge", "20", word]), word)
    // Without a member, the reason is everything after the count, and the purge of everyone needs a final "confirm"
    for (const words of [
        ["spam", "wave"],
        ["spammer", "spam"],
        ["@spammer", "spam"],
        ["<@&323456789012345679>", "spam"],
        [`${user}00`, "spam"],
        ["all", "spam"],
    ])
        assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", ...words]), {
            kind: "purge",
            count: 20,
            reason: words.join(" "),
            confirmed: false,
        })
    for (const last of ["confirm", "CONFIRM", "Confirm"])
        assert.deepEqual(parseSafetyCommand("mod", ["purge", "20", "spam", "wave", last]), {
            kind: "purge",
            count: 20,
            reason: "spam wave",
            confirmed: true,
        })
    // A reason is required, so a bare confirm is refused like a missing reason
    for (const words of [[], ["confirm"], ["CONFIRM"]])
        assert.ok("error" in parseSafetyCommand("mod", ["purge", "20", ...words]), words.join(" "))
    assert.deepEqual(parseSafetyCommand("mod", ["reason", "3", "corrected", "reason"]), {
        kind: "manage",
        operation: { type: "case-reason", caseNo: 3, reason: "corrected reason" },
    })
    assert.deepEqual(parseSafetyCommand("mod", ["void", "3"]), {
        kind: "manage",
        operation: { type: "case-void", caseNo: 3 },
    })
    assert.deepEqual(parseSafetyCommand("mod", ["show", "3"]), {
        kind: "query",
        operation: { type: "case-show", caseNo: 3 },
        private: true,
    })
    assert.deepEqual(parseSafetyCommand("mod", ["recover", "3"]), { kind: "recover", caseNo: 3 })
    assert.deepEqual(parseSafetyCommand("mod", ["list"]), {
        kind: "query",
        operation: { type: "case-list" },
        private: true,
        page: { list: "list", next: false },
    })
    assert.deepEqual(parseSafetyCommand("mod", ["list", `<@${user}>`, "next"]), {
        kind: "query",
        operation: { type: "case-list", userId: user },
        private: true,
        page: { list: `list ${user}`, next: true },
    })
    assert.deepEqual(parseSafetyCommand("logs", ["list", "next"]), {
        kind: "query",
        operation: { type: "case-list" },
        private: true,
        page: { list: "list", next: true },
    })
    assert.deepEqual(parseSafetyCommand("automod", ["list", "next"]), {
        kind: "query",
        operation: { type: "rule-list" },
        private: false,
        page: { list: "list", next: true },
    })
    assert.deepEqual(parseSafetyCommand("security", ["watchlist", "list"]), {
        kind: "query",
        operation: { type: "watchlist-list" },
        private: true,
        page: { list: "watchlist list", next: false },
    })
    assert.deepEqual(parseSafetyCommand("security", ["recovery", "list", "next"]), {
        kind: "query",
        operation: { type: "recovery-list" },
        private: true,
        page: { list: "recovery list", next: true },
    })
    assert.deepEqual(parseSafetyCommand("security", ["watchlist", "add", user, "known", "raid", "alt"]), {
        kind: "manage",
        operation: { type: "watchlist-add", userId: user, reason: "known raid alt" },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["cases", "next"]), {
        kind: "member-appeal",
        operation: { type: "cases" },
        page: { list: "cases", next: true },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["list"]), {
        kind: "member-appeal",
        operation: { type: "list" },
        page: { list: "list", next: false },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["submit", "12", "Please", "review", "this"]), {
        kind: "member-appeal",
        operation: { type: "submit", caseNo: 12, text: "Please review this" },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["withdraw", "3"]), {
        kind: "member-appeal",
        operation: { type: "withdraw", appealNo: 3 },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["review", "next"]), {
        kind: "staff-appeal",
        operation: { type: "list" },
        page: { list: "review", next: true },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["review", "3"]), {
        kind: "staff-appeal",
        operation: { type: "show", appealNo: 3 },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["review", "open"]), {
        kind: "staff-appeal",
        operation: { type: "queue" },
        page: { list: "review open", next: false },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["review", "open", "next"]), {
        kind: "staff-appeal",
        operation: { type: "queue" },
        page: { list: "review open", next: true },
    })
    assert.deepEqual(parseSafetyCommand("appeal", ["reject", "3", "the", "ban", "stands"]), {
        kind: "staff-appeal",
        operation: { type: "decide", appealNo: 3, decision: "rejected", reason: "the ban stands" },
    })
    for (const [name, ...args] of [
        ["mod", "list", user, "11"],
        ["mod", "list", "user", user],
        ["logs", "list", `<@${user}>`],
        ["logs", "list", "11"],
        ["mod", "warn", user],
        ["mod", "ban", user, "1d"],
        ["mod", "slowmode", channel, "10"],
        ["mod", "purge", "20"],
        ["mod", "reason", "3"],
        ["security", "watchlist", "add", user],
        ["appeal", "cases", "11"],
        ["appeal", "list", "2"],
        ["appeal", "review", "2", "next"],
        ["appeal", "review", "open", "2"],
        ["appeal", "review", "open", "next", "next"],
        ["appeal", "submit", "12"],
        ["appeal", "submit", "12", "x".repeat(2001)],
        ["appeal", "approve", "3"],
    ] as [SafetyName, ...string[]][])
        assert.ok("error" in parseSafetyCommand(name, args), [name, ...args].join(" "))
    // A member's own appeal forms keep the appeal class. Staff review is staff work, and reading or turning off the module is critical
    const gate = (...args: string[]) => safetyGateClass("appeal", parseSafetyCommand("appeal", args))
    assert.deepEqual(
        [gate("cases"), gate("submit", "12", "text"), gate("help"), gate("unknown")],
        ["appeal", "appeal", "appeal", "appeal"],
    )
    assert.deepEqual(
        [
            gate("review"),
            gate("review", "3"),
            gate("review", "open"),
            gate("review", "open", "next"),
            gate("approve", "3", "ok"),
            gate("module", "on"),
            gate("module", "off"),
            gate("status"),
        ],
        ["staff", "staff", "staff", "staff", "staff", "staff", "critical", "critical"],
    )
})

test("safety command arguments accept only their own kind of mention, and numbers and durations keep their bounds", () => {
    const user = "123456789012345679",
        role = "323456789012345679",
        channel = "223456789012345679"
    const action = (name: SafetyName, ...args: string[]) => {
        const parsed = parseSafetyCommand(name, args)
        return "kind" in parsed && parsed.kind === "action" ? parsed.action : parsed
    }
    for (const member of [user, `<@${user}>`, `<@!${user}>`])
        assert.deepEqual(action("mod", "warn", member, "calm", "down"), {
            type: "warn",
            reason: "calm down",
            targetId: user,
        })
    for (const other of [`<@&${role}>`, `<#${channel}>`])
        assert.ok("error" in parseSafetyCommand("mod", ["warn", other, "calm", "down"]))
    assert.ok("error" in parseSafetyCommand("security", ["lock", `<@${user}>`, "raid"]))
    assert.ok("error" in parseSafetyCommand("security", ["lock", `<@&${role}>`, "raid"]))
    assert.deepEqual(action("security", "lock", channel, "raid"), { type: "lock", reason: "raid", channelId: channel })
    assert.deepEqual(parseSafetyCommand("mod", ["staff", "moderation", `<@&${role}>`, role]), {
        kind: "manage",
        operation: { type: "settings", patch: { staffRoleIds: { moderation: [role] } } },
    })
    assert.ok("error" in parseSafetyCommand("mod", ["staff", "moderation", `<@${user}>`]))
    assert.ok("error" in parseSafetyCommand("mod", ["private-role", `<#${channel}>`]))
    assert.ok("error" in parseSafetyCommand("logs", ["channel", `<@&${role}>`]))
    assert.ok("error" in parseSafetyCommand("security", ["honeypot", "add", `<@${user}>`]))
    assert.ok("error" in parseSafetyCommand("security", ["watchlist", "show", `<#${channel}>`]))
    assert.ok("error" in parseSafetyCommand("automod", ["update", "spam", "exempt-roles", `<#${channel}>`]))
    assert.ok("error" in parseSafetyCommand("automod", ["update", "spam", "channels", `<@&${role}>`]))
    assert.deepEqual(parseSafetyCommand("mod", ["list", `<@${user}>`]), {
        kind: "query",
        operation: { type: "case-list", userId: user },
        private: true,
        page: { list: `list ${user}`, next: false },
    })
    assert.ok("error" in parseSafetyCommand("mod", ["list", `<@&${role}>`]))
    // A ban is temporary when a duration follows the member, and a duration that is out of range is refused instead of read as a reason
    assert.deepEqual(action("mod", "ban", user, "2w", "spam"), {
        type: "ban",
        reason: "spam",
        targetId: user,
        durationSeconds: 1209600,
    })
    assert.deepEqual(action("mod", "ban", user, "1H", "spam"), {
        type: "ban",
        reason: "spam",
        targetId: user,
        durationSeconds: 3600,
    })
    assert.deepEqual(action("mod", "ban", user, "spam"), { type: "ban", reason: "spam", targetId: user })
    // A token made of numbers and units is a duration even when it does not convert, so it never becomes part of the reason
    for (const length of [
        "30s",
        "99999d",
        "0d",
        "999999999999999999999d",
        "1h500ms",
        "1m500ms",
        "1.5h",
        "-1h",
        ".5h",
        "1h30.5m",
        "7days",
        "1day",
        "1week",
        "2weeks",
        "1hr",
        "2hrs",
        "30min",
        "30mins",
        "10sec",
        "1y",
        "1mo",
        "1h30",
        "1d12",
        "800d",
        "7d,",
        "7 days",
        "1 week",
        "7 days,",
        "1 h30m",
        "7d.",
    ]) {
        const refused = parseSafetyCommand("mod", ["ban", user, length, "spam"])
        assert.ok("error" in refused, length)
        assert.match(refused.error, /such as 7d or 1h30m/, length)
    }
    // A reason must start with a word, so a number, or a number behind quotes or brackets, is refused with the way out
    for (const words of [
        ["2", "accounts"],
        ["3", "strikes"],
        ["24/7", "spam"],
        ["1st", "warning"],
        ["2fa", "required"],
        ["7", "days", "spam"],
        ["1", "week"],
        ["30", "min", "spam"],
        ["1.5", "h", "spam"],
        [" 7d", "spam"],
        [" 7 days", "spam"],
        ["“7 days”", "spam"],
        ["“7d”", "spam"],
        ["`7d`", "spam"],
        ["(7d)", "spam"],
        ["‘7d’"],
        ["½h", "spam"],
        ["½", "day", "spam"],
        ["¼d", "spam"],
        ["⁷d"],
        ["①d", "spam"],
        ["😀", "spam"],
        ["[7d]"],
        ["1,5d", "spam"],
        ["7-day", "spam"],
    ]) {
        const refused = parseSafetyCommand("mod", ["ban", user, ...words])
        assert.ok("error" in refused, words.join(" "))
        assert.match(refused.error, /write a word first, such as `after 3 strikes`/, words.join(" "))
    }
    for (const words of [["spam"], ["Männer", "beleidigt"], ["raid", "with", "3", "alts"], ["after", "3", "strikes"]])
        assert.deepEqual(action("mod", "ban", user, ...words), {
            type: "ban",
            reason: words.join(" "),
            targetId: user,
        })
    // A length inside the reason is not read, and the reason after a case link must start with a letter too
    assert.deepEqual(action("mod", "ban", user, "case", "12", "spam", "for", "7d"), {
        type: "ban",
        reason: "spam for 7d",
        targetId: user,
        linkedCaseNo: 12,
    })
    for (const words of [
        ["case", "12", "7d", "spam"],
        ["case", "12", "½d", "spam"],
    ]) {
        const refused = parseSafetyCommand("mod", ["ban", user, ...words])
        assert.ok("error" in refused, words.join(" "))
        assert.match(refused.error, /write a word first/, words.join(" "))
    }
    // Only a ban, timeout or quarantine has a length
    assert.deepEqual(action("mod", "warn", user, "7d", "spam"), { type: "warn", reason: "7d spam", targetId: user })
    assert.deepEqual(action("mod", "kick", user, "1h", "spam"), { type: "kick", reason: "1h spam", targetId: user })
    assert.ok("error" in parseSafetyCommand("mod", ["timeout", user, "366d", "spam"]))
    assert.ok("error" in parseSafetyCommand("mod", ["timeout", user, "10", "spam"]))
    // Numbers have no leading zeros, and a bound is kept
    assert.deepEqual(parseSafetyCommand("mod", ["show", "7"]), {
        kind: "query",
        operation: { type: "case-show", caseNo: 7 },
        private: true,
    })
    for (const [name, args] of [
        ["mod", ["show", "07"]],
        ["defcon", ["set", "4"]],
        ["mod", ["purge", "101", "spam"]],
        ["security", ["joins", "threshold", "1"]],
        ["security", ["joins", "window", "301"]],
        ["automod", ["update", "spam", "priority", "-101"]],
    ] as const)
        assert.ok("error" in parseSafetyCommand(name, args))
    assert.deepEqual(parseSafetyCommand("automod", ["update", "spam", "priority", "-100"]), {
        kind: "manage",
        operation: { type: "rule-update", name: "spam", patch: { priority: -100 } },
    })
})

test("a dry-run log grant records a finding without target membership or hierarchy and backend gate failure blocks public work", async () => {
    const f = createFixtures()
    const b = boundary({
        evaluate: (input) => {
            const result = caseGrant({
                serverId: input.serverId,
                messageId: input.messageId,
                createdAt: input.createdAt,
                actor: {
                    userId: input.context.botId,
                    roleIds: [],
                    isOwner: false,
                    isAdministrator: true,
                    nativePermissionAuthorized: true,
                },
                operation: {
                    type: "action",
                    action: { type: "log", targetId: input.userId, reason: "dry-run match" },
                    context: input.context,
                },
            })
            return Effect.succeed({
                duplicate: false,
                blocked: false,
                case: { ...result.case, origin: "automod" },
                grant: result.grant!,
                ...(input.gate ? { gate: b.gate(input.gate) } : {}),
            })
        },
    })
    b.current.automodEnabled = true
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, "ordinary flagged message")
                assert.equal(
                    (b.calls.find((call) => call.method === "outcome")?.input as ModerationOutcomeRequest).outcome,
                    "succeeded",
                )
                assert.equal(p.actor.requests().length, 1)
                assert.equal(p.replies.requests().length, 0)
                // While protection is on the evaluation answers the gate, and a failed evaluation falls back to the gate itself
                b.store.evaluate = () => Effect.fail(new ModerationStoreError({ operation: "evaluate", status: null }))
                b.store.gate = () => Effect.fail(new ModerationStoreError({ operation: "gate", status: null }))
                yield* emit(bot, "!ping")
                assert.equal(p.replies.requests().length, 0)
                assert.equal(bot.failures().length, 1)
            }),
        ),
    )
})

test("durable DEFCON presence is restored before gateway Identify, and normal mode explicitly clears an absent custom status", async () => {
    for (const level of [1, 2, 3] as const) {
        const f = createFixtures()
        const b = boundary()
        b.current.defcon = level
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    yield* bot.ready()
                    const identify = bot.commands().find((command) => command.op === 2)?.d as {
                        presence?: { status: string; custom_status: unknown }
                    }
                    assert.equal(identify.presence?.status, level === 3 ? "online" : "dnd")
                    assert.deepEqual(identify.presence?.custom_status, level === 3 ? null : { text: `DEFCON ${level}` })
                    assert.equal(b.calls[0]?.method, "observe")
                }),
            ),
        )
    }
})

test("an unreadable DEFCON state shows do not disturb with no custom status text", async () => {
    const f = createFixtures()
    const b = boundary({ observe: () => Effect.fail(new ModerationStoreError({ operation: "observe", status: null })) })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                yield* bot.ready()
                const identify = bot.commands().find((command) => command.op === 2)?.d as {
                    presence?: { status: string; custom_status: unknown }
                }
                assert.equal(identify.presence?.status, "dnd")
                assert.equal(identify.presence?.custom_status, null)
            }),
        ),
    )
})

test("cases and appeals staff without timeout permission can read their class and are denied an unconfigured class", async () => {
    for (const staffClass of ["cases", "appeals"] as const) {
        const f = createFixtures()
        let currentRole = ""
        const b = boundary({
            query: (input) => {
                if (!input.actor.roleIds.some((role) => b.current.staffRoleIds.cases.includes(role)))
                    return Effect.fail(new ModerationStoreError({ operation: "query", status: 403 }))
                assert.equal(input.actor.nativePermissionAuthorized, true)
                return Effect.succeed({ type: "cases", cases: [] })
            },
            staffAppeal: (input) => {
                if (!input.actor.roleIds.some((role) => b.current.staffRoleIds.appeals.includes(role)))
                    return Effect.fail(new ModerationStoreError({ operation: "staff", status: 403 }))
                assert.equal(input.actor.nativePermissionAuthorized, true)
                return Effect.succeed({ duplicate: false, type: "appeals", appeals: [] })
            },
        })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot, { actorOwner: false, actorPermissions: 0n })
                    currentRole = p.actorRole.id
                    b.current.staffRoleIds[staffClass] = [currentRole]
                    yield* bot.ready()
                    yield* emit(bot, staffClass === "cases" ? "!mod list" : "!appeal review")
                    assert.ok(bodies(p).some((body) => /sent by DM$/.test(body.content ?? "")))
                    yield* emit(bot, staffClass === "cases" ? "!appeal review" : "!mod list")
                    assert.match(bodies(p).at(-1)!.content, /current permissions/)
                    assert.equal(bot.failures().length, 0)
                }),
            ),
        )
    }
})

test("a protection failure skips public replies for the message without failing the event", async () => {
    const f = createFixtures()
    let evaluations = 0
    const b = boundary({
        evaluate: () => {
            evaluations++
            return Effect.fail(new ModerationStoreError({ operation: "evaluate", status: null }))
        },
    })
    b.current.automodEnabled = true
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                yield* bot.ready()
                yield* emit(bot, "!ping")
                assert.equal(evaluations, 1)
                assert.equal(p.replies.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("messages with an unchanged DEFCON level do not resend presence", async () => {
    const f = createFixtures()
    const b = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                platform(bot)
                yield* bot.ready()
                const updates = () => bot.commands().filter((command) => command.op === 3).length
                // The SDK flushes the startup presence on its own pacing, so counting starts after one handled message
                yield* emit(bot, "first message")
                const before = updates()
                yield* emit(bot, "ordinary message")
                yield* emit(bot, "another ordinary message")
                assert.equal(updates(), before)
            }),
        ),
    )
})

test("each safety status command shows its own feature, and !appeal status shows appeals only", async () => {
    const f = createFixtures()
    const b = boundary(),
        query = b.store.query
    // Only !appeal status asks the backend to count open appeals
    let open: { openAppeals: number; moreOpenAppeals?: true } = { openAppeals: 2 }
    b.store.query = (input) =>
        input.operation.type === "settings" && input.operation.appeals
            ? Effect.succeed({ type: "settings", settings: b.current, ...open })
            : query(input)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot)
                b.current.staffRoleIds.appeals = [p.actorRole.id]
                b.current.honeypotChannelIds = [f.ids.channel]
                yield* bot.ready()
                const status = (content: string) =>
                    Effect.gen(function* () {
                        yield* emit(bot, content)
                        return bodies(p).at(-1)!.embeds![0]!
                    })
                assert.deepEqual(yield* status("!appeal status"), {
                    color: 0x5560e6,
                    title: "Appeals",
                    fields: [
                        { name: "Status", value: "On" },
                        { name: "Reviewers", value: `<@&${p.actorRole.id}>` },
                        {
                            name: "Waiting for review",
                            value: "2. Run `!appeal review` for the list, sent by DM. List them with `!appeal review open`",
                        },
                    ],
                })
                // Zero reads as a number, and a count past the exact limit says so
                open = { openAppeals: 0 }
                assert.equal(
                    (yield* status("!appeal status")).fields!.at(-1)!.value,
                    "0. Run `!appeal review` for the list, sent by DM",
                )
                open = { openAppeals: 1000, moreOpenAppeals: true }
                assert.equal(
                    (yield* status("!appeal status")).fields!.at(-1)!.value,
                    "More than 1000. Run `!appeal review` for the list, sent by DM. List them with `!appeal review open`",
                )
                const fields = (embed: Embed) => Object.fromEntries(embed.fields!.map((x) => [x.name, x.value]))
                const automod = yield* status("!automod status")
                assert.equal(automod.title, "Automod")
                assert.deepEqual(fields(automod), {
                    Status: "Off",
                    Mode: "Test mode (logs only, no action)",
                    "Bot and webhook messages": "Not checked",
                    "Automod staff": "Owner and Administrators only",
                    Rules: "`!automod list`",
                })
                // Security status is three lines, with its staff only when set
                assert.deepEqual(yield* status("!security status"), {
                    color: 0x5560e6,
                    title: "Security",
                    description: "Off\nJoin protection off\nHoneypots off, watchlist off",
                })
                Object.assign(b.current, {
                    securityEnabled: true,
                    joinEnabled: true,
                    joinDefcon2: true,
                    honeypotEnabled: true,
                    staffRoleIds: { ...b.current.staffRoleIds, security: [p.actorRole.id] },
                })
                assert.equal(
                    (yield* status("!security status")).description,
                    [
                        "On, test mode (logs only, no action)",
                        "Join protection on at 5 joins in 10 seconds, and a join burst sets DEFCON 2",
                        `Honeypots on in <#${f.ids.channel}>, watchlist off`,
                        `Security staff: <@&${p.actorRole.id}>`,
                    ].join("\n"),
                )
                Object.assign(b.current, {
                    securityEnabled: false,
                    joinEnabled: false,
                    joinDefcon2: false,
                    honeypotEnabled: false,
                    staffRoleIds: { ...b.current.staffRoleIds, security: [] },
                })
                assert.deepEqual(yield* status("!security honeypot list"), {
                    color: 0x5560e6,
                    title: "Honeypots",
                    fields: [
                        { name: "Status", value: "Off" },
                        { name: "Channels", value: `<#${f.ids.channel}>` },
                    ],
                })
                assert.deepEqual(fields(yield* status("!defcon status")), { Level: "3: Normal operation" })
                assert.equal((yield* status("!defcon diagnose")).title, "DEFCON check")
                assert.deepEqual(fields(yield* status("!logs status")), {
                    "Log channel": "Not set. Run `!logs channel #channel`",
                    "Case readers": "Owner and Administrators only",
                })
                const mod = yield* status("!mod status")
                assert.deepEqual(
                    [mod.title, mod.fields![0]!.name, fields(mod).Status, fields(mod)["Appeal reviewers"]],
                    ["Moderation", "Status", "On", `<@&${p.actorRole.id}>`],
                )
                // No status mentions another feature's settings
                for (const body of bodies(p)) assert.equal(body.content, undefined)
                assert.ok(!shown(bodies(p)[0]).match(/DEFCON|Automod|Security|Log channel/))
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
