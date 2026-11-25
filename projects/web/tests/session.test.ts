import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { WebSession } from "../src/dashboard-api"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000" })
for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
}))
    Object.defineProperty(globalThis, name, { value, configurable: true })
// The query library decides once at load whether it runs in a browser, so it loads after the window exists
const { render, cleanup, act } = await import("@testing-library/react")
const { focusManager, notifyManager, defaultScheduler } = await import("@tanstack/react-query")
const { SessionProvider, useSession } = await import("../src/session.tsx")
const { Dashboard } = await import("../src/dashboard.tsx")
afterEach(() => {
    cleanup()
    focusManager.setFocused(undefined)
    notifyManager.setScheduler(defaultScheduler)
})

function Probe() {
    const session = useSession()
    return createElement("p", null, `${session.data?.user.name ?? "none"}${session.isError ? " error" : ""}`)
}
// Event loop turns let fetches and React settle, bounded so a missing refresh fails instead of hanging
async function until(check: () => boolean) {
    for (let turn = 0; turn < 200 && !check(); turn++) await act(() => new Promise((resolve) => setImmediate(resolve)))
    assert(check())
}
test("a hidden tab keeps refreshing its sign-in, and a transient failure recovers on the next refresh", async (context) => {
    // Timers are controlled, including the cache cleanup, and query updates are delivered as microtasks
    context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] })
    notifyManager.setScheduler(queueMicrotask)
    const session = {
        sessionToken: "synthetic-session",
        convexUrl: "https://synthetic.invalid",
        expiresAt: 1,
        user: { id: "1", name: "Synthetic user" },
        mode: "single",
        servers: [],
    } satisfies WebSession
    const responses = [
        Response.json(session),
        Response.json({ error: "Session refresh unavailable. Try again" }, { status: 503 }),
        Response.json(session),
    ]
    let calls = 0
    context.mock.method(globalThis, "fetch", async () => responses[calls++]!)
    focusManager.setFocused(false)
    const ui = render(createElement(SessionProvider, null, createElement(Probe)))
    const text = () => ui.container.textContent
    await until(() => text() === "Synthetic user")
    context.mock.timers.tick(3 * 60 * 1000)
    await until(() => text() === "Synthetic user error")
    assert.equal(calls, 2)
    context.mock.timers.tick(3 * 60 * 1000)
    await until(() => text() === "Synthetic user")
    assert.equal(calls, 3)
})

test("expired sign-in never renders stale server data and shows the sign-in screen", async (context) => {
    context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] })
    notifyManager.setScheduler(queueMicrotask)
    const active = {
        sessionToken: "synthetic-session",
        convexUrl: "https://synthetic.invalid",
        expiresAt: 1,
        user: { id: "1", name: "Synthetic manager" },
        mode: "single",
        servers: [],
    } satisfies WebSession
    const responses = [Response.json(active), Response.json({ user: null }, { status: 401 })]
    let calls = 0
    context.mock.method(globalThis, "fetch", async () => responses[calls++]!)
    const ui = render(createElement(Dashboard))
    await until(() => ui.container.textContent?.includes("Synthetic manager") ?? false)
    context.mock.timers.tick(3 * 60 * 1000)
    await until(() => ui.container.textContent?.includes("Sign in to continue") ?? false)
    assert.equal(ui.container.textContent?.includes("Synthetic manager"), false)
    assert.ok(ui.container.textContent?.includes("Your sign-in expired"))
})

test("a 503 with Retry-After retries across a multi-second token rotation without surfacing an error", async (context) => {
    context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] })
    notifyManager.setScheduler(queueMicrotask)
    const active = {
        sessionToken: "synthetic-session",
        convexUrl: "https://synthetic.invalid",
        expiresAt: 1,
        user: { id: "1", name: "Recovered user" },
        mode: "single",
        servers: [],
    } satisfies WebSession
    const conflict = () =>
        Response.json({ error: "Sign-in is refreshing. Try again" }, { status: 503, headers: { "Retry-After": "1" } })
    const responses = [conflict(), conflict(), conflict(), Response.json(active)]
    let calls = 0
    context.mock.method(globalThis, "fetch", async () => responses[calls++]!)
    const ui = render(createElement(SessionProvider, null, createElement(Probe)))
    const text = () => ui.container.textContent
    await until(() => calls === 1)
    assert.equal(text(), "none")
    // Progressive backoff: 1s, 2s, 3s (6s total elapsed) recovers seamlessly with no error banner
    context.mock.timers.tick(1000)
    await until(() => calls === 2)
    context.mock.timers.tick(2000)
    await until(() => calls === 3)
    context.mock.timers.tick(3000)
    await until(() => text() === "Recovered user")
    assert.equal(calls, 4)
})
