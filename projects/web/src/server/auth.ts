import type { DashboardSession } from "@neonflux/backend/dashboard-contracts"
import { ConvexError } from "convex/values"
import { inviteUrl } from "./invite.ts"
import { clientIpKey, createSlidingWindowRateLimiter, type RateLimiter, type TrustProxyMode } from "./rate-limit.ts"
import { apiSecurityHeaders } from "./security-headers.ts"

export interface AuthConfig {
    origin: string
    clientId: string
    clientSecret: string
    convexUrl: string
    sessionSecret: string
    trustProxy?: TrustProxyMode
}
export interface AuthRateLimiters {
    auth: RateLimiter
    api: RateLimiter
}
export interface AuthDependencies {
    config: AuthConfig
    fetch: typeof fetch
    now: () => number
    admit: (accessToken: string) => Promise<DashboardSession>
    refresh: (sessionToken: string) => Promise<DashboardSession>
    rotate: (sessionToken: string, accessToken: string) => Promise<unknown>
    logout: (sessionToken: string) => Promise<unknown>
    rateLimiters?: AuthRateLimiters
}
const sessionCookie = "neonflux_session"
const handshakeCookie = "neonflux_oauth"
const refreshCookie = "neonflux_refresh"
const maxHandshakeAge = 10 * 60 * 1000
// The backend ends a session at the latest 90 days after sign-in, so neither cookie outlives it
const sessionAge = 90 * 86400
// The access token is renewed once less than this remains, so it never runs out while the dashboard is in use
const refreshMargin = 3600 * 1000
export const PROVIDER_DISCOVERY_TTL_MS = 15 * 60 * 1000
const HANDSHAKE_KEY_INFO = "neonflux oauth handshake cookie v1"
const REFRESH_KEY_INFO = "neonflux refresh cookie v1"
const MAX_DERIVED_KEYS = 32
const encoder = new TextEncoder()
const decoder = new TextDecoder()

class ClientMismatch extends Error {}

const isHttpsOrigin = (origin: string) => origin.startsWith("https:")
export function sessionCookieName(origin: string): string {
    return isHttpsOrigin(origin) ? `__Host-${sessionCookie}` : sessionCookie
}
export function handshakeCookieName(origin: string): string {
    return isHttpsOrigin(origin) ? `__Host-${handshakeCookie}` : handshakeCookie
}
export function refreshCookieName(origin: string): string {
    return isHttpsOrigin(origin) ? `__Secure-${refreshCookie}` : refreshCookie
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const BASE64URL_LOOKUP = new Int16Array(128).fill(-1)
for (let index = 0; index < BASE64_ALPHABET.length; index++) {
    const ch = BASE64_ALPHABET.charCodeAt(index)
    BASE64URL_LOOKUP[ch] = index
}
BASE64URL_LOOKUP["-".charCodeAt(0)] = 62
BASE64URL_LOOKUP["_".charCodeAt(0)] = 63

function bytesToBase64(bytes: Uint8Array): string {
    let out = ""
    for (let index = 0; index < bytes.length; index += 3) {
        const a = bytes[index]!
        const b = bytes[index + 1]
        const c = bytes[index + 2]
        const triplet = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
        out += BASE64_ALPHABET[(triplet >>> 18) & 63]!
        out += BASE64_ALPHABET[(triplet >>> 12) & 63]!
        out += b === undefined ? "=" : BASE64_ALPHABET[(triplet >>> 6) & 63]!
        out += c === undefined ? "=" : BASE64_ALPHABET[triplet & 63]!
    }
    return out
}
function bytesToBase64Url(bytes: Uint8Array): string {
    return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}
function base64UrlToBytes(input: string): Uint8Array | undefined {
    const remainder = input.length % 4
    if (remainder === 1) return undefined
    const outputLength = Math.floor((input.length * 3) / 4)
    const out = new Uint8Array(outputLength)
    let outIndex = 0
    for (let index = 0; index < input.length; index += 4) {
        const c0 = input.charCodeAt(index)
        const c1 = input.charCodeAt(index + 1)
        const c2 = index + 2 < input.length ? input.charCodeAt(index + 2) : -1
        const c3 = index + 3 < input.length ? input.charCodeAt(index + 3) : -1
        const v0 = c0 < 128 ? BASE64URL_LOOKUP[c0]! : -1
        const v1 = c1 < 128 ? BASE64URL_LOOKUP[c1]! : -1
        const v2 = c2 === -1 ? 0 : c2 < 128 ? BASE64URL_LOOKUP[c2]! : -1
        const v3 = c3 === -1 ? 0 : c3 < 128 ? BASE64URL_LOOKUP[c3]! : -1
        if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return undefined
        const triplet = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3
        out[outIndex++] = (triplet >>> 16) & 255
        if (c2 !== -1 && outIndex < outputLength) out[outIndex++] = (triplet >>> 8) & 255
        if (c3 !== -1 && outIndex < outputLength) out[outIndex++] = triplet & 255
    }
    return out
}
function bytesToHex(bytes: Uint8Array): string {
    let hex = ""
    for (let index = 0; index < bytes.length; index++) hex += bytes[index]!.toString(16).padStart(2, "0")
    return hex
}
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(new ArrayBuffer(length))
    globalThis.crypto.getRandomValues(bytes)
    return bytes
}
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
    const length = Math.max(a.length, b.length)
    let diff = a.length ^ b.length
    for (let index = 0; index < length; index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0)
    return diff === 0
}
function constantTimeEqualString(a: string, b: string): boolean {
    return constantTimeEqualBytes(encoder.encode(a), encoder.encode(b))
}
async function sha256Bytes(value: string): Promise<Uint8Array> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value))
    return new Uint8Array(digest)
}
async function sessionHash(sessionToken: string): Promise<string> {
    return bytesToHex(await sha256Bytes(sessionToken))
}

