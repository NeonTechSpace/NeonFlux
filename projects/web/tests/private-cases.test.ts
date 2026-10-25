import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { getFunctionName } from "convex/server"
import type { ConvexReactClient } from "convex/react"
import type { Appeal } from "@neonflux/contracts/appeal"
import type { ModerationCase } from "@neonflux/contracts/moderation"
import type {
    DashboardPrivateAccess,
    DashboardPrivateResult,
    DashboardPrivateView,
} from "@neonflux/backend/dashboard-contracts"
import type { WebSession } from "../src/dashboard-api.ts"
import { ServerDashboard } from "../src/dashboard.tsx"
import { PrivateCasesSection } from "../src/private-cases.tsx"
import { auditFeatures } from "../src/audit-log.tsx"

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

const record = (caseNo: number, extra: Partial<ModerationCase> = {}): ModerationCase => ({
    caseNo,
    actionId: `case${caseNo}`,
    sourceId: String(1000 + caseNo),
    action: "warn",
    origin: "manual",
    actorId: "99",
    targetId: "21",
    reason: `Synthetic reason ${caseNo}`,
    createdAt: 1,
    expiresAt: 2,
    outcome: "succeeded",
    logOutcome: "none",
    notificationOutcome: "none",
    erased: false,
    voided: false,
    correctionCount: 0,
    ...extra,
})
// A live client whose access check the test publishes. Each view the section asks for is recorded and answered by the test
function liveClient(answer: (view: DashboardPrivateView, access: DashboardPrivateAccess) => DashboardPrivateResult) {
    let access: DashboardPrivateAccess = { serverId: "2", roleConfigured: true, check: null }
    const listeners = new Set<() => void>(),
        watched: string[] = [],
        views: DashboardPrivateView[] = []
    const client = {
        connectionState: () => ({ isWebSocketConnected: true }),
        subscribeToConnectionState: () => () => {},
        watchQuery: (ref: unknown, args: { serverId: string }) => {
            const name = getFunctionName(ref as never)
            watched.push(`${name}:${args.serverId}`)
            // The role picker's member view, for servers that offer both member features
            const result = () =>
                name === "rolePicker:member"
                    ? { serverId: args.serverId, menus: [], snapshot: null, requests: [] }
                    : access
            return {
                localQueryResult: result,
                onUpdate: (listener: () => void) => {
                    listeners.add(listener)
                    return () => listeners.delete(listener)
                },
            }
        },
        action: async () => {
            throw new Error("Private views never read with the viewer's sign-in")
        },
        mutation: async (ref: unknown, args: { view: DashboardPrivateView }) => {
            if (getFunctionName(ref as never) !== "privateData:view") return { jobId: "synthetic-job" }
            views.push(args.view)
            return answer(args.view, access)
        },
    } as unknown as ConvexReactClient
    return {
        client,
        watched,
        views,
        publish: async (next: DashboardPrivateAccess["check"]) => {
            access = { ...access, check: next }
            await act(async () => {
                listeners.forEach((listener) => listener())
            })
        },
    }
}
const passed = { state: "passed" as const, requestedAt: 1, checkedAt: 2, validUntil: 120002 }

