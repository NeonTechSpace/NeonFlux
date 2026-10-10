import { createHmac } from "node:crypto"
import { Clock, Data, Effect, Redacted } from "effect"
import type { BackendConfig } from "./config.ts"
import { backendFunction, backendRoutes, isBackendPath } from "./backend-routes.ts"
import { convexBackendClient } from "./convex-client.ts"
import { countBackendRequest } from "./costs.ts"

export class BackendRequestError extends Data.TaggedError("BackendRequestError")<{
    readonly status: number | null
    /** The backend's stable reason for a refusal the bot explains with a fix, such as BOT_PERMISSION */
    readonly code?: string
}> {}

// The bot never sends its secret. Every backend function checks this key, an HMAC-SHA256 of a fixed versioned label keyed
// by the secret, and the backend derives the same value. Changing the label changes the key on both sides
export const serviceKeyLabel = "neonflux/bot-service-key/v1"
export function deriveServiceKey(secret: Redacted.Redacted<string>): Redacted.Redacted<string> {
    return Redacted.make(createHmac("sha256", Redacted.value(secret)).update(serviceKeyLabel).digest("hex"))
}

/** The configuration for requests that bind no server, such as installations, scope and work dispatch */
export function rootBackend(backend: BackendConfig): BackendConfig {
    return Object.freeze({ url: backend.url, secret: backend.secret, ...(backend.client ? { client: backend.client } : {}), ...(backend.onWorkDue ? { onWorkDue: backend.onWorkDue } : {}) })
}

// A mutation answers { value, dueIn }. dueIn is set when its writes created background work, in milliseconds from now
function mutationAnswer(answer: unknown): { value: unknown, dueIn?: number } {
    if (answer === null || typeof answer !== "object" || Array.isArray(answer) || !Object.keys(answer).every(key => key === "value" || key === "dueIn")) throw new Error("Malformed answer")
    const { value, dueIn } = answer as { value?: unknown, dueIn?: unknown }
    if (dueIn === undefined) return { value }
    if (typeof dueIn !== "number" || !Number.isFinite(dueIn) || dueIn < 0) throw new Error("Malformed answer")
    return { value, dueIn }
}

// A failure the backend reported on purpose carries a status, a fixed message and the scope denial code or a reason code. Anything else,
// such as a lost connection or a timeout, has no status because the request may or may not have run
function reported(error: unknown): { status: number, code?: unknown } | undefined {
    const data: unknown = error !== null && typeof error === "object" && "data" in error ? error.data : undefined
    if (data === null || typeof data !== "object") return undefined
    const { status, error: message, code } = data as { status?: unknown, error?: unknown, code?: unknown }
    return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 && typeof message === "string" ? { status, code } : undefined
}

// One backend request: the public function for the path, called with the derived key, the bound server and the body.
// Server runtimes bind every request to their server, and a retired runtime sends nothing. When a mutation's writes
// created background work, onWorkDue learns when it becomes due, on this process's clock
export function createBackendRequest(config: BackendConfig) {
    const client = config.client ?? convexBackendClient(config.url), key = deriveServiceKey(config.secret)
    return (path: string, body: unknown) => Effect.tryPromise({
        try: async (signal) => {
            if (config.isActive && !config.isActive()) throw new BackendRequestError({ status: 403 })
            if (config.serverId !== undefined && (!body || typeof body !== "object" || !("serverId" in body) || body.serverId !== config.serverId)) throw new BackendRequestError({ status: 403 })
            if (!isBackendPath(path)) throw new BackendRequestError({ status: 404 })
            countBackendRequest(path)
            // The backend receives the same JSON values the former HTTP routes parsed
            const request: unknown = JSON.parse(JSON.stringify(body))
            const args = { key: Redacted.value(key), ...(config.serverId ? { serverId: config.serverId } : {}), request }
            let answer: unknown
            try {
                answer = backendRoutes[path] === "query" ? await client.query(backendFunction(path), args, signal) : await client.mutation(backendFunction(path), args, signal)
            } catch (error) {
                const failure = reported(error)
                if (!failure) throw error
                if (failure.status === 403 && failure.code === "NEONFLUX_SCOPE_DENIED") config.onScopeDenied?.()
                throw new BackendRequestError({ status: failure.status, ...(typeof failure.code === "string" ? { code: failure.code } : {}) })
            }
            return backendRoutes[path] === "query" ? { value: answer } : mutationAnswer(answer)
        },
        catch: (error) => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }),
    }).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError((error) => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null })),
        Effect.tap(({ dueIn }) => dueIn === undefined || !config.onWorkDue ? Effect.void
            : Clock.currentTimeMillis.pipe(Effect.map(now => config.onWorkDue!(now + dueIn)))),
        Effect.map(({ value }): unknown => value),
    )
}
