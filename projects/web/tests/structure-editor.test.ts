import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import type {
    DashboardStructure,
    DashboardStructurePreview,
    StructureChannel,
    StructureEntry,
} from "@neonflux/backend/dashboard-contracts"
import type { SectionProps } from "../src/dashboard-sections.tsx"
import { StructureSection } from "../src/structure-editor.tsx"
import { DraftScopeProvider, readDraft } from "../src/drafts.ts"
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

// A live view that tests can change, a one-shot preview and every mutation the section sends
function client(view: DashboardStructure, preview?: DashboardStructurePreview) {
    const calls: Array<[string, unknown]> = [],
        listeners: Array<() => void> = []
    let current = view
    const convex = {
        watchQuery: () => ({
            localQueryResult: () => current,
            onUpdate: (listener: () => void) => {
                listeners.push(listener)
                return () => {}
            },
        }),
        mutation: async (ref: unknown, args: unknown) => {
            const name = getFunctionName(ref as never)
            calls.push([name, args])
            return name === "structure:save" ? { queued: true, requestedAt: 7 } : null
        },
        query: async (ref: unknown, args: unknown) => {
            calls.push([getFunctionName(ref as never), args])
            return preview
        },
    } as unknown as ConvexReactClient
    return {
        calls,
        convex,
        update: (next: DashboardStructure) => {
            current = next
            listeners.forEach((listener) => listener())
        },
    }
}
const props = (convex: ConvexReactClient) =>
    ({
        section: "structure",
        client: convex,
        sessionToken: "synthetic-session",
        serverId: "2",
        userId: "20",
        connected: true,
        catalogLoading: false,
        catalogError: false,
        catalog: { serverId: "2", channels: [], roles: [{ id: "40", name: "Members", position: 1 }] },
        refreshCatalog: () => {},
        sectionHref: (id: string) => `/?server=2&section=${id}`,
        openSection: () => {},
    }) satisfies SectionProps

const channel = (
    id: string,
    type: StructureChannel["type"],
    name: string,
    parentId: string | null = null,
    manage = true,
): StructureChannel => ({ id, type, name, parentId, manage })
// Chat holds general and lounge, Info holds rules, which the manager cannot change, and welcome sits at the top level
const channels = [
    channel("200", "category", "Chat"),
    channel("201", "text", "general", "200"),
    channel("202", "voice", "lounge", "200"),
    channel("100", "category", "Info"),
    channel("101", "text", "rules", "100", false),
    channel("300", "text", "welcome"),
]
const view = (overrides: Partial<DashboardStructure> = {}): DashboardStructure => ({
    serverId: "2",
    state: "done",
    work: "read",
    requestedAt: 1,
    archived: [],
    save: null,
    read: {
        readAt: Date.UTC(2026, 9, 1, 9, 0),
        channels,
        threadsTruncated: false,
        threads: [
            { id: "900", parentId: "201", name: "plans", private: false, archived: false },
            { id: "901", parentId: "201", name: "secret", private: true, archived: false },
        ],
    },
    ...overrides,
})
const entries = (rows: readonly StructureChannel[]): StructureEntry[] =>
    rows.map(({ id, type, name, parentId }) => ({ id, type, name, parentId }))
const names = (ui: ReturnType<typeof render>) =>
    ui.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value)
// Each row that carries marks or review lines, as its name followed by those lines
const notes = (ui: ReturnType<typeof render>) =>
    Array.from(ui.container.querySelectorAll(".structure-row")).flatMap((row) => {
        const lines = Array.from(row.querySelectorAll(".structure-notes li")).map((item) => item.textContent)
        return lines.length ? [[row.querySelector("input")!.value, ...lines]] : []
    })

test("The structure opens with a fresh read, shows threads as fixed children and loads closed threads on request", async () => {
    const { calls, convex } = client(view({ changedAt: Date.UTC(2026, 9, 1, 9, 5) }))
    const ui = render(createElement(StructureSection, props(convex)))
    await act(async () => {})
    assert.deepEqual(calls, [["structure:request", { sessionToken: "synthetic-session", serverId: "2" }]])
    assert.deepEqual(names(ui), ["Chat", "general", "lounge", "Info", "rules", "welcome"])
    assert.equal((ui.getByRole("textbox", { name: "Name of text rules" }) as HTMLInputElement).disabled, true)
    assert.ok(ui.getByText("You need Manage channels to change it"))
    // Categories and channels can be dragged, threads cannot
    assert.equal(ui.container.querySelectorAll("[draggable=true]").length, 5)
    const threads = within(ui.getByRole("list", { name: "Threads in general" })).getAllByRole("listitem")
    assert.deepEqual(
        threads.map((item) => [item.textContent, item.closest("[draggable]")]),
        [
            ["plans", null],
            ["secret, private", null],
        ],
    )
    assert.match(
        ui
            .getAllByRole("status")
            .map((item) => item.textContent)
            .join(" "),
        /The server changed after this read/,
    )
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Show closed threads of general" }))
    })
    assert.deepEqual(calls.at(-1), [
        "structure:threads",
        { sessionToken: "synthetic-session", serverId: "2", channelId: "201" },
    ])
})