test("Private cases wait for the live check, then list cases newest first, open a case and page without showing erased text", async () => {
    const live = liveClient((view, access) => {
        if (access.check?.state !== "passed") return { status: "checking" }
        if (view.type === "case")
            return {
                status: "ok",
                data: {
                    type: "case",
                    case: record(view.caseNo, { correctionCount: 3 }),
                    // The first page continues after the creation time of its last correction
                    ...(view.correctionsAfter === undefined
                        ? {
                              corrections: [
                                  {
                                      actorId: "99",
                                      createdAt: 2,
                                      previousReason: "",
                                      reason: "First reason",
                                      type: "reason" as const,
                                  },
                                  {
                                      actorId: "99",
                                      createdAt: 3,
                                      previousReason: "First reason",
                                      reason: "Corrected reason",
                                      type: "reason" as const,
                                  },
                              ],
                              nextCorrectionsAfter: 3.5,
                          }
                        : {
                              corrections: [
                                  {
                                      actorId: "98",
                                      createdAt: 5,
                                      previousReason: "Corrected reason",
                                      reason: "Last reason",
                                      type: "reason" as const,
                                  },
                              ],
                          }),
                    appeals: [
                        {
                            appealNo: 7,
                            caseNo: view.caseNo,
                            userId: "21",
                            text: "Synthetic appeal",
                            createdAt: 4,
                            status: "open",
                            erased: false,
                        },
                    ],
                },
            }
        if (view.type === "cases" && view.beforeCaseNo)
            return { status: "ok", data: { type: "cases", cases: [record(1)] } }
        return {
            status: "ok",
            data: {
                type: "cases",
                cases: [record(3), record(2, { erased: true, reason: "[Erased by owner]" })],
                nextBeforeCaseNo: 2,
            },
        }
    })
    const ui = render(
        createElement(PrivateCasesSection, { client: live.client, sessionToken: "synthetic-session", serverId: "2" }),
    )
    await act(async () => {})
    assert.deepEqual(live.views, [{ type: "cases" }])
    assert.equal(ui.getByRole("status").textContent, "Checking your access with NeonFlux…")
    // The bot's answer reloads the same view once
    await live.publish({ state: "queued", requestedAt: 1 })
    await live.publish(passed)
    assert.equal(live.views.length, 2)
    const rows = () =>
        within(ui.getByRole("table"))
            .getAllByRole("row")
            .slice(1)
            .map((row) => row.textContent)
    assert.match(rows()[0]!, /^Case 3.*Synthetic reason 3$/)
    assert.match(rows()[1]!, /Erased by the server owner$/)
    assert.ok(ui.queryByText(/\[Erased by owner\]/) === null)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Case 3" }))
    })
    assert.ok(ui.getByRole("heading", { name: "Case 3" }))
    assert.ok(ui.getByText(/Reason corrected by 99.*First reason → Corrected reason/))
    assert.ok(ui.getByText(/Reason corrected by 99.*No reason given → First reason/))
    assert.ok(ui.getByText("Synthetic appeal"))
    // Corrections past the first page open from their own button, and Back returns to the first page
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Later corrections" }))
    })
    assert.ok(ui.getByText(/Reason corrected by 98.*Corrected reason → Last reason/))
    assert.ok(ui.queryByText(/First reason → Corrected reason/) === null)
    assert.ok(ui.queryByRole("button", { name: "Later corrections" }) === null)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Back" }))
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Back" }))
    })
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Older cases" }))
    })
    assert.deepEqual(
        rows().map((row) => row.slice(0, 6)),
        ["Case 1"],
    )
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "History of member 21" }))
    })
    assert.deepEqual(live.views.slice(2), [
        { type: "case", caseNo: 3 },
        { type: "case", caseNo: 3, correctionsAfter: 3.5 },
        { type: "case", caseNo: 3 },
        { type: "cases" },
        { type: "cases", beforeCaseNo: 2 },
        { type: "history", userId: "21" },
    ])
})

const appealOf = (appealNo: number, caseNo: number, status: Appeal["status"] = "open"): Appeal => ({
    appealNo,
    caseNo,
    userId: "21",
    text: `Synthetic appeal ${appealNo}`,
    createdAt: 4,
    status,
    erased: false,
})

test("Waiting appeals open from their own button and page forward with More", async () => {
    const live = liveClient((view) =>
        view.type === "open-appeals"
            ? {
                  status: "ok",
                  data: view.afterAppealNo
                      ? { type: "open-appeals", appeals: [appealOf(9, 2)] }
                      : { type: "open-appeals", appeals: [appealOf(4, 1)], nextAfterAppealNo: 4 },
              }
            : { status: "ok", data: { type: "cases", cases: [] } },
    )
    await live.publish(passed)
    const ui = render(
        createElement(PrivateCasesSection, { client: live.client, sessionToken: "synthetic-session", serverId: "2" }),
    )
    await act(async () => {})
    assert.ok(ui.queryByRole("button", { name: "More" }) === null)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Waiting appeals" }))
    })
    assert.ok(ui.getByText("Synthetic appeal 4"))
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "More" }))
    })
    assert.ok(ui.getByText("Synthetic appeal 9"))
    assert.ok(ui.queryByRole("button", { name: "More" }) === null)
    assert.deepEqual(live.views, [
        { type: "cases" },
        { type: "open-appeals" },
        { type: "open-appeals", afterAppealNo: 4 },
    ])
})

test("A case taken without a reason reads No reason given in the list and in its details", async () => {
    const live = liveClient((view) => ({
        status: "ok",
        data:
            view.type === "case"
                ? { type: "case", case: record(7, { reason: "" }), corrections: [], appeals: [] }
                : { type: "cases", cases: [record(7, { reason: "" })] },
    }))
    await live.publish(passed)
    const ui = render(
        createElement(PrivateCasesSection, { client: live.client, sessionToken: "synthetic-session", serverId: "2" }),
    )
    await act(async () => {})
    assert.equal(ui.getAllByText("No reason given").length, 1)
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Case 7" }))
    })
    assert.ok(ui.getByText("Reason: No reason given"))
})