const derivedKeys = new Map<string, Promise<CryptoKey>>()
function deriveAesGcmKey(secret: string, info: string): Promise<CryptoKey> {
    const cacheKey = `${info}\0${secret}`
    const cached = derivedKeys.get(cacheKey)
    if (cached) return cached
    const derived = (async () => {
        const keyMaterial = await globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
            "deriveKey",
        ])
        return globalThis.crypto.subtle.deriveKey(
            { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(info) },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        )
    })()
    if (derivedKeys.size >= MAX_DERIVED_KEYS) {
        const oldest = derivedKeys.keys().next().value
        if (oldest !== undefined) derivedKeys.delete(oldest)
    }
    derivedKeys.set(cacheKey, derived)
    return derived
}
async function sealJson(payload: unknown, secret: string, info: string): Promise<string> {
    const key = await deriveAesGcmKey(secret, info)
    const iv = randomBytes(12)
    const plaintext = encoder.encode(JSON.stringify(payload))
    const encrypted = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext))
    const combined = new Uint8Array(iv.length + encrypted.length)
    combined.set(iv, 0)
    combined.set(encrypted, iv.length)
    return bytesToBase64Url(combined)
}
async function openJson(raw: string | undefined, secret: string, info: string, maxLength: number): Promise<unknown> {
    if (!raw || raw.length > maxLength || !/^[\w-]+$/.test(raw)) return undefined
    const bytes = base64UrlToBytes(raw)
    if (!bytes || bytes.length <= 28) return undefined
    try {
        const key = await deriveAesGcmKey(secret, info)
        const iv = bytes.slice(0, 12)
        const ciphertext = bytes.slice(12)
        const plaintext = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
        return JSON.parse(decoder.decode(plaintext)) as unknown
    } catch {
        return undefined
    }
}

