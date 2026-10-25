import assert from "node:assert/strict"
import test from "node:test"
import { Cause, Effect, Logger, References } from "effect"
import { causeSummary, contained } from "../src/contained.ts"
import { RoleHandlingError } from "../src/roles.ts"
import { RolesStoreError } from "../src/roles-store.ts"

test("a failure's summary keeps its tag and known fields, and drops backend sentences, messages and bodies", () => {
    const secret = "synthetic.secret-token-value"
    const summary = causeSummary(
        Cause.fail(
            Object.assign(
                new RolesStoreError({
                    operation: "evaluate",
                    status: 403,
                    code: "REFUSED",
                    // A backend's refusal sentence is never kept, even in a known field
                    reason: "Synthetic member wrote hello there",
                }),
                {
                    message: `Synthetic member wrote ${secret}`,
                    token: secret,
                    body: '{"content":"Synthetic message text"}',
                },
            ),
        ),
    )
    assert.deepEqual(summary, {
        "cause.error": "RolesStoreError",
        "cause.defect": false,
        "cause.code": "REFUSED",
        "cause.status": 403,
        "cause.operation": "evaluate",
    })
    const text = JSON.stringify(summary)
    for (const hidden of [secret, "Synthetic member", "Synthetic message text", "hello"])
        assert.equal(text.includes(hidden), false, hidden)
    // The SDK's names, a route template and the bot's stages are kept
    assert.deepEqual(
        causeSummary({
            _tag: "RestRequestError",
            operation: "rest.request",
            reason: "network",
            outcome: "unknown",
            status: null,
            route: "/roles/evaluate",
        }),
        {
            "cause.error": "RestRequestError",
            "cause.defect": false,
            "cause.reason": "network",
            "cause.outcome": "unknown",
            "cause.route": "/roles/evaluate",
        },
    )
    assert.deepEqual(causeSummary(new RoleHandlingError({ stage: "claim" })), {
        "cause.error": "RoleHandlingError",
        "cause.defect": false,
        "cause.stage": "claim",
    })
    // A defect names its class only, and a failure that is not a Cause is summarized the same way
    assert.deepEqual(causeSummary(Cause.die(new TypeError(`Synthetic member wrote ${secret}`))), {
        "cause.error": "TypeError",
        "cause.defect": true,
    })
    assert.deepEqual(causeSummary(new RolesStoreError({ operation: "query", status: null })), {
        "cause.error": "RolesStoreError",
        "cause.defect": false,
        "cause.operation": "query",
    })
    assert.deepEqual(causeSummary(Cause.die(secret)), { "cause.error": "string", "cause.defect": true })
})

test("a secret, a one-word message or a member name in any summarized field never reaches the summary", () => {
    for (const hidden of ["synthetic.secret-token-value", "hello", "Zephyrine"]) {
        // A store error whose reason is one word
        const store = causeSummary(
            Cause.fail(new RolesStoreError({ operation: "evaluate", status: 503, reason: hidden })),
        )
        assert.deepEqual(store, {
            "cause.error": "RolesStoreError",
            "cause.defect": false,
            "cause.status": 503,
            "cause.operation": "evaluate",
        })
        const planted = {
            _tag: hidden,
            code: hidden,
            status: hidden,
            stage: hidden,
            operation: hidden,
            route: hidden,
            reason: hidden,
            outcome: hidden,
        }
        assert.deepEqual(causeSummary(Cause.fail(planted)), { "cause.error": "unknown", "cause.defect": false })
        assert.deepEqual(causeSummary(Cause.die(planted)), { "cause.error": "unknown", "cause.defect": true })
        // A class named after it is unknown too
        const Named = { [hidden]: class extends Error {} }[hidden]!
        assert.deepEqual(causeSummary(new Named()), { "cause.error": "unknown", "cause.defect": false })
    }
    // A raw path with IDs and a status that is not an HTTP status are dropped
    assert.deepEqual(causeSummary({ _tag: "RestRequestError", route: "/channels/123456789/messages", status: 999 }), {
        "cause.error": "RestRequestError",
        "cause.defect": false,
    })
    assert.deepEqual(causeSummary({ _tag: "RestRequestError", status: "503" }), {
        "cause.error": "RestRequestError",
        "cause.defect": false,
    })
})

test("contained work that fails logs its warning with the failure's summary", async () => {
    const logged: { message: unknown; annotations: Record<string, unknown> }[] = []
    await Effect.runPromise(
        contained(
            Effect.fail(new RolesStoreError({ operation: "evaluate", status: 503 })),
            "Synthetic work stopped",
        ).pipe(
            Effect.provide(
                Logger.layer([
                    Logger.make(({ message, fiber }) => {
                        logged.push({
                            message: Array.isArray(message) ? message[0] : message,
                            annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
                        })
                    }),
                ]),
            ),
        ),
    )
    assert.deepEqual(logged, [
        {
            message: "Synthetic work stopped",
            annotations: {
                "cause.error": "RolesStoreError",
                "cause.defect": false,
                "cause.status": 503,
                "cause.operation": "evaluate",
            },
        },
    ])
})
