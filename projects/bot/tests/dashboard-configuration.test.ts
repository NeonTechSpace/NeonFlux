import assert from "node:assert/strict"
import test from "node:test"
import type * as D from "@neonflux/backend/dashboard-contracts"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { mockBackend } from "./backend-fake.ts"
import { platform, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const now = Date.parse("2026-10-05T10:00:00Z")
const scalar: D.DashboardConfigurationOperation[] = [
    { family: "responses", operation: { kind: "custom", operation: { type: "module", enabled: true } } },
    { family: "moderation", operation: { type: "settings", patch: { manualModerationEnabled: true, staffRoleIds: { cases: [] } } } },
    { family: "publishing", operation: { type: "draft-set", kind: "template", name: "welcome", expectedRevision: 1, content: { content: "Welcome", embed: { title: "Hello" } } } },
    { family: "greetings", operation: { type: "settings", claimsPerMinute: 10, retentionDays: 180 } },
    { family: "tickets", operation: { type: "settings", enabled: true, retentionDays: 30 } },
    { family: "leveling", operation: { type: "settings", expectedRevision: 1, patch: { enabled: true, excludedChannelIds: [] } } },
    { family: "milestones", operation: { type: "settings", expectedRevision: 1, enabled: true } },
    { family: "suggestions", operation: { type: "settings", expectedRevision: 1, enabled: true } },
    { family: "cleanup", operation: { type: "module", expectedRevision: 1, enabled: true } },
    { family: "events", operation: { type: "settings", expectedRevision: 1, enabled: true } },
    { family: "schedules", operation: { type: "settings", expectedRevision: 1, enabled: true } },
]

async function run(t: test.TestContext, input: (ids: { user: string, channel: string, role: string }, owner: string) => { operation: D.DashboardConfigurationOperation, native?: D.DashboardConfigurationNativeTarget },
    scenario: "valid" | "revoked" | "malformed" | "foreign" | "missing-embed" = "valid") {
    const executions: D.DashboardConfigurationExecuteRequest[] = [], failures: unknown[] = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
        const p = platform(bot, { actorOwner: false, actorPermissions: scenario === "revoked" ? Permissions.ViewChannel : Permissions.ManageGuild | Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessages,
            botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory | Permissions.EmbedLinks | Permissions.ManageRoles | Permissions.ManageMessages,
            ...(scenario === "missing-embed" ? { channelDeny: Permissions.EmbedLinks } : {}) })
        p.guildRoute.remove()
        bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: p.targetId }) })
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: { ...f.user({ bot: undefined, system: undefined }), bot: scenario === "malformed" ? "false" : undefined } })
        bot.rest.respond(`GET /users/${p.targetId}`, { body: f.user({ id: p.targetId, bot: undefined, system: undefined }) })
        if (scenario === "foreign") bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ guild_id: f.nextId() }) })
        const selected = input({ ...f.ids, role: p.targetRole.id }, p.targetId)
        const job: D.DashboardConfigurationReadyJob = { ...selected.operation, native: selected.native ?? {}, id: "synthetic_configuration_job", actorId: f.ids.user,
            expectedConfigRevision: 0, state: "queued", createdAt: now, expiresAt: now + 120000 }
        mockBackend(t, (call) => {
            if (call.path === "/dashboard-configuration/ready") return { jobs: [job] }
            if (call.path === "/dashboard-configuration/fail") { failures.push(call.body); return null }
            assert.equal(call.path, "/dashboard-configuration/execute")
            executions.push(call.body as D.DashboardConfigurationExecuteRequest)
            const { native: _native, ...stored } = job
            return { job: { ...stored, state: "applied" } }
        })
        yield* processDashboardConfigurationPass({ token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic") } }, bot.client)
        assert.equal(p.replies.requests().length, 0)
        for (const execution of executions) {
            assert.equal(execution.actor.userId, f.ids.user)
            assert.equal(execution.actor.isAdministrator, false)
            assert.equal(execution.actor.isOwner, false)
            assert.equal(execution.managerAuthorized, true)
            assert.equal(execution.originServerId, f.ids.guild)
            assert.equal("messageId" in execution, false)
            if (selected.native?.ownerId) {
                assert.equal(execution.context!.actor.userId, p.targetId)
                assert.equal(execution.context!.actor.isOwner, true)
                assert.notEqual(execution.context!.actor.userId, execution.actor.userId)
            }
        }
    })).pipe(Effect.provide(TestClock.layer())))
    return { executions, failures }
}

