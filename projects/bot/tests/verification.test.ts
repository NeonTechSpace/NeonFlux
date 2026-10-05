import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { processVerificationRequest, requestVerificationLink } from "../src/verification.ts"
import { VerificationStoreError, type VerificationStore } from "../src/verification-store.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { RolesStoreError } from "../src/roles-store.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"
import { boundary, token } from "./moderation-fixture.ts"

function verificationBoundary() {
    const issues: Parameters<VerificationStore["issue"]>[0][] = [],
        claims: Parameters<VerificationStore["claim"]>[0][] = [],
        outcomes: Parameters<VerificationStore["delivery"]>[0][] = []
    let issued = false,
        claimed = false
    const store: VerificationStore = {
        ready: () => Effect.succeed({ requests: [] }),
        issue: (request) =>
            Effect.sync(() => {
                issues.push(request)
                if (issued) return { issued: false }
                issued = true
                return { issued: true, challengeId: "synthetic-request-id" }
            }),
        claim: (request) =>
            Effect.gen(function* () {
                claims.push(request)
                if (claimed) return { claimed: false }
                claimed = true
                return {
                    claimed: true,
                    sourceId: "verify_synthetic-request-id",
                    createdAt: yield* Clock.currentTimeMillis,
                }
            }),
        delivery: (request) =>
            Effect.sync(() => {
                outcomes.push(request)
                return { recorded: true }
            }),
        request: () => Effect.die("No synthetic review request configured"),
        review: () => Effect.succeed({ reviewed: true }),
    }
    return {
        store,
        issues,
        claims,
        outcomes,
        allowIssue: () => {
            issued = false
        },
    }
}

test("gateway advanced verification leaves unrelated reaction-role events intact and issues one native private link", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        safety = boundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, websiteUrl: "https://synthetic.neonflux.invalid" },
                        { moderation: safety.store, roles: remote.store, verification: verification.store },
                    ),
                )
                const native = nativeRoles(bot),
                    reaction = savedPanel(bot, native, remote),
                    rules = savedPanel(bot, native, remote, "verification")
                for (const mapping of [...rules.mappings, ...rules.published!.mappings])
                    mapping.roleId = native.second.id
                remote.current.panelsEnabled = true
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                native.send.remove()
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => {
                    const body = request.body as { content: string }
                    const message = f.message({
                        channel_id: request.path.split("/")[2],
                        author: f.botUser(),
                        content: body.content,
                    })
                    const { guild_id: _guildId, ...privateMessage } = message
                    return { body: request.path.split("/")[2] === native.dmId ? privateMessage : message }
                })
                bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), {
                    body: {
                        items: [{ id: native.targetId, username: "Synthetic reactor" }],
                        has_more: false,
                        next_after: null,
                    },
                })
                yield* bot.ready()
                const emit = (messageId: string) =>
                    bot
                        .emit("MESSAGE_REACTION_ADD", {
                            guild_id: f.ids.guild,
                            channel_id: f.ids.channel,
                            message_id: messageId,
                            user_id: native.targetId,
                            emoji: { name: "✅" },
                        })
                        .pipe(Effect.andThen(bot.idle()))
                yield* emit(reaction.published!.messageId)
                assert.equal(native.add.requests().length, 1)
                assert.equal(verification.issues.length, 0)
                const evaluateBefore = remote.calls.filter((call) => call.method === "evaluate").length
                yield* emit(rules.published!.messageId)
                assert.equal(verification.issues.length, 1)
                assert.equal(remote.calls.filter((call) => call.method === "evaluate").length, evaluateBefore)
                assert.equal(native.open.requests().length, 1)
                const privateMessage = sent.requests().find((request) => request.path.includes(native.dmId))!
                assert.ok(
                    (privateMessage.body as { content: string }).content.includes(
                        "https://synthetic.neonflux.invalid/verify?token=",
                    ),
                )
                assert.ok((privateMessage.body as { content: string }).content.includes("90 seconds"))
                // Staff can find the request only by this reference, so it stays as one short labeled line
                const dmLines = (privateMessage.body as { content: string }).content.split("\n")
                assert.equal(dmLines.length, 3)
                assert.equal(dmLines.at(-1), "Reference: `synthetic-request-id`")
                assert.ok(!/experimental|request ID/i.test((privateMessage.body as { content: string }).content))
                yield* emit(rules.published!.messageId)
                assert.equal(native.open.requests().length, 1)
                assert.equal(native.add.requests().length, 1)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a failed autorole after web verification keeps the proof retryable", async () => {
    const remote = rolesBoundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }),
                    native = nativeRoles(bot),
                    rules = savedPanel(bot, native, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                remote.current.autoroleEnabled = true
                remote.current.autoroleIds = [native.second.id]
                const store = {
                    ...remote.store,
                    evaluate: (input: Parameters<typeof remote.store.evaluate>[0]) =>
                        input.operation.type === "join"
                            ? Effect.fail(new RolesStoreError({ operation: "evaluate", status: 503 }))
                            : // The backend reports a completed verification as acknowledged
                              remote.store
                                  .evaluate(input)
                                  .pipe(
                                      Effect.map((result) =>
                                          input.operation.type === "verify" && result.status === "unchanged"
                                              ? { ...result, status: "acknowledged" as const }
                                              : result,
                                      ),
                                  ),
                }
                const member = yield* bot.client.members.fetch({
                    guildId: bot.fixtures.ids.guild,
                    userId: native.targetId,
                })
                const request = {
                    challengeId: "synthetic-request-id",
                    userId: native.targetId,
                    joinedAt: member.joinedAt,
                    panelName: rules.name,
                    revision: rules.revision,
                    messageId: rules.published!.messageId,
                }
                const result = yield* Effect.exit(
                    processVerificationRequest(
                        verification.store,
                        store,
                        { token, serverId: bot.fixtures.ids.guild },
                        bot.client,
                        request,
                    ),
                )
                assert.equal(result._tag, "Failure")
                assert.equal(verification.outcomes.length, 0)
            }),
        ),
    )
})

