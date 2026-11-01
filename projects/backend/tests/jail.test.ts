import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import type { JailMemory, JailResult, JailStatus } from "@neonflux/contracts/jail"
import type { ModerationActionContext, ModerationManageResult } from "@neonflux/contracts/moderation"
import type { Id } from "../convex/_generated/dataModel.js"
import { botCall } from "./bot-service.ts"
import { convexBackend } from "./convex-backend.ts"
import { ConvexError } from "convex/values"
import { jailView } from "../convex/jailStore.ts"
import { memberDataDelete, memberDataExport } from "../convex/memberData.ts"
import { ONBOARDING_ROLE_KEY } from "../convex/onboardingDomain.ts"
import { grantEligibility } from "../convex/roleClaims.ts"
import { TEMPORARY_ROLE_KEY } from "../convex/temporaryRolesStore.ts"
import { readRecoveryInbox } from "../convex/recovery.ts"
import { readSetupSections } from "../convex/setupCheck.ts"
import { dueWork } from "../convex/workDispatch.ts"
import { cleanupModeration } from "../convex/moderation.ts"

const prior = { ...process.env },
    start = Date.parse("2026-01-01T00:00:00Z")
let clock = start
beforeEach(() => {
    clock = start
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-jail-test-secret-not-a-credential"
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
const JAIL_ROLE = "60",
    JAIL_CHANNEL = "61",
    STAFF_ROLE = "50",
    MEMBER = "30",
    OLD_ROLES = ["71", "72"]
const actor = (
    fields: Partial<{ owner: boolean; admin: boolean; native: boolean; roleIds: string[]; userId: string }> = {},
) => ({
    originServerId: "10",
    userId: fields.userId ?? "20",
    roleIds: fields.roleIds ?? [],
    isOwner: fields.owner ?? false,
    isAdministrator: fields.admin ?? false,
    nativePermissionAuthorized: fields.native ?? true,
})
const owner = actor({ owner: true })
const mod = actor({ roleIds: [STAFF_ROLE] })
const context = (fields: Partial<ModerationActionContext> = {}): ModerationActionContext => ({
    originServerId: "10",
    botId: "999",
    botActionAuthorized: true,
    actorCanManageTarget: true,
    botCanManageTarget: true,
    targetProtected: false,
    targetRoleIds: OLD_ROLES,
    ...fields,
})
type Case = Extract<ModerationManageResult, { type: "case" }>
function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async <T>(path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result as T
    }
    const source = () => ({ serverId: "10", messageId: String(++sequence), createdAt: clock })
    const manage = (operation: unknown, who: unknown = owner, expected = 200) =>
        post<JailResult>("/jail/manage", { ...source(), originServerId: "10", actor: who, operation }, expected)
    const moderate = (operation: unknown, who: unknown = owner, expected = 200) =>
        post<ModerationManageResult>("/moderation/manage", { ...source(), actor: who, operation }, expected)
    const act = (
        action: Record<string, unknown>,
        who: unknown = mod,
        expected = 200,
        fields: Partial<ModerationActionContext> = {},
    ) => moderate({ type: "action", action: { targetId: MEMBER, ...action }, context: context(fields) }, who, expected)
    const outcome = async (grant: Case["grant"], result: "succeeded" | "failed" | "uncertain") => {
        await post("/moderation/outcome", {
            serverId: "10",
            actionId: grant!.actionId,
            caseNo: grant!.caseNo,
            dispatch: true,
        })
        return post<{ recorded: boolean; notice?: { action: string; appeals: boolean } }>("/moderation/outcome", {
            serverId: "10",
            actionId: grant!.actionId,
            caseNo: grant!.caseNo,
            outcome: result,
        })
    }
    const record = () =>
        t.run((ctx) =>
            ctx.db
                .query("jailRecords")
                .withIndex("by_server_user", (q) => q.eq("serverId", "10").eq("userId", MEMBER))
                .unique(),
        )
    const ready = async () => {
        await moderate({ type: "settings", patch: { staffRoleIds: { moderation: [STAFF_ROLE] } } })
        await manage({ type: "setup", roleId: JAIL_ROLE, channelId: JAIL_CHANNEL })
    }
    const jailed = async (fields: Record<string, unknown> = {}) => {
        const reserved = (await act({ type: "jail", ...fields })) as Case
        await outcome(reserved.grant, "succeeded")
        return reserved
    }
    return { t, post, manage, moderate, act, outcome, record, ready, jailed, source }
}

test("A first jail stores the member's roles before the one edit, and a second changes only length and reason", async () => {
    const { ready, act, outcome, record, post } = fixture()
    await ready()
    const first = (await act({ type: "jail", durationSeconds: 3600, reason: "First" })) as Case
    assert.equal(first.grant?.jailRoleId, JAIL_ROLE)
    assert.deepEqual(first.grant?.expectedRoleIds, OLD_ROLES)
    let row = await record()
    assert.equal(row?.state, "jailing")
    assert.deepEqual(row?.roleIds, OLD_ROLES)
    const notice = await outcome(first.grant, "succeeded")
    assert.equal(notice.notice?.action, "jail")
    assert.equal((await record())?.state, "active")
    clock += 1000
    // The member holds only the jail role now, which must never replace what they get back
    const second = (await act({ type: "jail", durationSeconds: 7200, reason: "Second" }, mod, 200, {
        targetRoleIds: [JAIL_ROLE],
    })) as Case
    assert.equal(second.grant?.jailRoleId, undefined)
    assert.equal(second.grant?.expectedRoleIds, undefined)
    row = await record()
    assert.deepEqual(row?.roleIds, OLD_ROLES)
    assert.equal(second.case.reason, "Second")
    assert.equal(row?.releaseAt, clock + 7200000)
    assert.equal(row?.caseNo, first.case.caseNo)
    await outcome(second.grant, "succeeded")
    assert.equal((await record())?.state, "active")
    const memory = await post<JailMemory>("/jail/memory", { serverId: "10" })
    assert.deepEqual(memory.jailedIds, [MEMBER])
    assert.deepEqual(memory.moderationRoleIds, [STAFF_ROLE])
})

test("An unknown outcome is never repeated: A jail or unjail in doubt refuses both until a read settles it", async () => {
    const { ready, act, outcome, record, post, source } = fixture()
    await ready()
    const first = (await act({ type: "jail" })) as Case
    await outcome(first.grant, "uncertain")
    assert.equal((await record())?.state, "jail-uncertain")
    // Nothing holds the member on a doubt, so no member update sends the edit again. The command gate and the record keep them shut out
    const doubted = await post<JailMemory>("/jail/memory", { serverId: "10" })
    assert.deepEqual(doubted.jailedIds, [])
    assert.deepEqual(doubted.confinedIds, [MEMBER])
    const again = (await act({ type: "jail" }, mod, 409)) as unknown as { code: string; error: string }
    assert.equal(again.code, "REFUSED")
    assert.match(again.error, /recover/)
    await act({ type: "unjail" }, mod, 409)
    const reconcile = (actionId: string, observation: Record<string, unknown>) =>
        post<{ jailHeld?: boolean }>("/moderation/reconcile", {
            ...source(),
            originServerId: "10",
            actor: owner,
            privateChannelVerified: true,
            actionId,
            observation: { originServerId: "10", observedAt: clock, memberUserId: MEMBER, ...observation },
        })
    clock += 1
    // Fluxer shows the jail role, so the jail took effect, and nothing is sent again
    const settled = await reconcile(first.grant!.actionId, { memberPresent: true, roleIds: [JAIL_ROLE] })
    assert.equal(settled.jailHeld, true)
    assert.equal((await record())?.state, "active")
    assert.deepEqual((await record())?.roleIds, OLD_ROLES)
    const release = (await act({ type: "unjail" })) as Case
    assert.deepEqual(release.grant?.restoreRoleIds, OLD_ROLES)
    await outcome(release.grant, "uncertain")
    assert.equal((await record())?.state, "release-uncertain")
    assert.deepEqual((await post<JailMemory>("/jail/memory", { serverId: "10" })).jailedIds, [])
    assert.deepEqual((await post<JailMemory>("/jail/memory", { serverId: "10" })).confinedIds, [MEMBER])
    clock += 1
    const back = await reconcile(release.grant!.actionId, { memberPresent: true, roleIds: OLD_ROLES })
    assert.equal(back.jailHeld, false)
    assert.equal(await record(), null)
})

test("A jail read as never applied ends without touching the member, and the case keeps no roles", async () => {
    const { t, ready, act, outcome, record, post, source } = fixture()
    await ready()
    const first = (await act({ type: "jail" })) as Case
    await outcome(first.grant, "uncertain")
    clock += 1
    await post("/moderation/reconcile", {
        ...source(),
        originServerId: "10",
        actor: owner,
        privateChannelVerified: true,
        actionId: first.grant!.actionId,
        observation: {
            originServerId: "10",
            observedAt: clock,
            memberUserId: MEMBER,
            memberPresent: true,
            roleIds: OLD_ROLES,
        },
    })
    assert.equal(await record(), null)
    const stored = await t.run((ctx) => ctx.db.get(first.grant!.actionId as Id<"moderationCases">))
    assert.equal(JSON.stringify(stored?.observation).includes("roleIds"), false)
    assert.equal(stored?.grant?.expectedRoleIds, undefined)
})

test("Stored roles end with the release: Neither the jail's case nor the release's keeps them", async () => {
    const { t, ready, jailed, act, outcome, record } = fixture()
    await ready()
    const first = await jailed()
    const release = (await act({ type: "unjail" })) as Case
    assert.deepEqual(release.grant?.restoreRoleIds, OLD_ROLES)
    await outcome(release.grant, "succeeded")
    assert.equal(await record(), null)
    for (const grant of [first.grant!, release.grant!]) {
        const stored = await t.run((ctx) => ctx.db.get(grant.actionId as Id<"moderationCases">))
        assert.equal(stored?.grant?.expectedRoleIds, undefined)
        assert.equal(stored?.grant?.restoreRoleIds, undefined)
    }
})

test("An erased reason stays erased: The record holds no reason of its own, and member data shows none", async () => {
    const { t, ready, jailed, moderate, record } = fixture()
    await ready()
    const reserved = await jailed({ reason: "Private words" })
    await moderate({ type: "erase", caseNo: reserved.case.caseNo })
    assert.equal(JSON.stringify(await record()).includes("Private words"), false)
    const shown = await t.run((ctx) => memberDataExport(ctx, MEMBER, "10", null))
    assert.equal(JSON.stringify(shown).includes("Private words"), false)
})

test("Who is jailed follows the private rule: A verified DM or a staff channel only, and the dashboard shows only a count", async () => {
    const { t, ready, jailed, post } = fixture()
    await ready()
    await jailed()
    const list = (evidence: Record<string, unknown>, expected = 200) =>
        post<{ entries: { userId: string }[] }>(
            "/jail/list",
            { serverId: "10", originServerId: "10", actor: mod, ...evidence },
            expected,
        )
    await list({}, 403)
    await list({ staffChannelRoleIds: ["99"] }, 403)
    assert.equal((await list({ privateChannelVerified: true })).entries[0]?.userId, MEMBER)
    assert.equal((await list({ staffChannelRoleIds: [STAFF_ROLE] })).entries[0]?.userId, MEMBER)
    const view = await t.run((ctx) => jailView(ctx, "10"))
    assert.equal(view.count, 1)
    assert.equal(JSON.stringify(view).includes(MEMBER), false)
})

test("Restart observation makes a jail or unjail in flight uncertain", async () => {
    const { ready, act, record, post } = fixture()
    await ready()
    await act({ type: "jail" })
    await post("/moderation/observe", { serverId: "10" })
    assert.equal((await record())?.state, "jail-uncertain")
    const other = fixture()
    await other.ready()
    await other.jailed()
    await other.act({ type: "unjail" })
    await other.post("/moderation/observe", { serverId: "10" })
    assert.equal((await other.record())?.state, "release-uncertain")
})

test("A failed jail or unjail leaves things as they were", async () => {
    const { ready, act, outcome, record, jailed } = fixture()
    await ready()
    const first = (await act({ type: "jail" })) as Case
    await outcome(first.grant, "failed")
    assert.equal(await record(), null)
    await jailed({ durationSeconds: 60 })
    clock += 120000
    const release = (await act({ type: "unjail" })) as Case
    assert.equal((await record())?.state, "releasing")
    assert.equal((await record())?.timed, undefined)
    await outcome(release.grant, "failed")
    const row = await record()
    assert.equal(row?.state, "active")
    assert.equal(row?.timed, true)
    assert.ok(row!.nextCheckAt! > clock)
})

test("Jail follows the moderation rules: Staff area, native permission, hierarchy and setup", async () => {
    const { ready, act, manage, moderate } = fixture()
    const unset = (await act({ type: "jail" }, owner, 409)) as unknown as { error: string }
    assert.match(unset.error, /!jail setup/)
    await ready()
    await act({ type: "jail" }, actor({ roleIds: [STAFF_ROLE], native: false }), 403)
    await act({ type: "jail" }, actor({ roleIds: ["99"] }), 403)
    const code = async (fields: Partial<ModerationActionContext>) =>
        ((await act({ type: "jail" }, mod, 403, fields)) as unknown as { code: string }).code
    assert.equal(await code({ actorCanManageTarget: false }), "ACTOR_BELOW_TARGET")
    assert.equal(await code({ botCanManageTarget: false }), "BOT_BELOW_TARGET")
    assert.equal(await code({ targetProtected: true }), "TARGET_PROTECTED")
    await act({ type: "unjail" }, mod, 404)
    await manage({ type: "module", enabled: false })
    await act({ type: "jail" }, mod, 409)
    await manage({ type: "module", enabled: true })
    await moderate({ type: "settings", patch: { manualModerationEnabled: false } })
    await act({ type: "jail" }, mod, 403)
})

test("An unjail stays reachable at DEFCON 1 for an Administrator and with moderation off, and a moderator's jail does not", async () => {
    const { ready, jailed, act, moderate } = fixture()
    await ready()
    await jailed()
    await moderate({ type: "settings", patch: { manualModerationEnabled: false, defcon: 1 } })
    await act({ type: "jail" }, mod, 403)
    await act({ type: "unjail" }, mod, 403)
    const release = (await act({ type: "unjail" }, actor({ admin: true }))) as Case
    assert.equal(release.grant?.action, "unjail")
})

test("A jailed member joins no role feature: Every feature that gives a role sees the same refusal", async () => {
    const { t, ready, jailed } = fixture()
    await ready()
    await jailed()
    const member = {
        originServerId: "10",
        userId: MEMBER,
        joinedAt: "2026-01-01T00:00:00.000Z",
        roleIds: [JAIL_ROLE],
        isBot: false,
        timeoutUntil: null,
        botId: "999",
        botAuthorized: true,
        roles: [],
    }
    await t.run(async (ctx) => {
        await ctx.db.insert("temporaryRoleGrants", {
            serverId: "10",
            userId: MEMBER,
            roleId: "73",
            joinedAt: member.joinedAt,
            grantedBy: "20",
            generation: 1,
            endsAt: clock + 3600000,
            nextCheckAt: clock,
            createdAt: clock,
            updatedAt: clock,
        })
    })
    const grantId = await t.run(async (ctx) => (await ctx.db.query("temporaryRoleGrants").first())!._id)
    const panelFields = { name: "colors", revision: 1 }
    const requests: [string, unknown, string][] = [
        ["rules verification", { type: "verify", name: "rules", revision: 1 }, "verify_a"],
        ["role panel", { type: "choose", ...panelFields, roleId: "73", selected: true }, "choose_a"],
        [
            "reaction role",
            {
                type: "reaction",
                ...panelFields,
                messageId: "80",
                presentEmojis: [],
                panelVerified: true,
                clearGeneration: 0,
            },
            "reaction_a",
        ],
        ["temporary role", { type: "temporary", roleId: "73" }, `temp_${grantId}_1`],
    ]
    for (const [feature, operation, sourceId] of requests) {
        const response = await botCall(t, "/roles/evaluate", {
            serverId: "10",
            sourceId,
            createdAt: clock,
            context: member,
            operation,
        })
        const body = (await response.json()) as { code?: string }
        assert.equal(response.status, 403, `${feature}: ${JSON.stringify(body)}`)
        assert.equal(body.code, "MEMBER_NOT_READY", feature)
    }
    // Every added role also passes this check when it is evaluated and again right before it is sent, whichever feature asked for it
    const keys: [string, string][] = [
        ["autorole", "autorole:1"],
        ["role panel", "panel:colors:1"],
        ["role picker", "picker:colors"],
        ["level reward", "level"],
        ["temporary role", TEMPORARY_ROLE_KEY],
        ["newcomer checklist", ONBOARDING_ROLE_KEY],
    ]
    const eligibility = (key: string, verification = false) =>
        t.run(async (ctx) => {
            try {
                await grantEligibility(ctx, "10", member, key, "73", verification)
                return "allowed"
            } catch (error) {
                return error instanceof ConvexError ? (error.data as { code?: string }).code : "other"
            }
        })
    for (const [feature, key] of keys) assert.equal(await eligibility(key), "MEMBER_NOT_READY", feature)
    assert.equal(await eligibility("panel:rules:1", true), "MEMBER_NOT_READY", "rules verification")
    // The refusal is the jail's: Without the record each one reads on to its own checks
    await t.run(async (ctx) => {
        const row = await ctx.db.query("jailRecords").first()
        await ctx.db.delete(row!._id)
    })
    for (const [feature, key] of keys) assert.notEqual(await eligibility(key), "MEMBER_NOT_READY", feature)
})

const endedGrant = (roleId: string, joinedAt: string) => ({
    serverId: "10",
    userId: MEMBER,
    roleId,
    joinedAt,
    grantedBy: "20",
    generation: 1,
    endsAt: clock - 1,
    nextCheckAt: clock - 1,
    createdAt: clock,
    updatedAt: clock,
})
/** The role as NeonFlux added it for these features, with the reference each keeps */
async function ownedRole(
    t: ReturnType<typeof fixture>["t"],
    roleId: string,
    joinedAt: string,
    desired: Record<string, boolean>,
) {
    await t.run(async (ctx) => {
        const ownershipId = await ctx.db.insert("roleOwnership", {
            serverId: "10",
            userId: MEMBER,
            joinedAt,
            roleId,
            generation: 1,
            owned: true,
            protected: true,
            status: "idle",
            updatedAt: clock,
        })
        for (const [consumerKey, want] of Object.entries(desired))
            await ctx.db.insert("roleReferences", {
                serverId: "10",
                consumerKey,
                roleId,
                configuration: false,
                desired: want,
                ownershipId,
                createdAt: clock,
            })
    })
}
const evaluateEnded = (t: ReturnType<typeof fixture>["t"], grantId: string, roleId: string, joinedAt: string) =>
    botCall(t, "/roles/evaluate", {
        serverId: "10",
        sourceId: `temp_${grantId}_1`,
        createdAt: clock,
        context: {
            originServerId: "10",
            userId: MEMBER,
            joinedAt,
            roleIds: [JAIL_ROLE],
            isBot: false,
            timeoutUntil: null,
            botId: "999",
            botAuthorized: true,
            roles: [],
        },
        operation: { type: "temporary", roleId },
    })

test("A temporary role that ends during a jail leaves the stored roles, so unjail does not give it back", async () => {
    const { t, ready, jailed, record } = fixture()
    await ready()
    await jailed()
    const joinedAt = "2026-01-01T00:00:00.000Z"
    const roleId = OLD_ROLES[0]!
    await ownedRole(t, roleId, joinedAt, { [TEMPORARY_ROLE_KEY]: true })
    const grantId = await t.run((ctx) => ctx.db.insert("temporaryRoleGrants", endedGrant(roleId, joinedAt)))
    const response = await evaluateEnded(t, grantId, roleId, joinedAt)
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual((await record())?.roleIds, [OLD_ROLES[1]])
    assert.equal((await t.run((ctx) => ctx.db.query("temporaryRoleGrants").collect())).length, 0)
})

test("An ended temporary role stays stored while a panel or level reward still needs it, and when NeonFlux did not add it", async () => {
    const { t, ready, jailed, record } = fixture()
    await ready()
    await jailed()
    const joinedAt = "2026-01-01T00:00:00.000Z"
    await ownedRole(t, OLD_ROLES[0]!, joinedAt, { [TEMPORARY_ROLE_KEY]: true, level: true })
    const needed = await t.run((ctx) => ctx.db.insert("temporaryRoleGrants", endedGrant(OLD_ROLES[0]!, joinedAt)))
    assert.equal((await evaluateEnded(t, needed, OLD_ROLES[0]!, joinedAt)).status, 200)
    assert.deepEqual((await record())?.roleIds, OLD_ROLES)
    // No ownership: Staff gave this one by hand, and outside a jail NeonFlux would leave it too
    const handGiven = await t.run((ctx) => ctx.db.insert("temporaryRoleGrants", endedGrant(OLD_ROLES[1]!, joinedAt)))
    assert.equal((await evaluateEnded(t, handGiven, OLD_ROLES[1]!, joinedAt)).status, 200)
    assert.deepEqual((await record())?.roleIds, OLD_ROLES)
})

test("A grant that ended while the member was away leaves the stored roles when the member rejoins", async () => {
    const { t, ready, jailed, record, post } = fixture()
    await ready()
    await jailed()
    const joinedAt = "2025-12-01T00:00:00.000Z"
    const roleId = OLD_ROLES[0]!
    await ownedRole(t, roleId, joinedAt, { [TEMPORARY_ROLE_KEY]: true })
    await t.run((ctx) => ctx.db.insert("temporaryRoleGrants", endedGrant(roleId, joinedAt)))
    await post("/temproles/work", {
        serverId: "10",
        operation: {
            type: "rejoin",
            userId: MEMBER,
            joinedAt: new Date(clock).toISOString(),
            originServerId: "10",
            memberUserId: MEMBER,
            observedAt: clock,
        },
    })
    assert.deepEqual((await record())?.roleIds, [OLD_ROLES[1]])
    assert.equal((await t.run((ctx) => ctx.db.query("temporaryRoleGrants").collect())).length, 0)
})

test("A running temporary role moved by a jailed rejoin leaves the stored roles, and comes back owned after the release so it still ends", async () => {
    const { t, ready, jailed, record, post } = fixture()
    await ready()
    await jailed()
    const joinedAt = "2025-12-01T00:00:00.000Z",
        rejoinedAt = new Date(clock).toISOString(),
        roleId = OLD_ROLES[0]!
    await ownedRole(t, roleId, joinedAt, { [TEMPORARY_ROLE_KEY]: true })
    const grantId = await t.run((ctx) =>
        ctx.db.insert("temporaryRoleGrants", { ...endedGrant(roleId, joinedAt), endsAt: clock + 3600000 }),
    )
    const moved = await post<{ grants: { joinedAt: string }[] }>("/temproles/work", {
        serverId: "10",
        operation: {
            type: "rejoin",
            userId: MEMBER,
            joinedAt: rejoinedAt,
            originServerId: "10",
            memberUserId: MEMBER,
            observedAt: clock,
        },
    })
    assert.equal(moved.grants[0]?.joinedAt, rejoinedAt)
    assert.deepEqual((await record())?.roleIds, [OLD_ROLES[1]])
    // Released, the grant adds its role through ownership, so its end removes it again
    await t.run(async (ctx) => {
        const row = await ctx.db.query("jailRecords").first()
        await ctx.db.delete(row!._id)
    })
    const after = await botCall(t, "/roles/evaluate", {
        serverId: "10",
        sourceId: `temp_${grantId}_2`,
        createdAt: clock,
        context: {
            originServerId: "10",
            userId: MEMBER,
            joinedAt: rejoinedAt,
            roleIds: [],
            isBot: false,
            timeoutUntil: null,
            botId: "999",
            botAuthorized: true,
            roles: [{ originServerId: "10", roleId, permissions: "0", botCanManage: true, actorCanManage: true }],
        },
        operation: { type: "temporary", roleId },
    })
    const body = (await after.json()) as { status: string; grant?: { action: string } }
    assert.equal(body.grant?.action, "add", JSON.stringify(body))
})

test("A length ends in a release through the work dispatch, opened by a fresh read, at any DEFCON level", async () => {
    const { t, ready, jailed, post, record, moderate } = fixture()
    await ready()
    await jailed({ durationSeconds: 3600 })
    assert.deepEqual((await post<{ userIds: string[] }>("/jail/due", { serverId: "10" })).userIds, [])
    await t.run(async (ctx) => {
        const work = await dueWork(ctx, clock + 3600000 + 1, null)
        assert.ok(JSON.stringify(work).includes("jail"))
    })
    clock += 3600000 + 1
    await moderate({ type: "settings", patch: { defcon: 1 } })
    const due = await post<{ userIds: string[] }>("/jail/due", { serverId: "10" })
    assert.deepEqual(due.userIds, [MEMBER])
    // A claimed row is not listed again at once, so one that cannot be released never holds up the rest
    assert.deepEqual((await post<{ userIds: string[] }>("/jail/due", { serverId: "10" })).userIds, [])
    const opened = await post<{ grant?: Case["grant"]; case?: Case["case"] }>("/jail/release", {
        serverId: "10",
        userId: MEMBER,
        context: context({ targetRoleIds: [JAIL_ROLE] }),
    })
    assert.equal(opened.case?.origin, "jail")
    assert.equal(opened.case?.action, "unjail")
    assert.deepEqual(opened.grant?.restoreRoleIds, OLD_ROLES)
    assert.equal((await record())?.state, "releasing")
    // A second request finds nothing due
    assert.deepEqual(await post("/jail/release", { serverId: "10", userId: MEMBER, context: context() }), {})
})

test("Jail settings: Owner or Administrator, never the everyone or a staff role, and the role can't change under a jailed member", async () => {
    const { ready, manage, jailed, post } = fixture()
    await manage({ type: "module", enabled: true }, owner, 409)
    await manage({ type: "setup", roleId: "10", channelId: JAIL_CHANNEL }, owner, 400)
    await ready()
    await manage({ type: "role", roleId: STAFF_ROLE }, owner, 409)
    await manage({ type: "role", roleId: "62" }, mod, 403)
    await manage({ type: "role", roleId: "62" }, actor({ admin: true }))
    await manage({ type: "role", roleId: JAIL_ROLE })
    await jailed()
    const moved = (await manage({ type: "role", roleId: "62" }, owner, 409)) as unknown as { error: string }
    assert.match(moved.error, /Unjail/)
    await manage({ type: "setup", roleId: JAIL_ROLE, channelId: "63" })
    const status = await post<JailStatus>("/jail/status", { serverId: "10", actor: mod })
    assert.equal(status.settings.channelId, "63")
    assert.equal(status.count, 1)
    assert.equal(status.setup?.state, "running")
    await post("/jail/status", { serverId: "10", actor: actor({ roleIds: ["99"] }) }, 403)
})

test("The channel pass reports its progress and the channels it could not change, and the inbox lists them", async () => {
    const { t, ready, post, jailed, act, outcome, record } = fixture()
    await ready()
    await post("/jail/report", {
        serverId: "10",
        setup: {
            state: "done",
            total: 3,
            done: 2,
            problems: [{ channelId: "90", state: "uncertain" }],
            moreProblems: 0,
        },
    })
    await jailed()
    const release = (await act({ type: "unjail" })) as Case
    await outcome(release.grant, "uncertain")
    assert.equal((await record())?.state, "release-uncertain")
    const inbox = await t.run((ctx) => readRecoveryInbox(ctx, "10"))
    const text = JSON.stringify(inbox.entries)
    assert.match(text, /jail overwrite on <#90>/)
    assert.match(text, /could not confirm a release/)
    const sections = await t.run((ctx) => readSetupSections(ctx, "10"))
    assert.equal(sections.find((row) => row.id === "jail")?.state, "on")
})

test("A jail case survives retention while the jail runs, and member data shows the stored roles and keeps them on deletion", async () => {
    const { t, ready, jailed, moderate, record } = fixture()
    await moderate({ type: "settings", patch: { caseRetentionDays: 1 } })
    await ready()
    const reserved = await jailed()
    clock += 3 * 86400000
    await t.run((ctx) => cleanupModeration(ctx, clock))
    assert.ok(await t.run((ctx) => ctx.db.get(reserved.grant!.actionId as Id<"moderationCases">)))
    const shown = await t.run((ctx) => memberDataExport(ctx, MEMBER, "10", null))
    assert.match(JSON.stringify(shown), /"roleIds":\["71","72"\]/)
    await t.run((ctx) => memberDataDelete(ctx, { userId: MEMBER }, "10", null))
    assert.ok(await record())
})

test("An appeal of a jail case works in a DM while the member is jailed", async () => {
    const { ready, jailed, post, source } = fixture()
    await ready()
    const reserved = await jailed()
    const appeal = await post<{ type: string; appeal: { caseNo: number } }>("/appeals/member", {
        ...source(),
        requesterId: MEMBER,
        originServerId: "10",
        privateChannelVerified: true,
        operation: { type: "submit", caseNo: reserved.case.caseNo, text: "Please look at this again" },
    })
    assert.equal(appeal.appeal.caseNo, reserved.case.caseNo)
})
