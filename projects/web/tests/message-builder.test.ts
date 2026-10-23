import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { ConvexError } from "convex/values"
import { JSDOM } from "jsdom"
import { createElement, useState } from "react"
import type { ConvexReactClient } from "convex/react"
import type { PublishingDraft } from "@neonflux/contracts/publishing"
import type { DashboardMessageJob } from "@neonflux/backend/dashboard-contracts"
import { MessageBuilder } from "../src/message-builder.tsx"
import { Messages, MessagesSection } from "../src/messages.tsx"
import { SavedMessageSend } from "../src/saved-message-send.tsx"
import { DraftScopeProvider } from "../src/drafts.ts"
import { SearchPicker, fuzzyOptions } from "../src/search-picker.tsx"
import {
    importMessage,
    validateMessage,
    validateResponseMessage,
    responseMessage,
    responseReplyMessage,
} from "../src/message-content.ts"
import { publicationChannels, selectableRoles } from "../src/catalog-options.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000" })
for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
}))
    Object.defineProperty(globalThis, name, { value, configurable: true })
const { render, fireEvent, cleanup, act, within } = await import("@testing-library/react")
afterEach(() => {
    cleanup()
    dom.window.sessionStorage.clear()
})
const catalog = { serverId: "2", roles: [], channels: [{ id: "123", name: "Announcements", type: 0 }] }

test("Channel search ignores capitalization and emoji presentation while preserving original names", () => {
    const options = [
        { id: "12345", name: "📢 Announcements" },
        { id: "67890", name: "☀️ Summer Café" },
        { id: "24680", name: "🏳️\u200d🌈 Community" },
    ]
    assert.deepEqual(fuzzyOptions(options, "ANNOUNCE"), [options[0]])
    assert.deepEqual(fuzzyOptions(options, "📢 ANCM"), [options[0]])
    assert.deepEqual(fuzzyOptions(options, "☀ SUMMER CAFE\u0301"), [options[1]])
    assert.deepEqual(fuzzyOptions(options, "🏳\u200d🌈 COMMUNITY"), [options[2]])
    assert.deepEqual(fuzzyOptions(options, "123"), [options[0]])
    const selected: string[][] = []
    const ui = render(
        createElement(SearchPicker, {
            label: "Channel",
            options,
            value: [],
            onChange: (value) => selected.push(value),
        }),
    )
    const input = ui.getByRole("combobox", { name: "Channel" })
    fireEvent.change(input, { target: { value: "📢 ANN" } })
    assert.ok(ui.getByRole("option", { name: "📢 Announcements 12345" }))
    fireEvent.keyDown(input, { key: "Enter" })
    assert.deepEqual(selected, [["12345"]])
})

test("Choices show an ID beside the name only when it is a Fluxer ID that differs from the name", () => {
    const ui = render(
        createElement(SearchPicker, {
            label: "Choice",
            options: [
                { id: JSON.stringify({ kind: "template", name: "welcome", revision: 9 }), name: "welcome" },
                { id: "Europe/Berlin", name: "Europe/Berlin" },
            ],
            value: [],
            onChange: () => {},
        }),
    )
    fireEvent.change(ui.getByRole("combobox", { name: "Choice" }), { target: { value: "e" } })
    assert.deepEqual(
        ui
            .getAllByRole("option")
            .map((option) => [option.getAttribute("aria-label"), option.textContent])
            .sort(),
        [
            ["Europe/Berlin", "Europe/Berlin"],
            ["welcome", "welcome"],
        ],
    )
})

test("Fuzzy server choices support keyboard selection and Escape without changing the selection", () => {
    const options = [
        { id: "2", name: "NeonFlux community" },
        { id: "3", name: "Testing server" },
    ]
    assert.deepEqual(fuzzyOptions(options, "nfx"), [options[0]])
    const selected: string[][] = []
    const ui = render(
        createElement(SearchPicker, {
            label: "Server",
            options,
            value: ["2"],
            onChange: (value) => selected.push(value),
        }),
    )
    const input = ui.getByRole("combobox", { name: "Server" })
    fireEvent.change(input, { target: { value: "tsrv" } })
    fireEvent.keyDown(input, { key: "Escape" })
    assert.deepEqual(selected, [])
    assert.equal(input.getAttribute("aria-expanded"), "false")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    assert.deepEqual(selected, [["3"]])
})

