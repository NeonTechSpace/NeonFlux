import assert from "node:assert/strict"
import { afterEach, mock, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import type {
    DashboardBackupChangedItem,
    DashboardBackupItems,
    DashboardBackupRestore,
    DashboardCatalog,
    RecoveryInbox,
} from "@neonflux/backend/dashboard-contracts"
import type { SectionProps } from "../src/dashboard-sections.tsx"
import { RecoverySection } from "../src/recovery-inbox.tsx"
import { BackupSection } from "../src/backup-restore.tsx"
import { localTime } from "../src/time.ts"
import { BACKUP_PLAN_MS } from "@neonflux/contracts/backup"

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
    mock.restoreAll()
})

/** Answers by function name, or by a function of the arguments. Mutations are recorded with their arguments */
function client(answers: Record<string, unknown>, queued = true) {
    const calls: Array<{ name: string; args: unknown }> = []
    return {
        calls,
        client: {
            watchQuery: (ref: unknown, args: unknown) => ({
                localQueryResult: () => {
                    const answer = answers[getFunctionName(ref as never)]
                    return typeof answer === "function" ? answer(args) : answer
                },
                onUpdate: () => () => {},
            }),
            mutation: async (ref: unknown, args: unknown) => {
                calls.push({ name: getFunctionName(ref as never), args })
                return getFunctionName(ref as never) === "backup:restoreRequest" ? queued : null
            },
        } as unknown as ConvexReactClient,
    }
}
const props = (section: SectionProps["section"], convex: ConvexReactClient, opened: string[] = []) =>
    ({
        section,
        client: convex,
        sessionToken: "synthetic-session",
        serverId: "2",
        userId: "20",
        connected: true,
        catalogLoading: false,
        catalogError: false,
        refreshCatalog: () => {},
        sectionHref: (id: string) => `/?server=2&section=${id}`,
        openSection: (id: string) => {
            opened.push(id)
        },
    }) satisfies SectionProps

// The server's channel and role lists, which name the mentions in recovery entries and backup reasons
const catalog: DashboardCatalog = {
    serverId: "2",
    channels: [
        { id: "10", name: "Info", type: 4 },
        { id: "50", name: "news", type: 0 },
    ],
    roles: [
        { id: "2", name: "@everyone", position: 0 },
        { id: "40", name: "Members", position: 1 },
    ],
}

test("The recovery inbox shows each entry with when it happened and its next step, and links a feature that needs setup", async () => {
    const inbox: RecoveryInbox = {
        serverId: "2",
        truncated: false,
        entries: [
            { kind: "feature", feature: "logs" },
            {
                kind: "work",
                source: "publishing",
                at: Date.UTC(2026, 9, 1, 12, 30),
                summary: "Post #7: NeonFlux could not confirm whether it was sent",
                next: "!publish reconcile 7",
            },
            {
                kind: "work",
                source: "schedules",
                at: Date.UTC(2026, 9, 1, 12, 0),
                summary: "Schedule news, date 4 is waiting: NeonFlux cannot post in <#50>",
                next: "Give NeonFlux Send messages in <#50>",
            },
            // Members show their ID, as a command takes it, and a channel or role missing from the lists says so
            {
                kind: "work",
                source: "temproles",
                at: Date.UTC(2026, 9, 1, 11, 30),
                summary: "Temporary role <@&40> of <@30>: NeonFlux could not confirm the last role change",
                next: "!temprole reconcile <@30>",
            },
            {
                kind: "work",
                source: "cleanup",
                at: Date.UTC(2026, 9, 1, 11, 15),
                summary: "Cleanup in <#51> stopped: A message could not be deleted, <@&41> or <@&2> may matter",
                next: "Check it",
            },
            {
                kind: "setup",
                at: Date.UTC(2026, 9, 1, 11, 0),
                problem: { kind: "permissions", feature: "moderation", permissions: ["KickMembers"] },
            },
        ],
    }
    const opened: string[] = []
    const ui = render(
        createElement(RecoverySection, {
            ...props("recovery", client({ "recovery:inbox": inbox }).client, opened),
            catalog,
        }),
    )
    assert.deepEqual(
        within(ui.getByRole("list"))
            .getAllByRole("listitem")
            .map((item) => item.textContent),
        [
            "Now: Channel logs is on but needs setup, such as a channel or a first entry. Open Channel logs",
            `${localTime(Date.UTC(2026, 9, 1, 12, 30))}: Post #7: NeonFlux could not confirm whether it was sentNext: !publish reconcile 7`,
            `${localTime(Date.UTC(2026, 9, 1, 12, 0))}: Schedule news, date 4 is waiting: NeonFlux cannot post in #newsNext: Give NeonFlux Send messages in #news`,
            `${localTime(Date.UTC(2026, 9, 1, 11, 30))}: Temporary role @Members of @30: NeonFlux could not confirm the last role changeNext: !temprole reconcile 30`,
            `${localTime(Date.UTC(2026, 9, 1, 11, 15))}: Cleanup in #unknown-channel stopped: A message could not be deleted, @unknown-role or @everyone may matterNext: Check it`,
            `${localTime(Date.UTC(2026, 9, 1, 11, 0))}, permission check: Moderation and safety: Grant Kick members to the NeonFlux role`,
        ],
    )
    await act(async () => {
        fireEvent.click(ui.getByRole("link", { name: "Open Channel logs" }))
    })
    assert.deepEqual(opened, ["logs"])
    cleanup()
    const empty = render(
        createElement(
            RecoverySection,
            props("recovery", client({ "recovery:inbox": { serverId: "2", truncated: false, entries: [] } }).client),
        ),
    )
    assert.ok(empty.getByText("Nothing needs attention"))
})

