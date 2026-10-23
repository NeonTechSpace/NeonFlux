import { v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import {
    ProfileApplyRequest,
    ProfileFailRequest,
    ProfileManageRequest,
    ProfileReadyRequest,
    ProfileSettingsRequest,
    ProfileShowRequest,
    type Profile,
    type ProfileApplyResult,
    type ProfileFailResult,
    type ProfileMemberOperation,
    type ProfileOperation,
    type ProfileReadyResult,
    type ProfileSettings,
    type ProfileShowResult,
    type ProfileState,
} from "@neonflux/contracts/profiles"
import type { DashboardMemberQueueResult, DashboardProfileMember } from "../dashboard-contracts.js"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { memberSession } from "./dashboard.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { accessAllowed, applyMemberAccess, readAccess } from "./memberAccess.ts"
import {
    cancelMemberRequests,
    expiredMemberRequest,
    finishMemberRequest,
    memberContentContext,
    memberRequestJob,
    publicMemberJob,
    queueMemberRequest,
    readyMemberRequests,
    recentMemberRequests,
    unavailableMemberRequest,
} from "./memberContent.ts"
import { memberGrant } from "./rolePickerStore.ts"
import { actor } from "./moderationDomain.ts"
import { blockingContentRule } from "./protection.ts"
import { currentBirthday } from "./milestonesStore.ts"
import { levelingRank, publicProfile as levelingProfile, readLeveling, readProfile } from "./levelingStore.ts"
import {
    PROFILE_FAMILY,
    PROFILE_FEATURE,
    birthdayText,
    profileMemberOperation,
    profileOperation,
    profileText,
    renderProfile,
} from "./profilesDomain.ts"
import { decode, fail, source } from "./validation.ts"

type Read = Pick<QueryCtx, "db">
const defaultProfileSettings = (): ProfileSettings => ({ enabled: false, cooldownSeconds: null })
const settingsRow = (ctx: Read, serverId: string) =>
    ctx.db
        .query("profileSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export async function readProfileSettings(ctx: Read, serverId: string): Promise<ProfileSettings> {
    const row = await settingsRow(ctx, serverId)
    return row ? { enabled: row.enabled, cooldownSeconds: row.cooldownSeconds } : defaultProfileSettings()
}
const profileRow = (ctx: Read, serverId: string, userId: string) =>
    ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("serverId", serverId).eq("userId", userId))
        .unique()
