import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { DashboardVoiceMember } from "@neonflux/backend/dashboard-contracts"
import type { VoiceMemberOperation } from "@neonflux/contracts/voice"
import { VoiceRoomMember } from "../src/voice-room-member.tsx"

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

const view = {
    name: "Study hall",
    userLimit: 4,
    hidden: false,
    locked: false,
    region: null,
    observedAt: Date.now(),
}
const room = (fields: Partial<DashboardVoiceMember["rooms"][number]> = {}) => ({
    channelId: "100",
    ownerId: "20",
    generatorChannelId: "50",
    createdAt: 1,
    view,
    ...fields,
})
function open(remote: DashboardVoiceMember, connected = true) {
    const requests: VoiceMemberOperation[] = []
    const client = {
        connectionState: () => ({ isWebSocketConnected: true }),
        subscribeToConnectionState: () => () => {},
        watchQuery: (ref: unknown) => {
            assert.equal(getFunctionName(ref as never), "voice:member")
            return { localQueryResult: () => remote, onUpdate: () => () => {} }
        },
        mutation: async (ref: unknown, args: { operation: VoiceMemberOperation }) => {
            assert.equal(getFunctionName(ref as never), "voice:request")
            requests.push(args.operation)
            return { jobId: "job1" }
        },
    } as unknown as ConvexReactClient
    const ui = render(createElement(VoiceRoomMember, { client, sessionToken: "token", serverId: "5", connected }))
    return { ui, requests }
}
const click = async (ui: ReturnType<typeof render>, name: string) => {
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name }))
    })
}

test("A member without a room is told how to get one and sends nothing", async () => {
    const { ui, requests } = open({ serverId: "5", rooms: [], requests: [] })
    assert.ok(ui.getByText(/You own no temporary voice room/))
    assert.equal(ui.queryByRole("button", { name: "Lock" }) === null, true)
    await act(async () => {})
    assert.deepEqual(requests, [])
})

test("A room the bot has not read yet asks for one read when the page opens, and a recent read asks for none", async () => {
    const unread = open({ serverId: "5", rooms: [room({ view: undefined as never })], requests: [] })
    await act(async () => {})
    assert.deepEqual(unread.requests, [{ type: "lookup" }])
    cleanup()
    const recent = open({ serverId: "5", rooms: [room()], requests: [] })
    await act(async () => {})
    assert.deepEqual(recent.requests, [])
    assert.ok(recent.ui.getByText(/Open to join, visible, up to 4 members, automatic region/))
})

test("Every control sends its request, and the bot decides the rest", async () => {
    const { ui, requests } = open({ serverId: "5", rooms: [room()], requests: [] })
    await click(ui, "Lock")
    await click(ui, "Hide")
    fireEvent.change(ui.getByLabelText("Room name"), { target: { value: " Late night " } })
    await click(ui, "Rename")
    fireEvent.change(ui.getByLabelText("Member limit, 0 for none"), { target: { value: "0" } })
    await click(ui, "Set limit")
    fireEvent.change(ui.getByLabelText("Voice region, empty for automatic"), { target: { value: "eu-west" } })
    await click(ui, "Set region")
    fireEvent.change(ui.getByLabelText("Member ID"), { target: { value: "<@100000000000002>" } })
    await click(ui, "Allow")
    await click(ui, "Block")
    await click(ui, "Give room")
    const roomId = "100",
        userId = "100000000000002"
    assert.deepEqual(requests, [
        { type: "lock", roomId },
        { type: "hide", roomId },
        { type: "rename", roomId, name: "Late night" },
        { type: "limit", roomId, limit: 0 },
        { type: "region", roomId, region: "eu-west" },
        { type: "allow", roomId, userId },
        { type: "block", roomId, userId },
        { type: "transfer", roomId, userId },
    ])
})

test("A locked and hidden room offers unlock and show, and bad values send nothing", async () => {
    const { ui, requests } = open({
        serverId: "5",
        rooms: [room({ view: { ...view, locked: true, hidden: true, region: "eu-west" } })],
        requests: [],
    })
    assert.ok(ui.getByText(/Locked, hidden, up to 4 members, region eu-west/))
    await click(ui, "Unlock")
    await click(ui, "Show")
    assert.deepEqual(requests, [
        { type: "unlock", roomId: "100" },
        { type: "show", roomId: "100" },
    ])
    fireEvent.change(ui.getByLabelText("Member ID"), { target: { value: "someone" } })
    assert.equal((ui.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled, true)
    fireEvent.change(ui.getByLabelText("Member limit, 0 for none"), { target: { value: "abc" } })
    assert.equal((ui.getByRole("button", { name: "Set limit" }) as HTMLButtonElement).disabled, true)
    fireEvent.change(ui.getByLabelText("Voice region, empty for automatic"), { target: { value: "not*valid" } })
    assert.equal((ui.getByRole("button", { name: "Set region" }) as HTMLButtonElement).disabled, true)
})

test("A pending request holds the controls and a refusal shows with its reason", async () => {
    const { ui } = open({
        serverId: "5",
        rooms: [room()],
        requests: [
            {
                id: "job2",
                actorId: "20",
                operation: { type: "lock", roomId: "100" },
                state: "failed",
                createdAt: 1,
                expiresAt: 2,
                error: "They must be in your room",
            },
            {
                id: "job3",
                actorId: "20",
                operation: { type: "hide", roomId: "100" },
                state: "queued",
                createdAt: 1,
                expiresAt: 2,
            },
        ],
    })
    assert.equal((ui.getByRole("button", { name: "Lock" }) as HTMLButtonElement).disabled, true)
    assert.ok(ui.getByText("They must be in your room"))
    assert.ok(ui.getByText("Lock: Failed"))
    assert.ok(ui.getByText("Hide: Pending"))
})
