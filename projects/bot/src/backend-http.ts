import { Data, Effect, Redacted } from "effect"
import type { BackendConfig } from "./config.ts"

export class BackendRequestError extends Data.TaggedError("BackendRequestError")<{
    readonly status: number | null
}> {}

export function createBackendRequest(config: BackendConfig) {
    return (path: string, body: unknown) => Effect.tryPromise({
        try: async (signal) => {
            if (config.isActive && !config.isActive()) throw new BackendRequestError({ status: 403 })
            if (config.serverId !== undefined && (!body || typeof body !== "object" || !("serverId" in body) || body.serverId !== config.serverId)) throw new BackendRequestError({ status: 403 })
            const response = await fetch(new URL(path, config.siteUrl), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${Redacted.value(config.secret)}`,
                    "Content-Type": "application/json",
                    ...(config.serverId ? { "X-NeonFlux-Server-ID": config.serverId } : {}),
                },
                body: JSON.stringify(body),
                signal,
                redirect: "error",
            })
            if (!response.ok) {
                if (response.status === 403) {
                    const error: unknown = await response.json().catch(() => undefined)
                    if (error && typeof error === "object" && "code" in error && error.code === "NEONFLUX_SCOPE_DENIED") config.onScopeDenied?.()
                }
                throw new BackendRequestError({ status: response.status })
            }
            return await response.json() as unknown
        },
        catch: (error) => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }),
    }).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError((error) => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null })),
    )
}
