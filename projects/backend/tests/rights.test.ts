import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import type {
    ModerationActionContext,
    ModerationManageResult,
    ModerationQueryResult,
} from "@neonflux/contracts/moderation"
import { RIGHTS_DEFAULT_LIMITS, rightForAction, type RightsResult, type RightsStatus } from "@neonflux/contracts/rights"
import { botCall } from "./bot-service.ts"
import { convexBackend } from "./convex-backend.ts"
import type { ConvexError } from "convex/values"
import { configurationOperation } from "../convex/configurationDomain.ts"
import { configurationNativeOperation } from "../convex/configurationNative.ts"
import { applyModerationConfiguration } from "../convex/moderation.ts"
import { cleanupRights, rightsView } from "../convex/rights.ts"
import { readRecoveryInbox } from "../convex/recovery.ts"

const prior = { ...process.env },
    start = Date.parse("2026-01-01T00:00:00Z")
let clock = start
beforeEach(() => {
    clock = start
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-rights-test-secret-not-a-credential"
    delete process.env.NEONFLUX_SERVER_MODE
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET"])
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])

const STAFF_ROLE = "50",
    OTHER_ROLE = "51",
    STAFF = "20",
    OWNER = "21",
    ADMIN = "22",
    TARGET = "30"
const person = (
    userId: string,
    roleIds: string[] = [],
    fields: Partial<{ owner: boolean; admin: boolean; native: boolean }> = {},
) => ({
    originServerId: "10",
    userId,
    roleIds,
    isOwner: fields.owner ?? false,
    isAdministrator: fields.admin ?? false,
    nativePermissionAuthorized: fields.native ?? false,
})
const owner = person(OWNER, [], { owner: true, native: true })
const admin = person(ADMIN, [], { admin: true, native: true })
/** A member with the staff role and no real permission, as the bot read them just now */
const staff = person(STAFF, [STAFF_ROLE])
const baseContext: ModerationActionContext = {
    originServerId: "10",
    botId: "999",
    botActionAuthorized: true,
    actorCanManageTarget: true,
    botCanManageTarget: true,
    targetProtected: false,
    currentTimeoutUntil: null,
    rightRoleIds: [STAFF_ROLE],
}
function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async <T>(path: string, body: unknown, expected = 200) => {
        const bound = process.env.NEONFLUX_SERVER_MODE === "multi" ? (body as { serverId: string }).serverId : undefined
        const response = await botCall(t, path, body, bound ? { serverId: bound } : {})
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result as T
    }
    const source = (serverId = "10") => ({
        serverId,
        originServerId: serverId,
        messageId: String(++sequence),
        createdAt: clock,
    })
    const rights = (operation: unknown, actor: unknown = owner, expected = 200) =>
        post<RightsResult>("/rights/manage", { ...source(), actor, operation }, expected)
    const moderate = (operation: unknown, actor: unknown = owner, expected = 200) => {
        const { originServerId: _origin, ...message } = source()
        return post<ModerationManageResult>("/moderation/manage", { ...message, actor, operation }, expected)
    }
    const act = (
        action: Record<string, unknown>,
        actor: unknown = staff,
        expected = 200,
        context: Partial<ModerationActionContext> = {},
    ) =>
        moderate(
            { type: "action", action: { targetId: TARGET, ...action }, context: { ...baseContext, ...context } },
            actor,
            expected,
        )
    /** Rights on with the staff role in the moderation and security areas, holding these rights */
    const ready = async (...held: string[]) => {
        await moderate({
            type: "settings",
            patch: { staffRoleIds: { moderation: [STAFF_ROLE], security: [STAFF_ROLE] } },
        })
        await rights({ type: "module", enabled: true })
        if (held.length) await rights({ type: "grant", roleId: STAFF_ROLE, rights: held })
    }
    const status = () => post<RightsStatus>("/rights/status", { serverId: "10", actor: owner })
    return { t, post, rights, moderate, act, ready, status, source }
}
type Case = Extract<ModerationManageResult, { type: "case" }>

