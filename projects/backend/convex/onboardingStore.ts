import type { OnboardingSettings } from "@neonflux/contracts/onboarding"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { defaultOnboarding } from "./onboardingDomain.ts"

type Read = Pick<QueryCtx | MutationCtx, "db">
export const onboardingRow = (ctx: Read, serverId: string) => ctx.db.query("onboardingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function readOnboarding(ctx: Read, serverId: string): Promise<OnboardingSettings> {
    const row = await onboardingRow(ctx, serverId)
    return row ? { enabled: row.enabled, delivery: row.delivery, steps: row.steps, completionRoleId: row.completionRoleId } : defaultOnboarding()
}
export const completionRow = (ctx: Read, serverId: string, member: { userId: string, joinedAt: string }) =>
    ctx.db.query("onboardingCompletions").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt)).unique()
/** The role source of a completion, so the completion role is added at most once per membership */
export const onboardingSource = (row: Doc<"onboardingCompletions">) => `onboarding_${row._id}`
/** Whether the member's current membership finished the checklist and the role is the configured completion role */
export async function onboardingRoleDesired(ctx: Read, serverId: string, member: { userId: string, joinedAt: string }, roleId: string) {
    const settings = await readOnboarding(ctx, serverId)
    return settings.enabled && settings.completionRoleId === roleId && Boolean(await completionRow(ctx, serverId, member))
}
