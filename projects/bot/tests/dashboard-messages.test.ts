import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect, Redacted } from "effect"
import type { DashboardMessageJob } from "@neonflux/backend/dashboard-contracts"
import type { PublishingGrant } from "@neonflux/backend/contracts"
import { processDashboardMessagesPass } from "../src/dashboard-messages.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import { mockBackend } from "./backend-fake.ts"
import { platform, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

test("Standalone dashboard worker uses native manager, channel and embed authority and never replays reserved work", async t => {
    for (const scenario of ["send", "no-manager", "no-embed", "bot-no-send", "cross-server", "revoked-before-claim", "reserved"] as const) await t.test(scenario, async st => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-dashboard-message-token" }), f = bot.fixtures
            const permissions = Permissions.ViewChannel | Permissions.SendMessages | (scenario === "no-manager" ? 0n : Permissions.ManageGuild) | (scenario === "no-embed" ? 0n : Permissions.EmbedLinks)
            const p = platform(bot, { actorOwner: false, actorPermissions: permissions, botPermissions: scenario === "bot-no-send" ? Permissions.ViewChannel | Permissions.EmbedLinks : Permissions.Administrator })
            if (scenario === "cross-server") { p.channel.remove(); bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ guild_id: f.nextId() }) }) }
            const now = yield* Clock.currentTimeMillis, messageId = f.nextId()
            const job: DashboardMessageJob = { id: "synthetic_dashboard_message", actorId: f.ids.user, channelId: f.ids.channel, content: { content: "Announcement", embed: { title: "News", fields: [{ name: "Topic", value: "Details", inline: true }] } }, state: scenario === "reserved" ? "reserved" : "queued", createdAt: now, expiresAt: now + 120000 }
            const grant: PublishingGrant = { attemptId: "synthetic_dashboard_attempt", postNo: 1, generation: 1, sourceId: `dashboard_message_${job.id}`, actorId: f.ids.user, botId: f.ids.bot,
                action: "send", channelId: f.ids.channel, source: { type: "dashboard-message", jobId: job.id, createdAt: now }, provenance: { type: "dashboard-message", jobId: job.id },
                content: job.content, canonicalContent: canonicalPublishingContent(job.content), dispatchExpiresAt: job.expiresAt, nativeDeadlineMs: 5000 }
            const routes: string[] = []
            mockBackend(st, (call) => {
                const { path } = call, body = call.body as Record<string, unknown>
                routes.push(path)
                if (path === "/dashboard-messages/ready") return { jobs: [job] }
                if (path === "/dashboard-messages/reserve") {
                    assert.equal(body.managerAuthorized, true)
                    assert.equal(body.originServerId, f.ids.guild)
                    assert.equal(Object.hasOwn(body, "isAdministrator"), false)
                    if (scenario === "revoked-before-claim") {
                        p.rolesRoute.remove()
                        bot.rest.respond("GET /guilds/:id/roles", { body: p.roles.map(role => role.id === p.actorRole.id ? { ...role, permissions: "0" } : role) })
                    }
                    return { grant, attempt: null }
                }
                if (path === "/dashboard-messages/complete") return { job: { ...job, state: "sent", messageId } }
                if (path === "/dashboard-messages/fail") return null
                throw new Error("Unexpected dashboard message fixture route")
            })
            p.replies.remove()
            const send = bot.rest.respond("POST /channels/:id/messages", { body: f.message({ id: messageId, channel_id: f.ids.channel, author: f.botUser(), content: job.content.content, embeds: [{ type: "rich", ...job.content.embed }] }) })
            const remote = publishingBoundary({ dispatch: input => {
                assert.equal(input.dashboardContext?.managerAuthorized, true)
                assert.equal(input.dashboardContext?.jobId, job.id)
                return Effect.succeed({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })
            } })
            const config = { token, serverId: f.ids.guild, backend: { url: "https://synthetic-dashboard.convex.cloud", secret: Redacted.make("synthetic-dashboard-service-secret") } }
            yield* processDashboardMessagesPass(config, bot.client, remote.store)
            if (scenario === "send") {
                assert.deepEqual(routes, ["/dashboard-messages/ready", "/dashboard-messages/reserve", "/dashboard-messages/complete"])
                assert.equal(send.requests().length, 1)
                const payload = send.requests()[0]!.body as { content: string, embeds: object[], allowed_mentions: unknown }
                assert.equal(payload.content, job.content.content)
                assert.deepEqual(payload.embeds, [job.content.embed])
                assert.deepEqual(payload.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
                assert.equal(remote.calls.some(call => call.method === "query"), false)
                assert.equal(remote.calls.some(call => call.method === "outcome" && (call.input as { outcome: string }).outcome === "sent"), true)
            } else {
                assert.equal(send.requests().length, 0)
                assert.equal(remote.calls.some(call => call.method === "dispatch"), false)
                assert.equal(routes.includes("/dashboard-messages/reserve"), scenario === "revoked-before-claim")
                if (scenario === "reserved") assert.deepEqual(routes, ["/dashboard-messages/ready", "/dashboard-messages/complete"])
                else if (scenario === "revoked-before-claim") {
                    assert.equal(routes.at(-1), "/dashboard-messages/complete")
                    assert.equal(remote.calls.some(call => call.method === "outcome" && (call.input as { outcome: string }).outcome === "failed"), true)
                }
                else assert.equal(routes.at(-1), "/dashboard-messages/fail")
            }
        })))
    })
})