test("JSON import preserves the complete content contract and rejects unsupported keys and limits", () => {
    const content = {
        content: "Hello",
        embed: {
            title: "News",
            description: "Details",
            url: "https://example.com",
            color: 42,
            timestamp: "2026-10-05T10:00:00Z",
            author: { name: "Team", url: "https://example.com", iconUrl: "https://example.com/icon.png" },
            footer: { text: "Footer", iconUrl: "https://example.com/footer.png" },
            image: { url: "https://example.com/image.png", description: "Image" },
            thumbnail: { url: "https://example.com/thumbnail.png", description: "Thumbnail" },
            fields: [{ name: "A", value: "B", inline: true }],
        },
    }
    assert.deepEqual(importMessage(JSON.stringify(content)), content)
    assert.throws(() => importMessage('{"content":"hello","embeds":[]}'), /unsupported/)
    assert.throws(() => validateMessage({ content: "a".repeat(2001) }), /2000/)
    assert.throws(
        () =>
            validateMessage({
                content: "",
                embed: { fields: Array.from({ length: 26 }, () => ({ name: "a", value: "b" })) },
            }),
        /twenty-five/,
    )
    assert.throws(
        () =>
            validateMessage({
                content: "",
                embed: { title: "a".repeat(256), description: "b".repeat(4096), footer: { text: "c".repeat(2048) } },
            }),
        /six thousand/,
    )
    assert.throws(() => validateMessage({ content: "", embed: { image: { url: "javascript:alert(1)" } } }), /HTTP/)
    assert.throws(() => validateMessage({ content: "", embed: { timestamp: "2026-02-30T10:00:00Z" } }), /calendar/)
})

test("Catalog options exclude everyone, voice channels, and categories from role and publication controls", () => {
    const source = {
        serverId: "2",
        roles: [
            { id: "2", name: "@everyone", position: 0 },
            { id: "3", name: "Member", position: 1 },
        ],
        channels: [
            { id: "10", name: "Text", type: 0 },
            { id: "11", name: "Announcements", type: 5 },
            { id: "12", name: "Voice", type: 2 },
            { id: "13", name: "Category", type: 4 },
        ],
    }
    assert.deepEqual(
        selectableRoles(source).map((role) => role.id),
        ["3"],
    )
    assert.deepEqual(
        publicationChannels(source).map((channel) => channel.id),
        ["10", "11"],
    )
})

test("Response composition preserves supported replies and rejects rich fields without dropping them", () => {
    const reply = { type: "embed" as const, embed: { title: "Hello {user.name}", description: "Welcome", color: 42 } }
    assert.deepEqual(responseMessage(JSON.stringify(responseReplyMessage(reply))), reply)
    assert.deepEqual(responseMessage('{"content":"Hello {user.name}"}'), { type: "text", text: "Hello {user.name}" })
    assert.throws(
        () => validateResponseMessage({ content: "Text", embed: { description: "Embed" } }),
        /Choose message text or an embed/,
    )
    assert.throws(() => responseMessage('{"content":"","embed":{"title":"Only title"}}'), /description/)
    assert.throws(() => validateResponseMessage({ content: "", embed: { description: "x".repeat(4001) } }), /4000/)
    for (const unsupported of [
        { fields: [{ name: "A", value: "B" }] },
        { url: "https://example.com" },
        { author: { name: "A" } },
    ])
        assert.throws(
            () => validateResponseMessage({ content: "", embed: { description: "Hello", ...unsupported } }),
            /title, description and color only/,
        )
})

