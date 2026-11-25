import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import {
    CATALOG_FRESH_MS,
    CATALOG_REFRESH_MS,
    CatalogRefreshProvider,
    clearCatalogCache,
    useCatalog,
    useInviteReturn,
} from "../src/catalog.tsx"
import type { CatalogClock } from "../src/catalog.tsx"
import { SearchPicker } from "../src/search-picker.tsx"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000" })
for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
}))
    Object.defineProperty(globalThis, name, { value, configurable: true })
const { render, fireEvent, cleanup, act } = await import("@testing-library/react")
afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
})

// A clock the test moves by hand, so the wait between catalog calls never depends on real time
function manualClock() {
    let now = 0,
        next = 0
    const timers = new Map<number, { at: number; run: () => void }>()
    const clock: CatalogClock = {
        now: () => now,
        setTimeout: (run, ms) => {
            timers.set(++next, { at: now + ms, run })
            return next
        },
        clearTimeout: (id) => {
            timers.delete(id as number)
        },
    }
    return {
        clock,
        pending: () => timers.size,
        advance: async (ms: number) => {
            now += ms
            for (const [id, timer] of [...timers])
                if (timer.at <= now) {
                    timers.delete(id)
                    await act(async () => {
                        timer.run()
                    })
                }
        },
    }
}
// Every catalog call stays open until the test answers it
function catalogClient() {
    const calls: Array<{ serverId: string; resolve: (value: DashboardCatalog) => void }> = []
    const client = {
        action: (ref: unknown, args: { serverId: string }) => {
            assert.equal(getFunctionName(ref as never), "dashboard:catalog")
            return new Promise<DashboardCatalog>((resolve) => {
                calls.push({ serverId: args.serverId, resolve })
            })
        },
    } as unknown as ConvexReactClient
    return {
        client,
        calls,
        answer: async (index: number, roles: string[]) => {
            await act(async () => {
                calls[index]!.resolve({
                    serverId: calls[index]!.serverId,
                    channels: [],
                    roles: roles.map((name, position) => ({ id: String(40 + position), name, position })),
                })
            })
        },
    }
}
function Harness({
    client,
    clock,
    serverId = "2",
}: {
    client: ConvexReactClient
    clock: CatalogClock
    serverId?: string
}) {
    const state = useCatalog(client, "synthetic-session", serverId, true, clock)
    return createElement(
        CatalogRefreshProvider,
        { value: state },
        createElement(SearchPicker, {
            catalog: true,
            label: "Reward role",
            options: (state.catalog?.roles ?? []).map((role) => ({ id: role.id, name: role.name })),
            value: [],
            loading: state.loading,
            onChange: () => {},
        }),
        createElement(SearchPicker, {
            label: "Timezone",
            options: [{ id: "UTC", name: "UTC" }],
            value: [],
            onChange: () => {},
        }),
        createElement("p", { role: "status" }, state.refreshed ? "Channel and role lists refreshed" : ""),
    )
}
const refreshButton = (ui: ReturnType<typeof render>) =>
    ui.getByRole("button", { name: "Refresh channels and roles for Reward role" }) as HTMLButtonElement

test("The catalog loads once per server and a refresh makes one call while keeping the loaded lists usable", async () => {
    const time = manualClock(),
        live = catalogClient()
    const ui = render(createElement(Harness, { client: live.client, clock: time.clock }))
    assert.equal(live.calls.length, 1)
    assert.ok(ui.queryByRole("button", { name: /Timezone/ }) === null, "only channel and role pickers offer a refresh")
    await live.answer(0, ["Red"])
    await time.advance(CATALOG_REFRESH_MS)
    fireEvent.click(refreshButton(ui))
    assert.equal(live.calls.length, 2)
    assert.equal(refreshButton(ui).disabled, true)
    assert.equal(refreshButton(ui).textContent, "Refreshing…")
    // The old list stays searchable while the refresh runs
    assert.equal((ui.getByRole("combobox", { name: "Reward role" }) as HTMLInputElement).disabled, false)
    await live.answer(1, ["Red", "Blue"])
    fireEvent.change(ui.getByRole("combobox", { name: "Reward role" }), { target: { value: "blu" } })
    assert.ok(ui.getByRole("option", { name: "Blue 41" }))
    assert.equal(ui.getByRole("status").textContent, "Channel and role lists refreshed")
    // Nothing polls: Time passing makes no further calls
    await time.advance(10 * CATALOG_REFRESH_MS)
    assert.equal(live.calls.length, 2)
    assert.equal(time.pending(), 0)
})

test("A refresh soon after the previous call waits and then makes exactly one call", async () => {
    const time = manualClock(),
        live = catalogClient()
    const ui = render(createElement(Harness, { client: live.client, clock: time.clock }))
    await live.answer(0, ["Red"])
    await time.advance(1000)
    fireEvent.click(refreshButton(ui))
    assert.equal(live.calls.length, 1, "the wait after the first call is not over")
    assert.equal(refreshButton(ui).disabled, true)
    fireEvent.click(refreshButton(ui))
    await time.advance(CATALOG_REFRESH_MS - 1001)
    assert.equal(live.calls.length, 1)
    await time.advance(1)
    assert.equal(live.calls.length, 2)
    await live.answer(1, ["Red"])
    assert.equal(refreshButton(ui).disabled, false)
})

test("Switching servers drops a pending refresh and loads the new server once", async () => {
    const time = manualClock(),
        live = catalogClient()
    const ui = render(createElement(Harness, { client: live.client, clock: time.clock }))
    await live.answer(0, ["Red"])
    fireEvent.click(refreshButton(ui))
    ui.rerender(createElement(Harness, { client: live.client, clock: time.clock, serverId: "3" }))
    assert.deepEqual(
        live.calls.map((call) => call.serverId),
        ["2", "3"],
    )
    await time.advance(CATALOG_REFRESH_MS)
    assert.deepEqual(
        live.calls.map((call) => call.serverId),
        ["2", "3"],
    )
})