test("Every default refuses: With rights off, a member with a staff role and a stored right gets today's refusal", async () => {
    const { rights, moderate, act, post } = fixture()
    assert.deepEqual((await post<RightsResult>("/rights/get", { serverId: "10" })).settings.enabled, false)
    await moderate({ type: "settings", patch: { staffRoleIds: { moderation: [STAFF_ROLE] } } })
    await rights({ type: "grant", roleId: STAFF_ROLE, rights: ["kick"] })
    await act({ type: "kick" }, staff, 403)
    await rights({ type: "module", enabled: true })
    assert.equal(((await act({ type: "kick" })) as Case).grant?.viaRight, "kick")
    await rights({ type: "module", enabled: false })
    await act({ type: "kick" }, staff, 403)
})

test("A member with a staff role but no right gets exactly today's refusal, and a right passes for exactly that right", async () => {
    const { ready, act, rights } = fixture()
    await ready("kick")
    // The same status and code a member without the real permission gets when rights are off
    const response = await act({ type: "ban" }, staff, 403)
    assert.deepEqual(response, { error: "Staff permission required" })
    await act({ type: "warn" }, staff, 403)
    await act({ type: "timeout", durationSeconds: 60 }, staff, 403)
    await act({ type: "unban" }, staff, 403)
    assert.equal(((await act({ type: "kick" })) as Case).grant?.viaRight, "kick")
    await rights({ type: "revoke", roleId: STAFF_ROLE, rights: ["kick"] })
    await act({ type: "kick" }, staff, 403)
})

test("Every right maps to its action and reversal, and warnings, logs and deletions keep needing the real permission", () => {
    assert.deepEqual(
        Object.fromEntries(
            [
                "kick",
                "ban",
                "unban",
                "timeout",
                "untimeout",
                "purge",
                "slowmode",
                "lock",
                "unlock",
                "quarantine",
                "release",
                "jail",
                "unjail",
            ].map((action) => [action, rightForAction(action)]),
        ),
        {
            kick: "kick",
            ban: "ban",
            unban: "ban",
            timeout: "timeout",
            untimeout: "timeout",
            purge: "purge",
            slowmode: "slowmode",
            lock: "lock",
            unlock: "lock",
            quarantine: "quarantine",
            release: "quarantine",
            jail: "jail",
            unjail: "jail",
        },
    )
    for (const action of ["warn", "log", "delete", "constructor", "__proto__"])
        assert.equal(rightForAction(action), undefined)
})

test("A staff role for the area stays required: A lock right in the moderation area alone does nothing", async () => {
    const { rights, moderate, act } = fixture()
    await moderate({ type: "settings", patch: { staffRoleIds: { moderation: [STAFF_ROLE] } } })
    await rights({ type: "module", enabled: true })
    await rights({ type: "grant", roleId: STAFF_ROLE, rights: ["lock", "kick"] })
    await act({ type: "lock", targetId: undefined, channelId: "70" }, staff, 403, {
        currentOverwrite: { exists: false, allow: "0", deny: "0" },
        actorViewsChannel: true,
    })
    // Holding the right without any staff role for the area is today's refusal too
    await act({ type: "kick" }, person(STAFF, [OTHER_ROLE]), 403)
    await rights({ type: "grant", roleId: OTHER_ROLE, rights: ["kick"] })
    await act({ type: "kick" }, person(STAFF, [OTHER_ROLE]), 403, { rightRoleIds: [OTHER_ROLE] })
})

test("The fresh read wins: A member who lost the role is refused, whatever was stored or read before", async () => {
    const { ready, act } = fixture()
    await ready("kick")
    await act({ type: "kick" }, person(STAFF, []), 403, { rightRoleIds: [] })
    // Evidence that names a role the actor's own read does not hold grants nothing, so a stale cache cannot grant
    await act({ type: "kick" }, person(STAFF, []), 403, { rightRoleIds: [STAFF_ROLE] })
    await act({ type: "kick" }, person(STAFF, [OTHER_ROLE]), 403, { rightRoleIds: [STAFF_ROLE] })
})