test("Names and order change by typing, buttons, the category choice and dragging, then the review and the save send the draft with its start", async () => {
    const preview: DashboardStructurePreview = {
        readAt: 1,
        items: [
            {
                itemNo: 1,
                disposition: "apply",
                reason: null,
                change: { type: "rename", channelId: "201", from: "general", to: "chat" },
            },
            {
                itemNo: 2,
                disposition: "conflict",
                reason: "It was moved since your draft started",
                change: {
                    type: "move",
                    channelId: "202",
                    name: "lounge",
                    from: { parentId: "200", parentName: "Chat", afterId: "201", afterName: "general" },
                    to: { parentId: "100", parentName: "Info", afterId: "101", afterName: "rules" },
                },
            },
        ],
    }
    const { calls, convex, update } = client(view(), preview)
    const ui = render(createElement(StructureSection, props(convex)))
    await act(async () => {})
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "chat" } })
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Move text welcome up" }))
    })
    assert.deepEqual(names(ui), ["Chat", "chat", "lounge", "welcome", "Info", "rules"])
    await act(async () => {
        fireEvent.change(ui.getByRole("combobox", { name: "Category of voice lounge" }), { target: { value: "100" } })
    })
    assert.match(
        ui
            .getAllByRole("status")
            .map((item) => item.textContent)
            .join(" "),
        /lounge moved to Info, position 2 of 2/,
    )
    // Dropping a category on another places it before that one
    const row = (label: string) => ui.getByRole("textbox", { name: label }).closest(".structure-row")!
    const dataTransfer = { setData: () => {} }
    await act(async () => {
        fireEvent.dragStart(row("Name of category Info"), { dataTransfer })
    })
    await act(async () => {
        fireEvent.dragOver(row("Name of category Chat"), { dataTransfer })
    })
    await act(async () => {
        fireEvent.drop(row("Name of category Chat"), { dataTransfer })
    })
    assert.deepEqual(names(ui), ["Info", "rules", "lounge", "Chat", "chat", "welcome"])
    assert.equal(
        ui.getByText(/^Unsaved draft/).textContent,
        `Unsaved draft, started from the read of ${localTime(Date.UTC(2026, 9, 1, 9, 0))} Discard draft`,
    )

    const draft = [
        { id: "100", type: "category", name: "Info", parentId: null },
        { id: "101", type: "text", name: "rules", parentId: "100" },
        { id: "202", type: "voice", name: "lounge", parentId: "100" },
        { id: "200", type: "category", name: "Chat", parentId: null },
        { id: "201", type: "text", name: "chat", parentId: "200" },
        { id: "300", type: "text", name: "welcome", parentId: null },
    ]
    const sent = { sessionToken: "synthetic-session", serverId: "2", base: entries(channels), draft }
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Review changes" }))
    })
    assert.deepEqual(calls.at(-1), ["structure:preview", sent])
    // The review adds what saving does to the rows that the draft already marked
    assert.deepEqual(notes(ui), [
        [
            "lounge",
            "moved from Chat, after general to Info, after rules",
            "Move: Conflicts (It was moved since your draft started)",
        ],
        ["Chat", "moved from the top level, first to the top level, after Info"],
        ["chat", "was general", "Rename: Will be saved"],
    ])
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Save changes" }))
    })
    assert.deepEqual(calls.at(-1), ["structure:save", sent])
    // The sent draft cannot change while NeonFlux saves it
    assert.equal((ui.getByRole("textbox", { name: "Name of text general" }) as HTMLInputElement).disabled, true)

    // Its results end the draft, and a fix names the channel and the role instead of their mentions
    await act(async () => {
        update(
            view({
                state: "queued",
                requestedAt: 8,
                save: {
                    requestedAt: 7,
                    results: [
                        { itemNo: 1, change: preview.items[0]!.change, outcome: "applied", reason: null },
                        {
                            itemNo: 2,
                            change: preview.items[1]!.change,
                            outcome: "failed",
                            reason: "Grant Manage channels to the NeonFlux role and allow it in <#202> and move it above <@&40>",
                        },
                    ],
                },
            }),
        )
    })
    assert.deepEqual(names(ui), ["Chat", "general", "lounge", "Info", "rules", "welcome"])
    const rows = () =>
        within(ui.getAllByRole("table").at(-1)!)
            .getAllByRole("row")
            .slice(1)
            .map((item) =>
                within(item)
                    .getAllByRole("cell")
                    .map((cell) => cell.textContent)
                    .join(" | "),
            )
    assert.deepEqual(rows(), [
        "Rename general to chat | Saved",
        "Move lounge from Chat, after general to Info, after rules | Failed: Grant Manage channels to the NeonFlux role and allow it in #lounge and move it above @Members",
    ])
})

