import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { Counter, CounterView } from "@neonflux/contracts/counters"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { CounterSettings } from "../src/counter-settings.tsx"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000" })
for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
}))
    Object.defineProperty(globalThis, name, { value, configurable: true })
const { render, fireEvent, cleanup, act, within } = await import("@testing-library/react")
afterEach(cleanup)
const at = Date.parse("2026-10-01T12:30:00Z")
const catalog = {
    serverId: "2",
    roles: [{ id: "77", name: "Staff", position: 1 }],
    channels: [
        { id: "123", name: "Members", type: 2 },
        { id: "124", name: "general", type: 0 },
        { id: "125", name: "uploads", type: 15 },
    ],
}
const saved: Counter = { channelId: "123", kind: "members", template: "Members: {count}", enabled: true, createdAt: at }
function setup(data: CounterView) {
    const calls: Array<DashboardConfigurationOperationMap["counters"]> = []
    const props = {
        remote: { family: "counters", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["counters"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"counters">
    return { ui: render(createElement(CounterSettings, props)), calls }
}
const section = (ui: ReturnType<typeof render>, name: string) => within(ui.getByRole("region", { name, hidden: true }))
const submit = (form: ReturnType<typeof within>, name: string) =>
    act(async () => {
        fireEvent.click(form.getByRole("button", { name, hidden: true }))
    })

const pick = (form: ReturnType<typeof within>, label: string, value: string) => {
    const picker = form.getByRole("combobox", { name: label, hidden: true })
    fireEvent.change(picker, { target: { value } })
    fireEvent.keyDown(picker, { key: "Enter" })
}
test("Adding a counter needs a channel and a name with its count, and takes members or a role", async () => {
    const { ui, calls } = setup({ enabled: true, counters: [] })
    const form = section(ui, "Add a counter")
    const name = form.getByLabelText("Channel name")
    fireEvent.change(name, { target: { value: "Members: {count}" } })
    await submit(form, "Add counter")
    assert.match(form.getByRole("alert").textContent ?? "", /Choose a channel/)
    // A forum post's channel cannot hold a counter
    const picker = form.getByRole("combobox", { name: "Channel to rename", hidden: true })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: "uploads" } })
    assert.equal(form.queryByRole("option", { name: /uploads/, hidden: true }) === null, true)
    pick(form, "Channel to rename", "general")
    fireEvent.change(name, { target: { value: "No count" } })
    await submit(form, "Add counter")
    assert.match(form.getByRole("alert").textContent ?? "", /\{count\}/)
    assert.deepEqual(calls, [])
    fireEvent.change(name, { target: { value: "  Members:   {count} " } })
    await submit(form, "Add counter")
    assert.deepEqual(calls, [{ type: "add", channelId: "124", kind: "members", template: "Members: {count}" }])
})

test("A role counter needs its role", async () => {
    const { ui, calls } = setup({ enabled: true, counters: [] })
    const form = section(ui, "Add a counter")
    fireEvent.change(form.getByLabelText("Count"), { target: { value: "role" } })
    pick(form, "Channel to rename", "general")
    fireEvent.change(form.getByLabelText("Channel name"), { target: { value: "Staff: {count}" } })
    await submit(form, "Add counter")
    assert.match(form.getByRole("alert").textContent ?? "", /Choose the role/)
    pick(form, "Counted role", "Staff")
    await submit(form, "Add counter")
    assert.deepEqual(calls, [{ type: "add", channelId: "124", kind: "role", roleId: "77", template: "Staff: {count}" }])
})

test("A saved counter changes its name, is removed and turns back on, and the switch queues a module change", async () => {
    const { ui, calls } = setup({
        enabled: true,
        counters: [saved, { ...saved, channelId: "124", enabled: false, problem: "permission" }],
    })
    assert.ok(ui.getByText(/NeonFlux cannot rename its channel/))
    const name = section(ui, "Name of Members")
    fireEvent.change(name.getByLabelText("Channel name"), { target: { value: "Now {count}" } })
    await submit(name, "Save name")
    await submit(section(ui, "Stop renaming Members"), "Remove counter")
    // A counter NeonFlux turned off saves without an edit
    await submit(section(ui, "Name of general"), "Save name")
    const module = section(ui, "Counter channels")
    fireEvent.click(module.getByLabelText("Counters on"))
    await submit(module, "Save counters")
    assert.deepEqual(calls, [
        { type: "set", channelId: "123", template: "Now {count}" },
        { type: "remove", channelId: "123" },
        { type: "set", channelId: "124", template: "Members: {count}" },
        { type: "module", enabled: false },
    ])
})

test("A counter that cannot read its count says why while it stays on", () => {
    const { ui } = setup({ enabled: true, counters: [{ ...saved, countProblem: "permission" }] })
    assert.ok(ui.getByText(/Its count cannot be read/))
    assert.match(ui.getByText(/Its count cannot be read/).textContent ?? "", /Manage nicknames/)
})

test("A full server offers no add form", () => {
    const { ui } = setup({
        enabled: true,
        counters: ["1", "2", "3", "4", "5"].map((channelId) => ({ ...saved, channelId })),
    })
    assert.ok(ui.getByText(/has the maximum of 5 counters/))
})