test("A role later moved to or above NeonFlux stops counting, since the bot leaves it out of what it read below itself", async () => {
    const { ready, act, status } = fixture()
    await ready("kick")
    await act({ type: "kick" }, staff, 403, { rightRoleIds: [] })
    assert.equal((await status()).settings.grants.length, 1)
    assert.equal(((await act({ type: "kick" })) as Case).grant?.viaRight, "kick")
})

test("The hierarchy and target checks stay: At or above the actor, the owner, an Administrator, NeonFlux and the actor themselves are refused", async () => {
    const { ready, act, status } = fixture()
    await ready("kick", "ban")
    const code = async (
        context: Partial<ModerationActionContext>,
        action: Record<string, unknown> = { type: "kick" },
    ) => ((await act(action, staff, 403, context)) as unknown as { code?: string }).code
    assert.equal(await code({ actorCanManageTarget: false }), "ACTOR_BELOW_TARGET")
    assert.equal(
        await code({ targetProtected: true, actorCanManageTarget: false, botCanManageTarget: false }),
        "TARGET_PROTECTED",
    )
    assert.equal(await code({ botCanManageTarget: false }), "BOT_BELOW_TARGET")
    assert.equal(await code({}, { type: "kick", targetId: "999" }), "TARGET_PROTECTED")
    assert.equal(await code({}, { type: "kick", targetId: STAFF }), "TARGET_PROTECTED")
    assert.equal(await code({ botActionAuthorized: false }), "BOT_PERMISSION")
    // Refused actions cost nothing, since the refusal takes its count back with the transaction
    assert.equal((await status()).suspended.length, 0)
    for (let i = 0; i < RIGHTS_DEFAULT_LIMITS.kick.count; i++) await act({ type: "kick" })
    assert.equal((await status()).suspended.length, 0)
})

test("DEFCON stays: Level 1 refuses a right, and level 2 leaves it to the staff role as today", async () => {
    const { ready, act, moderate } = fixture()
    await ready("kick")
    await moderate({ type: "settings", patch: { defcon: 2 } })
    assert.equal(((await act({ type: "kick" })) as Case).grant?.viaRight, "kick")
    await moderate({ type: "settings", patch: { defcon: 1 } })
    await act({ type: "kick" }, staff, 403)
})

test("Going over a member's limit refuses, records, alerts and suspends in the same transaction, until the owner clears it", async () => {
    const { ready, act, rights, status } = fixture()
    await ready("ban", "kick")
    for (let i = 0; i < RIGHTS_DEFAULT_LIMITS.ban.count; i++)
        assert.equal(((await act({ type: "ban" })) as Case).grant?.viaRight, "ban")
    const over = (await act({ type: "ban" })) as Extract<ModerationManageResult, { type: "right-refused" }>
    assert.equal(over.type, "right-refused")
    assert.equal(over.reason, "limit")
    assert.equal(over.right, "ban")
    assert.deepEqual(
        (await status()).suspended.map((row) => [row.userId, row.reason, row.right]),
        [[STAFF, "limit", "ban"]],
    )
    // A suspended member holds no right at all, even one under its own limit
    const refused = (await act({ type: "kick" }, staff, 403)) as unknown as { code?: string; error?: string }
    assert.equal(refused.code, "REFUSED")
    assert.match(refused.error!, /suspended/)
    // Only the owner lifts it, and the count starts over
    await rights({ type: "clear", userId: STAFF }, admin, 403)
    await rights({ type: "clear", userId: STAFF })
    assert.equal((await status()).suspended.length, 0)
    assert.equal(((await act({ type: "ban" })) as Case).grant?.viaRight, "ban")
})

test("The sliding window lets actions through again as the old ones leave it", async () => {
    const { ready, act, rights } = fixture()
    await ready("kick")
    await rights({ type: "limit", right: "kick", count: 2, minutes: 10 })
    await act({ type: "kick" })
    clock += 6 * 60000
    await act({ type: "kick" })
    clock += 5 * 60000
    assert.equal(((await act({ type: "kick" })) as Case).type, "case")
})

