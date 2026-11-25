export interface SecurityHeaderOptions {
    https: boolean
    convexUrl?: string | undefined
    api?: boolean
}

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()"
const HSTS_HEADER = "max-age=31536000; includeSubDomains"

function convexConnectSources(convexUrl: string | undefined): string[] {
    if (!convexUrl) return []
    try {
        const parsed = new URL(convexUrl)
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return []
        const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:"
        return [parsed.origin, `${wsProtocol}//${parsed.host}`]
    } catch {
        return []
    }
}

/** Builds the Content-Security-Policy for HTML pages or strict API responses */
export function buildContentSecurityPolicy(options: SecurityHeaderOptions): string {
    if (options.api) return "default-src 'none'; frame-ancestors 'none'"
    const connectSources = [
        "'self'",
        "https://*.convex.cloud",
        "wss://*.convex.cloud",
        "https://challenges.cloudflare.com",
        ...convexConnectSources(options.convexUrl),
    ]
    const directives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: data:",
        "font-src 'self'",
        `connect-src ${Array.from(new Set(connectSources)).join(" ")}`,
        "frame-src https://challenges.cloudflare.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(options.https ? ["upgrade-insecure-requests"] : []),
    ]
    return directives.join("; ")
}

/** Standard HTTP security headers for SSR HTML and API responses */
export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
    return {
        "Content-Security-Policy": buildContentSecurityPolicy(options),
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Permissions-Policy": PERMISSIONS_POLICY,
        ...(options.https ? { "Strict-Transport-Security": HSTS_HEADER } : {}),
    }
}

/** Standard HTTP security and private no-store cache headers for authenticated API responses */
export function apiSecurityHeaders(origin: string): Record<string, string> {
    return {
        "Cache-Control": "private, no-store",
        ...securityHeaders({ https: origin.startsWith("https:"), api: true }),
    }
}

/** Applies security headers onto a Response without discarding already-set route-specific headers like API CSP */
export function applySecurityHeaders(response: Response, options: SecurityHeaderOptions): Response {
    const defaults = securityHeaders(options)
    const setMissing = (headers: Headers) => {
        for (const [name, value] of Object.entries(defaults)) {
            if (!headers.has(name)) headers.set(name, value)
        }
    }
    try {
        setMissing(response.headers)
        return response
    } catch {
        const headers = new Headers(response.headers)
        setMissing(headers)
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })
    }
}
