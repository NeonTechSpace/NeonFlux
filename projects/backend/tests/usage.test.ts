import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { parseUsageBudget, USAGE_DEFAULT_WARNING_SHARE } from "../convex/usage.ts"
import type { ServiceUsage } from "../contracts.js"
import { botCall } from "./bot-service.ts"

const secret = "synthetic-usage-secret-not-a-credential-000000"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET", "NEONFLUX_MONTHLY_CALL_BUDGET", "NEONFLUX_BUDGET_WARNING_SHARE"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_MODE = "multi"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })

const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/usage.ts": () => import("../convex/usage.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
function fixture(tc: TestContext, at: string) {
    let now = Date.parse(at)
    tc.mock.method(Date, "now", () => now)
    const t = convexTest({ schema, modules, transactionLimits: true })
    const report = async (calls: unknown) => {
        const response = await botCall(t, "/service/usage", { calls })
        return { status: response.status, body: await response.json() as ServiceUsage }
    }
    return { t, report, set: (value: string) => { now = Date.parse(value) } }
}

test("without a budget the guard stays normal while reports still add up", async tc => {
    const { report } = fixture(tc, "2026-10-10T12:00:00Z")
    assert.deepEqual((await report(40)).body, { month: "2026-10", calls: 40, budget: null, state: "normal", warn: false })
    assert.deepEqual((await report(2)).body, { month: "2026-10", calls: 42, budget: null, state: "normal", warn: false })
})

test("the guard warns once a month at the warning share, pauses at 90 percent and starts over in the next UTC month", async tc => {
    process.env.NEONFLUX_MONTHLY_CALL_BUDGET = "1000"
    const { report, set } = fixture(tc, "2026-10-31T23:00:00Z")
    assert.equal((await report(649)).body.state, "normal")
    assert.deepEqual((await report(1)).body, { month: "2026-10", calls: 650, budget: 1000, state: "warning", warn: true })
    assert.deepEqual((await report(10)).body, { month: "2026-10", calls: 660, budget: 1000, state: "warning", warn: false })
    assert.deepEqual((await report(240)).body, { month: "2026-10", calls: 900, budget: 1000, state: "paused", warn: false })
    // Raising the budget resumes optional work at the next report
    process.env.NEONFLUX_MONTHLY_CALL_BUDGET = "2000"
    assert.deepEqual((await report(0)).body, { month: "2026-10", calls: 900, budget: 2000, state: "normal", warn: false })
    set("2026-11-01T00:00:00Z")
    process.env.NEONFLUX_MONTHLY_CALL_BUDGET = "100"
    process.env.NEONFLUX_BUDGET_WARNING_SHARE = "0.6"
    // A report that jumps straight past the pause share still carries the month's one warning
    assert.deepEqual((await report(95)).body, { month: "2026-11", calls: 95, budget: 100, state: "paused", warn: true })
})

test("reports need the bot key and a whole count, and a malformed budget answers unavailable", async tc => {
    const { t, report } = fixture(tc, "2026-10-10T12:00:00Z")
    assert.equal((await botCall(t, "/service/usage", { calls: 1 }, { secret: null })).status, 401)
    for (const calls of [-1, 1.5, "1", 100000001]) assert.equal((await report(calls)).status, 400)
    process.env.NEONFLUX_MONTHLY_CALL_BUDGET = "1e6"
    assert.equal((await report(1)).status, 503)
})

test("budget settings accept whole call counts and a warning share below the pause share", () => {
    assert.equal(parseUsageBudget({}), undefined)
    assert.deepEqual(parseUsageBudget({ NEONFLUX_MONTHLY_CALL_BUDGET: " 5000000 " }), { calls: 5000000, warningShare: USAGE_DEFAULT_WARNING_SHARE })
    assert.deepEqual(parseUsageBudget({ NEONFLUX_MONTHLY_CALL_BUDGET: "5000000", NEONFLUX_BUDGET_WARNING_SHARE: "0.7" }), { calls: 5000000, warningShare: 0.7 })
    for (const env of [{ NEONFLUX_MONTHLY_CALL_BUDGET: "0" }, { NEONFLUX_MONTHLY_CALL_BUDGET: "-5" }, { NEONFLUX_MONTHLY_CALL_BUDGET: "5.5" },
        { NEONFLUX_MONTHLY_CALL_BUDGET: "100", NEONFLUX_BUDGET_WARNING_SHARE: "0.9" }, { NEONFLUX_MONTHLY_CALL_BUDGET: "100", NEONFLUX_BUDGET_WARNING_SHARE: "0" },
        { NEONFLUX_MONTHLY_CALL_BUDGET: "100", NEONFLUX_BUDGET_WARNING_SHARE: "most" }, { NEONFLUX_BUDGET_WARNING_SHARE: "0.6" }]) {
        assert.throws(() => parseUsageBudget(env), JSON.stringify(env))
    }
})