test("The server-wide ceiling refuses without suspending, so several accounts cannot add up past it", async () => {
    const { ready, act, rights, status } = fixture()
    await ready("kick")
    await rights({ type: "limit", right: "kick", count: 1, minutes: 10 })
    for (const id of ["31", "32", "33"])
        assert.equal(((await act({ type: "kick" }, person(id, [STAFF_ROLE]))) as Case).type, "case")
    const over = (await act({ type: "kick" }, person("34", [STAFF_ROLE]))) as Extract<
        ModerationManageResult,
        { type: "right-refused" }
    >
    assert.equal(over.reason, "ceiling")
    assert.equal((await status()).suspended.length, 0)
})

test("A limit is counted once when a write's outcome is unknown, and a redelivered message counts nothing", async () => {
    const { ready, act, post, t, source, rights } = fixture()
    await ready("kick")
    await rights({ type: "limit", right: "kick", count: 2, minutes: 10 })
    const usage = () => t.run((ctx) => ctx.db.query("rightsUsage").collect())
    const reserved = (await act({ type: "kick" })) as Case
    assert.equal((await usage()).length, 1)
    await post("/moderation/outcome", {
        serverId: "10",
        actionId: reserved.grant!.actionId,
        caseNo: reserved.grant!.caseNo,
        dispatch: true,
    })
    await post("/moderation/outcome", {
        serverId: "10",
        actionId: reserved.grant!.actionId,
        caseNo: reserved.grant!.caseNo,
        outcome: "uncertain",
    })
    assert.equal((await usage()).length, 1)
    await post("/moderation/reconcile", {
        ...source(),
        actor: owner,
        privateChannelVerified: true,
        actionId: reserved.grant!.actionId,
        observation: { originServerId: "10", observedAt: clock, memberPresent: true, memberUserId: TARGET },
    })
    assert.equal((await usage()).length, 1)
    // The same message again, as a gateway redelivery sends it
    const { originServerId: _origin, ...message } = source()
    const request = {
        ...message,
        actor: staff,
        operation: { type: "action", action: { type: "kick", targetId: TARGET }, context: baseContext },
    }
    await post("/moderation/manage", request)
    await post("/moderation/manage", request)
    assert.equal((await usage()).length, 2)
})

test("Turning rights off, revoking or suspending stops an action that was reserved and not yet sent, and its outcome is recorded", async () => {
    const { ready, act, post, rights } = fixture()
    await ready("kick")
    const reserved = (await act({ type: "kick" })) as Case
    const dispatch = {
        serverId: "10",
        actionId: reserved.grant!.actionId,
        caseNo: reserved.grant!.caseNo,
        dispatch: true,
    }
    await rights({ type: "module", enabled: false }, admin)
    assert.deepEqual(await post("/moderation/outcome", dispatch), { recorded: false, rightWithdrawn: true })
    const recorded = await post<{ recorded: boolean }>("/moderation/outcome", {
        serverId: "10",
        actionId: reserved.grant!.actionId,
        caseNo: reserved.grant!.caseNo,
        outcome: "failed",
    })
    assert.equal(recorded.recorded, true)
    await rights({ type: "module", enabled: true })
    const second = (await act({ type: "kick" })) as Case
    await rights({ type: "revoke", roleId: STAFF_ROLE }, admin)
    assert.deepEqual(
        await post("/moderation/outcome", {
            serverId: "10",
            actionId: second.grant!.actionId,
            caseNo: second.grant!.caseNo,
            dispatch: true,
        }),
        { recorded: false, rightWithdrawn: true },
    )
    // An action by a member with the real permission is not touched
    const native = (await act({ type: "kick" }, person("40", [], { native: true, admin: true }))) as Case
    assert.equal(native.grant?.viaRight, undefined)
    const claim = await post<{ rightWithdrawn?: true }>("/moderation/outcome", {
        serverId: "10",
        actionId: native.grant!.actionId,
        caseNo: native.grant!.caseNo,
        dispatch: true,
    })
    assert.equal(claim.rightWithdrawn, undefined)
})

