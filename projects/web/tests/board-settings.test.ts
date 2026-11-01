import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { Board, BoardView } from "@neonflux/contracts/boards"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { BoardSettings } from "../src/board-settings.tsx"

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
    roles: [],
    channels: [
        { id: "123", name: "starboard", type: 0 },
        { id: "124", name: "general", type: 0 },
        { id: "125", name: "uploads", type: 15 },
        { id: "126", name: "archive", type: 4 },
    ],
}
const saved: Board = {
    name: "stars",
    emoji: "⭐",
    channelId: "123",
    threshold: 3,
    selfReactions: false,
    bots: false,
    ignoredChannelIds: [],
    posted: 2,
    createdAt: at,
}
function setup(data: BoardView) {
    const calls: Array<DashboardConfigurationOperationMap["boards"]> = []
    const props = {
        remote: { family: "boards", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["boards"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"boards">
    return { ui: render(createElement(BoardSettings, props)), calls }
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
const type = (form: ReturnType<typeof within>, label: string, value: string) =>
    fireEvent.change(form.getByLabelText(label), { target: { value } })

test("Adding a board needs a name, an emoji and a channel, and a forum cannot hold one", async () => {
    const { ui, calls } = setup({ enabled: true, boards: [] })
    const form = section(ui, "Add a board")
    type(form, "Emoji", "⭐")
    await submit(form, "Add board")
    assert.match(form.getByRole("alert").textContent ?? "", /Name the board/)
    type(form, "Name", "Stars")
    await submit(form, "Add board")
    assert.match(form.getByRole("alert").textContent ?? "", /Choose a channel/)
    const picker = form.getByRole("combobox", { name: "Channel for the posts", hidden: true })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: "uploads" } })
    assert.equal(form.queryByRole("option", { name: /uploads/, hidden: true }) === null, true)
    pick(form, "Channel for the posts", "starboard")
    type(form, "Emoji", ":star:")
    await submit(form, "Add board")
    assert.match(form.getByRole("alert").textContent ?? "", /Enter one emoji/)
    type(form, "Emoji", "⭐")
    type(form, "Reactions needed", "")
    await submit(form, "Add board")
    assert.match(form.getByRole("alert").textContent ?? "", /threshold from 1/)
    assert.deepEqual(calls, [])
    type(form, "Reactions needed", "5")
    await submit(form, "Add board")
    assert.deepEqual(calls, [{ type: "add", name: "stars", emoji: "⭐", channelId: "123", threshold: 5 }])
})

test("A saved board changes every setting, ignores channels and can be removed, like its commands", async () => {
    const { ui, calls } = setup({ enabled: true, boards: [{ ...saved, ignoredChannelIds: ["124"] }] })
    const settings = section(ui, "Settings of stars")
    type(settings, "Emoji", "🤡")
    type(settings, "Reactions needed", "4")
    fireEvent.click(settings.getByLabelText("An author's own reaction counts"))
    fireEvent.click(settings.getByLabelText("Messages of bots and webhooks can be reposted"))
    await submit(settings, "Save board")
    assert.deepEqual(calls.at(-1), {
        type: "set",
        name: "stars",
        emoji: "🤡",
        threshold: 4,
        channelId: "123",
        selfReactions: true,
        bots: true,
    })
    await submit(section(ui, "Ignored: general"), "Take back in")
    assert.deepEqual(calls.at(-1), { type: "ignore", name: "stars", channelId: "124", ignored: false })
    const leave = section(ui, "Leave a channel out of stars")
    // A category holds no message, so leaving one out would match nothing
    const ignoring = leave.getByRole("combobox", { name: "Channel to leave out", hidden: true })
    fireEvent.focus(ignoring)
    fireEvent.change(ignoring, { target: { value: "archive" } })
    assert.equal(leave.queryByRole("option", { name: /archive/, hidden: true }) === null, true)
    pick(leave, "Channel to leave out", "uploads")
    await submit(leave, "Ignore channel")
    assert.deepEqual(calls.at(-1), { type: "ignore", name: "stars", channelId: "125", ignored: true })
    await submit(section(ui, "Remove stars"), "Remove board")
    assert.deepEqual(calls.at(-1), { type: "remove", name: "stars" })
})

test("A stopped board names its fix and saves without an edit, the switch queues a module change, and a full server adds no more", async () => {
    const full: Board[] = ["a", "b", "c", "d"].map((name) => ({ ...saved, name }))
    const { ui, calls } = setup({
        enabled: true,
        boards: [...full, { ...saved, problem: "permission" }],
    })
    assert.ok(ui.getByText(/NeonFlux cannot post in its channel/))
    await submit(section(ui, "Settings of stars"), "Save board")
    assert.equal((calls.at(-1) as { name: string }).name, "stars")
    const main = section(ui, "Boards")
    fireEvent.click(main.getByLabelText("Boards on"))
    await submit(main, "Save boards")
    assert.deepEqual(calls.at(-1), { type: "module", enabled: false })
    assert.ok(ui.getByText(/maximum of 5 boards/))
})
