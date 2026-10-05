import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import { v } from "convex/values"
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server.js"
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type {
    DashboardSession,
    DashboardSaveResult,
    DashboardCatalog,
    DashboardWebConfig,
} from "../dashboard-contracts.js"
import {
    verifyProvider,
    providerCatalog,
    renewalIdentity,
    configuredClientId,
    type ProviderIdentity,
} from "./dashboardProvider.ts"
import { configuredServerScope, configuredWebsiteUrl } from "./serverScope.ts"
import { isServed } from "./serviceGuard.ts"
import type { Doc } from "./_generated/dataModel.js"
import { writeGeneral } from "./generalSettings.ts"
import { fail, failedWith } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

const ADMISSION_MS = 300000
// Every dashboard query reads its session row, so each write to it reruns all of that session's live queries.
// Renewals therefore extend read access only once it has run down by at least this much
const RENEW_STEP_MS = 60000
const LIFETIME_MS = 28800000
// The stored session and what the provider says about its user now. A user who no longer manages the server loses the session
export async function verifiedManager(
    ctx: ActionCtx,
    sessionToken: string,
    serverId: string,
): Promise<{ stored: Doc<"dashboardSessions">; identity: ProviderIdentity }> {
    const stored: Doc<"dashboardSessions"> = await ctx.runQuery(internal.dashboard.secret, { sessionToken })
    const identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some((server) => server.id === serverId)) {
        await ctx.runMutation(internal.dashboard.revoke, { sessionToken })
        fail(403, "Manage community permission required")
    }
    return { stored, identity }
}
export async function tokenHash(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) fail(401, "Sign in again")
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")
}
export async function dashboardSession(ctx: QueryCtx | MutationCtx, token: string, serverId?: string) {
    const hash = await tokenHash(token)
    const found = await ctx.db
        .query("dashboardSessions")
        .withIndex("by_token", (q) => q.eq("tokenHash", hash))
        .unique()
    if (!found || found.expiresAt <= Date.now() || found.lifetimeAt <= Date.now()) fail(401, "Sign in again")
    // The session snapshot proves management, and the installation is rechecked on every request
    if (serverId && (!found.servers.some((server) => server.id === serverId) || !(await isServed(ctx, serverId))))
        fail(403, "Manage community permission required")
    return found
}
/** A queued job's session while its permission grant holds. The job and the session are live, and the session is the actor's and lists the server */
export async function liveGrant(
    ctx: QueryCtx | MutationCtx,
    job: { sessionId: Doc<"dashboardSessions">["_id"]; actorId: string; serverId: string; expiresAt: number },
) {
    const found = await ctx.db.get(job.sessionId),
        now = Date.now()
    return job.expiresAt > now &&
        found &&
        found.expiresAt > now &&
        found.lifetimeAt > now &&
        found.userId === job.actorId &&
        found.servers.some((server) => server.id === job.serverId)
        ? found
        : null
}
const serverValidator = v.object({ id: v.string(), name: v.string(), icon: v.union(v.string(), v.null()) })
const storedServers = (servers: Array<{ id: string; name: string }>) => servers.map(({ id, name }) => ({ id, name }))
type Server = { id: string; name: string; icon: string | null }
// Servers the user manages that NeonFlux currently serves. Removed servers disappear from the dashboard
async function installedServers(ctx: Pick<QueryCtx, "db">, servers: Server[]) {
    const installed: Server[] = []
    for (const server of servers) if (await isServed(ctx, server.id)) installed.push(server)
    return installed
}
export const secret = internalQuery({
    args: { sessionToken: v.string() },
    handler: (ctx, args) => dashboardSession(ctx, args.sessionToken),
})
export const store = internalMutation({
    args: {
        tokenHash: v.string(),
        accessToken: v.string(),
        user: v.object({ id: v.string(), name: v.string() }),
        servers: v.array(serverValidator),
    },
    handler: async (ctx, args) => {
        const previous = await ctx.db
            .query("dashboardSessions")
            .withIndex("by_user", (q) => q.eq("userId", args.user.id))
            .collect()
        for (const old of previous.filter((old) => old.expiresAt <= Date.now())) await ctx.db.delete(old._id)
        if (previous.filter((old) => old.expiresAt > Date.now()).length >= 5)
            fail(429, "Too many active dashboard sessions")
        const expiresAt = Date.now() + ADMISSION_MS,
            servers = await installedServers(ctx, args.servers)
        const id = await ctx.db.insert("dashboardSessions", {
            tokenHash: args.tokenHash,
            accessToken: args.accessToken,
            userId: args.user.id,
            userName: args.user.name,
            servers: storedServers(servers),
            expiresAt,
            lifetimeAt: Date.now() + LIFETIME_MS,
        })
        await ctx.scheduler.runAt(expiresAt, internal.dashboard.expire, { id })
        return { expiresAt, servers }
    },
})
export const expire = internalMutation({
    args: { id: v.id("dashboardSessions") },
    handler: async (ctx, { id }) => {
        const row = await ctx.db.get(id)
        if (row && row.expiresAt <= Date.now()) await ctx.db.delete(id)
    },
})
// The public settings the web server adopts once at startup, so the deployment owns the website origin and the OAuth application
export const webConfig = query({
    args: {},
    handler: (): DashboardWebConfig => ({ websiteUrl: configuredWebsiteUrl(), clientId: configuredClientId() }),
})
export const admit = action({
    args: { accessToken: v.string() },
    handler: async (ctx, { accessToken }): Promise<DashboardSession> => {
        const identity = await verifyProvider(accessToken)
        const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
            value.toString(16).padStart(2, "0"),
        ).join("")
        const { expiresAt, servers }: { expiresAt: number; servers: Server[] } = await ctx.runMutation(
            internal.dashboard.store,
            {
                tokenHash: await tokenHash(sessionToken),
                accessToken,
                user: identity.user,
                servers: identity.servers,
            },
        )
        return { sessionToken, user: identity.user, mode: configuredServerScope().mode, servers, expiresAt }
    },
})
type Renewal = { sessionToken: string; user: { id: string; name: string }; servers: Server[] }
// Saves renew inside their own enqueue mutation, so a save costs one mutation after the provider check
export async function renewSession(ctx: MutationCtx, args: Renewal) {
    const row = await dashboardSession(ctx, args.sessionToken)
    if (row.userId !== args.user.id) fail(403, "Identity changed")
    const lease = Math.min(Date.now() + ADMISSION_MS, row.lifetimeAt),
        servers = await installedServers(ctx, args.servers)
    // Only changed fields are written, so routine saves and refreshes leave the live queries alone
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
        extend = lease - row.expiresAt >= RENEW_STEP_MS
    const patch = {
        ...(same(row.servers, storedServers(servers)) ? {} : { servers: storedServers(servers) }),
        ...(row.userName === args.user.name ? {} : { userName: args.user.name }),
        ...(extend ? { expiresAt: lease } : {}),
    }
    if (Object.keys(patch).length) await ctx.db.patch(row._id, patch)
    if (extend) await ctx.scheduler.runAt(lease, internal.dashboard.expire, { id: row._id })
    return { expiresAt: extend ? lease : row.expiresAt, servers }
}
export const renew = internalMutation({
    args: {
        sessionToken: v.string(),
        user: v.object({ id: v.string(), name: v.string() }),
        servers: v.array(serverValidator),
    },
    handler: renewSession,
})
export const refresh = action({
    args: { sessionToken: v.string() },
    handler: async (ctx, { sessionToken }): Promise<DashboardSession> => {
        const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken })
        try {
            const identity = await verifyProvider(stored.accessToken)
            const { expiresAt, servers }: { expiresAt: number; servers: Server[] } = await ctx.runMutation(
                internal.dashboard.renew,
                { sessionToken, user: identity.user, servers: identity.servers },
            )
            return { sessionToken, user: identity.user, mode: configuredServerScope().mode, servers, expiresAt }
        } catch (error) {
            if (failedWith(error, 403)) await ctx.runMutation(internal.dashboard.revoke, { sessionToken })
            throw error
        }
    },
})
async function deleteSession(ctx: MutationCtx, sessionToken: string) {
    const hash = await tokenHash(sessionToken),
        row = await ctx.db
            .query("dashboardSessions")
            .withIndex("by_token", (q) => q.eq("tokenHash", hash))
            .unique()
    if (row) await ctx.db.delete(row._id)
    return null
}
export const revoke = internalMutation({
    args: { sessionToken: v.string() },
    handler: (ctx, { sessionToken }) => deleteSession(ctx, sessionToken),
})
export const logout = mutation({
    args: { sessionToken: v.string() },
    handler: (ctx, { sessionToken }) => deleteSession(ctx, sessionToken),
})
export const catalog = action({
    args: { sessionToken: v.string(), serverId: v.string() },
    handler: async (ctx, input): Promise<DashboardCatalog> => {
        const { stored, identity } = await verifiedManager(ctx, input.sessionToken, input.serverId)
        const { servers }: { servers: Server[] } = await ctx.runMutation(internal.dashboard.renew, {
            sessionToken: input.sessionToken,
            user: identity.user,
            servers: identity.servers,
        })
        if (!servers.some((server) => server.id === input.serverId)) fail(403, "Manage community permission required")
        return providerCatalog(identity.api, stored.accessToken, input.serverId)
    },
})
const saveArgs = {
    sessionToken: v.string(),
    serverId: v.string(),
    section: v.literal("general"),
    expectedRevision: v.number(),
    prefix: v.string(),
}
export const apply = internalMutation({
    args: { ...saveArgs, identity: renewalIdentity },
    handler: async (ctx, { identity, ...args }): Promise<DashboardSaveResult> => {
        await renewSession(ctx, { sessionToken: args.sessionToken, ...identity })
        const stored = await dashboardSession(ctx, args.sessionToken, args.serverId)
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0)
            fail(400, "Invalid settings revision")
        const result = await writeGeneral(
            ctx,
            args.serverId,
            stored.userId,
            { prefix: args.prefix },
            args.expectedRevision,
        )
        if (result.saved) {
            await admitMetadata(
                ctx,
                args.serverId,
                metadataEvent(
                    {
                        category: "settings",
                        type: "settings-change",
                        source: { kind: "dashboard-setting", scope: "general", revision: result.revision },
                        observedAt: Date.now(),
                        actor: { kind: "configuration", userId: stored.userId },
                        resourceIds: [],
                        changedFields: ["configuration"],
                        count: 1,
                        outcome: "accepted",
                    },
                    true,
                ),
            )
            // The settings log record waits for the bot
            await ringWork(ctx)
        }
        return result
    },
})
export const save = action({
    args: saveArgs,
    handler: async (ctx, args): Promise<DashboardSaveResult> => {
        const { identity } = await verifiedManager(ctx, args.sessionToken, args.serverId)
        return ctx.runMutation(internal.dashboard.apply, {
            ...args,
            identity: { user: identity.user, servers: identity.servers },
        })
    },
})
