import { Data, Effect, Redacted } from "effect"
import type { BackendConfig } from "./config.ts"

export class BackendRequestError extends Data.TaggedError("BackendRequestError")<{
    readonly status: number | null
}> {}

export type BackendRequest = (path: string, body: unknown) => Effect.Effect<unknown, BackendRequestError>
// Every feature store gets the same backend configuration, so they all share this one transport
const transports = new WeakMap<BackendConfig, BackendRequest>()
export function createBackendRequest(config: BackendConfig): BackendRequest {
    let transport = transports.get(config)
    if (!transport) transports.set(config, transport = backendTransport(config))
    return transport
}
function backendTransport(config: BackendConfig): BackendRequest {
    return (path, body) => Effect.tryPromise({
        try: async (signal) => {
            const response = await fetch(new URL(path, config.siteUrl), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${Redacted.value(config.secret)}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal,
                redirect: "error",
            })
            if (!response.ok) throw new BackendRequestError({ status: response.status })
            return await response.json() as unknown
        },
        catch: (error) => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }),
    }).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError((error) => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null })),
    )
}
