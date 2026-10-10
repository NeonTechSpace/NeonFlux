import assert from "node:assert/strict"
import { makeFunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import { deriveServiceKey } from "../convex/serviceKey.ts"
import { backendFunction, backendRoutes, isBackendPath } from "../../bot/src/backend-routes.ts"

type Backend = { query(reference: never, args: never): Promise<unknown>, mutation(reference: never, args: never): Promise<unknown> }
export interface BotCallOptions {
    /** The bound server, as a server runtime sends it. Omitted for requests that bind no server and in single mode */
    readonly serverId?: string | undefined
    /** The secret the key is derived from. Defaults to the configured secret, and null sends no key */
    readonly secret?: string | null
    /** A literal key value instead of a derived one */
    readonly key?: unknown
    /** Sends the body as given, including values JSON cannot carry, instead of the JSON values the transport sends */
    readonly raw?: boolean
}

// Calls a bot entry point the way the bot's transport does: the public function for the path with the derived key, the
// bound server and the request as JSON values. Results and backend errors come back as a status and a JSON body. A
// mutation's value is unwrapped, and its dueIn, when its writes created work, is the X-Due-In header
export async function botCall(t: Backend, path: string, body: unknown, options: BotCallOptions = {}): Promise<Response> {
    if (!isBackendPath(path)) return Response.json({ error: "Not found" }, { status: 404 })
    const secret = options.secret === undefined ? process.env.NEONFLUX_BOT_API_SECRET ?? "" : options.secret
    // An empty secret cannot key an HMAC. The backend answers 503 before it reads a key for any secret under 32 characters
    const key = "key" in options ? options.key : secret === null ? undefined : secret ? await deriveServiceKey(secret) : ""
    const request: unknown = body === undefined || options.raw ? body : JSON.parse(JSON.stringify(body))
    const args = Object.fromEntries(Object.entries({ key, serverId: options.serverId, request }).filter(([, value]) => value !== undefined))
    const reference = makeFunctionReference(backendFunction(path)) as never
    try {
        if (backendRoutes[path] === "query") return Response.json(await t.query(reference, args as never) ?? null)
        const answer = await t.mutation(reference, args as never) as { value?: unknown, dueIn?: unknown }
        assert(answer !== null && typeof answer === "object" && Object.keys(answer).every(key => key === "value" || key === "dueIn"), `${path} answers { value, dueIn }`)
        return Response.json(answer.value ?? null, typeof answer.dueIn === "number" ? { headers: { "X-Due-In": String(answer.dueIn) } } : {})
    } catch (error) {
        const data = error instanceof ConvexError ? error.data as { status?: unknown, error?: unknown, code?: unknown } | null : null
        if (typeof data?.status !== "number") throw error
        return Response.json({ error: data.error, ...(data.code === undefined ? {} : { code: data.code }) }, { status: data.status })
    }
}
