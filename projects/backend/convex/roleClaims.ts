import type { RolesMemberContext } from "../contracts.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import { autoroleIds, defaultRolesSettings, eligible, ROLES_BATCH, ROLES_DISPATCH_WINDOW, safeRole } from "./rolesDomain.ts"
import { ownerReferences, publicRoleGrant, readRolesSettings, rolesAcknowledgment, type RolesRead } from "./rolesStore.ts"
import { currentXp, readLeveling, readProfile } from "./levelingStore.ts"
import { levelForXp } from "./levelingDomain.ts"
import { pickerMenu } from "./rolePickerStore.ts"
import { memberRecoveries } from "./moderationStore.ts"
import { TEMPORARY_ROLE_KEY, temporaryRoleDesired } from "./temporaryRolesStore.ts"
import { ONBOARDING_ROLE_KEY } from "./onboardingDomain.ts"
import { onboardingRoleDesired } from "./onboardingStore.ts"
import { fail } from "./validation.ts"

export async function rolePolicy(ctx: RolesRead, serverId: string) {
    const settings = (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings()
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const ticketRoles = await ctx.db.query("ticketRoleProtections").withIndex("by_protected", q => q.eq("serverId", serverId).eq("protected", true)).take(1001)
    if (ticketRoles.length > 1000) fail(409, "Ticket protection capacity conflict")
    return { settings, staffRoleIds: [...new Set([...Object.values(moderation?.config.staffRoleIds ?? {}).flat(), ...ticketRoles.map(r => r.roleId)])], defcon: moderation?.config.defcon ?? 3 }
}
export async function onboardingProtection(ctx: RolesRead, serverId: string, userId: string, timeoutUntil: string | null) {
    const policy = await rolePolicy(ctx, serverId)
    if (policy.defcon !== 3 || timeoutUntil !== null && Date.parse(timeoutUntil) > Date.now()) fail(403, "Role participation unavailable")
    const recoveries = await memberRecoveries(ctx, serverId, userId)
    if (recoveries.cases.some(action => action?.action === "quarantine")) fail(403, "Quarantine blocks role participation")
    if (recoveries.count > 10) fail(403, "Role participation unavailable")
    return policy
}
export async function participationAvailability(ctx: RolesRead, serverId: string, member: RolesMemberContext) {
    if (!member.botAuthorized || member.userId === member.botId) fail(403, "Role participation unavailable")
    return onboardingProtection(ctx, serverId, member.userId, member.timeoutUntil)
}
export async function grantEligibility(ctx: RolesRead, serverId: string, member: RolesMemberContext, consumerKey: string, roleId: string, verification = false) {
    const policy = await participationAvailability(ctx, serverId, member)
    safeRole(serverId, roleId, member.roles, policy.staffRoleIds, false)
    const verifyPanel = await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", serverId).eq("kind", "verification")).unique()
    // Configured verification gates grants even when its participation switch is off
    if (!verification && verifyPanel && (verifyPanel.published || verifyPanel.mappings.length)) {
        const ack = await ctx.db.query("roleAcknowledgments").withIndex("by_server_member", q => q.eq("serverId", serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt)).unique()
        if (!verifyPanel.published || !ack || ack.panelName !== verifyPanel.name || ack.rulesRevision !== verifyPanel.published.revision || policy.settings.advancedVerificationEnabled && ack.advancedVerified !== true) fail(403, "Rules acknowledgment required")
    }
    if (consumerKey.startsWith("autorole:")) {
        if (!policy.settings.autoroleEnabled || policy.settings.humansOnly && member.isBot || !autoroleIds(policy.settings, member.userId).includes(roleId) || consumerKey !== `autorole:${policy.settings.revision}`) fail(403, "Autorole unavailable")
    } else if (consumerKey === "level") {
        if (member.isBot) fail(403, "Bot leveling rewards unavailable")
        const state = await readLeveling(ctx, serverId), profile = await readProfile(ctx, serverId, member.userId)
        const mapping = state?.config.mappings.find(x => x.roleId === roleId)
        if (!state?.config.enabled || !mapping || levelForXp(currentXp(state.config, profile)) < mapping.level) fail(403, "Leveling reward unavailable")
        if (verifyPanel && (verifyPanel.published || verifyPanel.mappings.length)) {
            const acknowledgment = await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds)
            if (!policy.settings.verificationEnabled || !verifyPanel.enabled || verifyPanel.withdrawing || !acknowledgment.accessConfirmed) fail(403, "Verified access required for leveling rewards")
        }
    } else if (consumerKey.startsWith("picker:")) {
        await pickerMenu(ctx, serverId, member, consumerKey.slice(7), roleId)
    } else if (consumerKey === TEMPORARY_ROLE_KEY) {
        if (member.isBot) fail(403, "Bot participation unavailable")
        if (!await temporaryRoleDesired(ctx, serverId, member, roleId, Date.now())) fail(409, "Temporary role changed")
    } else if (consumerKey === ONBOARDING_ROLE_KEY) {
        if (member.isBot) fail(403, "Bot participation unavailable")
        if (!await onboardingRoleDesired(ctx, serverId, member, roleId)) fail(409, "Onboarding completion changed")
    } else {
        if (member.isBot) fail(403, "Bot participation unavailable")
        const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", consumerKey.split(":")[1]!)).unique()
        const published = panel?.published, mapping = published?.mappings.find(x => x.roleId === roleId)
        if (!panel?.enabled || panel.withdrawing || !published || consumerKey !== `panel:${panel.name}:${published.revision}` || !mapping || !eligible(mapping, member.roleIds)
            || (panel.kind === "verification" ? !policy.settings.verificationEnabled : !policy.settings.panelsEnabled)) fail(403, "Role panel unavailable")
    }
    return policy
}
export async function roleOwner(ctx: RolesRead, serverId: string, member: Pick<RolesMemberContext, "userId" | "joinedAt">, roleId: string) {
    return ctx.db.query("roleOwnership").withIndex("by_server_member_role", q => q.eq("serverId", serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt).eq("roleId", roleId)).unique()
}
export async function ensureOwner(ctx: MutationCtx, serverId: string, member: RolesMemberContext, roleId: string, now: number) {
    const old = await roleOwner(ctx, serverId, member, roleId)
    if (old) return old
    await releaseEarlierEpochs(ctx, serverId, member)
    const id = await ctx.db.insert("roleOwnership", { serverId, userId: member.userId, joinedAt: member.joinedAt, roleId, generation: 0, owned: false, protected: false, status: "idle", updatedAt: now })
    return (await ctx.db.get(id))!
}
// A member has one current membership epoch, and rows of an earlier epoch never authorize work again.
// The first ownership or acknowledgment of a later epoch releases settled earlier rows, while unresolved ownership stays until it is reconciled
export async function releaseEarlierEpochs(ctx: MutationCtx, serverId: string, member: Pick<RolesMemberContext, "userId" | "joinedAt">) {
    const earlier = (row: { joinedAt: string }) => Date.parse(row.joinedAt) < Date.parse(member.joinedAt)
    const owners = await ctx.db.query("roleOwnership").withIndex("by_server_member_role", q => q.eq("serverId", serverId).eq("userId", member.userId).lt("joinedAt", member.joinedAt)).take(ROLES_BATCH)
    for (const owner of owners.filter(earlier)) {
        const attempt = owner.attemptId ? await ctx.db.get(owner.attemptId) : null
        if (owner.status !== "idle" || attempt?.outcome === "pending" || attempt?.outcome === "uncertain" && attempt.observationAt === undefined) continue
        for (const ref of await ownerReferences(ctx, owner._id)) { await ctx.db.delete(ref._id) }
        await ctx.db.delete(owner._id)
    }
    const acknowledgments = await ctx.db.query("roleAcknowledgments").withIndex("by_server_member", q => q.eq("serverId", serverId).eq("userId", member.userId).lt("joinedAt", member.joinedAt)).take(ROLES_BATCH)
    for (const row of acknowledgments.filter(earlier)) { await ctx.db.delete(row._id) }
}
export async function desiredReference(ctx: MutationCtx, serverId: string, owner: Doc<"roleOwnership">, consumerKey: string, desired: boolean, now: number) {
    const refs = await ownerReferences(ctx, owner._id), old = refs.find(x => x.consumerKey === consumerKey)
    if (old) { await ctx.db.patch(old._id, { desired }); return }
    if (!desired) return
    if (refs.length >= 100) fail(429, "Member role reference capacity reached")
    await ctx.db.insert("roleReferences", { serverId, consumerKey, roleId: owner.roleId, configuration: false, desired, ownershipId: owner._id, createdAt: now, ...(consumerKey === "level" ? { userId: owner.userId, joinedAt: owner.joinedAt } : {}) })
}
export async function dropUndesiredReferences(ctx: MutationCtx, ownerId: Id<"roleOwnership">) {
    const refs = await ownerReferences(ctx, ownerId)
    for (const ref of refs) if (!ref.desired) { await ctx.db.delete(ref._id) }
}
export async function reserveRole(ctx: MutationCtx, serverId: string, member: RolesMemberContext, owner: Doc<"roleOwnership">, consumerKey: string, action: "add" | "remove", sourceId: string, now: number, operationKey: string, reactionJob?: Doc<"roleAttempts">["reactionJob"], dispatchDeadline = Infinity) {
    if (owner.status !== "idle") fail(409, "Role action unresolved")
    if (!member.botAuthorized) fail(403, "Bot role permission required", "BOT_PERMISSION")
    const policy = await rolePolicy(ctx, serverId)
    safeRole(serverId, owner.roleId, member.roles, policy.staffRoleIds, false)
    const refs = await ownerReferences(ctx, owner._id)
    if (action === "remove" && (!owner.owned || !member.roleIds.includes(owner.roleId) || refs.some(x => x.desired))) fail(409, "Role removal ownership not established")
    if (action === "add" && member.roleIds.includes(owner.roleId)) fail(409, "Role already present")
    const generation = owner.generation + 1
    const id = await ctx.db.insert("roleAttempts", { serverId, ownershipId: owner._id, generation, sourceId, operationKey, action, userId: member.userId, joinedAt: member.joinedAt, roleId: owner.roleId, botId: member.botId, expectedPresent: action === "remove", consumerKey, dispatchExpiresAt: Math.min(now + ROLES_DISPATCH_WINDOW, dispatchDeadline), nativeDeadlineMs: 5000, outcome: "pending", createdAt: now, ...(reactionJob ? { reactionJob } : {}) })
    await ctx.db.patch(owner._id, { generation, status: "pending", protected: true, ...(action === "add" ? { owned: false } : {}), attemptId: id, updatedAt: now })
    return publicRoleGrant((await ctx.db.get(id))!)
}
