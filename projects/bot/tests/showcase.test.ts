import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import type { ProfileStore } from "../src/profile-store.ts"
import type { ShowcaseStore } from "../src/showcase-store.ts"
import { parseShowcaseCommand } from "../src/showcase-command.ts"
import { parseProfileCommand } from "../src/profile-command.ts"
import { processShowcasePass } from "../src/showcase-worker.ts"
import { platform, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const access = { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] }
// An in-memory showcase boundary that answers start with the given result and keeps what the bot sent
function showcaseBoundary(jobs: C.ShowcaseJob[], start: (input: C.ShowcaseStartRequest) => Omit<C.ShowcaseStartResult, "job">) {
    const started: C.ShowcaseStartRequest[] = [], completed: C.ShowcaseCompleteRequest[] = [], manages: C.ShowcaseManageRequest[] = [], lists: C.ShowcaseListRequest[] = []
    const state: C.ShowcaseState = { revision: 0, settings: { enabled: false, channelId: null, maxPerMember: null, intervalMinutes: null }, access }
    const store: ShowcaseStore = {
        manage: input => Effect.sync(() => { manages.push(structuredClone(input)); if (input.operation.type === "settings") { const { type, ...patch } = input.operation; Object.assign(state.settings, patch) } state.revision++; return structuredClone(state) }),
        settings: () => Effect.sync(() => structuredClone(state)),
        list: input => Effect.sync(() => { lists.push(input); return { showcases: [], more: false } }),
        ready: () => Effect.sync(() => ({ jobs: jobs.splice(0) })),
        start: input => Effect.sync(() => { started.push(structuredClone(input)); return { job: { id: input.jobId, actorId: input.actorId, operation: { type: "delete", showcaseNo: 1 }, state: "queued", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }, ...start(input) } }),
        complete: input => Effect.sync(() => { completed.push(structuredClone(input)); return { job: { id: input.jobId, actorId: "1", operation: { type: "delete", showcaseNo: 1 }, state: "applied", createdAt: 0, expiresAt: 1 } } }),
        fail: () => Effect.succeed(null),
    }
    return { store, started, completed, manages, lists, state }
}
const queued = (actorId: string, operation: C.ShowcaseMemberOperation): C.ShowcaseJob => ({ id: "synthetic_showcase_job", actorId, operation, state: "queued", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER })

test("Showcase and profile commands parse their settings and keep list and show public", () => {
    assert.deepEqual(parseShowcaseCommand(["interval", "2h"]), { type: "change", operation: { type: "settings", intervalMinutes: 120 } })
    assert.deepEqual(parseShowcaseCommand(["limit", "51"]), { error: "Use !showcase limit with 1 to 50 showcases per member, or none" })
    assert.deepEqual(parseShowcaseCommand(["access", "block", "role", "<@&123456789012345678>"]), { type: "change", operation: { type: "access-add", list: "block", kind: "role", ids: ["123456789012345678"] } })
    assert.deepEqual(parseProfileCommand(["<@123456789012345678>"]), { type: "show", userId: "123456789012345678" })
    assert.deepEqual(parseProfileCommand(["cooldown", "5m"]), { type: "change", operation: { type: "settings", cooldownSeconds: 300 } })
    assert.deepEqual(parseProfileCommand(["cooldown", "2h"]), { error: "Use !profile cooldown with 1 second to 1 hour, such as 30s or 5m, or none" })
})

test("A showcase grant posts as the bot without mentions, names the fix when the bot cannot post and is never sent twice", async t => {
    for (const scenario of ["sent", "no-send"] as const) await t.test(scenario, async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-showcase-token" }), f = bot.fixtures
            const p = platform(bot, { actorOwner: false, actorPermissions: 0n, botPermissions: scenario === "sent" ? Permissions.Administrator : Permissions.ViewChannel | Permissions.EmbedLinks })
            const now = yield* Clock.currentTimeMillis, content: C.PublishingContent = { content: "", embed: { title: "My game", description: "Text", author: { name: "Member" } } }
            const grant: C.PublishingGrant = { attemptId: "synthetic_showcase_attempt", postNo: 1, generation: 1, sourceId: "showcase_synthetic_showcase_job", actorId: f.ids.bot, botId: f.ids.bot,
                action: "send", channelId: f.ids.channel, source: { type: "showcase", jobId: "synthetic_showcase_job", createdAt: now }, provenance: { type: "showcase", showcaseNo: 1 },
                content, canonicalContent: canonicalPublishingContent(content), dispatchExpiresAt: now + 120000, nativeDeadlineMs: 5000 }
            p.replies.remove()
            const send = bot.rest.respond("POST /channels/:id/messages", { body: f.message({ id: f.nextId(), channel_id: f.ids.channel, author: f.botUser(), content: "", embeds: [{ type: "rich", ...content.embed }] }) })
            let granted = true
            const b = showcaseBoundary([queued(f.ids.user, { type: "create", title: "My game", text: "Text", links: [] }), queued(f.ids.user, { type: "create", title: "My game", text: "Text", links: [] })],
                () => granted ? (granted = false, { grant }) : {})
            const remote = publishingBoundary({ dispatch: () => Effect.succeed({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 as const }) })
            yield* processShowcasePass(b.store, remote.store, f.ids.guild, bot.client)
            // The member was read fresh, and the second time the request was already decided, so nothing was sent again
            assert.deepEqual(b.started.map(row => [row.member.userId, row.member.botId, row.member.isBot]), [[f.ids.user, f.ids.bot, false], [f.ids.user, f.ids.bot, false]])
            if (scenario === "sent") {
                assert.equal(send.requests().length, 1)
                assert.deepEqual((send.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
                assert.deepEqual(b.completed, [{ serverId: f.ids.guild, jobId: "synthetic_showcase_job" }])
            } else {
                assert.equal(send.requests().length, 0)
                assert.deepEqual(b.completed, [{ serverId: f.ids.guild, jobId: "synthetic_showcase_job", fix: "Grant View Channel, Send Messages and Embed Links to the NeonFlux role" }])
            }
        })))
    })
})

