import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement, useState } from "react"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import type { DashboardConfigurationSnapshot } from "@neonflux/backend/dashboard-contracts"
import { PAGE_WINDOW, useConfigurationState } from "../src/configuration-live.ts"
import { ResponseSettings } from "../src/response-settings.tsx"
import { TemplatePicker, CalendarFields } from "../src/configuration-fields.tsx"
import { ConfigurationSection, preloadForms, useTemplateOptions } from "../src/configuration-section.tsx"
import { DraftScopeProvider, hasRowDraft } from "../src/drafts.ts"

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
await preloadForms()
const scope = { userId: "1", serverId: "2", section: "custom" }
const sectionProps = {
    sessionToken: "synthetic-session",
    serverId: "2",
    section: "custom" as const,
    connected: true,
    catalogLoading: false,
    catalogError: false,
}

function page(
    name: string,
    revision: number,
    next?: string,
    text = "Synthetic reply",
): Extract<DashboardConfigurationSnapshot, { family: "responses" }> {
    return {
        family: "responses",
        serverId: "2",
        configRevision: revision,
        data: {
            settings: { customEnabled: true, autoEnabled: true },
            definitions: [
                {
                    name,
                    kind: "custom",
                    reply: { type: "text", text },
                    channelIds: [],
                    roleIds: [],
                    cooldownSeconds: 0,
                    priority: 0,
                    enabled: true,
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        },
        jobs: [],
        ...(next ? { nextCursors: { definitions: next } } : {}),
    }
}
// A definition edited elsewhere conflicts with its own form's draft. The create form edits no stored definition, so the same save leaves it alone
test("Loading more live definitions keeps drafts and shows drift only once loaded pages agree, and only on the changed definition", async () => {
    const first = { value: page("first", 1, "next") },
        second: { value?: DashboardConfigurationSnapshot } = {}
    const listeners = new Map<string, () => void>()
    const client = {
        watchQuery: (_: unknown, args: { cursors?: { definitions?: string } }) => {
            const key = args.cursors?.definitions ?? "",
                slot = key ? second : first
            return {
                localQueryResult: () => slot.value,
                onUpdate: (listener: () => void) => {
                    listeners.set(key, listener)
                    return () => {
                        if (listeners.get(key) === listener) listeners.delete(key)
                    }
                },
            }
        },
    } as unknown as ConvexReactClient
    function Harness() {
        const state = useConfigurationState(client, "synthetic-session", "2", "responses")
        return state.remote?.family === "responses"
            ? createElement(ResponseSettings, {
                  remote: state.remote,
                  connected: !state.error && !state.loadingPage,
                  queue: async () => ({ queued: false, conflict: true, revision: 3 }),
                  loadPage: state.loadPage,
                  loadingPage: state.loadingPage,
                  kind: "custom",
              })
            : createElement("p", null, "Loading")
    }
    const ui = render(createElement(Harness)),
        form = within(ui.getByRole("region", { name: "Create custom command" }))
    fireEvent.change(form.getByRole("textbox", { name: "Response name" }), { target: { value: "keep_draft" } })
    fireEvent.change(form.getByRole("textbox", { name: "Message text" }), { target: { value: "Keep this draft" } })
    const existing = within(ui.getByRole("region", { name: "Response: first", hidden: true }))
    fireEvent.change(existing.getByRole("textbox", { name: "Message text", hidden: true }), {
        target: { value: "My edited reply" },
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Load more definitions" }))
    })
    assert.equal((form.getByRole("textbox", { name: "Response name" }) as HTMLInputElement).value, "keep_draft")
    assert.equal(form.getByRole("button", { name: "Create response" }).hasAttribute("disabled"), true)
    await act(async () => {
        first.value = page("first", 2, "next", "Reply changed elsewhere")
        listeners.get("")!()
    })
    assert.ok(!ui.queryByText("Changed elsewhere"), "drift waits until every loaded page has the same revision")
    await act(async () => {
        second.value = page("second", 2)
        listeners.get("next")!()
    })
    assert.ok(ui.getByText("second: Enabled"))
    assert.ok(existing.getByText("Changed elsewhere"))
    assert.equal(
        (existing.getByRole("textbox", { name: "Message text", hidden: true }) as HTMLTextAreaElement).value,
        "My edited reply",
    )
    assert.ok(!form.queryByText("Changed elsewhere"), "the create form edits no stored definition")
    assert.equal((form.getByRole("textbox", { name: "Message text" }) as HTMLTextAreaElement).value, "Keep this draft")
    assert.equal(form.getByRole("button", { name: "Create response" }).hasAttribute("disabled"), false)
})

test("Template choices keep loading page by page past five hundred, and unused pages unsubscribe", async () => {
    const total = 650,
        listeners = new Map<string, () => void>()
    const client = {
        watchQuery: (_: unknown, args: { cursor: string | null }) => {
            const start = args.cursor ? Number(args.cursor) : 0,
                end = Math.min(total, start + 100)
            return {
                localQueryResult: () => ({
                    serverId: "2",
                    templates: Array.from({ length: end - start }, (_, index) => ({
                        kind: "template" as const,
                        name: `t${start + index}`,
                        revision: 1,
                    })),
                    cursor: end < total ? String(end) : null,
                }),
                onUpdate: (listener: () => void) => {
                    listeners.set(args.cursor ?? "", listener)
                    return () => {
                        listeners.delete(args.cursor ?? "")
                    }
                },
            }
        },
    } as unknown as ConvexReactClient
    function Harness() {
        const options = useTemplateOptions(client, "synthetic-session", "2", true)
        return createElement(
            "div",
            null,
            createElement("p", null, `${options.templates?.length ?? 0} choices`),
            options.more
                ? createElement("button", { type: "button", onClick: options.loadMore }, "Load more templates")
                : null,
        )
    }
    const ui = render(createElement(Harness))
    assert.ok(ui.getByText("100 choices"))
    for (let page = 1; page < 7; page++)
        await act(async () => {
            fireEvent.click(ui.getByRole("button", { name: "Load more templates" }))
        })
    assert.ok(ui.getByText("650 choices"))
    assert.ok(ui.queryByRole("button", { name: "Load more templates" }) === null)
    assert.equal(listeners.size, 7)
    ui.unmount()
    assert.equal(listeners.size, 0)
})
test("Template picker keeps an older frozen binding until the user explicitly chooses the current revision", () => {
    let latest = ""
    const template = {
        kind: "template" as const,
        name: "welcome",
        revision: 5,
        content: { content: "New version" },
        canonicalContent: { content: "New version" },
        createdAt: 1,
        updatedAt: 2,
    }
    function Harness() {
        const [value, setValue] = useState('{"kind":"template","name":"welcome","revision":2}')
        latest = value
        return createElement(TemplatePicker, {
            label: "Welcome template",
            value,
            onChange: setValue,
            templates: [template],
        })
    }
    const ui = render(createElement(Harness))
    assert.ok(ui.getByText("welcome (template, saved version 2)"))
    assert.equal(JSON.parse(latest).revision, 2)
    fireEvent.change(ui.getByRole("combobox", { name: "Welcome template" }), { target: { value: "welcome" } })
    fireEvent.click(ui.getByRole("option", { name: /welcome \(template, version 5\)/ }))
    assert.equal(JSON.parse(latest).revision, 5)
})

test("A template picker that follows its template says edits apply right away and offers no newer version to choose", () => {
    const template = {
        kind: "template" as const,
        name: "welcome",
        revision: 5,
        content: { content: "New version" },
        canonicalContent: { content: "New version" },
        createdAt: 1,
        updatedAt: 2,
    }
    const ui = render(
        createElement(TemplatePicker, {
            label: "Welcome template",
            value: '{"kind":"template","name":"welcome","revision":2}',
            onChange: () => {},
            templates: [template],
            follows: true,
        }),
    )
    assert.ok(ui.getByText("Follows this template. Edits apply to the next post right away"))
    assert.ok(ui.queryByText(/A newer template version is available/) === null)
    assert.ok(ui.queryByText(/Later template edits do not change it/) === null)
})

test("Calendar controls preserve a civil gap input and empty numeric draft without resolving instants in the browser", () => {
    let latest = ""
    function Harness() {
        const [value, setValue] = useState(
            '{"localMinute":"2027-03-28T01:30","zone":"Europe/Berlin","fold":"reject","durationMinutes":60,"recurrence":{"type":"none"}}',
        )
        latest = value
        return createElement(CalendarFields, { value, onChange: setValue, event: true })
    }
    const ui = render(createElement(Harness))
    fireEvent.change(ui.getByLabelText("Local date and time"), { target: { value: "2027-03-28T02:30" } })
    fireEvent.change(ui.getByLabelText("Duration (minutes)"), { target: { value: "" } })
    const draft = JSON.parse(latest)
    assert.equal(draft.localMinute, "2027-03-28T02:30")
    assert.equal(draft.zone, "Europe/Berlin")
    assert.equal(draft.durationMinutes, "")
    assert.equal(draft.dates, undefined)
})

test("A live deletion retains the existing edited definition while blocking its mutations until explicit dismissal", async () => {
    let current = page("first", 1),
        listener: (() => void) | undefined
    const client = {
        watchQuery: () => ({
            localQueryResult: () => current,
            onUpdate: (next: () => void) => {
                listener = next
                return () => {
                    if (listener === next) listener = undefined
                }
            },
        }),
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(
            DraftScopeProvider,
            { value: scope },
            createElement(ConfigurationSection, { client, ...sectionProps }),
        ),
    )
    fireEvent.click(ui.getByText("first: Enabled"))
    const form = within(ui.getByRole("region", { name: "Response: first", hidden: true }))
    fireEvent.change(form.getByRole("textbox", { name: "Message text", hidden: true }), {
        target: { value: "Retain this unsaved reply" },
    })
    await act(async () => {
        current = {
            ...page("first", 2),
            data: { settings: { customEnabled: true, autoEnabled: true }, definitions: [] },
        }
        listener!()
    })
    assert.equal(
        (form.getByRole("textbox", { name: "Message text", hidden: true }) as HTMLTextAreaElement).value,
        "Retain this unsaved reply",
    )
    assert.equal(form.getByRole("button", { name: "Save changes", hidden: true }).hasAttribute("disabled"), true)
    assert.ok(
        ui.getByText(
            "Definitions are no longer in the loaded pages. They may have been removed or moved to a later page. Their forms and drafts are kept below for copying, with saves disabled until those definitions are loaded again",
        ),
    )
    const create = within(ui.getByRole("region", { name: "Create custom command" }))
    fireEvent.change(create.getByRole("textbox", { name: "Response name" }), { target: { value: "new_definition" } })
    fireEvent.change(create.getByRole("textbox", { name: "Message text" }), {
        target: { value: "An independent current draft" },
    })
    assert.equal(create.getByRole("button", { name: "Create response" }).hasAttribute("disabled"), false)
    assert.equal(hasRowDraft(scope, "custom:first"), true)
    fireEvent.click(ui.getByRole("button", { name: "Dismiss unavailable definitions and their drafts" }))
    assert.ok(ui.queryByRole("region", { name: "Response: first", hidden: true }) === null)
    assert.equal(hasRowDraft(scope, "custom:first"), false, "the dismissed definition's draft is gone")
    assert.equal((create.getByRole("textbox", { name: "Response name" }) as HTMLInputElement).value, "new_definition")
})

test("Loaded later pages stay within a bounded live window that moves on without reporting dropped pages as removed", async () => {
    const names = ["p0", "p1", "p2", "p3", "p4", "p5", "p6"],
        listeners = new Map<string, () => void>()
    const client = {
        watchQuery: (_: unknown, args: { cursors?: { definitions?: string } }) => {
            const key = args.cursors?.definitions ?? "",
                index = key ? Number(key.slice(5)) : 0
            return {
                localQueryResult: () =>
                    page(names[index]!, 1, index + 1 < names.length ? `after${index + 1}` : undefined),
                onUpdate: (listener: () => void) => {
                    listeners.set(key, listener)
                    return () => {
                        if (listeners.get(key) === listener) listeners.delete(key)
                    }
                },
            }
        },
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(ConfigurationSection, {
            client,
            sessionToken: "synthetic-session",
            serverId: "2",
            section: "custom",
            connected: true,
            catalogLoading: false,
            catalogError: false,
        }),
    )
    for (let index = 0; index <= PAGE_WINDOW; index++)
        await act(async () => {
            fireEvent.click(ui.getByRole("button", { name: "Load more definitions" }))
        })
    assert.equal(listeners.size, 1 + PAGE_WINDOW)
    assert.ok(ui.queryByText("p1: Enabled") === null)
    assert.ok(ui.getByText("p0: Enabled"))
    assert.ok(ui.getByText(`p${PAGE_WINDOW + 1}: Enabled`))
    assert.ok(ui.queryByText(/They may have been removed or moved to a later page/) === null)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Show definitions from the start" }))
    })
    assert.equal(listeners.size, 1)
    assert.ok(ui.queryByText(/Earlier pages of definitions are hidden/) === null)
})
test("Sorted insertion rebases loaded page cursors and retains a pushed-out draft until its new page is loaded", async () => {
    const many = (names: string[], revision: number, next?: string) => ({
        ...page(names[0]!, revision, next),
        data: {
            settings: { customEnabled: true, autoEnabled: true },
            definitions: names.map((name) => page(name, revision).data.definitions[0]!),
        },
    })
    const slots = new Map<string, DashboardConfigurationSnapshot>([
        ["", many(["alpha", "bravo"], 1, "after_bravo")],
        ["after_bravo", many(["charlie", "delta"], 1)],
    ])
    const listeners = new Map<string, () => void>(),
        requested: string[] = []
    const client = {
        watchQuery: (_: unknown, args: { cursors?: { definitions?: string } }) => {
            const key = args.cursors?.definitions ?? ""
            requested.push(key)
            return {
                localQueryResult: () => slots.get(key),
                onUpdate: (listener: () => void) => {
                    listeners.set(key, listener)
                    return () => {
                        if (listeners.get(key) === listener) listeners.delete(key)
                    }
                },
            }
        },
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(
            DraftScopeProvider,
            { value: scope },
            createElement(ConfigurationSection, { client, ...sectionProps }),
        ),
    )
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Load more definitions" }))
    })
    fireEvent.click(ui.getByText("delta: Enabled"))
    const delta = within(ui.getByRole("region", { name: "Response: delta", hidden: true }))
    fireEvent.change(delta.getByRole("textbox", { name: "Message text", hidden: true }), {
        target: { value: "Keep the draft beyond the shifted boundary" },
    })
    await act(async () => {
        slots.set("", many(["aardvark", "alpha"], 2, "after_alpha"))
        listeners.get("")!()
    })
    assert.ok(requested.includes("after_alpha"))
    assert.equal(
        (delta.getByRole("textbox", { name: "Message text", hidden: true }) as HTMLTextAreaElement).value,
        "Keep the draft beyond the shifted boundary",
    )
    await act(async () => {
        slots.set("after_alpha", many(["bravo", "charlie"], 2, "after_charlie"))
        listeners.get("after_alpha")!()
    })
    assert.ok(ui.getByText("bravo: Enabled"))
    assert.ok(ui.getByText("charlie: Enabled"))
    assert.equal(delta.getByRole("button", { name: "Save changes", hidden: true }).hasAttribute("disabled"), true)
    assert.ok(ui.getByText(/They may have been removed or moved to a later page/))
    slots.set("after_charlie", many(["delta"], 2))
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Load more definitions" }))
    })
    assert.ok(ui.queryByText(/They may have been removed or moved to a later page/) === null)
    assert.equal(
        (delta.getByRole("textbox", { name: "Message text", hidden: true }) as HTMLTextAreaElement).value,
        "Keep the draft beyond the shifted boundary",
    )
    // delta only moved to a later page and its stored values did not change, so its draft continues on the newer revision without review
    assert.ok(!delta.queryByText("Changed elsewhere"), "a definition that only moved pages is no conflict")
    assert.equal(delta.getByRole("button", { name: "Save changes", hidden: true }).hasAttribute("disabled"), false)
})

