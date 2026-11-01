import assert from "node:assert/strict"
import test from "node:test"
import { defaultAntiNukeSettings } from "@neonflux/contracts/anti-nuke"
import type { ModerationManageRequest, ModerationOutcomeRequest } from "@neonflux/contracts/moderation"
import { defaultRightsSettings, type RightsSettings } from "@neonflux/contracts/rights"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, type Scope } from "effect"
import { TestClock } from "effect/testing"
import type { AntiNukeStore } from "../src/antinuke-store.ts"
import { createBotOptions } from "../src/bot.ts"
import { helpCard } from "../src/help.ts"
import { antiNukeFedAction } from "../src/moderation.ts"
import { parseSafetyCommand, safetyGateClass } from "../src/moderation-command.ts"
import type { ModerationStore } from "../src/moderation-store.ts"
import { ModerationStoreError } from "../src/moderation-store.ts"
import { parseRightsCommand } from "../src/rights-command.ts"
import { rightsCard } from "../src/rights-management.ts"
import { rememberRights, forgetRights, rightsHeldBy } from "../src/rights-memory.ts"
import type { RightsStore } from "../src/rights-store.ts"
import { renderText } from "../src/reply-style.ts"
import { boundary, caseGrant, platform, token } from "./moderation-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z")
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, overrides = {}) =>
    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...overrides })).pipe(Effect.andThen(bot.idle()))

function fakeRights(settings: Partial<RightsSettings> = {}) {
    const calls: { method: string; input: unknown }[] = []
    let current: RightsSettings = { ...defaultRightsSettings(), ...settings }
    const store: RightsStore = {
        get: (input) => {
            calls.push({ method: "get", input })
            return Effect.succeed({ settings: current })
        },
        status: (input) => {
            calls.push({ method: "status", input })
            return Effect.succeed({ settings: current, suspended: [], moreSuspended: false })
        },
        manage: (input) => {
            calls.push({ method: "manage", input })
            if (input.operation.type === "module") current = { ...current, enabled: input.operation.enabled }
            return Effect.succeed({ settings: current })
        },
        suspend: (input) => {
            calls.push({ method: "suspend", input })
            return Effect.succeed({ suspended: true, admitted: false })
        },
    }
    return { store, calls, set: (next: RightsSettings) => (current = next) }
}
function fakeAntiNuke(mode: "dry-run" | "enforce", opened: unknown[] = []) {
    const store: AntiNukeStore = {
        get: () => Effect.succeed({ settings: { ...defaultAntiNukeSettings(), enabled: true, mode } }),
        manage: () => Effect.succeed({ settings: defaultAntiNukeSettings() }),
        open: (input) => {
            opened.push(input)
            return Effect.succeed({
                claimed: true,
                incidentNo: opened.length,
                act: mode === "enforce",
                lockdown: false,
            })
        },
        finish: () => Effect.succeed({ recorded: true, admitted: false }),
        observe: () => Effect.succeed({ uncertain: 0, admitted: false }),
        incidents: () => Effect.succeed({ incidents: [], more: false }),
    }
    return { store, opened }
}
/** A server where the author has a staff role and no real permission, and the backend's answer is the test's to choose */
function start(
    manage: ModerationStore["manage"],
    run: (f: {
        bot: Bot
        p: ReturnType<typeof platform>
        outcomes: ModerationOutcomeRequest[]
        kicks: ReturnType<Bot["rest"]["respond"]>
        requests: ModerationManageRequest[]
    }) => Effect.Effect<void, unknown, Scope.Scope>,
    options: {
        rights?: ReturnType<typeof fakeRights>
        antiNuke?: ReturnType<typeof fakeAntiNuke>
        overrides?: Partial<ModerationStore>
        platform?: Parameters<typeof platform>[1]
    } = {},
) {
    const f = createFixtures()
    const outcomes: ModerationOutcomeRequest[] = [],
        requests: ModerationManageRequest[] = []
    const b = boundary({
        manage: (input) => {
            requests.push(input)
            return manage(input)
        },
        outcome: (input) => {
            outcomes.push(input)
            return Effect.succeed({ recorded: true })
        },
        ...options.overrides,
    })
    return controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token, serverId: f.ids.guild },
                    {
                        moderation: b.store,
                        ...(options.rights ? { rights: options.rights.store } : {}),
                        ...(options.antiNuke ? { antiNuke: options.antiNuke.store } : {}),
                    },
                ),
            )
            const p = platform(bot, { actorOwner: false, actorPermissions: 0n, ...options.platform })
            bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId }) })
            const kicks = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 })
            yield* bot.ready()
            yield* bot.idle()
            yield* run({ bot, p, outcomes, kicks, requests })
        }),
    )
}

