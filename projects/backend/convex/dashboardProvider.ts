import { ConvexError } from "convex/values"
import { configuredServerScope } from "./serverScope.ts"
import { isId } from "./validation.ts"
import type { DashboardCatalog } from "../dashboard-contracts.js"

type ObjectValue = Record<string, unknown>
const row = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {}
const denied = () => new ConvexError({ status: 403, error: "Fluxer permission could not be verified" })
export async function providerJson(url: string, accessToken?: string, discovery = false): Promise<unknown> {
    try {
        const response = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, redirect: discovery ? "manual" : "error", signal: AbortSignal.timeout(5000) })
        if (discovery && !accessToken && url === "https://fluxer.app/.well-known/fluxer" && [301, 302, 307, 308].includes(response.status)
            && response.headers.get("Location") === "https://api.fluxer.app/.well-known/fluxer") return providerJson("https://api.fluxer.app/.well-known/fluxer")
        if (!response.ok) throw response.status === 401 || response.status === 403 ? denied() : new ConvexError({ status: 503, error: "Fluxer unavailable" })
        const body = await response.text()
        if (body.length > 2097152) throw denied()
        return JSON.parse(body) as unknown
    } catch (error) {
        if (error instanceof ConvexError) throw error
        throw new ConvexError({ status: 503, error: "Fluxer unavailable" })
    }
}
export async function fluxerApi(): Promise<string> {
    const discovery = row(await providerJson("https://fluxer.app/.well-known/fluxer", undefined, true)), endpoints = row(discovery.endpoints)
    if (typeof endpoints.api_public !== "string") throw denied()
    const api = new URL(endpoints.api_public)
    if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash) throw denied()
    return api.href.replace(/\/$/, "")
}
/** Servers are the ones the user manages. Member servers are the user's other servers, for member features */
export interface ProviderIdentity { user: { id: string, name: string }, servers: Array<{ id: string, name: string, icon: string | null }>, memberServers: Array<{ id: string, name: string, icon: string | null }>, api: string }
// Same guild icon path as the Fluxer SDK asset helper, static WebP at dashboard tile size
const iconUrl = (serverId: string, hash: unknown) => typeof hash === "string" && hash !== "a_" && hash.length <= 128 && /^[A-Za-z0-9_]+$/.test(hash) ? `https://fluxerusercontent.com/icons/${serverId}/${hash}.webp?size=128&animated=false` : null
export async function providerCatalog(api: string, accessToken: string, serverId: string): Promise<DashboardCatalog> {
    const guild = row(await providerJson(`${api}/v1/guilds/${serverId}`, accessToken))
    if (guild.id !== serverId || !Array.isArray(guild.channels) || guild.channels.length > 500 || !Array.isArray(guild.roles) || guild.roles.length > 250) throw denied()
    const channels = guild.channels.map(value => {
        const channel = row(value)
        if (!isId(channel.id) || channel.guild_id !== serverId || typeof channel.name !== "string" || channel.name.length > 100 || !Number.isSafeInteger(channel.type)
            || channel.parent_id !== undefined && channel.parent_id !== null && !isId(channel.parent_id)) throw denied()
        return { id: channel.id, name: channel.name, type: channel.type as number, ...(isId(channel.parent_id) ? { parentId: channel.parent_id } : {}) }
    })
    const roles = guild.roles.map(value => {
        const role = row(value)
        if (!isId(role.id) || typeof role.name !== "string" || role.name.length > 100 || !Number.isSafeInteger(role.position) || Number(role.position) < 0) throw denied()
        return { id: role.id, name: role.name, position: role.position as number }
    })
    if (new Set(channels.map(channel => channel.id)).size !== channels.length || new Set(roles.map(role => role.id)).size !== roles.length) throw denied()
    return { serverId, channels, roles, ...(isId(guild.owner_id) ? { ownerId: guild.owner_id } : {}) }
}
export async function verifyProvider(accessToken: string): Promise<ProviderIdentity> {
    if (!accessToken.length || accessToken.length > 4096 || /\s/.test(accessToken)) throw denied()
    const clientId = process.env.FLUXER_CLIENT_ID
    if (!isId(clientId)) throw new ConvexError({ status: 503, error: "Dashboard not configured" })
    const api = await fluxerApi()
    const authorization = row(await providerJson(`${api}/v1/oauth2/@me`, accessToken)), user = row(authorization.user)
    if (row(authorization.application).id !== clientId || !isId(user.id) || typeof user.username !== "string" || user.username.length > 256
        || user.bot === true || user.system === true || !Array.isArray(authorization.scopes) || !authorization.scopes.includes("identify") || !authorization.scopes.includes("guilds")) throw denied()
    const guilds: unknown[] = []
    let after = ""
    for (let page = 0; page < 10; page++) {
        const next = await providerJson(`${api}/v1/users/@me/guilds?limit=100${after ? `&after=${after}` : ""}`, accessToken)
        if (!Array.isArray(next) || next.length > 100 || next.some(value => !isId(row(value).id))) throw denied()
        if (next.length && after && BigInt(String(row(next[0]).id)) <= BigInt(after)) throw denied()
        guilds.push(...next)
        if (next.length < 100) break
        after = String(row(next.at(-1)).id)
        if (page === 9) throw denied()
    }
    const scope = configuredServerScope()
    const servers: ProviderIdentity["servers"] = [], memberServers: ProviderIdentity["servers"] = []
    for (const value of guilds) {
        const guild = row(value)
        // Multi mode keeps every listed server here. Session storage then keeps only active installations
        if (!isId(guild.id) || scope.mode === "single" && guild.id !== scope.serverIds[0] || typeof guild.name !== "string" || guild.name.length > 100) continue
        const permissions = typeof guild.permissions === "string" && /^(0|[1-9]\d{0,19})$/.test(guild.permissions) ? BigInt(guild.permissions) : 0n
        const server = { id: guild.id, name: guild.name, icon: iconUrl(guild.id, guild.icon) }
        if (guild.owner_id === user.id || (permissions & 40n) !== 0n) servers.push(server)
        else memberServers.push(server)
    }
    return { user: { id: user.id, name: typeof user.global_name === "string" ? user.global_name.slice(0, 256) : user.username }, servers, memberServers, api }
}
