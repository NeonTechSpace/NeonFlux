import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect, Redacted } from "effect"
import type { DashboardMetadataJob, DashboardMetadataExecuteRequest } from "@neonflux/backend/dashboard-contracts"
import type { MetadataLogsSettings } from "@neonflux/backend/contracts"
import { processDashboardMetadataPass } from "../src/dashboard-metadata.ts"
import { metadataLogCategories } from "../src/metadata-log-command.ts"
import { platform, token } from "./moderation-fixture.ts"

test("Dashboard metadata uses actual Manage Server authority separately from its real destination owner", async t => {
    for (const scenario of ["enabled", "disabled", "revoked", "missing-embed", "malformed-account"] as const) await t.test(scenario, async st => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
            const p = platform(bot, { actorOwner: false, actorPermissions: scenario === "revoked" ? Permissions.ViewChannel : Permissions.ManageGuild | Permissions.ViewChannel | Permissions.SendMessages,
                botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks | Permissions.ReadMessageHistory,
                ...(scenario === "missing-embed" ? { channelDeny: Permissions.EmbedLinks } : {}) })
            p.guildRoute.remove()
            bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: p.targetId }) })
            bot.rest.respond(`GET /users/${f.ids.user}`, { body: { ...f.user(), bot: scenario === "malformed-account" ? null : undefined, system: undefined } })
            bot.rest.respond(`GET /users/${p.targetId}`, { body: f.user({ id: p.targetId, bot: undefined, system: undefined }) })
            const now = yield* Clock.currentTimeMillis
            const job: DashboardMetadataJob = { id: "synthetic_dashboard_metadata_job", actorId: f.ids.user, expectedConfigRevision: 0,
                operation: scenario === "disabled" ? { type: "event-route", eventType: "audit-entry:20", expectedRevision: 0, enabled: false }
                    : { type: "event-route", eventType: "audit-entry:20", expectedRevision: 0, enabled: true, channelId: f.ids.channel, ownerId: p.targetId },
                state: "queued", createdAt: now, expiresAt: now + 120000 }
            const settings: MetadataLogsSettings = { enabled: false, revision: 1, configRevision: 1, routes: metadataLogCategories.map(category => ({ category, revision: 1, enabled: false })),
                eventRoutes: [{ eventType: "audit-entry:20", revision: 1, enabled: scenario !== "disabled", ...(scenario !== "disabled" ? { channelId: f.ids.channel, ownerId: p.targetId } : {}) }],
                messageChannelIds: [], excludedChannelIds: [], retained: 0, admissions: 0, admissionWindowStartedAt: now, capacity: 10000, admissionCapacity: 10000, retentionMs: 2592000000, quotaPaused: false, refused: 0, suppressed: 0 }
            const executions: DashboardMetadataExecuteRequest[] = [], failures: unknown[] = []
            st.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
                const path = new URL(String(input)).pathname, request = JSON.parse(String(init?.body))
                if (path === "/dashboard-metadata/ready") return Response.json({ jobs: [job] })
                if (path === "/dashboard-metadata/fail") { failures.push(request); return Response.json(null) }
                assert.equal(path, "/dashboard-metadata/execute")
                executions.push(request)
                if (request.recipientOwner) assert.equal(request.recipientOwner.actor.userId, p.targetId)
                const accepted = request.managerAuthorized && (scenario === "disabled" || request.recipientOwner?.botAuthorized)
                return Response.json({ job: { ...job, state: accepted ? "applied" : "failed" }, settings: accepted ? settings : null })
            })
            yield* processDashboardMetadataPass({ token, serverId: f.ids.guild, backend: { siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic-dashboard-secret") } }, bot.client)
            if (scenario === "malformed-account") { assert.equal(executions.length, 0); assert.equal(failures.length, 1); return }
            assert.equal(executions.length, 1)
            const proof = executions[0]!
            assert.equal(proof.managerAuthorized, scenario !== "revoked")
            assert.equal(proof.originServerId, f.ids.guild)
            assert.equal(Object.hasOwn(proof, "context"), false)
            if (scenario === "disabled") assert.equal(proof.recipientOwner, undefined)
            else {
                assert.equal(proof.recipientOwner!.actor.isOwner, true)
                assert.deepEqual(new Set(proof.recipientOwner!.actor.roleIds), new Set([f.ids.guild, p.targetRole.id]))
                assert.equal(proof.recipientOwner!.actor.userId, p.targetId)
                assert.equal(proof.recipientOwner!.botAuthorized, scenario !== "missing-embed")
            }
            assert.equal(failures.length, 0)
            assert.equal(p.replies.requests().length, 0)
        })))
    })
})
