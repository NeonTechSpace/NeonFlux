import assert from "node:assert/strict"
import test from "node:test"
import { eventsErrorMessage, EventsStoreError } from "../src/event-store.ts"
import { milestonesErrorMessage, MilestonesStoreError } from "../src/milestone-store.ts"
import { moderationErrorMessage, ModerationStoreError } from "../src/moderation-store.ts"
import { publishingErrorMessage, PublishingStoreError } from "../src/publishing-store.ts"
import { rolesErrorMessage, RolesStoreError } from "../src/roles-store.ts"
import { schedulesErrorMessage, SchedulesStoreError } from "../src/schedule-store.ts"
import { temporaryRoleErrorMessage, TemporaryRoleStoreError } from "../src/temprole-store.ts"

const reason = "Synthetic sentence for members. Do the next step"
test("each store shows the sentence of a REFUSED refusal, and the fixed reply only without one", () => {
    for (const [name, make, message] of [
        [
            "moderation",
            (extra: object) => new ModerationStoreError({ operation: "x", status: 403, ...extra }),
            moderationErrorMessage,
        ],
        ["roles", (extra: object) => new RolesStoreError({ operation: "x", status: 409, ...extra }), rolesErrorMessage],
        [
            "temporary roles",
            (extra: object) => new TemporaryRoleStoreError({ operation: "x", status: 400, ...extra }),
            temporaryRoleErrorMessage,
        ],
        [
            "publishing",
            (extra: object) => new PublishingStoreError({ operation: "x", status: 409, ...extra }),
            publishingErrorMessage,
        ],
        [
            "schedules",
            (extra: object) => new SchedulesStoreError({ operation: "x", status: 409, ...extra }),
            schedulesErrorMessage,
        ],
        [
            "events",
            (extra: object) => new EventsStoreError({ operation: "x", status: 409, ...extra }),
            eventsErrorMessage,
        ],
        [
            "milestones",
            (extra: object) => new MilestonesStoreError({ operation: "x", status: 409, ...extra }),
            milestonesErrorMessage,
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