test("A definition deleted elsewhere leaves the section at once unless one of its forms holds an unsaved edit", async () => {
    let current = page("first", 1),
        listener: (() => void) | undefined
    const client = {
        watchQuery: () => ({
            localQueryResult: () => current,
            onUpdate: (next: () => void) => {
                listener = next
                return () => {}
            },
        }),
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(
            DraftScopeProvider,
            { value: scope },
            createElement(ConfigurationSection, { client, ...sectionProps }),
        ),
    )
    fireEvent.click(ui.getByText("first: Enabled"))
    const remove = within(ui.getByRole("region", { name: "Delete response: first", hidden: true }))
    assert.equal(remove.queryAllByRole("checkbox", { hidden: true }).length, 0, "the removal asks for no tick")
    assert.equal(dom.window.sessionStorage.length, 0, "the removal stores no draft")
    await act(async () => {
        current = {
            ...page("first", 2),
            data: { settings: { customEnabled: true, autoEnabled: true }, definitions: [] },
        }
        listener!()
    })
    assert.ok(!ui.queryByText("first: Enabled"), "the deleted definition is not listed")
    assert.ok(!ui.queryByRole("alert"), "no warning about unavailable definitions")
})

test("A definition deleted elsewhere leaves the section when its last unsaved edit ends", async () => {
    let current = page("first", 1),
        listener: (() => void) | undefined
    const client = {
        watchQuery: () => ({
            localQueryResult: () => current,
            onUpdate: (next: () => void) => {
                listener = next
                return () => {}
            },
        }),
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(
            DraftScopeProvider,
            { value: scope },
            createElement(ConfigurationSection, { client, ...sectionProps }),
        ),
    )
    fireEvent.click(ui.getByText("first: Enabled"))
    const reply = () =>
        within(ui.getByRole("region", { name: "Response: first", hidden: true })).getByRole("textbox", {
            name: "Message text",
            hidden: true,
        })
    fireEvent.change(reply(), { target: { value: "An unsaved edit" } })
    await act(async () => {
        current = {
            ...page("first", 2),
            data: { settings: { customEnabled: true, autoEnabled: true }, definitions: [] },
        }
        listener!()
    })
    assert.ok(ui.queryByText("first: Enabled"), "the edited definition stays")
    fireEvent.change(reply(), { target: { value: "Synthetic reply" } })
    assert.equal(dom.window.sessionStorage.length, 0)
    assert.ok(!ui.queryByText("first: Enabled"), "the definition leaves with its last edit")
    assert.ok(!ui.queryByRole("alert"), "no warning is left")
})