test("The recovery inbox pages stopped role removals past its newest 10, and a removal that moves between pages shows once", async () => {
    const removal = (i: number): RecoveryInbox["entries"][number] => ({
        kind: "work",
        source: "removals",
        at: Date.UTC(2026, 9, 1, 12, 0) + i * 60000,
        summary: `Panel p${i}: Taking back its roles stopped at a role change that needs a check`,
        next: `Continue with !roles next p${i}`,
    })
    const range = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => removal(from - i))
    const at = (i: number) => Date.UTC(2026, 9, 1, 12, 0) + i * 60000
    // 25 stopped removals, newest first. The backend pages those that started before the cursor
    let resolved: number[] = []
    const updates: Array<() => void> = []
    const answer = (args: { removalsBefore?: number }) => {
        const all = range(24, 0).filter((entry) => !resolved.some((i) => entry.kind === "work" && entry.at === at(i)))
        const older = all.filter((entry) => entry.kind === "work" && entry.at! < (args.removalsBefore ?? Infinity)),
            shown = older.slice(0, 10)
        return {
            serverId: "2",
            truncated: false,
            entries: shown,
            ...(older.length > 10 ? { nextRemovalsBefore: (shown.at(-1) as { at: number }).at } : {}),
        }
    }
    const live = {
        watchQuery: (_ref: unknown, args: { removalsBefore?: number }) => ({
            localQueryResult: () => answer(args),
            onUpdate: (update: () => void) => {
                updates.push(update)
                return () => {}
            },
        }),
    } as unknown as ConvexReactClient
    const ui = render(createElement(RecoverySection, { ...props("recovery", live), catalog }))
    const panels = () => ui.getAllByRole("listitem").map((item) => /Panel (p\d+)/.exec(item.textContent ?? "")![1])
    assert.deepEqual(panels(), ["p24", "p23", "p22", "p21", "p20", "p19", "p18", "p17", "p16", "p15"])
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Show more stopped role removals" }))
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Show more stopped role removals" }))
    })
    assert.deepEqual(
        panels(),
        range(24, 0).map((entry) => /Panel (p\d+)/.exec((entry as { summary: string }).summary)![1]),
    )
    assert.equal(ui.queryByRole("button", { name: "Show more stopped role removals" }), null)
    // A resolved removal lets the next older one into its page, which the following page already shows
    resolved = [24, 10]
    await act(async () => {
        for (const update of updates) update()
    })
    assert.deepEqual(
        panels(),
        range(23, 0)
            .map((entry) => /Panel (p\d+)/.exec((entry as { summary: string }).summary)![1])
            .filter((name) => name !== "p10"),
    )
})

