import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { inspect } from "node:util"
import type * as C from "@neonflux/backend/contracts"
import { Deferred, Effect, Exit, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createRolesStore } from "../src/roles-store.ts"

const serverId = "123456789012345678"
const userId = "123456789012345679"
const botId = "123456789012345680"
const roleId = "123456789012345681"
const otherId = "123456789012345682"
const sourceId = "123456789012345683"
const joinedAt = "2026-10-01T00:00:00.123456Z"
const actor: C.ModerationActor = { userId, roleIds: [], isOwner: true, isAdministrator: true, nativePermissionAuthorized: true }
const settings: C.RolesSettings = { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 }
const context: C.RolesMemberContext = { userId, joinedAt, roleIds: [], isBot: false, timeoutUntil: null, botId, botAuthorized: true,
    roles: [{ roleId, permissions: "0", botCanManage: true, actorCanManage: false }] }
const acknowledgment: C.RolesAcknowledgment = { acknowledged: false, accessConfirmed: false, accessRolePresent: false }
const secret = "synthetic-roles-adapter-secret"
const config = { siteUrl: "https://synthetic-test.convex.site", secret: Redacted.make(secret) }
const evaluate: C.RolesEvaluateRequest = { serverId, sourceId, createdAt: 2000, context,
    operation: { type: "choose", name: "colors", revision: 2, roleId, selected: true } }
const panel: C.RolesPanel = { name: "colors", kind: "reaction", revision: 2, enabled: true, exclusive: false,
    mappings: [{ emoji: "👍", roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] }], withdrawing: false }

function fixture(t: TestContext) {
    let payload: unknown
    const requests: { url: URL, options: RequestInit }[] = []
    t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
        requests.push({ url, options })
        return Response.json(payload)
    })
    return { store: createRolesStore(config), requests, respond: (value: unknown) => { payload = value } }
}

test("Role adapter retains bounded reservations and rejects empty, duplicate or extra reservation fields", async t => {
    const f = fixture(t), reservations = [{ userId, roleIds: [roleId, otherId] }]
    f.respond({ type: "settings", settings: { ...settings, reservations } })
    const current = await Effect.runPromise(f.store.query({ serverId, actor, operation: { type: "settings" } }))
    assert.equal(current.type, "settings")
    if (current.type === "settings") assert.deepEqual(current.settings.reservations, reservations)
    for (const invalid of [[{ userId, roleIds: [] }], [...reservations, ...reservations], [{ userId, roleIds: [roleId, roleId] }], [{ userId, roleIds: [roleId], enabled: true }], Array.from({ length: 101 }, () => reservations[0])]) {
        f.respond({ type: "settings", settings: { ...settings, reservations: invalid } })
        await rejected(f.store.query({ serverId, actor, operation: { type: "settings" } }))
    }
})
function reserved(): C.RolesEvaluateResult & { grant: C.RolesGrant } {
    return { duplicate: false, status: "reserved", acknowledgment, grant: { attemptId: "synthetic_attempt", ownershipId: "synthetic_ownership",
        generation: 1, sourceId, action: "add", userId, joinedAt, roleId, botId, expectedPresent: false,
        consumerKey: "panel:colors:2", dispatchExpiresAt: 182000, nativeDeadlineMs: 5000 } }
}

test("level-sync decoding accepts exact level additions/removals and rejects autorole fallthrough or another source", async t => {
    const f = fixture(t), levelSource = "level_synthetic_profile_2_" + roleId
    const request: C.RolesEvaluateRequest = { ...evaluate, sourceId: levelSource, operation: { type: "level-sync", roleId } }
    const result = reserved(); result.grant.sourceId = levelSource; result.grant.consumerKey = "level"
    f.respond(result); await Effect.runPromise(f.store.evaluate(request))
    f.respond({ ...result, grant: { ...result.grant, action: "remove", expectedPresent: true } })
    await Effect.runPromise(f.store.evaluate({ ...request, context: { ...context, roleIds: [roleId] } }))
    for (const grant of [{ ...result.grant, consumerKey: "autorole:1" }, { ...result.grant, roleId: otherId },
        { ...result.grant, sourceId: "level_synthetic_profile_3_" + roleId }]) {
        f.respond({ ...result, grant }); await rejected(f.store.evaluate(request))
    }
})
function claimed(status: "idle" | "uncertain" = "uncertain"): C.RolesClaim {
    const grant = reserved().grant
    return { ownershipId: grant.ownershipId, userId, joinedAt, roleId, generation: 1, owned: false, status,
        consumerKeys: [grant.consumerKey], attempt: { ...grant, outcome: "uncertain", createdAt: 2000, dispatchedAt: 2050, finishedAt: 2100 } }
}
async function rejected<A>(operation: Effect.Effect<A, unknown>) {
    await assert.rejects(Effect.runPromise(operation), /RolesStoreError/)
}