test("A save the bot never took keeps the draft, so it can be saved again", async () => {
    const preview: DashboardStructurePreview = {
        readAt: 1,
        items: [
            {
                itemNo: 1,
                disposition: "apply",
                reason: null,
                change: { type: "rename", channelId: "201", from: "general", to: "chat" },
            },
        ],
    }
    const { calls, convex, update } = client(view(), preview),
        scope = { userId: "20", serverId: "2", section: "structure" }
    const ui = render(
        createElement(DraftScopeProvider, { value: scope }, createElement(StructureSection, props(convex))),
    )
    await act(async () => {})
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "chat" } })
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Review changes" }))
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Save changes" }))
    })
    // A sent draft leaves this tab's storage while NeonFlux has it
    assert.equal((ui.getByRole("textbox", { name: "Name of text general" }) as HTMLInputElement).disabled, true)
    assert.equal(readDraft(scope, "draft"), undefined)
    await act(async () => {
        update(view({ state: "failed", work: "save", requestedAt: 7, failure: "unanswered" }))
    })
    assert.match(ui.getByRole("alert").textContent!, /NeonFlux did not answer/)
    const input = ui.getByRole("textbox", { name: "Name of text general" }) as HTMLInputElement
    assert.deepEqual([input.value, input.disabled], ["chat", false])
    assert.equal(readDraft<StructureEntry[]>(scope, "draft")?.find((entry) => entry.id === "201")?.name, "chat")
    assert.deepEqual(readDraft<{ entries: StructureEntry[] }>(scope, "base")?.entries, entries(channels))
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Review changes" }))
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Save changes" }))
    })
    assert.equal(calls.filter(([name]) => name === "structure:save").length, 2)
})

test("A draft marks its changes at once, the review adds what saving does until the next edit, and Changes only hides the rest", async () => {
    const preview: DashboardStructurePreview = {
        readAt: 1,
        items: [
            {
                itemNo: 1,
                disposition: "apply",
                reason: null,
                change: { type: "rename", channelId: "201", from: "general", to: "chat" },
            },
        ],
    }
    const { calls, convex } = client(view(), preview)
    const ui = render(createElement(StructureSection, props(convex)))
    await act(async () => {})
    assert.deepEqual(notes(ui), [])
    assert.ok(ui.queryByRole("checkbox", { name: "Changes only" }) === null)
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "chat" } })
    })
    // The marks need no review: Nothing was asked of the backend, and no table lists the change
    assert.deepEqual(notes(ui), [["chat", "was general"]])
    assert.deepEqual(
        calls.map(([name]) => name),
        ["structure:request"],
    )
    assert.ok(ui.container.querySelector("table") === null)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Review changes" }))
    })
    assert.deepEqual(notes(ui), [["chat", "was general", "Rename: Will be saved"]])
    assert.ok(ui.getByText("Will be saved: 1"))
    // Any edit makes the review stale, so its lines go and the marks stay
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text welcome" }), { target: { value: "hello" } })
    })
    assert.deepEqual(notes(ui), [
        ["chat", "was general"],
        ["hello", "was welcome"],
    ])
    assert.ok(ui.queryByRole("button", { name: "Save changes" }) === null)

    // Changes only keeps the changed rows and the category that holds one
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Changes only" }))
    })
    assert.deepEqual(names(ui), ["Chat", "chat", "hello"])
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Changes only" }))
    })
    assert.deepEqual(names(ui), ["Chat", "chat", "lounge", "Info", "rules", "hello"])

    // Typing a change back drops its mark but not its row, so the row under the cursor stays
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Changes only" }))
    })
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "general" } })
    })
    assert.deepEqual(names(ui), ["Chat", "general", "hello"])
    assert.deepEqual(notes(ui), [["hello", "was welcome"]])
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Changes only" }))
    })

    // A draft without changes has no marks, and says so in the changes-only view. A trailing space is no change, as in a save
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text welcome" }), { target: { value: "welcome" } })
    })
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "general " } })
    })
    assert.deepEqual(notes(ui), [])
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Changes only" }))
    })
    assert.equal(ui.container.querySelectorAll(".structure-row").length, 0)
    assert.ok(ui.getByText("No changes yet"))
})

