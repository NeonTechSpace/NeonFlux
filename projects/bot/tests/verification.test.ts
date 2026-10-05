import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { processVerificationRequest, requestVerificationLink } from "../src/verification.ts"
import type { VerificationStore } from "../src/verification-store.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { RolesStoreError } from "../src/roles-store.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"
import { boundary, token } from "./moderation-fixture.ts"

function verificationBoundary() {
    const issues: Parameters<VerificationStore["issue"]>[0][] = [], claims: Parameters<VerificationStore["claim"]>[0][] = [], outcomes: Parameters<VerificationStore["delivery"]>[0][] = []
    let issued = false, claimed = false
    const store: VerificationStore = {
        ready: () => Effect.succeed({ requests: [] }),
        issue: request => Effect.sync(() => { issues.push(request); if (issued) return { issued: false }; issued = true; return { issued: true, challengeId: "synthetic-request-id", expiresAt: request.createdAt + 600000 } }),
        claim: request => Effect.gen(function* () { claims.push(request); if (claimed) return { claimed: false }; claimed = true; return { claimed: true, sourceId: "verify_synthetic-request-id", createdAt: yield* Clock.currentTimeMillis } }),
        delivery: request => Effect.sync(() => { outcomes.push(request); return { recorded: true } }),
        request: () => Effect.die("No synthetic review request configured"), review: () => Effect.succeed({ reviewed: true }),
    }
    return { store, issues, claims, outcomes }
}

test("gateway advanced verification leaves unrelated reaction-role events intact and issues one native private link", async () => {
    const f = createFixtures(), remote = rolesBoundary(), safety = boundary(), verification = verificationBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild, websiteUrl: "https://synthetic.neonflux.invalid" }, { moderation: safety.store, roles: remote.store, verification: verification.store }))
        const native = nativeRoles(bot), reaction = savedPanel(bot, native, remote), rules = savedPanel(bot, native, remote, "verification")
        remote.current.panelsEnabled = true; remote.current.verificationEnabled = true; remote.current.advancedVerificationEnabled = true
        native.send.remove()
        const sent = bot.rest.respond("POST /channels/:id/messages", request => {
            const body = request.body as { content: string }
            const message = f.message({ channel_id: request.path.split("/")[2], author: f.botUser(), content: body.content })
            const { guild_id: _guildId, ...privateMessage } = message
            return { body: request.path.split("/")[2] === native.dmId ? privateMessage : message }
        })
        bot.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), { body: { items: [{ id: native.targetId, username: "Synthetic reactor" }], has_more: false, next_after: null } })
        yield* bot.ready()
        const emit = (messageId: string) => bot.emit("MESSAGE_REACTION_ADD", { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: messageId, user_id: native.targetId, emoji: { name: "✅" } }).pipe(Effect.andThen(bot.idle()))
        yield* emit(reaction.published!.messageId)
        assert.equal(native.add.requests().length, 1)
        assert.equal(verification.issues.length, 0)
        const evaluateBefore = remote.calls.filter(call => call.method === "evaluate").length
        yield* emit(rules.published!.messageId)
        assert.equal(verification.issues.length, 1)
        assert.equal(remote.calls.filter(call => call.method === "evaluate").length, evaluateBefore)
        assert.equal(native.open.requests().length, 1)
        const privateMessage = sent.requests().find(request => request.path.includes(native.dmId))!
        assert.ok((privateMessage.body as { content: string }).content.includes("https://synthetic.neonflux.invalid/verify?token="))
        assert.ok((privateMessage.body as { content: string }).content.includes("90 seconds"))
        yield* emit(rules.published!.messageId)
        assert.equal(native.open.requests().length, 1)
        assert.equal(native.add.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("a failed autorole after web verification keeps the proof retryable", async () => {
    const remote = rolesBoundary(), verification = verificationBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }), native = nativeRoles(bot), rules = savedPanel(bot, native, remote, "verification")
        remote.current.verificationEnabled = true; remote.current.advancedVerificationEnabled = true; remote.current.autoroleEnabled = true; remote.current.autoroleIds = [native.second.id]
        const store = { ...remote.store, evaluate: (input: Parameters<typeof remote.store.evaluate>[0]) => input.operation.type === "join" ? Effect.fail(new RolesStoreError({ operation: "evaluate", status: 503 }))
            // The backend reports a completed verification as acknowledged
            : remote.store.evaluate(input).pipe(Effect.map(result => input.operation.type === "verify" && result.status === "unchanged" ? { ...result, status: "acknowledged" as const } : result)) }
        const member = yield* bot.client.members.fetch({ guildId: bot.fixtures.ids.guild, userId: native.targetId })
        const request = { challengeId: "synthetic-request-id", userId: native.targetId, joinedAt: member.joinedAt, panelName: rules.name, revision: rules.revision, messageId: rules.published!.messageId }
        const result = yield* Effect.exit(processVerificationRequest(verification.store, store, { token, serverId: bot.fixtures.ids.guild }, bot.client, request))
        assert.equal(result._tag, "Failure")
        assert.equal(verification.outcomes.length, 0)
    })))
})

