import type { ConvexReactClient } from "convex/react"
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server"
import { useEffect, useState } from "react"

const LIVE_CACHE_TTL_MS = 2 * 60 * 1000
const MAX_CACHED_QUERIES_PER_CLIENT = 64

type QueryCache = Map<string, { data: unknown; at: number }>
const liveCaches = new WeakMap<ConvexReactClient, QueryCache>()

function queryCacheKey(query: FunctionReference<"query">, argsKey: string): string | undefined {
    try {
        return `${getFunctionName(query)}:${argsKey}`
    } catch {
        return undefined
    }
}
function readCachedQuery<T>(client: ConvexReactClient, cacheKey: string | undefined): T | undefined {
    if (!cacheKey) return undefined
    const cache = liveCaches.get(client)
    const entry = cache?.get(cacheKey)
    if (!entry) return undefined
    if (Date.now() - entry.at > LIVE_CACHE_TTL_MS) {
        cache?.delete(cacheKey)
        return undefined
    }
    return entry.data as T
}
function writeCachedQuery(client: ConvexReactClient, cacheKey: string | undefined, data: unknown): void {
    if (!cacheKey) return
    let cache = liveCaches.get(client)
    if (!cache) {
        cache = new Map()
        liveCaches.set(client, cache)
    }
    cache.delete(cacheKey)
    cache.set(cacheKey, { data, at: Date.now() })
    while (cache.size > MAX_CACHED_QUERIES_PER_CLIENT) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
    }
}
function dropCachedQuery(client: ConvexReactClient, cacheKey: string | undefined): void {
    if (!cacheKey) return
    liveCaches.get(client)?.delete(cacheKey)
}
/** Drops all cached live-query snapshots for a client, called on sign-out or session change */
export function clearLiveQueryCache(client: ConvexReactClient): void {
    liveCaches.delete(client)
}

function sessionScopeOf(args: unknown): string {
    if (!args || typeof args !== "object") return ""
    const token = (args as { sessionToken?: unknown }).sessionToken
    return typeof token === "string" ? token : ""
}

/** One live Convex subscription for as long as the component is mounted and args is set. Passing undefined subscribes to nothing.
 *  Recently received snapshots stay warm in a client-scoped SWR cache so switching sections paints immediately without waiting.
 *  When args change within the same signed-in session, the previous result stays until the new one arrives, and current reports whether data matches args.
 *  Changing or clearing sessionToken drops previous data immediately so another account's rows are never shown */
export function useLiveQuery<Query extends FunctionReference<"query">>(
    client: ConvexReactClient,
    query: Query,
    args: FunctionArgs<Query> | undefined,
) {
    const key = args === undefined ? "" : JSON.stringify(args)
    const sessionScope = args === undefined ? "" : sessionScopeOf(args)
    const cacheKey = args === undefined ? undefined : queryCacheKey(query, key)
    const [state, setState] = useState<{
        key: string
        sessionScope: string
        data?: FunctionReturnType<Query>
        fresh: boolean
        error: boolean
    }>(() => {
        const cached = readCachedQuery<FunctionReturnType<Query>>(client, cacheKey)
        return cached !== undefined
            ? { key, sessionScope, data: cached, fresh: false, error: false }
            : { key: "", sessionScope, fresh: false, error: false }
    })
    useEffect(() => {
        if (args === undefined) {
            setState((current) =>
                current.data === undefined && !current.error && current.key === ""
                    ? current
                    : { key: "", sessionScope: "", fresh: false, error: false },
            )
            return
        }
        const cached = readCachedQuery<FunctionReturnType<Query>>(client, cacheKey)
        if (cached !== undefined) {
            setState((current) =>
                current.key === key && current.sessionScope === sessionScope && current.data === cached
                    ? current
                    : { key, sessionScope, data: cached, fresh: false, error: false },
            )
        } else {
            setState((current) =>
                current.sessionScope === sessionScope ? current : { key: "", sessionScope, fresh: false, error: false },
            )
        }
        const watch = client.watchQuery(query, args)
        const update = () => {
            try {
                const result = watch.localQueryResult()
                if (result !== undefined) {
                    writeCachedQuery(client, cacheKey, result)
                    setState({ key, sessionScope, data: result, fresh: true, error: false })
                }
            } catch {
                dropCachedQuery(client, cacheKey)
                setState((current) => ({ ...current, sessionScope, fresh: false, error: true }))
            }
        }
        const unsubscribe = watch.onUpdate(update)
        update()
        return unsubscribe
    }, [client, key, sessionScope, cacheKey])
    const sameSession = args !== undefined && state.sessionScope === sessionScope
    return {
        data: sameSession ? state.data : undefined,
        error: sameSession ? state.error : false,
        current: sameSession && state.key === key && state.data !== undefined,
        fresh: sameSession && state.key === key && state.fresh && state.data !== undefined,
    }
}