test("A suspended member's unlock, release and unjail read gets the suspension sentence, as every other action does", async () => {
    const { ready, post } = fixture()
    await ready("lock", "quarantine", "jail")
    await post("/rights/suspend", { serverId: "10", userId: STAFF })
    for (const operation of [
        { type: "recovery-channel", channelId: "70" },
        { type: "recovery-target", targetId: TARGET },
        { type: "jail-record", targetId: TARGET },
    ]) {
        const refused = await post<{ code: string; error: string }>(
            "/moderation/query",
            {
                serverId: "10",
                originServerId: "10",
                actor: staff,
                rightRoleIds: [STAFF_ROLE],
                actorViewsChannel: true,
                operation,
            },
            403,
        )
        assert.equal(refused.code, "REFUSED")
        assert.match(refused.error, /suspended/)
    }
})

test("A clear resets every right's active window, however many old rows the member has", async () => {
    const { t, ready, act, rights, status } = fixture()
    await ready("kick", "ban")
    await t.run(async (ctx) => {
        // Rows of another right, outside their window, sort first and must not use up the clear
        for (let index = 0; index < 600; index++)
            await ctx.db.insert("rightsUsage", {
                serverId: "10",
                userId: STAFF,
                right: "ban",
                at: clock - 60 * 60000 - index,
                expiresAt: clock + 60000,
            })
    })
    for (let index = 0; index < RIGHTS_DEFAULT_LIMITS.kick.count; index++) await act({ type: "kick" })
    assert.equal(((await act({ type: "kick" })) as { type: string }).type, "right-refused")
    await rights({ type: "clear", userId: STAFF })
    assert.equal((await status()).suspended.length, 0)
    assert.equal(((await act({ type: "kick" })) as Case).grant?.viaRight, "kick")
    assert.equal((await status()).suspended.length, 0)
})

test("An owner-only change on the dashboard refuses with a sentence the website shows", async () => {
    const { t } = fixture()
    const refused = await t.run(async (ctx) => {
        try {
            await configurationNativeOperation(ctx, "10", "rights", { type: "module", enabled: true }, {
                jobId: "1",
                serverId: "10",
                revision: 1,
                actorId: ADMIN,
                managerAuthorized: true,
                observedAt: clock,
                actor: admin,
            } as never)
            return undefined
        } catch (error) {
            return (error as ConvexError<{ code?: string; error?: string }>).data
        }
    })
    assert.equal(refused?.code, "REFUSED")
    assert.match(refused?.error ?? "", /Only the server owner/)
})

test("Anti-nuke suspends a member, in any mode, and a server with rights off stores nothing", async () => {
    const { ready, post, act, status, rights } = fixture()
    assert.deepEqual(await post("/rights/suspend", { serverId: "10", userId: STAFF }), {
        suspended: false,
        admitted: false,
    })
    assert.equal((await status()).suspended.length, 0)
    await ready("kick")
    const first = await post<{ suspended: boolean }>("/rights/suspend", { serverId: "10", userId: STAFF })
    assert.equal(first.suspended, true)
    assert.deepEqual(await post("/rights/suspend", { serverId: "10", userId: STAFF }), {
        suspended: false,
        admitted: false,
    })
    await act({ type: "kick" }, staff, 403)
    assert.equal((await status()).suspended[0]?.reason, "anti-nuke")
    await rights({ type: "clear", userId: STAFF })
    assert.equal(((await act({ type: "kick" })) as Case).type, "case")
})

test("Who may change what: Owner for on, grant, limit and clear, and the owner or an Administrator for off and revoke, at DEFCON 1 too", async () => {
    const { rights, moderate } = fixture()
    const notOwner = person(STAFF, [STAFF_ROLE], { native: true })
    for (const op of [
        { type: "module", enabled: true },
        { type: "grant", roleId: STAFF_ROLE, rights: ["kick"] },
        { type: "limit", right: "kick", count: 1, minutes: 5 },
        { type: "clear", userId: STAFF },
    ]) {
        await rights(op, admin, 403)
        await rights(op, notOwner, 403)
    }
    await rights({ type: "module", enabled: true })
    await rights({ type: "grant", roleId: STAFF_ROLE, rights: ["kick"] })
    await moderate({ type: "settings", patch: { defcon: 1 } })
    await rights({ type: "grant", roleId: OTHER_ROLE, rights: ["ban"] }, owner, 403)
    await rights({ type: "revoke", roleId: STAFF_ROLE }, notOwner, 403)
    const revoked = await rights({ type: "revoke", roleId: STAFF_ROLE }, admin)
    assert.deepEqual(revoked.settings.grants, [])
    assert.equal((await rights({ type: "module", enabled: false }, admin)).settings.enabled, false)
})