test("Role adapter transports canonical authenticated DTOs without importing backend runtime", async t => {
    const f = fixture(t)
    const response = reserved()
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.evaluate(evaluate)), response)
    const dispatch: C.RolesDispatchRequest = { serverId, attemptId: response.grant.attemptId, ownershipId: response.grant.ownershipId,
        generation: 1, sourceId, claimToken: "a".repeat(32), context }
    f.respond({ claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000 })
    assert.deepEqual(await Effect.runPromise(f.store.dispatch(dispatch)), { claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000 })
    const { context: _context, ...identity } = dispatch
    const outcome: C.RolesOutcomeRequest = { ...identity, outcome: "uncertain" }
    f.respond({ recorded: true })
    assert.deepEqual(await Effect.runPromise(f.store.outcome(outcome)), { recorded: true })
    assert.deepEqual(f.requests.map(request => request.url.pathname), ["/roles/evaluate", "/roles/dispatch", "/roles/outcome"])
    assert.deepEqual(f.requests.map(request => JSON.parse(String(request.options.body))), [evaluate, dispatch, outcome])
    for (const { options } of f.requests) {
        assert.equal(options.method, "POST")
        assert.equal(options.redirect, "error")
        assert(options.signal instanceof AbortSignal)
        assert.deepEqual(options.headers, { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" })
    }
})

test("Role grants bind source, membership epoch, bot, selected role and immutable panel consumer revision", async t => {
    const f = fixture(t)
    for (const change of [{ sourceId: otherId }, { userId: otherId }, { joinedAt: "2026-10-02T00:00:00Z" }, { botId: otherId },
        { roleId: otherId }, { consumerKey: "panel:other:2" }, { consumerKey: "panel:colors:1" }, { nativeDeadlineMs: 10000 },
        { expectedPresent: true }, { _id: "synthetic_private_row" }]) {
        const value = reserved()
        Object.assign(value.grant, change)
        f.respond(value)
        await rejected(f.store.evaluate(evaluate))
    }
    f.respond({ ...reserved(), duplicate: true })
    await rejected(f.store.evaluate(evaluate))
    f.respond({ ...reserved(), status: "unchanged" })
    await rejected(f.store.evaluate(evaluate))
})

test("Deselection cannot add a role and exclusive removal is explicitly partial before a replacement", async t => {
    const f = fixture(t)
    const deselect: C.RolesEvaluateRequest = { ...evaluate, context: { ...context, roleIds: [roleId] },
        operation: { type: "choose", name: "colors", revision: 2, roleId, selected: false } }
    f.respond(reserved())
    await rejected(f.store.evaluate(deselect))
    const removed = reserved()
    removed.grant.action = "remove"
    removed.grant.expectedPresent = true
    f.respond(removed)
    assert.deepEqual(await Effect.runPromise(f.store.evaluate(deselect)), removed)
    await rejected(f.store.evaluate(evaluate))
    const partial = { ...removed, status: "partial" as const, grant: { ...removed.grant, roleId: otherId } }
    const exclusive: C.RolesEvaluateRequest = { ...evaluate, context: { ...context, roleIds: [otherId],
        roles: [...context.roles, { roleId: otherId, permissions: "0", botCanManage: true, actorCanManage: false }] } }
    f.respond(partial)
    assert.deepEqual(await Effect.runPromise(f.store.evaluate(exclusive)), partial)
})