const publicProfile = (row: Doc<"profiles">): Profile => ({
    userId: row.userId,
    bio: row.bio,
    links: row.links,
    color: row.color,
    updatedAt: row.updatedAt,
})
async function profileState(ctx: Read, serverId: string): Promise<ProfileState> {
    return {
        revision: await configurationRevision(ctx as QueryCtx, serverId, "profile"),
        settings: await readProfileSettings(ctx, serverId),
        access: await readAccess(ctx, serverId, PROFILE_FEATURE),
    }
}
// Chat commands and dashboard saves share these rules
export async function applyProfileConfiguration(
    ctx: MutationCtx,
    serverId: string,
    op: ProfileOperation,
): Promise<ProfileState> {
    if (op.type !== "settings") await applyMemberAccess(ctx, serverId, PROFILE_FEATURE, op)
    else {
        const row = await settingsRow(ctx, serverId),
            { type, ...patch } = op
        if (row) await ctx.db.patch(row._id, patch)
        else await ctx.db.insert("profileSettings", { serverId, ...defaultProfileSettings(), ...patch })
    }
    return profileState(ctx, serverId)
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ProfileState> => {
        const input = decode(ProfileManageRequest, request)
        const identity = source(input, Date.now()),
            who = actor(input.actor),
            op = profileOperation(input.operation)
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "profile",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () => applyProfileConfiguration(ctx, identity.serverId, op),
        )
    },
})
export const settings = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ProfileState> => {
        return profileState(ctx, decode(ProfileSettingsRequest, request).serverId)
    },
})
// !profile. The bot read both members fresh. Access lists apply to the member who asks and the member shown, and automod reads the profile again in this channel
export const show = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ProfileShowResult> => {
        const { serverId, channelId, parentChannelId, caller, target } = decode(ProfileShowRequest, request)
        const settings = await readProfileSettings(ctx, serverId),
            access = await readAccess(ctx, serverId, PROFILE_FEATURE)
        if (!settings.enabled) return { type: "refused", reason: "off" }
        if (!accessAllowed(access, { userId: caller.userId, roleIds: [...new Set(caller.roleIds)] }))
            return { type: "refused", reason: "access" }
        const targetRoles = [...new Set(target.roleIds)],
            row = await profileRow(ctx, serverId, target.userId)
        if (!row || !accessAllowed(access, { userId: target.userId, roleIds: targetRoles }))
            return { type: "refused", reason: "missing" }
        const rule = await blockingContentRule(ctx, serverId, profileText(row), targetRoles, channelId, parentChannelId)
        if (rule) return { type: "refused", reason: "automod", rule }
        // The same level and rank as !rank, while leveling is on and the member has XP
        const leveling = (await readLeveling(ctx, serverId))?.config,
            xp = leveling?.enabled
                ? levelingProfile(leveling, target.userId, await readProfile(ctx, serverId, target.userId))
                : undefined
        const rank =
                leveling && xp && xp.xp > 0
                    ? await levelingRank(ctx, serverId, leveling.scoreEpoch, target.userId, xp.xp)
                    : undefined,
            place =
                rank?.type === "exact"
                    ? `#${rank.position}`
                    : rank?.type === "range"
                      ? `#${rank.from} to #${rank.to}`
                      : undefined,
            level = place && `Level ${xp!.level}, rank ${place}`
        // The member chose to show it on a birthday sign-up from their current membership that the birthday route still has consent for
        const birthday =
                target.joinedAt !== undefined
                    ? await currentBirthday(ctx, serverId, target.userId, target.joinedAt)
                    : undefined,
            monthDay = birthday?.showOnProfile ? birthday.monthDay : undefined
        return {
            type: "profile",
            content: renderProfile(row, target.userName, {
                ...(level ? { level } : {}),
                ...(monthDay ? { birthday: birthdayText(monthDay) } : {}),
            }),
            cooldownSeconds: settings.cooldownSeconds,
        }
    },
})

