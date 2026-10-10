import type { Client, Observation } from "@neontechspace/fluxerly/effect"
import { Duration, Effect } from "effect"

/** Process-wide request and event totals since startup, read by the periodic summary and status commands */
export interface CostTotals {
    /** Fluxer REST attempts, retries included */
    readonly fluxerRequests: number
    readonly fluxerRetries: number
    /** Fluxer REST attempts without a response or with an error status */
    readonly fluxerFailures: number
    readonly rateLimitWaits: number
    readonly rateLimitWaitMs: number
    /** Backend function calls the bot caused: the requests it sent and the work signal updates it received */
    readonly backendRequests: number
    /** Event handler invocations */
    readonly events: number
    /** Events a full handler queue dropped, and events a starting server dropped from its full backlog */
    readonly eventsDropped: number
    /** Gateway dispatches the SDK rejected as malformed */
    readonly eventsMalformed: number
    /** Requests per Fluxer route template, such as "GET /guilds/:id/members/:id" */
    readonly fluxerRoutes: Readonly<Record<string, number>>
    /** Requests per backend path */
    readonly backendPaths: Readonly<Record<string, number>>
    /** Handler invocations per event name */
    readonly eventCounts: Readonly<Record<string, number>>
}

// Counting costs a few integer increments per request or event. Keys are route templates, backend paths and event
// names, all bounded sets, and the cap only guards against an unexpected unbounded key
const KEY_LIMIT = 256
const totals = { fluxerRequests: 0, fluxerRetries: 0, fluxerFailures: 0, rateLimitWaits: 0, rateLimitWaitMs: 0, backendRequests: 0, events: 0 }
let heldDropped = 0
const fluxerRoutes = new Map<string, number>(), backendPaths = new Map<string, number>(), eventCounts = new Map<string, number>()
const increment = (map: Map<string, number>, key: string) => {
    if (map.size >= KEY_LIMIT && !map.has(key)) key = "other"
    map.set(key, (map.get(key) ?? 0) + 1)
}

/** The client's observe hook. It runs synchronously inside the SDK, so it only counts */
export function observeCosts(observation: Observation) {
    if (observation.type === "rest") {
        totals.fluxerRequests++
        if (observation.attempt > 1) totals.fluxerRetries++
        if (observation.status === null || observation.status >= 400) totals.fluxerFailures++
        increment(fluxerRoutes, `${observation.method} ${observation.route}`)
    } else if (observation.type === "rateLimit") {
        totals.rateLimitWaits++
        totals.rateLimitWaitMs += observation.waitMs
    } else if (observation.type === "handler") {
        totals.events++
        increment(eventCounts, observation.event)
    }
}

/** Counts one backend request at the transport, whatever adapter sent it, or one work signal update, which Convex bills as a function call */
export function countBackendRequest(path: string) {
    totals.backendRequests++
    increment(backendPaths, path)
}

/** Counts an event a starting server dropped from its full backlog */
export function countHeldEventDropped() {
    heldDropped++
}

/** Current totals. With a client, dropped and malformed events come from its diagnostics counters */
export function readCosts(client?: Pick<Client, "diagnostics">): CostTotals {
    const dropped = client?.diagnostics().counters.eventsDropped
    return { ...totals, eventsDropped: (dropped?.overflow ?? 0) + heldDropped, eventsMalformed: dropped?.malformed ?? 0,
        fluxerRoutes: Object.fromEntries(fluxerRoutes), backendPaths: Object.fromEntries(backendPaths), eventCounts: Object.fromEntries(eventCounts) }
}

export const costSummaryMs = 600000
const numbers = ["fluxerRequests", "fluxerRetries", "fluxerFailures", "rateLimitWaits", "rateLimitWaitMs", "backendRequests", "events", "eventsDropped", "eventsMalformed"] as const
const busiest = (now: Readonly<Record<string, number>>, before: Readonly<Record<string, number>>) => Object.entries(now)
    .map(([key, value]) => [key, value - (before[key] ?? 0)] as const).filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, value]) => `${key} ${value}`).join(", ")

/** Logs the change in totals every ten minutes, and nothing for an interval without requests or events */
export function startCostSummary(client: Pick<Client, "diagnostics">, intervalMs = costSummaryMs) {
    return Effect.gen(function* () {
        let previous = readCosts(client)
        for (;;) {
            yield* Effect.sleep(Duration.millis(intervalMs))
            const current = readCosts(client)
            const change = Object.fromEntries(numbers.map(key => [key, current[key] - previous[key]])) as Record<typeof numbers[number], number>
            if (numbers.some(key => change[key] !== 0)) yield* Effect.logInfo(`Costs in the last ${intervalMs / 60000} minutes: ${change.fluxerRequests} Fluxer requests, ${change.backendRequests} backend requests, ${change.events} events`
                + `, ${change.rateLimitWaits} rate-limit waits and ${change.eventsDropped} dropped events`).pipe(Effect.annotateLogs({ ...change,
                busiestRoutes: busiest(current.fluxerRoutes, previous.fluxerRoutes), busiestBackendPaths: busiest(current.backendPaths, previous.backendPaths) }))
            previous = current
        }
    }).pipe(Effect.forkScoped({ startImmediately: true }), Effect.asVoid)
}
