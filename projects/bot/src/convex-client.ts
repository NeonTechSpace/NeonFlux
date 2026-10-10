import { ConvexClient, ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import type { BackendClient } from "./config.ts"

// The production backend client. Requests use Convex's HTTP client, one per request so each carries its own abort signal.
// Mutations skip that client's queue, so requests for different servers run in parallel as before. A WebSocket client
// would run every mutation of this process one after another. Only the work signal subscription uses the WebSocket client
export function convexBackendClient(url: string): BackendClient {
    const http = (signal: AbortSignal) => new ConvexHttpClient(url, { logger: false, fetch: (input, init) => fetch(input, { ...init, signal, redirect: "error" }) })
    return {
        query: (name, args, signal) => http(signal).query(makeFunctionReference<"query">(name), args),
        mutation: (name, args, signal) => http(signal).mutation(makeFunctionReference<"mutation">(name), args, { skipQueue: true }),
        subscribe: (name, args, onValue, onError) => {
            const client = new ConvexClient(url, { logger: false, unsavedChangesWarning: false })
            const stop = client.onUpdate(makeFunctionReference<"query">(name), args, onValue, onError)
            return () => {
                stop()
                void client.close()
            }
        },
    }
}