test("accepted custom proof uses existing native role dispatch and preserves unrelated roles", async () => {
    const remote = rolesBoundary(), verification = verificationBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }), native = nativeRoles(bot), rules = savedPanel(bot, native, remote, "verification")
        remote.current.verificationEnabled = true; remote.current.advancedVerificationEnabled = true
        const member = yield* bot.client.members.fetch({ guildId: bot.fixtures.ids.guild, userId: native.targetId })
        const request = { challengeId: "synthetic-request-id", userId: native.targetId, joinedAt: member.joinedAt, panelName: rules.name, revision: rules.revision, messageId: rules.published!.messageId }
        const config = { token, serverId: bot.fixtures.ids.guild }
        yield* processVerificationRequest(verification.store, remote.store, config, bot.client, request)
        assert.equal(verification.claims.length, 1)
        assert.equal(verification.outcomes[0]!.outcome, "succeeded")
        assert.equal(native.add.requests().length, 1)
        assert.equal(native.roleIds.has(native.role.id), true)
        assert.equal(native.roleIds.has(native.targetRole.id), true)
        assert.equal(remote.calls.some(call => call.method === "dispatch"), true)
        assert.equal(remote.calls.some(call => call.method === "outcome"), true)
        yield* processVerificationRequest(verification.store, remote.store, config, bot.client, request)
        assert.equal(native.add.requests().length, 1)
    })))
})

test("a proof for a member who left or rejoined is settled as failed without a claim, so it stops blocking newer proofs", async () => {
    const remote = rolesBoundary(), verification = verificationBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }), native = nativeRoles(bot), rules = savedPanel(bot, native, remote, "verification")
        remote.current.verificationEnabled = true; remote.current.advancedVerificationEnabled = true
        const config = { token, serverId: bot.fixtures.ids.guild }, base = { challengeId: "synthetic-request-id", panelName: rules.name, revision: rules.revision, messageId: rules.published!.messageId }
        yield* processVerificationRequest(verification.store, remote.store, config, bot.client, { ...base, userId: native.targetId, joinedAt: "2020-01-01T00:00:00.000Z" })
        yield* processVerificationRequest(verification.store, remote.store, config, bot.client, { ...base, userId: "777777777777777777", joinedAt: "2020-01-01T00:00:00.000Z" })
        assert.deepEqual(verification.outcomes.map(outcome => outcome.outcome), ["failed", "failed"])
        assert.equal(verification.claims.length, 0)
        assert.equal(native.add.requests().length, 0)
    })))
})

test("a missing read other than the human's membership keeps the proof for a retry", async () => {
    const remote = rolesBoundary(), verification = verificationBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }), native = nativeRoles(bot), rules = savedPanel(bot, native, remote, "verification")
        remote.current.verificationEnabled = true; remote.current.advancedVerificationEnabled = true
        const member = yield* bot.client.members.fetch({ guildId: bot.fixtures.ids.guild, userId: native.targetId })
        bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.bot}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        const request = { challengeId: "synthetic-request-id", userId: native.targetId, joinedAt: member.joinedAt, panelName: rules.name, revision: rules.revision, messageId: rules.published!.messageId }
        const result = yield* Effect.exit(processVerificationRequest(verification.store, remote.store, { token, serverId: bot.fixtures.ids.guild }, bot.client, request))
        assert.equal(result._tag, "Failure")
        assert.equal(verification.outcomes.length, 0)
    })))
})

test("missing website configuration and forged private recipient stop native verification delivery", async () => {
    const remote = rolesBoundary(), verification = verificationBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-verification-refusal-token" }), native = nativeRoles(bot), panel = savedPanel(bot, native, remote, "verification")
        remote.current.verificationEnabled = true; remote.current.advancedVerificationEnabled = true
        bot.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), { body: { items: [{ id: native.targetId, username: "Synthetic reactor" }], has_more: false, next_after: null } })
        const target = { id: panel.published!.messageId, channelId: bot.fixtures.ids.channel }
        const config = { token, serverId: bot.fixtures.ids.guild }
        assert.equal(yield* requestVerificationLink(verification.store, remote.store, config, bot.client, native.targetId, target).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false })), false)
        assert.equal(verification.issues.length, 0)
        native.open.remove()
        bot.rest.respond("POST /users/@me/channels", { body: { id: native.dmId, type: 1, recipients: [bot.fixtures.user({ id: bot.fixtures.nextId() })] } })
        assert.equal(yield* requestVerificationLink(verification.store, remote.store, { ...config, websiteUrl: "https://synthetic.neonflux.invalid" }, bot.client, native.targetId, target).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false })), false)
        assert.equal(native.send.requests().length, 0)
        assert.equal(native.add.requests().length, 0)
    })))
})