test("Settings and panel management responses correlate to the requested revision and publishing identity", async t => {
    const f = fixture(t)
    const source = { serverId, actor, messageId: sourceId, createdAt: 2000 }
    const update: C.RolesManageRequest = { ...source, operation: { type: "panel-update", name: panel.name, expectedRevision: 2, patch: { enabled: true } } }
    f.respond({ duplicate: false, type: "panel", panel })
    assert.deepEqual(await Effect.runPromise(f.store.manage(update)), { duplicate: false, type: "panel", panel })
    for (const change of [{ name: "other" }, { revision: 3 }, { _id: "synthetic_private_row" }]) {
        f.respond({ duplicate: false, type: "panel", panel: { ...panel, ...change } })
        await rejected(f.store.manage(update))
    }
    const semantic: C.RolesManageRequest = { ...source, operation: { type: "panel-update", name: panel.name, expectedRevision: 1, patch: { mappings: panel.mappings } } }
    f.respond({ duplicate: false, type: "panel", panel })
    assert.equal((await Effect.runPromise(f.store.manage(semantic))).duplicate, false)
    f.respond({ duplicate: false, type: "panel", panel: { ...panel, revision: 7 } })
    assert.equal((await Effect.runPromise(f.store.manage(semantic))).duplicate, false)
    f.respond({ duplicate: false, type: "panel", panel: { ...panel, revision: 1 } })
    await rejected(f.store.manage(semantic))
    const changeSettings: C.RolesManageRequest = { ...source, operation: { type: "settings", patch: { panelsEnabled: true } } }
    f.respond({ duplicate: false, type: "settings", settings })
    await rejected(f.store.manage(changeSettings))
    f.respond({ duplicate: false, type: "settings", settings: { ...settings, panelsEnabled: true, revision: 2 } })
    assert.equal((await Effect.runPromise(f.store.manage(changeSettings))).duplicate, false)
    const bound = { ...panel, published: { revision: 2, publishedAt: 1500, postNo: 7, postGeneration: 1, channelId: otherId, messageId: sourceId,
        botId, content: { content: "Rules" }, mappings: panel.mappings, exclusive: false } }
    const bind: C.RolesManageRequest = { ...source, operation: { type: "panel-bind", name: panel.name, expectedRevision: 2, postNo: 7, expectedPostGeneration: 1 } }
    f.respond({ duplicate: false, type: "panel", panel: bound })
    assert.equal((await Effect.runPromise(f.store.manage(bind))).duplicate, false)
    f.respond({ duplicate: false, type: "panel", panel: { ...bound, published: { ...bound.published, postGeneration: 2 } } })
    await rejected(f.store.manage(bind))
})

test("Opaque pagination cursors round-trip beyond identifier bounds without exposing storage fields", async t => {
    const f = fixture(t)
    const boundaries: { response: object, invoke: (cursor: string) => Effect.Effect<unknown, unknown> }[] = [
        { response: { type: "claims", claims: [claimed()] }, invoke: (cursor: string) => f.store.query({ serverId, actor, operation: { type: "claim-list", userId, joinedAt, cursor } }) },
        { response: { type: "configurations", references: [{ consumerKey: "panel:colors:2", roleId }] }, invoke: (cursor: string) => f.store.query({ serverId, actor, operation: { type: "configuration-list", name: panel.name, cursor } }) },
    ]
    const syntheticCursor = (length: number) => "synthetic-opaque:[]/=+" + "x".repeat(length - "synthetic-opaque:[]/=+".length)
    for (const boundary of boundaries) {
        for (const length of [350, 4096]) {
            const cursor = syntheticCursor(length)
            assert.equal(cursor.length, length)
            const response = { ...boundary.response, nextCursor: cursor }
            f.respond(response)
            assert.deepEqual(await Effect.runPromise(boundary.invoke(cursor)), response)
            assert.equal(JSON.parse(String(f.requests.at(-1)!.options.body)).cursor
                ?? JSON.parse(String(f.requests.at(-1)!.options.body)).operation.cursor, cursor)
        }
        for (const nextCursor of ["", syntheticCursor(4097), { privateCursor: "Synthetic private body" }]) {
            f.respond({ ...boundary.response, nextCursor })
            await rejected(boundary.invoke(syntheticCursor(350)))
        }
        f.respond({ ...boundary.response, nextCursor: syntheticCursor(350), _id: "synthetic_private_row" })
        await rejected(boundary.invoke(syntheticCursor(350)))
    }
})

function runningJob(): C.RolesReactionJob {
    return { jobId: "synthetic_job", name: panel.name, revision: 2, messageId: sourceId, channelId: otherId,
        generation: 3, pageStep: 2, status: "running", rerun: false, leaseExpiresAt: 602000 }
}

