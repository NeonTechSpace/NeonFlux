import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import { tokenHash } from "../convex/dashboard.ts"
import { RECOVERY_PER_SOURCE, RECOVERY_SETTLED_MS } from "../convex/recovery.ts"
import type { RecoveryInbox } from "../dashboard-contracts.js"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"

const modules = {
    "../convex/recovery.ts": () => import("../convex/recovery.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET"] as const
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const now = Date.parse("2026-10-01T00:00:00Z"), hour = 3600000
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-recovery-secret-0000000000000000"
    mock.method(Date, "now", () => now)
})
afterEach(() => {
    mock.restoreAll()
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})
const backend = () => convexTest({ schema, modules, transactionLimits: true })
async function session(t: ReturnType<typeof backend>) {
    const sessionToken = "a".repeat(64)
    await t.run(async ctx => { await ctx.db.insert("dashboardSessions", { tokenHash: await tokenHash(sessionToken), accessToken: "synthetic-sealed-token", userId: "20", userName: "Synthetic manager",
        servers: [{ id: "10", name: "Synthetic server" }], expiresAt: now + hour, lifetimeAt: now + 24 * hour }) })
    return { sessionToken, serverId: "10" }
}

test("the recovery inbox collects open and recent problems from each source, current state first and then newest first", async () => {
    const t = backend(), args = await session(t)
    await t.run(async ctx => {
        // An unknown send waits for reconcile, a reconciled one and an old failure do not show
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 7, action: "send", outcome: "uncertain", unresolved: true, createdAt: now - 3 * hour, forumPostName: "Synthetic post" })
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 6, action: "send", outcome: "uncertain", unresolved: false, createdAt: now - 4 * hour })
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 5, action: "edit", outcome: "failed", unresolved: false, createdAt: now - RECOVERY_SETTLED_MS - hour })
        // Schedule entries name their schedule, and a post whose schedule was forgotten has nothing left to recheck
        await insertDocument(ctx, "schedules", "10", { scheduleNo: 2, name: "news" })
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 8, action: "send", outcome: "uncertain", unresolved: true, createdAt: now - hour, consumer: { type: "schedule", scheduleNo: 2, planRevision: 1, occurrenceNo: 3, deliveryId: "1" } })
        await insertDocument(ctx, "scheduleDeliveries", "10", { scheduleNo: 2, occurrenceNo: 4, channelId: "50", state: "blocked", active: true, dueAt: now - 1.5 * hour, nextCheckAt: now })
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 11, action: "send", outcome: "failed", unresolved: false, createdAt: now - 3.5 * hour, consumer: { type: "schedule", scheduleNo: 5, planRevision: 1, occurrenceNo: 1, deliveryId: "2" } })
        // An event post names its event, and one whose event was forgotten has nothing left to recheck
        await insertDocument(ctx, "events", "10", { eventNo: 3, name: "study" })
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 9, action: "send", outcome: "uncertain", unresolved: true, createdAt: now - 2.5 * hour, consumer: { type: "event", eventNo: 3, revision: 2, purpose: "card" } })
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 10, action: "send", outcome: "failed", unresolved: false, createdAt: now - 4.5 * hour, consumer: { type: "event", eventNo: 4, revision: 1, purpose: "reminder" } })
        // A suggestion card names the publication check and the reconcile command
        await insertDocument(ctx, "publishingAttempts", "10", { postNo: 12, action: "send", outcome: "uncertain", unresolved: true, createdAt: now - 2.75 * hour, consumer: { type: "suggestion-card", suggestionNo: 6, cardGeneration: 2, desiredRevision: 3 } })
        await insertDocument(ctx, "temporaryRoleGrants", "10", { userId: "30", roleId: "40", endsAt: now - 2 * hour, nextCheckAt: now + hour, updatedAt: now - 9 * hour, problem: "uncertain" })
        await insertDocument(ctx, "temporaryRoleGrants", "10", { userId: "31", roleId: "41", endsAt: now + hour, nextCheckAt: now + hour, updatedAt: now - 9 * hour })
        await insertDocument(ctx, "greetingDeliveries", "10", { deliveryNo: 4, route: "goodbye", userId: "32", state: "failed", reason: "configuration", createdAt: now - 5 * hour })
        await insertDocument(ctx, "tickets", "10", { ticketNo: 3, state: "uncertain", createdAt: now - 6 * hour })
        await insertDocument(ctx, "roleAttempts", "10", { userId: "33", roleId: "42", action: "add", consumerKey: "autorole:4", outcome: "uncertain", createdAt: now - 7 * hour })
        await insertDocument(ctx, "roleAttempts", "10", { userId: "34", roleId: "43", action: "add", consumerKey: "onboarding", outcome: "uncertain", createdAt: now - 7.5 * hour, dispatchExpiresAt: now - 7.5 * hour })
        // Metadata logs are on without a destination, so the feature needs setup
        await insertDocument(ctx, "metadataLogSettings", "10", { enabled: true, failed: 1, uncertain: 2 })
        await insertDocument(ctx, "dashboardSetupJobs", "10", { state: "done", createdAt: now - 8 * hour, expiresAt: now, checkedAt: now - 8 * hour, problems: [{ kind: "permissions", feature: "moderation", permissions: ["KickMembers"] }] })
    })
    const inbox = await t.query(api.recovery.inbox, args)
    const shown = inbox.entries.map(entry => entry.kind === "work" ? `${entry.source}: ${entry.summary} | ${entry.next}` : entry.kind === "setup" ? `setup: ${entry.problem.kind}` : `feature: ${entry.feature}`)
    assert.deepEqual(shown, [
        "feature: logs",
        "logs: Metadata logs: 1 delivery failed and 2 have an unknown outcome. Security alerts are delivered the same way | !logs events list, then !logs delivery show <record> or !logs delivery reconcile <record>",
        "schedules: Schedule news, delivery 3: NeonFlux could not confirm whether post 8 was sent | !publish schedule reconcile news 8",
        "schedules: Schedule news, delivery 4 is waiting: NeonFlux cannot post in channel 50 | Give NeonFlux View Channel, Send Messages and Embed Links in that channel. It tries again on its own",
        "temproles: Temporary role 40 of member 30: NeonFlux could not confirm the last role change | !temprole reconcile 30",
        "events: Event study card: NeonFlux could not confirm whether post 9 was sent | !event reconcile study 9",
        "suggestions: Suggestion 6 card: NeonFlux could not confirm whether post 12 was sent | !suggest publication 6, then !suggest reconcile 6",
        "publishing: Post 7: NeonFlux could not confirm whether it was sent as a forum post | !publish reconcile 7, or record what happened with !publish resolve 7 sent <message-id> or !publish resolve 7 failed",
        "schedules: Schedule 5, delivery 1: Post 11 could not be sent, and nothing changed | The schedule was forgotten, so NeonFlux cannot recheck the post. Check the channel in Fluxer if it matters",
        "events: Event 4 reminder: Post 10 could not be sent, and nothing changed | The event was forgotten, so NeonFlux cannot recheck the post. Check the channel in Fluxer if it matters",
        "greetings: Goodbye 4 for member 32: Not sent, configuration | !goodbye status 4. NeonFlux never sends a greeting twice",
        "tickets: Ticket 3: NeonFlux could not confirm whether its channel was created | !ticket reconcile 3, or !ticket abandon 3 if no channel was created",
        "roles: Member 33: NeonFlux could not confirm whether it gave role 42 | !autorole reconcile 33",
        "roles: Member 34: NeonFlux could not confirm whether it gave role 43 | NeonFlux never repeats the completion role. Check the member's roles in Fluxer and give the role by hand if it is missing",
        "setup: permissions",
    ])
    assert.equal(inbox.truncated, false)
    // The bot reads the same inbox for !recovery
    assert.deepEqual(await (await botCall(t, "/recovery/list", { serverId: "10" })).json(), inbox)
    await assert.rejects(t.query(api.recovery.inbox, { ...args, serverId: "11" }))
})

test("each source shows at most its newest entries", async () => {
    const t = backend(), args = await session(t)
    await t.run(async ctx => {
        for (let i = 0; i < RECOVERY_PER_SOURCE + 5; i++) await insertDocument(ctx, "publishingAttempts", "10", { postNo: i + 1, action: "send", outcome: "uncertain", unresolved: true, createdAt: now - hour + i })
    })
    const posts = (await t.query(api.recovery.inbox, args) as RecoveryInbox).entries.map(entry => entry.kind === "work" ? entry.summary.split(":")[0] : "")
    assert.deepEqual(posts, Array.from({ length: RECOVERY_PER_SOURCE }, (_, i) => `Post ${RECOVERY_PER_SOURCE + 5 - i}`))
})
