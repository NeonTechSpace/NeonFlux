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

// Read once when the server loads its routes, so a configuration problem is logged at start and not on every request
const environment = readWebSettings(process.env)
for (const problem of environment.problems) console.error(problem)

// Process-scoped rate limiters shared across requests on this web server
const authRateLimiters = createDefaultAuthRateLimiters()

interface WebRuntime {
    settings: WebSettings
    client: ConvexHttpClient
    /** The deployment's website origin and OAuth application ID, read once and kept */
    deployment: DashboardWebConfig & { websiteUrl: string }
}
let runtime: Promise<WebRuntime> | undefined
let cachedWebsiteUrl: string | undefined
/** The web server's settings and the deployment's public website settings. A failed read is retried by the next request */
export function webRuntime(): Promise<WebRuntime> {
    const settings = environment.settings
    if (!settings) return Promise.reject(new Error("Website not configured"))
    runtime ??= (async () => {
        const client = new ConvexHttpClient(settings.convexUrl)
        const deployment = await client.query(dashboardApi.webConfig, {}).catch(() => {
            throw new Error(
                "The Convex deployment's website settings could not be read. Check CONVEX_URL, and FLUXER_CLIENT_ID and NEONFLUX_WEBSITE_URL in the deployment's logs",
            )
        })
        if (!deployment.websiteUrl)
            throw new Error("Set NEONFLUX_WEBSITE_URL in the Convex deployment to the website origin")
        cachedWebsiteUrl = deployment.websiteUrl
        return { settings, client, deployment: { ...deployment, websiteUrl: deployment.websiteUrl } }
    })().catch((error: unknown) => {
        runtime = undefined
        console.error(error instanceof Error ? error.message : "Website settings could not be read")
        throw error
    })
    return runtime
}
// Warm the deployment website origin once on server start so initial SSR responses know HTTPS behind a TLS proxy
if (environment.settings) void webRuntime().catch(() => {})

/** Non-blocking snapshot of the server's Convex URL and known website origin for response security headers */
export function securityHeaderContext(): { convexUrl?: string | undefined; websiteUrl?: string | undefined } {
    return {
        convexUrl: environment.settings?.convexUrl ?? (process.env.CONVEX_URL?.trim() || undefined),
        websiteUrl: cachedWebsiteUrl ?? (process.env.NEONFLUX_WEBSITE_URL?.trim() || undefined),
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
