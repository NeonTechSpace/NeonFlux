import type { DashboardAuditEntry, DashboardAuditFeature } from "@neonflux/backend/dashboard-contracts"
import type { ConvexReactClient } from "convex/react"
import { Fragment, useState } from "react"
import { FieldChanges } from "./change-table"
import { dashboardApi } from "./dashboard-api"
import type { SectionProps } from "./dashboard-sections"
import { useLiveQuery } from "./live-query"
import type { MentionNames } from "./mentions"
import { localTime } from "./time"

/** Features the log can be filtered by, named as the dashboard names their sections */
export const auditFeatures: Record<DashboardAuditFeature, string> = {
    prefix: "Prefix",
    replies: "Reply style",
    nickname: "Bot nickname",
    presets: "Setup presets",
    sidebar: "Dashboard link",
    responses: "Custom commands and autoresponders",
    moderation: "Moderation and safety",
    alerts: "Security alerts",
    cleanup: "Message cleanup",
    logs: "Channel logs",
    roles: "Reaction roles, autorole and verification",
    rolepicker: "Role picker",
    temproles: "Temporary roles",
    onboarding: "Newcomer checklist",
    memberlist: "Member list order",
    sticky: "Sticky messages",
    publishing: "Drafts and templates",
    greetings: "Greetings",
    schedules: "Schedules",
    youtube: "YouTube alerts",
    twitch: "Twitch alerts",
    tickets: "Tickets",
    helpdesk: "Help desk",
    showcase: "Showcases",
    profile: "Profiles",
    leveling: "Leveling",
    milestones: "Milestones",
    suggestions: "Suggestions",
    events: "Events",
    voice: "Temporary voice",
    lfg: "Looking for group",
    analytics: "Analytics",
    "member-data": "Member data",
    "private-data": "Private cases",
    export: "Server export",
    structure: "Server structure",
}
const kinds: Record<Exclude<DashboardAuditEntry["kind"], "setting">, string> = {
    "member-data-deleted": "Member deleted their own data",
    "private-data-viewed": "Private data viewed",
    "server-exported": "Server exported",
}

/** One entry's before and after values, read when its Details open */
function EntryDetail({
    client,
    sessionToken,
    serverId,
    entryId,
    names,
}: {
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    entryId: string
    names?: MentionNames | undefined
}) {
    const { data, error } = useLiveQuery(client, dashboardApi.auditEntry, { sessionToken, serverId, entryId })
    if (error)
        return (
            <p className="notice error" role="alert">
                The details are unavailable. Refresh your sign-in or check your server permission
            </p>
        )
    if (data === undefined) return <p role="status">Loading the details…</p>
    if (data === null) return <p className="muted">This entry has no stored details</p>
    return (
        <>
            {data.changes.length > 0 && <FieldChanges fields={data.changes} names={names} />}
            {data.more > 0 && (
                <p className="muted">
                    {data.more === 1 ? "1 more change was" : `${data.more.toLocaleString("en-US")} more changes were`}{" "}
                    too large to store
                </p>
            )}
        </>
    )
}

/** Setting changes from the website and chat, members' deletions of their own data and views of private cases, newest first in pages of 25 */
export function AuditLogSection({ client, sessionToken, serverId, catalog }: SectionProps) {
    const [feature, setFeature] = useState(""),
        [cursors, setCursors] = useState<string[]>([]),
        [open, setOpen] = useState<ReadonlySet<string>>(new Set())
    const cursor = cursors.at(-1) ?? null
    const { data, error, current } = useLiveQuery(client, dashboardApi.auditLog, {
        sessionToken,
        serverId,
        cursor,
        ...(feature ? { feature } : {}),
    })
    const next = current ? data?.nextCursor : null
    return (
        <section className="panel" aria-labelledby="audit-title">
            <div className="panel-heading">
                <h2 id="audit-title">Audit log</h2>
                <label className="inline-field">
                    Feature
                    <select
                        value={feature}
                        onChange={(event) => {
                            setFeature(event.target.value)
                            setCursors([])
                        }}
                    >
                        <option value="">All features</option>
                        {Object.entries(auditFeatures).map(([id, name]) => (
                            <option key={id} value={id}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <p className="muted">
                Every setting change, from this website or a chat command, every member's deletion of their own data,
                every view of private cases and every server export. Details shows the values a setting change had
                before and after. Entries are kept for 180 days
            </p>
            {error && (
                <p className="notice error" role="alert">
                    The audit log is unavailable. Refresh your sign-in or check your server permission
                </p>
            )}
            {!data ? (
                !error && <p role="status">Loading the audit log…</p>
            ) : !data.entries.length ? (
                <p className="muted">{cursor ? "No older entries" : "No entries yet"}</p>
            ) : (
                <table className="audit-table">
                    <thead>
                        <tr>
                            <th>When</th>
                            <th>Who</th>
                            <th>From</th>
                            <th>Feature</th>
                            <th>Action</th>
                            <th>Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.entries.map((entry) => (
                            <Fragment key={entry.id}>
                                <tr>
                                    <td>{localTime(entry.createdAt)}</td>
                                    <td>{entry.actorName ? `${entry.actorName} (${entry.actorId})` : entry.actorId}</td>
                                    <td>{entry.source === "website" ? "Website" : "Command"}</td>
                                    <td>{auditFeatures[entry.feature]}</td>
                                    <td>
                                        {entry.kind === "setting" ? (
                                            entry.setting
                                        ) : (
                                            <strong>{kinds[entry.kind]}</strong>
                                        )}
                                    </td>
                                    <td>
                                        {entry.kind === "private-data-viewed"
                                            ? `${entry.setting}. ${entry.summary}`
                                            : entry.summary}
                                        {entry.detail && (
                                            <>
                                                {" "}
                                                <button
                                                    type="button"
                                                    className="secondary"
                                                    aria-expanded={open.has(entry.id)}
                                                    onClick={() => {
                                                        const next = new Set(open)
                                                        if (!next.delete(entry.id)) next.add(entry.id)
                                                        setOpen(next)
                                                    }}
                                                >
                                                    Details
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                                {entry.detail && open.has(entry.id) && (
                                    <tr className="audit-detail">
                                        <td colSpan={6}>
                                            <EntryDetail
                                                client={client}
                                                sessionToken={sessionToken}
                                                serverId={serverId}
                                                entryId={entry.id}
                                                names={catalog}
                                            />
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            )}
            <div className="actions">
                <button
                    type="button"
                    className="secondary"
                    disabled={!cursors.length}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                >
                    Newer
                </button>
                <button
                    type="button"
                    className="secondary"
                    disabled={!next}
                    onClick={() => {
                        if (next) setCursors([...cursors, next])
                    }}
                >
                    Older
                </button>
            </div>
        </section>
    )
}