test("Claimed reaction pages bind exact job generation, page step and member source identities", async t => {
    const f = fixture(t)
    const job = runningJob()
    const input: C.RolesReactionJobsRequest = { serverId, operation: { type: "claim", jobId: job.jobId, claimToken: "b".repeat(32) } }
    const target = { userId, joinedAt, sourceId: `job_${job.jobId}_${job.generation}_${job.pageStep}_0` }
    const valid: C.RolesReactionJobsResult = { type: "page", claimed: true, job, targets: [target], hasMore: true }
    f.respond(valid)
    assert.deepEqual(await Effect.runPromise(f.store.reactionJobs(input)), valid)
    for (const change of [
        { job: { ...job, jobId: "other_job" } },
        { job: { ...job, generation: 0 } },
        { job: { ...job, pageStep: 0 } },
        { job: { ...job, leaseExpiresAt: undefined } },
        { job: { ...job, status: "complete" } },
        { targets: [{ ...target, sourceId: `job_${job.jobId}_2_2_0` }] },
        { targets: [{ ...target, sourceId: `job_${job.jobId}_3_2_1` }] },
        { targets: [{ ...target, sourceId: "unrelated_source" }] },
        { targets: [target, { ...target, sourceId: `job_${job.jobId}_3_2_1` }] },
        { targets: [{ ...target, _id: "synthetic_private_member" }] },
        { leaseToken: "synthetic_private_capability" },
    ]) {
        f.respond({ ...valid, ...change })
        await rejected(f.store.reactionJobs(input))
    }
    f.respond({ type: "page", claimed: false, job })
    assert.equal((await Effect.runPromise(f.store.reactionJobs(input))).type, "page")
    const { leaseExpiresAt: _lease, ...stopped } = job
    const cancelled: C.RolesReactionJobsResult = { type: "job", job: { ...stopped, status: "cancelled" } }
    f.respond(cancelled)
    assert.deepEqual(await Effect.runPromise(f.store.reactionJobs(input)), cancelled)
    f.respond({ type: "page", claimed: false, job, targets: [target] })
    await rejected(f.store.reactionJobs(input))
})

test("Reaction checkpoints and departed skips cannot acknowledge a different lease generation or page", async t => {
    const f = fixture(t)
    const job = runningJob()
    const binding: C.RolesReactionJobBinding = { jobId: job.jobId, generation: job.generation, claimToken: "b".repeat(32), pageStep: job.pageStep, index: 0 }
    const { leaseExpiresAt: _lease, ...stopped } = job
    const checkpoint: C.RolesReactionJobsRequest = { serverId, operation: { type: "checkpoint", jobId: job.jobId,
        generation: job.generation, claimToken: binding.claimToken, pageStep: job.pageStep, blocked: false } }
    const skip: C.RolesReactionJobsRequest = { serverId, operation: { type: "skip", binding, currentJoinedAt: null } }
    const block: C.RolesReactionJobsRequest = { serverId, operation: { type: "block", binding } }
    for (const input of [checkpoint, skip, block]) {
        const valid: C.RolesReactionJobsResult = { type: "job", job: input.operation.type === "checkpoint" ? { ...stopped, status: "queued" } : job }
        f.respond(valid)
        assert.deepEqual(await Effect.runPromise(f.store.reactionJobs(input)), valid)
        for (const change of [{ jobId: "other_job" }, { generation: 4 }, { pageStep: 3 }, { _id: "synthetic_private_row" }]) {
            f.respond({ ...valid, job: { ...valid.job, ...change } })
            await rejected(f.store.reactionJobs(input))
        }
    }
})

test("Durable reaction lists stay bounded and distinguish cancelled work from an enqueue identity mismatch", async t => {
    const f = fixture(t)
    const job = { ...runningJob(), status: "blocked" as const, leaseExpiresAt: undefined }
    const list: C.RolesReactionJobsRequest = { serverId, operation: { type: "list" } }
    f.respond({ type: "jobs", jobs: [job] })
    assert.equal((await Effect.runPromise(f.store.reactionJobs(list))).type, "jobs")
    for (const jobs of [[job, job], [job, { ...job, jobId: "other_job" }],
        Array.from({ length: 52 }, (_, index) => ({ ...job, jobId: `job_${index}`, name: `panel_${index}` }))]) {
        f.respond({ type: "jobs", jobs })
        await rejected(f.store.reactionJobs(list))
    }
    const enqueue: C.RolesReactionJobsRequest = { serverId, operation: { type: "enqueue", messageId: sourceId } }
    f.respond({ type: "job", job })
    assert.equal((await Effect.runPromise(f.store.reactionJobs(enqueue))).type, "job")
    f.respond({ type: "job", job: { ...job, messageId: otherId } })
    await rejected(f.store.reactionJobs(enqueue))
})