const replies = (p: ReturnType<typeof platform>) =>
    p.replies.requests().map((request) => (request.body as { content: string }).content)

test("The grammar reads each form, and turning off, revoking and status stay reachable at DEFCON 1", () => {
    assert.deepEqual(parseRightsCommand(["on"]), { type: "change", operation: { type: "module", enabled: true } })
    assert.deepEqual(parseRightsCommand(["off"]), { type: "change", operation: { type: "module", enabled: false } })
    assert.deepEqual(parseRightsCommand(["grant", "<@&5>", "kick", "BAN", "kick"]), {
        type: "change",
        operation: { type: "grant", roleId: "5", rights: ["kick", "ban"] },
    })
    assert.deepEqual(parseRightsCommand(["revoke", "<@&5>"]), {
        type: "change",
        operation: { type: "revoke", roleId: "5" },
    })
    assert.deepEqual(parseRightsCommand(["revoke", "<@&5>", "jail"]), {
        type: "change",
        operation: { type: "revoke", roleId: "5", rights: ["jail"] },
    })
    assert.deepEqual(parseRightsCommand(["limit", "ban", "2", "30"]), {
        type: "change",
        operation: { type: "limit", right: "ban", count: 2, minutes: 30 },
    })
    assert.deepEqual(parseRightsCommand(["clear", "<@9>"]), {
        type: "change",
        operation: { type: "clear", userId: "9" },
    })
    assert.deepEqual(parseRightsCommand(["status"]), { type: "status" })
    for (const bad of [
        ["grant", "<@&5>"],
        ["grant", "<@&5>", "warn"],
        ["limit", "warn", "2", "30"],
        ["limit", "ban", "0", "30"],
        ["limit", "ban", "51", "30"],
        ["limit", "ban", "2", "1441"],
        ["clear"],
        ["maybe"],
    ])
        assert.ok("error" in parseRightsCommand(bad), bad.join(" "))
    const gate = (...args: string[]) => safetyGateClass("mod", parseSafetyCommand("mod", ["rights", ...args]))
    assert.equal(gate("off"), "critical")
    assert.equal(gate("revoke", "<@&5>"), "critical")
    assert.equal(gate("status"), "critical")
    assert.equal(gate("on"), "staff")
    assert.equal(gate("grant", "<@&5>", "kick"), "staff")
    assert.equal(gate("limit", "ban", "2", "30"), "staff")
    assert.equal(gate("clear", "<@9>"), "staff")
    assert.equal(safetyGateClass("mod", parseSafetyCommand("mod", ["unjail", "<@9>"])), "critical")
    assert.equal(safetyGateClass("mod", parseSafetyCommand("mod", ["jail", "<@9>"])), "staff")
})

test("A member with a staff role and no right gets exactly today's refusal, and no native call", async () => {
    await start(
        () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        ({ bot, p, kicks, requests, outcomes }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(requests[0]?.actor.nativePermissionAuthorized, false)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.length, 0)
                assert.equal(replies(p).at(-1), "Your current permissions or DEFCON mode do not allow this operation")
            }),
    )
})

test("The bot sends its fresh read as evidence, and a role ranked at or above NeonFlux is left out of it", async () => {
    await start(
        () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        ({ bot, p, requests }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod kick ${p.targetId}`)
                const context = (requests[0]!.operation as { context: { rightRoleIds?: string[] } }).context
                assert.deepEqual(context.rightRoleIds, [p.actorRole.id])
            }),
    )
    await start(
        () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        ({ bot, p, requests, kicks }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod kick ${p.targetId}`)
                const context = (requests[0]!.operation as { context: { rightRoleIds?: string[] } }).context
                assert.deepEqual(context.rightRoleIds, [])
                assert.equal(kicks.requests().length, 0)
            }),
        { platform: { actorPosition: 30 } },
    )
    // A member with the real permission acts natively and sends no evidence
    await start(
        () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        ({ bot, p, requests }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(requests[0]?.actor.nativePermissionAuthorized, true)
                const context = (requests[0]!.operation as { context: { rightRoleIds?: string[] } }).context
                assert.equal(context.rightRoleIds, undefined)
            }),
        { platform: { actorPermissions: Permissions.KickMembers } },
    )
})

