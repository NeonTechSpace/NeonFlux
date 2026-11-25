import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import { ConvexError, v } from "convex/values"
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server.js"
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type {
    DashboardSession,
    DashboardSaveResult,
    DashboardCatalog,
    DashboardMemberFeature,
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
import { memberFeatures, privateDataRole, rolePickerEnabled } from "./memberAccess.ts"
import { writeGeneral } from "./generalSettings.ts"
import { fail, failedWith } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

const ADMISSION_MS = 300000
// Every dashboard query reads its session row, so each write to it reruns all of that session's live queries.
// Renewals therefore extend read access only once it has run down by at least this much
const RENEW_STEP_MS = 60000
// A session ends once it goes this long without a renewal, and at the latest this long after sign-in
const IDLE_MS = 30 * 86400000
const LIFETIME_MS = 90 * 86400000
const SESSIONS_PER_USER = 5
// Rows stored before idle expiry existed end with their read access, as they did then
const idleAt = (row: Doc<"dashboardSessions">) => row.idleAt ?? row.expiresAt
const usable = (row: Doc<"dashboardSessions">, now: number) => idleAt(row) > now && row.lifetimeAt > now
const ENCRYPTED_TOKEN = "aes-gcm:v1:"
const TOKEN_KEY_ENV = "NEONFLUX_SESSION_ENCRYPTION_KEY"

async function sessionEncryptionKey() {
    const encoded = process.env[TOKEN_KEY_ENV]
    if (encoded === undefined) return undefined
    if (!/^[0-9a-fA-F]{64}$/.test(encoded)) fail(503, "Dashboard session encryption is misconfigured")
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => parseInt(encoded.slice(index * 2, index * 2 + 2), 16))
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
}

const tokenBinding = (hash: string) => new TextEncoder().encode(ENCRYPTED_TOKEN + hash)
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
function toBase64(bytes: Uint8Array) {
    let binary = ""
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]!)
    return btoa(binary)
}

// Actions generate the IV before the database mutation, so a retry writes the same ciphertext
async function sealAccessToken(accessToken: string, hash: string, key: CryptoKey | undefined) {
    if (!key) return accessToken
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = new TextEncoder().encode(accessToken)
    const encrypted = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: tokenBinding(hash) }, key, data),
    )
    const payload = new Uint8Array(iv.length + encrypted.length)
    payload.set(iv, 0)
    payload.set(encrypted, iv.length)
    return ENCRYPTED_TOKEN + toBase64(payload)
}

async function readProviderSession(ctx: ActionCtx, sessionToken: string): Promise<Doc<"dashboardSessions">> {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken })
    const key = await sessionEncryptionKey()
    if (!stored.accessToken.startsWith(ENCRYPTED_TOKEN)) {
        if (key) {
            const sealed = await sealAccessToken(stored.accessToken, stored.tokenHash, key)
            await ctx.runMutation(internal.dashboard.migrateAccessToken, {
                sessionId: stored._id,
                previous: stored.accessToken,
                sealed,
            })
        }
        return stored
    }
    if (!key) fail(503, "Dashboard session encryption is misconfigured")
    try {
        const bytes = fromBase64(stored.accessToken.slice(ENCRYPTED_TOKEN.length))
        if (bytes.length <= 28) fail(401, "Sign in again")
        const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: tokenBinding(stored.tokenHash) },
            key,
            bytes.slice(12),
        )
        return { ...stored, accessToken: new TextDecoder().decode(plaintext) }
    } catch (error) {
        if (error instanceof ConvexError) throw error
        fail(401, "Sign in again")
    }
}

