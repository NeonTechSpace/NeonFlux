import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { AlertsSettings } from "../src/alerts-settings.tsx"

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
const catalog = { serverId: "2", roles: [], channels: [{ id: "123", name: "general", type: 0 }] }
const settings = {
    invites: false,
    bots: true,
    webhooks: false,
    privileges: false,
    impersonation: false,
    kickBots: false,
    deleteWebhooks: true,
    removePermissions: false,
    expectedBotIds: ["77"],
    expectedWebhookIds: [],
}
const invite = {
    ref: "0123456789abcdef",
    code: "AbC123",
    channelId: "123",
    inviterId: "55",
    uses: 2,
    maxUses: 0,
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    temporary: false,
}
function setup(data: unknown, userId = "55") {
    const calls: Array<DashboardConfigurationOperationMap["alerts"]> = []
    const props = {
        remote: { family: "alerts", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog: { ...catalog, ownerId: "9" },
        userId,
        queue: async (operation: DashboardConfigurationOperationMap["alerts"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"alerts">
    return { ui: render(createElement(AlertsSettings, props)), calls }
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

test("Each alert has its own switch, and expected bots and webhooks are pasted many at once, replaced or cleared in one save", async () => {
    const { ui, calls } = setup({ settings, invites: null })
    const privileges = section(ui, "Privilege changes")
    fireEvent.click(privileges.getByLabelText("Privilege changes on"))
    await submit(privileges)
    // Only Convex's 8,192 values in one array bound each list
    const webhooks = section(ui, "Expected webhooks")
    assert.ok(
        webhooks.getByText("An expected webhook raises no alert. Saving replaces the whole list, up to 8,192 IDs"),
    )
    const hooks = Array.from({ length: 60 }, (_, index) => String(9000 + index))
    const box = webhooks.getByLabelText(
        "Add several expected webhooks, apart or split by commas or lines",
    ) as HTMLTextAreaElement
    fireEvent.change(box, {
        target: { value: `${hooks.slice(0, 30).join(", ")}\n${hooks.slice(30).join(" ")} not-an-id` },
    })
    fireEvent.click(webhooks.getByRole("button", { name: "Add IDs", hidden: true }))
    assert.equal(box.value, "not-an-id")
    fireEvent.change(box, { target: { value: "" } })
    await submit(webhooks)
    // A replacement and a clear change the whole bot list before one save
    const bots = section(ui, "Expected bots")
    const listed = () =>
        bots.queryAllByLabelText(/^Expected bots \d+$/).map((input) => (input as HTMLInputElement).value)
    assert.deepEqual(listed(), ["77"])
    fireEvent.change(bots.getByLabelText("Add several expected bots, apart or split by commas or lines"), {
        target: { value: "90, 91" },
    })
    fireEvent.click(bots.getByRole("button", { name: "Replace the list with these IDs", hidden: true }))
    assert.deepEqual(listed(), ["90", "91"])
    fireEvent.click(bots.getByRole("button", { name: "Remove all expected bots", hidden: true }))
    assert.deepEqual(listed(), [])
    await submit(bots)
    assert.deepEqual(calls, [
        { type: "set", alert: "privileges", enabled: true },
        { type: "expected-set", kind: "webhook", ids: hooks },
        { type: "expected-set", kind: "bot", ids: [] },
    ])
})

test("The invite list refreshes on request, flags invites without limits and revokes one only after confirmation", async () => {
    const empty = setup({ settings, invites: null })
    const refresh = section(empty.ui, "Invites")
    assert.ok(refresh.getByText("Not read yet"))
    fireEvent.click(refresh.getByLabelText("Read the current invites"))
    await submit(refresh)
    assert.deepEqual(empty.calls, [{ type: "invites-refresh" }])
    cleanup()
    const { ui, calls } = setup({ settings, invites: { readAt: 1, invites: [invite], more: false } })
    assert.equal(ui.queryByText(/never shown/), null)
    const row = section(ui, "Invite AbC123 to general")
    assert.ok(row.getByText(/2 of unlimited uses\. Expires: Never\. Flagged: never expires, unlimited uses/))
    await submit(row)
    assert.equal(calls.length, 0)
    fireEvent.click(row.getByLabelText("Confirm revoking this invite. Members who joined with it stay"))
    await submit(row)
    assert.deepEqual(calls, [{ type: "invite-revoke", ref: "0123456789abcdef" }])
})

test("Older invites load a page at a time, and a revocation keeps the page it was on", async () => {
    const first = setup({ settings, invites: { readAt: 1, invites: [invite], more: true } })
    assert.equal(first.ui.queryByRole("region", { name: "Newer invites", hidden: true }), null)
    await clickOnce(section(first.ui, "Older invites"), "Show older invites")
    assert.deepEqual(first.calls, [{ type: "invites-refresh", offset: 100 }])
    cleanup()
    const { ui, calls } = setup({ settings, invites: { readAt: 1, invites: [invite], offset: 100, more: false } })
    assert.ok(section(ui, "Invites").getByText(/1 invite, from invite 101/))
    assert.equal(ui.queryByRole("region", { name: "Older invites", hidden: true }), null)
    await clickOnce(section(ui, "Newer invites"), "Show newer invites")
    const row = section(ui, "Invite AbC123 to general")
    fireEvent.click(row.getByLabelText("Confirm revoking this invite. Members who joined with it stay"))
    await submit(row)
    assert.deepEqual(calls, [
        { type: "invites-refresh" },
        { type: "invite-revoke", ref: "0123456789abcdef", offset: 100 },
    ])
})

test("Each acting alert has its own action switch, and managers who are not the owner see who may turn it on", async () => {
    const { ui, calls } = setup({ settings, invites: null })
    const kick = section(ui, "Kick unexpected bots")
    assert.ok(kick.getByText(/Turning it on needs the server owner or an Administrator/))
    fireEvent.click(kick.getByLabelText("Kick unexpected bots on"))
    await submit(kick)
    const webhooks = section(ui, "Delete unexpected webhooks")
    assert.equal((webhooks.getByLabelText("Delete unexpected webhooks on") as HTMLInputElement).checked, true)
    fireEvent.click(webhooks.getByLabelText("Delete unexpected webhooks on"))
    await submit(webhooks)
    assert.ok(section(ui, "Remove gained permissions"))
    assert.deepEqual(calls, [
        { type: "action", action: "kickBots", enabled: true },
        { type: "action", action: "deleteWebhooks", enabled: false },
    ])
    cleanup()
    const owner = setup({ settings, invites: null }, "9")
    assert.equal(owner.ui.queryByText(/Turning it on needs/), null)
})
