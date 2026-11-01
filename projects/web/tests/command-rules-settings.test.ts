import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type {
    DashboardConfigurationDataMap,
    DashboardConfigurationOperationMap,
} from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { CommandRulesSettings } from "../src/command-rules-settings.tsx"

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
    roles: [{ id: "40", name: "Members", position: 1 }],
    channels: [
        { id: "123", name: "bot-commands", type: 0 },
        { id: "124", name: "general", type: 0 },
        { id: "125", name: "Lobby", type: 2 },
    ],
}
function setup(data: DashboardConfigurationDataMap["commandrules"]) {
    const calls: Array<DashboardConfigurationOperationMap["commandrules"]> = []
    const props = {
        remote: { family: "commandrules", serverId: "2", configRevision: 3, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["commandrules"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"commandrules">
    return { ui: render(createElement(CommandRulesSettings, props)), calls }
}
const section = (ui: ReturnType<typeof render>, name: string) => within(ui.getByRole("region", { name, hidden: true }))
async function pick(form: ReturnType<typeof within>, label: string, option: string) {
    const picker = form.getByRole("combobox", { name: label, hidden: true })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: option } })
    fireEvent.click(form.getByRole("option", { name: new RegExp(option), hidden: true }))
}
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

test("A rule is saved with its channels and roles, and only commands a rule can limit are offered", async () => {
    const { ui, calls } = setup({ rules: [] })
    assert.ok(ui.getByText(/Rules 0\/25/))
    const form = section(ui, "Add or change a rule")
    const options = [...(form.getByLabelText("Command") as HTMLSelectElement).options].map((option) => option.value)
    assert.ok(options.includes("rank"))
    assert.ok(options.includes("level"))
    for (const critical of ["mod", "defcon", "help", "commands", "ticket", "lockdown"])
        assert.ok(!options.includes(critical), `${critical} is offered`)
    await submit(form)
    assert.deepEqual(calls, [], "a rule needs a channel or a role")
    assert.ok(ui.getByText("Choose a channel or a role"))
    await pick(form, "Works in these channels", "bot-commands")
    await pick(form, "Only these roles can use it", "Members")
    await submit(form)
    assert.deepEqual(calls, [{ type: "set", command: "rank", channelIds: ["123"], roleIds: ["40"] }])
})

test("A saved rule is shown by name, changed and removed", async () => {
    const { ui, calls } = setup({
        rules: [{ command: "rank", channelIds: ["123"], roleIds: [], updatedAt: 1 }],
    })
    assert.ok(ui.getByText("!rank: bot-commands. Everyone"))
    const change = section(ui, "Rule for !rank")
    await pick(change, "Only these roles can use it", "Members")
    await submit(change)
    assert.deepEqual(calls.at(-1), { type: "set", command: "rank", channelIds: ["123"], roleIds: ["40"] })
    await submit(section(ui, "Remove the rule for !rank"))
    assert.deepEqual(calls.at(-1), { type: "clear", command: "rank" })
})
