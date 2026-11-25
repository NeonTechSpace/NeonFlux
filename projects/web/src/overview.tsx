import type { ConvexReactClient } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { permissionKeyTitles } from "@neonflux/contracts/permission-names"
import type { StaffClass } from "@neonflux/contracts/moderation"
import type { DashboardOverviewState, SetupProblem } from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "./dashboard-api"
import type { SectionProps } from "./dashboard-sections"
import { Icon, navigation, sectionIcons, sectionLink, sectionNames } from "./dashboard-sections"
import { useDraftSections } from "./drafts"
import { useLiveQuery } from "./live-query"

const stateLabels: Record<DashboardOverviewState, string> = { on: "On", setup: "Needs setup", off: "Off" }

const list = (items: string[]) =>
    items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
const staffCommands: Record<StaffClass, string> = {
    moderation: "!mod",
    security: "!security",
    cases: "!mod",
    automod: "!automod",
    appeals: "!appeal",
}
/** One problem from the bot as a sentence that names its fix, worded like the bot's !health reply */
export function problemText(problem: SetupProblem) {
    if (problem.kind === "gateway")
        return `Gateway: ${problem.state}. NeonFlux reconnects on its own. If this lasts, the bot operator should check the host's network and the bot's logs`
    const permissions =
        "permissions" in problem ? list(problem.permissions.map((name) => permissionKeyTitles[name] ?? name)) : ""
    const them = "permissions" in problem && problem.permissions.length > 1 ? "them" : "it"
    if (problem.kind === "dangerous-role")
        return problem.members === undefined
            ? `Safety: The everyone role gives ${permissions} to every member. Remove ${them} from the everyone role`
            : `Safety: @${problem.role.name} gives ${permissions} to ${problem.members} members. Remove ${them} from the role, or keep ${them} on a role only trusted staff hold`
    if (problem.kind === "staff-permissions")
        return `Safety: The ${problem.staffClass} staff role @${problem.role.name} lacks ${permissions}, so its members cannot run the ${staffCommands[problem.staffClass]} commands that need ${them}. Grant ${them} to the role, or choose other ${problem.staffClass} staff roles in ${sectionNames.moderation}`
    if (problem.kind === "antinuke-rank")
        return `Safety: Anti-nuke cannot stop members holding ${list(problem.roles.map((role) => `@${role.name}`))}, which rank at or above the NeonFlux role. Move the NeonFlux role above them`
    if (problem.kind === "rights-limits")
        return `Safety: Bot-only staff rights are on with limits above the default for ${list(problem.rights)}. A hacked staff account can do that much through NeonFlux before it is stopped. Lower them in ${sectionNames.rights}`
    if (problem.kind === "verification-bypass")
        return (
            `Safety: Fluxer skips its verification level for members who have any role, so ${list(problem.features.map((id) => sectionNames[id]))} let${problem.features.length > 1 ? "" : "s"} members past it. ` +
            "If you rely on the verification level, turn these off, or use rules verification with advanced verification on, so members solve a challenge before NeonFlux gives a role and autorole waits for it"
        )
    const feature = problem.feature === "general" ? "Replies" : sectionNames[problem.feature]
    return problem.kind === "permissions"
        ? `${feature}: Grant ${permissions} to the NeonFlux role`
        : `${feature}: Move the NeonFlux role above ${list(problem.roles.map((role) => `@${role.name}`))}`
}

const AUTO_CHECK_COOLDOWN_MS = 60 * 1000

/** The bot's own permission check. The bot reads Fluxer with its token, so opening this asks it for a fresh check without using your sign-in.
 *  Skips duplicate automatic requests when the bot already answered within the last minute, while Check again always runs */
function PermissionCheck({
    client,
    sessionToken,
    serverId,
}: {
    client: ConvexReactClient
    sessionToken: string
    serverId: string
}) {
    const { data: check, fresh: checkFresh } = useLiveQuery(client, dashboardApi.setupCheck, {
        sessionToken,
        serverId,
    })
    const [failed, setFailed] = useState(false)
    const requestedForServerRef = useRef<string | undefined>(undefined)
    const request = useCallback(() => {
        setFailed(false)
        client.mutation(dashboardApi.requestSetupCheck, { sessionToken, serverId }).catch(() => setFailed(true))
    }, [client, sessionToken, serverId])
    useEffect(() => {
        if (!checkFresh) return
        const serverKey = `${sessionToken}:${serverId}`
        if (requestedForServerRef.current === serverKey) return
        requestedForServerRef.current = serverKey
        if (check?.state === "queued") return
        if (check?.checkedAt !== undefined && Date.now() - check.checkedAt < AUTO_CHECK_COOLDOWN_MS) return
        request()
    }, [checkFresh, check?.state, check?.checkedAt, request, sessionToken, serverId])
    const checking = check?.state === "queued" || check === undefined
    return (
        <section className="panel" aria-labelledby="permission-check-title">
            <h2 id="permission-check-title">Permission check</h2>
            {failed && (
                <p className="notice error" role="alert">
                    The check could not be requested. Refresh your sign-in or try again
                </p>
            )}
            {checking ? (
                <p role="status">Asking NeonFlux to check its permissions…</p>
            ) : check === null ? (
                <p role="status">No check has run yet</p>
            ) : check.state === "failed" ? (
                <p className="notice error" role="alert">
                    NeonFlux did not answer. Check that the bot is online, then check again
                </p>
            ) : check.problems.length ? (
                <ul>
                    {check.problems.map((problem, index) => (
                        <li key={index}>{problemText(problem)}</li>
                    ))}
                </ul>
            ) : (
                <p role="status">
                    No problems found. Every enabled feature has the permissions and role position it needs
                </p>
            )}
            <div className="actions">
                <button type="button" className="secondary" disabled={checking} onClick={request}>
                    Check again
                </button>
            </div>
        </section>
    )
}