test("Dashboard configuration applies all eleven finite families using real Manage Server authority", async t => {
    for (const operation of scalar) await t.test(operation.family, async st => {
        const result = await run(st, () => ({ operation }))
        assert.equal(result.executions.length, 1); assert.equal(result.failures.length, 0)
    })
})

test("A dashboard private data role change carries the bot's proof that the role exists", async t => {
    const result = await run(t, ids => ({ operation: { family: "moderation", operation: { type: "private-role", roleId: ids.role } }, native: { roleIds: [ids.role] } }))
    assert.equal(result.failures.length, 0)
    assert.deepEqual(result.executions.map(execution => execution.references?.map(({ type, exists }) => ({ type, exists }))), [[{ type: "role", exists: true }]])
})

test("Dashboard destination configuration preserves separate genuine action owners and rejects revoked or foreign facts", async t => {
    for (const family of ["cleanup", "suggestions", "schedules", "events", "milestones"] as const) await t.test(family, async st => {
        const result = await run(st, (ids, ownerId) => {
            const operation: D.DashboardConfigurationOperation = family === "cleanup" ? { family, operation: { type: "configure", channelId: ids.channel, ownerId, expectedRevision: 0, ageMs: 86400000 } }
                : family === "suggestions" ? { family, operation: { type: "configure", channelId: ids.channel, ownerId, expectedRevision: 1 } }
                    : family === "events" ? { family, operation: { type: "create", name: "meeting", title: "Meeting", channelId: ids.channel, ownerId } }
                        : family === "milestones" ? { family, operation: { type: "configure", kind: "birthday", channelId: ids.channel, expectedRevision: 0, zone: "Europe/Berlin", time: "10:00", fold: "reject", template: { name: "celebrate", revision: 1 } } }
                            : { family, operation: { type: "destination", scheduleNo: 1, expectedRevision: 1, channelId: ids.channel } }
            return { operation, native: { ...(family === "schedules" || family === "milestones" ? {} : { ownerId }), channelId: ids.channel, hasEmbed: true } }
        })
        assert.equal(result.executions.length, 1); assert.equal(result.failures.length, 0)
    })
    for (const scenario of ["revoked", "malformed", "foreign"] as const) await t.test(scenario, async st => {
        const result = await run(st, ids => ({ operation: scalar[1]!, native: { channelIds: [ids.channel] } }), scenario)
        assert.equal(result.executions.length, 0); assert.equal(result.failures.length, 1)
    })
    await t.test("protected recovery remains Owner/Admin", async st => {
        const result = await run(st, () => ({ operation: scalar[9]!, native: { requiresOwnerAdmin: true } }))
        assert.equal(result.executions.length, 0); assert.equal(result.failures.length, 1)
    })
})

