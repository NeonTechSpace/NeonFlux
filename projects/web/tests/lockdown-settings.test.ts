import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { defaultAntiNukeSettings, type AntiNukeIncident, type AntiNukeView } from "@neonflux/contracts/anti-nuke"
import type { LockdownStatus } from "@neonflux/contracts/lockdown"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { AntiNukeIncidents } from "../src/antinuke-incidents.tsx"
import { AntiNukeSettings } from "../src/antinuke-settings.tsx"
import { LockdownSettings } from "../src/lockdown-settings.tsx"

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
    roles: [],
    channels: [
        { id: "123", name: "general", type: 0 },
        { id: "124", name: "Info", type: 4 },
    ],
}
function setupLockdown(data: LockdownStatus) {
    const calls: Array<DashboardConfigurationOperationMap["lockdown"]> = []
    const props = {
        remote: { family: "lockdown", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["lockdown"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"lockdown">
    return { ui: render(createElement(LockdownSettings, props)), calls }
}
function setupAntiNuke(data: AntiNukeView) {
    const calls: Array<DashboardConfigurationOperationMap["antinuke"]> = []
    const props = {
        remote: { family: "antinuke", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["antinuke"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"antinuke">
    return { ui: render(createElement(AntiNukeSettings, props)), calls }
}
const save = async (ui: ReturnType<typeof render>, label: string) => {
    const button = ui.getByRole("button", { name: label, hidden: true }) as HTMLButtonElement
    await act(async () => {
        fireEvent.submit(button.closest("form")!)
    })
}
const check = (ui: ReturnType<typeof render>, label: RegExp | string) =>
    fireEvent.click(ui.getByLabelText(label) as HTMLInputElement)
const counts = { queued: 1, writing: 1, locked: 40, uncertain: 1, failed: 2, skipped: 5, restored: 0 }

test("With no lockdown the section offers to start one, with an optional reason", async () => {
    const { ui, calls } = setupLockdown({ settings: { exemptChannelIds: [] }, lockdown: null })
    assert.ok(ui.getByText(/No lockdown has run/))
    assert.ok(ui.getByText(/A channel created during a lockdown is not touched/))
    fireEvent.change(ui.getByLabelText(/Reason/), { target: { value: "A raid" } })
    // A typed reason alone starts nothing
    await save(ui, "Start lockdown")
    assert.deepEqual(calls, [])
    assert.ok(ui.getByText("Confirm locking the server", { selector: "[role=alert], .notice, .error, p" }))
    check(ui, "Confirm locking the server")
    await save(ui, "Start lockdown")
    assert.deepEqual(calls, [{ type: "on", reason: "A raid" }])
})

test("A lockdown that is on shows its counts and problem channels, lifts and reads uncertain channels", async () => {
    const { ui, calls } = setupLockdown({
        settings: { exemptChannelIds: [] },
        lockdown: {
            state: "active",
            origin: "antinuke",
            reason: "Anti-nuke incident 3",
            startedAt: at,
            counts,
            problems: [{ channelId: "123", state: "uncertain", phase: "lock", bits: "2048" }],
        },
    })
    assert.ok(ui.getByText("Locked: 40"))
    assert.ok(ui.getByText("Waiting: 2"))
    assert.ok(ui.getByText("general: Uncertain"))
    assert.ok(ui.getByText(/by anti-nuke: Anti-nuke incident 3/))
    check(ui, "Confirm lifting the lockdown")
    await save(ui, "Lift lockdown")
    await save(ui, "Read uncertain channels")
    assert.deepEqual(calls, [{ type: "off" }, { type: "settle" }])
})

test("While a lockdown is on, failed channels can be tried again", async () => {
    const row = { origin: "command" as const, reason: "", startedAt: at, problems: [], state: "active" as const }
    const owing = setupLockdown({ settings: { exemptChannelIds: [] }, lockdown: { ...row, counts } })
    await save(owing.ui, "Repeat failed channels")
    assert.deepEqual(owing.calls, [{ type: "on" }])
    cleanup()
    const fine = setupLockdown({
        settings: { exemptChannelIds: [] },
        lockdown: { ...row, counts: { ...counts, failed: 0 } },
    })
    assert.equal(fine.ui.queryByRole("button", { name: "Repeat failed channels", hidden: true }) === null, true)
})

test("An ended lockdown that owes channels offers to repeat them, and one being lifted offers no start", async () => {
    const row = { origin: "command" as const, reason: "", startedAt: at, counts, problems: [] }
    const owing = setupLockdown({ settings: { exemptChannelIds: [] }, lockdown: { ...row, state: "ended" } })
    assert.equal(owing.ui.queryByRole("button", { name: "Start lockdown", hidden: true }) === null, true)
    check(owing.ui, "Confirm lifting the lockdown")
    await save(owing.ui, "Repeat restoring channels")
    assert.deepEqual(owing.calls, [{ type: "off" }])
    cleanup()
    const lifting = setupLockdown({ settings: { exemptChannelIds: [] }, lockdown: { ...row, state: "restoring" } })
    assert.equal(lifting.ui.queryByRole("button", { name: "Start lockdown", hidden: true }) === null, true)
    assert.equal(lifting.ui.queryByRole("button", { name: "Lift lockdown", hidden: true }) === null, true)
    cleanup()
    const clean = {
        ...row,
        state: "ended" as const,
        counts: { ...counts, failed: 0, uncertain: 0 },
    }
    const done = setupLockdown({ settings: { exemptChannelIds: [] }, lockdown: clean })
    assert.ok(done.ui.getByRole("button", { name: "Start lockdown", hidden: true }))
})

test("Anti-nuke's settings save with the same operations as chat, and the section shows only how many incidents there are", async () => {
    const { ui, calls } = setupAntiNuke({
        settings: defaultAntiNukeSettings(),
        incidentCount: 4,
        unconfirmedCount: 1,
    })
    assert.ok(ui.getByText(/cannot stop them/))
    assert.ok(ui.getByText("4 kept, 1 not confirmed"))
    assert.ok(ui.getByText(/under Private cases/))
    fireEvent.click(ui.getByRole("checkbox", { name: "Anti-nuke on", hidden: true }))
    await save(ui, "Save anti-nuke")
    fireEvent.change(ui.getByRole("combobox", { name: "Mode", hidden: true }), { target: { value: "enforce" } })
    await save(ui, "Save mode")
    check(ui, "Incidents may start the lockdown")
    await save(ui, "Save lockdown")
    fireEvent.change(ui.getAllByLabelText("Count")[2]!, { target: { value: "3" } })
    await save(ui, "Save channels deleted")
    assert.deepEqual(calls, [
        { type: "module", enabled: true },
        { type: "mode", mode: "enforce" },
        { type: "lockdown", enabled: true },
        { type: "limit", limit: "channels", value: { count: 3, seconds: 30 } },
    ])
})

function incidentClient({ refused = false, conflict = false } = {}) {
    const queued: unknown[] = [],
        listeners = new Set<() => void>()
    let jobs: unknown[] = []
    const client = {
        watchQuery: () => ({
            localQueryResult: () => {
                if (refused) throw new Error("Not a manager")
                return { configRevision: 7, jobs }
            },
            onUpdate: (listener: () => void) => {
                listeners.add(listener)
                return () => listeners.delete(listener)
            },
        }),
        action: async (_ref: unknown, args: { operation: unknown; expectedConfigRevision: number }) => {
            queued.push([args.operation, args.expectedConfigRevision])
            return conflict
                ? { queued: false, conflict: true, revision: 8 }
                : { queued: true, conflict: false, revision: 7, jobId: `job${queued.length}` }
        },
    }
    const publish = (next: unknown[]) =>
        act(async () => {
            jobs = next
            for (const listener of listeners) listener()
        })
    return { client, queued, publish }
}
const incident: AntiNukeIncident = {
    incidentNo: 3,
    actorId: "55",
    actorKind: "staff",
    rule: "channels",
    counts: { "channel-delete": 6 },
    firstAt: at - 5000,
    lastAt: at,
    mode: "enforce",
    response: "strip",
    outcome: "succeeded",
    removedRoleIds: ["70"],
    lockdown: "not-allowed",
    createdAt: at,
}
const button = (ui: ReturnType<typeof render>, name: string) =>
    ui.getByRole("button", { name, hidden: true }) as HTMLButtonElement
const job = (id: string, state: string, operation: object, extra: object = {}) => ({
    id,
    state,
    createdAt: at,
    operation,
    ...extra,
})

test("Each incident in Private cases acts on itself by number after its own box is ticked, and shows what stayed out", async () => {
    const { client, queued, publish } = incidentClient()
    const ui = render(
        createElement(AntiNukeIncidents, {
            client: client as never,
            sessionToken: "synthetic-session",
            serverId: "2",
            changed: () => {},
            incidents: [
                { ...incident, incidentNo: 5, outcome: "uncertain" },
                incident,
                { ...incident, incidentNo: 2, outcome: "failed" },
                { ...incident, incidentNo: 1, restoreOutcome: "failed", restoreLeftRoleIds: ["70"] },
                { ...incident, incidentNo: 7, restoredAt: at, restoreOutcome: "succeeded", restoreGoneRoleIds: ["71"] },
            ],
        }),
    )
    assert.ok(ui.getAllByText(/Lockdown wanted, but not allowed/).length > 0)
    // An older incident restores itself, not the newest one, and only with its own box ticked
    assert.equal(button(ui, "Give roles back from incident 3").disabled, true)
    check(ui, "Confirm giving back what incident 3 removed")
    assert.equal(button(ui, "Give roles back from incident 5").disabled, true)
    await act(async () => {
        fireEvent.click(button(ui, "Give roles back from incident 3"))
    })
    assert.deepEqual(queued, [[{ type: "restore", incidentNo: 3 }, 7]])
    // A strip that failed took nothing, so it offers nothing to give back
    assert.equal(ui.queryByRole("button", { name: "Give roles back from incident 2", hidden: true }) === null, true)
    assert.ok(ui.getByText(/Restore not finished: Role 70 ranks at or above NeonFlux/))
    assert.ok(ui.getByText(/Roles given back, except Role 71, deleted since/))
    await publish([job("job1", "applied", { type: "restore", incidentNo: 3 })])
    await act(async () => {
        fireEvent.click(button(ui, "Read incident 5"))
    })
    assert.deepEqual(queued.at(-1), [{ type: "settle", incidentNo: 5 }, 7])
})

test("An action waits for its job, shows how it went here and reads the list again only once it finished", async () => {
    const { client, publish } = incidentClient()
    let changed = 0
    const ui = render(
        createElement(AntiNukeIncidents, {
            client: client as never,
            sessionToken: "synthetic-session",
            serverId: "2",
            changed: () => changed++,
            incidents: [{ ...incident, outcome: "uncertain" }],
        }),
    )
    // The note is always there, since only the bot can tell who is an Administrator
    assert.ok(ui.getByText(/need the server owner or an Administrator/))
    await act(async () => {
        fireEvent.click(button(ui, "Read incident 3"))
    })
    assert.equal(changed, 0)
    assert.equal(button(ui, "Read incident 3").disabled, true)
    await publish([job("job1", "queued", { type: "settle", incidentNo: 3 })])
    assert.equal(changed, 0)
    assert.match(ui.getByRole("status").textContent!, /Reading the member for incident 3/)
    assert.equal(button(ui, "Read incident 3").disabled, true)
    const refusal = "Only the server owner or an Administrator can make this change"
    await publish([job("job1", "failed", { type: "settle", incidentNo: 3 }, { error: refusal })])
    assert.equal(changed, 1)
    assert.ok(ui.getByText(refusal))
    assert.equal(button(ui, "Read incident 3").disabled, false)
    // A later update of the same finished job reads nothing again
    await publish([job("job1", "failed", { type: "settle", incidentNo: 3 }, { error: refusal })])
    assert.equal(changed, 1)
})

test("A request the backend calls a conflict is no success, and a viewer who manages nothing can only read", async () => {
    const conflicted = incidentClient({ conflict: true })
    let changed = 0
    const ui = render(
        createElement(AntiNukeIncidents, {
            client: conflicted.client as never,
            sessionToken: "synthetic-session",
            serverId: "2",
            changed: () => changed++,
            incidents: [{ ...incident, outcome: "uncertain" }],
        }),
    )
    await act(async () => {
        fireEvent.click(button(ui, "Read incident 3"))
    })
    assert.match(ui.getByRole("alert").textContent!, /settings changed just now, so nothing was asked/)
    assert.equal(changed, 0)
    assert.equal(button(ui, "Read incident 3").disabled, false)
    cleanup()
    const viewer = incidentClient({ refused: true })
    const read = render(
        createElement(AntiNukeIncidents, {
            client: viewer.client as never,
            sessionToken: "synthetic-session",
            serverId: "2",
            changed: () => {},
            incidents: [incident],
        }),
    )
    assert.ok(read.getByText(/need the server owner or an Administrator/))
    assert.equal(button(read, "Give roles back from incident 3").disabled, true)
})
