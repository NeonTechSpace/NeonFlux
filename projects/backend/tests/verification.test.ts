import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import { defaultRolesSettings } from "../convex/rolesDomain.ts"
import { verificationHash } from "../convex/captchaDomain.ts"
import { decodeMotionFrames, motionRound, MOTION_CAPTCHA_INSTRUCTION } from "../convex/motionCaptcha.ts"

const old = { server: process.env.NEONFLUX_SERVER_ID, secret: process.env.NEONFLUX_BOT_API_SECRET, client: process.env.FLUXER_CLIENT_ID,
    turnstile: process.env.TURNSTILE_SECRET_KEY, hostnames: process.env.TURNSTILE_HOSTNAMES }
const secret = "synthetic-verification-service-secret-not-real-000"
beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret; process.env.FLUXER_CLIENT_ID = "123"
    process.env.TURNSTILE_SECRET_KEY = "synthetic-turnstile-secret-not-real"; process.env.TURNSTILE_HOSTNAMES = "localhost, synthetic.example.invalid"
})
afterEach(() => {
    for (const [key, value] of Object.entries({ NEONFLUX_SERVER_ID: old.server, NEONFLUX_BOT_API_SECRET: old.secret, FLUXER_CLIENT_ID: old.client,
        TURNSTILE_SECRET_KEY: old.turnstile, TURNSTILE_HOSTNAMES: old.hostnames })) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/verification.ts": () => import("../convex/verification.ts"), "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"), "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/greetingLifecycle.ts": () => import("../convex/greetingLifecycle.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
async function fixture(test: TestContext) {
    test.mock.timers.enable({ apis: ["setTimeout"] })
    let now = 1700000000000, providerUser = "20", sequence = 0, tokenSequence = 0, turnstileCalls = 0
    let providerBarrier: { reached: () => void, wait: Promise<void> } | undefined
    let turnstileResponse: ((signal: AbortSignal) => Promise<Response>) | undefined
    const usedTokens = new Set<string>()
    test.mock.method(Date, "now", () => now)
    test.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
            turnstileCalls++
            assert.equal(init?.method, "POST"); assert.ok(init?.body instanceof URLSearchParams)
            assert.equal(init.body.get("secret"), "synthetic-turnstile-secret-not-real")
            assert.equal(init.body.has("remoteip"), false); assert.equal(init.body.size, 2)
            assert.ok(init.signal instanceof AbortSignal)
            if (turnstileResponse) return turnstileResponse(init.signal)
            const token = init.body.get("response")!
            const success = !usedTokens.has(token)
            usedTokens.add(token)
            return Response.json(success ? { success: true, action: "verification_start", hostname: "localhost" }
                : { success: false, "error-codes": ["timeout-or-duplicate"] })
        }
        if (providerBarrier) { const barrier = providerBarrier; providerBarrier = undefined; barrier.reached(); await barrier.wait }
        const body = url.includes(".well-known") ? { endpoints: { api_public: "https://synthetic.fluxer.invalid" } }
            : url.includes("oauth2/@me") ? { application: { id: "123" }, user: { id: providerUser, username: "Synthetic member", bot: false }, scopes: ["identify", "guilds"] } : []
        return new Response(JSON.stringify(body), { status: 200 })
    })
    const t = convexTest({ schema, modules, transactionLimits: true }), joinedAt = new Date(now - 1000).toISOString()
    const context = { originServerId: "1", userId: "20", joinedAt, roleIds: [], isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true,
        roles: [{ roleId: "40", permissions: "0", botCanManage: true, actorCanManage: true }] }
    const sessionToken = "a".repeat(64), linkToken = "b".repeat(32)
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionToken))).toString("hex")
    await t.run(async ctx => {
        await ctx.db.insert("roleSettings", { serverId: "1", config: { ...defaultRolesSettings(), verificationEnabled: true, advancedVerificationEnabled: true }, nextPanelRevision: 2 })
        const mappings = [{ emoji: "✅", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }]
        await ctx.db.insert("rolePanels", { serverId: "1", name: "rules", kind: "verification", revision: 1, enabled: true, exclusive: false, mappings, withdrawing: false,
            published: { revision: 1, publishedAt: now - 1000, postNo: 1, postGeneration: 1, channelId: "30", messageId: "50", botId: "999", content: { content: "Synthetic rules" }, mappings, exclusive: false } })
        await ctx.db.insert("dashboardSessions", { tokenHash: hash, accessToken: "synthetic-oauth-token-not-real", userId: "20", userName: "Synthetic member", servers: [], expiresAt: now + 3600000, lifetimeAt: now + 3600000 })
    })
    const http = (route: string, body: unknown, authenticated = true) => t.fetch(route, { method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const issueRequest = () => ({ serverId: "1", sourceId: `synthetic_${++sequence}`, createdAt: now, context, panelName: "rules", revision: 1, messageId: "50", panelVerified: true, reactionPresent: true, linkToken })
    const issue = async () => {
        const response = await http("/verification/issue", issueRequest())
        assert.equal(response.status, 200)
        const result = await response.json() as { issued: boolean, challengeId: string }
        assert.equal(result.issued, true)
        return result.challengeId
    }
    const privateRow = () => t.run(ctx => ctx.db.query("verificationLinks").withIndex("by_hash", q => q.eq("linkHash", awaitHash)).unique())
    const awaitHash = await verificationHash(linkToken)
    const start = (turnstileToken = `synthetic-turnstile-token-${++tokenSequence}`) => t.action(api.verification.start, { sessionToken, linkToken, turnstileToken })
    const solve = async (challengeId: string) => {
        const answers = (await privateRow())!.pathAnswers!.slice()
        const first = await t.action(api.verification.answer, { sessionToken, challengeId, selected: [answers[0]!], round: 0 })
        if (first.status !== "started") return first
        return t.action(api.verification.answer, { sessionToken, challengeId, selected: [answers[1]!], round: 1 })
    }
    const pauseProvider = () => {
        let release!: () => void, reached!: () => void
        const entered = new Promise<void>(resolve => { reached = resolve }), wait = new Promise<void>(resolve => { release = resolve })
        providerBarrier = { reached, wait }
        return { entered, release }
    }
    return { t, http, issueRequest, issue, privateRow, start, solve, context, sessionToken, linkToken, pauseProvider,
        turnstileCalls: () => turnstileCalls, turnstileResponse: (response: (signal: AbortSignal) => Promise<Response>) => { turnstileResponse = response },
        now: () => now, advance: (ms: number) => { now += ms }, providerUser: (id: string) => { providerUser = id } }
}

test("pending public challenge mutations reject a session revoked or expired during provider verification", async test => {
    for (const operation of ["start", "answer"] as const) for (const invalidation of ["revoked", "expired", "lifetime"] as const) await test.test(`${operation}: ${invalidation}`, async test => {
        const f = await fixture(test), challengeId = await f.issue()
        if (operation === "answer") await f.start()
        const barrier = f.pauseProvider(), pending = operation === "start" ? f.start() : f.solve(challengeId)
        await barrier.entered
        if (invalidation === "revoked") await f.t.mutation(api.dashboard.logout, { sessionToken: f.sessionToken })
        else await f.t.run(async ctx => {
            const session = (await ctx.db.query("dashboardSessions").first())!
            await ctx.db.patch(session._id, invalidation === "expired" ? { expiresAt: f.now() } : { lifetimeAt: f.now() })
        })
        barrier.release()
        await assert.rejects(pending, /Sign in again/)
        const row = (await f.privateRow())!
        assert.equal(row.status, operation === "start" ? "issued" : "started")
        assert.equal(row.attempts, 0)
        assert.equal(row.solvedAt, undefined)
    })
})

test("completed human proof survives sign-out before its one-time native delivery claim", async test => {
    const f = await fixture(test), challengeId = await f.issue(); await f.start(); await f.solve(challengeId)
    await f.t.mutation(api.dashboard.logout, { sessionToken: f.sessionToken })
    const response = await f.http("/verification/claim", { serverId: "1", challengeId, claimToken: "c".repeat(32), context: f.context, panelVerified: true })
    assert.equal(response.status, 200)
    const claim = await response.json() as { claimed: boolean, sourceId: string, createdAt: number }
    assert.equal(claim.claimed, true)
    const evaluation = await f.http("/roles/evaluate", { serverId: "1", sourceId: claim.sourceId, createdAt: claim.createdAt, context: f.context,
        operation: { type: "verify", name: "rules", revision: 1, messageId: "50", panelVerified: true, reactionPresent: true } })
    assert.equal(evaluation.status, 200)
    assert.equal((await f.privateRow())!.status, "redeemed")
})

test("public advanced verification binds fresh ordinary-member OAuth, private raster, immutable start and single-use role proof", async test => {
    const f = await fixture(test), challengeId = await f.issue()
    const before = await f.t.action(api.verification.inspect, { sessionToken: f.sessionToken, linkToken: f.linkToken })
    assert.equal(before.status, "issued"); assert.equal(before.imageDataUri, undefined)
    const started = await f.start()
    assert.equal(started.status, "started"); assert.equal(started.expiresAt, f.now() + 90000)
    assert.ok(started.imageDataUri?.startsWith("data:image/png;base64,"))
    // Only the current round's public frames and choice cards leave the server.
    assert.deepEqual(Object.keys(started).sort(), ["attemptsRemaining", "captchaKind", "challengeId", "expiresAt", "imageDataUri", "instruction", "linkExpiresAt", "motionFrames", "panelName", "round", "roundCount", "serverId", "status"])
    assert.equal(started.captchaKind, "motion"); assert.equal(started.round, 0); assert.equal(started.roundCount, 2)
    assert.equal(started.instruction, MOTION_CAPTCHA_INSTRUCTION)
    const frames = decodeMotionFrames(started.motionFrames!)
    assert.equal(frames.frameCount, 60); assert.equal(frames.fps, 30); assert.equal(frames.grid, 256)
    // The row keeps only a private seed and answers. The view regenerates the current round from it.
    const stored = (await f.privateRow())!, regenerated = motionRound(stored.motionSeed!, 0)
    assert.match(stored.motionSeed!, /^[0-9a-f]{32}$/)
    assert.ok(JSON.stringify(stored).length < 2048, `row ${JSON.stringify(stored).length} bytes`)
    assert.equal(started.motionFrames, regenerated.motionFrames); assert.equal(started.imageDataUri, regenerated.imageDataUri)
    assert.equal(stored.pathAnswers![0], regenerated.answerIndex); assert.equal(stored.pathAnswers![1], motionRound(stored.motionSeed!, 1).answerIndex)
    assert.equal(JSON.stringify(started).includes(stored.motionSeed!), false)
    f.advance(10000)
    const duplicate = await f.start()
    assert.equal(duplicate.expiresAt, started.expiresAt); assert.equal(duplicate.imageDataUri, started.imageDataUri); assert.equal(duplicate.motionFrames, started.motionFrames)
    const solved = await f.solve(challengeId)
    assert.equal(solved.status, "solved"); assert.equal(solved.imageDataUri, undefined); assert.equal(solved.motionFrames, undefined)
    const cleared = (await f.privateRow())!
    assert.equal(cleared.motionSeed, undefined); assert.equal(cleared.pathAnswers, undefined)
    await assert.rejects(f.t.action(api.verification.answer, { sessionToken: f.sessionToken, challengeId, selected: [0, 1, 2, 3] }))
    const token = "c".repeat(32), binding = { serverId: "1", challengeId, claimToken: token, context: f.context, panelVerified: true }
    const claim = await (await f.http("/verification/claim", binding)).json() as { claimed: boolean, sourceId: string, createdAt: number }
    assert.equal(claim.claimed, true)
    const operation = { type: "verify", name: "rules", revision: 1, messageId: "50", panelVerified: true, reactionPresent: true }
    const evaluation = await f.http("/roles/evaluate", { serverId: "1", sourceId: claim.sourceId, createdAt: claim.createdAt, context: f.context, operation })
    assert.equal(evaluation.status, 200)
    assert.equal((await f.privateRow())!.status, "redeemed")
    assert.equal((await f.t.run(ctx => ctx.db.query("roleAcknowledgments").first()))!.advancedVerified, true)
    // A redeemed proof stays claimable until the bot records the confirmed role
    assert.equal((await (await f.http("/verification/claim", binding)).json() as { claimed: boolean }).claimed, true)
    assert.deepEqual(await (await f.http("/verification/delivery", { serverId: "1", challengeId, outcome: "succeeded" })).json(), { recorded: true })
    assert.equal((await (await f.http("/verification/claim", binding)).json() as { claimed: boolean }).claimed, false)
    assert.equal((await f.t.action(api.verification.inspect, { sessionToken: f.sessionToken, linkToken: f.linkToken })).deliveryOutcome, "succeeded")
})

async function reservedProof(f: Awaited<ReturnType<typeof fixture>>) {
    const challengeId = await f.issue(); await f.start(); await f.solve(challengeId)
    const claim = await (await f.http("/verification/claim", { serverId: "1", challengeId, claimToken: "c".repeat(32), context: f.context, panelVerified: true })).json() as { sourceId: string, createdAt: number }
    const evaluate = async () => (await f.http("/roles/evaluate", { serverId: "1", sourceId: claim.sourceId, createdAt: claim.createdAt, context: f.context,
        operation: { type: "verify", name: "rules", revision: 1, messageId: "50", panelVerified: true, reactionPresent: true } })).json() as Promise<{ status: string, grant?: { attemptId: string, dispatchExpiresAt: number } }>
    const first = await evaluate()
    assert.equal(first.status, "reserved"); assert.ok(first.grant)
    assert.equal((await evaluate()).status, "blocked")
    return { evaluate, first: first.grant }
}

test("a bot restart releases an undispatched verification grant so the proof reserves it again", async test => {
    const f = await fixture(test), { evaluate, first } = await reservedProof(f)
    f.advance(60000)
    assert.equal((await f.http("/roles/observe", { serverId: "1", mode: "restart" })).status, 200)
    const retried = await evaluate()
    assert.equal(retried.status, "reserved"); assert.notEqual(retried.grant?.attemptId, first.attemptId)
})

test("a retried verification grant expires with its proof", async test => {
    const f = await fixture(test), { evaluate } = await reservedProof(f)
    f.advance(150000)
    await f.t.run(async ctx => {
        const attempt = (await ctx.db.query("roleAttempts").first())!
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, finishedAt: f.now() })
        await ctx.db.patch(attempt.ownershipId, { status: "idle" })
    })
    const retried = await evaluate()
    assert.equal(retried.status, "reserved"); assert.equal(retried.grant?.dispatchExpiresAt, (await f.privateRow())!.solveExpiresAt! + 180000)
})