const CHECKED = Date.UTC(2026, 9, 1, 9, 0)
const base = { generation: 1, state: "planned", dependencyItemNo: null, mappedId: null } as const
const row = (itemNo: number, patch: Partial<DashboardBackupChangedItem>): DashboardBackupChangedItem => ({
    ...base,
    itemNo,
    category: "xp",
    family: "xp",
    sourceId: String(100 + itemNo),
    disposition: "create",
    reason: null,
    expectedHash: "b".repeat(64),
    desiredHash: "c".repeat(64),
    changes: [],
    ...patch,
})
const plan = (
    patch: Partial<NonNullable<DashboardBackupRestore["plan"]>> = {},
): NonNullable<DashboardBackupRestore["plan"]> => ({
    planId: "plan-1",
    planHash: "h".repeat(64),
    backupId: "synthetic",
    match: false,
    createdAt: CHECKED,
    confirmBefore: CHECKED + BACKUP_PLAN_MS,
    itemCount: 7,
    counts: { create: 3, update: 2, delete: 1, skip: 1, blocked: 1 },
    gain: { items: 1, bits: "8192", switches: 1 },
    warned: 1,
    turnsOn: [{ category: "config", family: "response", sourceId: "custom_hello" }],
    settled: 0,
    states: { planned: 7 },
    ...patch,
})
const restore = (
    state: DashboardBackupRestore["state"],
    patch: Partial<NonNullable<DashboardBackupRestore["plan"]>> | null = {},
    failure?: DashboardBackupRestore["failure"],
): DashboardBackupRestore => ({
    state,
    ...(failure ? { failure } : {}),
    plan: patch === null ? null : plan(patch),
})
const listing: DashboardBackupChangedItem[] = [
    row(1, {
        category: "structure",
        family: "structure",
        sourceId: "60",
        name: "updates",
        disposition: "blocked",
        reason: "The role <@&40> in its permissions is gone, or you or NeonFlux cannot see it. Give NeonFlux Manage roles",
    }),
    row(2, {
        category: "structure",
        family: "structure",
        sourceId: "80",
        name: "old-room",
        disposition: "delete",
        extra: true,
        warning: "Deletes the channel with its messages, files, webhooks and invites, which cannot be undone",
        changes: [{ kind: "field", path: "name", before: "old-room" }],
    }),
    row(3, {
        category: "structure",
        family: "structure",
        sourceId: "70",
        name: "news",
        disposition: "update",
        gain: true,
        changed: ["name", "permissions"],
        changes: [
            { kind: "field", path: "name", before: "announcements", after: "news" },
            { kind: "field", path: "parentId", before: "10", after: "11" },
            { kind: "field", path: "slowmodeSeconds", before: 0, after: 30 },
            {
                kind: "overwrite",
                id: "40",
                type: "role",
                before: { allow: "0", deny: "8192" },
                after: { allow: "8192", deny: "0" },
                gain: "8192",
            },
            {
                kind: "overwrite",
                id: "42",
                type: "role",
                before: { allow: "0", deny: "8192" },
                after: { allow: "0", deny: "0" },
                gain: "8192",
            },
            {
                kind: "overwrite",
                id: "41",
                type: "role",
                before: { allow: "0", deny: "0" },
                after: { allow: "0", deny: "0" },
                gain: "0",
                dropped: true,
            },
        ],
    }),
    row(4, {
        category: "config",
        family: "response",
        sourceId: "custom_hello",
        disposition: "update",
        on: true,
        changed: ["enabled"],
        warning: "Turns on message cleanup: messages older than 30 days in <#50> will be deleted",
        changes: [
            { kind: "field", path: "enabled", before: false, after: true, on: true },
            { kind: "field", path: "reply.text", before: "a".repeat(10), after: "x".repeat(150) },
        ],
    }),
    row(5, { disposition: "create", changes: [{ kind: "field", path: "xp", after: 123 }] }),
]
const items = (rows: DashboardBackupChangedItem[], nextCursor?: string): DashboardBackupItems => ({
    items: rows,
    ...(nextCursor ? { nextCursor } : {}),
})
const open = (answers: Record<string, unknown>, queued = true) => {
    const fake = client(answers, queued)
    return { ...fake, ui: render(createElement(BackupSection, { ...props("backup", fake.client), catalog })) }
}
const text = (node: Element) => node.textContent
const buttonLabel = (ui: ReturnType<typeof render>) =>
    ui.getAllByRole("button").find((b) => /^(Restore|Delete|Nothing to restore)/.test(b.textContent ?? ""))!