test("Response builder exposes basic embed fields and rejects unsupported JSON while keeping the draft", () => {
    let latest = ""
    function Harness() {
        const [value, setValue] = useState(
            '{"content":"","embed":{"title":"Saved","description":"Keep me","color":42}}',
        )
        latest = value
        return createElement(MessageBuilder, { value, onChange: setValue, profile: "response" })
    }
    const ui = render(createElement(Harness))
    assert.ok(ui.queryByRole("button", { name: "Add field" }) === null)
    assert.ok(ui.queryByRole("textbox", { name: "Title URL" }) === null)
    assert.equal(ui.getByRole("textbox", { name: "Embed description" }).getAttribute("maxlength"), "4000")
    fireEvent.click(ui.getByRole("button", { name: "Import / export JSON" }))
    fireEvent.change(ui.getByRole("textbox", { name: "Message JSON" }), {
        target: { value: '{"content":"","embed":{"description":"New","fields":[{"name":"A","value":"B"}]}}' },
    })
    fireEvent.click(ui.getByRole("button", { name: "Import JSON" }))
    assert.match(ui.getByRole("alert").textContent ?? "", /title, description and color only/)
    assert.equal(JSON.parse(latest).embed.description, "Keep me")
    fireEvent.change(ui.getByRole("textbox", { name: "Message JSON" }), {
        target: { value: '{"content":"","embed":{"description":"New","color":99}}' },
    })
    fireEvent.click(ui.getByRole("button", { name: "Import JSON" }))
    fireEvent.click(ui.getByRole("button", { name: "Export JSON" }))
    assert.deepEqual(JSON.parse((ui.getByRole("textbox", { name: "Message JSON" }) as HTMLTextAreaElement).value), {
        content: "",
        embed: { description: "New", color: 99 },
    })
})

test("Responses refuse placeholders the backend does not fill in, in the preview and on save", () => {
    assert.throws(() => responseMessage('{"content":"Hello {unknown}"}'), /placeholders: \{user\.name\}/)
    assert.throws(
        () => responseMessage('{"content":"","embed":{"title":"{server.name}","description":"Welcome"}}'),
        /placeholders/,
    )
    assert.deepEqual(responseMessage('{"content":"Hello {user.mention} in {channel.id}"}'), {
        type: "text",
        text: "Hello {user.mention} in {channel.id}",
    })
    const ui = render(
        createElement(MessageBuilder, { value: '{"content":"Hi {unknown}"}', onChange: () => {}, profile: "response" }),
    )
    assert.match(
        within(ui.getByRole("region", { name: "Message preview" })).getByRole("status").textContent ?? "",
        /placeholders/,
    )
})

test("Builder imports and exports JSON, adds inline fields, removes fields, and previews the draft", () => {
    let latest = ""
    function Harness() {
        const [value, setValue] = useState('{"content":""}')
        latest = value
        return createElement(MessageBuilder, { value, onChange: setValue })
    }
    const ui = render(createElement(Harness))
    fireEvent.click(ui.getByRole("button", { name: "Import / export JSON" }))
    fireEvent.change(ui.getByRole("textbox", { name: "Message JSON" }), {
        target: { value: '{"content":"Welcome","embed":{"title":"News"}}' },
    })
    fireEvent.click(ui.getByRole("button", { name: "Import JSON" }))
    assert.equal((ui.getByLabelText("Accent color") as HTMLInputElement).value, "#000000")
    assert.equal(JSON.parse(latest).embed.color, undefined)
    fireEvent.click(ui.getByRole("button", { name: "Add field" }))
    fireEvent.change(ui.getByRole("textbox", { name: "Field 1 name" }), { target: { value: "Topic" } })
    fireEvent.change(ui.getByRole("textbox", { name: "Field 1 value" }), { target: { value: "Updates" } })
    fireEvent.click(ui.getByLabelText("Inline field 1"))
    assert.equal(JSON.parse(latest).embed.fields[0].inline, true)
    assert.ok(within(ui.getByRole("region", { name: "Message preview" })).getByText("Updates"))
    fireEvent.click(ui.getByRole("button", { name: "Export JSON" }))
    assert.deepEqual(
        JSON.parse((ui.getByRole("textbox", { name: "Message JSON" }) as HTMLTextAreaElement).value),
        JSON.parse(latest),
    )
    fireEvent.click(ui.getByRole("button", { name: "Remove field 1" }))
    assert.deepEqual(JSON.parse(latest).embed.fields, [])
    fireEvent.click(ui.getByRole("button", { name: "Remove embed" }))
    fireEvent.click(ui.getByRole("button", { name: "Add embed" }))
    assert.equal(JSON.parse(latest).embed.color, 0x648ccc)
    assert.equal((ui.getByLabelText("Accent color") as HTMLInputElement).value, "#648ccc")
})