test("public lifecycle rejects wrong identity, invalid service auth, copied sources and simple rules bypass", async test => {
    const f = await fixture(test)
    assert.equal((await f.http("/verification/issue", f.issueRequest(), false)).status, 401)
    await f.issue()
    f.providerUser("21"); await assert.rejects(f.start()); f.providerUser("20")
    const denied = await f.http("/roles/evaluate", { serverId: "1", sourceId: "ordinary_reaction", createdAt: f.now(), context: f.context,
        operation: { type: "verify", name: "rules", revision: 1, messageId: "50", panelVerified: true, reactionPresent: true } })
    assert.equal(denied.status, 403)
    assert.equal(await f.t.run(ctx => ctx.db.query("roleAcknowledgments").first()), null)
    assert.equal((await f.http("/verification/issue", { ...f.issueRequest(), serverId: "2" })).status, 403)
})

test("public challenge expiration and attempts use server time without reset or answer leakage", async test => {
    const f = await fixture(test), challengeId = await f.issue(), start = await f.start(), row = await f.privateRow()
    const wrong = [(row!.pathAnswers![0]! + 1) % 6], secondChoice = [row!.pathAnswers![1]!]
    const firstRound = await f.t.action(api.verification.answer, { sessionToken: f.sessionToken, challengeId, selected: wrong, round: 0 })
    assert.equal(firstRound.round, 1); assert.equal(firstRound.attemptsRemaining, 2); assert.equal(firstRound.status, "started")
    const first = await f.t.action(api.verification.answer, { sessionToken: f.sessionToken, challengeId, selected: secondChoice, round: 1 })
    assert.equal(first.status, "started"); assert.equal(first.attemptsRemaining, 1); assert.equal(first.expiresAt, start.expiresAt)
    assert.equal(first.round, 0); assert.equal(first.imageDataUri, start.imageDataUri)
    await f.t.action(api.verification.answer, { sessionToken: f.sessionToken, challengeId, selected: wrong, round: 0 })
    const second = await f.t.action(api.verification.answer, { sessionToken: f.sessionToken, challengeId, selected: secondChoice, round: 1 })
    assert.equal(second.status, "failed"); assert.equal(second.attemptsRemaining, 0); assert.equal(second.imageDataUri, undefined); assert.equal(second.motionFrames, undefined)
    assert.equal((await f.privateRow())!.pathAnswers, undefined); assert.equal((await f.privateRow())!.motionSeed, undefined)
    await assert.rejects(f.solve(challengeId))
})