test("The restore page leads with what needs attention, lists each change with text marks and confirms exactly the check shown", async () => {
    mock.method(Date, "now", () => CHECKED + 60000)
    const { ui, calls } = open({
        "backup:restoreView": restore("done"),
        "backup:restoreItems": items(listing),
    })
    await act(async () => {})
    // Opening asks for a fresh read and keeps the mode of the plan
    assert.deepEqual(calls, [
        { name: "backup:restoreRequest", args: { sessionToken: "synthetic-session", serverId: "2" } },
    ])
    assert.equal(text(ui.getByText(/^Archive synthetic/)), `Archive synthetic, checked ${localTime(CHECKED)}`)
    assert.deepEqual(
        within(ui.getByRole("list", { name: "Changes by kind" }))
            .getAllByRole("listitem")
            .map(text),
        ["3 to create", "2 to update", "1 to delete", "1 blocked", "1 identical or left alone"],
    )
    // The summary comes first, in words, and names the permissions
    const attention = within(ui.getByRole("heading", { name: "Look at these first" }).parentElement!)
    assert.deepEqual(attention.getAllByRole("listitem").map(text), [
        "Blocked: 1 item will not run. Each row says why and how to fix it",
        "Deletes: 1 channel or category will be deleted with its messages. This cannot be undone",
        "More permission: 1 change grants more than the server has now: Manage messages",
        "Turns on: Response custom_hello",
        "Warnings: 1 item has a warning, such as messages it deletes or posts, as the rows say",
    ])
    const list = ui.container.querySelectorAll<HTMLElement>(".restore-row")
    assert.equal(list.length, 5)
    // A blocked row says why and how to fix it
    assert.equal(
        text(list[0]!),
        "Channel updates! BlockedThe role @Members in its permissions is gone, or you or NeonFlux cannot see it. Give NeonFlux Manage roles",
    )
    // A delete says only what goes with the channel, with no table of the values it removes
    assert.equal(
        text(list[1]!),
        "Channel old-room- DeleteDeletes the channel with its messages, files, webhooks and invites, which cannot be undone",
    )
    assert.ok(list[1]!.querySelector("table") === null)
    // A gain, the permissions before and after, and a target that is gone are all words, not colors
    const update = list[2]!
    assert.match(text(update)!, /^Channel news~ UpdateMore than now/)
    // The badge is the only place that says more than now, and each setting is named in words
    assert.equal(text(update)!.match(/More than now/g)!.length, 1)
    assert.deepEqual(
        [...update.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map(text)),
        [
            ["~ Changed", "Name", "announcements", "news"],
            ["~ Changed", "Category", "Info", "11"],
            ["~ Changed", "Slowmode seconds", "0", "30"],
        ],
    )
    assert.deepEqual([...update.querySelectorAll(".restore-permissions li")].map(text), [
        "Permissions for @MembersBefore: Allow none. Deny Manage messagesAfter: Allow Manage messages. Deny noneAdded allows or lifted denies: Manage messages",
        "Permissions for @unknown-roleBefore: Allow none. Deny Manage messagesAfter: Allow none. Deny noneAdded allows or lifted denies: Manage messages",
        "Permissions for @unknown-roleThe role is gone, so this is not restored. The archive had: Allow none. Deny none",
    ])
    // A switch that turns on is marked, a warning is shown and a long value is collapsed with its whole text kept
    const switchRow = list[3]!
    assert.match(text(switchRow)!, /Response custom_hello~ UpdateTurns on/)
    assert.match(text(switchRow)!, /Turns on message cleanup: messages older than 30 days in #news will be deleted/)
    assert.equal(switchRow.querySelectorAll("details").length, 1)
    assert.equal(switchRow.querySelector("details pre")!.textContent, "x".repeat(150))
    // The card's badge is the only place that says it turns on
    assert.equal(text(switchRow)!.match(/Turns on(?! message)/g)!.length, 1)
    assert.deepEqual(
        [...switchRow.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].slice(0, 3).map(text)),
        [
            ["~ Changed", "Enabled", "Off"],
            ["~ Changed", "Reply.text", "a".repeat(10)],
        ],
    )
    assert.equal(text(switchRow.querySelector("tbody tr td:nth-child(4)")!), "On")
    assert.equal(text(list[4]!), "XP of @105+ Create" + "ChangeSettingBeforeAfter+ AddedXPnone123")
    // The button counts what it does, and it confirms exactly this check
    assert.equal(text(buttonLabel(ui)), "Restore 5 changes and delete 1 channel or category")
    await act(async () => {
        fireEvent.click(buttonLabel(ui))
    })
    assert.deepEqual(calls.at(-1), {
        name: "backup:restoreConfirm",
        args: { sessionToken: "synthetic-session", serverId: "2", planId: "plan-1", planHash: "h".repeat(64) },
    })
    // The switch keeps its name and its help in one block beside it, so a narrow screen does not squeeze the name into a column of its own
    const match = ui.getByRole("checkbox", { name: /Match fully/ }).closest("label")!
    assert.equal(match.children.length, 2)
    assert.match(text(match.children[1]!)!, /^Match fullyAlso delete the channels and categories/)
    // Match fully asks for a new check in the other mode, and Check again keeps the mode
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: /Match fully/ }))
    })
    assert.deepEqual(calls.at(-1), {
        name: "backup:restoreRequest",
        args: { sessionToken: "synthetic-session", serverId: "2", match: true },
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Check again" }))
    })
    assert.deepEqual(calls.at(-1), {
        name: "backup:restoreRequest",
        args: { sessionToken: "synthetic-session", serverId: "2" },
    })
})