test("Lists that are not paged keep an item removed elsewhere while one of its forms holds an unsaved edit", async () => {
    const menus = (names: string[]) =>
        ({
            family: "rolepicker",
            serverId: "2",
            configRevision: names.length ? 1 : 2,
            jobs: [],
            data: {
                settings: { enabled: true, menus: names.map((name) => ({ name, mode: "multi", roleIds: [] })) },
                access: { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] },
            },
        }) as DashboardConfigurationSnapshot
    const stickies = (channelIds: string[]) =>
        ({
            family: "sticky",
            serverId: "2",
            configRevision: channelIds.length ? 1 : 2,
            jobs: [],
            data: {
                stickies: channelIds.map((channelId) => ({
                    channelId,
                    content: "Read the rules",
                    intervalSeconds: 30,
                    messageId: null,
                    revision: 1,
                    updatedAt: 1,
                })),
            },
        }) as DashboardConfigurationSnapshot
    for (const { section, first, emptied, form, field, count } of [
        {
            section: "rolepicker" as const,
            first: menus(["games", "colors"]),
            emptied: menus([]),
            form: "Menu games",
            field: "Menu games description",
            count: "A server can have 100 menus. 0 are in use",
        },
        {
            section: "sticky" as const,
            first: stickies(["50", "51"]),
            emptied: stickies([]),
            form: "Sticky in Channel 50",
            field: "Sticky text",
            count: "Sticky messages 0/",
        },
    ]) {
        let current = first,
            listener: (() => void) | undefined
        const client = {
            watchQuery: () => ({
                localQueryResult: () => current,
                onUpdate: (next: () => void) => {
                    listener = next
                    return () => {}
                },
            }),
        } as unknown as ConvexReactClient
        const ui = render(
            createElement(
                DraftScopeProvider,
                { value: { ...scope, section } },
                createElement(ConfigurationSection, { client, ...sectionProps, section }),
            ),
        )
        const region = () => ui.queryByRole("region", { name: form, hidden: true })
        fireEvent.change(within(region()!).getByLabelText(field), { target: { value: "An unsaved edit" } })
        await act(async () => {
            current = emptied
            listener!()
        })
        assert.ok(region(), `${section}: the edited item stays`)
        assert.equal((within(region()!).getByLabelText(field) as HTMLInputElement).value, "An unsaved edit")
        assert.equal(
            within(region()!)
                .getAllByRole("button", { hidden: true })
                .find((button) => button.getAttribute("type") === "submit")!
                .hasAttribute("disabled"),
            true,
            `${section}: saves are off`,
        )
        assert.ok(ui.getByRole("alert").textContent?.includes("Items were removed."))
        // A kept item no longer counts toward the list's limit
        assert.ok(ui.container.textContent?.includes(count), `${section}: ${count}`)
        fireEvent.click(ui.getByRole("button", { name: "Dismiss unavailable definitions and their drafts" }))
        assert.ok(region() === null, `${section}: dismissing removes the item`)
        cleanup()
        dom.window.sessionStorage.clear()
    }
})