test("public motion rounds hide the future frames, image and answers, fence replay and keep the same deadline", async test => {
    const f = await fixture(test), challengeId = await f.issue(), started = await f.start(), row = (await f.privateRow())!
    const rounds = [0, 1].map(round => motionRound(row.motionSeed!, round))
    assert.equal(started.imageDataUri, rounds[0]!.imageDataUri); assert.equal(started.motionFrames, rounds[0]!.motionFrames)
    assert.notEqual(started.motionFrames, rounds[1]!.motionFrames)
    const selected = [(row.pathAnswers![0]! + 1) % 6], first = { sessionToken: f.sessionToken, challengeId, selected, round: 0 }
    f.advance(20000)
    const next = await f.t.action(api.verification.answer, first)
    assert.equal(next.imageDataUri, rounds[1]!.imageDataUri); assert.equal(next.motionFrames, rounds[1]!.motionFrames); assert.equal(JSON.stringify(next).includes(row.motionSeed!), false); assert.equal(next.round, 1); assert.equal(next.attemptsRemaining, 2)
    assert.equal(next.expiresAt, started.expiresAt)
    assert.equal("pathSelections" in next, false); assert.equal("pathAnswers" in next, false); assert.equal("pathImages" in next, false)
    assert.deepEqual(await f.t.action(api.verification.answer, first), next)
    await assert.rejects(f.t.action(api.verification.answer, { ...first, selected: [row.pathAnswers![0]!] }))
    const last = { sessionToken: f.sessionToken, challengeId, selected: [row.pathAnswers![1]!], round: 1 }
    const retry = await f.t.action(api.verification.answer, last)
    assert.equal(retry.round, 0); assert.equal(retry.attemptsRemaining, 1); assert.equal(retry.expiresAt, started.expiresAt)
    await assert.rejects(f.t.action(api.verification.answer, last))
    assert.equal((await f.privateRow())!.attempts, 1)
    assert.equal((await f.start()).imageDataUri, started.imageDataUri)
})