const leaveWarns = () => {
    const event = new window.Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
}
test("Import and preview never send, and a failed queue retry reuses the request ID and keeps the draft", async () => {
    const requests: Array<Record<string, unknown>> = []
    const client = {
        action: async (_: unknown, args: Record<string, unknown>) => {
            requests.push(args)
            if (requests.length === 1) throw new Error("Synthetic transport failure")
            return { jobId: "job1" }
        },
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(Messages, {
            client,
            sessionToken: "synthetic-session",
            serverId: "2",
            connected: true,
            catalog,
            catalogLoading: false,
            catalogError: false,
            jobs: [],
        }),
    )
    const picker = ui.getByRole("combobox", { name: "Destination channel" })
    fireEvent.change(picker, { target: { value: "ann" } })
    fireEvent.keyDown(picker, { key: "Enter" })
    fireEvent.click(ui.getByRole("button", { name: "Import / export JSON" }))
    fireEvent.change(ui.getByRole("textbox", { name: "Message JSON" }), {
        target: { value: '{"content":"Hello","embed":{"title":"Notice"}}' },
    })
    fireEvent.click(ui.getByRole("button", { name: "Import JSON" }))
    assert.equal(requests.length, 0)
    const form = ui.getByRole("button", { name: "Request send" }).closest("form")!
    await act(async () => {
        fireEvent.submit(form)
    })
    assert.ok(ui.getByRole("alert"))
    assert.equal((ui.getByRole("textbox", { name: "Message text" }) as HTMLTextAreaElement).value, "Hello")
    assert.equal(leaveWarns(), true)
    await act(async () => {
        fireEvent.submit(form)
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.requestId, requests[1]?.requestId)
    assert.deepEqual(requests[1]?.content, { content: "Hello", embed: { title: "Notice" } })
    assert.ok(ui.getByText("Message request queued. Check the delivery status below"))
    assert.equal(leaveWarns(), false)
    await act(async () => {
        fireEvent.submit(form)
    })
    assert.equal(requests.length, 2)
})

test("A send the backend refuses shows the backend's reason", async () => {
    const client = {
        action: async () => {
            throw new ConvexError({ status: 403, error: "Publishing disabled by current policy" })
        },
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(Messages, {
            client,
            sessionToken: "synthetic-session",
            serverId: "2",
            connected: true,
            catalog,
            catalogLoading: false,
            catalogError: false,
            jobs: [],
        }),
    )
    await requestNotice(ui)
    assert.equal(ui.getByRole("alert").textContent, "Publishing disabled by current policy")
})

test("A request list that failed to load shows no loading message", () => {
    const client = {
        watchQuery: () => ({
            localQueryResult: () => {
                throw new Error("Synthetic expired sign-in")
            },
            onUpdate: () => () => {},
        }),
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(MessagesSection, {
            section: "messages",
            client,
            sessionToken: "synthetic-session",
            serverId: "2",
            userId: "20",
            connected: true,
            catalog,
            catalogLoading: false,
            catalogError: false,
            refreshCatalog: () => {},
            sectionHref: () => "/",
            openSection: () => {},
        }),
    )
    assert.ok(ui.getByText(/Recent message requests are unavailable/))
    assert.ok(ui.queryByText("Loading recent message requests…") === null)
})

// The composer in its dashboard section, with the jobs the bot reports, and a queue that records every request
function composer(jobs: DashboardMessageJob[] = []) {
    const requests: Array<Record<string, unknown>> = []
    const client = {
        action: async (_: unknown, args: Record<string, unknown>) => {
            requests.push(args)
            return { jobId: `job${requests.length}` }
        },
    } as unknown as ConvexReactClient
    const view = (current: DashboardMessageJob[]) =>
        createElement(
            DraftScopeProvider,
            { value: { userId: "1", serverId: "2", section: "messages" } },
            createElement(Messages, {
                client,
                sessionToken: "synthetic-session",
                serverId: "2",
                connected: true,
                catalog,
                catalogLoading: false,
                catalogError: false,
                jobs: current,
            }),
        )
    return { requests, view, ui: render(view(jobs)) }
}
const failedJob = (id: string): DashboardMessageJob => ({
    id,
    actorId: "1",
    channelId: "123",
    content: { content: "Synthetic notice" },
    state: "failed",
    error: "The bot was offline",
    createdAt: 1,
    expiresAt: 2,
})
async function requestNotice(ui: ReturnType<typeof render>) {
    const picker = ui.getByRole("combobox", { name: "Destination channel" })
    fireEvent.change(picker, { target: { value: "ann" } })
    fireEvent.keyDown(picker, { key: "Enter" })
    fireEvent.change(ui.getByRole("textbox", { name: "Message text" }), { target: { value: "Synthetic notice" } })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Request send" }))
    })
}

