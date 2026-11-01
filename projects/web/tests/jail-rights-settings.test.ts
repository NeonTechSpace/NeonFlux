import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { defaultJailSettings, type JailView } from "@neonflux/contracts/jail"
import { defaultRightsSettings, type RightsView } from "@neonflux/contracts/rights"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { JailSettings } from "../src/jail-settings.tsx"
import { RightsSettings } from "../src/rights-settings.tsx"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000" })
for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
}))
    Object.defineProperty(globalThis, name, { value, configurable: true })
const { render, fireEvent, cleanup, act } = await import("@testing-library/react")
afterEach(cleanup)
const at = Date.parse("2026-10-01T12:30:00Z")
const catalog = {
    serverId: "2",
    roles: [
        { id: "2", name: "everyone", position: 0 },
        { id: "60", name: "Jailed", position: 1 },
        { id: "50", name: "Staff", position: 2 },
    ],
    channels: [
        { id: "123", name: "general", type: 0 },
        { id: "124", name: "Info", type: 4 },
    ],
}
function setup<F extends "jail" | "rights">(family: F, data: unknown) {
    const calls: Array<DashboardConfigurationOperationMap[F]> = []
    const props = {
        remote: { family, serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap[F], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    }
    const element =
        family === "jail"
            ? createElement(JailSettings, props as unknown as ConfigSectionProps<"jail">)
            : createElement(RightsSettings, props as unknown as ConfigSectionProps<"rights">)
    return { ui: render(element), calls }
}
const save = async (ui: ReturnType<typeof render>, label: string) => {
    const button = ui.getAllByRole("button", { name: label, hidden: true })[0] as HTMLButtonElement
    await act(async () => {
        fireEvent.submit(button.closest("form")!)
    })
}
const jailView = (fields: Partial<JailView> = {}): JailView => ({
    settings: defaultJailSettings(),
    setup: null,
    count: 0,
    ...fields,
})
const rightsView = (fields: Partial<RightsView> = {}): RightsView => ({
    settings: defaultRightsSettings(),
    suspendedCount: 0,
    ...fields,
})

test("The jail section states its limits, shows setup problems and runs setup, with no way to jail a member from here", async () => {
    const { ui, calls } = setup(
        "jail",
        jailView({
            settings: { enabled: true, roleId: "60", channelId: "123" },
            setup: {
                state: "done",
                total: 4,
                done: 3,
                problems: [{ channelId: "123", state: "failed" }],
                moreProblems: 0,
                updatedAt: at,
            },
            count: 1,
        }),
    )
    assert.ok(ui.getByText(/a member overwrite someone adds by hand/))
    assert.ok(ui.getByText("Role: Jailed"))
    assert.ok(ui.getByText("Setup: 3 of 4 channels"))
    assert.ok(ui.getByText("general: Failed"))
    assert.ok(ui.getByText(/Jailed: 1\./))
    assert.equal(ui.queryByText(/Member 30/) === null, true)
    await save(ui, "Run setup")
    assert.deepEqual(calls, [{ type: "setup" }])
    assert.equal(ui.queryByRole("button", { name: /^Jail member/, hidden: true }) === null, true)
})

test("With no jail the section reads off and asks for nothing", () => {
    const { ui } = setup("jail", jailView())
    assert.ok(ui.getByText("Off. Members already jailed stay jailed"))
    assert.ok(ui.getByText("Role: None"))
})

test("The rights section states what it cannot limit and sends each change as one operation", async () => {
    const { ui, calls } = setup(
        "rights",
        rightsView({
            settings: {
                ...defaultRightsSettings(),
                enabled: true,
                grants: [{ roleId: "50", rights: ["kick", "ban"] }],
            },
            suspendedCount: 2,
        }),
    )
    assert.ok(ui.getByText(/cannot limit a hacked owner or Administrator/))
    assert.ok(ui.getByText(/NeonFlux's own token becomes the higher value\s+target/))
    assert.ok(ui.getByText("Staff: Kick, Ban and unban"))
    // Any manager reads this section, so it counts who is suspended and names nobody
    assert.ok(ui.getByText("2"))
    assert.equal(ui.queryByText(/Member \d+/) === null, true)
    await save(ui, "Revoke")
    assert.deepEqual(calls, [{ type: "revoke", roleId: "50" }])
})

test("A member is cleared by ID, and a bad ID is not sent", async () => {
    const { ui, calls } = setup("rights", rightsView())
    await save(ui, "Clear member")
    assert.deepEqual(calls, [])
    fireEvent.change(ui.getByLabelText("Member ID"), { target: { value: "12345" } })
    await save(ui, "Clear member")
    assert.deepEqual(calls, [{ type: "clear", userId: "12345" }])
})

test("A grant needs a role and a right, and a limit outside its range is not sent", async () => {
    const { ui, calls } = setup("rights", rightsView())
    assert.ok(ui.getByText("Off. Staff roles need the real Fluxer permission"))
    assert.ok(ui.getByText("No role holds a right"))
    await save(ui, "Grant")
    assert.deepEqual(calls, [])
    const count = ui.getAllByLabelText("Count")[0] as HTMLInputElement
    fireEvent.change(count, { target: { value: "51" } })
    await save(ui, "Save limit")
    assert.deepEqual(calls, [])
    fireEvent.change(count, { target: { value: "2" } })
    await save(ui, "Save limit")
    assert.deepEqual(calls, [{ type: "limit", right: "kick", count: 2, minutes: 10 }])
})