test("Coming back from the bot invitation refreshes once, and a later return without an invitation does nothing", async () => {
    let returns = 0
    function Invite() {
        const mark = useInviteReturn(() => {
            returns++
        })
        return createElement(
            "a",
            {
                href: "#invite",
                onClick: (event: { preventDefault: () => void }) => {
                    event.preventDefault()
                    mark()
                },
            },
            "Add NeonFlux to a server",
        )
    }
    const ui = render(createElement(Invite))
    fireEvent(window, new window.Event("focus"))
    assert.equal(returns, 0)
    fireEvent.click(ui.getByRole("link", { name: "Add NeonFlux to a server" }))
    fireEvent(window, new window.Event("focus"))
    fireEvent(document, new window.Event("visibilitychange"))
    assert.equal(returns, 1)
})

test("Catalog uses short-TTL sessionStorage cache, revalidates when stale, bypasses on refresh, and clears on sign-out", async () => {
    const time = manualClock(),
        live = catalogClient()
    const first = render(createElement(Harness, { client: live.client, clock: time.clock }))
    assert.equal(live.calls.length, 1)
    await live.answer(0, ["Crimson"])
    first.unmount()
    // Reopening within fresh TTL paints immediately from sessionStorage with zero Convex calls
    await time.advance(CATALOG_REFRESH_MS)
    const warm = render(createElement(Harness, { client: live.client, clock: time.clock }))
    assert.equal(live.calls.length, 1)
    fireEvent.change(warm.getByRole("combobox", { name: "Reward role" }), { target: { value: "cri" } })
    assert.ok(warm.getByRole("option", { name: "Crimson 40" }))
    // Manual refresh explicitly bypasses the fresh cache
    fireEvent.click(refreshButton(warm))
    assert.equal(live.calls.length, 2)
    await live.answer(1, ["Crimson", "Violet"])
    warm.unmount()
    // After the fresh window ends, reopening shows cached data immediately and revalidates once in the background
    await time.advance(CATALOG_FRESH_MS + 1)
    const stale = render(createElement(Harness, { client: live.client, clock: time.clock }))
    assert.equal(live.calls.length, 3)
    fireEvent.change(stale.getByRole("combobox", { name: "Reward role" }), { target: { value: "vio" } })
    assert.ok(stale.getByRole("option", { name: "Violet 41" }))
    await live.answer(2, ["Cyan"])
    fireEvent.change(stale.getByRole("combobox", { name: "Reward role" }), { target: { value: "cya" } })
    assert.ok(stale.getByRole("option", { name: "Cyan 40" }))
    stale.unmount()
    // Sign-out clears cached catalogs while leaving unrelated sessionStorage keys intact
    window.sessionStorage.setItem("other.key", "keep")
    clearCatalogCache()
    assert.equal(window.sessionStorage.getItem("other.key"), "keep")
    const afterClear = render(createElement(Harness, { client: live.client, clock: time.clock }))
    assert.equal(live.calls.length, 4)
    // Clearing cache while a request is in flight prevents the late response from repopulating sessionStorage
    clearCatalogCache()
    await live.answer(3, ["Leaked"])
    assert.equal(
        Array.from({ length: window.sessionStorage.length }, (_, i) => window.sessionStorage.key(i)).some((key) =>
            key?.startsWith("neonflux.catalog.v1:"),
        ),
        false,
    )
    afterClear.unmount()
})

test("Catalog immediately hides previous account data on sessionToken change and loads the new account", async () => {
    const time = manualClock(),
        live = catalogClient()
    function Probe({ sessionToken }: { sessionToken: string }) {
        const result = useCatalog(live.client, sessionToken, "1", true, time.clock)
        return createElement(
            "div",
            null,
            createElement("p", { "data-testid": "cat" }, result.catalog?.roles.map((r) => r.name).join(",") ?? "none"),
            createElement("p", { "data-testid": "loading" }, String(result.loading)),
            createElement("button", { type: "button", onClick: result.refresh }, "Retry"),
        )
    }
    const ui = render(createElement(Probe, { sessionToken: "session-a" }))
    await live.answer(0, ["SecretRole"])
    assert.equal(ui.getByTestId("cat").textContent, "SecretRole")
    ui.rerender(createElement(Probe, { sessionToken: "session-b" }))
    assert.equal(ui.getByTestId("cat").textContent, "none")
    assert.equal(live.calls.length, 2)
    await live.answer(1, ["AccountBRole"])
    assert.equal(ui.getByTestId("cat").textContent, "AccountBRole")
    assert.equal(ui.getByTestId("loading").textContent, "false")
    // A cache clear mid-flight must reset loading and let a subsequent manual refresh complete
    await time.advance(CATALOG_REFRESH_MS)
    fireEvent.click(ui.getByRole("button", { name: "Retry" }))
    assert.equal(live.calls.length, 3)
    clearCatalogCache()
    await live.answer(2, ["DiscardedRole"])
    assert.equal(ui.getByTestId("cat").textContent, "AccountBRole")
    assert.equal(ui.getByTestId("loading").textContent, "false")
    await time.advance(CATALOG_REFRESH_MS)
    fireEvent.click(ui.getByRole("button", { name: "Retry" }))
    assert.equal(live.calls.length, 4)
    await live.answer(3, ["FreshRole"])
    assert.equal(ui.getByTestId("cat").textContent, "FreshRole")
    ui.unmount()
})