test("accepted custom proof uses existing native role dispatch and preserves unrelated roles", async () => {
    const remote = rolesBoundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }),
                    native = nativeRoles(bot),
                    rules = savedPanel(bot, native, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                const member = yield* bot.client.members.fetch({
                    guildId: bot.fixtures.ids.guild,
                    userId: native.targetId,
                })
                const request = {
                    challengeId: "synthetic-request-id",
                    userId: native.targetId,
                    joinedAt: member.joinedAt,
                    panelName: rules.name,
                    revision: rules.revision,
                    messageId: rules.published!.messageId,
                }
                const config = { token, serverId: bot.fixtures.ids.guild }
                yield* processVerificationRequest(verification.store, remote.store, config, bot.client, request)
                assert.equal(verification.claims.length, 1)
                assert.equal(verification.outcomes[0]!.outcome, "succeeded")
                assert.equal(native.add.requests().length, 1)
                assert.equal(native.roleIds.has(native.role.id), true)
                assert.equal(native.roleIds.has(native.targetRole.id), true)
                assert.equal(
                    remote.calls.some((call) => call.method === "dispatch"),
                    true,
                )
                assert.equal(
                    remote.calls.some((call) => call.method === "outcome"),
                    true,
                )
                yield* processVerificationRequest(verification.store, remote.store, config, bot.client, request)
                assert.equal(native.add.requests().length, 1)
            }),
        ),
    )
})

test("a proof for a member who left or rejoined is settled as failed without a claim, so it stops blocking newer proofs", async () => {
    const remote = rolesBoundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }),
                    native = nativeRoles(bot),
                    rules = savedPanel(bot, native, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                const config = { token, serverId: bot.fixtures.ids.guild },
                    base = {
                        challengeId: "synthetic-request-id",
                        panelName: rules.name,
                        revision: rules.revision,
                        messageId: rules.published!.messageId,
                    }
                yield* processVerificationRequest(verification.store, remote.store, config, bot.client, {
                    ...base,
                    userId: native.targetId,
                    joinedAt: "2020-01-01T00:00:00.000Z",
                })
                yield* processVerificationRequest(verification.store, remote.store, config, bot.client, {
                    ...base,
                    userId: "777777777777777777",
                    joinedAt: "2020-01-01T00:00:00.000Z",
                })
                assert.deepEqual(
                    verification.outcomes.map((outcome) => outcome.outcome),
                    ["failed", "failed"],
                )
                assert.equal(verification.claims.length, 0)
                assert.equal(native.add.requests().length, 0)
            }),
        ),
    )
})