test("The restore button turns off when the check expires a day after it was made, on an open page", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHECKED + 60000 })
    try {
        const { ui } = open({ "backup:restoreView": restore("done"), "backup:restoreItems": items(listing) })
        await act(async () => {})
        assert.equal(buttonLabel(ui).hasAttribute("disabled"), false)
        await act(async () => {
            mock.timers.tick(BACKUP_PLAN_MS - 60000)
        })
        assert.equal(buttonLabel(ui).hasAttribute("disabled"), true)
        assert.ok(ui.getByText("This check expired. Check again first"))
    } finally {
        mock.timers.reset()
    }
})
test("A restore card shows no category as none, before and after", async () => {
    mock.method(Date, "now", () => CHECKED + 60000)
    const parent = (before: string | null, after: string | null) => [
        { kind: "field" as const, path: "parentId", before, after },
    ]
    const { ui } = open({
        "backup:restoreView": restore("done"),
        "backup:restoreItems": items([
            row(1, { disposition: "update", changes: parent(null, "10") }),
            row(2, { disposition: "update", changes: parent("10", null) }),
        ]),
    })
    await act(async () => {})
    assert.deepEqual(
        [...ui.container.querySelectorAll(".restore-row")].map((card) =>
            [...card.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].slice(2).map(text)),
        ),
        [[["none", "Info"]], [["Info", "none"]]],
    )
})

