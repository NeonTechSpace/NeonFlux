import assert from "node:assert/strict"
import type { TestContext } from "node:test"
import { jsonToConvex, type JSONValue } from "convex/values"
import type { BackendClient } from "../src/config.ts"
import { backendFunction, backendKind, backendRoutes, type BackendPath } from "../src/backend-routes.ts"

/** One bot request as the backend function receives it */
export interface BackendCall {
    readonly path: string
    readonly serverId: string | undefined
    readonly body: unknown
    readonly key: unknown
    readonly signal: AbortSignal | undefined
}
/**
 * The backend's answer. A plain value is the function's result. A Response describes an answer by status: a 2xx JSON body
 * is the result, any other status is a backend error carrying that status and the body's `error` and `code`, and a body
 * that is not JSON is a broken reply
 */
export type BackendResponder = (call: BackendCall) => unknown

const paths = new Map((Object.keys(backendRoutes) as BackendPath[]).map((path) => [backendFunction(path), path]))
function backendCall(name: string, args: Record<string, unknown>, signal: AbortSignal | undefined): BackendCall {
    const path = paths.get(name)
    assert(path, `${name} is a bot entry point`)
    return { path, serverId: args.serverId as string | undefined, body: args.request, key: args.key, signal }
}

// A function that returns nothing answers null, as Convex does
const functionResult = (value: unknown) => value ?? null

// The Convex HTTP API reply for a responder's answer: 200 with the value, or 560 with the error data a ConvexError carries
async function convexReply(answer: unknown): Promise<Response> {
    if (!(answer instanceof Response))
        return Response.json({ status: "success", value: functionResult(answer), logLines: [] })
    const text = await answer.text()
    let body: unknown
    try {
        body = JSON.parse(text)
    } catch {
        return new Response(text, { status: answer.ok ? 200 : 500 })
    }
    if (answer.ok) return Response.json({ status: "success", value: functionResult(body), logLines: [] })
    const { error, code } =
        body !== null && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : {}
    return Response.json(
        {
            status: "error",
            errorMessage: text,
            errorData: {
                status: answer.status,
                error: typeof error === "string" ? error : "Synthetic backend error",
                ...(code === undefined ? {} : { code }),
            },
            logLines: [],
        },
        { status: 560 },
    )
}

/**
 * Answers the production Convex client's requests in memory. Requests leave through the mocked global fetch exactly as the
 * Convex HTTP client sends them, so the transport, key, server binding and error mapping all run unchanged
 */
export function mockBackend(t: Pick<TestContext, "mock">, respond: BackendResponder) {
    return t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        assert.equal(init?.method, "POST")
        assert.equal(init?.redirect, "error")
        const sent = JSON.parse(String(init?.body)) as { path: string; args: JSONValue[] }
        const call = backendCall(
            sent.path,
            jsonToConvex(sent.args[0]!) as Record<string, unknown>,
            init?.signal ?? undefined,
        )
        assert.equal(url.pathname, `/api/${backendKind(call.path as BackendPath)}`)
        return convexReply(await respond(call))
    })
}

/** A client that answers in memory without the Convex client library, for whole-bot and transport tests */
export function fakeClient(respond: BackendResponder): BackendClient {
    const call = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
        const request = backendCall(name, args, signal),
            answer = await respond(request)
        if (!(answer instanceof Response)) return functionResult(answer)
        const text = await answer.text()
        let body: unknown
        try {
            body = JSON.parse(text)
        } catch {
            throw new Error("Synthetic broken reply")
        }
        if (answer.ok) return functionResult(body)
        const { error, code } =
            body !== null && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : {}
        throw Object.assign(new Error(text), {
            data: {
                status: answer.status,
                error: typeof error === "string" ? error : "Synthetic backend error",
                ...(code === undefined ? {} : { code }),
            },
        })
    }
    return {
        query: call,
        mutation: call,
    }
}