test("Changes only shows where a move lands, and ends with the draft", async () => {
    const { convex } = client(view()),
        scope = { userId: "22", serverId: "2", section: "structure" }
    const ui = render(
        createElement(DraftScopeProvider, { value: scope }, createElement(StructureSection, props(convex))),
    )
    await act(async () => {})
    await act(async () => {
        fireEvent.change(ui.getByRole("combobox", { name: "Category of voice lounge" }), { target: { value: "100" } })
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Changes only" }))
    })
    assert.deepEqual(names(ui), ["Info", "lounge"])
    assert.deepEqual(notes(ui), [["lounge", "moved from Chat, after general to Info, after rules"]])
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Move voice lounge up" }))
    })
    assert.deepEqual(notes(ui), [["lounge", "moved from Chat, after general to Info, first"]])

    // Discard ends the view, so the next draft starts with every row
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Discard draft" }))
    })
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text welcome" }), { target: { value: "hello" } })
    })
    assert.deepEqual(names(ui), ["Chat", "general", "lounge", "Info", "rules", "hello"])
    assert.equal((ui.getByRole("checkbox", { name: "Changes only" }) as HTMLInputElement).checked, false)
})

test("A move either channel explains is marked on the one the manager can change", async () => {
    const read = view().read!,
        fixed = channels.map((row) => (row.id === "100" ? { ...row, manage: false } : row))
    const { convex } = client(view({ read: { ...read, channels: fixed } }))
    const ui = render(createElement(StructureSection, props(convex)))
    await act(async () => {})
    // welcome goes above Info, which the manager cannot change
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Move text welcome up" }))
    })
    assert.deepEqual(notes(ui), [["welcome", "moved from the top level, after Info to the top level, after Chat"]])
})

test("A review that answers after an edit is ignored", async () => {
    const preview: DashboardStructurePreview = {
        readAt: 1,
        items: [
            {
                itemNo: 1,
                disposition: "apply",
                reason: null,
                change: { type: "rename", channelId: "201", from: "general", to: "chat" },
            },
        ],
    }
    const { convex } = client(view(), preview)
    let answer: (value: DashboardStructurePreview) => void = () => {}
    Object.assign(convex, {
        query: () =>
            new Promise<DashboardStructurePreview>((resolve) => {
                answer = resolve
            }),
    })
    const ui = render(createElement(StructureSection, props(convex)))
    await act(async () => {})
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "chat" } })
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Review changes" }))
    })
    assert.equal((ui.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled, true)
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "talk" } })
    })
    await act(async () => {
        answer(preview)
    })
    assert.deepEqual(notes(ui), [["talk", "was general"]])
    assert.ok(ui.queryByRole("button", { name: "Save changes" }) === null)
    assert.equal((ui.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled, false)
})

test("Leaving the section keeps the draft with its start, and Discard draft clears both", async () => {
    const scope = { userId: "21", serverId: "2", section: "structure" },
        { convex } = client(view())
    const open = () =>
        render(createElement(DraftScopeProvider, { value: scope }, createElement(StructureSection, props(convex))))
    let ui = open()
    await act(async () => {})
    await act(async () => {
        fireEvent.change(ui.getByRole("textbox", { name: "Name of text general" }), { target: { value: "chat" } })
    })
    assert.equal(readDraft<StructureEntry[]>(scope, "draft")?.find((entry) => entry.id === "201")?.name, "chat")
    assert.deepEqual(readDraft<{ entries: StructureEntry[] }>(scope, "base")?.entries, entries(channels))

    // Another section takes its place, then the structure comes back with the same draft and marks
    ui.unmount()
    ui = open()
    await act(async () => {})
    assert.deepEqual(names(ui), ["Chat", "chat", "lounge", "Info", "rules", "welcome"])
    assert.deepEqual(notes(ui), [["chat", "was general"]])
    assert.ok(ui.getByText(/^Unsaved draft/))

    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Discard draft" }))
    })
    assert.equal(readDraft(scope, "draft"), undefined)
    assert.equal(readDraft(scope, "base"), undefined)
    assert.deepEqual(names(ui), ["Chat", "general", "lounge", "Info", "rules", "welcome"])
    assert.deepEqual(notes(ui), [])
    assert.ok(ui.queryByText(/^Unsaved draft/) === null)
    ui.unmount()
    ui = open()
    await act(async () => {})
    assert.deepEqual(names(ui), ["Chat", "general", "lounge", "Info", "rules", "welcome"])
    assert.ok(ui.queryByText(/^Unsaved draft/) === null)
})
