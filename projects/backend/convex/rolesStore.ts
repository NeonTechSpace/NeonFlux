import { Int } from "@neonflux/contracts/common"
import type {
    RolesAcknowledgment,
    RolesAttempt,
    RolesClaim,
    RolesGrant,
    RolesPanel,
    RolesWithdrawal,
} from "@neonflux/contracts/roles"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import { defaultRolesSettings, ROLES_DAY } from "./rolesDomain.ts"
import { decode, fail, name } from "./validation.ts"

export type RolesRead = MutationCtx | QueryCtx

export async function panelProtectsMessage(ctx: RolesRead, serverId: string, channelId: string, messageId: string) {
    return !!(await ctx.db
        .query("rolePanels")
        .withIndex("by_native_message", (q) =>
            q.eq("serverId", serverId).eq("published.channelId", channelId).eq("published.messageId", messageId),
        )
        .first())
}
export async function readRolesSettings(ctx: RolesRead, serverId: string) {
    return ctx.db
        .query("roleSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
}
export async function rolesState(ctx: MutationCtx, serverId: string) {
    const old = await readRolesSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("roleSettings", {
        serverId,
        config: defaultRolesSettings(),
        dashboardRevision: 0,
        nextPanelRevision: 1,
    })
    return (await ctx.db.get(id))!
}
export async function rolesReceipt(ctx: MutationCtx, serverId: string, messageId: string, now: number) {
    const old = await ctx.db
        .query("roleReceipts")
        .withIndex("by_server_message", (q) => q.eq("serverId", serverId).eq("messageId", messageId))
        .unique()
    if (old) return false
    await ctx.db.insert("roleReceipts", { serverId, messageId, expiresAt: now + ROLES_DAY })
    return true
}
export async function rolePanel(ctx: RolesRead, serverId: string, value: unknown, revision?: unknown) {
    const row = await ctx.db
        .query("rolePanels")
        .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", name(value)))
        .unique()
    if (!row) fail(404, "Role panel not found")
    if (revision !== undefined && row.revision !== decode(Int(1), revision)) fail(409, "Role panel changed")
    return row
}
export function publicRolePanel(row: Doc<"rolePanels">): RolesPanel {
    return {
        name: row.name,
        kind: row.kind,
        revision: row.revision,
        enabled: row.enabled,
        exclusive: row.exclusive,
        mappings: row.mappings,
        ...(row.published ? { published: row.published } : {}),
        withdrawing: row.withdrawing,
    }
}
export function publicRoleGrant(row: Doc<"roleAttempts">): RolesGrant {
    return {
        attemptId: row._id,
        ownershipId: row.ownershipId,
        generation: row.generation,
        sourceId: row.sourceId,
        action: row.action,
        userId: row.userId,
        joinedAt: row.joinedAt,
        roleId: row.roleId,
        botId: row.botId,
        expectedPresent: row.expectedPresent,
        consumerKey: row.consumerKey,
        dispatchExpiresAt: row.dispatchExpiresAt,
        nativeDeadlineMs: row.nativeDeadlineMs,
    }
}
export function publicRoleAttempt(row: Doc<"roleAttempts">): RolesAttempt {
    return {
        ...publicRoleGrant(row),
        outcome: row.outcome,
        createdAt: row.createdAt,
        ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
        ...(row.noDispatch ? { noDispatch: true } : {}),
        ...(row.dispatchedAt !== undefined ? { dispatchedAt: row.dispatchedAt } : {}),
    }
}
export async function ownerReferences(ctx: RolesRead, ownershipId: Id<"roleOwnership">) {
    return ctx.db
        .query("roleReferences")
        .withIndex("by_owner", (q) => q.eq("ownershipId", ownershipId))
        .take(101)
}
export async function publicRoleClaim(ctx: RolesRead, row: Doc<"roleOwnership">): Promise<RolesClaim> {
    const references = await ownerReferences(ctx, row._id),
        attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    return {
        ownershipId: row._id,
        userId: row.userId,
        joinedAt: row.joinedAt,
        roleId: row.roleId,
        generation: row.generation,
        owned: row.owned,
        status: row.status,
        consumerKeys: references.filter((x) => x.desired).map((x) => x.consumerKey),
        ...(attempt ? { attempt: publicRoleAttempt(attempt) } : {}),
    }
}
export async function roleAttempt(ctx: RolesRead, serverId: string, value: unknown) {
    const id = typeof value === "string" ? ctx.db.normalizeId("roleAttempts", value) : null
    const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId) fail(404, "Role attempt not found")
    return row
}
export async function roleWithdrawal(ctx: RolesRead, serverId: string, value: unknown) {
    const id = typeof value === "string" ? ctx.db.normalizeId("roleWithdrawals", value) : null
    const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId) fail(404, "Role withdrawal not found")
    return row
}
export async function publicWithdrawal(
    ctx: RolesRead,
    row: Doc<"roleWithdrawals">,
    cursor?: string | null,
): Promise<RolesWithdrawal> {
    const refQuery = ctx.db
        .query("roleReferences")
        .withIndex("by_consumer", (q) =>
            q.eq("serverId", row.serverId).eq("consumerKey", row.consumerKey).eq("configuration", false),
        )
    // A cursor pages past targets the bot keeps for later recovery
    const paged = cursor === undefined ? null : await refQuery.paginate({ numItems: 10, cursor })
    const refs = paged ? paged.page : await refQuery.take(11)
    const panelName = row.consumerKey.startsWith("panel:") ? row.consumerKey.split(":")[1]! : undefined,
        revision = Number(row.consumerKey.split(":").at(-1))
    const acknowledgments = panelName
        ? await ctx.db
              .query("roleAcknowledgments")
              .withIndex("by_panel", (q) =>
                  q.eq("serverId", row.serverId).eq("panelName", panelName).eq("rulesRevision", revision),
              )
              .take(11)
        : []
    const targets: RolesWithdrawal["targets"] = []
    for (const ref of refs.slice(0, 10)) {
        const owner = ref.ownershipId ? await ctx.db.get(ref.ownershipId) : null
        if (owner) targets.push({ userId: owner.userId, joinedAt: owner.joinedAt, roleId: owner.roleId })
    }
    const configurations =
        !refs.length && !acknowledgments.length
            ? await ctx.db
                  .query("roleReferences")
                  .withIndex("by_consumer", (q) =>
                      q.eq("serverId", row.serverId).eq("consumerKey", row.consumerKey).eq("configuration", true),
                  )
                  .take(22)
            : []
    return {
        withdrawalId: row._id,
        consumerKey: row.consumerKey,
        step: row.step,
        status: row.status,
        remainingAtLeast: refs.length + acknowledgments.length + configurations.length,
        hasMore:
            refs.length > 10 || paged?.isDone === false || acknowledgments.length > 10 || configurations.length > 0,
        deletePanel: row.deletePanel,
        targets,
        ...(paged && !paged.isDone ? { nextCursor: paged.continueCursor } : {}),
    }
}
export async function rolesAcknowledgment(
    ctx: RolesRead,
    serverId: string,
    userId: string,
    joinedAt: string,
    roleIds: string[],
): Promise<RolesAcknowledgment> {
    const acknowledgment = await ctx.db
        .query("roleAcknowledgments")
        .withIndex("by_server_member", (q) => q.eq("serverId", serverId).eq("userId", userId).eq("joinedAt", joinedAt))
        .unique()
    const panel = await ctx.db
        .query("rolePanels")
        .withIndex("by_server_kind", (q) => q.eq("serverId", serverId).eq("kind", "verification"))
        .unique()
    const published = panel?.published,
        roleId = published?.mappings[0]?.roleId
    const settings = await readRolesSettings(ctx, serverId)
    const current = Boolean(
        acknowledgment &&
        published &&
        acknowledgment.panelName === panel?.name &&
        acknowledgment.rulesRevision === published.revision &&
        (!settings?.config.advancedVerificationEnabled || acknowledgment.advancedVerified === true),
    )
    const owner = roleId
        ? await ctx.db
              .query("roleOwnership")
              .withIndex("by_server_member_role", (q) =>
                  q.eq("serverId", serverId).eq("userId", userId).eq("joinedAt", joinedAt).eq("roleId", roleId),
              )
              .unique()
        : null
    const refs = owner ? await ownerReferences(ctx, owner._id) : []
    const confirmed =
        current &&
        Boolean(
            owner &&
            owner.status === "idle" &&
            refs.some((x) => x.desired && x.consumerKey === `panel:${panel!.name}:${published!.revision}`),
        ) &&
        Boolean(roleId && roleIds.includes(roleId))
    return {
        acknowledged: current,
        ...(acknowledgment
            ? { rulesRevision: acknowledgment.rulesRevision, acknowledgedAt: acknowledgment.acknowledgedAt }
            : {}),
        accessConfirmed: confirmed,
        accessRolePresent: Boolean(roleId && roleIds.includes(roleId)),
    }
}
// The feature that holds a role through a reference with this consumer key, and the step that releases it
async function roleHolder(ctx: RolesRead, serverId: string, consumerKey: string) {
    const [kind, name] = consumerKey.split(":")
    if (kind === "panel") {
        const verification = await ctx.db
            .query("rolePanels")
            .withIndex("by_server_kind", (q) => q.eq("serverId", serverId).eq("kind", "verification"))
            .unique()
        return verification?.name === name
            ? "rules verification. Run !verify retire first"
            : `the role panel ${name}. Remove it from the panel or run !roles retire ${name} first`
    }
    if (kind === "autorole") return "autorole. Remove it from autorole or run !autorole retire first"
    if (kind === "picker")
        return `the role picker menu ${name}. Remove it with !rolepicker menu role remove ${name} first`
    if (kind === "level") return "leveling rewards. Remove the reward or run !level clear first"
    if (kind === "temporary") return "temporary roles. End those grants with !temprole remove first"
    if (kind === "onboarding") return "the newcomer checklist. Change its completion role with !onboarding role first"
    return "another NeonFlux feature. Release it there first"
}
/** A staff role must not be a role a NeonFlux feature gives members. The refusal names the feature and the step that releases the role */
export async function protectedStaffRoles(ctx: RolesRead, serverId: string, roleIds: string[]) {
    for (const roleId of roleIds) {
        const reference = await ctx.db
            .query("roleReferences")
            .withIndex("by_server_role", (q) => q.eq("serverId", serverId).eq("roleId", roleId))
            .first()
        if (reference) fail(409, `Role is held by ${await roleHolder(ctx, serverId, reference.consumerKey)}`)
        if (
            await ctx.db
                .query("roleOwnership")
                .withIndex("by_server_role", (q) =>
                    q.eq("serverId", serverId).eq("roleId", roleId).eq("protected", true),
                )
                .first()
        )
            fail(
                409,
                "Role has a member role change NeonFlux has not confirmed. Run the reconcile command of the feature that gave it first",
            )
    }
}
export async function panelPost(ctx: RolesRead, serverId: string, postNo: number) {
    return !!(await ctx.db
        .query("roleReferences")
        .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", postNo))
        .first())
}
export async function protectedPanelPost(ctx: RolesRead, serverId: string, postNo: number) {
    if (await panelPost(ctx, serverId, postNo)) fail(409, "Published post retained by role panel")
}