test("An accepted appeal shows the command that reverses its case, and nothing when the case is voided, the appeal is not accepted or nothing can be reversed", async () => {
    const reverse = async (extra: Partial<ModerationCase>, status: Appeal["status"] = "accepted") => {
        const live = liveClient((view) => ({
            status: "ok",
            data:
                view.type === "case"
                    ? { type: "case", case: record(7, extra), corrections: [], appeals: [appealOf(3, 7, status)] }
                    : { type: "cases", cases: [record(7, extra)] },
        }))
        await live.publish(passed)
        const ui = render(
            createElement(PrivateCasesSection, {
                client: live.client,
                sessionToken: "synthetic-session",
                serverId: "2",
            }),
        )
        await act(async () => {})
        await act(async () => {
            fireEvent.click(ui.getByRole("button", { name: "Case 7" }))
        })
        const block = ui.queryByRole("heading", { name: "Next step" })
        const text = block ? ui.container.querySelector("section")!.textContent! : ""
        const commands = [...ui.container.querySelectorAll("code")].map((code) => code.textContent)
        cleanup()
        return { block: block !== null, text, commands }
    }
    assert.deepEqual((await reverse({ action: "ban" })).commands, ["!mod unban 21 case 7"])
    assert.deepEqual((await reverse({ action: "timeout" })).commands, ["!mod untimeout 21 case 7"])
    assert.deepEqual((await reverse({ action: "quarantine" })).commands, ["!security release 21 case 7"])
    const warned = await reverse({ action: "warn" })
    assert.deepEqual(warned.commands, ["!mod void 7"])
    assert.match(warned.text, /Check the member's current restrictions first/)
    assert.match(warned.text, /the prefix may differ if the server changed it/)
    const kicked = await reverse({ action: "kick" })
    assert.deepEqual([kicked.block, kicked.commands], [true, []])
    assert.match(kicked.text, /A kick has nothing to reverse/)
    assert.equal((await reverse({ action: "delete" })).block, false)
    assert.equal((await reverse({ action: "ban", voided: true })).block, false)
    assert.equal((await reverse({ action: "ban" }, "rejected")).block, false)
    assert.equal((await reverse({ action: "ban" }, "open")).block, false)
})

test("An idle tab does not ask for its view again when the answered check row is deleted", async () => {
    const live = liveClient(() => ({ status: "ok", data: { type: "cases", cases: [record(3)] } }))
    const ui = render(
        createElement(PrivateCasesSection, { client: live.client, sessionToken: "synthetic-session", serverId: "2" }),
    )
    await act(async () => {})
    await live.publish({ state: "queued", requestedAt: 1 })
    await live.publish(passed)
    assert.equal(live.views.length, 2)
    await live.publish(null)
    assert.equal(live.views.length, 2)
    assert.ok(ui.getByRole("table"))
})

test("Opening the section while a passed check still stands asks for its view once", async () => {
    const live = liveClient(() => ({ status: "ok", data: { type: "cases", cases: [record(3)] } }))
    await live.publish(passed)
    render(
        createElement(PrivateCasesSection, { client: live.client, sessionToken: "synthetic-session", serverId: "2" }),
    )
    await act(async () => {})
    assert.equal(live.views.length, 1)
})

test("A refused check says what grants access, and Check again asks once more", async () => {
    const live = liveClient(() => ({ status: "refused" }))
    const ui = render(
        createElement(PrivateCasesSection, { client: live.client, sessionToken: "synthetic-session", serverId: "2" }),
    )
    await act(async () => {})
    assert.match(
        ui.getByRole("alert").textContent!,
        /^You need this server's private data role to view private cases\. Administrator permission alone is not enough/,
    )
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "Check again" }))
    })
    assert.deepEqual(live.views, [{ type: "cases" }, { type: "cases" }])
    assert.equal(auditFeatures["private-data"], "Private cases")
})

test("A member without Manage community reaches private cases only through the member view, never a manager section", async () => {
    const live = liveClient(() => ({ status: "checking" }))
    const session: WebSession = {
        sessionToken: "synthetic-session",
        convexUrl: "https://synthetic.invalid",
        expiresAt: 1,
        user: { id: "1", name: "Synthetic member" },
        mode: "multi",
        servers: [],
        memberServers: [{ id: "5", name: "Member server", icon: null, features: ["private"] }],
    }
    const ui = render(createElement(ServerDashboard, { session, client: live.client, accessAvailable: true }))
    await act(async () => {
        fireEvent.click(ui.getByRole("button", { name: "View private cases in Member server" }))
    })
    assert.ok(ui.getByRole("heading", { name: "Private cases" }))
    assert.ok(ui.queryByRole("navigation", { name: "Configuration sections" }) === null)
    assert.ok(ui.queryByRole("navigation", { name: "Member features" }) === null)
    assert.deepEqual(live.watched, ["privateData:access:5"])
    cleanup()
    // A server with both member features offers both, starting on the role picker
    const both = liveClient(() => ({ status: "checking" }))
    const shared = render(
        createElement(ServerDashboard, {
            session: {
                ...session,
                mode: "single",
                memberServers: [{ id: "5", name: "Member server", icon: null, features: ["rolepicker", "private"] }],
            },
            client: both.client,
            accessAvailable: true,
        }),
    )
    const tabs = within(shared.getByRole("navigation", { name: "Member features" }))
    assert.equal(tabs.getByRole("link", { name: "Choose your roles" }).getAttribute("aria-current"), "page")
    await act(async () => {
        fireEvent.click(tabs.getByRole("link", { name: "Private cases" }))
    })
    assert.ok(shared.getByRole("heading", { name: "Private cases" }))
    assert.ok(shared.queryByRole("navigation", { name: "Configuration sections" }) === null)
})
