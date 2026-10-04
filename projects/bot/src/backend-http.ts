import { createHmac } from "node:crypto"
import { Clock, Data, Effect, Redacted, Schema } from "effect"
import { SERVICE_KEY_LABEL, ServiceMutationResult } from "@neonflux/contracts/service"
import type { BackendConfig } from "./config.ts"
import { backendFunction, backendKind, isBackendPath } from "./backend-routes.ts"
import { convexBackendClient } from "./convex-client.ts"

export class BackendRequestError extends Data.TaggedError("BackendRequestError")<{
    readonly status: number | null
    /** The backend's stable reason for a refusal the bot explains with a fix, such as BOT_PERMISSION */
    readonly code?: string
    /** The sentence of a REFUSED refusal, written for members */
    readonly reason?: string
}> {}

/** What a store keeps of a failed request: the status, the reason code and the sentence of a REFUSED refusal */
export function failureFields(error: object) {
    return {
        status: "status" in error && typeof error.status === "number" ? error.status : null,
        ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}),
        ...("reason" in error && typeof error.reason === "string" ? { reason: error.reason } : {}),
    }
}
/** The member-facing sentence the backend gave for a refusal, if it gave one */
export const refusedReason = (error: { readonly code?: string | undefined; readonly reason?: string | undefined }) =>
    error.code === "REFUSED" ? error.reason : undefined

// The bot never sends its secret. Every backend function checks this key, an HMAC-SHA256 of the shared versioned label keyed
// by the secret, and the backend derives the same value. Each secret's key is derived once for the whole process
const keys = new WeakMap<Redacted.Redacted<string>, Redacted.Redacted<string>>()
export function deriveServiceKey(secret: Redacted.Redacted<string>): Redacted.Redacted<string> {
    let key = keys.get(secret)
    if (!key)
        keys.set(
            secret,
            (key = Redacted.make(createHmac("sha256", Redacted.value(secret)).update(SERVICE_KEY_LABEL).digest("hex"))),
        )
    return key
}

// A mutation answers { value, dueIn }. dueIn is set when its writes created background work, in milliseconds from now
const mutationAnswer = Schema.decodeUnknownSync(ServiceMutationResult(Schema.Unknown), { onExcessProperty: "error" })

// A failure the backend reported on purpose carries a status, a fixed message and the scope denial code or a reason code. Anything else,
// such as a lost connection or a timeout, has no status because the request may or may not have run
function reported(error: unknown): { status: number; code?: unknown; message: string } | undefined {
    const data: unknown = error !== null && typeof error === "object" && "data" in error ? error.data : undefined
    if (data === null || typeof data !== "object") return undefined
    const { status, error: message, code } = data as { status?: unknown; error?: unknown; code?: unknown }
    return typeof status === "number" &&
        Number.isInteger(status) &&
        status >= 400 &&
        status <= 599 &&
        typeof message === "string"
        ? { status, code, message }
        : undefined
}

// One backend request: the public function for the path, called with the derived key, the bound server and the body.
// Server runtimes bind every request to their server, and a retired runtime sends nothing. When a mutation's writes
// created background work, onWorkDue learns when it becomes due, on this process's clock
type BackendRequest = (path: string, body: unknown) => Effect.Effect<unknown, BackendRequestError>
// A server runtime hands one frozen configuration to every feature store, so they all share this one transport
const transports = new WeakMap<BackendConfig, BackendRequest>()
export function createBackendRequest(config: BackendConfig): BackendRequest {
    let transport = transports.get(config)
    if (!transport) transports.set(config, (transport = backendTransport(config)))
    return transport
}
function backendTransport(config: BackendConfig): BackendRequest {
    const client = config.client ?? convexBackendClient(config.url),
        key = deriveServiceKey(config.secret)
    return (path, body) =>
        Effect.tryPromise({
            try: async (signal) => {
                if (config.isActive && !config.isActive()) throw new BackendRequestError({ status: 403 })
                if (
                    config.serverId !== undefined &&
                    (!body || typeof body !== "object" || !("serverId" in body) || body.serverId !== config.serverId)
                )
                    throw new BackendRequestError({ status: 403 })
                // A path outside the table is a bug in the bot, not a backend answer, so it fails like a broken reply
                if (!isBackendPath(path)) throw new Error("Unknown backend request")
                const kind = backendKind(path),
                    args = {
                        key: Redacted.value(key),
                        ...(config.serverId ? { serverId: config.serverId } : {}),
                        request: body,
                    }
                let answer: unknown
                try {
                    answer =
                        kind === "query"
                            ? await client.query(backendFunction(path), args, signal)
                            : await client.mutation(backendFunction(path), args, signal)
                } catch (error) {
                    const failure = reported(error)
                    if (!failure) throw error
                    if (failure.status === 403 && failure.code === "NEONFLUX_SCOPE_DENIED") config.onScopeDenied?.()
                    throw new BackendRequestError({
                        status: failure.status,
                        ...(typeof failure.code === "string" ? { code: failure.code } : {}),
                        ...(failure.code === "REFUSED" ? { reason: failure.message } : {}),
                    })
                }
                return kind === "query" ? { value: answer } : mutationAnswer(answer)
            },
            catch: (error) =>
                error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }),
        }).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError((error) =>
                error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }),
            ),
            Effect.tap(({ dueIn }) =>
                dueIn === undefined || !config.onWorkDue
                    ? Effect.void
                    : Clock.currentTimeMillis.pipe(Effect.map((now) => config.onWorkDue!(now + dueIn))),
            ),
            Effect.map(({ value }): unknown => value),
        )
}