type OverviewFilter = "all" | "on" | "setup" | "off" | "drafts"

/** The landing page of a server: Setup progress, every section by group with its state, and sections holding unsaved drafts */
export function OverviewSection({ client, sessionToken, serverId, userId, sectionHref, openSection }: SectionProps) {
    const { data, error } = useLiveQuery(client, dashboardApi.overview, { sessionToken, serverId })
    const drafts = useDraftSections(userId, serverId)
    const [filter, setFilter] = useState<OverviewFilter>("all")
    const states = new Map(data?.sections.map((row) => [row.id as string, row.state]))
    const total = data?.sections.length ?? 0,
        on = data?.sections.filter((row) => row.state === "on").length ?? 0,
        setup = data?.sections.filter((row) => row.state === "setup").length ?? 0,
        off = data?.sections.filter((row) => row.state === "off").length ?? 0
    const activeFilter = filter === "drafts" && drafts.size === 0 ? "all" : filter
    const matchesFilter = (id: string) => {
        if (activeFilter === "all") return true
        if (activeFilter === "drafts") return drafts.has(id)
        return states.get(id) === activeFilter
    }
    const visibleGroups = navigation
        .map(([group, items]) => [group, items.filter(([id]) => matchesFilter(id))] as const)
        .filter(([, items]) => items.length > 0)
    return (
        <>
            {error && (
                <p className="notice error" role="alert">
                    Setup progress is unavailable. Refresh your sign-in or check your server permission
                </p>
            )}
            <section className="panel" aria-labelledby="overview-title">
                <h2 id="overview-title">Overview</h2>
                {!data ? (
                    <p role="status">Loading setup progress…</p>
                ) : (
                    <>
                        <p className="muted">
                            {on} of {total} features are on
                            {setup
                                ? `. ${setup} ${setup === 1 ? "is on but needs" : "are on but need"} setup, such as a channel or a first entry`
                                : ""}
                        </p>
                        <progress className="setup-progress" max={total} value={on} aria-label="Features on">
                            {on} of {total}
                        </progress>
                        <div className="overview-filters" role="group" aria-label="Filter features by state">
                            <button
                                type="button"
                                className={`secondary filter-chip${activeFilter === "all" ? " is-active" : ""}`}
                                aria-pressed={activeFilter === "all"}
                                onClick={() => setFilter("all")}
                            >
                                All ({total})
                            </button>
                            <button
                                type="button"
                                className={`secondary filter-chip${activeFilter === "on" ? " is-active" : ""}`}
                                aria-pressed={activeFilter === "on"}
                                onClick={() => setFilter("on")}
                            >
                                Active ({on})
                            </button>
                            <button
                                type="button"
                                className={`secondary filter-chip${activeFilter === "setup" ? " is-active" : ""}`}
                                aria-pressed={activeFilter === "setup"}
                                onClick={() => setFilter("setup")}
                            >
                                Needs setup ({setup})
                            </button>
                            <button
                                type="button"
                                className={`secondary filter-chip${activeFilter === "off" ? " is-active" : ""}`}
                                aria-pressed={activeFilter === "off"}
                                onClick={() => setFilter("off")}
                            >
                                Off ({off})
                            </button>
                            {drafts.size > 0 && (
                                <button
                                    type="button"
                                    className={`secondary filter-chip${activeFilter === "drafts" ? " is-active" : ""}`}
                                    aria-pressed={activeFilter === "drafts"}
                                    onClick={() => setFilter("drafts")}
                                >
                                    Drafts ({drafts.size})
                                </button>
                            )}
                        </div>
                    </>
                )}
                {drafts.size > 0 && (
                    <p className="notice draft-note" role="status">
                        <strong>Unsaved drafts</strong> in{" "}
                        {[...drafts].map((id) => sectionNames[id as keyof typeof sectionNames] ?? id).join(", ")}. They
                        stay in this tab until you save or discard them
                    </p>
                )}
            </section>
            <PermissionCheck client={client} sessionToken={sessionToken} serverId={serverId} />
            {visibleGroups.length === 0 ? (
                <section className="panel">
                    <p className="muted">No features match this filter</p>
                </section>
            ) : (
                visibleGroups.map(([group, items]) => (
                    <section className="panel" aria-labelledby={`overview-${group}`} key={group}>
                        <h2 id={`overview-${group}`}>{group}</h2>
                        <ul className="overview-grid">
                            {items.map(([id, name]) => {
                                const state = states.get(id)
                                return (
                                    <li key={id}>
                                        <a className="overview-card" {...sectionLink(id, sectionHref, openSection)}>
                                            <Icon path={sectionIcons[id]} />
                                            <span className="overview-name">{name}</span>
                                            {state && (
                                                <span className={`state-pill ${state}`}>{stateLabels[state]}</span>
                                            )}
                                            {drafts.has(id) && <span className="draft-tag">Unsaved draft</span>}
                                        </a>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                ))
            )}
        </>
    )
}
