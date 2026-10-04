import assert from "node:assert/strict"
import test from "node:test"
import { moderationErrorMessage, ModerationStoreError } from "../src/moderation-store.ts"

const reason = "Synthetic sentence for members. Do the next step"
test("each store shows the sentence of a REFUSED refusal, and the fixed reply only without one", () => {
    for (const [name, make, message] of [
        [
            "moderation",
            (extra: object) => new ModerationStoreError({ operation: "x", status: 403, ...extra }),
            moderationErrorMessage,
        ],
    ] as const) {
        // The unions of the error classes accept the same fields, so one signature covers them all
        const show = message as (error: never) => string
        assert.equal(show(make({ code: "REFUSED", reason }) as never), reason, name)
        assert.notEqual(show(make({}) as never), reason, name)
        // A reason without the code is not a sentence for members
        assert.notEqual(show(make({ reason }) as never), reason, name)
    }
})