export async function verifiedDashboardIdentity(
    ctx: ActionCtx,
    sessionToken: string,
): Promise<{ userId: string; sessionId: string }> {
    const stored = await readProviderSession(ctx, sessionToken)
    const identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId) fail(403, "Identity changed")
    return { userId: stored.userId, sessionId: stored._id }
}
// The stored session and what the provider says about its user now. A user who no longer manages the server loses the session
export async function verifiedManager(
    ctx: ActionCtx,
    sessionToken: string,
    serverId: string,
): Promise<{ stored: Doc<"dashboardSessions">; identity: ProviderIdentity }> {
    const stored = await readProviderSession(ctx, sessionToken)
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
// The signed-in session, whether or not its read access ran out. Only callers that check the user with Fluxer first may use it
async function storedSession(ctx: QueryCtx | MutationCtx, token: string) {
    const hash = await tokenHash(token)
    const found = await ctx.db
        .query("dashboardSessions")
        .withIndex("by_token", (q) => q.eq("tokenHash", hash))
        .unique()
    if (!found || !usable(found, Date.now())) fail(401, "Sign in again")
    return found
}
export async function dashboardSession(ctx: QueryCtx | MutationCtx, token: string, serverId?: string) {
    const found = await storedSession(ctx, token)
    if (found.expiresAt <= Date.now()) fail(401, "Sign in again")
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
type MemberServer = Server & { features: DashboardMemberFeature[] }
// Servers the user manages that NeonFlux currently serves. Removed servers disappear from the dashboard
async function installedServers(ctx: Pick<QueryCtx, "db">, servers: Server[]) {
    const installed: Server[] = []
    for (const server of servers) if (await isServed(ctx, server.id)) installed.push(server)
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
const sessionServer = (found: Doc<"dashboardSessions">, serverId: string) =>
    found.servers.some((server) => server.id === serverId) ||
    found.memberServers.some((server) => server.id === serverId)
// Member requests accept a managed or member server of the session, rechecking the installation and the member feature on every request
export async function memberSession(
    ctx: QueryCtx | MutationCtx,
    token: string,
    serverId: string,
    feature: Exclude<DashboardMemberFeature, "private"> = "rolepicker",
) {
    const found = await dashboardSession(ctx, token)
    const offered =
        feature === "rolepicker"
            ? await rolePickerEnabled(ctx, serverId)
            : (await memberFeatures(ctx, serverId)).includes(feature)
    if (!sessionServer(found, serverId) || !(await isServed(ctx, serverId)) || !offered)
        fail(
            403,
            feature === "rolepicker"
                ? "Role picker unavailable"
                : feature === "showcase"
                  ? "Showcases unavailable"
                  : feature === "voice"
                    ? "Voice rooms unavailable"
                    : "Profiles unavailable",
        )
    return found
}
// Private cases accept a managed server, or a member server while it names a private data role. Each view still needs a passed live check
export async function privateSession(ctx: QueryCtx | MutationCtx, token: string, serverId: string) {
    const found = await dashboardSession(ctx, token)
    if (
        !sessionServer(found, serverId) ||
        !(await isServed(ctx, serverId)) ||
        (!found.servers.some((server) => server.id === serverId) && (await privateDataRole(ctx, serverId)) === null)
    )
        fail(403, "Private cases unavailable")
    return found
}
// Every caller checks the stored token with Fluxer before it uses the session, so a returning tab regains read access
export const secret = internalQuery({
    args: { sessionToken: v.string() },
    handler: (ctx, args) => storedSession(ctx, args.sessionToken),
})
export const store = internalMutation({
    args: {
        tokenHash: v.string(),
        accessToken: v.string(),
        user: v.object({ id: v.string(), name: v.string() }),
        servers: v.array(serverValidator),
        memberServers: v.optional(v.array(serverValidator)),
    },
    handler: async (ctx, args) => {
        const previous = await ctx.db
            .query("dashboardSessions")
            .withIndex("by_user", (q) => q.eq("userId", args.user.id))
            .take(64)
        const now = Date.now()
        // A new sign-in signs out the least recently used sessions past the limit instead of locking the user out
        const live = previous.filter((old) => usable(old, now)).sort((a, b) => a.expiresAt - b.expiresAt)
        for (const old of [
            ...previous.filter((old) => !usable(old, now)),
            ...live.slice(0, Math.max(0, live.length - SESSIONS_PER_USER + 1)),
        ])
            await ctx.db.delete(old._id)
        const expiresAt = now + ADMISSION_MS,
            idle = now + IDLE_MS,
            servers = await installedServers(ctx, args.servers),
            memberServers = await memberFeatureServers(ctx, args.memberServers ?? [])
        await ctx.db.insert("dashboardSessions", {
            tokenHash: args.tokenHash,
            accessToken: args.accessToken,
            userId: args.user.id,
            userName: args.user.name,
            servers: storedServers(servers),
            memberServers: storedServers(memberServers),
            expiresAt,
            idleAt: idle,
            lifetimeAt: now + LIFETIME_MS,
        })
        return { expiresAt, servers, memberServers }
    },
})
// The retention chain deletes sessions past their idle end, which never lies past the absolute end, in batches
export async function cleanupDashboardSessions(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("dashboardSessions")
        .withIndex("by_idle", (q) => q.lte("idleAt", now))
        .take(256)
    for (const row of rows) await ctx.db.delete(row._id)
    return { more: rows.length === 256 }
}
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
        const hash = await tokenHash(sessionToken)
        const {
            expiresAt,
            servers,
            memberServers,
        }: { expiresAt: number; servers: Server[]; memberServers: MemberServer[] } = await ctx.runMutation(
            internal.dashboard.store,
            {
                tokenHash: hash,
                accessToken: await sealAccessToken(accessToken, hash, await sessionEncryptionKey()),
                user: identity.user,
                servers: identity.servers,
                memberServers: identity.memberServers,
            },
        )
        return {
            sessionToken,
            user: identity.user,
            mode: configuredServerScope().mode,
            servers,
            memberServers,
            expiresAt,
        }
    },
})
type Renewal = {
    sessionToken: string
    user: { id: string; name: string }
    servers: Server[]
    memberServers?: Server[] | undefined
}
// Callers that omit member servers keep the stored member list, so manager writes never change member access.
// Saves renew inside their own enqueue mutation, so a save costs one mutation after the provider check
// Every caller checked the user with Fluxer first, so a session whose read access ran out is renewed too
export async function renewSession(ctx: MutationCtx, args: Renewal) {
    const row = await storedSession(ctx, args.sessionToken)
    if (row.userId !== args.user.id) fail(403, "Identity changed")
    const now = Date.now(),
        lease = Math.min(now + ADMISSION_MS, row.lifetimeAt),
        servers = await installedServers(ctx, args.servers)
    const memberServers = args.memberServers ? await memberFeatureServers(ctx, args.memberServers) : undefined
    // Only changed fields are written, so routine saves and refreshes leave the live queries alone
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
        extend = lease - row.expiresAt >= RENEW_STEP_MS
    const patch = {
        ...(same(row.servers, storedServers(servers)) ? {} : { servers: storedServers(servers) }),
        ...(memberServers && !same(row.memberServers, storedServers(memberServers))
            ? { memberServers: storedServers(memberServers) }
            : {}),
        ...(row.userName === args.user.name ? {} : { userName: args.user.name }),
        ...(extend ? { expiresAt: lease, idleAt: Math.min(now + IDLE_MS, row.lifetimeAt) } : {}),
    }
    if (Object.keys(patch).length) await ctx.db.patch(row._id, patch)
    return { expiresAt: extend ? lease : row.expiresAt, servers, ...(memberServers ? { memberServers } : {}) }
}
export const renew = internalMutation({
    args: {
        sessionToken: v.string(),
        user: v.object({ id: v.string(), name: v.string() }),
        servers: v.array(serverValidator),
        memberServers: v.optional(v.array(serverValidator)),
    },
    handler: renewSession,
})
export const refresh = action({
    args: { sessionToken: v.string() },
    handler: async (ctx, { sessionToken }): Promise<DashboardSession> => {
        const stored = await readProviderSession(ctx, sessionToken)
        try {
            const identity = await verifyProvider(stored.accessToken)
            const {
                expiresAt,
                servers,
                memberServers,
            }: { expiresAt: number; servers: Server[]; memberServers?: MemberServer[] } = await ctx.runMutation(
                internal.dashboard.renew,
                { sessionToken, user: identity.user, servers: identity.servers, memberServers: identity.memberServers },
            )
            return {
                sessionToken,
                user: identity.user,
                mode: configuredServerScope().mode,
                servers,
                memberServers: memberServers ?? [],
                expiresAt,
            }
        } catch (error) {
            if (failedWith(error, 403)) await ctx.runMutation(internal.dashboard.revoke, { sessionToken })
            throw error
        }
    },
})
// The web server refreshes the Fluxer access token before it runs out and stores the new one here. It must belong to the same user and application
export const rotate = action({
    args: { sessionToken: v.string(), accessToken: v.string() },
    handler: async (ctx, { sessionToken, accessToken }): Promise<null> => {
        const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken })
        const identity = await verifyProvider(accessToken)
        if (identity.user.id !== stored.userId) fail(403, "Identity changed")
        await ctx.runMutation(internal.dashboard.replaceToken, {
            sessionToken,
            userId: stored.userId,
            accessToken: await sealAccessToken(accessToken, stored.tokenHash, await sessionEncryptionKey()),
        })
        return null
    },
})
export const replaceToken = internalMutation({
    args: { sessionToken: v.string(), userId: v.string(), accessToken: v.string() },
    handler: async (ctx, { sessionToken, userId, accessToken }) => {
        const row = await storedSession(ctx, sessionToken)
        if (row.userId !== userId) fail(403, "Identity changed")
        await ctx.db.patch(row._id, { accessToken })
        return null
    },
})
// A concurrent rotation or sign-out wins over migration of an older read
export const migrateAccessToken = internalMutation({
    args: { sessionId: v.id("dashboardSessions"), previous: v.string(), sealed: v.string() },
    handler: async (ctx, { sessionId, previous, sealed }) => {
        const row = await ctx.db.get(sessionId)
        if (row?.accessToken === previous) await ctx.db.patch(sessionId, { accessToken: sealed })
        return null
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
    replyStyle: v.optional(v.union(v.literal("embed"), v.literal("text"))),
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
            { userId: stored.userId, name: stored.userName, source: "website" },
            { prefix: args.prefix, replyStyle: args.replyStyle },
            args.expectedRevision,
        )
        if (result.saved && result.revision !== args.expectedRevision) {
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
