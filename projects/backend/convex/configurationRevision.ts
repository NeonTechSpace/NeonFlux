import { v } from "convex/values"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { DashboardConfigurationFamily } from "../dashboard-contracts.js"
import { fail } from "./validation.ts"

export const configurationFamilies = ["responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions", "cleanup", "events", "schedules", "nickname", "voice", "rolepicker"] as const
export const configurationFamilyValidator = v.union(...configurationFamilies.map(family => v.literal(family)))
export function configurationFamily(value: unknown): DashboardConfigurationFamily {
    if (!configurationFamilies.includes(value as DashboardConfigurationFamily)) fail(400, "Invalid configuration family")
    return value as DashboardConfigurationFamily
}
export async function configurationRevision(ctx: QueryCtx | MutationCtx, serverId: string, family: DashboardConfigurationFamily) {
    return (await ctx.db.query("serverConfigurationRevisions").withIndex("by_family", q => q.eq("serverId", serverId).eq("family", family)).unique())?.revision ?? 0
}
// Feature changes call changeConfiguration in configurationChange.ts, which also records them in the audit log. Backup
// restore bumps directly and records each imported item itself
export async function bumpConfigurationRevision(ctx: MutationCtx, serverId: string, family: DashboardConfigurationFamily, source?: { kind: "chat" | "dashboard", createdAt: number }) {
    const row = await ctx.db.query("serverConfigurationRevisions").withIndex("by_family", q => q.eq("serverId", serverId).eq("family", family)).unique(), revision = (row?.revision ?? 0) + 1
    if (!Number.isSafeInteger(revision)) fail(429, "Configuration revision exhausted")
    if (source?.kind === "chat" && row?.lastDashboardAt !== undefined && source.createdAt <= row.lastDashboardAt) fail(409, "Chat configuration predates a dashboard change")
    const fields = { revision, ...(source?.kind === "dashboard" ? { lastDashboardAt: Date.now() } : {}) }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert("serverConfigurationRevisions", { serverId, family, ...fields })
    return revision
}
export type ConfigurationIdentity = { serverId: string, actorId: string, createdAt: number, source: { kind: "chat", messageId: string } | { kind: "dashboard", jobId: string } }
export function configurationSourceId(identity: ConfigurationIdentity) { return identity.source.kind === "chat" ? identity.source.messageId : identity.source.jobId }