// Drives a section through the live client, records what reaches the queue, and keeps the first item removed elsewhere through an
// unsaved edit made by edit
async function keepRemoved(
    section: "rolepicker" | "sticky" | "helpdesk" | "temproles" | "voice" | "youtube",
    data: (removed: boolean) => unknown,
    edit: (ui: ReturnType<typeof render>) => void,
) {
    const snapshot = (removed: boolean) =>
        ({
            family: section,
            serverId: "2",
            configRevision: removed ? 2 : 1,
            jobs: [],
            data: data(removed),
        }) as DashboardConfigurationSnapshot
    let current = snapshot(false),
        listener: (() => void) | undefined
    const queued: unknown[] = []
    const client = {
        watchQuery: () => ({
            localQueryResult: () => current,
            onUpdate: (next: () => void) => {
                listener = next
                return () => {}
            },
        }),
        action: async (_: unknown, args: { operation: unknown }) => {
            queued.push(args.operation)
            return { queued: true, conflict: false, revision: 2, jobId: "job1" }
        },
    } as unknown as ConvexReactClient
    const catalog = {
        serverId: "2",
        roles: [{ id: "41", name: "Event winner", position: 2 }],
        channels: ["50", "51", "52", "53", "54"].map((id) => ({ id, name: `room-${id}`, type: 0 })),
    }
    const ui = render(
        createElement(
            DraftScopeProvider,
            { value: { ...scope, section } },
            createElement(ConfigurationSection, { client, ...sectionProps, section, catalog } as Parameters<
                typeof ConfigurationSection
            >[0]),
        ),
    )
    edit(ui)
    await act(async () => {
        current = snapshot(true)
        listener!()
    })
    assert.ok(ui.getByRole("alert").textContent?.includes("Items were removed."), `${section}: the edited item stays`)
    return { ui, queued }
}
const region = (ui: ReturnType<typeof render>, name: string) => within(ui.getByRole("region", { name, hidden: true }))
async function submitForm(form: ReturnType<typeof within>) {
    await act(async () => {
        fireEvent.submit(
            form
                .getAllByRole("button", { hidden: true })
                .find((button: HTMLElement) => button.getAttribute("type") === "submit")!
                .closest("form")!,
        )
    })
}
const pick = (form: ReturnType<typeof within>, label: string, text: string) => {
    const picker = form.getByRole("combobox", { name: label, hidden: true })
    fireEvent.change(picker, { target: { value: text } })
    fireEvent.keyDown(picker, { key: "Enter" })
}
const savesOff = (form: ReturnType<typeof within>) =>
    form
        .getAllByRole("button", { hidden: true })
        .find((button: HTMLElement) => button.getAttribute("type") === "submit")!
        .hasAttribute("disabled")

