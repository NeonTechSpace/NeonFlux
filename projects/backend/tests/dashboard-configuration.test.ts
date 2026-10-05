import assert from "node:assert/strict"
import { test, beforeEach, afterEach, mock } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import type { DashboardConfigurationFamily, DashboardConfigurationOperationMap } from "@neonflux/contracts/dashboard"
import { EVENTS_DESCRIPTION_LIMIT } from "@neonflux/contracts/events"
import { validateEventCalendar } from "../convex/eventsDomain.ts"
import { resolveCivilInstant } from "../convex/civilDomain.ts"
import { backupWriteConfig } from "../convex/backupWrites.ts"
import { configurationNativeTarget } from "../convex/configurationNative.ts"
import { botCall } from "./bot-service.ts"

const modules = Object.fromEntries(
    [
        "dashboard",
        "dashboardConfiguration",
        "dashboardRoles",
        "dashboardMetadata",
        "dashboardMessages",
        "generalSettings",
        "responses",
        "moderation",
        "publishing",
        "greetings",
        "tickets",
        "leveling",
        "milestones",
        "suggestions",
        "cleanup",
        "events",
        "eventsWork",
        "eventsDelivery",
        "schedules",
        "schedulesWork",
        "metadataLogs",
        "botService",
        "_generated/api",
        "_generated/server",
    ].map((name) => [
        `../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`,
        () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`),
    ]),
)
const prior = { ...process.env },
    now = Date.parse("2026-01-01T00:00:00Z"),
    secret = "synthetic-dashboard-configuration-test-secret"
beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = secret
    delete process.env.NEONFLUX_SERVER_MODE
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer")
            return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me"))
            return Response.json({
                application: { id: "30" },
                scopes: ["identify", "guilds"],
                user: { id: "20", username: "Manager", bot: false, system: false },
            })
        if (url.endsWith("/v1/users/@me/guilds?limit=100"))
            return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"])
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const manager = {
        originServerId: "10",
        userId: "20",
        roleIds: [],
        isOwner: false,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    },
    owner = { ...manager, userId: "99", isOwner: true }
const member = (userId: string) => ({
    userId,
    joinedAt: "2020-01-01T00:00:00Z",
    roleIds: [],
    isBot: false,
    timeoutUntil: null,
    canView: true,
    canReadHistory: true,
})
const context = (channelId = "50") => ({
    observedAt: now,
    actor: owner,
    channelId,
    botId: "999",
    botAuthorized: true,
    actorAuthorized: true,
    member: member("99"),
})
async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }),
        session = await t.action(api.dashboard.admit, { accessToken: "synthetic-config-provider-token" }),
        args = { sessionToken: session.sessionToken, serverId: "10" }
    let sequence = 0
    const snapshot = (family: DashboardConfigurationFamily, cursors?: unknown) =>
        t.query(api.dashboardConfiguration.snapshot, { ...args, family, ...(cursors ? { cursors } : {}) })
    const queue = async <F extends DashboardConfigurationFamily>(
        family: F,
        operation: DashboardConfigurationOperationMap[F],
        expectedConfigRevision?: number,
    ) =>
        t.action(api.dashboardConfiguration.queue, {
            ...args,
            family,
            operation,
            expectedConfigRevision: expectedConfigRevision ?? (await snapshot(family)).configRevision,
            requestId: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        })
    const execute = async (jobId: string, extra: Record<string, unknown> = {}) => {
        const response = await botCall(t, "/dashboard-configuration/execute", {
            serverId: "10",
            originServerId: "10",
            jobId,
            actorId: "20",
            managerAuthorized: true,
            observedAt: now,
            actor: manager,
            ...extra,
        })
        const body = await response.json()
        assert.equal(response.status, 200, JSON.stringify(body))
        return body
    }
    const apply = async <F extends DashboardConfigurationFamily>(
        family: F,
        operation: DashboardConfigurationOperationMap[F],
        extra: Record<string, unknown> = {},
    ) => {
        const job = await queue(family, operation)
        assert(job.jobId)
        const result = await execute(job.jobId, extra)
        assert.equal(result.job.state, "applied")
        return result
    }
    const references = (channelIds: string[] = [], roleIds: string[] = []) => [
        ...channelIds.map((id) => ({ id, type: "channel", serverId: "10", exists: true })),
        ...roleIds.map((id) => ({ id, type: "role", serverId: "10", exists: true })),
    ]
    return { t, args, snapshot, queue, execute, apply, references }
}
test("All eleven configuration families accept real Manager authority and expose authored definitions only", async () => {
    const f = await fixture()
    for (const family of [
        "responses",
        "moderation",
        "publishing",
        "greetings",
        "tickets",
        "leveling",
        "milestones",
        "suggestions",
        "cleanup",
        "events",
        "schedules",
    ] as const)
        assert.equal((await f.snapshot(family)).configRevision, 0)
    await f.apply("responses", {
        kind: "custom",
        operation: {
            type: "definition-create",
            definition: {
                name: "hello",
                reply: { type: "text", text: "Hello" },
                channelIds: [],
                roleIds: [],
                cooldownSeconds: 15,
                priority: 0,
                enabled: true,
            },
        },
    })
    await f.apply("moderation", {
        type: "rule-create",
        rule: {
            name: "spam",
            type: "spam",
            enabled: true,
            priority: 0,
            action: "delete",
            threshold: 3,
            windowSeconds: 10,
            durationSeconds: 30,
            patterns: [],
            domainMode: "block",
            channelIds: [],
            exemptChannelIds: [],
            exemptRoleIds: [],
        },
    })
    await f.apply("moderation", { type: "rule-update", name: "spam", patch: { threshold: 5 } })
    await f.apply("moderation", { type: "watchlist-add", userId: "70", reason: "Synthetic authored reason" })
    await f.apply("publishing", {
        type: "draft-create",
        kind: "template",
        name: "welcome",
        content: { content: "Hello {user.name}" },
    })
    await f.apply(
        "greetings",
        {
            type: "configure",
            route: "welcome",
            channelId: "50",
            templateName: "welcome",
            expectedTemplateRevision: 1,
            timing: "join",
        },
        { context: { ...context(), actor: manager, member: member("20") }, references: f.references(["50"]) },
    )
    const ticket = {
        observedAt: now,
        actor: { ...manager, ...member("20"), privateChannelVerified: false, canSend: true },
        botId: "999",
        botAuthorized: true,
    }
    await f.apply(
        "tickets",
        {
            type: "category-create",
            name: "support",
            visibility: "private",
            description: "",
            parentId: null,
            supportRoleIds: [],
        },
        { context: ticket, roles: [] },
    )
    await f.apply("leveling", { type: "settings", expectedRevision: 1, patch: { xpPerMessage: 25 } })
    await f.apply("milestones", { type: "settings", expectedRevision: 1, enabled: true })
    await f.apply(
        "suggestions",
        { type: "configure", expectedRevision: 1, channelId: "50", ownerId: "99" },
        { context: context(), references: f.references(["50"]) },
    )
    const cleanup = {
        ...context(),
        channelType: 0,
        actorKind: "human",
        botKind: "bot",
        botMember: { ...member("999"), isBot: true },
    }
    await f.apply(
        "cleanup",
        { type: "configure", channelId: "50", ownerId: "99", expectedRevision: 0, ageMs: 3600000 },
        { context: cleanup, references: f.references(["50"]) },
    )
    await f.apply(
        "events",
        { type: "create", name: "event", title: "Event", description: "", channelId: "50", ownerId: "99" },
        { context: context(), references: f.references(["50"]) },
    )
    await f.apply(
        "events",
        {
            type: "content",
            eventNo: 1,
            expectedRevision: 1,
            title: "Event",
            description: "x".repeat(EVENTS_DESCRIPTION_LIMIT),
        },
        { context: context(), references: f.references(["50"]) },
    )
    const localMinute = "2026-01-02T10:00",
        resolved = resolveCivilInstant(localMinute, "UTC", "reject"),
        calendar = {
            localMinute,
            zone: "UTC",
            fold: "reject" as const,
            recurrence: { type: "none" as const },
            dates: [{ localMinute, dueAt: resolved.instantAt, offsetMinutes: resolved.offsetMinutes }],
        }
    await f.apply(
        "schedules",
        {
            type: "create",
            name: "daily",
            channelId: "50",
            source: { kind: "template", name: "welcome", revision: 1 },
            calendar: { localMinute, zone: "UTC", fold: "reject", recurrence: { type: "none" } },
        },
        { context: context(), references: f.references(["50"]), calendar },
    )
    const moderation = await f.snapshot("moderation")
    assert.equal(moderation.family, "moderation")
    if (moderation.family !== "moderation") throw new Error("Wrong family")
    assert.equal(moderation.data.rules[0]!.threshold, 5)
    assert.equal(moderation.data.watchlist[0]!.reason, "Synthetic authored reason")
    const all = await Promise.all(
        [
            "responses",
            "moderation",
            "publishing",
            "greetings",
            "tickets",
            "leveling",
            "milestones",
            "suggestions",
            "cleanup",
            "events",
            "schedules",
        ].map((family) => f.snapshot(family as DashboardConfigurationFamily)),
    )
    assert(all.every((section) => section.configRevision > 0))
    assert(!JSON.stringify(all).includes("synthetic-config-provider-token"))
    assert(!JSON.stringify(all).includes("targets"))
})
test("Immutable UUID retries, chat and backup drift, session revocation and native proof boundaries preserve newer configuration", async () => {
    const f = await fixture(),
        operation = { type: "settings" as const, expectedRevision: 1, patch: { xpPerMessage: 25 } },
        input = {
            ...f.args,
            family: "leveling" as const,
            operation,
            expectedConfigRevision: 0,
            requestId: "00000000-0000-4000-8000-111111111111",
        }
    const queued = await f.t.action(api.dashboardConfiguration.queue, input)
    assert(queued.jobId)
    await f.execute(queued.jobId)
    assert.equal((await f.t.action(api.dashboardConfiguration.queue, input)).jobId, queued.jobId)
    await assert.rejects(
        f.t.action(api.dashboardConfiguration.queue, {
            ...input,
            operation: { ...operation, patch: { xpPerMessage: 26 } },
        }),
    )
    const pending = await f.queue("responses", { kind: "custom", operation: { type: "module", enabled: false } })
    await f.t.mutation(internal.responses.manage, {
        request: {
            serverId: "10",
            messageId: "1000",
            createdAt: now,
            actorId: "99",
            adminAuthorized: true,
            kind: "custom",
            operation: { type: "create", name: "chat", reply: { type: "text", text: "Chat" } },
        },
    })
    assert.equal((await f.execute(pending.jobId!)).job.state, "conflict")
    const backupPending = await f.queue("responses", { kind: "auto", operation: { type: "module", enabled: false } })
    await f.t.run((ctx) =>
        backupWriteConfig(
            { ctx, serverId: "10", ownerId: "99", key: "backup:synthetic:1", roles: [], now },
            {
                family: "response",
                sourceId: "custom_restored",
                value: {
                    kind: "custom",
                    name: "restored",
                    reply: { type: "text", text: "Restored" },
                    channelIds: [],
                    roleIds: [],
                    cooldownSeconds: 0,
                    priority: 0,
                    enabled: true,
                },
            },
        ),
    )
    assert.equal((await f.execute(backupPending.jobId!)).job.state, "conflict")
    const own = await f.queue("events", {
        type: "create",
        name: "owner",
        title: "Owner",
        channelId: "50",
        ownerId: "99",
    })
    await assert.rejects(
        f.t.mutation(internal.dashboardConfiguration.execute, {
            request: {
                serverId: "10",
                jobId: own.jobId,
                actorId: "20",
                managerAuthorized: true,
                observedAt: now,
                actor: manager,
                context: { ...context(), actor: manager },
                references: f.references(["50"]),
            },
        }),
    )
    await assert.rejects(
        f.t.action(api.dashboardConfiguration.queue, {
            ...input,
            requestId: "00000000-0000-4000-8000-222222222222",
            operation: { type: "settings", expectedRevision: 2, patch: { xpPerMessage: 30, unknown: true } },
            expectedConfigRevision: 1,
        }),
    )
    await f.t.mutation(internal.dashboard.revoke, { sessionToken: f.args.sessionToken })
    assert.equal(
        (await f.execute(own.jobId!, { context: context(), references: f.references(["50"]) })).job.state,
        "failed",
    )
})
test("Schedules and celebrations need Embed links only for content with an embed", async () => {
    const f = await fixture()
    await f.apply("publishing", { type: "draft-create", kind: "template", name: "text", content: { content: "Hello" } })
    await f.apply("publishing", {
        type: "draft-create",
        kind: "template",
        name: "rich",
        content: { content: "", embed: { title: "Notice" } },
    })
    const hasEmbed = <F extends DashboardConfigurationFamily>(
        family: F,
        operation: DashboardConfigurationOperationMap[F],
    ) => f.t.run(async (ctx) => (await configurationNativeTarget(ctx, "10", family, operation)).hasEmbed)
    const localMinute = "2026-01-02T10:00",
        resolved = resolveCivilInstant(localMinute, "UTC", "reject")
    const create = (name: string): DashboardConfigurationOperationMap["schedules"] => ({
        type: "create",
        name: "daily",
        channelId: "50",
        source: { kind: "template", name, revision: 1 },
        calendar: { localMinute, zone: "UTC", fold: "reject", recurrence: { type: "none" } },
    })
    assert.equal(await hasEmbed("schedules", create("text")), false)
    assert.equal(await hasEmbed("schedules", create("rich")), true)
    await f.apply("schedules", create("text"), {
        context: context(),
        references: f.references(["50"]),
        calendar: {
            localMinute,
            zone: "UTC",
            fold: "reject",
            recurrence: { type: "none" },
            dates: [{ localMinute, dueAt: resolved.instantAt, offsetMinutes: resolved.offsetMinutes }],
        },
    })
    assert.equal(
        await hasEmbed("schedules", { type: "destination", scheduleNo: 1, expectedRevision: 1, channelId: "51" }),
        false,
    )
    const configure = (name: string): DashboardConfigurationOperationMap["milestones"] => ({
        type: "configure",
        kind: "birthday",
        expectedRevision: 0,
        channelId: "50",
        zone: "UTC",
        time: "00:02",
        fold: "reject",
        template: { name, revision: 1 },
    })
    assert.equal(await hasEmbed("milestones", configure("text")), false)
    assert.equal(await hasEmbed("milestones", configure("rich")), true)
    // A greeting that keeps its saved version posts its saved text, even after an embed was added to the template
    const greeting: DashboardConfigurationOperationMap["greetings"] = {
        type: "configure",
        route: "welcome",
        channelId: "50",
        templateName: "text",
        expectedTemplateRevision: 1,
        timing: "join",
    }
    await f.apply("greetings", greeting, {
        context: { ...context(), actor: manager, member: member("20") },
        references: f.references(["50"]),
    })
    await f.apply("publishing", {
        type: "draft-set",
        kind: "template",
        name: "text",
        expectedRevision: 1,
        content: { content: "Hello", embed: { title: "Notice" } },
    })
    assert.equal(await hasEmbed("greetings", greeting), false)
    assert.equal(await hasEmbed("greetings", { type: "module", route: "welcome", enabled: true }), false)
    assert.equal(await hasEmbed("greetings", { ...greeting, expectedTemplateRevision: 2 }), true)
})
test("A dashboard honeypot change checks only the channels it adds, so a deleted saved channel does not block it", async () => {
    const f = await fixture()
    await f.apply(
        "moderation",
        { type: "settings", patch: { honeypotChannelIds: ["60", "61"] } },
        { references: f.references(["60", "61"]) },
    )
    // Channel 61 was deleted since, and the change adds 62
    const operation: DashboardConfigurationOperationMap["moderation"] = {
        type: "settings",
        patch: { honeypotChannelIds: ["60", "61", "62"] },
    }
    const target = await f.t.run((ctx) => configurationNativeTarget(ctx, "10", "moderation", operation))
    assert.deepEqual(target.channelIds, ["62"])
    await f.apply("moderation", operation, { references: f.references(["62"]) })
    const moderation = await f.snapshot("moderation")
    if (moderation.family !== "moderation") throw new Error("Wrong family")
    assert.deepEqual(moderation.data.settings.honeypotChannelIds, ["60", "61", "62"])
})
test("Dashboard event card grants retain the exact queue source and require both manager and organizer again at native claim", async () => {
    const f = await fixture()
    await f.apply("events", { type: "settings", expectedRevision: 1, enabled: true })
    await f.apply(
        "events",
        { type: "create", name: "card", title: "Card", channelId: "50", ownerId: "99" },
        { context: context(), references: f.references(["50"]) },
    )
    const localMinute = "2026-01-02T10:00",
        resolved = resolveCivilInstant(localMinute, "UTC", "reject"),
        calendar = validateEventCalendar(
            {
                localMinute,
                zone: "UTC",
                fold: "reject",
                durationMinutes: 60,
                recurrence: { type: "none" },
                dates: [
                    {
                        localMinute,
                        startsAt: resolved.instantAt,
                        endsAt: resolved.instantAt + 3600000,
                        offsetMinutes: resolved.offsetMinutes,
                    },
                ],
            },
            now,
        )
    const { dates, ...intent } = calendar
    await f.apply(
        "events",
        { type: "calendar", eventNo: 1, expectedRevision: 1, calendar: intent },
        { context: context(), references: f.references(["50"]), calendar },
    )
    const result = await f.apply(
            "events",
            { type: "publish", eventNo: 1, expectedRevision: 2 },
            { context: context(), references: f.references(["50"]) },
        ),
        grant = result.grant
    assert(grant)
    assert.equal(grant.sourceId, result.job.id)
    assert.deepEqual(grant.source, {
        type: "dashboard-configuration",
        family: "events",
        jobId: result.job.id,
        createdAt: now,
    })
    assert.equal(grant.actorId, "99")
    const claim = {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "a".repeat(32),
        eventContext: context(),
        dashboardContext: {
            jobId: result.job.id,
            actorId: "20",
            managerAuthorized: true,
            observedAt: now,
            botId: "999",
            channelId: "50",
        },
    }
    await assert.rejects(
        f.t.mutation(internal.publishing.dispatch, {
            request: { ...claim, dashboardContext: { ...claim.dashboardContext, managerAuthorized: false } },
        }),
    )
    await assert.rejects(
        f.t.mutation(internal.publishing.dispatch, {
            request: { ...claim, eventContext: { ...context(), actor: manager } },
        }),
    )
    assert.equal((await f.t.mutation(internal.publishing.dispatch, { request: claim })).claimed, true)
    assert.equal((await f.t.mutation(internal.publishing.dispatch, { request: claim })).claimed, false)
})
test("Scoped bounded authored pages cover both response kinds and moderation collections without private history", async () => {
    const f = await fixture()
    await f.t.run(async (ctx) => {
        for (let i = 0; i < 45; i++)
            await ctx.db.insert("responseDefinitions", {
                serverId: "10",
                kind: i < 24 ? "custom" : "auto",
                name: `item${String(i).padStart(2, "0")}`,
                reply: { type: "text", text: "Synthetic" },
                ...(i < 24 ? {} : { trigger: { mode: "exact", text: "Synthetic" } }),
                channelIds: [],
                roleIds: [],
                cooldownSeconds: 0,
                priority: 0,
                enabled: true,
                createdAt: now,
                updatedAt: now,
            })
        for (let i = 0; i < 24; i++)
            await ctx.db.insert("securityWatchlist", {
                serverId: "10",
                userId: String(100 + i),
                reason: "Synthetic authored reason",
                createdAt: now,
            })
    })
    // Both kinds share one list, so with more than a page of custom commands every autoresponder still arrives
    const responses = await f.snapshot("responses")
    if (responses.family !== "responses") throw new Error("Wrong family")
    assert.equal(responses.nextCursors?.definitions, undefined)
    assert.equal(responses.data.definitions.filter((row) => row.kind === "custom").length, 24)
    assert.equal(responses.data.definitions.filter((row) => row.kind === "auto").length, 21)
    const moderation = await f.snapshot("moderation")
    if (moderation.family !== "moderation") throw new Error("Wrong family")
    assert.equal(moderation.data.watchlist.length, 20)
    assert(moderation.nextCursors?.watchlist)
    await assert.rejects(f.snapshot("publishing", { drafts: moderation.nextCursors.watchlist }))
    const rest = await f.snapshot("moderation", { watchlist: moderation.nextCursors.watchlist })
    if (rest.family !== "moderation") throw new Error("Wrong family")
    assert.equal(rest.data.watchlist.length, 4)
})
test("Emergency disable remains available while changing DEFCON requires actual Owner or Administrator", async () => {
    const f = await fixture()
    await f.apply("publishing", { type: "settings", patch: { enabled: false } })
    await f.apply(
        "moderation",
        { type: "settings", patch: { defcon: 1 } },
        { actor: { ...manager, isAdministrator: true } },
    )
    await f.apply("publishing", { type: "settings", patch: { enabled: false } })
    await f.apply("leveling", { type: "settings", expectedRevision: 1, patch: { enabled: false } })
    await f.apply("leveling", { type: "mappings", expectedMappingRevision: 1, mappings: [] }, { roles: [] })
    const recovery = await f.queue("moderation", { type: "settings", patch: { defcon: 3 } })
    await assert.rejects(
        f.t.mutation(internal.dashboardConfiguration.execute, {
            request: {
                serverId: "10",
                jobId: recovery.jobId,
                actorId: "20",
                actor: manager,
                managerAuthorized: true,
                observedAt: now,
            },
        }),
    )
    const result = await f.execute(recovery.jobId!, { actor: { ...manager, isAdministrator: true } })
    assert.equal(result.job.state, "applied")
})
