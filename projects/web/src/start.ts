import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"
import type { TrustProxyMode } from "./server/rate-limit"

const csrfMiddleware = createCsrfMiddleware({
    filter: (ctx) => ctx.handlerType === "serverFn",
})

function isTrustedForwardedHttps(request: Request, trustProxy: TrustProxyMode): boolean {
    if (trustProxy === "cloudflare") {
        const visitor = request.headers.get("cf-visitor")
        if (visitor) {
            try {
                const parsed = JSON.parse(visitor) as { scheme?: unknown }
                if (typeof parsed.scheme === "string") return parsed.scheme.toLowerCase() === "https"
            } catch {}
        }
        return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https"
    }
    if (trustProxy === "forwarded") {
        const entries = (request.headers.get("x-forwarded-proto") ?? "")
            .split(",")
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean)
        return entries.at(-1) === "https"
    }
    return false
}

const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
    const [{ securityHeaderContext }, { applySecurityHeaders }] = await Promise.all([
        import("./server/auth-runtime"),
        import("./server/security-headers"),
    ])
    const result = await next()
    const { convexUrl, websiteUrl, trustProxy } = securityHeaderContext()
    const https = (websiteUrl ?? request.url).startsWith("https:") || isTrustedForwardedHttps(request, trustProxy)
    const response = applySecurityHeaders(result.response, { https, convexUrl })
    if (!response.headers.has("Cache-Control")) {
        try {
            response.headers.set("Cache-Control", "private, no-store")
        } catch {
            const headers = new Headers(response.headers)
            headers.set("Cache-Control", "private, no-store")
            return {
                ...result,
                response: new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                }),
            }
        }
    }
    return response === result.response ? result : { ...result, response }
})

export const startInstance = createStart(() => ({
    requestMiddleware: [csrfMiddleware, securityHeadersMiddleware],
}))