test("A grant to the everyone role is refused, in chat and on the dashboard's shared rules", async () => {
    const { rights } = fixture()
    const refused = (await rights({ type: "grant", roleId: "10", rights: ["kick"] }, owner, 400)) as unknown as {
        code: string
    }
    assert.equal(refused.code, "REFUSED")
})

test("Grants add to a role, a partial revoke keeps the rest, and bad limits never decode", async () => {
    const { rights } = fixture()
    await rights({ type: "grant", roleId: STAFF_ROLE, rights: ["kick"] })
    let settings = (await rights({ type: "grant", roleId: STAFF_ROLE, rights: ["ban", "kick"] })).settings
    assert.deepEqual(settings.grants, [{ roleId: STAFF_ROLE, rights: ["kick", "ban"] }])
    settings = (await rights({ type: "revoke", roleId: STAFF_ROLE, rights: ["kick"] })).settings
    assert.deepEqual(settings.grants, [{ roleId: STAFF_ROLE, rights: ["ban"] }])
    await rights({ type: "limit", right: "kick", count: 0, minutes: 5 }, owner, 400)
    await rights({ type: "limit", right: "kick", count: 51, minutes: 5 }, owner, 400)
    await rights({ type: "limit", right: "kick", count: 1, minutes: 1441 }, owner, 400)
    await rights({ type: "grant", roleId: STAFF_ROLE, rights: ["warn"] }, owner, 400)
    await rights({ type: "grant", roleId: STAFF_ROLE, rights: [] }, owner, 400)
})

test("A channel action needs an actor who can view the channel", async () => {
    const { ready, act } = fixture()
    await ready("slowmode")
    const action = { type: "slowmode", targetId: undefined, channelId: "70", slowmodeSeconds: 5 }
    await act(action, staff, 403, { currentSlowmodeSeconds: 0 })
    const allowed = (await act(action, staff, 200, { currentSlowmodeSeconds: 0, actorViewsChannel: true })) as Case
    assert.equal(allowed.grant?.viaRight, "slowmode")
})

test("A reversal's one read passes for its right and for nothing else", async () => {
    const { ready, post, t } = fixture()
    await ready("lock")
    await t.run(async (ctx) => {
        await ctx.db.insert("securityRecoveries", {
            serverId: "10",
            generation: 1,
            type: "lock",
            channelId: "70",
            caseNo: 1,
            status: "active",
            createdAt: clock,
        })
    })
    const read = (operation: unknown, evidence: Record<string, unknown>, expected = 200) =>
        post<ModerationQueryResult>(
            "/moderation/query",
            { serverId: "10", originServerId: "10", actor: staff, ...evidence, operation },
            expected,
        )
    await read({ type: "recovery-channel", channelId: "70" }, {}, 403)
    await read({ type: "recovery-channel", channelId: "70" }, { rightRoleIds: [STAFF_ROLE] }, 403)
    const found = await read(
        { type: "recovery-channel", channelId: "70" },
        { rightRoleIds: [STAFF_ROLE], actorViewsChannel: true },
    )
    assert.equal(found.type, "recovery")
    await read({ type: "recovery-target", targetId: TARGET }, { rightRoleIds: [STAFF_ROLE] }, 403)
    await read({ type: "case-list" }, { rightRoleIds: [STAFF_ROLE], actorViewsChannel: true }, 403)
})