test("Dashboard civil calendars resolve actual DST folds and reject gaps and caller-authored dates", async t => {
    for (const fold of ["earlier", "later", "reject"] as const) await t.test(fold, async st => {
        const result = await run(st, () => ({ operation: { family: "events", operation: { type: "calendar", eventNo: 1, expectedRevision: 1,
            calendar: { localMinute: "2026-10-25T02:30", zone: "Europe/Berlin", fold, recurrence: { type: "none" }, durationMinutes: 60 } } } }))
        if (fold === "reject") { assert.equal(result.executions.length, 0); assert.equal(result.failures.length, 1) }
        else {
            assert.equal(result.failures.length, 0)
            const calendar = result.executions[0]!.calendar as import("@neonflux/backend/contracts").EventsCalendar
            assert.equal(calendar.dates[0]!.startsAt, Date.parse(fold === "earlier" ? "2026-10-25T00:30:00Z" : "2026-10-25T01:30:00Z"))
        }
    })
    await t.test("gap", async st => {
        const result = await run(st, ids => ({ operation: { family: "schedules", operation: { type: "create", name: "meeting", channelId: ids.channel, source: { kind: "template", name: "meeting", revision: 1 },
            calendar: { localMinute: "2027-03-28T02:30", zone: "Europe/Berlin", fold: "earlier", recurrence: { type: "none" } } } } }))
        assert.equal(result.executions.length, 0); assert.equal(result.failures.length, 1)
    })
    await t.test("caller-authored resolved dates", async st => {
        await assert.rejects(run(st, () => ({ operation: { family: "events", operation: { type: "calendar", eventNo: 1, expectedRevision: 1,
            calendar: { localMinute: "2026-10-25T02:30", zone: "Europe/Berlin", fold: "earlier", recurrence: { type: "none" }, durationMinutes: 60,
                dates: [{ startsAt: 1, endsAt: 2 }] } as D.DashboardEventCalendar } } })))
    })
})

test("Dashboard event descriptions preserve the complete domain limit and empty edits while rejecting malformed or oversized jobs", async t => {
    for (const type of ["create", "content"] as const) for (const description of ["", "x".repeat(3500)]) await t.test(`${type} ${description.length}`, async st => {
        const result = await run(st, (ids, ownerId) => ({ operation: { family: "events", operation: type === "create"
            ? { type, name: "meeting", title: "Meeting", channelId: ids.channel, ownerId, description }
            : { type, eventNo: 1, expectedRevision: 1, title: "Meeting", description } },
            native: { channelId: ids.channel, ownerId, hasEmbed: true } }))
        assert.equal(result.executions.length, 1)
        assert.equal(result.failures.length, 0)
        assert.equal("description" in result.executions[0]!, false)
    })
    for (const description of ["x".repeat(3501), 123]) await t.test(typeof description === "number" ? "Malformed" : "Over limit", async st => {
        await assert.rejects(run(st, () => ({ operation: { family: "events", operation: { type: "content", eventNo: 1, expectedRevision: 1, title: "Meeting", description: description as string } } })))
    })
})

test("Dashboard native mappings and bot destinations validate scoped roles and exact permission requirements", async t => {
    await t.test("leveling hierarchy", async st => {
        const result = await run(st, ids => ({ operation: { family: "leveling", operation: { type: "mappings", expectedMappingRevision: 1, mappings: [{ level: 1, roleId: ids.role }] } }, native: { roleIds: [ids.role] } }))
        assert.equal(result.executions.length, 1); assert.equal(result.failures.length, 0)
        assert.equal(result.executions[0]!.roles!.find(role => role.roleId === result.executions[0]!.references![0]!.id)!.botCanManage, true)
    })
    await t.test("greetings bot destination", async st => {
        const result = await run(st, ids => ({ operation: { family: "greetings", operation: { type: "configure", route: "welcome", templateName: "welcome", expectedTemplateRevision: 1, channelId: ids.channel } }, native: { channelId: ids.channel, hasEmbed: true } }))
        assert.equal(result.executions.length, 1); assert.equal(result.failures.length, 0)
        assert.equal(result.executions[0]!.context!.actor.userId, result.executions[0]!.actorId)
        assert.equal(result.executions[0]!.context!.botAuthorized, true)
    })
    await t.test("missing Embed Links", async st => {
        const result = await run(st, (ids, ownerId) => ({ operation: { family: "suggestions", operation: { type: "configure", channelId: ids.channel, ownerId, expectedRevision: 1 } }, native: { ownerId, channelId: ids.channel, hasEmbed: true } }), "missing-embed")
        assert.equal(result.executions.length, 0); assert.equal(result.failures.length, 1)
    })
})