test("public challenge deadline equality expires and refreshing start does not extend it", async test => {
    const f = await fixture(test), challengeId = await f.issue(); await f.start(); f.advance(90000)
    const expired = await f.start()
    assert.equal(expired.status, "expired"); assert.equal(expired.imageDataUri, undefined); assert.equal(expired.motionFrames, undefined)
    assert.equal((await f.solve(challengeId)).status, "expired")
    const row = (await f.privateRow())!
    assert.equal(row.motionSeed, undefined); assert.equal(row.pathAnswers, undefined)
})

test("reissue and staff review clear a started motion challenge's private payload", async test => {
    for (const operation of ["reissue", "review"] as const) await test.test(operation, async test => {
        const f = await fixture(test), challengeId = await f.issue(); await f.start()
        assert.match((await f.privateRow())!.motionSeed!, /^[0-9a-f]{32}$/)
        if (operation === "reissue") {
            f.advance(90000)
            assert.equal((await (await f.http("/verification/issue", { ...f.issueRequest(), linkToken: "d".repeat(32) })).json() as { issued: boolean }).issued, true)
        } else {
            const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
            assert.equal((await f.http("/verification/review", { serverId: "1", challengeId, actor, context: f.context, panelVerified: true })).status, 200)
        }
        const row = (await f.privateRow())!
        assert.equal(row.status, operation === "reissue" ? "expired" : "solved")
        assert.equal(row.motionSeed, undefined); assert.equal(row.pathAnswers, undefined); assert.equal(row.pathSelections, undefined)
    })
})