test("A right granted on one server is not honored on another, and evidence read from another server is refused", async () => {
    process.env.NEONFLUX_SERVER_MODE = "multi"
    delete process.env.NEONFLUX_SERVER_ID
    const { t, post, source } = fixture()
    await t.run(async (ctx) => {
        for (const serverId of ["10", "11"])
            await ctx.db.insert("serverInstallations", { serverId, status: "active", joinedAt: clock })
    })
    const onServer = (
        serverId: string,
        userId: string,
        roleIds: string[],
        fields: Partial<{ owner: boolean }> = {},
    ) => ({
        originServerId: serverId,
        userId,
        roleIds,
        isOwner: fields.owner ?? false,
        isAdministrator: false,
        nativePermissionAuthorized: fields.owner ?? false,
    })
    const manage = (serverId: string, path: string, actor: unknown, operation: unknown, expected = 200) => {
        const { originServerId, ...message } = source(serverId)
        return post(
            path,
            { ...message, ...(path === "/rights/manage" ? { originServerId } : {}), actor, operation },
            expected,
        )
    }
    for (const serverId of ["10", "11"])
        await manage(serverId, "/moderation/manage", onServer(serverId, OWNER, [], { owner: true }), {
            type: "settings",
            patch: { staffRoleIds: { moderation: [STAFF_ROLE] } },
        })
    const boss = onServer("10", OWNER, [], { owner: true })
    await manage("10", "/rights/manage", boss, { type: "module", enabled: true })
    await manage("10", "/rights/manage", boss, { type: "grant", roleId: STAFF_ROLE, rights: ["kick"] })
    const action = (serverId: string) => ({
        type: "action",
        action: { type: "kick", targetId: TARGET },
        context: { ...baseContext, originServerId: serverId },
    })
    await manage("10", "/moderation/manage", onServer("10", STAFF, [STAFF_ROLE]), action("10"))
    // The same role on the other server holds nothing
    await manage("11", "/moderation/manage", onServer("11", STAFF, [STAFF_ROLE]), action("11"), 403)
    // Native evidence read on the first server authorizes nothing on the second
    await manage("11", "/moderation/manage", onServer("10", STAFF, [STAFF_ROLE]), action("10"), 403)
})

test("No dashboard operation can moderate: The rights family takes settings only, and the moderation family takes no action", async () => {
    assert.throws(() =>
        configurationOperation("rights", {
            type: "action",
            action: { type: "kick", targetId: TARGET },
            context: baseContext,
        }),
    )
    const { t } = fixture()
    await assert.rejects(() =>
        t.run((ctx) =>
            applyModerationConfiguration(
                ctx,
                "10",
                { type: "action", action: { type: "kick", targetId: TARGET }, context: baseContext },
                clock,
            ),
        ),
    )
    for (const op of [
        { type: "module", enabled: true },
        { type: "grant", roleId: STAFF_ROLE, rights: ["kick"] },
        { type: "revoke", roleId: STAFF_ROLE },
        { type: "limit", right: "kick", count: 1, minutes: 5 },
        { type: "clear", userId: STAFF },
    ])
        assert.deepEqual(configurationOperation("rights", op), op)
})

test("Usage rows end after the longest window a limit can have", async () => {
    const { ready, act, t } = fixture()
    await ready("kick")
    await act({ type: "kick" })
    assert.equal((await t.run((ctx) => ctx.db.query("rightsUsage").collect())).length, 1)
    clock += 1440 * 60000 + 1
    await t.run((ctx) => cleanupRights(ctx, clock))
    assert.equal((await t.run((ctx) => ctx.db.query("rightsUsage").collect())).length, 0)
})

test("Any website manager sees how many members are suspended, not who, and chat keeps the names to staff", async () => {
    const { t, ready, post, status } = fixture()
    await ready("kick")
    await post("/rights/suspend", { serverId: "10", userId: STAFF })
    const view = await t.run((ctx) => rightsView(ctx, "10"))
    assert.equal(view.suspendedCount, 1)
    assert.equal(JSON.stringify(view).includes(STAFF), false)
    assert.equal((await status()).suspended[0]?.userId, STAFF)
    const inbox = await t.run((ctx) => readRecoveryInbox(ctx, "10"))
    assert.equal(JSON.stringify(inbox.entries).includes(`<@${STAFF}>`), false)
    assert.match(JSON.stringify(inbox.entries), /1 member's bot-only rights are suspended/)
})