// The lists start at their limits. Removing the first item elsewhere while its form holds a draft frees a place, and its own
// identity can be added again, while the kept draft stays unsaved
test("An item kept for its draft counts toward no list limit or duplicate check", async () => {
    const at = (removed: boolean, ids: string[]) => (removed ? ids.slice(1) : ids)
    {
        const names = ["games", ...Array.from({ length: 99 }, (_, i) => `menu-${i}`)]
        const { ui, queued } = await keepRemoved(
            "rolepicker",
            (removed) => ({
                settings: {
                    enabled: true,
                    menus: at(removed, names).map((name) => ({ name, mode: "multi", roleIds: [] })),
                },
                access: { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] },
            }),
            (ui) =>
                fireEvent.change(region(ui, "Menu games").getByLabelText("Menu games description"), {
                    target: { value: "An unsaved edit" },
                }),
        )
        const add = region(ui, "Add menu")
        assert.ok(ui.container.textContent?.includes("A server can have 100 menus. 99 are in use"))
        fireEvent.change(add.getByLabelText("Menu name"), { target: { value: "games" } })
        await submitForm(add)
        assert.deepEqual(queued, [{ type: "menu-set", name: "games", mode: "multi", roleIds: [] }])
        assert.ok(savesOff(region(ui, "Menu games")), "rolepicker: the kept draft stays unsaved")
        cleanup()
        dom.window.sessionStorage.clear()
    }
    {
        const channels = ["50", "51", "52", "53", "54"]
        const { ui, queued } = await keepRemoved(
            "sticky",
            (removed) => ({
                stickies: at(removed, channels).map((channelId) => ({
                    channelId,
                    content: "Read the rules",
                    intervalSeconds: 30,
                    messageId: null,
                    revision: 1,
                    updatedAt: 1,
                })),
            }),
            (ui) =>
                fireEvent.change(region(ui, "Sticky in room-50").getByLabelText("Sticky text"), {
                    target: { value: "An unsaved edit" },
                }),
        )
        assert.ok(ui.container.textContent?.includes("Sticky messages 4/5"))
        const add = region(ui, "Add sticky message")
        pick(add, "Channel", "room-50")
        fireEvent.change(add.getByLabelText("Sticky text"), { target: { value: "Post links in #links" } })
        await submitForm(add)
        assert.deepEqual(queued, [
            { type: "set", channelId: "50", content: "Post links in #links", intervalSeconds: 30 },
        ])
        assert.ok(savesOff(region(ui, "Sticky in room-50")), "sticky: the kept draft stays unsaved")
        cleanup()
        dom.window.sessionStorage.clear()
    }
    {
        const names = ["logs", ...Array.from({ length: 49 }, (_, i) => `answer-${i}`)]
        const { ui, queued } = await keepRemoved(
            "helpdesk",
            (removed) => ({
                settings: {
                    forumIds: [],
                    greeting: null,
                    solvedTag: "Solved",
                    nudgeHours: null,
                    guardChannelId: null,
                    autoArchive: false,
                    revision: 1,
                },
                answers: at(removed, names).map((name) => ({
                    name,
                    title: "Send your logs",
                    content: "Open settings",
                    updatedAt: 1,
                })),
            }),
            (ui) =>
                fireEvent.change(region(ui, "Answer logs").getByLabelText("Title"), {
                    target: { value: "An unsaved edit" },
                }),
        )
        assert.ok(ui.container.textContent?.includes("Saved answers 49/50"))
        const add = region(ui, "Add saved answer")
        fireEvent.change(add.getByLabelText("Name"), { target: { value: "logs" } })
        fireEvent.change(add.getByLabelText("Title"), { target: { value: "Crash" } })
        fireEvent.change(add.getByLabelText("Answer text"), { target: { value: "Reinstall" } })
        await submitForm(add)
        assert.deepEqual(queued, [{ type: "answer-set", name: "logs", title: "Crash", content: "Reinstall" }])
        assert.ok(savesOff(region(ui, "Answer logs")), "helpdesk: the kept draft stays unsaved")
        cleanup()
        dom.window.sessionStorage.clear()
    }
    {
        const { ui } = await keepRemoved(
            "temproles",
            (removed) => ({
                settings: {
                    roles: at(removed, ["41", "42"]).map((roleId) => ({ roleId, defaultSeconds: 3600 })),
                },
                grants: [],
                more: false,
            }),
            (ui) =>
                fireEvent.change(region(ui, "Defaults for Event winner").getByLabelText("Default duration"), {
                    target: { value: "2h" },
                }),
        )
        assert.ok(ui.container.textContent?.includes("1 of 1000 roles have defaults"))
        cleanup()
        dom.window.sessionStorage.clear()
    }
    {
        const channels = Array.from({ length: 10 }, (_, i) => String(60 + i))
        const { ui, queued } = await keepRemoved(
            "voice",
            (removed) => ({
                generators: at(removed, channels).map((channelId) => ({
                    channelId,
                    categoryId: null,
                    template: "{owner}'s room",
                    userLimit: null,
                    region: null,
                    revision: 1,
                    createdAt: 1,
                    updatedAt: 1,
                })),
                rooms: 0,
            }),
            (ui) =>
                fireEvent.change(region(ui, "Generator 60").getByLabelText("Generator name"), {
                    target: { value: "An unsaved edit" },
                }),
        )
        assert.ok(ui.container.textContent?.includes("Generators 9/10"))
        await submitForm(region(ui, "Add generator"))
        assert.deepEqual(queued, [
            {
                type: "generator-add",
                channelName: "Join to create",
                categoryId: null,
                template: "{owner}'s room",
                userLimit: null,
                region: null,
            },
        ])
        cleanup()
        dom.window.sessionStorage.clear()
    }
    {
        const ids = Array.from({ length: 10 }, (_, i) => `UC${"a".repeat(21)}${i}`)
        const { ui, queued } = await keepRemoved(
            "youtube",
            (removed) => ({
                configured: true,
                subscriptions: at(removed, ids).map((youtubeChannelId) => ({
                    youtubeChannelId,
                    channelId: "50",
                    enabled: true,
                    createdAt: 1,
                    status: {},
                })),
            }),
            (ui) => pick(region(ui, `Alert channel for ${ids[0]}`), "Alert channel", "room-52"),
        )
        assert.ok(ui.container.textContent?.includes("YouTube channels 9/10"))
        const add = region(ui, "Follow a YouTube channel")
        fireEvent.change(add.getByLabelText("YouTube channel ID"), { target: { value: ids[0] } })
        pick(add, "Alert channel", "room-51")
        await submitForm(add)
        assert.deepEqual(queued, [{ type: "add", youtubeChannelId: ids[0], channelId: "51" }])
        assert.ok(savesOff(region(ui, `Alert channel for ${ids[0]}`)), "youtube: the kept draft stays unsaved")
    }
})