test("The restore button says why it is off and shows progress, the end and the reason a restore stopped", async () => {
    const states = (answer: DashboardBackupRestore) => {
        const view = open({ "backup:restoreView": answer, "backup:restoreItems": items(listing) })
        return view
    }
    // A check that expired
    mock.method(Date, "now", () => CHECKED + BACKUP_PLAN_MS)
    let view = states(restore("done"))
    await act(async () => {})
    assert.equal(buttonLabel(view.ui).hasAttribute("disabled"), true)
    assert.ok(view.ui.getByText("This check expired. Check again first"))
    cleanup()
    mock.method(Date, "now", () => CHECKED + 60000)
    // A check NeonFlux is still building says so, and nothing can start until it is ready
    view = states(restore("done", { building: true }))
    await act(async () => {})
    assert.equal(buttonLabel(view.ui).hasAttribute("disabled"), true)
    assert.ok(view.ui.getByText("NeonFlux is working on this"))
    assert.ok(view.ui.getByText(/^Building the check/))
    cleanup()
    mock.method(Date, "now", () => CHECKED + 60000)
    // Nothing that can be restored
    view = states(restore("done", { counts: { create: 0, update: 0, delete: 0, skip: 0, blocked: 2 } }))
    await act(async () => {})
    assert.equal(text(buttonLabel(view.ui)), "Nothing to restore")
    assert.equal(buttonLabel(view.ui).hasAttribute("disabled"), true)
    assert.ok(view.ui.getByText("Nothing here can be restored"))
    cleanup()
    // A running restore never says it is done, and a plan that started stays on screen without a new request
    view = states(
        restore("running", { confirmedAt: CHECKED + 1000, settled: 4, states: { created: 3, deleted: 1, planned: 3 } }),
    )
    await act(async () => {})
    assert.deepEqual(view.calls, [])
    assert.equal(
        text(view.ui.getByText(/^Restore started/)),
        `Restore started ${localTime(CHECKED + 1000)}: 4 of 7 items have an outcome`,
    )
    assert.equal(view.ui.queryByText(/not finished/) === null, true)
    assert.equal(view.ui.queryByRole("button", { name: /^Restore/ }) === null, true)
    assert.equal(view.ui.getByRole("button", { name: "Check again" }).hasAttribute("disabled"), true)
    assert.equal(view.ui.getByRole("checkbox", { name: /Match fully/ }).hasAttribute("disabled"), true)
    cleanup()
    // A restore that ended with items it could not confirm says so by state and sends the owner to check again
    view = states(
        restore("done", {
            confirmedAt: CHECKED + 1000,
            settled: 5,
            states: { created: 4, deleted: 1, uncertain: 1, failed: 1 },
        }),
    )
    await act(async () => {})
    assert.equal(
        text(view.ui.getByText(/^Created 4/)),
        "Created 4, Deleted 1, Failed 1, Not confirmed 1. 2 items not finished or not confirmed. Check again to compare with the server",
    )
    cleanup()
    // A restore that stopped says why, and its reason is not an owner's fault
    view = states(
        restore("failed", { confirmedAt: CHECKED + 1000, settled: 2, states: { created: 2, planned: 5 } }, "paused"),
    )
    await act(async () => {})
    assert.match(text(view.ui.getByRole("alert"))!, /DEFCON 1 pauses restores, so nothing more was restored/)
    cleanup()
    // A check the bot never answered
    view = states(restore("failed", {}, "unanswered"))
    await act(async () => {})
    assert.match(text(view.ui.getByRole("alert"))!, /NeonFlux did not answer/)
    assert.equal(buttonLabel(view.ui).hasAttribute("disabled"), true)
    assert.ok(view.ui.getByText("The last check failed. Check again first"))
    cleanup()
    // A check in progress
    view = states(restore("queued"))
    await act(async () => {})
    assert.ok(view.ui.getByText("Asking NeonFlux to read the archive and the server again…"))
    cleanup()
    assert.ok(open({ "backup:restoreView": null }).ui.getByText("No check yet"))
})

