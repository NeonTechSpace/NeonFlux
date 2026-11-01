import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { FeedSubscription, FeedView } from "@neonflux/contracts/feeds"
import type { DashboardConfigurationOperationMap } from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { FeedSettings } from "../src/feed-settings.tsx"
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
const DID = "did:plc:syntheticaaaaaaaaaaaaaaa",
    HANDLE = "news.example.test",
    at = Date.parse("2026-10-01T12:30:00Z")
const catalog = {
    serverId: "2",
    roles: [],
    channels: [
        { id: "123", name: "general", type: 0 },
        { id: "124", name: "news", type: 5 },
        { id: "125", name: "posts", type: 15 },
        { id: "126", name: "Lounge", type: 2 },
    ],
}
const followed: FeedSubscription = {
    provider: "bluesky",
    accountId: DID,
    channelId: "123",
    enabled: false,
    problem: "permission",
    createdAt: at,
    status: { handle: HANDLE, name: "Synthetic News", lastReadAt: at, lastItemAt: at },
}
const { problem: _problem, ...stoppedFields } = followed
const running: FeedSubscription = { ...stoppedFields, enabled: true }
const view = (fields: Partial<FeedView> = {}): FeedView => ({
    xConfigured: true,
    xPaused: false,
    subscriptions: [],
    ...fields,
})
function setup(data: FeedView) {
    const calls: Array<DashboardConfigurationOperationMap["feeds"]> = []
    const props = {
        remote: { family: "feeds", serverId: "2", configRevision: 4, jobs: [], data },
        connected: true,
        catalog,
        queue: async (operation: DashboardConfigurationOperationMap["feeds"], revision: number) => {
            calls.push(operation)
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<"feeds">
    return { ui: render(createElement(FeedSettings, props)), calls }
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
function pick(form: ReturnType<typeof within>, channel: string) {
    const picker = form.getByRole("combobox", { name: "Post channel", hidden: true })
    fireEvent.change(picker, { target: { value: channel } })
    fireEvent.keyDown(picker, { key: "Enter" })
}
const account = (form: ReturnType<typeof within>, value: string) =>
    fireEvent.change(form.getByLabelText("Handle or link"), { target: { value } })

test("Following takes a service with a handle or link, and only channels that hold posts", async () => {
    const { ui, calls } = setup(view())
    const form = section(ui, "Follow an account")
    const picker = form.getByRole("combobox", { name: "Post channel", hidden: true })
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: "Lounge" } })
    assert.equal(form.queryByRole("option", { name: /Lounge/, hidden: true }) === null, true)
    account(form, "https://example.test/user")
    pick(form, "posts")
    await submit(form)
    assert.equal(calls.length, 0)
    account(form, `https://bsky.app/profile/${HANDLE}`)
    await submit(form)
    assert.deepEqual(calls[0], { type: "add", provider: "bluesky", accountId: `pending:${HANDLE}`, channelId: "125" })
})
test("An X account follows through the same form", async () => {
    const { ui, calls } = setup(view())
    const form = section(ui, "Follow an account")
    fireEvent.change(form.getByLabelText("Service"), { target: { value: "x" } })
    account(form, "https://x.com/Synthetic")
    pick(form, "news")
    await submit(form)
    assert.deepEqual(calls, [{ type: "add", provider: "x", accountId: "pending:synthetic", channelId: "124" }])
})
test("The section shows a followed account's state and its fix, moves its posts and removes it", async () => {
    const { ui, calls } = setup(view({ subscriptions: [followed] }))
    const label = `Bluesky: Synthetic News (${HANDLE})`
    const status = section(ui, `Status of ${label}`)
    assert.ok(status.getByText(/Off: NeonFlux cannot post in its channel/))
    assert.deepEqual(
        status
            .getAllByRole("listitem")
            .slice(1)
            .map((item) => item.textContent),
        [`Last check: ${localTime(at)}`, `Latest post: ${localTime(at)}`, "Last sent here: None yet"],
    )
    const move = section(ui, `Post channel for ${label}`)
    pick(move, "news")
    await submit(move)
    await submit(section(ui, `Stop posts of ${label}`))
    assert.deepEqual(calls, [
        { type: "add", provider: "bluesky", accountId: DID, channelId: "124" },
        { type: "remove", provider: "bluesky", accountId: DID },
    ])
    // Following the same account again is caught before queueing
    const add = section(ui, "Follow an account")
    account(add, HANDLE)
    pick(add, "general")
    await submit(add)
    assert.equal(calls.length, 2)
    assert.match(add.getByRole("alert").textContent ?? "", /already follows that account/)
})
test("A read problem shows with whether NeonFlux keeps trying", () => {
    const { ui } = setup(
        view({ subscriptions: [{ ...running, status: { handle: HANDLE, error: "Bluesky could not be read" } }] }),
    )
    assert.match(ui.container.textContent!, /Problem: Bluesky could not be read\. NeonFlux tries again on its own/)
    cleanup()
    const stopped = setup(
        view({
            subscriptions: [
                { ...running, status: { handle: HANDLE, stopped: true, error: "Bluesky has no such account" } },
            ],
        }),
    )
    assert.match(stopped.ui.container.textContent!, /Problem: Bluesky has no such account/)
    assert.doesNotMatch(stopped.ui.container.textContent!, /tries again/)
})
test("X is offered only with a key, and the month's spent reads are stated", () => {
    const off = setup(view({ xConfigured: false }))
    assert.match(off.ui.container.textContent!, /has not set up an X key, so only Bluesky works/)
    const service = section(off.ui, "Follow an account").getByLabelText("Service") as HTMLSelectElement
    assert.equal([...service.options].find((option) => option.value === "x")?.disabled, true)
    cleanup()
    const noKey = setup(
        view({
            xConfigured: false,
            subscriptions: [running, { ...running, provider: "x", accountId: "1000000000000000001" }],
        }),
    )
    assert.match(noKey.ui.container.textContent!, /Bluesky: Synthetic News \(news\.example\.test\) in general: On/)
    assert.match(noKey.ui.container.textContent!, /X: Synthetic News \(news\.example\.test\) in general: Off/)
    cleanup()
    const paused = setup(view({ xPaused: true }))
    assert.match(paused.ui.container.textContent!, /used its X reads for this month/)
})
test("A server at the limit is told so and cannot add another", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
        ...followed,
        accountId: `did:plc:synthetic${"abcdefghij"[index]!.repeat(15)}`,
    }))
    const { ui } = setup(view({ subscriptions: rows }))
    assert.match(ui.container.textContent!, /maximum of 10 accounts/)
    assert.equal(ui.queryByRole("region", { name: "Follow an account", hidden: true }) === null, true)
})
