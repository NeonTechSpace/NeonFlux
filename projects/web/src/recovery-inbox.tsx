import { useState, type ReactNode } from "react"
import type { RecoveryEntry } from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "./dashboard-api"
import type { SectionProps } from "./dashboard-sections"
import { sectionLink, sectionNames } from "./dashboard-sections"
import { useLiveQuery } from "./live-query"
import { mentionText } from "./mentions"
import { problemText } from "./overview"
import { localTime } from "./time"

const when = (at: number | undefined) => (at === undefined ? "Now" : localTime(at))

// Stopped role removals past the inbox's newest 10, one page before a cursor. A page shows only removals that started from until on,
// since the next page lists the older ones, so a resolved removal never shows one twice
function RemovalPage({
    client,
    sessionToken,
    serverId,
    before,
    until,
    row,
    more,
}: Pick<SectionProps, "client" | "sessionToken" | "serverId"> & {
    before: number
    until: number | undefined
    row: (entry: RecoveryEntry, index: number) => ReactNode
    more: ((next: number) => void) | undefined
}) {
    const { data } = useLiveQuery(client, dashboardApi.recovery, { sessionToken, serverId, removalsBefore: before })
    if (!data) return <p role="status">Loading…</p>
    const next = data.nextRemovalsBefore
    return (
        <>
            <ul className="request-list">
                {data.entries
                    .filter((entry) => until === undefined || (entry.kind === "work" && entry.at! >= until))
                    .map(row)}
            </ul>
            {more && next !== undefined && (
                <button type="button" onClick={() => more(next)}>
                    Show more stopped role removals
                </button>
            )}
        </>
    )
}

/** Failed, stuck or uncertain work, features that are on but cannot act and the latest permission check's problems, each with its next step */
export function RecoverySection({ client, sessionToken, serverId, catalog, sectionHref, openSection }: SectionProps) {
    const { data, error } = useLiveQuery(client, dashboardApi.recovery, { sessionToken, serverId })
    // Where each further page of stopped role removals starts, in the order they were opened
    const [pages, setPages] = useState<number[]>([])
    const first = pages[0]
    const row = (entry: RecoveryEntry, index: number) => {
        if (entry.kind === "feature")
            return (
                <li key={index}>
                    <strong>Now</strong>: {sectionNames[entry.feature]} is on but needs setup, such as a channel or a
                    first entry.{" "}
                    <a {...sectionLink(entry.feature, sectionHref, openSection)}>Open {sectionNames[entry.feature]}</a>
                </li>
            )
        if (entry.kind === "setup")
            return (
                <li key={index}>
                    <strong>{when(entry.at)}</strong>, permission check: {problemText(entry.problem)}
                </li>
            )
        // A command names a member by mention, which chat shows by name. The dashboard has no member names, so it shows the ID the command also takes
        return (
            <li key={index}>
                <strong>{when(entry.at)}</strong>: {mentionText(entry.summary, catalog)}
                <br />
                <span className="muted">
                    Next: <code>{mentionText(entry.next.replace(/<@!?(\d+)>/g, "$1"), catalog)}</code>
                </span>
            </li>
        )
    }
    return (
        <section className="panel" aria-labelledby="recovery-title">
            <h2 id="recovery-title">Recovery inbox</h2>
            <p className="muted">
                Work that failed, stalled or has an unknown outcome, features that are on but cannot act yet and the
                problems of the latest permission check, current state first and then newest first. Each source shows
                its newest 10 entries, and stopped role removals page on past them. The chat command{" "}
                <code>!recovery</code> lists the same entries
            </p>
            {error && (
                <p className="notice error" role="alert">
                    The recovery inbox is unavailable. Refresh your sign-in or check your server permission
                </p>
            )}
            {!data ? (
                !error && <p role="status">Loading…</p>
            ) : data.entries.length ? (
                <ul className="request-list">
                    {data.entries
                        .filter(
                            (entry) =>
                                first === undefined ||
                                entry.kind !== "work" ||
                                entry.source !== "removals" ||
                                entry.at! >= first,
                        )
                        .map(row)}
                </ul>
            ) : (
                <p role="status">Nothing needs attention</p>
            )}
            {data?.truncated && <p className="muted">More entries exist than the 100 shown. Resolve these first</p>}
            {data?.nextRemovalsBefore !== undefined && !pages.length && (
                <button type="button" onClick={() => setPages([data.nextRemovalsBefore!])}>
                    Show more stopped role removals
                </button>
            )}
            {pages.length > 0 && <h3>More stopped role removals</h3>}
            {pages.map((before, index) => (
                <RemovalPage
                    key={before}
                    client={client}
                    sessionToken={sessionToken}
                    serverId={serverId}
                    before={before}
                    until={pages[index + 1]}
                    row={row}
                    more={index === pages.length - 1 ? (next) => setPages([...pages, next]) : undefined}
                />
            ))}
        </section>
    )
}