test("a missing read other than the human's membership keeps the proof for a retry", async () => {
    const remote = rolesBoundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-verification-native-token" }),
                    native = nativeRoles(bot),
                    rules = savedPanel(bot, native, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                const member = yield* bot.client.members.fetch({
                    guildId: bot.fixtures.ids.guild,
                    userId: native.targetId,
                })
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.bot}`, {
                    status: 404,
                    body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" },
                })
                const request = {
                    challengeId: "synthetic-request-id",
                    userId: native.targetId,
                    joinedAt: member.joinedAt,
                    panelName: rules.name,
                    revision: rules.revision,
                    messageId: rules.published!.messageId,
                }
                const result = yield* Effect.exit(
                    processVerificationRequest(
                        verification.store,
                        remote.store,
                        { token, serverId: bot.fixtures.ids.guild },
                        bot.client,
                        request,
                    ),
                )
                assert.equal(result._tag, "Failure")
                assert.equal(verification.outcomes.length, 0)
            }),
        ),
    )
})

test("missing website configuration and forged private recipient stop native verification delivery", async () => {
    const remote = rolesBoundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-verification-refusal-token" }),
                    native = nativeRoles(bot),
                    panel = savedPanel(bot, native, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), {
                    body: {
                        items: [{ id: native.targetId, username: "Synthetic reactor" }],
                        has_more: false,
                        next_after: null,
                    },
                })
                const target = { id: panel.published!.messageId, channelId: bot.fixtures.ids.channel }
                const config = { token, serverId: bot.fixtures.ids.guild }
                assert.equal(
                    yield* requestVerificationLink(
                        verification.store,
                        remote.store,
                        config,
                        bot.client,
                        native.targetId,
                        target,
                    ).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false })),
                    false,
                )
                assert.equal(verification.issues.length, 0)
                native.open.remove()
                bot.rest.respond("POST /users/@me/channels", {
                    body: { id: native.dmId, type: 1, recipients: [bot.fixtures.user({ id: bot.fixtures.nextId() })] },
                })
                assert.equal(
                    yield* requestVerificationLink(
                        verification.store,
                        remote.store,
                        { ...config, websiteUrl: "https://synthetic.neonflux.invalid" },
                        bot.client,
                        native.targetId,
                        target,
                    ).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false })),
                    false,
                )
                assert.equal(native.send.requests().length, 0)
                assert.equal(native.add.requests().length, 0)
            }),
        ),
    )
})

test("!verify with advanced verification answers the member in the channel for every outcome", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        safety = boundary(),
        verification = verificationBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, websiteUrl: "https://synthetic.neonflux.invalid" },
                        { moderation: safety.store, roles: remote.store, verification: verification.store },
                    ),
                )
                const native = nativeRoles(bot),
                    panel = savedPanel(bot, native, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.advancedVerificationEnabled = true
                native.send.remove()
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => {
                    const message = f.message({
                        channel_id: request.path.split("/")[2],
                        author: f.botUser(),
                        content: (request.body as { content: string }).content,
                    })
                    const { guild_id: _guildId, ...privateMessage } = message
                    return { body: request.path.split("/")[2] === native.dmId ? privateMessage : message }
                })
                native.open.remove()
                bot.rest.respond("POST /users/@me/channels", {
                    body: { id: native.dmId, type: 1, recipients: [bot.fixtures.user({ id: native.targetId })] },
                })
                let reacted = false
                bot.rest.respond(
                    (request) => new URL(request.url).pathname.endsWith("/users"),
                    () => ({
                        body: {
                            items: reacted ? [{ id: native.targetId, username: "Synthetic reactor" }] : [],
                            has_more: false,
                            next_after: null,
                        },
                    }),
                )
                yield* bot.ready()
                const channelReplies = () =>
                    sent
                        .requests()
                        .filter((request) => request.path.split("/")[2] === f.ids.channel)
                        .map((request) => (request.body as { content: string }).content)
                // Each !verify must send exactly one reply of its own
                const answer = () =>
                    Effect.gen(function* () {
                        const before = channelReplies().length
                        yield* bot.emit(
                            "MESSAGE_CREATE",
                            f.message({ content: "!verify", author: f.user({ id: native.targetId }) }),
                        )
                        yield* bot.idle()
                        const replies = channelReplies().slice(before)
                        assert.equal(replies.length, 1, `replies: ${JSON.stringify(replies)}`)
                        return replies[0]!
                    })
                assert.match(yield* answer(), /^React to the rules panel first, then send !verify again$/)
                assert.equal(verification.issues.length, 0)
                reacted = true
                assert.match(yield* answer(), /^Check your direct messages for your verification link$/)
                assert.equal(verification.issues.length, 1)
                // The backend allows one link at a time
                assert.match(yield* answer(), /^NeonFlux sent no new link/)
                // Neither a current acknowledgement alone nor the access role alone counts as verified
                for (const state of [
                    { acknowledged: true, accessRolePresent: false },
                    { acknowledged: false, accessRolePresent: true },
                ]) {
                    Object.assign(remote.acknowledgment, state)
                    verification.allowIssue()
                    assert.match(yield* answer(), /^Check your direct messages for your verification link$/)
                }
                assert.equal(verification.issues.length, 4)
                // A member whose acknowledgement is current and who holds the access role is told so, and no link is issued
                Object.assign(remote.acknowledgment, { acknowledged: true, accessRolePresent: true })
                assert.equal(yield* answer(), "You are already verified")
                assert.equal(verification.issues.length, 4)
                Object.assign(remote.acknowledgment, { acknowledged: false, accessRolePresent: false })
                panel.enabled = false
                assert.match(yield* answer(), /^Verification is not open right now/)
                panel.enabled = true
                remote.current.verificationEnabled = false
                assert.match(yield* answer(), /^Verification is not open right now/)
                assert.equal(verification.issues.length, 4)
                // With direct messages closed the member still gets an answer that says what to do
                remote.current.verificationEnabled = true
                verification.allowIssue()
                bot.rest.respond("POST /users/@me/channels", {
                    status: 403,
                    body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Cannot send messages to this user" },
                })
                assert.equal(
                    yield* answer(),
                    "NeonFlux could not send your verification link. Allow direct messages from this server, " +
                        "then send !verify again in a minute. If it keeps failing, ask server staff",
                )
                // A refused link and an edited rules panel name their own next step instead of direct messages
                const issue = verification.store.issue
                for (const [status, reply] of [
                    [429, "You asked for too many verification links. Try again in an hour or ask server staff"],
                    [403, "Verification is not open right now. Ask server staff"],
                    [
                        500,
                        "NeonFlux could not prepare your verification link. Send !verify again in a minute. If it keeps failing, ask server staff",
                    ],
                ] as const) {
                    verification.store.issue = () =>
                        Effect.fail(new VerificationStoreError({ operation: "issue", status }))
                    assert.equal(yield* answer(), reply)
                }
                verification.store.issue = issue
                const republish =
                    "The rules panel was removed or changed after it was published. Ask server staff to publish it again"
                panel.revision = 2
                assert.equal(yield* answer(), republish)
                // A rules message staff deleted needs staff, not the member's direct messages
                panel.revision = 1
                const issued = verification.issues.length
                const deletedMessage = bot.rest.respond(
                    `GET /channels/${panel.published!.channelId}/messages/${panel.published!.messageId}`,
                    { status: 404, body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" } },
                )
                assert.equal(yield* answer(), republish)
                assert.equal(verification.issues.length, issued)
                // So does a deleted rules channel
                deletedMessage.remove()
                bot.rest.respond(`GET /channels/${panel.published!.channelId}`, {
                    status: 404,
                    body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" },
                })
                assert.equal(yield* answer(), republish)
                assert.equal(verification.issues.length, issued)
            }),
        ),
    )
})

test("!verify review answers the administrator when the review fails", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        safety = boundary(),
        verification = verificationBoundary()
    verification.store.request = () => Effect.fail(new VerificationStoreError({ operation: "request", status: 404 }))
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, websiteUrl: "https://synthetic.neonflux.invalid" },
                        { moderation: safety.store, roles: remote.store, verification: verification.store },
                    ),
                )
                const native = nativeRoles(bot)
                native.send.remove()
                const sent = bot.rest.respond("POST /channels/:id/messages", { body: f.message() })
                yield* bot.ready()
                const answer = (authorId: string) =>
                    Effect.gen(function* () {
                        const before = sent.requests().length
                        yield* bot.emit(
                            "MESSAGE_CREATE",
                            f.message({
                                content: "!verify review synthetic-reference",
                                author: f.user({ id: authorId }),
                            }),
                        )
                        yield* bot.idle()
                        return sent
                            .requests()
                            .slice(before)
                            .map((request) => (request.body as { content: string }).content)
                    })
                assert.deepEqual(yield* answer(f.ids.user), [
                    "No verification request has that reference. Check it and try again",
                ])
                assert.deepEqual(yield* answer(native.targetId), [
                    "Only the server owner and Administrators can review verification",
                ])
                // The member left the server since the link was sent
                verification.store.request = () =>
                    Effect.succeed({
                        challengeId: "synthetic-request-id",
                        userId: "999999999999999999",
                        joinedAt: "2024-01-01T00:00:00.000000+00:00",
                        panelName: "rules",
                        revision: 1,
                        messageId: "1",
                    })
                assert.deepEqual(yield* answer(f.ids.user), [
                    "The member left or rejoined since the link was sent. They can send !verify again",
                ])
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("!verify review says web verification is not set up when the deployment has no website", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        safety = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: safety.store, roles: remote.store },
                    ),
                )
                nativeRoles(bot).send.remove()
                const sent = bot.rest.respond("POST /channels/:id/messages", { body: f.message() })
                yield* bot.ready()
                const before = sent.requests().length
                yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!verify review synthetic-reference" }))
                yield* bot.idle()
                assert.deepEqual(
                    sent
                        .requests()
                        .slice(before)
                        .map((request) => (request.body as { content: string }).content),
                    ["Web verification is not set up on this deployment"],
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