test("manual review requires fresh native administrator and exact current member epoch", async test => {
    const f = await fixture(test), challengeId = await f.issue()
    const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
    const input = { serverId: "1", challengeId, actor, context: f.context, panelVerified: true }
    assert.equal((await f.http("/verification/review", input)).status, 403)
    assert.equal((await f.http("/verification/review", { ...input, actor: { ...actor, isOwner: true }, context: { ...f.context, joinedAt: new Date(f.now()).toISOString() } })).status, 409)
    assert.equal((await f.http("/verification/review", { ...input, actor: { ...actor, isOwner: true } })).status, 200)
    const row = await f.privateRow()
    assert.equal(row!.status, "solved"); assert.equal(row!.reviewedBy, "10"); assert.equal(row!.motionSeed, undefined)
})

test("concurrent public submissions admit only one solve", async test => {
    const f = await fixture(test), challengeId = await f.issue(); await f.start()
    const results = await Promise.allSettled([f.solve(challengeId), f.solve(challengeId)])
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
})

test("rejoin epoch and disabled verification invalidate an in-flight proof, unrelated role saves do not", async test => {
    const f = await fixture(test), challengeId = await f.issue(); await f.start(); await f.solve(challengeId)
    const binding = { serverId: "1", challengeId, claimToken: "c".repeat(32), context: { ...f.context, joinedAt: new Date(f.now()).toISOString() }, panelVerified: true }
    assert.equal((await f.http("/verification/claim", binding)).status, 409)
    // Any roles dashboard save bumps the shared revision, which must not affect verification links or proofs
    await f.t.run(async ctx => { const settings = (await ctx.db.query("roleSettings").first())!; await ctx.db.patch(settings._id, { dashboardRevision: 7 }) })
    assert.equal((await f.t.action(api.verification.inspect, { sessionToken: f.sessionToken, linkToken: f.linkToken })).status, "solved")
    assert.deepEqual((await (await f.http("/verification/ready", { serverId: "1" })).json() as { requests: Array<{ challengeId: string }> }).requests.map(request => request.challengeId), [challengeId])
    await f.t.run(async ctx => { const settings = (await ctx.db.query("roleSettings").first())!; await ctx.db.patch(settings._id, { config: { ...settings.config, advancedVerificationEnabled: false } }) })
    await assert.rejects(f.t.action(api.verification.inspect, { sessionToken: f.sessionToken, linkToken: f.linkToken }))
    assert.equal((await f.http("/verification/claim", { ...binding, context: f.context })).status, 403)
})

