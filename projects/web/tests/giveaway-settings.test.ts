import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { Giveaway, GiveawayView } from "@neonflux/contracts/giveaways"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { GiveawaySettingsSection } from "../src/giveaway-settings.tsx"
import { ReminderSettingsSection } from "../src/reminder-settings.tsx"

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
    roles: [{ id: "77", name: "Winners", position: 1 }],
    channels: [
        { id: "124", name: "general", type: 0 },
        { id: "125", name: "uploads", type: 15 },
    ],
}
const giveaway = (fields: Partial<Giveaway> = {}): Giveaway => ({
    giveawayNo: 3,
    hostId: "9",
    channelId: "124",
    prize: "Game key",
    winnerCount: 2,
    endsAt: at + 3600000,
    createdAt: at,
    state: "running",
    phase: "wait",
    messageId: "700",
    winners: [],
    ...fields,
})
function setup(data: GiveawayView) {
    const calls: Array<DashboardConfigurationOperationMap["giveaways"]> = []
    const props = {
        remote: { family: "giveaways", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["giveaways"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"giveaways">
    return { ui: render(createElement(GiveawaySettingsSection, props)), calls }
}
const section = (ui: ReturnType<typeof render>, name: string) => within(ui.getByRole("region", { name, hidden: true }))
const submit = (form: ReturnType<typeof within>, name: string) =>
    act(async () => {
        fireEvent.click(form.getByRole("button", { name, hidden: true }))
    })
const settings = { enabled: true, requiredRoleId: null }

test("The switch and the required role queue a settings change", async () => {
    const { ui, calls } = setup({ settings, giveaways: [] })
    const form = section(ui, "Giveaways")
    fireEvent.click(form.getByRole("checkbox", { name: /Giveaways are on/, hidden: true }))
    await submit(form, "Save giveaways")
    assert.deepEqual(calls, [{ type: "settings", patch: { enabled: false, requiredRoleId: null } }])
})

test("Starting needs a channel and a prize, and queues the same start as the command", async () => {
    const { ui, calls } = setup({ settings, giveaways: [] })
    const form = section(ui, "Start a giveaway")
    fireEvent.change(form.getByLabelText("Prize"), { target: { value: " " } })
    await submit(form, "Start giveaway")
    assert.match(form.getByRole("alert").textContent ?? "", /Choose a channel/)
    // A forum cannot hold a card
    const picker = form.getByRole("combobox", { name: "Channel", hidden: true })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: "uploads" } })
    assert.equal(form.queryByRole("option", { name: /uploads/, hidden: true }) === null, true)
    fireEvent.change(picker, { target: { value: "general" } })
    fireEvent.keyDown(picker, { key: "Enter" })
    await submit(form, "Start giveaway")
    assert.match(form.getByRole("alert").textContent ?? "", /Write the prize/)
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Prize"), { target: { value: "  Game key " } })
    await submit(form, "Start giveaway")
    assert.deepEqual(calls, [{ type: "start", channelId: "124", prize: "Game key", winners: 1, lengthSeconds: 86400 }])
})

test("A running giveaway can be ended or cancelled, an ended one rerolled, and each shows what staff should know", async () => {
    const { ui, calls } = setup({
        settings,
        giveaways: [
            giveaway(),
            giveaway({
                giveawayNo: 2,
                prize: "Other prize",
                state: "ended",
                phase: "done",
                entrants: 5000,
                capped: true,
                problem: "result-uncertain",
                winners: [
                    { userId: "71", drawNo: 1, dm: "failed" },
                    { userId: "72", drawNo: 1, dm: "sent" },
                ],
            }),
        ],
    })
    await submit(section(ui, "End now"), "End giveaway")
    await submit(section(ui, "Cancel"), "Cancel giveaway")
    await submit(section(ui, "Draw again"), "Reroll")
    assert.deepEqual(calls, [
        { type: "end", giveawayNo: 3 },
        { type: "cancel", giveawayNo: 3 },
        { type: "reroll", giveawayNo: 2, count: 2 },
    ])
    const status = section(ui, "Status of giveaway 2")
    assert.ok(status.getByText(/Not told by DM: Member 71/))
    assert.ok(status.getByText(/Only the first 5,000 entries/))
    assert.ok(status.getByText(/never updates it twice/))
})

test("A finished draw without a winner shows the empty result", () => {
    const { ui } = setup({
        settings,
        giveaways: [
            giveaway(),
            giveaway({ giveawayNo: 2, state: "ended", phase: "done", entrants: 4 }),
            giveaway({ giveawayNo: 1, state: "cancelled", phase: "done" }),
        ],
    })
    assert.ok(section(ui, "Status of giveaway 3").getByText(/2 to draw/))
    assert.ok(section(ui, "Status of giveaway 2").getByText(/None, no valid entries/))
    assert.equal(section(ui, "Status of giveaway 1").queryByText(/to draw/) === null, true)
})

test("At the running limit the start form says so", () => {
    const { ui } = setup({
        settings,
        giveaways: Array.from({ length: 25 }, (_, index) => giveaway({ giveawayNo: index + 1 })),
    })
    assert.ok(ui.getByText(/runs the maximum of 25 giveaways/))
})

test("The reminder section shows only the switch and the limit", async () => {
    const calls: Array<DashboardConfigurationOperationMap["reminders"]> = []
    const props = {
        remote: {
            family: "reminders",
            serverId: "2",
            configRevision: 1,
            jobs: [],
            data: { settings: { enabled: true, memberLimit: 25 } },
        },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["reminders"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"reminders">
    const ui = render(createElement(ReminderSettingsSection, props))
    const form = section(ui, "Personal reminders")
    fireEvent.change(form.getByLabelText(/Reminders each member keeps/), { target: { value: "5" } })
    await submit(form, "Save reminders")
    assert.deepEqual(calls, [{ type: "settings", patch: { enabled: true, memberLimit: 5 } }])
})
