import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { TwitchSubscription, TwitchView } from "@neonflux/contracts/twitch"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { TwitchSettings } from "../src/twitch-settings.tsx"
import { localTime } from "../src/time.ts"

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
const LOGIN = "synthetic",
    OTHER = "another",
    at = Date.parse("2026-10-01T12:30:00Z")
const catalog = {
    serverId: "2",
    roles: [],
    channels: [
        { id: "123", name: "general", type: 0 },
        { id: "124", name: "news", type: 5 },
        { id: "125", name: "uploads", type: 15 },
        { id: "126", name: "Lounge", type: 2 },
    ],
}
const followed: TwitchSubscription = {
    twitchChannelId: LOGIN,
    channelId: "123",
    enabled: false,
    problem: "permission",
    createdAt: at,
    status: {
        title: "Synthetic Channel",
        connected: true,
        lastNotificationAt: at,
        latestStream: { streamId: "10001", title: "Synthetic stream", publishedAt: at },
    },
}
function setup(data: TwitchView) {
    const calls: Array<DashboardConfigurationOperationMap["twitch"]> = []
    const props = {
        remote: { family: "twitch", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["twitch"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"twitch">
    const ui = render(createElement(TwitchSettings, props))
    // Shows a newer snapshot, as when someone else changed the section
    const update = (next: typeof data) =>
        ui.rerender(
            createElement(TwitchSettings, { ...props, remote: { ...props.remote, configRevision: 5, data: next } }),
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
function pick(form: ReturnType<typeof within>, channel: string) {
    const picker = form.getByRole("combobox", { name: "Alert channel", hidden: true })
    fireEvent.change(picker, { target: { value: channel } })
    fireEvent.keyDown(picker, { key: "Enter" })
}

test("Following accepts a Twitch login or link and only channels that hold alerts", async () => {
    const { ui, calls } = setup({ configured: true, subscriptions: [] })
    const form = section(ui, "Follow a Twitch channel")
    const picker = form.getByRole("combobox", { name: "Alert channel", hidden: true })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: "Lounge" } })
    assert.equal(form.queryByRole("option", { name: /Lounge/, hidden: true }), null)
    fireEvent.change(form.getByLabelText("Twitch login or link"), { target: { value: "https://example.test/user" } })
    pick(form, "uploads")
    await submit(form)
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Twitch login or link"), {
        target: { value: `https://WWW.Twitch.tv/${LOGIN}` },
    })
    await submit(form)
    assert.deepEqual(calls, [{ type: "add", twitchChannelId: LOGIN, channelId: "125" }])
})

test("Saving the same alert channel turns a stopped subscription back on, while a running one has nothing to save", async () => {
    const { ui, calls } = setup({ configured: true, subscriptions: [followed] })
    const form = section(ui, `Alert channel for Synthetic Channel (${LOGIN})`)
    assert.equal(
        (form.getByRole("button", { name: "Save channel", hidden: true }) as HTMLButtonElement).disabled,
        false,
    )
    await submit(form)
    assert.deepEqual(calls, [{ type: "add", twitchChannelId: LOGIN, channelId: "123" }])
    cleanup()
    const running = setup({ configured: true, subscriptions: [{ ...followed, enabled: true }] }),
        again = section(running.ui, `Alert channel for Synthetic Channel (${LOGIN})`)
    assert.equal(
        (again.getByRole("button", { name: "Save channel", hidden: true }) as HTMLButtonElement).disabled,
        true,
    )
    await submit(again)
    assert.equal(running.calls.length, 0)
})

test("A followed channel shows its status and problem, moves its alerts and is removed on the first click", async () => {
    const { ui, calls } = setup({ configured: true, subscriptions: [followed] })
    const status = section(ui, `Status of Synthetic Channel (${LOGIN})`)
    assert.ok(status.getByText(/Off: NeonFlux cannot post in its alert channel/))
    assert.deepEqual(
        status
            .getAllByRole("listitem")
            .slice(1)
            .map((item) => item.textContent),
        [
            "Twitch subscription: Confirmed",
            `Last notification: ${localTime(at)}`,
            "Last post: None yet",
            `Latest stream: Synthetic stream, started ${localTime(at)}`,
        ],
    )
    assert.equal(
        status.getByRole("link", { name: "Synthetic stream" }).getAttribute("href"),
        "https://www.twitch.tv/synthetic",
    )
    const move = section(ui, `Alert channel for Synthetic Channel (${LOGIN})`)
    pick(move, "news")
    await submit(move)
    const remove = section(ui, `Stop alerts for Synthetic Channel (${LOGIN})`)
    await clickOnce(remove, "Remove channel")
    assert.deepEqual(calls, [
        { type: "add", twitchChannelId: LOGIN, channelId: "124" },
        { type: "remove", twitchChannelId: LOGIN },
    ])
    // Following the same channel again is caught before queueing
    const add = section(ui, "Follow a Twitch channel")
    fireEvent.change(add.getByLabelText("Twitch login or link"), { target: { value: LOGIN } })
    pick(add, "general")
    await submit(add)
    assert.equal(calls.length, 2)
    assert.match(add.getByRole("alert").textContent ?? "", /already follows that Twitch channel/)
})

test("A removal after a change elsewhere removes the current subscription without a review", async () => {
    const { ui, calls, update } = setup({ configured: true, subscriptions: [followed] })
    update({ configured: true, subscriptions: [{ ...followed, channelId: "124", enabled: true }] })
    const remove = section(ui, `Stop alerts for Synthetic Channel (${LOGIN})`)
    assert.equal(remove.queryByText("Changed elsewhere"), null)
    await clickOnce(remove, "Remove channel")
    assert.deepEqual(calls, [{ type: "remove", twitchChannelId: LOGIN }])
})

test("A full server or a deployment without Twitch alerts offers no add form", () => {
    const full = setup({
        configured: true,
        subscriptions: Array.from({ length: 10 }, (_, index) => ({
            ...followed,
            twitchChannelId: `streamer${index}`,
        })),
    })
    assert.ok(full.ui.getByText(/follows the maximum of 10 Twitch channels/))
    cleanup()
    const off = setup({ configured: false, subscriptions: [{ ...followed, twitchChannelId: OTHER }] })
    assert.ok(off.ui.getByText(/The bot operator has not set up Twitch alerts yet/))
    assert.ok(off.ui.queryByRole("region", { name: "Follow a Twitch channel", hidden: true }) === null)
})