test("public issuance cooldown prevents link farming and link expires after ten minutes", async test => {
    const f = await fixture(test); await f.issue()
    assert.equal((await (await f.http("/verification/issue", { ...f.issueRequest(), linkToken: "d".repeat(32) })).json() as { issued: boolean }).issued, false)
    f.advance(600000)
    const expired = await f.start()
    assert.equal(expired.status, "expired"); assert.equal(expired.imageDataUri, undefined)
})

test("repeated native reactions cannot replace an active challenge to reset its solving clock", async test => {
    const f = await fixture(test); await f.issue(); const started = await f.start(); f.advance(60000)
    const response = await f.http("/verification/issue", { ...f.issueRequest(), linkToken: "f".repeat(32) })
    assert.deepEqual(await response.json(), { issued: false })
    const fresh = await f.start()
    assert.equal(fresh.challengeId, started.challengeId); assert.equal(fresh.expiresAt, started.expiresAt)
})

test("started challenge rejects another session for the same account and invalid input does not consume attempts", async test => {
    const f = await fixture(test), challengeId = await f.issue(); await f.start()
    const token = "e".repeat(64), hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex")
    await f.t.run(ctx => ctx.db.insert("dashboardSessions", { tokenHash: hash, accessToken: "synthetic-second-session", userId: "20", userName: "Synthetic member", servers: [], expiresAt: f.now() + 3600000, lifetimeAt: f.now() + 3600000 }))
    await assert.rejects(f.t.action(api.verification.start, { sessionToken: token, linkToken: f.linkToken, turnstileToken: "synthetic-second-session-token" }))
    await assert.rejects(f.t.action(api.verification.answer, { sessionToken: f.sessionToken, challengeId, selected: [0, 0, 1, 2] }))
    assert.equal((await f.privateRow())!.attempts, 0)
})

test("ready discovery skips settled proofs, keeps redeemed ones until settled and expires obsolete panel proofs", async test => {
    const f = await fixture(test), challengeId = await f.issue(); await f.start(); await f.solve(challengeId)
    const proof = (await f.privateRow())!, ready = async () => (await (await f.http("/verification/ready", { serverId: "1" })).json() as { requests: Array<{ challengeId: string }> }).requests.map(request => request.challengeId)
    // Ten older proofs for members who left hide the newest until the bot settles them as failed
    const departed = await f.t.run(async ctx => {
        const { _id, _creationTime, ...copy } = proof, ids: string[] = []
        for (let index = 0; index < 10; index++) ids.push(await ctx.db.insert("verificationLinks", { ...copy, createdAt: copy.createdAt - 1000 + index, userId: String(100 + index), linkHash: String(index).padStart(64, "0") }))
        return ids
    })
    assert.equal((await ready()).includes(challengeId), false)
    for (const id of departed) assert.deepEqual(await (await f.http("/verification/delivery", { serverId: "1", challengeId: id, outcome: "failed" })).json(), { recorded: true })
    assert.deepEqual(await ready(), [challengeId])
    // A proof redeemed before a restart stays discoverable until its role is confirmed
    await f.t.run(ctx => ctx.db.patch(proof._id, { status: "redeemed", redeemedAt: f.now() }))
    assert.deepEqual(await ready(), [challengeId])
    await f.t.run(async ctx => { const panel = (await ctx.db.query("rolePanels").first())!; await ctx.db.patch(panel._id, { enabled: false }) })
    const obsolete = await f.http("/verification/ready", { serverId: "1" })
    assert.deepEqual(await obsolete.json(), { requests: [] })
    assert.equal((await f.privateRow())!.status, "expired")
})