test("Dashboard event publication binds the job and freshly checks manager independently of action owner before one native send", async t => {
    for (const scenario of ["valid", "manager-revoked", "wrong-job"] as const) await t.test(scenario, async st => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
            const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageGuild | Permissions.ViewChannel | Permissions.SendMessages,
                botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks | Permissions.ReadMessageHistory })
            p.guildRoute.remove()
            bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: p.targetId }) })
            for (const userId of [f.ids.user, p.targetId]) bot.rest.respond(`GET /users/${userId}`, { body: f.user({ id: userId, bot: undefined, system: undefined }) })
            const job: D.DashboardConfigurationReadyJob = { family: "events", operation: { type: "publish", eventNo: 1, expectedRevision: 2 },
                native: { ownerId: p.targetId, channelId: f.ids.channel, hasEmbed: true }, id: "synthetic_event_job", actorId: f.ids.user,
                expectedConfigRevision: 0, state: "queued", createdAt: now, expiresAt: now + 120000 }
            const sourceJob = scenario === "wrong-job" ? "synthetic_wrong_job" : job.id
            const grant: C.EventsDeliveryGrant = { attemptId: "synthetic_event_attempt", postNo: 1, generation: 1, sourceId: sourceJob,
                actorId: p.targetId, botId: f.ids.bot, action: "send", channelId: f.ids.channel,
                source: { type: "dashboard-configuration", family: "events", jobId: sourceJob, createdAt: now },
                provenance: { type: "event", eventNo: 1, revision: 2 }, consumer: { type: "event", eventNo: 1, revision: 2, purpose: "card" },
                content: { content: "Meeting", embed: { title: "Meeting" } }, canonicalContent: { content: "Meeting", embed: { title: "Meeting", color: 0 } },
                dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000 }
            const failures: unknown[] = []
            mockBackend(st, (call) => {
                if (call.path === "/dashboard-configuration/ready") return { jobs: [job] }
                if (call.path === "/dashboard-configuration/fail") { failures.push(call.body); return null }
                assert.equal(call.path, "/dashboard-configuration/execute")
                if (scenario === "manager-revoked") {
                    p.rolesRoute.remove()
                    bot.rest.respond("GET /guilds/:id/roles", { body: p.roles.map(role => role.id === p.actorRole.id ? { ...role, permissions: "0" } : role) })
                }
                const { native: _native, ...stored } = job
                return { job: { ...stored, state: "applied" }, grant }
            })
            let dispatches = 0
            const remote = publishingBoundary({ dispatch: input => {
                dispatches++
                assert.equal(input.dashboardContext!.actorId, f.ids.user)
                assert.equal(input.dashboardContext!.jobId, job.id)
                assert.equal(input.dashboardContext!.managerAuthorized, true)
                assert.equal((input.eventContext as C.EventsContext).actor.userId, p.targetId)
                assert.equal((input.eventContext as C.EventsContext).actor.isOwner, true)
                return Effect.succeed({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })
            } })
            p.replies.remove()
            const send = bot.rest.respond("POST /channels/:id/messages", { body: f.message({ author: f.botUser(), content: "Meeting", embeds: [{ type: "rich", title: "Meeting", color: 0 }] }) })
            yield* processDashboardConfigurationPass({ token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic") } }, bot.client, remote.store)
            assert.equal(send.requests().length, scenario === "valid" ? 1 : 0)
            assert.equal(dispatches, scenario === "valid" ? 1 : 0)
            assert.equal(failures.length, scenario === "wrong-job" ? 1 : 0)
            if (scenario !== "wrong-job") {
                const outcome = remote.calls.find(call => call.method === "outcome")!.input as C.PublishingOutcomeRequest
                assert.equal(outcome.outcome, scenario === "valid" ? "sent" : "failed")
            }
        })).pipe(Effect.provide(TestClock.layer())))
    })
})
