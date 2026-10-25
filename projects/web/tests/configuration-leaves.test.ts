import type { LevelingLevelUp } from "@neonflux/contracts/leveling"
import { EVENTS_REMINDER_RANGE_MINUTES } from "@neonflux/contracts/events"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import type { ComponentType } from "react"
import type {
    DashboardConfigurationDataMap,
    DashboardConfigurationFamily,
    DashboardConfigurationOperationMap,
} from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps } from "../src/configuration-form.tsx"
import { ResponseSettings } from "../src/response-settings.tsx"
import { SafetySettings } from "../src/safety-settings.tsx"
import { PublishingSettings } from "../src/publishing-settings.tsx"
import { GreetingSettings } from "../src/greeting-settings.tsx"
import { TicketSettings } from "../src/ticket-settings.tsx"
import { LevelingSettings, MilestoneSettings, SuggestionSettings } from "../src/community-settings.tsx"
import { CleanupSettings } from "../src/cleanup-settings.tsx"
import { EventSettings, ScheduleSettings } from "../src/calendar-settings.tsx"
import { DraftScopeProvider, clearDraft, rowForm, writeDraft } from "../src/drafts.ts"
import { localTime } from "../src/time.ts"
// Tests edit copies of contract values, whose shared types are read-only
type DeepMutable<T> = { -readonly [K in keyof T]: DeepMutable<T[K]> }

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
    roles: [{ id: "55", name: "🌿 Support", position: 1 }],
    channels: [
        { id: "123", name: "🌿 Welcome", type: 0 },
        { id: "456", name: "⭐ Calendar", type: 0 },
        { id: "789", name: "🎫 Tickets", type: 4 },
        { id: "321", name: "💡 Ideas", type: 15 },
        { id: "654", name: "📷 Gallery", type: 16 },
        { id: "987", name: "📣 News", type: 5 },
    ],
}
const templates = [
    {
        kind: "template" as const,
        name: "welcome",
        revision: 9,
        content: { content: "Hello" },
        canonicalContent: { content: "Hello" },
        createdAt: 1,
        updatedAt: 2,
    },
]
function setup<F extends DashboardConfigurationFamily>(
    Component: ComponentType<ConfigSectionProps<F>>,
    family: F,
    data: DashboardConfigurationDataMap[F],
    serverCatalog: typeof catalog = catalog,
) {
    const calls: Array<{ operation: DashboardConfigurationOperationMap[F]; revision: number; requestId: string }> = []
    const props = {
        remote: { family, serverId: "2", configRevision: 7, jobs: [], data },
        connected: true,
        catalog: serverCatalog,
        defaultOwnerId: "99",
        templates,
        queue: async (operation: DashboardConfigurationOperationMap[F], revision: number, requestId: string) => {
            calls.push({ operation, revision, requestId })
            return { queued: true, conflict: false, revision, jobId: "job1" }
        },
    } as unknown as ConfigSectionProps<F>
    const ui = render(createElement(Component, props))
    return { ui, props, calls }
}
function section(ui: ReturnType<typeof render>, name: string) {
    return within(ui.getByRole("region", { name, hidden: true }))
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
// Clicks a form's button once and checks the form asks for no confirmation tick first
async function clickOnce(form: ReturnType<typeof within>, name: string) {
    assert.equal(form.queryAllByRole("checkbox", { hidden: true }).length, 0)
    const button = form.getByRole("button", { name, hidden: true }) as HTMLButtonElement
    assert.equal(button.disabled, false)
    await act(async () => {
        fireEvent.click(button)
    })
}
// Event editors mount once their details open
async function openEditors(ui: ReturnType<typeof render>) {
    for (const details of ui.container.querySelectorAll("details"))
        await act(async () => {
            details.open = true
            fireEvent(details, new window.Event("toggle"))
        })
}
function pick(form: ReturnType<typeof within>, name: string, query: string) {
    const input = form.getByRole("combobox", { name, hidden: true })
    fireEvent.change(input, { target: { value: query } })
    fireEvent.keyDown(input, { key: "Enter" })
}
const event = {
    eventNo: 4,
    name: "meetup",
    revision: 3,
    ownerId: "99",
    channelId: "123",
    title: "Meetup",
    description: "Chat",
    capacity: null,
    reminderOffsets: [],
    state: "draft" as const,
    participationStarted: false,
    calendar: {
        localMinute: "2027-01-10T09:00",
        zone: "UTC",
        fold: "reject" as const,
        durationMinutes: 60,
        recurrence: { type: "none" as const },
        dates: [{ localMinute: "2027-01-10T09:00", startsAt: 1, endsAt: 2, offsetMinutes: 0 }],
    },
    createdAt: 1,
    updatedAt: 2,
}
const moderation: DashboardConfigurationDataMap["moderation"] = {
    settings: {
        manualModerationEnabled: true,
        appealsEnabled: true,
        staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
        logChannelId: null,
        automodEnabled: true,
        automodMode: "dry-run",
        automodBotMessagesEnabled: false,
        securityEnabled: true,
        securityMode: "dry-run",
        joinEnabled: false,
        joinThreshold: 5,
        joinWindowSeconds: 10,
        joinDefcon2: false,
        honeypotEnabled: false,
        honeypotChannelIds: [],
        watchlistEnabled: false,
        defcon: 3,
    },
    privateDataRoleId: null,
    rules: [],
    watchlist: [],
}

test("Security settings edit all join-burst fields with the shared configuration CAS", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", moderation)
    const form = section(ui, "Security policy")
    fireEvent.click(form.getByLabelText("Join burst detection enabled"))
    fireEvent.change(form.getByLabelText("Join burst threshold"), { target: { value: "12" } })
    fireEvent.change(form.getByLabelText("Join burst window (seconds)"), { target: { value: "30" } })
    pick(form, "Honeypot channels", "cal")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "settings",
        patch: { joinEnabled: true, joinThreshold: 12, joinWindowSeconds: 30, honeypotChannelIds: ["456"] },
    })
    assert.equal(calls[0]?.revision, 7)
})
test("Automod policy turns on bot and webhook message checks, and rules offer the rolling and deceptive-link types", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", moderation)
    const policy = section(ui, "Automod policy")
    fireEvent.click(policy.getByLabelText("Check webhook and other bots' messages"))
    await submit(policy)
    assert.deepEqual(calls[0]?.operation, {
        type: "settings",
        patch: { automodBotMessagesEnabled: true },
    })
    const create = section(ui, "Create automod rule")
    fireEvent.change(create.getByLabelText("Rule name"), { target: { value: "lookalikes" } })
    fireEvent.change(create.getByLabelText("Rule type"), { target: { value: "deceptive-links" } })
    await submit(create)
    assert.equal((calls[1]?.operation as { rule: { type: string } }).rule.type, "deceptive-links")
    assert.deepEqual(
        within(create.getByLabelText("Rule type"))
            .getAllByRole("option", { hidden: true })
            .map((option) => option.textContent),
        [
            "Spam",
            "Repeat",
            "Mentions in one message",
            "Mentions over time",
            "Links over time",
            "Words",
            "Domains",
            "Invites",
            "Deceptive links",
        ],
    )
})
test("Switching a protection off sends only that switch, which DEFCON 1 still allows", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", moderation)
    const policy = section(ui, "Automod policy")
    fireEvent.click(policy.getByLabelText("Automod enabled"))
    await submit(policy)
    const security = section(ui, "Security policy")
    fireEvent.click(security.getByLabelText("Security enabled"))
    await submit(security)
    const staff = section(ui, "Moderation and staff")
    fireEvent.click(staff.getByLabelText("Appeals enabled"))
    await submit(staff)
    assert.deepEqual(
        calls.map((call) => call.operation),
        [
            { type: "settings", patch: { automodEnabled: false } },
            { type: "settings", patch: { securityEnabled: false } },
            { type: "settings", patch: { appealsEnabled: false } },
        ],
    )
})
test("Staff roles stored in another scope order are not a change, so switching appeals off at DEFCON 1 sends only that switch", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", {
        ...moderation,
        settings: {
            ...moderation.settings,
            defcon: 1,
            staffRoleIds: { appeals: [], automod: [], cases: [], moderation: ["50"], security: [] },
        },
    })
    const staff = section(ui, "Moderation and staff")
    fireEvent.click(staff.getByLabelText("Appeals enabled"))
    await submit(staff)
    assert.deepEqual(
        calls.map((call) => call.operation),
        [{ type: "settings", patch: { appealsEnabled: false } }],
    )
})
test("Keep cases chooses a number of days or until erased, and a words rule explains whole-word patterns up to 1000", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", moderation)
    const staff = section(ui, "Moderation and staff")
    assert.equal((staff.getByLabelText("Keep cases") as HTMLSelectElement).value, "keep")
    assert.equal(staff.queryByLabelText("Days to keep cases"), null)
    fireEvent.change(staff.getByLabelText("Keep cases"), { target: { value: "days" } })
    fireEvent.change(staff.getByLabelText("Days to keep cases"), { target: { value: "90" } })
    await submit(staff)
    cleanup()
    const kept = setup(SafetySettings, "moderation", {
        ...moderation,
        settings: { ...moderation.settings, caseRetentionDays: 30 },
    })
    const form = section(kept.ui, "Moderation and staff")
    assert.equal((form.getByLabelText("Days to keep cases") as HTMLInputElement).value, "30")
    fireEvent.change(form.getByLabelText("Keep cases"), { target: { value: "keep" } })
    await submit(form)
    assert.deepEqual(
        [...calls, ...kept.calls].map((call) => call.operation),
        [
            { type: "settings", patch: { caseRetentionDays: 90 } },
            { type: "settings", patch: { caseRetentionDays: null } },
        ],
    )
    const create = section(kept.ui, "Create automod rule")
    assert.equal(create.queryByText("Whole words. Put * at the start or end to match part of a word"), null)
    fireEvent.change(create.getByLabelText("Rule type"), { target: { value: "words" } })
    assert.ok(create.getByText("Whole words. Put * at the start or end to match part of a word"))
    assert.ok(create.getByText("Up to 1000 entries"))
})
test("Automod patterns are pasted one per line, new ones are added at once, and lines too long or past 1000 stay in the box", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", moderation)
    const create = section(ui, "Create automod rule")
    fireEvent.change(create.getByLabelText("Rule name"), { target: { value: "words" } })
    fireEvent.change(create.getByLabelText("Rule type"), { target: { value: "words" } })
    const box = create.getByLabelText("Add several rule patterns, one per line")
    const long = "x".repeat(201)
    fireEvent.change(box, { target: { value: `spam\r\n  scam* \n\nspam\n${long}\n*bait` } })
    fireEvent.click(create.getByRole("button", { name: "Add lines", hidden: true }))
    assert.deepEqual(
        create.getAllByLabelText(/^Rule patterns \d+$/).map((input) => (input as HTMLInputElement).value),
        ["spam", "scam*", "*bait"],
    )
    assert.equal((box as HTMLTextAreaElement).value, long)
    assert.ok(create.getByText(/^Added 3\. 1 left in the box/))
    // Lines already listed are skipped, and only as many as fit up to 1000 are added
    const many = Array.from({ length: 1000 }, (_, index) => `word${index}`)
    fireEvent.change(box, { target: { value: ["spam", ...many].join("\n") } })
    fireEvent.click(create.getByRole("button", { name: "Add lines", hidden: true }))
    assert.equal(create.getAllByLabelText(/^Rule patterns \d+$/).length, 1000)
    assert.equal((box as HTMLTextAreaElement).value, many.slice(997).join("\n"))
    await submit(create)
    const rule = (calls[0]?.operation as { type: string; rule: { patterns: string[] } }).rule
    assert.deepEqual(
        [calls[0]?.operation.type, rule.patterns],
        ["rule-create", ["spam", "scam*", "*bait", ...many.slice(0, 997)]],
    )
})
test("A whole automod pattern list is replaced by pasted lines or cleared in one action", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", moderation)
    const create = section(ui, "Create automod rule")
    fireEvent.change(create.getByLabelText("Rule name"), { target: { value: "words" } })
    fireEvent.change(create.getByLabelText("Rule type"), { target: { value: "words" } })
    const box = create.getByLabelText("Add several rule patterns, one per line")
    const patterns = () =>
        create.queryAllByLabelText(/^Rule patterns \d+$/).map((input) => (input as HTMLInputElement).value)
    fireEvent.change(box, { target: { value: Array.from({ length: 30 }, (_, index) => `old${index}`).join("\n") } })
    fireEvent.click(create.getByRole("button", { name: "Add lines", hidden: true }))
    assert.equal(patterns().length, 30)
    fireEvent.change(box, { target: { value: "spam\nscam*\n*bait\nspam" } })
    fireEvent.click(create.getByRole("button", { name: "Replace the list with these lines", hidden: true }))
    assert.deepEqual(patterns(), ["spam", "scam*", "*bait"])
    assert.ok(create.getByText(/^The list now holds 3$/))
    fireEvent.click(create.getByRole("button", { name: "Remove all rule patterns", hidden: true }))
    assert.deepEqual(patterns(), [])
    fireEvent.change(box, { target: { value: "spam\nscam*\n*bait" } })
    fireEvent.click(create.getByRole("button", { name: "Replace the list with these lines", hidden: true }))
    await submit(create)
    const rule = (calls[0]?.operation as { type: string; rule: { patterns: string[] } }).rule
    assert.deepEqual([calls[0]?.operation.type, rule.patterns], ["rule-create", ["spam", "scam*", "*bait"]])
})
test("Rule channels and exempt roles take more than 20 IDs, pasted as mentions or IDs at once, and staff roles too", async () => {
    const channelIds = Array.from({ length: 21 }, (_, index) => String(1000 + index)),
        roleIds = Array.from({ length: 21 }, (_, index) => String(2000 + index))
    const { ui, calls } = setup(SafetySettings, "moderation", moderation, {
        serverId: "2",
        roles: roleIds.map((id, index) => ({ id, name: `Role ${index}`, position: index + 1 })),
        channels: channelIds.map((id, index) => ({ id, name: `Room ${index}`, type: 0 })),
    })
    const paste = (form: ReturnType<typeof within>, name: string, text: string) =>
        fireEvent.paste(form.getByRole("combobox", { name, hidden: true }), {
            clipboardData: { getData: () => text },
        })
    const create = section(ui, "Create automod rule")
    fireEvent.change(create.getByLabelText("Rule name"), { target: { value: "links" } })
    fireEvent.change(create.getByLabelText("Rule type"), { target: { value: "spam" } })
    // Mentions split by spaces, commas or lines, and an ID that matches no channel stays in the box
    paste(create, "Rule channels", `${channelIds.map((id) => `<#${id}>`).join(", ")}\n9999`)
    assert.equal(
        (create.getByRole("combobox", { name: "Rule channels", hidden: true }) as HTMLInputElement).value,
        "9999",
    )
    paste(create, "Exempt roles", roleIds.join(" "))
    await submit(create)
    const rule = (calls[0]?.operation as { rule: { channelIds: string[]; exemptRoleIds: string[] } }).rule
    assert.deepEqual([rule.channelIds, rule.exemptRoleIds], [channelIds, roleIds])
    const staff = section(ui, "Moderation and staff")
    paste(staff, "Cases staff roles", roleIds.join("\n"))
    await submit(staff)
    assert.deepEqual(
        (calls[1]?.operation as { patch: { staffRoleIds: { cases: string[] } } }).patch.staffRoleIds.cases,
        roleIds,
    )
})
test("Only the server owner can choose the private data role, which saves through the shared configuration queue", async () => {
    const { ui, props, calls } = setup(SafetySettings, "moderation", moderation)
    const locked = section(ui, "Private data role")
    assert.ok(locked.getByText(/Only the server owner can change it/))
    pick(locked, "Private data role", "support")
    await submit(locked)
    assert.equal(calls.length, 0)
    cleanup()
    const owner = render(
        createElement(SafetySettings, { ...props, catalog: { ...catalog, ownerId: "99" }, userId: "99" }),
    )
    const form = section(owner, "Private data role")
    pick(form, "Private data role", "support")
    await submit(form)
    assert.deepEqual(
        calls.map((call) => call.operation),
        [{ type: "private-role", roleId: "55" }],
    )
})

test("Watchlist authored reasons are editable without exposing private moderation runtime records", async () => {
    const { ui, calls } = setup(SafetySettings, "moderation", {
        ...moderation,
        watchlist: [{ userId: "555", reason: "Old reason", createdAt: 1 }],
    })
    const form = section(ui, "Watchlist user: 555")
    fireEvent.change(form.getByLabelText("Watchlist reason"), { target: { value: "Updated configured reason" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, { type: "watchlist-add", userId: "555", reason: "Updated configured reason" })
})
test("Moderation rule and watchlist pagination use independent collection cursors", () => {
    const { ui, props } = setup(SafetySettings, "moderation", moderation),
        pages: Array<[string, string | undefined]> = []
    ui.rerender(
        createElement(SafetySettings, {
            ...props,
            remote: { ...props.remote, nextCursors: { rules: "synthetic-rules", watchlist: "synthetic-watchlist" } },
            loadPage: (collection, cursor) => pages.push([collection, cursor]),
        }),
    )
    fireEvent.click(ui.getByRole("button", { name: "Load more rules" }))
    fireEvent.click(ui.getByRole("button", { name: "Load more watchlist users" }))
    assert.deepEqual(pages, [
        ["rules", "synthetic-rules"],
        ["watchlist", "synthetic-watchlist"],
    ])
})

test("Autoresponder creation saves the complete supported reply, trigger, restrictions and default cooldown atomically", async () => {
    const { ui, calls } = setup(ResponseSettings, "responses", {
        settings: { customEnabled: true, autoEnabled: true },
        definitions: [],
    })
    const form = section(ui, "Create autoresponder")
    fireEvent.change(form.getByLabelText("Response name"), { target: { value: "Greeting" } })
    fireEvent.change(form.getByLabelText("Message text"), { target: { value: "Hello {user.name}" } })
    fireEvent.change(form.getByLabelText("Trigger text"), { target: { value: "hello" } })
    fireEvent.change(form.getByLabelText("Trigger match"), { target: { value: "contains" } })
    fireEvent.change(form.getByLabelText("Response priority"), { target: { value: "8" } })
    pick(form, "Allowed response channels", "welc")
    pick(form, "Required response roles", "sup")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        kind: "auto",
        operation: {
            type: "definition-create",
            definition: {
                name: "greeting",
                reply: { type: "text", text: "Hello {user.name}" },
                enabled: true,
                trigger: { mode: "contains", text: "hello" },
                channelIds: ["123"],
                roleIds: ["55"],
                cooldownSeconds: 5,
                priority: 8,
            },
        },
    })
    assert.equal(calls[0]?.revision, 7)
    assert.match(calls[0]!.requestId, /^[0-9a-f-]{36}$/)
    assert.ok(form.getByText("Change queued. Waiting for bot confirmation"))
})
test("A response scope takes more than 20 channels and roles, pasted at once", async () => {
    const channelIds = Array.from({ length: 30 }, (_, index) => String(1000 + index)),
        roleIds = Array.from({ length: 30 }, (_, index) => String(2000 + index))
    const { ui, calls } = setup(
        ResponseSettings,
        "responses",
        { settings: { customEnabled: true, autoEnabled: true }, definitions: [] },
        {
            serverId: "2",
            roles: roleIds.map((id, index) => ({ id, name: `Role ${index}`, position: index + 1 })),
            channels: channelIds.map((id, index) => ({ id, name: `Room ${index}`, type: 0 })),
        },
    )
    const paste = (name: string, text: string) =>
        fireEvent.paste(form.getByRole("combobox", { name, hidden: true }), { clipboardData: { getData: () => text } })
    const form = section(ui, "Create autoresponder")
    fireEvent.change(form.getByLabelText("Response name"), { target: { value: "Greeting" } })
    fireEvent.change(form.getByLabelText("Message text"), { target: { value: "Hello" } })
    fireEvent.change(form.getByLabelText("Trigger text"), { target: { value: "hello" } })
    paste("Allowed response channels", channelIds.map((id) => `<#${id}>`).join(", "))
    paste("Required response roles", roleIds.join("\n"))
    await submit(form)
    const definition = (
        calls[0]?.operation as { operation: { definition: { channelIds: string[]; roleIds: string[] } } }
    ).operation.definition
    assert.deepEqual([definition.channelIds, definition.roleIds], [channelIds, roleIds])
})
test("Response rich JSON cannot bypass the restricted message profile", async () => {
    const { ui, calls } = setup(ResponseSettings, "responses", {
        settings: { customEnabled: true, autoEnabled: true },
        definitions: [],
    })
    const form = section(ui, "Create custom command")
    fireEvent.change(form.getByLabelText("Response name"), { target: { value: "hello" } })
    fireEvent.click(form.getByRole("button", { name: "Import / export JSON", hidden: true }))
    fireEvent.change(form.getByLabelText("Message JSON"), {
        target: { value: '{"embed":{"description":"Hello","fields":[{"name":"secret","value":"rich"}]}}' },
    })
    fireEvent.click(form.getByRole("button", { name: "Import JSON", hidden: true }))
    assert.ok(form.getByRole("alert"))
    assert.equal(calls.length, 0)
})
test("Publishing edits preserve rich fields and the exact saved definition revision", async () => {
    const draft = {
        ...templates[0]!,
        content: {
            content: "Before",
            embed: { description: "Info", fields: [{ name: "A", value: "B", inline: true }] },
        },
    }
    const { ui, calls } = setup(PublishingSettings, "publishing", { settings: { enabled: true }, drafts: [draft] })
    const form = section(ui, "Template: welcome")
    fireEvent.change(form.getByLabelText("Message text"), { target: { value: "After" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "draft-set",
        kind: "template",
        name: "welcome",
        expectedRevision: 9,
        content: {
            content: "After",
            embed: { description: "Info", fields: [{ name: "A", value: "B", inline: true }] },
        },
    })
})
test("Greeting channel edits preserve the frozen template revision instead of replacing it with the latest", async () => {
    const route = {
        revision: 2,
        enabled: true,
        timing: "join" as const,
        channelId: "123",
        templateName: "welcome",
        templateRevision: 2,
    }
    const { ui, calls } = setup(GreetingSettings, "greetings", {
        settings: { claimsPerMinute: 10, retentionDays: 180, routes: { welcome: route, dm: route, goodbye: route } },
    })
    const form = section(ui, "Channel welcome route")
    assert.ok(form.getByText("Follows this template. Edits apply to the next post right away"))
    assert.match(
        form.getByText(/Greeting text placeholders/).textContent ?? "",
        /\{user\.name\}, \{user\.mention\}, \{user\.id\}/,
    )
    pick(form, "Channel welcome channel", "calndr")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "configure",
        route: "welcome",
        templateName: "welcome",
        expectedTemplateRevision: 2,
        channelId: "456",
        timing: "join",
    })
})
test("Ticket category edits include questions, audience and the native-proof-free role selection", async () => {
    const category = {
        name: "help",
        revision: 3,
        enabled: true,
        visibility: "private" as const,
        description: "Help",
        parentId: null,
        supportRoleIds: [],
        questions: ["What happened?"],
        cannedReplies: [],
    }
    const { ui, calls } = setup(TicketSettings, "tickets", {
        settings: { enabled: true, retentionDays: 7 },
        categories: [category],
    })
    assert.ok(
        section(ui, "Add canned reply: help").getByText(
            "Follows this template. Edits apply to the next post right away",
        ),
    )
    const form = section(ui, "Ticket category: help")
    fireEvent.change(form.getByLabelText("Intake questions 1"), { target: { value: "What do you need?" } })
    pick(form, "Ticket support roles", "sup")
    pick(form, "Ticket parent category", "tckt")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "category-update",
        name: "help",
        expectedRevision: 3,
        patch: {
            enabled: true,
            visibility: "private",
            description: "Help",
            parentId: "789",
            supportRoleIds: ["55"],
            questions: ["What do you need?"],
        },
    })
})
test("Level-up messages are off, where members level up or in one picked channel, optionally only reward levels", async () => {
    const settings = {
        enabled: true,
        xpPerMessage: 10,
        cooldownSeconds: 60,
        excludedChannelIds: [],
        excludedRoleIds: [],
        revision: 2,
        mappingRevision: 4,
        scoreEpoch: 1,
        mappings: [],
    }
    const levelUp = async (
        saved: LevelingLevelUp | undefined,
        change: (form: ReturnType<typeof within>) => void,
    ): Promise<unknown> => {
        const { ui, calls } = setup(LevelingSettings, "leveling", {
            settings: saved ? { ...settings, levelUp: saved } : settings,
        })
        const form = section(ui, "Leveling")
        change(form)
        await submit(form)
        cleanup()
        return (calls[0]?.operation as { patch: { levelUp: unknown } } | undefined)?.patch.levelUp
    }
    assert.deepEqual(
        await levelUp(undefined, (form) => {
            assert.equal((form.getByLabelText("Level-up messages") as HTMLSelectElement).value, "off")
            assert.equal(form.queryByLabelText("Only levels with a reward role"), null)
            fireEvent.change(form.getByLabelText("Level-up messages"), { target: { value: "here" } })
            fireEvent.click(form.getByLabelText("Only levels with a reward role"))
        }),
        { channelId: null, rewardsOnly: true },
    )
    assert.deepEqual(
        await levelUp(undefined, (form) => {
            fireEvent.change(form.getByLabelText("Level-up messages"), { target: { value: "channel" } })
            pick(form, "Level-up message channel", "cal")
        }),
        { channelId: "456", rewardsOnly: false },
    )
    // Forum and media channels take no plain message, so only text and announcement channels are offered
    assert.deepEqual(
        await levelUp(undefined, (form) => {
            fireEvent.change(form.getByLabelText("Level-up messages"), { target: { value: "channel" } })
            const picker = form.getByRole("combobox", { name: "Level-up message channel", hidden: true })
            for (const [name, offered] of [
                ["Ideas", false],
                ["Gallery", false],
                ["Calendar", true],
                ["News", true],
            ] as const) {
                fireEvent.change(picker, { target: { value: name } })
                assert.equal(
                    form.queryAllByRole("option", { name: new RegExp(name), hidden: true }).length,
                    offered ? 1 : 0,
                    name,
                )
            }
            fireEvent.keyDown(picker, { key: "Enter" })
        }),
        { channelId: "987", rewardsOnly: false },
    )
    // A saved channel shows as chosen, and choosing off sends null
    assert.equal(
        await levelUp({ channelId: "456", rewardsOnly: true }, (form) => {
            assert.equal((form.getByLabelText("Level-up messages") as HTMLSelectElement).value, "channel")
            assert.equal((form.getByLabelText("Only levels with a reward role") as HTMLInputElement).checked, true)
            fireEvent.change(form.getByLabelText("Level-up messages"), { target: { value: "off" } })
        }),
        null,
    )
})
test("Level reward mapping edits retain the dedicated mapping revision", async () => {
    const { ui, calls } = setup(LevelingSettings, "leveling", {
        settings: {
            enabled: true,
            xpPerMessage: 10,
            cooldownSeconds: 60,
            excludedChannelIds: [],
            excludedRoleIds: [],
            revision: 2,
            mappingRevision: 4,
            scoreEpoch: 1,
            mappings: [{ level: 5, roleId: "55" }],
        },
    })
    const form = section(ui, "Level reward roles")
    fireEvent.change(form.getByLabelText("Reward level 1"), { target: { value: "8" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "mappings",
        expectedMappingRevision: 4,
        mappings: [{ level: 8, roleId: "55" }],
    })
})
test("Leveling exclusions take more than 50 pasted channels and roles, and each list clears at once", async () => {
    const channelIds = Array.from({ length: 51 }, (_, index) => String(1000 + index)),
        roleIds = Array.from({ length: 51 }, (_, index) => String(2000 + index))
    const settings = {
        enabled: true,
        xpPerMessage: 10,
        cooldownSeconds: 60,
        excludedChannelIds: ["1000"],
        excludedRoleIds: ["2050"],
        revision: 2,
        mappingRevision: 4,
        scoreEpoch: 1,
        mappings: [],
    }
    const { ui, calls } = setup(
        LevelingSettings,
        "leveling",
        { settings },
        {
            serverId: "2",
            roles: roleIds.map((id, index) => ({ id, name: `Role ${index}`, position: index + 1 })),
            channels: channelIds.map((id, index) => ({ id, name: `Room ${index}`, type: 0 })),
        },
    )
    const form = section(ui, "Leveling"),
        paste = (name: string, text: string) =>
            fireEvent.paste(form.getByRole("combobox", { name, hidden: true }), {
                clipboardData: { getData: () => text },
            })
    // Replacing a list is clearing it and pasting the new one, and an ID that matches no channel stays in the box
    for (const name of ["Remove all excluded XP channels", "Remove all excluded XP roles"]) {
        fireEvent.click(form.getByRole("button", { name, hidden: true }))
        assert.equal(form.queryByRole("button", { name, hidden: true }), null)
    }
    paste("Excluded XP channels", `${channelIds.map((id) => `<#${id}>`).join(", ")}\n9999`)
    assert.equal(
        (form.getByRole("combobox", { name: "Excluded XP channels", hidden: true }) as HTMLInputElement).value,
        "9999",
    )
    paste("Excluded XP roles", roleIds.join("\n"))
    await submit(form)
    const patch = (calls[0]?.operation as { patch: { excludedChannelIds: string[]; excludedRoleIds: string[] } }).patch
    assert.deepEqual([patch.excludedChannelIds, patch.excludedRoleIds], [channelIds, roleIds])
})
test("Leveling saves the channels that earn XP beside the exclusions, and clearing them lets every channel earn again", async () => {
    const channelIds = Array.from({ length: 51 }, (_, index) => String(1000 + index))
    const settings = {
        enabled: true,
        xpPerMessage: 10,
        cooldownSeconds: 60,
        onlyChannelIds: ["1000"],
        excludedChannelIds: ["1001"],
        excludedRoleIds: [],
        revision: 2,
        mappingRevision: 4,
        scoreEpoch: 1,
        mappings: [],
    }
    const { ui, calls } = setup(
        LevelingSettings,
        "leveling",
        { settings },
        {
            serverId: "2",
            roles: [],
            channels: channelIds.map((id, index) => ({ id, name: `Room ${index}`, type: 0 })),
        },
    )
    const form = section(ui, "Leveling"),
        name = "Channels that earn XP"
    fireEvent.paste(form.getByRole("combobox", { name, hidden: true }), {
        clipboardData: { getData: () => channelIds.slice(1).join(" ") },
    })
    await submit(form)
    const patch = (calls[0]?.operation as { patch: { onlyChannelIds: string[]; excludedChannelIds: string[] } }).patch
    assert.deepEqual([patch.onlyChannelIds, patch.excludedChannelIds], [channelIds, ["1001"]])
})
test("Removing every channel that earns XP saves an empty list, which lets every channel earn again", async () => {
    const { ui, calls } = setup(LevelingSettings, "leveling", {
        settings: {
            enabled: true,
            xpPerMessage: 10,
            cooldownSeconds: 60,
            onlyChannelIds: ["456"],
            excludedChannelIds: [],
            excludedRoleIds: [],
            revision: 2,
            mappingRevision: 4,
            scoreEpoch: 1,
            mappings: [],
        },
    })
    const form = section(ui, "Leveling")
    fireEvent.click(form.getByRole("button", { name: "Remove all channels that earn XP", hidden: true }))
    await submit(form)
    assert.deepEqual((calls[0]?.operation as { patch: { onlyChannelIds: string[] } }).patch.onlyChannelIds, [])
})
test("More than 20 level rewards are pasted at once, invalid ones stay in the box, and the list clears or is replaced", async () => {
    const { ui, calls } = setup(LevelingSettings, "leveling", {
        settings: {
            enabled: true,
            xpPerMessage: 10,
            cooldownSeconds: 60,
            excludedChannelIds: [],
            excludedRoleIds: [],
            revision: 2,
            mappingRevision: 4,
            scoreEpoch: 1,
            mappings: [{ level: 5, roleId: "55" }],
        },
    })
    const form = section(ui, "Level reward roles"),
        box = form.getByLabelText(/^Add several rewards/),
        many = Array.from({ length: 30 }, (_, index) => `${index + 10} <@&${3000 + index}>`)
    fireEvent.change(box, { target: { value: `${many.join(", ")}\n0 3100\n6 55\n7 abc` } })
    fireEvent.click(form.getByRole("button", { name: "Add rewards", hidden: true }))
    // A level out of range, a role already used and a line without a role ID stay in the box
    assert.equal((box as HTMLTextAreaElement).value, "0 3100\n6 55\n7 abc")
    assert.ok(form.getByText(/^The list now holds 31\. 3 left in the box/))
    fireEvent.change(box, { target: { value: "3 56\n4 57" } })
    fireEvent.click(form.getByRole("button", { name: "Replace the rewards with these", hidden: true }))
    assert.equal(form.getAllByText(/^Reward \d+$/).length, 2)
    fireEvent.click(form.getByRole("button", { name: "Remove all level rewards", hidden: true }))
    assert.equal(form.queryAllByText(/^Reward \d+$/).length, 0)
    fireEvent.change(box, { target: { value: many.join("\n") } })
    fireEvent.click(form.getByRole("button", { name: "Add rewards", hidden: true }))
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "mappings",
        expectedMappingRevision: 4,
        mappings: many.map((_, index) => ({ level: index + 10, roleId: String(3000 + index) })),
    })
})
test("Suggestion destination uses the selected guild owner rather than the dashboard actor", async () => {
    const { ui, calls } = setup(SuggestionSettings, "suggestions", {
        settings: {
            enabled: true,
            revision: 3,
            suggestions: 0,
            voters: 0,
            staffReceipts: 0,
            memberReceipts: 0,
            dirty: 0,
            blocked: 0,
        },
    })
    const form = section(ui, "Suggestion destination")
    pick(form, "Suggestion channel", "cal")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, { type: "configure", expectedRevision: 3, channelId: "456", ownerId: "99" })
})
test("Suggestion destination offers forum channels, where each suggestion becomes a post", async () => {
    const { ui, calls } = setup(SuggestionSettings, "suggestions", {
        settings: {
            enabled: true,
            revision: 3,
            suggestions: 0,
            voters: 0,
            staffReceipts: 0,
            memberReceipts: 0,
            dirty: 0,
            blocked: 0,
        },
    })
    const form = section(ui, "Suggestion destination")
    pick(form, "Suggestion channel", "ide")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, { type: "configure", expectedRevision: 3, channelId: "321", ownerId: "99" })
})
test("Event discussion threads turn on with the shared settings revision", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [],
    })
    const form = section(ui, "Discussion threads")
    fireEvent.click(form.getByLabelText("Discussion threads"))
    await submit(form)
    assert.deepEqual(calls[0]?.operation, { type: "threads", expectedRevision: 1, enabled: true })
})
test("Milestone creation sends civil clock and frozen template without browser native evidence", async () => {
    const { ui, calls } = setup(MilestoneSettings, "milestones", {
        settings: { enabled: true, revision: 2, activatedAt: 1 },
        routes: [],
    })
    const form = section(ui, "Birthday route")
    assert.ok(form.getByText("Follows this template. Edits apply to the next post right away"))
    pick(form, "Birthday channel", "wel")
    pick(form, "Birthday template", "wel")
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "configure",
        kind: "birthday",
        expectedRevision: 0,
        channelId: "123",
        zone: "UTC",
        time: "09:00",
        fold: "reject",
        template: { name: "welcome", revision: 9 },
    })
})
test("Event editors mount only once opened, and an event with a stored draft starts open", async () => {
    const { ui, props } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    assert.ok(ui.queryByRole("region", { name: "Event content meetup", hidden: true }) === null)
    await openEditors(ui)
    assert.ok(section(ui, "Event content meetup"))
    cleanup()
    const scope = { userId: "1", serverId: "2", section: "events" }
    const capacityForm = rowForm(String(event.eventNo), "Event capacity meetup")
    writeDraft(scope, capacityForm, {
        base: { revision: 7, values: { unlimited: true, capacity: "50" } },
        values: { unlimited: false, capacity: "20" },
    })
    const restored = render(createElement(DraftScopeProvider, { value: scope }, createElement(EventSettings, props)))
    assert.equal(
        (section(restored, "Event capacity meetup").getByLabelText("Event capacity") as HTMLInputElement).value,
        "20",
    )
    clearDraft(scope, capacityForm)
})
test("Event calendar edits strip resolved dates and normalize draft numeric values", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    fireEvent.change(form.getByLabelText("Duration (minutes)"), { target: { value: "90" } })
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "weekly" } })
    // Every 13 weeks is a quarterly meeting
    fireEvent.change(form.getByLabelText("Repeat interval"), { target: { value: "13" } })
    fireEvent.change(form.getByLabelText("Ends"), { target: { value: "count" } })
    fireEvent.change(form.getByLabelText("Number of dates"), { target: { value: "40" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "calendar",
        eventNo: 4,
        expectedRevision: 3,
        calendar: {
            localMinute: "2027-01-10T09:00",
            zone: "UTC",
            fold: "reject",
            durationMinutes: 90,
            recurrence: { type: "weekly", interval: 13, count: 40 },
        },
    })
})
for (const [ends, recurrence] of [
    ["never", { type: "weekly", interval: 1 }],
    ["until", { type: "weekly", interval: 1, until: "2027-06-30" }],
] as const)
    test(`A published event with replies keeps an open calendar form, and a repeat can end ${ends === "never" ? "never" : "on a date"}`, async () => {
        const { ui, calls } = setup(EventSettings, "events", {
            settings: { enabled: true, revision: 1, threads: false },
            events: [{ ...event, state: "open", participationStarted: true }],
        })
        await openEditors(ui)
        const form = section(ui, "Event calendar meetup")
        assert.ok(form.getByText(/Upcoming dates keep their numbers and replies/))
        fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "weekly" } })
        assert.equal((form.getByLabelText("Ends") as HTMLSelectElement).value, "never")
        fireEvent.change(form.getByLabelText("Ends"), { target: { value: ends } })
        if (ends === "until") fireEvent.change(form.getByLabelText("Last date"), { target: { value: "2027-06-30" } })
        await submit(form)
        assert.deepEqual(calls[0]?.operation, {
            type: "calendar",
            eventNo: 4,
            expectedRevision: 3,
            calendar: { localMinute: "2027-01-10T09:00", zone: "UTC", fold: "reject", durationMinutes: 60, recurrence },
        })
    })
