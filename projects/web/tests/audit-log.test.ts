import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import type {
    DashboardAuditDetail,
    DashboardAuditEntry,
    DashboardAuditPage,
} from "@neonflux/backend/dashboard-contracts"
import { AuditLogSection } from "../src/audit-log.tsx"
import type { SectionProps } from "../src/dashboard-sections.tsx"
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

const entry = (id: string, changes: Partial<DashboardAuditEntry> = {}): DashboardAuditEntry => ({
    id,
    kind: "setting",
    source: "command",
    actorId: "99",
    feature: "leveling",
    setting: "settings",
    summary: "xpPerMessage: 15 → 25",
    createdAt: Date.UTC(2026, 0, 2, 3, 4),
    ...changes,
})
const shown = localTime(Date.UTC(2026, 0, 2, 3, 4))
function setup(failing = false, detail?: (entryId: string) => DashboardAuditDetail | null) {
    const asked: Array<{ cursor: string | null; feature?: string }> = [],
        details: string[] = []
    const page = (args: { cursor: string | null; feature?: string }): DashboardAuditPage =>
        args.cursor === "older"
            ? {
                  serverId: "2",
                  entries: [entry("3", { setting: "settings", summary: "enabled: off → on" })],
                  nextCursor: null,
              }
            : {
                  serverId: "2",
                  entries:
                      args.feature === "member-data"
                          ? [
                                entry("4", {
                                    kind: "member-data-deleted",
                                    feature: "member-data",
                                    setting: "delete own data",
                                    summary: "Deleted 2 records: AFK status 1, Leveling XP 1",
                                    actorId: "70",
                                }),
                            ]
                          : [
                                entry("1", {
                                    source: "website",
                                    actorName: "Manager",
                                    actorId: "20",
                                    feature: "prefix",
                                    setting: "prefix",
                                    summary: "prefix: ! → ?",
                                    ...(detail ? { detail: true as const } : {}),
                                }),
                                entry("2", {
                                    kind: "private-data-viewed",
                                    feature: "moderation",
                                    setting: "case 4",
                                    summary: "Viewed a private case",
                                }),
                            ],
                  nextCursor: "older",
              }
    const client = {
        watchQuery: (ref: unknown, args: { cursor: string | null; feature?: string; entryId?: string }) => {
            if (getFunctionName(ref as never) === "auditLog:entry") {
                details.push(args.entryId!)
                return { localQueryResult: () => detail!(args.entryId!), onUpdate: () => () => {} }
            }
            assert.equal(getFunctionName(ref as never), "auditLog:page")
            asked.push({ cursor: args.cursor, ...(args.feature ? { feature: args.feature } : {}) })
            return {
                localQueryResult: () => {
                    if (failing) throw new Error("Synthetic expired sign-in")
                    return page(args)
                },
                onUpdate: () => () => {},
            }
        },
    } as unknown as ConvexReactClient
    const props = {
        section: "audit",
        client,
        sessionToken: "synthetic-session",
        serverId: "2",
        userId: "20",
        connected: true,
        catalog: {
            serverId: "2",
            channels: [{ id: "50", name: "general", type: 0 }],
            roles: [{ id: "40", name: "Member", position: 1, hoist: false, hoistPosition: null }],
        },
        catalogLoading: false,
        catalogError: false,
        refreshCatalog: () => {},
        sectionHref: () => "/",
        openSection: () => {},
    } satisfies SectionProps
    return { ui: render(createElement(AuditLogSection, props)), asked, details }
}
const rows = (ui: ReturnType<typeof render>) =>
    within(ui.getAllByRole("table")[0]!)
        .getAllByRole("row")
        .slice(1)
        .map((row) =>
            within(row)
                .getAllByRole("cell")
                .map((cell) => cell.textContent),
        )

test("The audit log shows who changed what and from where, newest first", () => {
    const { ui } = setup()
    assert.deepEqual(rows(ui), [
        [shown, "Manager (20)", "Website", "Prefix", "prefix", "prefix: ! → ?"],
        [shown, "99", "Command", "Moderation and safety", "Private data viewed", "case 4. Viewed a private case"],
    ])
})

test("Older and Newer page with the cursor, and a feature filter starts again from the newest entries", async () => {
    const { ui, asked } = setup()
    const newer = ui.getByRole("button", { name: "Newer" }) as HTMLButtonElement
    assert.equal(newer.disabled, true)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Older" }))
    })
    assert.deepEqual(rows(ui), [[shown, "99", "Command", "Leveling", "settings", "enabled: off → on"]])
    assert.equal((ui.getByRole("button", { name: "Older" }) as HTMLButtonElement).disabled, true)
    await act(async () => {
        fireEvent.change(ui.getByRole("combobox", { name: "Feature" }), { target: { value: "member-data" } })
    })
    assert.deepEqual(rows(ui), [
        [
            shown,
            "70",
            "Command",
            "Member data",
            "Member deleted their own data",
            "Deleted 2 records: AFK status 1, Leveling XP 1",
        ],
    ])
    assert.deepEqual(asked, [{ cursor: null }, { cursor: "older" }, { cursor: null, feature: "member-data" }])
})

test("A failed audit log query shows its error and no loading message", () => {
    const { ui } = setup(true)
    assert.ok(ui.getByRole("alert"))
    assert.ok(ui.queryByRole("status") === null)
})

test("Details opens the before and after values of one entry, with channel and role names and notes on what was not stored", async () => {
    const long = "Synthetic authored reply ".repeat(10)
    const { ui, details } = setup(false, (entryId) =>
        entryId === "1"
            ? {
                  changes: [
                      { path: "logChannelId", before: "50", after: "51" },
                      { path: "roleIds[0]", after: "40" },
                      { path: "definitions[rules].reply.text", before: "Hi", after: long, cut: 9000 },
                      {
                          path: "permissions for <@&40>",
                          before: "Allow View channel. Deny none",
                          after: "Allow none. Deny View channel",
                      },
                  ],
                  more: 3,
              }
            : null,
    )
    // Only entries with stored values offer Details, and nothing is read before it opens
    assert.equal(ui.getAllByRole("button", { name: "Details" }).length, 1)
    assert.deepEqual(details, [])
    const toggle = ui.getByRole("button", { name: "Details" })
    await act(async () => {
        fireEvent.click(toggle)
    })
    assert.equal(toggle.getAttribute("aria-expanded"), "true")
    assert.deepEqual(details, ["1"])
    const table = ui.getAllByRole("table")[1]!
    assert.deepEqual(
        within(table)
            .getAllByRole("row")
            .slice(1)
            .map((row) =>
                within(row)
                    .getAllByRole("cell")
                    .slice(0, 3)
                    .map((cell) => cell.textContent),
            ),
        [
            ["~ Changed", "Log channel ID", "#general"],
            ["+ Added", "Role IDs[0]", "none"],
            ["~ Changed", "Definitions[rules].reply.textShows the first 8,000 of 9,000 characters", "Hi"],
            // A restored channel's permissions name the role they are for, as the restore check does
            ["~ Changed", "Permissions for @Member", "Allow View channel. Deny none"],
        ],
    )
    // A role ID is named from the catalog, an unknown channel keeps its ID, and a long value starts collapsed
    assert.ok(within(table).getByText("@Member"))
    assert.ok(within(table).getByText("51"))
    assert.equal(table.querySelector("details")?.open, false)
    assert.equal(table.querySelector("details pre")?.textContent, long)
    assert.ok(ui.getByText("3 more changes were too large to store"))
    await act(async () => {
        fireEvent.click(toggle)
    })
    assert.equal(ui.getAllByRole("table").length, 1)
})