test("A message request that failed can be requested again unchanged, with a new request ID", async () => {
    const { requests, view, ui } = composer()
    await requestNotice(ui)
    assert.ok(ui.getByRole("button", { name: "Request queued" }))
    ui.rerender(view([failedJob("job1")]))
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Request send" }))
    })
    assert.equal(requests.length, 2)
    assert.notEqual(requests[0]?.requestId, requests[1]?.requestId)
})

test("A message request that failed keeps its draft after leaving the section", async () => {
    const { view, ui } = composer()
    await requestNotice(ui)
    ui.rerender(view([failedJob("job1")]))
    ui.unmount()
    const again = render(view([failedJob("job1")]))
    assert.equal(
        (again.getByRole("textbox", { name: "Message text" }) as HTMLTextAreaElement).value,
        "Synthetic notice",
    )
})

const saved = (name: string, content: PublishingDraft["content"], revision = 1): PublishingDraft => ({
    kind: "draft",
    name,
    revision,
    content,
    canonicalContent: content,
    createdAt: 1,
    updatedAt: 2,
})
// A live client whose recent requests the test publishes. Every queued send is recorded and answered with a numbered job
function sendClient(reject?: () => Error | undefined) {
    let jobs: DashboardMessageJob[] = []
    const requests: Array<Record<string, unknown>> = [],
        listeners = new Set<() => void>()
    const client = {
        connectionState: () => ({ isWebSocketConnected: true }),
        subscribeToConnectionState: () => () => {},
        watchQuery: () => ({
            localQueryResult: () => ({ jobs }),
            onUpdate: (listener: () => void) => {
                listeners.add(listener)
                return () => listeners.delete(listener)
            },
        }),
        action: async (_: unknown, args: Record<string, unknown>) => {
            requests.push(args)
            const failure = reject?.()
            if (failure) throw failure
            return { jobId: `job${requests.length}` }
        },
    } as unknown as ConvexReactClient
    return {
        client,
        requests,
        publish: async (next: DashboardMessageJob[]) => {
            jobs = next
            await act(async () => {
                listeners.forEach((listener) => listener())
            })
        },
    }
}
const sender = (client: ConvexReactClient, drafts: PublishingDraft[]) =>
    createElement(SavedMessageSend, {
        client,
        sessionToken: "synthetic-session",
        serverId: "2",
        connected: true,
        catalog,
        catalogLoading: false,
        catalogError: false,
        drafts,
    })
const choose = (ui: ReturnType<typeof render>, name: string) =>
    fireEvent.change(ui.getByRole("combobox", { name: "Saved message" }), { target: { value: name } })
const pickChannel = (ui: ReturnType<typeof render>) => {
    const picker = ui.getByRole("combobox", { name: "Send to channel" })
    fireEvent.change(picker, { target: { value: "ann" } })
    fireEvent.keyDown(picker, { key: "Enter" })
}

