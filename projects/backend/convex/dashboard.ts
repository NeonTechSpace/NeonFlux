import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import { v, ConvexError } from "convex/values"
import { action, mutation, internalMutation, internalQuery } from "./_generated/server.js"
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { DashboardSession, DashboardSaveResult, DashboardCatalog, DashboardMemberFeature } from "../dashboard-contracts.js"
import { verifyProvider, providerCatalog } from "./dashboardProvider.ts"
import { configuredServerScope } from "./serverScope.ts"
import { isInstalled } from "./installations.ts"
import type { Doc } from "./_generated/dataModel.js"
import { memberFeatures, privateDataRole, rolePickerEnabled } from "./memberAccess.ts"
import { writePrefix } from "./generalSettings.ts"
import { fail } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

const ADMISSION_MS = 300000
// Every dashboard query reads its session row, so each write to it reruns all of that session's live queries.
// Renewals therefore extend read access only once it has run down by at least this much
export const RENEW_STEP_MS = 60000
const LIFETIME_MS = 28800000
export async function verifiedDashboardIdentity(ctx: ActionCtx, sessionToken: string): Promise<{ userId: string, sessionId: string }> {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken })
    const identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId) fail(403, "Identity changed")
    return { userId: stored.userId, sessionId: stored._id }
}
export async function tokenHash(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) fail(401, "Sign in again")
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("")
}
export async function dashboardSession(ctx: QueryCtx | MutationCtx, token: string, serverId?: string) {
    const hash = await tokenHash(token)
    const found = await ctx.db.query("dashboardSessions").withIndex("by_token", q => q.eq("tokenHash", hash)).unique()
    if (!found || found.expiresAt <= Date.now() || found.lifetimeAt <= Date.now()) fail(401, "Sign in again")
    // The session snapshot proves management, and the installation is rechecked on every request
    if (serverId && (!found.servers.some(server => server.id === serverId) || !await isInstalled(ctx, serverId))) fail(403, "Manage Server permission required")
    return found
}
const session = dashboardSession
const serverValidator = v.object({ id: v.string(), name: v.string(), icon: v.union(v.string(), v.null()) })
const storedServers = (servers: Array<{ id: string, name: string }>) => servers.map(({ id, name }) => ({ id, name }))
type Server = { id: string, name: string, icon: string | null }
type MemberServer = Server & { features: DashboardMemberFeature[] }
// Servers the user manages that NeonFlux currently serves. Removed servers disappear from the dashboard
async function installedServers(ctx: Pick<QueryCtx, "db">, servers: Server[]) {
    const installed: Server[] = []
    for (const server of servers) if (await isInstalled(ctx, server.id)) installed.push(server)
    return installed
}
// Servers the user joined without managing them, where NeonFlux is installed and offers a member feature
async function memberFeatureServers(ctx: Pick<QueryCtx, "db">, servers: Server[]) {
    const offered: MemberServer[] = []
    for (const server of await installedServers(ctx, servers)) {
        const features = await memberFeatures(ctx, server.id)
        if (features.length) offered.push({ ...server, features })
    }
    return offered
}
const sessionServer = (found: Doc<"dashboardSessions">, serverId: string) => found.servers.some(server => server.id === serverId) || (found.memberServers ?? []).some(server => server.id === serverId)
// Member requests accept a managed or member server of the session, rechecking the installation and the member feature on every request
export async function memberSession(ctx: QueryCtx | MutationCtx, token: string, serverId: string, feature: Exclude<DashboardMemberFeature, "private"> = "rolepicker") {
    const found = await dashboardSession(ctx, token)
    const offered = feature === "rolepicker" ? await rolePickerEnabled(ctx, serverId) : (await memberFeatures(ctx, serverId)).includes(feature)
    if (!sessionServer(found, serverId) || !await isInstalled(ctx, serverId) || !offered) fail(403, feature === "rolepicker" ? "Role picker unavailable" : feature === "showcase" ? "Showcases unavailable" : "Profiles unavailable")
    return found
}
// Private cases accept a managed server, or a member server while it names a private data role. Each view still needs a passed live check
export async function privateSession(ctx: QueryCtx | MutationCtx, token: string, serverId: string) {
    const found = await dashboardSession(ctx, token)
    if (!sessionServer(found, serverId) || !await isInstalled(ctx, serverId)
        || !found.servers.some(server => server.id === serverId) && await privateDataRole(ctx, serverId) === null) fail(403, "Private cases unavailable")
    return found
}
export const secret = internalQuery({ args: { sessionToken: v.string() }, handler: (ctx, args) => session(ctx, args.sessionToken) })
export const store = internalMutation({ args: { tokenHash: v.string(), accessToken: v.string(), user: v.object({ id: v.string(), name: v.string() }), servers: v.array(serverValidator), memberServers: v.optional(v.array(serverValidator)) }, handler: async (ctx, args) => {
    const previous = await ctx.db.query("dashboardSessions").withIndex("by_user", q => q.eq("userId", args.user.id)).collect()
    for (const old of previous.filter(old => old.expiresAt <= Date.now())) await ctx.db.delete(old._id)
    if (previous.filter(old => old.expiresAt > Date.now()).length >= 5) fail(429, "Too many active dashboard sessions")
    const expiresAt = Date.now() + ADMISSION_MS, servers = await installedServers(ctx, args.servers), memberServers = await memberFeatureServers(ctx, args.memberServers ?? [])
    const id = await ctx.db.insert("dashboardSessions", { tokenHash: args.tokenHash, accessToken: args.accessToken, userId: args.user.id, userName: args.user.name, servers: storedServers(servers), memberServers: storedServers(memberServers), expiresAt, lifetimeAt: Date.now() + LIFETIME_MS })
    await ctx.scheduler.runAt(expiresAt, internal.dashboard.expire, { id })
    return { expiresAt, servers, memberServers }
} })
export const expire = internalMutation({ args: { id: v.id("dashboardSessions") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(id)
} })
export const admit = action({ args: { accessToken: v.string() }, handler: async (ctx, { accessToken }): Promise<DashboardSession> => {
    const identity = await verifyProvider(accessToken)
    const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("")
    const { expiresAt, servers, memberServers }: { expiresAt: number, servers: Server[], memberServers: MemberServer[] } = await ctx.runMutation(internal.dashboard.store, { tokenHash: await tokenHash(sessionToken), accessToken, user: identity.user, servers: identity.servers, memberServers: identity.memberServers })
    return { sessionToken, user: identity.user, mode: configuredServerScope().mode, servers, memberServers, expiresAt }
} })
// Callers that omit member servers keep the stored member list, so manager writes never change member access
export const renew = internalMutation({ args: { sessionToken: v.string(), user: v.object({ id: v.string(), name: v.string() }), servers: v.array(serverValidator), memberServers: v.optional(v.array(serverValidator)) }, handler: async (ctx, args) => {
    const row = await session(ctx, args.sessionToken)
    if (row.userId !== args.user.id) fail(403, "Identity changed")
    const lease = Math.min(Date.now() + ADMISSION_MS, row.lifetimeAt), servers = await installedServers(ctx, args.servers)
    const memberServers = args.memberServers ? await memberFeatureServers(ctx, args.memberServers) : undefined
    // Only changed fields are written, so routine saves and refreshes leave the live queries alone
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b), extend = lease - row.expiresAt >= RENEW_STEP_MS
    const patch = { ...(same(row.servers, storedServers(servers)) ? {} : { servers: storedServers(servers) }),
        ...(memberServers && !same(row.memberServers, storedServers(memberServers)) ? { memberServers: storedServers(memberServers) } : {}),
        ...(row.userName === args.user.name ? {} : { userName: args.user.name }), ...(extend ? { expiresAt: lease } : {}) }
    if (Object.keys(patch).length) await ctx.db.patch(row._id, patch)
    if (extend) await ctx.scheduler.runAt(lease, internal.dashboard.expire, { id: row._id })
    return { expiresAt: extend ? lease : row.expiresAt, servers, ...(memberServers ? { memberServers } : {}) }
} })
export const refresh = action({ args: { sessionToken: v.string() }, handler: async (ctx, { sessionToken }): Promise<DashboardSession> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken })
    try {
        const identity = await verifyProvider(stored.accessToken)
        const { expiresAt, servers, memberServers }: { expiresAt: number, servers: Server[], memberServers?: MemberServer[] } = await ctx.runMutation(internal.dashboard.renew, { sessionToken, user: identity.user, servers: identity.servers, memberServers: identity.memberServers })
        return { sessionToken, user: identity.user, mode: configuredServerScope().mode, servers, memberServers: memberServers ?? [], expiresAt }
    } catch (error) {
        if (error instanceof ConvexError && typeof error.data === "object" && error.data && "status" in error.data && error.data.status === 403) await ctx.runMutation(internal.dashboard.revoke, { sessionToken })
        throw error
    }
} })
export const revoke = internalMutation({ args: { sessionToken: v.string() }, handler: async (ctx, { sessionToken }) => {
    const hash = await tokenHash(sessionToken), row = await ctx.db.query("dashboardSessions").withIndex("by_token", q => q.eq("tokenHash", hash)).unique()
    if (row) await ctx.db.delete(row._id)
    return null
} })
export const logout = mutation({ args: { sessionToken: v.string() }, handler: async (ctx, { sessionToken }) => {
    const hash = await tokenHash(sessionToken), row = await ctx.db.query("dashboardSessions").withIndex("by_token", q => q.eq("tokenHash", hash)).unique()
    if (row) await ctx.db.delete(row._id)
    return null
} })
export const catalog = action({ args: { sessionToken: v.string(), serverId: v.string() }, handler: async (ctx, input): Promise<DashboardCatalog> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken: input.sessionToken }), identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some(server => server.id === input.serverId)) {
        await ctx.runMutation(internal.dashboard.revoke, { sessionToken: input.sessionToken })
        fail(403, "Manage Server permission required")
    }
    const { servers }: { servers: Server[] } = await ctx.runMutation(internal.dashboard.renew, { sessionToken: input.sessionToken, user: identity.user, servers: identity.servers })
    if (!servers.some(server => server.id === input.serverId)) fail(403, "Manage Server permission required")
    return providerCatalog(identity.api, stored.accessToken, input.serverId)
} })
const saveArgs = { sessionToken: v.string(), serverId: v.string(), section: v.literal("general"), expectedRevision: v.number(), prefix: v.string() }
export const apply = internalMutation({ args: saveArgs, handler: async (ctx, args): Promise<DashboardSaveResult> => {
    const stored = await session(ctx, args.sessionToken, args.serverId)
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) fail(400, "Invalid settings revision")
    const result = await writePrefix(ctx, args.serverId, { userId: stored.userId, name: stored.userName, source: "website" }, args.prefix, args.expectedRevision)
    if (result.saved) {
        await admitMetadata(ctx, args.serverId, metadataEvent({ category: "settings", type: "settings-change", source: { kind: "dashboard-setting", scope: "general", revision: result.revision }, observedAt: Date.now(), actor: { kind: "configuration", userId: stored.userId }, resourceIds: [], changedFields: ["configuration"], count: 1, outcome: "accepted" }, true))
        // The settings log record waits for the bot
        await ringWork(ctx)
    }
    return result
} })
export const save = action({ args: saveArgs, handler: async (ctx, args): Promise<DashboardSaveResult> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken: args.sessionToken })
    const identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some(server => server.id === args.serverId)) {
        await ctx.runMutation(internal.dashboard.revoke, { sessionToken: args.sessionToken })
        fail(403, "Manage Server permission required")
    }
    await ctx.runMutation(internal.dashboard.renew, { sessionToken: args.sessionToken, user: identity.user, servers: identity.servers })
    return ctx.runMutation(internal.dashboard.apply, args)
} })