test("scheduled retention erases exact transient challenges after twenty-four hours", async test => {
    const f = await fixture(test); await f.issue(); await f.start()
    f.advance(86400000)
    test.mock.timers.tick(86400000)
    await f.t.finishInProgressScheduledFunctions()
    assert.equal(await f.privateRow(), null)
})

test("legacy simple acknowledgment cannot authorize dependent roles or new advanced dispatch", async test => {
    const f = await fixture(test)
    await f.t.run(ctx => ctx.db.insert("roleAcknowledgments", { serverId: "1", userId: "20", joinedAt: f.context.joinedAt, rulesRevision: 1, panelName: "rules", acknowledgedAt: f.now() }))
    const reaction = await f.http("/roles/evaluate", { serverId: "1", sourceId: "ordinary_reaction", createdAt: f.now(), context: f.context,
        operation: { type: "verify", name: "rules", revision: 1, messageId: "50", panelVerified: true, reactionPresent: true } })
    assert.equal(reaction.status, 403)
    await f.t.run(async ctx => {
        const settings = (await ctx.db.query("roleSettings").first())!
        await ctx.db.patch(settings._id, { config: { ...settings.config, autoroleEnabled: true, autoroleIds: ["40"] } })
    })
    const join = await f.http("/roles/evaluate", { serverId: "1", sourceId: "synthetic_join", createdAt: Date.parse(f.context.joinedAt), context: f.context, operation: { type: "join" } })
    assert.equal(join.status, 403)
})

test("public start requires a bounded Turnstile token and configured server credentials", async test => {
    const f = await fixture(test); await f.issue()
    // @ts-expect-error The public contract deliberately rejects a missing Turnstile token.
    await assert.rejects(f.t.action(api.verification.start, { sessionToken: f.sessionToken, linkToken: f.linkToken }))
    for (const token of ["", " ", "x".repeat(2049)]) await assert.rejects(f.start(token), /Complete the Turnstile verification/)
    for (const key of ["TURNSTILE_SECRET_KEY", "TURNSTILE_HOSTNAMES"]) {
        const previous = process.env[key]
        delete process.env[key]
        await assert.rejects(f.start(), /Turnstile verification unavailable/)
        process.env[key] = previous
    }
    process.env.TURNSTILE_HOSTNAMES = " , "
    await assert.rejects(f.start(), /Turnstile verification unavailable/)
    assert.equal(f.turnstileCalls(), 0)
    const row = (await f.privateRow())!
    assert.equal(row.status, "issued"); assert.equal(row.startedAt, undefined); assert.equal(row.attempts, 0)
})

test("public start fails closed on invalid, expired, replayed and mismatched Turnstile results", async test => {
    const results = [
        { success: false, "error-codes": ["invalid-input-response"] },
        { success: false, "error-codes": ["timeout-or-duplicate"] },
        { success: "true", action: "verification_start", hostname: "localhost" },
        { success: true, action: "login", hostname: "localhost" },
        { success: true, hostname: "localhost" },
        { success: true, action: "verification_start", hostname: "localhost.attacker.invalid" },
        { success: true, action: "verification_start", hostname: "sub.synthetic.example.invalid" },
        { success: true, action: "verification_start" }, null, [],
    ]
    for (const [index, result] of results.entries()) await test.test(`response ${index}`, async test => {
        const f = await fixture(test); await f.issue()
        f.turnstileResponse(async () => Response.json(result))
        await assert.rejects(f.start(), /Turnstile verification failed/)
        assert.equal(f.turnstileCalls(), 1)
        const row = (await f.privateRow())!
        assert.equal(row.status, "issued"); assert.equal(row.startedAt, undefined); assert.equal(row.attempts, 0)
    })
})

