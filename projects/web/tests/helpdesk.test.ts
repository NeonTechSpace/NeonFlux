import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { HelpDeskSettings } from "../src/helpdesk-settings.tsx"

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
const catalog = {
    serverId: "2",
    roles: [],
    channels: [
        { id: "123", name: "general", type: 0 },
        { id: "150", name: "help", type: 15 },
        { id: "151", name: "media-help", type: 16 },
    ],
}
const settings = {
    forumIds: ["150"],
    greeting: "Welcome",
    solvedTag: "Solved",
    nudgeHours: 24,
    guardChannelId: null,
    autoArchive: false,
    revision: 3,
}
const answer = { name: "logs", title: "Send your logs", content: "Open settings", updatedAt: 1 }
function setup(data: unknown) {
    const calls: Array<DashboardConfigurationOperationMap["helpdesk"]> = []
    const props = {
        remote: { family: "helpdesk", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["helpdesk"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"helpdesk">
    const ui = render(createElement(HelpDeskSettings, props))
    // Shows a newer snapshot, as when someone else changed the section
    const update = (next: unknown) =>
        ui.rerender(
            createElement(HelpDeskSettings, {
                ...props,
                remote: { ...props.remote, configRevision: 5, data: next as typeof props.remote.data },
            }),
        )
    return { ui, calls, update }
}
const section = (ui: ReturnType<typeof render>, name: string) => within(ui.getByRole("region", { name, hidden: true }))
async function submit(form: ReturnType<typeof within>) {
    await act(async () => {
        fireEvent.submit(
            form
                .getAllByRole("button", { hidden: true })
                .find((button: HTMLElement) => button.getAttribute("type") === "submit")!
                .closest("form")!,
        )
    })
}
// Clicks a form's button once and checks the form asks for no confirmation tick first
async function clickOnce(form: ReturnType<typeof within>, name: string) {
    assert.equal(form.queryAllByRole("checkbox", { hidden: true }).length, 0)
    const button = form.getByRole("button", { name, hidden: true }) as HTMLButtonElement
    assert.equal(button.disabled, false)
    await act(async () => {
        fireEvent.click(button)
    })
}

test("Forums come from the forum and media channels, and settings turn the greeting and reminder off when left empty", async () => {
    const { ui, calls } = setup({ settings, answers: [] })
    const add = section(ui, "Add help desk forum"),
        picker = add.getByRole("combobox", { name: "Forum", hidden: true })
    fireEvent.change(picker, { target: { value: "general" } })
    assert.ok(add.queryByRole("option", { name: "general", hidden: true }) === null)
    fireEvent.change(picker, { target: { value: "media" } })
    fireEvent.keyDown(picker, { key: "Enter" })
    await submit(add)
    const form = section(ui, "Help desk settings")
    fireEvent.change(form.getByLabelText("Greeting on new posts"), { target: { value: "" } })
    fireEvent.change(form.getByLabelText("Reply reminder after hours"), { target: { value: "200" } })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes("between 1 and 168"))
    fireEvent.change(form.getByLabelText("Reply reminder after hours"), { target: { value: "" } })
    fireEvent.click(form.getByLabelText("Give threads their channel's default auto-archive time"))
    await submit(form)
    assert.deepEqual(calls, [
        { type: "forum-add", channelId: "151" },
        {
            type: "settings",
            greeting: null,
            solvedTag: "Solved",
            nudgeHours: null,
            guardChannelId: null,
            autoArchive: true,
        },
    ])
})

test("Saved answers are added with a valid unused name, changed and removed on the first click", async () => {
    const { ui, calls } = setup({ settings, answers: [answer] })
    const add = section(ui, "Add saved answer")
    fireEvent.change(add.getByLabelText("Name"), { target: { value: "logs" } })
    fireEvent.change(add.getByLabelText("Title"), { target: { value: "Crash" } })
    fireEvent.change(add.getByLabelText("Answer text"), { target: { value: "Reinstall" } })
    await submit(add)
    assert.ok(add.getByRole("alert").textContent?.includes("An answer has this name"))
    fireEvent.change(add.getByLabelText("Name"), { target: { value: "crash" } })
    await submit(add)
    const remove = section(ui, "Remove answer logs")
    await clickOnce(remove, "Remove answer")
    assert.deepEqual(calls, [
        { type: "answer-set", name: "crash", title: "Crash", content: "Reinstall" },
        { type: "answer-remove", name: "logs" },
    ])
})

test("An answer removal after a change elsewhere removes the current answer without a review", async () => {
    const { ui, calls, update } = setup({ settings, answers: [answer] })
    update({ settings, answers: [{ ...answer, content: "Open the new settings", updatedAt: 2 }] })
    const remove = section(ui, "Remove answer logs")
    assert.equal(remove.queryByText("Changed elsewhere"), null)
    await clickOnce(remove, "Remove answer")
    assert.deepEqual(calls, [{ type: "answer-remove", name: "logs" }])
})

test("A served forum is removed on the first click", async () => {
    const { ui, calls } = setup({ settings, answers: [] })
    await clickOnce(section(ui, "Stop serving help"), "Remove forum")
    assert.deepEqual(calls, [{ type: "forum-remove", channelId: "150" }])
})