test("The drafts and templates section ends with the saved message sender, which reads the live saved versions", async () => {
    let drafts = [
        {
            kind: "draft" as const,
            name: "news",
            revision: 1,
            content: { content: "First" },
            canonicalContent: { content: "First" },
            createdAt: 1,
            updatedAt: 1,
        },
    ]
    const listeners = new Set<() => void>()
    const client = {
        watchQuery: (ref: unknown) => ({
            localQueryResult: () =>
                getFunctionName(ref as never) === "dashboardViews:messages"
                    ? { jobs: [] }
                    : {
                          family: "publishing",
                          serverId: "2",
                          configRevision: 1,
                          jobs: [],
                          data: { settings: { enabled: true }, drafts },
                      },
            onUpdate: (listener: () => void) => {
                listeners.add(listener)
                return () => listeners.delete(listener)
            },
        }),
    } as unknown as ConvexReactClient
    const ui = render(
        createElement(
            DraftScopeProvider,
            { value: { ...scope, section: "publishing" } },
            createElement(ConfigurationSection, { client, ...sectionProps, section: "publishing" }),
        ),
    )
    await act(async () => {})
    const sender = within(ui.getByRole("region", { name: "Send a saved message" }))
    fireEvent.change(sender.getByRole("combobox", { name: "Saved message" }), { target: { value: "draft:news" } })
    assert.ok(sender.getByText("First"))
    await act(async () => {
        drafts = [
            { ...drafts[0]!, revision: 2, content: { content: "Second" }, canonicalContent: { content: "Second" } },
        ]
        listeners.forEach((listener) => listener())
    })
    assert.ok(sender.getByText("Second"))
    assert.ok(sender.queryByText("First") === null)
})