test("public start rejects provider failures without leaking provider content", async test => {
    for (const failure of ["network", "http", "json"] as const) await test.test(failure, async test => {
        const f = await fixture(test); await f.issue()
        f.turnstileResponse(async () => {
            if (failure === "network") throw new Error("synthetic-private-provider-detail")
            return new Response("synthetic-private-provider-detail", { status: failure === "http" ? 503 : 200 })
        })
        await assert.rejects(f.start(), error => {
            assert.match(String(error), /Turnstile verification unavailable/)
            assert.doesNotMatch(String(error), /synthetic-private-provider-detail|synthetic-turnstile-secret/)
            return true
        })
        assert.equal((await f.privateRow())!.status, "issued")
    })
})

test("public start accepts an exact configured hostname and fences token replay without extending the timer", async test => {
    const f = await fixture(test); await f.issue()
    const token = "synthetic-single-use-turnstile-token", started = await f.start(token)
    f.advance(10000)
    await assert.rejects(f.start(token), /Turnstile verification failed/)
    assert.equal((await f.privateRow())!.solveExpiresAt, started.expiresAt)
    f.turnstileResponse(async () => Response.json({ success: true, action: "verification_start", hostname: "synthetic.example.invalid" }))
    const duplicate = await f.start("x".repeat(2048))
    assert.equal(duplicate.expiresAt, started.expiresAt); assert.equal(duplicate.imageDataUri, started.imageDataUri)
    assert.equal(f.turnstileCalls(), 3)
})

test("public start rejects wrong account, stale session and policy before consuming a Turnstile token", async test => {
    for (const invalidation of ["account", "session", "settings", "link"] as const) await test.test(invalidation, async test => {
        const f = await fixture(test); await f.issue()
        if (invalidation === "link") f.advance(600000)
        else await f.t.run(async ctx => {
            if (invalidation === "account") {
                const row = (await ctx.db.query("verificationLinks").first())!
                await ctx.db.patch(row._id, { userId: "21" })
            } else if (invalidation === "session") {
                const row = (await ctx.db.query("dashboardSessions").first())!
                await ctx.db.patch(row._id, { expiresAt: f.now() })
            } else {
                const row = (await ctx.db.query("roleSettings").first())!
                await ctx.db.patch(row._id, { config: { ...row.config, advancedVerificationEnabled: false } })
            }
        })
        if (invalidation === "link") assert.equal((await f.start()).status, "expired")
        else await assert.rejects(f.start())
        assert.equal(f.turnstileCalls(), 0)
        assert.equal((await f.privateRow())!.startedAt, undefined)
    })
})

test("pending Turnstile success cannot override changed account, session, policy or link expiry", async test => {
    for (const invalidation of ["account", "revoked", "expired", "lifetime", "settings", "panel", "link"] as const) await test.test(invalidation, async test => {
        const f = await fixture(test); await f.issue()
        let reached!: () => void, release!: () => void
        const entered = new Promise<void>(resolve => { reached = resolve }), wait = new Promise<void>(resolve => { release = resolve })
        f.turnstileResponse(async () => { reached(); await wait; return Response.json({ success: true, action: "verification_start", hostname: "localhost" }) })
        const pending = f.start()
        await entered
        if (invalidation === "revoked") await f.t.mutation(api.dashboard.logout, { sessionToken: f.sessionToken })
        else if (invalidation === "link") f.advance(600000)
        else await f.t.run(async ctx => {
            if (invalidation === "account") {
                const row = (await ctx.db.query("verificationLinks").first())!
                await ctx.db.patch(row._id, { userId: "21" })
            } else if (invalidation === "expired" || invalidation === "lifetime") {
                const row = (await ctx.db.query("dashboardSessions").first())!
                await ctx.db.patch(row._id, invalidation === "expired" ? { expiresAt: f.now() } : { lifetimeAt: f.now() })
            } else if (invalidation === "settings") {
                const row = (await ctx.db.query("roleSettings").first())!
                await ctx.db.patch(row._id, { config: { ...row.config, advancedVerificationEnabled: false } })
            } else {
                const row = (await ctx.db.query("rolePanels").first())!
                await ctx.db.patch(row._id, { revision: 2 })
            }
        })
        release()
        if (invalidation === "link") assert.equal((await pending).status, "expired")
        else await assert.rejects(pending)
        const row = (await f.privateRow())!
        assert.equal(row.startedAt, undefined); assert.equal(row.attempts, 0); assert.equal(row.motionSeed, undefined)
    })
})
