import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    hkdfSync,
    randomBytes,
    timingSafeEqual,
} from "node:crypto"
import type { DashboardSession } from "@neonflux/backend/dashboard-contracts"
import { ConvexError } from "convex/values"
import { inviteUrl } from "./invite.ts"

export interface AuthConfig {
    origin: string
    clientId: string
    clientSecret: string
    convexUrl: string
    sessionSecret: string
}
export interface AuthDependencies {
    config: AuthConfig
    fetch: typeof fetch
    now: () => number
    admit: (accessToken: string) => Promise<DashboardSession>
    refresh: (sessionToken: string) => Promise<DashboardSession>
    rotate: (sessionToken: string, accessToken: string) => Promise<unknown>
    logout: (sessionToken: string) => Promise<unknown>
}
const sessionCookie = "neonflux_session"
const handshakeCookie = "neonflux_oauth"
const refreshCookie = "neonflux_refresh"
const maxHandshakeAge = 10 * 60 * 1000
// The backend ends a session at the latest 90 days after sign-in, so neither cookie outlives it
const sessionAge = 90 * 86400
// The access token is renewed once less than this remains, so it never runs out while the dashboard is in use
const refreshMargin = 3600 * 1000
const privateHeaders = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
class ClientMismatch extends Error {}

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
    return sameHost(request, origin) && request.headers.get("origin") === origin
}
function cookie(config: AuthConfig, name: string, value: string, maxAge: number): string {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.origin.startsWith("https:") ? "; Secure" : ""}`
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
const sessionHash = (sessionToken: string) => createHash("sha256").update(sessionToken).digest("hex")
const refreshKey = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "", "neonflux refresh cookie", 32))
// Browsers keep a cookie only while its name and value together stay within 4096 bytes, so that is the only bound on a refresh
// token: One whose encrypted state does not fit gets no cookie, and the session then ends when its access token does
const maxRefreshValue = 4096 - `${refreshCookie}=`.length
function refreshCookieHeader(config: AuthConfig, state: RefreshState | undefined, now: number): string {
    let value = "",
        maxAge = 0
    if (state) {
        const iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", refreshKey(config.sessionSecret), iv)
        const data = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()])
        const sealed = Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")
        // A rotated token that does not fit replaced the stored one at Fluxer, so the cookie is cleared rather than kept
        if (sealed.length <= maxRefreshValue) {
            value = sealed
            maxAge = Math.max(0, Math.floor((state.until - now) / 1000))
        }
    }
    return `${refreshCookie}=${value}; Path=/api/session; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.origin.startsWith("https:") ? "; Secure" : ""}`
}
function openRefreshCookie(raw: string | undefined, config: AuthConfig): RefreshState | undefined {
    if (!raw || raw.length > maxRefreshValue || !/^[\w-]+$/.test(raw)) return
    const bytes = Buffer.from(raw, "base64url")
    if (bytes.length <= 28) return
    try {
        const decipher = createDecipheriv("aes-256-gcm", refreshKey(config.sessionSecret), bytes.subarray(0, 12))
        decipher.setAuthTag(bytes.subarray(12, 28))
        const state = JSON.parse(
            Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
        ) as Partial<RefreshState>
        return refreshToken(state.refreshToken) &&
            Number.isSafeInteger(state.accessExpiresAt) &&
            typeof state.session === "string" &&
            Number.isSafeInteger(state.until)
            ? (state as RefreshState)
            : undefined
    } catch {
        return
    }
}
const refreshToken = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && !/\s/.test(value)
const expiresIn = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
/** Keep the cookie, store this state in it, or clear it */
type RefreshOutcome = { keep: true } | { state: RefreshState } | { clear: true }
// One refresh per refresh token in this process. Fluxer replaces the refresh token on use, so a second request with the
// same cookie shares the first one's outcome, also when it arrives within a minute after the first finished
const refreshes = new Map<string, { outcome: Promise<RefreshOutcome>; settledAt?: number }>()
const sharedRefreshMs = 60 * 1000

function signature(value: string, secret: string): string {
    return createHmac("sha256", secret).update(value).digest("base64url")
}
function decodeHandshake(
    raw: string | undefined,
    config: AuthConfig,
): { state: string; verifier: string; issuedAt: number; returnTo: string } | undefined {
    if (!raw || raw.length > 4096) return
    const [value, mac, extra] = raw.split(".")
    if (!value || !mac || extra || !/^[\w-]+$/.test(mac)) return
    const supplied = Buffer.from(mac, "base64url"),
        expected = Buffer.from(signature(value, config.sessionSecret), "base64url")
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return
    try {
        return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    } catch {
        return
    }
}
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
export async function discoverProvider(fetcher: typeof fetch): Promise<string> {
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
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        throw new Error("Provider discovery unavailable")
    return api.replace(/\/$/, "")
}
// The backend refused the session itself, so it has ended
const ended = (error: unknown) =>
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "status" in error.data &&
    (error.data.status === 401 || error.data.status === 403)
function signedOut(config: AuthConfig): Headers {
    const headers = new Headers()
    headers.append("Set-Cookie", cookie(config, sessionCookie, "", 0))
    headers.append("Set-Cookie", refreshCookieHeader(config, undefined, 0))
    return headers
}

export function createAuthHandlers(deps: AuthDependencies) {
    const { config } = deps
    const json = (data: unknown, status = 200, extra: HeadersInit = {}) => {
        const headers = new Headers(privateHeaders)
        new Headers(extra).forEach((value, name) => headers.append(name, value))
        return Response.json(data, { status, headers })
    }
    const redirect = (location: string, cookies: string[]) => {
        const headers = new Headers({ ...privateHeaders, Location: location })
        for (const value of cookies) headers.append("Set-Cookie", value)
        return new Response(null, { status: 303, headers })
    }
    // Asks Fluxer for a new access token and hands it to the backend. An outcome that is not known is never repeated
    async function renewAccess(sessionToken: string, state: RefreshState): Promise<RefreshOutcome> {
        let api: string
        try {
            api = await discoverProvider(deps.fetch)
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
            const api = await discoverProvider(deps.fetch)
            await deps.fetch(`${api}/v1/oauth2/token/revoke`, {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(5000),
                headers: {
                    Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
            })
        } catch {}
    }
    function sharedRenewal(sessionToken: string, state: RefreshState): Promise<RefreshOutcome> {
        const now = deps.now()
        for (const [key, entry] of refreshes)
            if (entry.settledAt !== undefined && now - entry.settledAt > sharedRefreshMs) refreshes.delete(key)
        const key = sessionHash(`${state.session} ${state.refreshToken}`),
            found = refreshes.get(key)
        if (found) return found.outcome
        const entry: { outcome: Promise<RefreshOutcome>; settledAt?: number } = {
            outcome: renewAccess(sessionToken, state).finally(() => {
                entry.settledAt = deps.now()
            }),
        }
        refreshes.set(key, entry)
        return entry.outcome
    }
    return {
        async begin(request: Request): Promise<Response> {
            if (!sameHost(request, config.origin)) return json({ error: "Invalid website origin" }, 400)
            const state = randomBytes(32).toString("base64url"),
                verifier = randomBytes(32).toString("base64url")
            const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"))
            const value = Buffer.from(JSON.stringify({ state, verifier, returnTo, issuedAt: deps.now() })).toString(
                "base64url",
            )
            const query = new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: `${config.origin}/auth/fluxer/callback`,
                response_type: "code",
                scope: "identify guilds",
                state,
                code_challenge: createHash("sha256").update(verifier).digest("base64url"),
                code_challenge_method: "S256",
            })
            try {
                const api = await discoverProvider(deps.fetch)
                return redirect(authorizeUrl(api, query), [
                    cookie(config, handshakeCookie, `${value}.${signature(value, config.sessionSecret)}`, 600),
                ])
            } catch {
                return json({ error: "Fluxer sign-in is temporarily unavailable. Try again" }, 503)
            }
        },
        async callback(request: Request): Promise<Response> {
            const clear = cookie(config, handshakeCookie, "", 0)
            const handshake = decodeHandshake(cookieValue(request, handshakeCookie), config)
            const params = new URL(request.url).searchParams
            if (
                !sameHost(request, config.origin) ||
                !handshake ||
                typeof handshake.issuedAt !== "number" ||
                deps.now() < handshake.issuedAt ||
                deps.now() - handshake.issuedAt > maxHandshakeAge ||
                params.get("state") !== handshake.state
            ) {
                return redirect("/?authError=state", [clear])
            }
            const code = params.get("code")
            if (params.has("error") || !code || code.length > 256) return redirect("/?authError=denied", [clear])
            try {
                const api = await discoverProvider(deps.fetch)
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
                              session: sessionHash(session.sessionToken),
                              until: now + sessionAge * 1000,
                          }
                        : undefined
                return redirect(safeReturnTo(handshake.returnTo), [
                    clear,
                    cookie(config, sessionCookie, session.sessionToken, sessionAge),
                    refreshCookieHeader(config, refresh, now),
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
            if (!sameOrigin(request, config.origin)) return json({ error: "Invalid website origin" }, 403)
            const token = cookieValue(request)
            if (!token) return json({ user: null }, 401)
            const headers = new Headers(),
                state = openRefreshCookie(cookieValue(request, refreshCookie), config),
                now = deps.now()
            // A refresh cookie of another session or past its session's end is ignored
            if (
                state &&
                state.session === sessionHash(token) &&
                state.until > now &&
                state.accessExpiresAt - now < refreshMargin
            ) {
                const outcome = await sharedRenewal(token, state)
                if (!("keep" in outcome))
                    headers.append(
                        "Set-Cookie",
                        refreshCookieHeader(config, "state" in outcome ? outcome.state : undefined, deps.now()),
                    )
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
                if (ended(error)) return json({ error: "Session expired. Sign in again" }, 401, signedOut(config))
                return json({ error: "Session refresh unavailable. Try again" }, 503, headers)
            }
        },
        async logout(request: Request): Promise<Response> {
            if (!sameOrigin(request, config.origin)) return json({ error: "Invalid website origin" }, 403)
            const token = cookieValue(request)
            if (token) {
                try {
                    await deps.logout(token)
                } catch {
                    return json({ error: "Sign-out failed. Try again" }, 503)
                }
                const state = openRefreshCookie(cookieValue(request, refreshCookie), config)
                if (state && state.session === sessionHash(token)) await revoke(state.refreshToken)
            }
            return json({ signedOut: true }, 200, signedOut(config))
        },
    }
}