// Website member requests. Each one rechecks the session, the installation and that profiles are on
export const request = mutation({
    args: { sessionToken: v.string(), serverId: v.string(), requestId: v.string(), operation: v.any() },
    handler: async (ctx, input): Promise<DashboardMemberQueueResult> => {
        const session = await memberSession(ctx, input.sessionToken, input.serverId, "profile"),
            operation = profileMemberOperation(input.operation)
        return queueMemberRequest(
            ctx,
            session,
            { serverId: input.serverId, requestId: input.requestId, family: PROFILE_FAMILY, operation },
            internal.profiles.expireRequest,
        )
    },
})
/** Deleting your own profile needs no check by the bot. Saves still waiting for the bot go too, so none brings the profile back */
export const remove = mutation({
    args: { sessionToken: v.string(), serverId: v.string() },
    handler: async (ctx, input) => {
        const session = await memberSession(ctx, input.sessionToken, input.serverId, "profile"),
            row = await profileRow(ctx, input.serverId, session.userId)
        if (row) await ctx.db.delete(row._id)
        await cancelMemberRequests(ctx, input.serverId, PROFILE_FAMILY, session.userId)
        return null
    },
})
/** The member's own birthday sign-up as the website shows it, with their choice to show it on their profile */
async function memberBirthday(ctx: QueryCtx, serverId: string, userId: string) {
    const row = await currentBirthday(ctx, serverId, userId)
    return row ? { show: row.showOnProfile ?? false } : null
}
/** The choice lives on the birthday sign-up, so it needs a current one and goes with it. Every new sign-up starts with it off */
export const birthday = mutation({
    args: { sessionToken: v.string(), serverId: v.string(), show: v.boolean() },
    handler: async (ctx, input) => {
        const session = await memberSession(ctx, input.sessionToken, input.serverId, "profile"),
            row = await currentBirthday(ctx, input.serverId, session.userId)
        if (!row) fail(409, "You have no birthday saved in this server. Save one with !milestone in a DM with NeonFlux")
        await ctx.db.patch(row._id, { showOnProfile: input.show })
        return null
    },
})
export const member = query({
    args: { sessionToken: v.string(), serverId: v.string() },
    handler: async (ctx, { sessionToken, serverId }): Promise<DashboardProfileMember> => {
        const session = await memberSession(ctx, sessionToken, serverId, "profile"),
            row = await profileRow(ctx, serverId, session.userId)
        return {
            serverId,
            profile: row ? publicProfile(row) : null,
            birthday: await memberBirthday(ctx, serverId, session.userId),
            requests: (await recentMemberRequests(ctx, serverId, PROFILE_FAMILY, session.userId)).map(
                publicMemberJob<ProfileMemberOperation>,
            ),
        }
    },
})
export const expireRequest = internalMutation({
    args: { id: v.id("dashboardConfigurationJobs") },
    handler: async (ctx, { id }) => {
        const job = await ctx.db.get(id)
        if (job?.family === PROFILE_FAMILY && job.state === "queued")
            await finishMemberRequest(ctx, job, expiredMemberRequest)
    },
})

// Bot routes. The bot reads the member fresh, then the backend decides with the current settings, access lists and automod rules
export const ready = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ProfileReadyResult> => {
        const { serverId } = decode(ProfileReadyRequest, request)
        return {
            jobs: (await readyMemberRequests(ctx, serverId, PROFILE_FAMILY)).map(
                publicMemberJob<ProfileMemberOperation>,
            ),
        }
    },
})
export const apply = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ProfileApplyResult> => {
        const input = decode(ProfileApplyRequest, request),
            serverId = input.serverId,
            now = Date.now()
        const job = await memberRequestJob(ctx, serverId, PROFILE_FAMILY, input.jobId, input.actorId),
            member = memberContentContext(input.member)
        const finish = async (error?: string) => {
            await finishMemberRequest(ctx, job, error)
            return { job: publicMemberJob<ProfileMemberOperation>((await ctx.db.get(job._id))!) }
        }
        if (job.state !== "queued") return { job: publicMemberJob(job) }
        if (member.userId !== job.actorId || member.isBot) fail(403, "Member request grant mismatch")
        if (!(await memberGrant(ctx, job, now)))
            return finish("Your sign-in expired before the bot could act. Sign in again and retry")
        if (!(await readProfileSettings(ctx, serverId)).enabled) return finish("Profiles are turned off in this server")
        if (!accessAllowed(await readAccess(ctx, serverId, PROFILE_FEATURE), member))
            return finish("You cannot use profiles in this server")
        const { type, ...content } = job.operation as ProfileMemberOperation
        const rule = await blockingContentRule(ctx, serverId, profileText(content), member.roleIds)
        if (rule)
            return finish(
                `The server's automod rule ${rule} blocked this profile. Change the bio or links and try again`,
            )
        const row = await profileRow(ctx, serverId, member.userId)
        if (row) await ctx.db.patch(row._id, { ...content, updatedAt: now })
        else await ctx.db.insert("profiles", { serverId, userId: member.userId, ...content, updatedAt: now })
        return finish()
    },
})
export const failRequest = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ProfileFailResult> => {
        const input = decode(ProfileFailRequest, request),
            job = await memberRequestJob(ctx, input.serverId, PROFILE_FAMILY, input.jobId)
        if (job.state === "queued") await finishMemberRequest(ctx, job, unavailableMemberRequest)
        return null
    },
})