test("Deleting a showcase removes the bot's message, and a message that is already gone counts as deleted", async t => {
    for (const status of [204, 404, 403] as const) await t.test(String(status), async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-showcase-token" }), f = bot.fixtures
            platform(bot, { actorOwner: false, actorPermissions: 0n })
            const messageId = f.nextId(), deletes = bot.rest.respond("DELETE /channels/:id/messages/:id", { status, ...(status === 204 ? {} : { body: { code: status === 404 ? "UNKNOWN_MESSAGE" : "MISSING_PERMISSIONS" } }) })
            const b = showcaseBoundary([queued(f.ids.user, { type: "delete", showcaseNo: 1 })], () => ({ remove: { channelId: f.ids.channel, messageId } }))
            yield* processShowcasePass(b.store, publishingBoundary().store, f.ids.guild, bot.client)
            assert.equal(deletes.requests()[0]!.path, `/channels/${f.ids.channel}/messages/${messageId}`)
            assert.deepEqual(b.completed, [{ serverId: f.ids.guild, jobId: "synthetic_showcase_job", removed: status !== 403, ...(status === 403 ? { fix: "Grant View Channel to the NeonFlux role" } : {}) }])
        })))
    })
})

test("!showcase channel checks the bot can post there, and !showcase list is open to every member", async () => {
    const b = showcaseBoundary([], () => ({})), serverId = createFixtures().ids.guild
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { showcases: b.store })), f = runtime.fixtures
        const p = platform(runtime, { actorOwner: false, actorPermissions: Permissions.ManageGuild, botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks, channelDeny: Permissions.EmbedLinks })
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(runtime.idle()))
        yield* send(`!showcase channel <#${f.ids.channel}>`)
        yield* send("!showcase list")
        assert.deepEqual(p.replies.requests().map(row => (row.body as { content: string }).content), [`Grant Embed Links to the NeonFlux role and allow it in <#${f.ids.channel}>`, "No showcases yet"])
        assert.deepEqual([b.manages.length, b.lists.length], [0, 1])
    })))
})

test("!profile replies with the member's profile embed and holds the caller to the cooldown", async () => {
    const shown: C.ProfileShowRequest[] = [], serverId = createFixtures().ids.guild
    const content: C.PublishingContent = { content: "", embed: { title: "Member", description: "Bio", color: 255 } }
    const profiles = { show: (input: C.ProfileShowRequest) => Effect.sync(() => { shown.push(input); return { type: "profile" as const, content, cooldownSeconds: 30 } }) } as unknown as ProfileStore
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { profiles })), f = runtime.fixtures
        const p = platform(runtime, { actorOwner: false, actorPermissions: 0n })
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(runtime.idle()))
        yield* send(`!profile <@${p.targetId}>`)
        yield* send("!profile")
        yield* TestClock.adjust("30 seconds")
        yield* send("!profile")
        const bodies = p.replies.requests().map(row => row.body as { content: string, embeds?: unknown[], allowed_mentions: unknown })
        assert.deepEqual(bodies.map(body => body.embeds?.length ? "embed" : body.content), ["embed", "You can show a profile again in 30 seconds", "embed"])
        assert.deepEqual(bodies[0]!.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.deepEqual(shown.map(row => [row.caller.userId, row.target.userId, row.target.roleIds]), [[f.ids.user, p.targetId, [p.targetRole.id]], [f.ids.user, f.ids.user, [p.actorRole.id]]])
    })).pipe(Effect.provide(TestClock.layer())))
})