test("Claim queries expose only exact member epoch and correctly bound retained attempts", async t => {
    const f = fixture(t)
    const input: C.RolesQueryRequest = { serverId, actor, operation: { type: "claim-list", userId, joinedAt } }
    const response = { type: "claims", claims: [claimed()], nextCursor: "synthetic_cursor" }
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.query(input)), response)
    const referenceOnly: C.RolesClaim = { ownershipId: "synthetic_preexisting_owner", userId, joinedAt, roleId,
        generation: 0, owned: false, status: "idle", consumerKeys: ["panel:colors:2"] }
    f.respond({ ...response, claims: [referenceOnly] })
    assert.deepEqual(await Effect.runPromise(f.store.query(input)), { ...response, claims: [referenceOnly] })
    for (const change of [{ owned: true }, { status: "pending" }, { status: "uncertain" }, { generation: -1 },
        { attempt: { ...claimed().attempt!, ownershipId: referenceOnly.ownershipId, generation: 0 } }]) {
        f.respond({ ...response, claims: [{ ...referenceOnly, ...change }] })
        await rejected(f.store.query(input))
    }
    for (const change of [{ userId: otherId }, { joinedAt: "2026-10-02T00:00:00Z" }, { ownershipId: "other_owner" },
        { generation: 2 }, { _id: "synthetic_private_row" }]) {
        f.respond({ ...response, claims: [{ ...claimed(), ...change }] })
        await rejected(f.store.query(input))
    }
    const row = claimed()
    f.respond({ ...response, claims: [{ ...row, attempt: { ...row.attempt!, noDispatch: true } }] })
    await rejected(f.store.query(input))
    f.respond({ ...response, claims: [{ ...row, attempt: { ...row.attempt!, dispatchedAt: 182000 } }] })
    await rejected(f.store.query(input))
    f.respond({ ...response, claims: [{ ...row, joinedAt: "2026-10-01" }] })
    await rejected(f.store.query({ ...input, operation: { type: "claim-list", userId, joinedAt: "2026-10-01" } }))
})

test("Reconciliation preserves observational ownership rather than converting uncertain role presence to owned", async t => {
    const f = fixture(t)
    const request: C.RolesReconcileRequest = { serverId, actor, messageId: sourceId, createdAt: 200000,
        attemptId: "synthetic_attempt", generation: 1, observation: { observedAt: 200000, userId, joinedAt, roleId, present: true } }
    const response: C.RolesReconcileResult = { recorded: true, claim: claimed("idle") }
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.reconcile(request)), response)
    assert.equal(response.claim.owned, false)
    assert.equal(response.claim.attempt?.outcome, "uncertain")
    for (const patch of [{ roleId: otherId }, { generation: 2 }, { joinedAt: "2026-10-02T00:00:00Z" }, { userId: otherId }]) {
        f.respond({ ...response, claim: { ...claimed("idle"), ...patch } })
        await rejected(f.store.reconcile(request))
    }
    f.respond({ ...response, claim: { ...claimed("idle"), attempt: { ...claimed().attempt!, attemptId: "other_attempt" } } })
    await rejected(f.store.reconcile(request))
})

test("Malformed storage fields and provider failures never expose private bodies or credentials", async t => {
    const f = fixture(t)
    const input: C.RolesMemberQueryRequest = { serverId, context }
    const valid = { settings, panels: [panel], acknowledgment }
    f.respond(valid)
    assert.deepEqual(await Effect.runPromise(f.store.memberQuery(input)), valid)
    for (const extra of [{ _id: "synthetic_private_row" }, { secret: "Synthetic private body" }]) {
        f.respond({ ...valid, ...extra })
        await rejected(f.store.memberQuery(input))
    }
    const privateBody = "Synthetic private provider body"
    t.mock.method(globalThis, "fetch", async () => Response.json({ message: privateBody }, { status: 403 }))
    const result = await Effect.runPromise(Effect.exit(f.store.memberQuery(input)))
    assert(Exit.isFailure(result))
    const details = inspect(result, { depth: 8 })
    assert(!details.includes(privateBody))
    assert(!details.includes(secret))
    assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error.status === 403))
})

test("Member configuration accepts fifty reaction panels and one verification panel without allowing duplicate or excess panels", async t => {
    const f = fixture(t)
    const input: C.RolesMemberQueryRequest = { serverId, context }
    const panels: C.RolesPanel[] = Array.from({ length: 50 }, (_, index) => ({ ...panel, name: `color-${index}` }))
    panels.push({ ...panel, name: "rules", kind: "verification" })
    const response: C.RolesMemberQueryResult = { settings, panels, acknowledgment }
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.memberQuery(input)), response)
    f.respond({ ...response, panels: [...panels, { ...panel, name: "extra" }] })
    await rejected(f.store.memberQuery(input))
    f.respond({ ...response, panels: [{ ...panel, name: "rules", kind: "verification" }, { ...panel, name: "other-rules", kind: "verification" }] })
    await rejected(f.store.memberQuery(input))
    f.respond({ ...response, panels: [panel, panel] })
    await rejected(f.store.memberQuery(input))
})

