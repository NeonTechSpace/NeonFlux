import type { LevelingLevelUp } from "@neonflux/contracts/leveling"
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
) {
    const calls: Array<{ operation: DashboardConfigurationOperationMap[F]; revision: number; requestId: string }> = []
    const props = {
        remote: { family, serverId: "2", configRevision: 7, jobs: [], data },
        connected: true,
        catalog,
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
    fireEvent.change(form.getByLabelText("Repeat interval"), { target: { value: "2" } })
    fireEvent.change(form.getByLabelText("Total occurrences"), { target: { value: "4" } })
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
            recurrence: { type: "weekly", interval: 2, count: 4 },
        },
    })
})
test("Event reminders enforce actual bounds and duplicate offsets before queueing", async () => {
    const { ui, calls } = setup(EventSettings, "events", {
        settings: { enabled: true, revision: 1, threads: false },
        events: [event],
    })
    await openEditors(ui)
    const form = section(ui, "Event reminders meetup")
    fireEvent.click(form.getByRole("button", { name: "Add reminder minutes", hidden: true }))
    fireEvent.change(form.getByLabelText("Reminder minutes 1"), { target: { value: "10081" } })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes("10080"))
    assert.equal(calls.length, 0)
    fireEvent.change(form.getByLabelText("Reminder minutes 1"), { target: { value: "60" } })
    fireEvent.click(form.getByRole("button", { name: "Add reminder minutes", hidden: true }))
    fireEvent.change(form.getByLabelText("Reminder minutes 2"), { target: { value: "60" } })
    await submit(form)
    assert.ok(form.getByRole("alert").textContent?.includes("distinct"))
    assert.equal(calls.length, 0)
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
test("A saved schedule shows what it posts and when from its own copy, with each date in both zones and past dates marked", async (context) => {
    const at = (localMinute: string, offsetMinutes: number) => Date.parse(`${localMinute}:00Z`) - offsetMinutes * 60000
    const dates = [
        { localMinute: "2027-01-10T09:00", offsetMinutes: 60, dueAt: at("2027-01-10T09:00", 60) },
        { localMinute: "2027-07-10T09:00", offsetMinutes: 120, dueAt: at("2027-07-10T09:00", 120) },
        { localMinute: "2027-12-10T09:00", offsetMinutes: -330, dueAt: at("2027-12-10T09:00", -330) },
    ]
    context.mock.method(Date, "now", () => dates[1]!.dueAt)
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
                    recurrence: { type: "none" },
                    dates,
                },
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
        ["2027-01-10 09:00 (UTC+01:00)", localTime(dates[0]!.dueAt), "Past"],
        ["2027-07-10 09:00 (UTC+02:00)", localTime(dates[1]!.dueAt), "Upcoming"],
        ["2027-12-10 09:00 (UTC-05:30)", localTime(dates[2]!.dueAt), "Upcoming"],
    ])
    assert.ok(within(details).getByText("Planned dates in Europe/Paris"))
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