test("A repeat that has begun opens its calendar form at its next date with the dates it has left", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [
            {
                ...event,
                state: "started",
                calendar: { ...event.calendar, recurrence: { type: "weekly", interval: 1, count: 10 } },
                resume: { localMinute: "2027-01-24T09:00", count: 8 },
            },
        ],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    assert.equal((form.getByLabelText("Local date and time") as HTMLInputElement).value, "2027-01-24T09:00")
    assert.equal((form.getByLabelText("Number of dates") as HTMLInputElement).value, "8")
    fireEvent.change(form.getByLabelText("Repeat interval"), { target: { value: "2" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "calendar",
        eventNo: 4,
        expectedRevision: 3,
        calendar: {
            localMinute: "2027-01-24T09:00",
            zone: "UTC",
            fold: "reject",
            durationMinutes: 60,
            recurrence: { type: "weekly", interval: 2, count: 8 },
        },
    })
})
test("A single event date can last past 180 days, and a repeat's date longer than 180 days is refused with that reason", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    fireEvent.change(form.getByLabelText("Duration (minutes)"), { target: { value: "259201" } })
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "daily" } })
    await submit(form)
    assert.ok(
        form
            .getByRole("alert")
            .textContent?.includes(
                "A date of a repeat lasts at most 259200 minutes (180 days), the window a repeat stores its dates in",
            ),
    )
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "none" } })
    await submit(form)
    assert.equal((calls[0]?.operation as { calendar: { durationMinutes: number } }).calendar.durationMinutes, 259201)
})
test("An event can seat more than 500 members", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event capacity meetup")
    fireEvent.click(form.getByLabelText("Unlimited seats"))
    fireEvent.change(form.getByLabelText("Event capacity"), { target: { value: "2000" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, { type: "capacity", eventNo: 4, expectedRevision: 3, capacity: 2000 })
})
test("A counted repeat whose dates have all started opens its form with no count and asks for a new end", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [
            {
                ...event,
                state: "started",
                calendar: { ...event.calendar, recurrence: { type: "weekly", interval: 1, count: 2 } },
                resume: { localMinute: "2027-01-24T09:00", count: 0 },
            },
        ],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    assert.ok(form.getByText(/Every date of this repeat has started\. Choose how it ends/))
    assert.equal(form.queryByLabelText("Number of dates"), null)
    fireEvent.change(form.getByLabelText("Ends"), { target: { value: "count" } })
    fireEvent.change(form.getByLabelText("Number of dates"), { target: { value: "3" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "calendar",
        eventNo: 4,
        expectedRevision: 3,
        calendar: {
            localMinute: "2027-01-24T09:00",
            zone: "UTC",
            fold: "reject",
            durationMinutes: 60,
            recurrence: { type: "weekly", interval: 1, count: 3 },
        },
    })
})
test("A repeat may be 400 days apart, and one with a date past the year 9999 is refused with that reason", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "daily" } })
    fireEvent.change(form.getByLabelText("Repeat interval"), { target: { value: "9007199254740991" } })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes("after 9999-12-31, the last date a calendar supports"))
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Repeat interval"), { target: { value: "400" } })
    fireEvent.change(form.getByLabelText("Ends"), { target: { value: "count" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "calendar",
        eventNo: 4,
        expectedRevision: 3,
        calendar: {
            localMinute: "2027-01-10T09:00",
            zone: "UTC",
            fold: "reject",
            durationMinutes: 60,
            recurrence: { type: "daily", interval: 400, count: 2 },
        },
    })
})
test("A daily repeat's reminder further ahead than its 26 stored dates is refused with that reason", async () => {
    const reason =
        "A reminder of this repeat comes at most 36000 minutes (25 days) before a date, since NeonFlux stores its next 26 dates and adds each later date with its reminders as an earlier one starts"
    const daily = {
        ...event,
        calendar: { ...event.calendar, recurrence: { type: "daily" as const, interval: 1 } },
    }
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [daily],
    })
    await openEditors(ui)
    const form = section(ui, "Event reminders meetup")
    fireEvent.click(form.getByRole("button", { name: "Add reminder minutes", hidden: true }))
    fireEvent.change(form.getByLabelText("Reminder minutes 1"), { target: { value: "43200" } })
    await submit(form)
    assert.equal(form.getByRole("alert").textContent, reason)
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Reminder minutes 1"), { target: { value: "36000" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, { type: "reminders", eventNo: 4, expectedRevision: 3, offsets: [36000] })
})
test("Making an event with a 30-day reminder a daily repeat is refused with that reason", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [{ ...event, reminderOffsets: [43200] }],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "daily" } })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes("at most 36000 minutes (25 days)"))
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "weekly" } })
    await submit(form)
    assert.equal((calls[0]?.operation as { type: string }).type, "calendar")
})
test("Making a single event with a 400-day reminder a weekly repeat is refused with the 179-day reason", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [{ ...event, reminderOffsets: [576000] }],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    fireEvent.change(form.getByLabelText("Repeat"), { target: { value: "weekly" } })
    await submit(form)
    assert.equal(
        form.getByRole("alert").textContent,
        "A reminder of a repeat comes at most 257760 minutes (179 days) before a date, since NeonFlux stores a repeat's later date once it is 180 days ahead",
    )
    assert.equal(calls.length, 0)
})
test("Event reminders enforce actual bounds and duplicate offsets before queueing", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event reminders meetup")
    fireEvent.click(form.getByRole("button", { name: "Add reminder minutes", hidden: true }))
    fireEvent.change(form.getByLabelText("Reminder minutes 1"), {
        target: { value: String(EVENTS_REMINDER_RANGE_MINUTES + 1) },
    })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes(String(EVENTS_REMINDER_RANGE_MINUTES)))
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Reminder minutes 1"), { target: { value: "60" } })
    fireEvent.click(form.getByRole("button", { name: "Add reminder minutes", hidden: true }))
    fireEvent.change(form.getByLabelText("Reminder minutes 2"), { target: { value: "60" } })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes("distinct"))
    assert.equal(calls.length, 0)
    // A single date's reminder can come 400 days ahead, and an event has more than two
    fireEvent.change(form.getByLabelText("Reminder minutes 2"), { target: { value: "576000" } })
    fireEvent.click(form.getByRole("button", { name: "Add reminder minutes", hidden: true }))
    fireEvent.change(form.getByLabelText("Reminder minutes 3"), { target: { value: "10" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "reminders",
        eventNo: 4,
        expectedRevision: 3,
        offsets: [576000, 60, 10],
    })
})
test("Dirty event definitions survive live drift and submit only after explicit review", async () => {
    const { ui, calls, props } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event content meetup")
    fireEvent.change(form.getByLabelText("Event title"), { target: { value: "My title" } })
    const remote = structuredClone(props.remote) as DeepMutable<typeof props.remote>
    remote.configRevision = 8
    remote.data.events[0]!.revision = 4
    remote.data.events[0]!.title = "Another title"
    ui.rerender(createElement(EventSettings, { ...props, remote }))
    assert.equal((form.getByLabelText("Event title") as HTMLInputElement).value, "My title")
    assert.ok(form.getByText("Changed elsewhere"))
    await submit(form)
    assert.equal(calls.length, 0)
    fireEvent.click(form.getByRole("button", { name: "Keep my draft after review", hidden: true }))
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "content",
        eventNo: 4,
        expectedRevision: 4,
        title: "My title",
        description: "Chat",
    })
    assert.equal(calls[0]?.revision, 8)
})
test("A removed response retains its dirty draft for copying and blocks mutations without blocking current family settings", async () => {
    const definition = {
        name: "hello",
        kind: "custom" as const,
        reply: { type: "text" as const, text: "Original reply" },
        enabled: true,
        channelIds: [],
        roleIds: [],
        cooldownSeconds: 0,
        priority: 0,
        createdAt: 1,
        updatedAt: 1,
    }
    const { ui, calls, props } = setup(ResponseSettings, "responses", {
        settings: { customEnabled: true, autoEnabled: true },
        definitions: [definition],
    })
    const form = section(ui, "Response: hello")
    fireEvent.change(form.getByLabelText("Message text"), { target: { value: "Keep my unsaved reply" } })
    ui.rerender(
        createElement(ResponseSettings, {
            ...props,
            remote: { ...props.remote, configRevision: 8 },
            removedDefinitions: ["custom:hello"],
        }),
    )
    assert.equal((form.getByLabelText("Message text") as HTMLTextAreaElement).value, "Keep my unsaved reply")
    assert.ok(
        ui.getByText(
            "Not in loaded pages. This draft is kept for copying. Load remaining pages to check whether it moved",
        ),
    )
    // The missing definition notice blocks the save. The revision move alone is no conflict, so there is nothing to review away
    assert.ok(
        !form.queryByRole("button", { name: "Keep my draft after review", hidden: true }),
        "no revision conflict to review",
    )
    assert.equal((form.getByRole("button", { name: "Save changes", hidden: true }) as HTMLButtonElement).disabled, true)
    await submit(form)
    assert.equal(calls.length, 0)
    const module = section(ui, "Custom commands")
    fireEvent.click(module.getByLabelText("Custom commands enabled"))
    await submit(module)
    assert.deepEqual(calls[0]?.operation, { kind: "custom", operation: { type: "module", enabled: false } })
})
test("A removed event blocks its calendar form while retaining the exact civil date draft", async () => {
    const { ui, calls, props } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event calendar meetup")
    fireEvent.change(form.getByLabelText("Duration (minutes)"), { target: { value: "90" } })
    ui.rerender(createElement(EventSettings, { ...props, removedDefinitions: ["4"] }))
    assert.equal((form.getByLabelText("Duration (minutes)") as HTMLInputElement).value, "90")
    assert.equal((form.getByRole("button", { name: "Save changes", hidden: true }) as HTMLButtonElement).disabled, true)
    await submit(form)
    assert.equal(calls.length, 0)
})
test("Schedules create a finite plan from the chosen source without resolved dates or fabricated recipient proof", async () => {
    const { ui, calls } = setup(ScheduleSettings, "schedules", {
        settings: { enabled: true, revision: 1, activatedAt: 1 },
        schedules: [],
    })
    const form = section(ui, "Create schedule")
    fireEvent.change(form.getByLabelText("Schedule name"), { target: { value: "weekly" } })
    pick(form, "Schedule source", "wel")
    pick(form, "Schedule channel", "cal")
    fireEvent.change(form.getByLabelText("Local date and time"), { target: { value: "2027-01-10T09:00" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "create",
        name: "weekly",
        source: { kind: "template", name: "welcome", revision: 9 },
        channelId: "456",
        calendar: { localMinute: "2027-01-10T09:00", zone: "UTC", fold: "reject", recurrence: { type: "none" } },
    })
})
test("A saved schedule shows what it posts and its stored upcoming dates from its own copy, each in both zones", async (context) => {
    const at = (localMinute: string, offsetMinutes: number) => Date.parse(`${localMinute}:00Z`) - offsetMinutes * 60000
    const dates = [
        { localMinute: "2027-01-10T09:00", offsetMinutes: 60, dueAt: at("2027-01-10T09:00", 60) },
        { localMinute: "2027-07-10T09:00", offsetMinutes: 120, dueAt: at("2027-07-10T09:00", 120) },
        { localMinute: "2027-12-10T09:00", offsetMinutes: -330, dueAt: at("2027-12-10T09:00", -330) },
    ]
    context.mock.method(Date, "now", () => dates[1]!.dueAt - 1)
    const content = { content: "Weekly digest", embed: { title: "Digest" } }
    const { ui } = setup(ScheduleSettings, "schedules", {
        settings: { enabled: true, revision: 1, activatedAt: 1 },
        schedules: [
            {
                scheduleNo: 3,
                name: "weekly",
                revision: 2,
                planRevision: 2,
                createdBy: "99",
                channelId: "456",
                source: { kind: "template", name: "welcome", revision: 9 },
                content,
                canonicalContent: content,
                calendar: {
                    localMinute: "2027-01-10T09:00",
                    zone: "Europe/Paris",
                    fold: "reject",
                    recurrence: { type: "daily", interval: 1 },
                    dates: [dates[0]!],
                },
                // Later dates the backend added, which the calendar's first dates do not hold
                upcoming: dates.slice(1),
                enabled: true,
                cancelled: false,
                activatedAt: 1,
                createdAt: 1,
                updatedAt: 2,
            },
        ],
    })
    const details = ui.getByText("What it posts and when").closest("details")!
    assert.ok(ui.queryByText("Weekly digest") === null, "nothing mounts until it is opened")
    await act(async () => {
        details.open = true
        fireEvent(details, new window.Event("toggle"))
    })
    const preview = within(ui.getByRole("region", { name: "Message preview", hidden: true }))
    assert.ok(preview.getByRole("heading", { name: "Saved message", hidden: true }))
    assert.ok(preview.getByText("Weekly digest"))
    const rows = within(details)
        .getAllByRole("row", { hidden: true })
        .slice(1)
        .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent))
    assert.deepEqual(rows, [
        ["2027-07-10 09:00 (UTC+02:00)", localTime(dates[1]!.dueAt)],
        ["2027-12-10 09:00 (UTC-05:30)", localTime(dates[2]!.dueAt)],
    ])
    assert.ok(within(details).getByText("Upcoming dates in Europe/Paris"))
    assert.ok(within(details).getByText("Every day, no end date"))
})
test("Cleanup deletion enabling requires explicit confirmation and preserves exact policy revision", async () => {
    const policy = {
        channelId: "123",
        revision: 4,
        enabled: false,
        ageMs: 3600001,
        ownerId: "99",
        excludedAuthorIds: ["55"],
        excludedMessageIds: ["321"],
        nextCheckAt: 1,
    }
    const { ui, calls } = setup(CleanupSettings, "cleanup", {
        settings: {
            enabled: true,
            revision: 2,
            policies: 1,
            receipts: 0,
        },
        policies: [policy],
    })
    const form = section(ui, "Enable cleanup 123")
    fireEvent.click(form.getByLabelText("Channel cleanup enabled"))
    await submit(form)
    assert.equal(calls.length, 0)
    assert.ok(form.getByRole("alert").textContent?.includes("Confirm deletion"))
    fireEvent.click(form.getByLabelText("Confirm automatic message deletion"))
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "enable",
        channelId: "123",
        expectedRevision: 4,
        enabled: true,
        confirm: true,
    })
})
test("An inactive cleanup policy is deleted on the first click with the contract's confirmation, and an enabled one cannot be", async () => {
    const policy = {
        channelId: "123",
        revision: 4,
        enabled: false,
        ageMs: 3600001,
        ownerId: "99",
        excludedAuthorIds: [],
        excludedMessageIds: [],
        nextCheckAt: 1,
    }
    const { ui, calls } = setup(CleanupSettings, "cleanup", {
        settings: {
            enabled: true,
            revision: 2,
            policies: 1,
            receipts: 0,
        },
        policies: [policy],
    })
    const form = section(ui, "Delete inactive policy 123")
    await clickOnce(form, "Delete inactive policy")
    assert.deepEqual(calls[0]?.operation, {
        type: "policy-delete",
        channelId: "123",
        expectedRevision: 4,
        confirm: true,
    })
    cleanup()
    const enabled = setup(CleanupSettings, "cleanup", {
        settings: { enabled: true, revision: 2, policies: 1, receipts: 0 },
        policies: [{ ...policy, enabled: true }],
    })
    const locked = section(enabled.ui, "Delete inactive policy 123")
    assert.equal(
        (locked.getByRole("button", { name: "Delete inactive policy", hidden: true }) as HTMLButtonElement).disabled,
        true,
    )
    await submit(locked)
    assert.equal(enabled.calls.length, 0)
})
test("Cleanup exclusions take pasted ID lists, replace them or remove all in one job", async () => {
    const policy = {
        channelId: "123",
        revision: 4,
        enabled: false,
        ageMs: 3600000,
        ownerId: "99",
        excludedAuthorIds: ["55"],
        excludedMessageIds: ["321"],
        nextCheckAt: 1,
    }
    const { ui, calls } = setup(CleanupSettings, "cleanup", {
        settings: { enabled: true, revision: 2, policies: 1, receipts: 0 },
        policies: [policy],
    })
    const form = section(ui, "Cleanup exclusions 123")
    const rows = (label: string) =>
        form
            .queryAllByLabelText(new RegExp(`^${label} \\d+$`))
            .map((input: HTMLElement) => (input as HTMLInputElement).value)
    // More than the old 50 authors, apart, split by commas or one per line, added to the saved one
    const authors = Array.from({ length: 60 }, (_, index) => String(1000 + index))
    fireEvent.change(form.getByLabelText("Add several excluded authors, apart or split by commas or lines"), {
        target: { value: `${authors.slice(0, 30).join(" ")}\n${authors.slice(30).join(", ")}\n55` },
    })
    fireEvent.click(form.getAllByRole("button", { name: "Add IDs", hidden: true })[0]!)
    assert.deepEqual(rows("Excluded authors"), ["55", ...authors])
    // The note counts the IDs added, not the pasted lines
    assert.ok(form.getAllByRole("status", { hidden: true })[0]!.textContent?.includes("Added 60"))
    // The message list is replaced, and a wrong entry stays in the box to correct
    fireEvent.change(form.getByLabelText("Add several excluded messages, apart or split by commas or lines"), {
        target: { value: "777 888,nope" },
    })
    fireEvent.click(form.getAllByRole("button", { name: "Replace the list with these IDs", hidden: true })[1]!)
    assert.deepEqual(rows("Excluded messages"), ["777", "888"])
    assert.equal(
        (form.getByLabelText("Add several excluded messages, apart or split by commas or lines") as HTMLTextAreaElement)
            .value,
        "nope",
    )
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "exclusions",
        channelId: "123",
        expectedRevision: 4,
        excludedAuthorIds: ["55", ...authors],
        excludedMessageIds: ["777", "888"],
    })
    // Remove all empties a list in a single job too
    cleanup()
    const fresh = setup(CleanupSettings, "cleanup", {
            settings: { enabled: true, revision: 2, policies: 1, receipts: 0 },
            policies: [{ ...policy, excludedAuthorIds: authors }],
        }),
        cleared = section(fresh.ui, "Cleanup exclusions 123")
    fireEvent.click(cleared.getByRole("button", { name: "Remove all excluded authors", hidden: true }))
    await submit(cleared)
    assert.deepEqual(fresh.calls[0]?.operation, {
        type: "exclusions",
        channelId: "123",
        expectedRevision: 4,
        excludedAuthorIds: [],
        excludedMessageIds: ["321"],
    })
})
test("A repeated cleanup exclusion is refused on the page with the reason, before any job", async () => {
    const { ui, calls } = setup(CleanupSettings, "cleanup", {
        settings: { enabled: true, revision: 2, policies: 1, receipts: 0 },
        policies: [
            {
                channelId: "123",
                revision: 4,
                enabled: false,
                ageMs: 3600000,
                ownerId: "99",
                excludedAuthorIds: ["55", "66"],
                excludedMessageIds: [],
                nextCheckAt: 1,
            },
        ],
    })
    const form = section(ui, "Cleanup exclusions 123")
    fireEvent.change(form.getByLabelText("Excluded authors 2"), { target: { value: "55" } })
    await submit(form)
    assert.equal(form.getByRole("alert").textContent, "Keep up to 8,192 distinct entries in each exclusion list")
    assert.equal(calls.length, 0)
})
test("Cleanup age choices preserve exact saved milliseconds when editing only the owner", async () => {
    const policy = {
        channelId: "123",
        revision: 4,
        enabled: false,
        ageMs: 3600001,
        ownerId: "99",
        excludedAuthorIds: [],
        excludedMessageIds: [],
        nextCheckAt: 1,
    }
    const { ui, calls } = setup(CleanupSettings, "cleanup", {
        settings: {
            enabled: true,
            revision: 2,
            policies: 1,
            receipts: 0,
        },
        policies: [policy],
    })
    const form = section(ui, "Cleanup policy 123")
    assert.equal((form.getByLabelText("Message age unit") as HTMLSelectElement).value, "milliseconds")
    fireEvent.change(form.getByLabelText("Cleanup action owner ID"), { target: { value: "999" } })
    await submit(form)
    assert.deepEqual(calls[0]?.operation, {
        type: "configure",
        channelId: "123",
        expectedRevision: 4,
        ageMs: 3600001,
        ownerId: "999",
    })
})
test("Automod rules and watchlist entries are removed on the first click", async () => {
    const rule = {
        name: "links",
        type: "domains" as const,
        enabled: true,
        priority: 0,
        action: "delete" as const,
        threshold: 1,
        windowSeconds: 10,
        durationSeconds: 60,
        patterns: ["example.com"],
        domainMode: "block" as const,
        channelIds: [],
        exemptChannelIds: [],
        exemptRoleIds: [],
    }
    const { ui, calls } = setup(SafetySettings, "moderation", {
        ...moderation,
        rules: [rule],
        watchlist: [{ userId: "555", reason: "Old reason", createdAt: 1 }],
    })
    await clickOnce(section(ui, "Delete rule: links"), "Delete rule")
    await clickOnce(section(ui, "Remove watchlist user: 555"), "Remove watchlist entry")
    assert.deepEqual(
        calls.map((call) => call.operation),
        [
            { type: "rule-delete", name: "links" },
            { type: "watchlist-remove", userId: "555" },
        ],
    )
})
test("A response is deleted on the first click", async () => {
    const { ui, calls } = setup(ResponseSettings, "responses", {
        settings: { customEnabled: true, autoEnabled: true },
        definitions: [
            {
                name: "hello",
                kind: "custom",
                reply: { type: "text", text: "Hi" },
                enabled: true,
                channelIds: [],
                roleIds: [],
                cooldownSeconds: 0,
                priority: 0,
                createdAt: 1,
                updatedAt: 1,
            },
        ],
    })
    await clickOnce(section(ui, "Delete response: hello"), "Delete response")
    assert.deepEqual(calls[0]?.operation, { kind: "custom", operation: { type: "delete", name: "hello" } })
})
test("A saved template is deleted on the first click", async () => {
    const { ui, calls } = setup(PublishingSettings, "publishing", {
        settings: { enabled: true },
        drafts: [templates[0]!],
    })
    await clickOnce(section(ui, "Delete template: welcome"), "Delete saved definition")
    assert.deepEqual(calls[0]?.operation, {
        type: "draft-delete",
        kind: "template",
        name: "welcome",
        expectedRevision: 9,
    })
})
test("A greeting route is cleared on the first click", async () => {
    const route = {
        revision: 2,
        enabled: true,
        timing: "join" as const,
        channelId: "123",
        templateName: "welcome",
        templateRevision: 2,
    }
    const { ui, calls } = setup(GreetingSettings, "greetings", {
        settings: { claimsPerMinute: 10, retentionDays: 180, routes: { welcome: route, dm: route, goodbye: route } },
    })
    await clickOnce(section(ui, "Clear goodbye"), "Clear greeting route")
    assert.deepEqual(calls[0]?.operation, { type: "clear", route: "goodbye" })
})
test("A ticket category saves 25 intake questions", async () => {
    const questions = Array.from({ length: 25 }, (_, index) => `Question ${index + 1}`)
    const { ui, calls } = setup(TicketSettings, "tickets", {
        settings: { enabled: true, retentionDays: 7 },
        categories: [
            {
                name: "help",
                revision: 3,
                enabled: true,
                visibility: "private",
                description: "Help",
                parentId: null,
                supportRoleIds: [],
                questions,
                cannedReplies: [],
            },
        ],
    })
    const form = section(ui, "Ticket category: help")
    fireEvent.change(form.getByLabelText("Intake questions 25"), { target: { value: "Last question" } })
    await submit(form)
    assert.deepEqual((calls[0]?.operation as { patch: { questions: string[] } }).patch.questions, [
        ...questions.slice(0, 24),
        "Last question",
    ])
})
test("A category with 20 canned replies still offers to add another", () => {
    const { ui } = setup(TicketSettings, "tickets", {
        settings: { enabled: true, retentionDays: 7 },
        categories: [
            {
                name: "help",
                revision: 3,
                enabled: true,
                visibility: "private",
                description: "Help",
                parentId: null,
                supportRoleIds: [],
                questions: [],
                cannedReplies: Array.from({ length: 20 }, (_, index) => ({
                    name: `reply${index}`,
                    templateName: "answer",
                    templateRevision: 1,
                    content: { content: "Synthetic reply" },
                })),
            },
        ],
    })
    assert.ok(section(ui, "Add canned reply: help"))
})
test("A ticket category is deleted on the first click", async () => {
    const { ui, calls } = setup(TicketSettings, "tickets", {
        settings: { enabled: true, retentionDays: 7 },
        categories: [
            {
                name: "help",
                revision: 3,
                enabled: true,
                visibility: "private",
                description: "Help",
                parentId: null,
                supportRoleIds: [],
                questions: [],
                cannedReplies: [],
            },
        ],
    })
    await clickOnce(section(ui, "Delete ticket category: help"), "Delete ticket category")
    assert.deepEqual(calls[0]?.operation, { type: "category-delete", name: "help", expectedRevision: 3 })
})
test("A milestone route is cleared on the first click", async () => {
    const { ui, calls } = setup(MilestoneSettings, "milestones", {
        settings: { enabled: true, revision: 2, activatedAt: 1 },
        routes: [
            {
                kind: "birthday",
                revision: 5,
                intentRevision: 5,
                audienceGeneration: 1,
                createdBy: "99",
                channelId: "123",
                zone: "UTC",
                time: "09:00",
                fold: "reject",
                template: { name: "welcome", revision: 9 },
                content: { content: "Hello" },
                canonicalContent: { content: "Hello" },
                enabled: true,
                activatedAt: 1,
                createdAt: 1,
                updatedAt: 2,
            },
        ],
    })
    await clickOnce(section(ui, "Clear birthday route"), "Clear milestone route")
    assert.deepEqual(calls[0]?.operation, { type: "clear", kind: "birthday", expectedRevision: 5 })
})
test("An event is published on the first click, while cancelling and forgetting keep their confirmation", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    await clickOnce(section(ui, "Publish event meetup"), "Publish event")
    assert.deepEqual(calls[0]?.operation, { type: "publish", eventNo: 4, expectedRevision: 3 })
    for (const action of ["Cancel", "Forget"]) {
        const form = section(ui, `${action} event meetup`)
        assert.ok(form.getByLabelText(`Confirm ${action.toLowerCase()} event`))
        await submit(form)
    }
    assert.equal(calls.length, 1)
})