test("Native dispatch refusal and fixed budget are preserved without adapter retries", async t => {
    const f = fixture(t)
    const input: C.RolesDispatchRequest = { serverId, attemptId: "synthetic_attempt", ownershipId: "synthetic_ownership", generation: 1, sourceId,
        claimToken: "a".repeat(32), context }
    for (const claimed of [true, false]) {
        f.respond({ claimed, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000 })
        assert.equal((await Effect.runPromise(f.store.dispatch(input))).claimed, claimed)
    }
    for (const bad of [{ claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 10000 },
        { claimed: true, dispatchExpiresAt: 0, nativeDeadlineMs: 5000 },
        { claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000, claimToken: "synthetic_private_capability" }]) {
        f.respond(bad)
        await rejected(f.store.dispatch(input))
    }
    assert.equal(f.requests.length, 5)
})

test("Withdrawal continuation and configuration pages bind exact retained consumer and step", async t => {
    const f = fixture(t)
    const source = { serverId, actor, messageId: sourceId, createdAt: 2000 }
    const job: C.RolesWithdrawal = { withdrawalId: "synthetic_withdrawal", consumerKey: "panel:colors:2", step: 1,
        status: "pending", remainingAtLeast: 11, hasMore: true, deletePanel: false, targets: [{ userId, joinedAt, roleId }] }
    const start: C.RolesManageRequest = { ...source, operation: { type: "withdraw", name: "colors", revision: 2 } }
    f.respond({ duplicate: false, type: "withdrawal", withdrawal: job })
    assert.deepEqual(await Effect.runPromise(f.store.manage(start)), { duplicate: false, type: "withdrawal", withdrawal: job })
    for (const change of [{ consumerKey: "panel:other:2" }, { consumerKey: "panel:colors:1" }, { status: "complete" }, { remainingAtLeast: 0 }]) {
        f.respond({ duplicate: false, type: "withdrawal", withdrawal: { ...job, ...change } })
        await rejected(f.store.manage(start))
    }
    const next: C.RolesManageRequest = { ...source, operation: { type: "withdraw-next", withdrawalId: job.withdrawalId, expectedStep: 1 } }
    f.respond({ duplicate: false, type: "withdrawal", withdrawal: { ...job, step: 2 } })
    assert.equal((await Effect.runPromise(f.store.manage(next))).duplicate, false)
    for (const change of [{ step: 1 }, { withdrawalId: "other_withdrawal" }]) {
        f.respond({ duplicate: false, type: "withdrawal", withdrawal: { ...job, step: 2, ...change } })
        await rejected(f.store.manage(next))
    }
    const page: C.RolesQueryRequest = { serverId, actor, operation: { type: "configuration-list", name: "colors", cursor: "synthetic_cursor" } }
    const response = { type: "configurations", references: [{ consumerKey: "panel:colors:1", roleId }, { consumerKey: "panel:colors:2", roleId, postNo: 7 }], nextCursor: "synthetic_next_cursor" }
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.query(page)), response)
    f.respond({ ...response, references: [{ consumerKey: "panel:other:1", roleId }] })
    await rejected(f.store.query(page))
    f.respond({ ...response, references: [{ consumerKey: "panel:colors:1", roleId, _id: "synthetic_private_row" }] })
    await rejected(f.store.query(page))
})

test("Cancellation at HTTP boundary aborts the exact request and cannot produce a decoded grant", async t => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = Deferred.makeUnsafe<void>()
        let observedSignal: AbortSignal | undefined
        t.mock.method(globalThis, "fetch", (_url: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
            observedSignal = options.signal ?? undefined
            observedSignal?.addEventListener("abort", () => reject(new Error("Synthetic private abort")), { once: true })
            Effect.runSync(Deferred.succeed(entered, undefined))
        }))
        const store = createRolesStore(config)
        const fiber = yield* Effect.forkChild(store.evaluate(evaluate))
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        assert.equal(observedSignal?.aborted, true)
        assert(Exit.isFailure(yield* Fiber.await(fiber)))
    })).pipe(Effect.provide(TestClock.layer())))
})
