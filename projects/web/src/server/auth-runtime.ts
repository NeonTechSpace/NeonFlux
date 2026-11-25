import { ConvexHttpClient } from "convex/browser"
import type { DashboardWebConfig } from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "../dashboard-api.ts"
import { createAuthHandlers, createDefaultAuthRateLimiters, type AuthConfig } from "./auth.ts"
import { parseTrustProxyMode, type TrustProxyMode } from "./rate-limit.ts"
import { apiSecurityHeaders } from "./security-headers.ts"

/** The web server's own settings. The Convex deployment owns the website origin and the OAuth application ID */
interface WebSettings {
    convexUrl: string
    clientSecret: string
    sessionSecret: string
    turnstileSiteKey: string
    trustProxy: TrustProxyMode
}
/** Reads the web environment. Problems name variables, never their values */
export function readWebSettings(env: Readonly<Record<string, string | undefined>>): {
    settings?: WebSettings
    problems: string[]
} {
    const value = (name: string) => env[name]?.trim() ?? ""
    const convexUrl = value("CONVEX_URL"),
        clientSecret = value("FLUXER_CLIENT_SECRET"),
        sessionSecret = value("WEB_SESSION_SECRET")
    const problems = [
        ...(URL.canParse(convexUrl) ? [] : ["Set CONVEX_URL to the Convex deployment URL"]),
        ...(clientSecret ? [] : ["Set FLUXER_CLIENT_SECRET to the Fluxer OAuth client secret"]),
        ...(sessionSecret.length >= 32 ? [] : ["Set WEB_SESSION_SECRET to at least 32 random bytes"]),
    ]
    return {
        ...(problems.length
            ? {}
            : {
                  settings: {
                      convexUrl,
                      clientSecret,
                      sessionSecret,
                      turnstileSiteKey: value("TURNSTILE_SITE_KEY"),
                      trustProxy: parseTrustProxyMode(env.TRUST_PROXY),
                  },
              }),
        problems,
    }
}

/** Reads string environment variables from Node process.env and Cloudflare Workers request env bindings */
export function runtimeEnv(): Readonly<Record<string, string | undefined>> {
    const combined: Record<string, string | undefined> = {}
    if (typeof process !== "undefined" && process.env) {
        for (const [key, value] of Object.entries(process.env)) {
            if (typeof value === "string") combined[key] = value
        }
    }
    const cfEnv = (globalThis as { __env__?: unknown }).__env__
    if (cfEnv && typeof cfEnv === "object") {
        for (const [key, value] of Object.entries(cfEnv as Record<string, unknown>)) {
            if (typeof value === "string") combined[key] = value
        }
    }
    return combined
}

type ResolvedDeployment = DashboardWebConfig & { websiteUrl: string }

let loggedProblemsKey: string | undefined
// Cache only resolved plain deployment config keyed by CONVEX_URL, never an in-flight Promise or shared HTTP client,
// so Cloudflare Workers isolates pick up rotated secrets/bindings immediately and never share I/O across requests
let cachedDeployment: { convexUrl: string; deployment: ResolvedDeployment } | undefined

/** Clears cached deployment metadata, mainly for deterministic tests */
export function resetWebRuntimeCache(): void {
    loggedProblemsKey = undefined
    cachedDeployment = undefined
}

function currentSettings(): WebSettings | undefined {
    const parsed = readWebSettings(runtimeEnv())
    if (parsed.settings) {
        loggedProblemsKey = undefined
        return parsed.settings
    }
    const key = parsed.problems.join("\n")
    if (key && key !== loggedProblemsKey) {
        loggedProblemsKey = key
        for (const problem of parsed.problems) console.error(problem)
    }
    return undefined
}

// Process-scoped or isolate-scoped rate limiters shared across requests on this web server
const authRateLimiters = createDefaultAuthRateLimiters()

interface WebRuntime {
    settings: WebSettings
    client: ConvexHttpClient
    /** The deployment's website origin and OAuth application ID, cached per CONVEX_URL once resolved */
    deployment: ResolvedDeployment
}
/** The web server's current settings, an isolated per-request Convex HTTP client, and the deployment's public website settings */
export async function webRuntime(): Promise<WebRuntime> {
    const settings = currentSettings()
    if (!settings) throw new Error("Website not configured")
    const client = new ConvexHttpClient(settings.convexUrl)
    if (cachedDeployment && cachedDeployment.convexUrl === settings.convexUrl) {
        return { settings, client, deployment: cachedDeployment.deployment }
    }
    try {
        const deployment = await client.query(dashboardApi.webConfig, {}).catch(() => {
            throw new Error(
                "The Convex deployment's website settings could not be read. Check CONVEX_URL, and FLUXER_CLIENT_ID and NEONFLUX_WEBSITE_URL in the deployment's logs",
            )
        })
        if (!deployment.websiteUrl)
            throw new Error("Set NEONFLUX_WEBSITE_URL in the Convex deployment to the website origin")
        const resolved: ResolvedDeployment = { ...deployment, websiteUrl: deployment.websiteUrl }
        cachedDeployment = { convexUrl: settings.convexUrl, deployment: resolved }
        return { settings, client, deployment: resolved }
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : "Website settings could not be read")
        throw error
    }
}

/** Non-blocking snapshot of the server's live Convex URL, website origin, and proxy mode for response security headers */
export function securityHeaderContext(): {
    convexUrl?: string | undefined
    websiteUrl?: string | undefined
    trustProxy: TrustProxyMode
} {
    const env = runtimeEnv()
    const convexUrl = env.CONVEX_URL?.trim() || undefined
    const envWebsiteUrl = env.NEONFLUX_WEBSITE_URL?.trim() || undefined
    const cachedOrigin =
        convexUrl && cachedDeployment?.convexUrl === convexUrl ? cachedDeployment.deployment.websiteUrl : undefined
    return {
        convexUrl,
        websiteUrl: envWebsiteUrl ?? cachedOrigin,
        trustProxy: parseTrustProxyMode(env.TRUST_PROXY),
    }
}

function authConfig({ settings, deployment }: WebRuntime): AuthConfig {
    return {
        origin: deployment.websiteUrl,
        clientId: deployment.clientId,
        clientSecret: settings.clientSecret,
        convexUrl: settings.convexUrl,
        sessionSecret: settings.sessionSecret,
        trustProxy: settings.trustProxy,
    }
}
export async function authRoute(
    handler: "begin" | "callback" | "session" | "logout",
    request: Request,
): Promise<Response> {
    let current: WebRuntime
    try {
        current = await webRuntime()
    } catch {
        const origin = securityHeaderContext().websiteUrl ?? request.url
        return Response.json(
            { error: "Website authentication is not configured" },
            { status: 503, headers: apiSecurityHeaders(origin) },
        )
    }
    const { client } = current
    return createAuthHandlers({
        config: authConfig(current),
        fetch,
        now: Date.now,
        admit: (accessToken) => client.action(dashboardApi.admit, { accessToken }),
        refresh: (sessionToken) => client.action(dashboardApi.refresh, { sessionToken }),
        rotate: (sessionToken, accessToken) => client.action(dashboardApi.rotate, { sessionToken, accessToken }),
        logout: (sessionToken) => client.mutation(dashboardApi.logout, { sessionToken }),
        rateLimiters: authRateLimiters,
    })[handler](request)
}