test("A saved message is previewed, queued exactly as shown with the chosen channel, and a second send needs a new click", async () => {
    const { client, requests, publish } = sendClient()
    const drafts = [saved("news", { content: "Hello all", embed: { title: "News" } }), saved("empty", { content: "" })]
    const ui = render(sender(client, drafts))
    assert.equal((ui.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, true)
    choose(ui, "draft:news")
    const preview = within(ui.getByRole("region", { name: "Message preview" }))
    assert.ok(preview.getByRole("heading", { name: "Saved message" }))
    assert.ok(preview.getByText("Hello all"))
    assert.equal((ui.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, false)
    // No channel yet, so nothing is queued
    await act(async () => {
        fireEvent.submit(ui.getByRole("button", { name: "Send" }).closest("form")!)
    })
    assert.equal(requests.length, 0)
    assert.equal(ui.getByRole("alert").textContent, "Choose a channel")
    pickChannel(ui)
    await act(async () => {
        fireEvent.submit(ui.getByRole("button", { name: "Send" }).closest("form")!)
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.channelId, "123")
    assert.deepEqual(requests[0]?.content, { content: "Hello all", embed: { title: "News" } })
    assert.equal(typeof requests[0]?.requestId, "string")
    // The bot's answer is shown, and the same message is not sent again by a second submit
    await publish([
        {
            id: "job1",
            actorId: "1",
            channelId: "123",
            content: { content: "Hello all" },
            state: "sent",
            createdAt: 1,
            expiresAt: 2,
        },
    ])
    assert.ok(ui.getByText("Sent"))
    await act(async () => {
        fireEvent.submit(ui.getByRole("button", { name: "Request queued" }).closest("form")!)
    })
    assert.equal(requests.length, 1)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Send it again" }))
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Send" }))
    })
    assert.equal(requests.length, 2)
    assert.notEqual(requests[1]?.requestId, requests[0]?.requestId)
})

test("An empty saved version cannot be sent, and a version that changes live is previewed and sent as changed", async () => {
    const { client, requests } = sendClient()
    const ui = render(sender(client, [saved("empty", { content: "" }), saved("news", { content: "First" })]))
    choose(ui, "draft:empty")
    pickChannel(ui)
    assert.ok(ui.getByText("This saved version is empty. Add content before sending"))
    const send = () => ui.getByRole("button", { name: "Send" }) as HTMLButtonElement
    assert.equal(send().disabled, true)
    await act(async () => {
        fireEvent.submit(send().closest("form")!)
    })
    assert.equal(requests.length, 0)
    choose(ui, "draft:news")
    assert.ok(ui.queryByText("This saved version is empty. Add content before sending") === null)
    ui.rerender(sender(client, [saved("empty", { content: "" }), saved("news", { content: "Second" }, 2)]))
    const preview = within(ui.getByRole("region", { name: "Message preview" }))
    assert.ok(preview.getByText("Second"))
    assert.ok(preview.queryByText("First") === null)
    await act(async () => {
        fireEvent.submit(send().closest("form")!)
    })
    assert.deepEqual(requests[0]?.content, { content: "Second" })
})

test("A failed or unconfirmed send keeps one request ID, a failed job allows a new one, and an unknown outcome is shown", async () => {
    let refuse = true
    const { client, requests, publish } = sendClient(() =>
        refuse ? new Error("Synthetic transport failure") : undefined,
    )
    const ui = render(sender(client, [saved("news", { content: "Hello" })]))
    choose(ui, "draft:news")
    pickChannel(ui)
    const form = () => ui.getByRole("button", { name: /^(Send|Request queued)$/ }).closest("form")!
    await act(async () => {
        fireEvent.submit(form())
    })
    assert.ok(ui.getByRole("alert"))
    refuse = false
    await act(async () => {
        fireEvent.submit(form())
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.requestId, requests[1]?.requestId)
    const job = (state: DashboardMessageJob["state"], error?: string): DashboardMessageJob => ({
        id: "job2",
        actorId: "1",
        channelId: "123",
        content: { content: "Hello" },
        state,
        ...(error ? { error } : {}),
        createdAt: 1,
        expiresAt: 2,
    })
    await publish([job("uncertain")])
    assert.ok(ui.getByText("Outcome unknown"))
    assert.ok(ui.getByText(/never resends it on its own/))
    // A failed send shows its failure and the bot's reason, as the Messages section does, and Send works again
    await publish([job("failed", "NeonFlux lacks Send messages in that channel")])
    assert.ok(ui.getByText("Failed"))
    assert.ok(ui.getByText(/NeonFlux lacks Send messages in that channel/))
    assert.ok(ui.getByRole("button", { name: "Send" }))
    await act(async () => {
        fireEvent.submit(form())
    })
    assert.equal(requests.length, 3)
    assert.notEqual(requests[2]?.requestId, requests[1]?.requestId)
})