test("The restore page pages the changes, shows identical items only when asked and starts over for a new check", async () => {
    mock.method(Date, "now", () => CHECKED + 60000)
    const asked: unknown[] = []
    const { ui } = open({
        "backup:restoreView": restore("done"),
        "backup:restoreItems": (args: { cursor: string | null; identical: boolean }) => {
            asked.push(args)
            return args.cursor === null
                ? items([listing[4]!], "next-page")
                : items([
                      row(6, {
                          sourceId: "200",
                          disposition: "skip",
                          reason: "A temporary voice room ends with its call, so a restore leaves it alone",
                      }),
                  ])
        },
    })
    await act(async () => {})
    const names = () => [...ui.container.querySelectorAll(".restore-row strong")].map(text)
    assert.deepEqual(names(), ["XP of @105"])
    assert.equal(ui.getByRole("button", { name: "Previous" }).hasAttribute("disabled"), true)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Next" }))
    })
    assert.deepEqual(names(), ["XP of @200"])
    assert.match(text(ui.container.querySelector(".restore-row")!)!, /= Left alone/)
    assert.equal(ui.getByRole("button", { name: "Next" }).hasAttribute("disabled"), true)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Previous" }))
    })
    assert.deepEqual(names(), ["XP of @105"])
    // Asking for the identical items starts the list again with them
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: "Show 1 identical or left alone" }))
    })
    assert.deepEqual(asked.at(-1), {
        sessionToken: "synthetic-session",
        serverId: "2",
        planId: "plan-1",
        identical: true,
        cursor: null,
    })
    assert.deepEqual(asked[0], {
        sessionToken: "synthetic-session",
        serverId: "2",
        planId: "plan-1",
        identical: false,
        cursor: null,
    })
})

test("Each restore row names what it restores, with a channel by name and the order item as the channel order", async () => {
    mock.method(Date, "now", () => CHECKED + 60000)
    const config = (itemNo: number, family: string, sourceId: string) =>
        row(itemNo, { category: "config", family: family as DashboardBackupChangedItem["family"], sourceId })
    const { ui } = open({
        "backup:restoreView": restore("done"),
        "backup:restoreItems": items([
            row(1, {
                category: "structure",
                family: "structure",
                sourceId: "order",
                name: "Channel order",
                order: true,
            }),
            config(2, "voiceGenerator", "50"),
            config(3, "sticky", "50"),
            config(4, "access", "showcase"),
            config(5, "helpdeskAnswer", "faq"),
            config(6, "general", "general"),
            config(7, "event", "launch"),
            config(8, "youtube", "UCsyntheticBackupChannel"),
        ]),
    })
    await act(async () => {})
    assert.deepEqual([...ui.container.querySelectorAll(".restore-row strong")].map(text), [
        "Channel order",
        "Voice generator #news",
        "Sticky message in #news",
        "Showcase access",
        "Saved answer faq",
        "Prefix, reply style and nickname",
        "Event launch",
        "YouTube alerts for UCsyntheticBackupChannel",
    ])
})

test("A check the backend does not take says to wait, and opening the page asks quietly", async () => {
    mock.method(Date, "now", () => CHECKED + 60000)
    const { ui, calls } = open({ "backup:restoreView": restore("done"), "backup:restoreItems": items(listing) }, false)
    await act(async () => {})
    assert.equal(calls.length, 1)
    assert.equal(ui.queryByText(/A check was made a moment ago/) === null, true)
    await act(async () => {
        fireEvent.click(ui.getByRole("checkbox", { name: /Match fully/ }))
    })
    assert.equal(
        text(ui.getByText(/A check was made a moment ago/)),
        "A check was made a moment ago. Wait a few seconds, then try again",
    )
    assert.deepEqual(calls.at(-1)?.args, { sessionToken: "synthetic-session", serverId: "2", match: true })
})

test("The backup page prints exact DM commands, and names the server only when the bot serves several", async () => {
    for (const multi of [false, true]) {
        const select = multi ? " --server 2" : ""
        const fake = client({
            "backup:restoreView": restore("failed", null, "error"),
            "backup:restoreItems": items([]),
        })
        const ui = render(createElement(BackupSection, { ...props("backup", fake.client), catalog, multi }))
        await act(async () => {})
        assert.deepEqual(
            [...ui.container.querySelectorAll("code")].map((code) => code.textContent),
            [`!backup${select} export config xp structure`, `!backup${select} preview`],
        )
        assert.match(
            ui.getByRole("alert").textContent ?? "",
            new RegExp(`send !backup${select} status in the DM and continue there with !backup${select} confirm$`),
        )
        assert.equal(ui.container.textContent?.includes("--server"), multi)
        cleanup()
    }
})
