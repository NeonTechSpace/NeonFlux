import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"

const csrfMiddleware = createCsrfMiddleware({
    filter: (ctx) => ctx.handlerType === "serverFn",
})

const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
    const [{ securityHeaderContext }, { applySecurityHeaders }] = await Promise.all([
        import("./server/auth-runtime"),
        import("./server/security-headers"),
    ])
    const result = await next()
    const { convexUrl, websiteUrl } = securityHeaderContext()
    const https = (websiteUrl ?? request.url).startsWith("https:")
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