export function cookieValue(request: Request, name = sessionCookie): string | undefined {
    const values = (request.headers.get("cookie") ?? "")
        .split(";")
        .map((value) => value.trim())
        .filter((value) => value.startsWith(`${name}=`))
    return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined
}
// A TLS-terminating proxy reaches the server over plain HTTP, and the server trusts no forwarded headers, so a request URL
// reads http: behind it. Only its host is compared. The browser's Origin header still has to match the origin in full
const sameHost = (request: Request, origin: string) => new URL(request.url).host === new URL(origin).host
export function sameOrigin(request: Request, origin: string): boolean {
    const fetchSite = request.headers.get("sec-fetch-site")
    if (fetchSite !== null && fetchSite !== "same-origin") return false
    return sameHost(request, origin) && request.headers.get("origin") === origin
}
function cookie(config: AuthConfig, name: string, value: string, maxAge: number): string {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttpsOrigin(config.origin) ? "; Secure" : ""}`
}
/**
 * The Fluxer refresh token, the access token's end, the session it belongs to and that session's latest end. The web server
 * encrypts it into a cookie that browser scripts cannot read and that the browser sends only to the session refresh
 */
interface RefreshState {
    refreshToken: string
    accessExpiresAt: number
    session: string
    until: number
}
interface HandshakeState {
    state: string
    verifier: string
    issuedAt: number
    returnTo: string
}
// Browsers keep a cookie only while its name and value together stay within 4096 bytes, so that is the only bound on a refresh
// token: One whose encrypted state does not fit gets no cookie, and the session then ends when its access token does
const maxCookieValue = (name: string) => 4096 - `${name}=`.length
async function refreshCookieHeader(config: AuthConfig, state: RefreshState | undefined, now: number): Promise<string> {
    const name = refreshCookieName(config.origin)
    const maxValue = maxCookieValue(name)
    let value = "",
        maxAge = 0
    if (state) {
        const sealed = await sealJson(state, config.sessionSecret, REFRESH_KEY_INFO)
        // A rotated token that does not fit replaced the stored one at Fluxer, so the cookie is cleared rather than kept
        if (sealed.length <= maxValue) {
            value = sealed
            maxAge = Math.max(0, Math.floor((state.until - now) / 1000))
        }
    }
    return `${name}=${value}; Path=/api/session; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttpsOrigin(config.origin) ? "; Secure" : ""}`
}
async function openRefreshCookie(raw: string | undefined, config: AuthConfig): Promise<RefreshState | undefined> {
    const name = refreshCookieName(config.origin)
    const parsed = (await openJson(raw, config.sessionSecret, REFRESH_KEY_INFO, maxCookieValue(name))) as
        Partial<RefreshState> | undefined
    if (!parsed || typeof parsed !== "object") return undefined
    return refreshToken(parsed.refreshToken) &&
        Number.isSafeInteger(parsed.accessExpiresAt) &&
        typeof parsed.session === "string" &&
        Number.isSafeInteger(parsed.until)
        ? (parsed as RefreshState)
        : undefined
}
async function openHandshakeCookie(raw: string | undefined, config: AuthConfig): Promise<HandshakeState | undefined> {
    const name = handshakeCookieName(config.origin)
    const parsed = (await openJson(raw, config.sessionSecret, HANDSHAKE_KEY_INFO, maxCookieValue(name))) as
        Partial<HandshakeState> | undefined
    if (!parsed || typeof parsed !== "object") return undefined
    return typeof parsed.state === "string" &&
        typeof parsed.verifier === "string" &&
        typeof parsed.issuedAt === "number" &&
        typeof parsed.returnTo === "string"
        ? (parsed as HandshakeState)
        : undefined
}
const refreshToken = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && !/\s/.test(value)
const expiresIn = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
/** Keep the cookie, defer to an in-flight Worker refresh, store this state in it, or clear it */
type RefreshOutcome = { keep: true } | { wait: true } | { state: RefreshState } | { clear: true }
// One refresh per refresh token in this process. Fluxer replaces the refresh token on use, so a second request with the
// same cookie shares the first one's outcome, also when it arrives within a minute after the first finished. On
// Cloudflare Workers only settled outcomes and an in-flight lock timestamp are shared, so no request ever awaits another
// request's fetch or double-redeems a single-use refresh token
const refreshes = new Map<
    string,
    { outcome?: Promise<RefreshOutcome>; settled?: RefreshOutcome; settledAt?: number; inFlightSince?: number }
>()
const sharedRefreshMs = 60 * 1000
const workersRefreshLockMs = 60 * 1000

function safeReturnTo(value: string | null): string {
    if (value === "/") return value
    if (value && /^\/verify\?token=[a-f0-9]{32}$/.test(value)) return value
    // A dashboard section link, so signing in again returns to the same server and section
    if (value && /^\/\?(?:server=[1-9]\d{0,18}(?:&section=[a-z]{1,16})?|section=[a-z]{1,16})$/.test(value)) return value
    return "/"
}
export function authorizeUrl(api: string, query: URLSearchParams): string {
    return `${api}/v1/oauth2/authorize?${query}`
}

/** Detects Cloudflare Workers (workerd) where awaiting another request's in-flight I/O Promise throws */
export function isWorkersRuntime(): boolean {
    return (
        (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") ||
        (typeof (globalThis as { __env__?: unknown }).__env__ === "object" &&
            (globalThis as { __env__?: unknown }).__env__ !== null)
    )
}

interface DiscoveryCacheEntry {
    api?: string
    expiresAt: number
    inFlight?: Promise<string>
}
let discoveryCache = new WeakMap<typeof fetch, DiscoveryCacheEntry>()
/** Clears cached provider discovery documents, mainly for deterministic tests */
export function clearProviderDiscoveryCache(): void {
    discoveryCache = new WeakMap<typeof fetch, DiscoveryCacheEntry>()
}
async function fetchProviderDiscovery(fetcher: typeof fetch): Promise<string> {
    let response = await fetcher("https://fluxer.app/.well-known/fluxer", {
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
    })
    if ([301, 302, 307, 308].includes(response.status)) {
        const location = new URL(response.headers.get("location") ?? "", "https://fluxer.app").href
        if (location !== "https://api.fluxer.app/.well-known/fluxer") throw new Error("Provider discovery unavailable")
        response = await fetcher(location, { signal: AbortSignal.timeout(5000), redirect: "error" })
    }
    if (!response.ok) throw new Error("Provider discovery unavailable")
    const body = (await response.json()) as { endpoints?: { api_public?: string } }
    const api = body.endpoints?.api_public
    if (typeof api !== "string") throw new Error("Provider discovery unavailable")
    const url = new URL(api)
    if (
        url.protocol !== "https:" ||
        url.hostname !== "api.fluxer.app" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        api.includes("?") ||
        api.includes("#")
    )
        throw new Error("Provider discovery unavailable")
    return url.href.replace(/\/$/, "")
}
export async function discoverProvider(fetcher: typeof fetch, now: () => number = Date.now): Promise<string> {
    const existing = discoveryCache.get(fetcher)
    if (existing?.api !== undefined && now() < existing.expiresAt) return existing.api
    const workers = isWorkersRuntime()
    if (!workers && existing?.inFlight) return existing.inFlight
    const cache = discoveryCache
    if (workers) {
        const api = await fetchProviderDiscovery(fetcher)
        if (cache === discoveryCache) cache.set(fetcher, { api, expiresAt: now() + PROVIDER_DISCOVERY_TTL_MS })
        return api
    }
    const pending = fetchProviderDiscovery(fetcher).then(
        (api) => {
            if (cache === discoveryCache) cache.set(fetcher, { api, expiresAt: now() + PROVIDER_DISCOVERY_TTL_MS })
            return api
        },
        (error: unknown) => {
            if (cache === discoveryCache && cache.get(fetcher)?.inFlight === pending) cache.delete(fetcher)
            throw error
        },
    )
    cache.set(fetcher, { expiresAt: 0, inFlight: pending })
    return pending
}
// The backend refused the session itself, so it has ended
const ended = (error: unknown) =>
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "status" in error.data &&
    (error.data.status === 401 || error.data.status === 403)
async function signedOut(config: AuthConfig): Promise<Headers> {
    const headers = new Headers()
    headers.append("Set-Cookie", cookie(config, sessionCookieName(config.origin), "", 0))
    headers.append("Set-Cookie", await refreshCookieHeader(config, undefined, 0))
    return headers
}

export function createDefaultAuthRateLimiters(): AuthRateLimiters {
    return {
        auth: createSlidingWindowRateLimiter({ limit: 30, windowMs: 60_000 }),
        api: createSlidingWindowRateLimiter({ limit: 120, windowMs: 60_000 }),
    }
}

export function createAuthHandlers(deps: AuthDependencies) {
    const { config } = deps
    const limiters = deps.rateLimiters ?? createDefaultAuthRateLimiters()
    const baseHeaders = apiSecurityHeaders(config.origin)
    const json = (data: unknown, status = 200, extra: HeadersInit = {}) => {
        const headers = new Headers(baseHeaders)
        new Headers(extra).forEach((value, name) => headers.append(name, value))
        return Response.json(data, { status, headers })
    }
    const redirect = (location: string, cookies: string[]) => {
        const headers = new Headers({ ...baseHeaders, Location: location })
        for (const value of cookies) headers.append("Set-Cookie", value)
        return new Response(null, { status: 303, headers })
    }
    const tooMany = (retryAfterSeconds: number) =>
        json({ error: "Too many requests. Try again shortly" }, 429, { "Retry-After": String(retryAfterSeconds) })
    async function enforceRateLimit(
        bucket: keyof AuthRateLimiters,
        request: Request,
        sessionToken?: string,
    ): Promise<Response | undefined> {
        const now = deps.now()
        const limiter = limiters[bucket]
        const ip = clientIpKey(request, config.trustProxy)
        if (ip) {
            const ipCheck = limiter.check(`${bucket}:ip:${ip}`, now)
            if (!ipCheck.allowed) return tooMany(ipCheck.retryAfterSeconds)
        }
        if (sessionToken) {
            const sessionCheck = limiter.check(`${bucket}:session:${await sessionHash(sessionToken)}`, now)
            if (!sessionCheck.allowed) return tooMany(sessionCheck.retryAfterSeconds)
        }
        return undefined
    }
    // Asks Fluxer for a new access token and hands it to the backend. An outcome that is not known is never repeated
    async function renewAccess(sessionToken: string, state: RefreshState): Promise<RefreshOutcome> {
        let api: string
        try {
            api = await discoverProvider(deps.fetch, deps.now)
        } catch {
            // Nothing was sent yet, so the refresh token is unspent and a later call tries again
            return { keep: true }
        }
        let data: { access_token?: unknown; token_type?: unknown; refresh_token?: unknown; expires_in?: unknown }
        try {
            const response = await deps.fetch(`${api}/v1/oauth2/token`, {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(10000),
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    refresh_token: state.refreshToken,
                }),
            })
            if (response.status === 400) {
                const body = (await response.json().catch(() => ({}))) as { error?: unknown }
                // Fluxer no longer accepts this refresh token, so the session ends when its access token does
                if (body.error === "invalid_grant") return { clear: true }
            }
            // A gateway error or timeout may come after Fluxer already replaced the token, so like a lost answer it is not sent again
            if (response.status === 502 || response.status === 504) return { clear: true }
            // Fluxer answered without issuing a token, so the refresh token is unspent
            if (!response.ok) return { keep: true }
            data = (await response.json()) as typeof data
        } catch {
            // Fluxer may have replaced the refresh token without the answer arriving. Sending the old one again would
            // replay it, so the session ends when its access token does
            return { clear: true }
        }
        if (
            typeof data.access_token !== "string" ||
            typeof data.token_type !== "string" ||
            data.token_type.toLowerCase() !== "bearer" ||
            !expiresIn(data.expires_in)
        )
            return { clear: true }
        const next = refreshToken(data.refresh_token) ? data.refresh_token : state.refreshToken
        try {
            await deps.rotate(sessionToken, data.access_token)
        } catch (error) {
            if (ended(error)) return { clear: true }
            // The backend still holds the old access token, so the next session call renews again with the new refresh token
            return { state: { ...state, refreshToken: next } }
        }
        return {
            state: { ...state, refreshToken: next, accessExpiresAt: deps.now() + data.expires_in * 1000 },
        }
    }
    // Asks Fluxer to end the refresh token at sign-out. The session has already ended and the browser drops the cookie, so a
    // failure leaves only a token no one holds
    async function revoke(refreshToken: string): Promise<void> {
        try {
            const api = await discoverProvider(deps.fetch, deps.now)
            const credentials = bytesToBase64(encoder.encode(`${config.clientId}:${config.clientSecret}`))
            await deps.fetch(`${api}/v1/oauth2/token/revoke`, {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(5000),
                headers: {
                    Authorization: `Basic ${credentials}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
            })
        } catch {}
    }
    async function sharedRenewal(sessionToken: string, state: RefreshState): Promise<RefreshOutcome> {
        const now = deps.now()
        for (const [key, entry] of refreshes)
            if (
                (entry.settledAt !== undefined && now - entry.settledAt > sharedRefreshMs) ||
                (entry.inFlightSince !== undefined && now - entry.inFlightSince > workersRefreshLockMs)
            )
                refreshes.delete(key)
        const key = await sessionHash(`${state.session} ${state.refreshToken}`),
            found = refreshes.get(key)
        if (isWorkersRuntime()) {
            if (found?.settled) return found.settled
            // Another request in this isolate is already redeeming this single-use refresh token: leave the cookie
            // untouched so the in-flight request sets the rotated cookie without a concurrent replay clearing it
            if (found?.inFlightSince !== undefined && now - found.inFlightSince < workersRefreshLockMs)
                return { wait: true }
            refreshes.set(key, { inFlightSince: now })
            try {
                const settled = await renewAccess(sessionToken, state)
                const latest = refreshes.get(key)
                if (latest?.settled && "state" in latest.settled && !("state" in settled)) return latest.settled
                refreshes.set(key, { settled, settledAt: deps.now() })
                return settled
            } catch (error) {
                if (refreshes.get(key)?.inFlightSince === now) refreshes.delete(key)
                throw error
            }
        }
        if (found?.settled) return found.settled
        if (found?.outcome) return found.outcome
        const entry: { outcome?: Promise<RefreshOutcome>; settled?: RefreshOutcome; settledAt?: number } = {}
        entry.outcome = renewAccess(sessionToken, state).then((settled) => {
            entry.settled = settled
            entry.settledAt = deps.now()
            return settled
        })
        refreshes.set(key, entry)
        return entry.outcome
    }
    return {
        async begin(request: Request): Promise<Response> {
            const limited = await enforceRateLimit("auth", request)
            if (limited) return limited
            if (!sameHost(request, config.origin)) return json({ error: "Invalid website origin" }, 400)
            const state = bytesToBase64Url(randomBytes(32)),
                verifier = bytesToBase64Url(randomBytes(32))
            const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"))
            const sealed = await sealJson(
                { state, verifier, returnTo, issuedAt: deps.now() } satisfies HandshakeState,
                config.sessionSecret,
                HANDSHAKE_KEY_INFO,
            )
            const codeChallenge = bytesToBase64Url(await sha256Bytes(verifier))
            const query = new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: `${config.origin}/auth/fluxer/callback`,
                response_type: "code",
                scope: "identify guilds",
                state,
                code_challenge: codeChallenge,
                code_challenge_method: "S256",
            })
            try {
                const api = await discoverProvider(deps.fetch, deps.now)
                return redirect(authorizeUrl(api, query), [
                    cookie(config, handshakeCookieName(config.origin), sealed, 600),
                ])
            } catch {
                return json({ error: "Fluxer sign-in is temporarily unavailable. Try again" }, 503)
            }
        },
        async callback(request: Request): Promise<Response> {
            const limited = await enforceRateLimit("auth", request)
            if (limited) return limited
            const handshakeName = handshakeCookieName(config.origin)
            const clear = cookie(config, handshakeName, "", 0)
            const handshake = await openHandshakeCookie(cookieValue(request, handshakeName), config)
            const params = new URL(request.url).searchParams
            const returnedState = params.get("state")
            if (
                !sameHost(request, config.origin) ||
                !handshake ||
                typeof handshake.issuedAt !== "number" ||
                deps.now() < handshake.issuedAt ||
                deps.now() - handshake.issuedAt > maxHandshakeAge ||
                returnedState === null ||
                !constantTimeEqualString(returnedState, handshake.state)
            ) {
                return redirect("/?authError=state", [clear])
            }
            const code = params.get("code")
            if (params.has("error") || !code || code.length > 256) return redirect("/?authError=denied", [clear])
            try {
                const api = await discoverProvider(deps.fetch, deps.now)
                const response = await deps.fetch(`${api}/v1/oauth2/token`, {
                    method: "POST",
                    redirect: "error",
                    signal: AbortSignal.timeout(10000),
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        grant_type: "authorization_code",
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code,
                        redirect_uri: `${config.origin}/auth/fluxer/callback`,
                        code_verifier: handshake.verifier,
                    }),
                })
                if (
                    response.status === 401 ||
                    (response.status === 400 &&
                        (
                            (await response
                                .clone()
                                .json()
                                .catch(() => ({}))) as { error?: unknown }
                        ).error === "invalid_client")
                )
                    throw new ClientMismatch()
                if (!response.ok) throw new Error("Sign-in unavailable")
                const data = (await response.json()) as {
                    access_token?: unknown
                    token_type?: unknown
                    scope?: unknown
                    refresh_token?: unknown
                    expires_in?: unknown
                }
                if (
                    typeof data.access_token !== "string" ||
                    typeof data.token_type !== "string" ||
                    data.token_type.toLowerCase() !== "bearer" ||
                    typeof data.scope !== "string"
                )
                    throw new Error("Sign-in unavailable")
                const scopes = data.scope.split(/\s+/)
                if (!["identify", "guilds"].every((scope) => scopes.includes(scope)))
                    throw new Error("Sign-in unavailable")
                const session = await deps.admit(data.access_token),
                    now = deps.now()
                // Without a refresh token the session ends when the access token stops working
                const refresh =
                    refreshToken(data.refresh_token) && expiresIn(data.expires_in)
                        ? {
                              refreshToken: data.refresh_token,
                              accessExpiresAt: now + data.expires_in * 1000,
                              session: await sessionHash(session.sessionToken),
                              until: now + sessionAge * 1000,
                          }
                        : undefined
                return redirect(safeReturnTo(handshake.returnTo), [
                    clear,
                    cookie(config, sessionCookieName(config.origin), session.sessionToken, sessionAge),
                    await refreshCookieHeader(config, refresh, now),
                ])
            } catch (error) {
                // A client secret of another application than the deployment's FLUXER_CLIENT_ID is an operator problem, not a retryable outage
                if (
                    error instanceof ClientMismatch ||
                    (error instanceof ConvexError &&
                        (error.data as { code?: unknown } | null)?.code === "OAUTH_CLIENT_MISMATCH")
                ) {
                    console.error(
                        "Fluxer refused the sign-in for this application. Set FLUXER_CLIENT_SECRET to the secret of the Convex deployment's FLUXER_CLIENT_ID application",
                    )
                    return redirect("/?authError=configuration", [clear])
                }
                return redirect("/?authError=unavailable", [clear])
            }
        },
        async session(request: Request): Promise<Response> {
            const token = cookieValue(request, sessionCookieName(config.origin))
            const limited = await enforceRateLimit("api", request, token)
            if (limited) return limited
            if (!sameOrigin(request, config.origin)) return json({ error: "Invalid website origin" }, 403)
            if (!token) return json({ user: null }, 401)
            const headers = new Headers(),
                state = await openRefreshCookie(cookieValue(request, refreshCookieName(config.origin)), config),
                now = deps.now()
            // A refresh cookie of another session or past its session's end is ignored
            if (
                state &&
                state.session === (await sessionHash(token)) &&
                state.until > now &&
                state.accessExpiresAt - now < refreshMargin
            ) {
                const outcome = await sharedRenewal(token, state)
                if ("wait" in outcome) {
                    const retryHeaders = new Headers({ "Retry-After": "1" })
                    return json({ error: "Sign-in is refreshing. Try again" }, 503, retryHeaders)
                }
                if (!("keep" in outcome)) {
                    headers.append(
                        "Set-Cookie",
                        await refreshCookieHeader(config, "state" in outcome ? outcome.state : undefined, deps.now()),
                    )
                }
            }
            try {
                const session = await deps.refresh(token)
                // Multi mode offers the bot invite. Single mode serves only its configured server
                return json(
                    {
                        ...session,
                        sessionToken: token,
                        convexUrl: config.convexUrl,
                        ...(session.mode === "multi" ? { inviteUrl: inviteUrl(config.clientId) } : {}),
                    },
                    200,
                    headers,
                )
            } catch (error) {
                if (ended(error)) return json({ error: "Session expired. Sign in again" }, 401, await signedOut(config))
                return json({ error: "Session refresh unavailable. Try again" }, 503, headers)
            }
        },
        async logout(request: Request): Promise<Response> {
            const token = cookieValue(request, sessionCookieName(config.origin))
            const limited = await enforceRateLimit("api", request, token)
            if (limited) return limited
            if (!sameOrigin(request, config.origin)) return json({ error: "Invalid website origin" }, 403)
            if (token) {
                try {
                    await deps.logout(token)
                } catch {
                    return json({ error: "Sign-out failed. Try again" }, 503)
                }
                const state = await openRefreshCookie(cookieValue(request, refreshCookieName(config.origin)), config)
                if (state && state.session === (await sessionHash(token))) await revoke(state.refreshToken)
            }
            return json({ signedOut: true }, 200, await signedOut(config))
        },
    }
}