test("A right the backend allowed acts, reads the actor again, and names the real member in the audit reason and staff log", async () => {
    let actorRole = ""

    await start(
        (input) =>
            Effect.succeed(
                caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole], reason: "synthetic reason" }),
            ),
        ({ bot, p, kicks, outcomes }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                const reads = p.actor.requests().length
                yield* emit(bot, `!mod kick ${p.targetId} synthetic reason`)
                assert.equal(kicks.requests().length, 1)
                assert.ok(p.actor.requests().length >= reads + 2, "the action read the actor once more")
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
                const reason = decodeURIComponent(String(kicks.requests()[0]!.headers["x-audit-log-reason"]))
                assert.equal(reason, `NeonFlux case 1, for member ${bot.fixtures.ids.user}`)
            }),
    )
})

test("The staff log shows the real member and the right they acted through", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                yield* emit(bot, `!mod kick ${p.targetId}`)
                const post = p.replies
                    .requests()
                    .map((request) => JSON.stringify(request.body))
                    .find((body) => body.includes("through the kick bot-only right"))
                assert.ok(post)
                assert.match(post, new RegExp(`<@${bot.fixtures.ids.user}>`))
            }),
        {
            overrides: {
                outcome: () =>
                    Effect.succeed({
                        recorded: true,
                        log: {
                            logId: "synthetic_log",
                            channelId: createFixtures().ids.channel,
                            caseNo: 1,
                            action: "kick",
                            outcome: "succeeded",
                            reason: "",
                        },
                    }),
            },
        },
    )
})

test("A member who loses the role between the command and the action acts on nothing: The fresh read wins", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, outcomes }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                let reads = 0
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.user}`, () => ({
                    body: bot.fixtures.member({
                        roles: ++reads === 1 ? [p.actorRole.id] : [],
                        communication_disabled_until: null,
                    }),
                }))
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "failed")
            }),
    )
})

test("A role moved above NeonFlux between the backend's answer and the action counts for nothing", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, outcomes }) =>
            Effect.gen(function* () {
                // The actor's role already ranks above NeonFlux here, whatever the backend was told before
                actorRole = p.actorRole.id
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "failed")
            }),
        { platform: { actorPosition: 30, targetPosition: 1 } },
    )
})

test("A target that ranks at or above the actor, or is protected, is refused again at the action", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, outcomes, requests }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                yield* emit(bot, `!mod kick ${p.targetId}`)
                const context = requests[0]!.operation as { context: { actorCanManageTarget: boolean } }
                assert.equal(context.context.actorCanManageTarget, false)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "failed")
            }),
        { platform: { targetPosition: 15 } },
    )
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, requests }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                yield* emit(bot, `!mod kick ${p.targetId}`)
                const context = requests[0]!.operation as { context: { targetProtected: boolean } }
                assert.equal(context.context.targetProtected, true)
                assert.equal(kicks.requests().length, 0)
            }),
        { platform: { targetPermissions: Permissions.Administrator } },
    )
})

test("A right turned off or suspended after the reservation sends nothing, and its outcome is recorded once", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, outcomes }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.length, 1)
                assert.equal(outcomes[0]?.outcome, "failed")
            }),
        { overrides: { dispatch: () => Effect.succeed({ recorded: false, rightWithdrawn: true }) } },
    )
})

test("Going over a limit replies what happened, and nothing is sent", async () => {
    await start(
        () =>
            Effect.succeed({
                duplicate: false,
                type: "right-refused",
                reason: "limit",
                right: "kick",
                admitted: false,
            }),
        ({ bot, p, kicks, outcomes }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.length, 0)
                assert.match(replies(p).at(-1)!, /went over the kick limit.*suspended/)
            }),
    )
})

test("An unknown outcome is not repeated, and the reply says who can check it", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, outcomes }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                const kicks = bot.rest.respond("DELETE /guilds/:id/members/:id", {
                    status: 500,
                    body: { code: "UNKNOWN", message: "Synthetic failure" },
                })
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length >= 1, true)
                assert.equal(outcomes.filter((outcome) => outcome.outcome === "uncertain").length, 1)
                assert.match(replies(p).at(-1)!, /Someone with the real permission can check it/)
            }),
    )
})

test("Each action through a right feeds anti-nuke, which suspends the member even in dry-run, and only then", async () => {
    let actorRole = ""
    const antiNuke = fakeAntiNuke("dry-run"),
        rights = fakeRights({ enabled: true })
    const user = createFixtures().ids.user
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                for (let index = 0; index < 9; index++) yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 9)
                assert.equal(antiNuke.opened.length, 0)
                assert.equal(rights.calls.filter((call) => call.method === "suspend").length, 0)
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(antiNuke.opened.length, 1)
                assert.deepEqual(rights.calls.find((call) => call.method === "suspend")?.input, {
                    serverId: bot.fixtures.ids.guild,
                    userId: user,
                })
                assert.equal((antiNuke.opened[0] as { actorId: string }).actorId, user)
            }),
        { antiNuke, rights },
    )
})

test("A completed action counts for anti-nuke even when its acknowledgement fails", async () => {
    let actorRole = ""
    const antiNuke = fakeAntiNuke("dry-run"),
        rights = fakeRights({ enabled: true })
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                for (let index = 0; index < 10; index++) yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 10)
                assert.equal(antiNuke.opened.length, 1)
                assert.equal(rights.calls.filter((call) => call.method === "suspend").length, 1)
            }),
        {
            antiNuke,
            rights,
            overrides: {
                outcome: () => Effect.fail(new ModerationStoreError({ operation: "outcome", status: 503 })),
            },
        },
    )
})

test("Anti-nuke firing on the server owner suspends nothing", async () => {
    const antiNuke = fakeAntiNuke("dry-run"),
        rights = fakeRights({ enabled: true })
    await start(
        (input) => Effect.succeed(caseGrant(input)),
        ({ bot }) =>
            Effect.gen(function* () {
                for (let index = 0; index < 12; index++)
                    yield* bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
                        guild_id: bot.fixtures.ids.guild,
                        id: bot.fixtures.nextId(),
                        action_type: 22,
                        user_id: bot.fixtures.ids.user,
                        target_id: bot.fixtures.nextId(),
                        changes: [],
                    })
                yield* bot.idle()
                assert.equal(rights.calls.filter((call) => call.method === "suspend").length, 0)
            }),
        { antiNuke, rights, platform: { actorOwner: true } },
    )
})

test("A timed-out member holds no right: The bot sends no evidence, and the action acts on nothing", async () => {
    const until = new Date(now + 3600000).toISOString()
    await start(
        () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        ({ bot, p, requests, kicks }) =>
            Effect.gen(function* () {
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.user}`, {
                    body: bot.fixtures.member({ roles: [p.actorRole.id], communication_disabled_until: until }),
                })
                yield* emit(bot, `!mod kick ${p.targetId}`, { guild_id: undefined, channel_id: p.dmId })
                const context = (requests[0]!.operation as { context: { rightRoleIds?: string[] } }).context
                assert.deepEqual(context.rightRoleIds, [])
                assert.equal(kicks.requests().length, 0)
            }),
    )
    // Timed out between the backend's answer and the action
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, outcomes }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                let reads = 0
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.user}`, () => ({
                    body: bot.fixtures.member({
                        roles: [p.actorRole.id],
                        communication_disabled_until: ++reads === 1 ? null : until,
                    }),
                }))
                yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "failed")
            }),
    )
})

test("A member with the real permission feeds only bans, kicks and unbans, which run under NeonFlux's name as well", async () => {
    const antiNuke = fakeAntiNuke("dry-run"),
        rights = fakeRights({ enabled: true })
    await start(
        (input) => Effect.succeed(caseGrant(input)),
        ({ bot, p, kicks }) =>
            Effect.gen(function* () {
                for (let index = 0; index < 10; index++) yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(kicks.requests().length, 10)
                assert.equal(antiNuke.opened.length, 1)
            }),
        { antiNuke, rights, platform: { actorPermissions: Permissions.KickMembers } },
    )
    assert.equal(antiNukeFedAction({ action: "timeout" }), undefined)
    assert.equal(antiNukeFedAction({ action: "timeout", viaRight: "timeout" }), "restrict")
})

test("NeonFlux stays exempt only for its own audit entries, whatever a member did through it", async () => {
    let actorRole = ""
    const antiNuke = fakeAntiNuke("dry-run")
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                for (let index = 0; index < 20; index++)
                    yield* bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
                        guild_id: bot.fixtures.ids.guild,
                        id: bot.fixtures.nextId(),
                        action_type: 20,
                        user_id: bot.fixtures.ids.bot,
                        target_id: p.targetId,
                        changes: [],
                    })
                yield* bot.idle()
                assert.equal(antiNuke.opened.length, 0)
                for (let index = 0; index < 10; index++) yield* emit(bot, `!mod kick ${p.targetId}`)
                assert.equal(antiNuke.opened.length, 1)
            }),
        { antiNuke },
    )
})

test("Enforcing anti-nuke's strip also takes the role that holds a right, which has no dangerous permission of its own", async () => {
    let actorRole = ""
    const antiNuke = fakeAntiNuke("enforce"),
        rights = fakeRights({ enabled: true })
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                rights.set({
                    ...defaultRightsSettings(),
                    enabled: true,
                    grants: [{ roleId: p.actorRole.id, rights: ["kick"] }],
                })
                rememberRights(bot.fixtures.ids.guild, {
                    ...defaultRightsSettings(),
                    enabled: true,
                    grants: [{ roleId: p.actorRole.id, rights: ["kick"] }],
                })
                const setRoles = bot.rest.respond("PATCH /guilds/:id/members/:id", {
                    body: bot.fixtures.member({ roles: [], communication_disabled_until: null }),
                })
                for (let index = 0; index < 10; index++) yield* emit(bot, `!mod kick ${p.targetId}`)
                const opened = antiNuke.opened[0] as { response: string; removedRoleIds: string[] }
                assert.equal(opened.response, "strip")
                assert.deepEqual(opened.removedRoleIds, [p.actorRole.id])
                assert.deepEqual((setRoles.requests()[0]?.body as { roles: string[] }).roles, [])
            }),
        { antiNuke, rights },
    )
})

test("A purge goes on only when memory shows the right, and the backend still decides: A stale copy deletes nothing", async () => {
    const f = createFixtures()
    await start(
        () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        ({ bot, p }) =>
            Effect.gen(function* () {
                const deletes = bot.rest.respond("POST /channels/:id/messages/bulk-delete", { status: 204 })
                const scan = bot.rest.respond("GET /channels/:id/messages", (request) => ({
                    body: request.query.before
                        ? []
                        : [bot.fixtures.message({ id: "5", author: bot.fixtures.user({ id: p.targetId }) })],
                }))
                // Memory off is today's refusal, with no read of the channel's messages
                yield* emit(bot, `!mod purge 5 ${p.targetId}`)
                assert.equal(scan.requests().length, 0)
                assert.match(replies(p).at(-1)!, /You need Manage messages/i)
                rememberRights(f.ids.guild, {
                    ...defaultRightsSettings(),
                    enabled: true,
                    grants: [{ roleId: p.actorRole.id, rights: ["purge"] }],
                })
                yield* emit(bot, `!mod purge 5 ${p.targetId}`)
                assert.ok(scan.requests().length > 0)
                assert.equal(deletes.requests().length, 0)
                assert.equal(replies(p).at(-1), "Your current permissions or DEFCON mode do not allow this operation")
                forgetRights(f.ids.guild)
            }),
    )
})

test("A command in a DM acts on the server of its runtime, from that server's read of the member", async () => {
    let actorRole = ""
    await start(
        (input) => Effect.succeed(caseGrant(input, { viaRight: "kick", rightRoleIds: [actorRole] })),
        ({ bot, p, kicks, requests }) =>
            Effect.gen(function* () {
                actorRole = p.actorRole.id
                yield* emit(bot, `!mod kick ${p.targetId}`, { guild_id: undefined, channel_id: p.dmId })
                assert.equal(requests[0]?.actor.originServerId, bot.fixtures.ids.guild)
                assert.deepEqual(
                    (requests[0]!.operation as { context: { rightRoleIds?: string[] } }).context.rightRoleIds,
                    [p.actorRole.id],
                )
                assert.equal(kicks.requests().length, 1)
            }),
    )
})

test("Who may change rights is checked with a fresh read before the backend's own check", async () => {
    const rights = fakeRights()
    await start(
        () => Effect.never,
        ({ bot, p }) =>
            Effect.gen(function* () {
                yield* emit(bot, "!mod rights on")
                assert.match(replies(p).at(-1)!, /Only the server owner/)
                yield* emit(bot, `!mod rights grant <@&${p.actorRole.id}> kick`)
                assert.equal(rights.calls.filter((call) => call.method === "manage").length, 0)
            }),
        { rights, platform: { actorPermissions: Permissions.Administrator } },
    )
    await start(
        () => Effect.never,
        ({ bot, p }) =>
            Effect.gen(function* () {
                yield* emit(bot, "!mod rights off")
                yield* emit(bot, `!mod rights revoke <@&${p.actorRole.id}>`)
                assert.equal(rights.calls.filter((call) => call.method === "manage").length, 2)
            }),
        { rights, platform: { actorPermissions: Permissions.Administrator } },
    )
})

test("The owner's grant needs a role NeonFlux can see, and status lists who holds what", async () => {
    const rights = fakeRights({ enabled: true })
    await start(
        () => Effect.never,
        ({ bot, p }) =>
            Effect.gen(function* () {
                yield* emit(bot, "!mod rights grant <@&424242> kick")
                assert.match(replies(p).at(-1)!, /cannot see that role/)
                assert.equal(rights.calls.filter((call) => call.method === "manage").length, 0)
                yield* emit(bot, `!mod rights grant <@&${p.targetRole.id}> kick`)
                assert.equal(rights.calls.filter((call) => call.method === "manage").length, 1)
            }),
        { rights, platform: { actorOwner: true } },
    )
    const text = JSON.stringify(
        rightsCard(
            {
                settings: {
                    ...defaultRightsSettings(),
                    enabled: true,
                    grants: [{ roleId: "5", rights: ["kick", "ban"] }],
                    limits: { ...defaultRightsSettings().limits, ban: { count: 2, minutes: 30 } },
                },
                suspended: [{ userId: "9", reason: "limit", right: "ban", at: now }],
                moreSuspended: false,
            },
            "!",
        ),
    )
    assert.match(text, /<@&5>: kick, ban/)
    assert.match(text, /ban: 2 in 30m/)
    assert.match(text, /<@9>: went over the ban limit/)
    const [rendered] = renderText(
        rightsCard({ settings: defaultRightsSettings(), suspended: [], moreSuspended: false }, "!"),
    )
    assert.ok("content" in rendered! && rendered.content.split("\n").length <= 10)
})

test("Rights load once when a server starts, and an ordinary message costs no rights call", async () => {
    const rights = fakeRights()
    await start(
        (input) => Effect.succeed(caseGrant(input)),
        ({ bot }) =>
            Effect.gen(function* () {
                yield* TestClock.adjust("1 millis")
                yield* Effect.yieldNow
                assert.equal(rights.calls.length, 1)
                assert.equal(rights.calls[0]?.method, "get")
                yield* emit(bot, "just talking")
                assert.equal(rights.calls.length, 1)
            }),
        { rights },
    )
})

test("Help names what a member can do through a right, from memory", () => {
    const card = helpCard("!", new Set(["everyone"]), undefined, ["ban", "jail"])
    assert.equal(typeof card, "object")
    assert.match(JSON.stringify(card), /Through bot-only rights/)
    assert.match(JSON.stringify(card), /!mod ban, !mod unban, !mod jail, !mod unjail/)
    assert.doesNotMatch(JSON.stringify(helpCard("!", new Set(["everyone"]))), /bot-only/)
    rememberRights("77", { ...defaultRightsSettings(), enabled: true, grants: [{ roleId: "5", rights: ["kick"] }] })
    assert.deepEqual(rightsHeldBy("77", ["5", "6"]), ["kick"])
    assert.deepEqual(rightsHeldBy("78", ["5"]), [])
    rememberRights("77", { ...defaultRightsSettings(), enabled: false, grants: [{ roleId: "5", rights: ["kick"] }] })
    assert.deepEqual(rightsHeldBy("77", ["5"]), [])
    forgetRights("77")
})
