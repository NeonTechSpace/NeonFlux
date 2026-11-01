import { antiNukeRestorable } from "@neonflux/contracts/anti-nuke"
import type { AntiNukeIncident } from "@neonflux/contracts/anti-nuke"
import type { ConvexReactClient } from "convex/react"
import { useEffect, useState } from "react"
import { dashboardApi } from "./dashboard-api"
import { JobStatus } from "./job-status"
import { useLiveQuery } from "./live-query"
import { requestError } from "./request-error"
import { localTime } from "./time"

const outcomeText: Record<AntiNukeIncident["outcome"], string> = {
    alert: "Alert only",
    pending: "Running",
    none: "Nothing to remove",
    succeeded: "Done",
    failed: "Failed",
    uncertain: "Not confirmed",
}
const lockdownText: Record<AntiNukeIncident["lockdown"], string> = {
    none: "",
    "not-allowed": "Lockdown wanted, but not allowed",
    started: "Lockdown started",
    "already-on": "Lockdown already on",
    failed: "Lockdown could not start",
}
const roles = (ids: readonly string[]) => ids.map((id) => `Role ${id}`).join(", ")
/** What one incident did, with what its restore left out */
function incidentResult(row: AntiNukeIncident) {
    return [
        row.mode === "dry-run" ? "Dry run" : outcomeText[row.outcome],
        ...(lockdownText[row.lockdown] ? [lockdownText[row.lockdown]] : []),
        ...(row.restoredAt !== undefined
            ? [
                  `Roles given back${row.restoreGoneRoleIds?.length ? `, except ${roles(row.restoreGoneRoleIds)}, deleted since` : ""}`,
              ]
            : []),
        ...(row.restoreOutcome === "uncertain" ? ["Restore not confirmed"] : []),
        ...(row.restoreOutcome === "failed"
            ? [
                  `Restore not finished${row.restoreLeftRoleIds?.length ? `: ${roles(row.restoreLeftRoleIds)} ranks at or above NeonFlux` : ""}`,
              ]
            : []),
    ].join(". ")
}

type IncidentJob = {
    readonly id: string
    readonly state: "queued" | "applied" | "failed" | "conflict"
    readonly error?: string
    readonly createdAt: number
    readonly operation: { readonly type: string; readonly incidentNo?: number }
}
/**
 * The incident list of Private cases, with what can be done about each. Restoring and reading a member run as configuration jobs named only by
 * incident number, and need the server owner or an Administrator, as in chat, which only the bot can check. The newest such job shows how it
 * went, and the list is read again once a job asked for here finished
 */
export function AntiNukeIncidents({
    client,
    sessionToken,
    serverId,
    incidents,
    changed,
}: {
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    incidents: readonly AntiNukeIncident[]
    changed: () => void
}) {
    const family = { sessionToken, serverId, family: "antinuke" as const }
    const snapshot = useLiveQuery(client, dashboardApi.configurationSnapshot, family)
    const [ticked, setTicked] = useState<number | undefined>()
    const [waiting, setWaiting] = useState<string | undefined>(),
        [asking, setAsking] = useState(false),
        [problem, setProblem] = useState("")
    const jobs = ((snapshot.data as { jobs?: readonly IncidentJob[] } | undefined)?.jobs ?? []).filter(
        (job) => job.operation.type === "restore" || job.operation.type === "settle",
    )
    const newest = jobs.reduce<IncidentJob | undefined>(
        (latest, job) => (!latest || job.createdAt >= latest.createdAt ? job : latest),
        undefined,
    )
    const awaited = jobs.find((job) => job.id === waiting)
    const finished = awaited !== undefined && awaited.state !== "queued"
    useEffect(() => {
        if (!finished) return
        setWaiting(undefined)
        changed()
    }, [finished])
    const busy = asking || waiting !== undefined || newest?.state === "queued"
    const queue = (operation: { type: "restore" | "settle"; incidentNo: number }) => {
        const revision = snapshot.data?.configRevision
        if (revision === undefined) return
        setProblem("")
        setAsking(true)
        client
            .action(dashboardApi.queueConfiguration, {
                ...family,
                operation,
                expectedConfigRevision: revision,
                requestId: crypto.randomUUID(),
            } as never)
            .then(
                (result: { queued: boolean; jobId?: string }) => {
                    setAsking(false)
                    if (!result.queued || !result.jobId) {
                        setProblem("Anti-nuke's settings changed just now, so nothing was asked. Try again")
                        return
                    }
                    setWaiting(result.jobId)
                    setTicked(undefined)
                },
                (cause) => {
                    setAsking(false)
                    setProblem(requestError(cause, "That could not be asked for. Try again"))
                },
            )
    }
    if (!incidents.length) return <p className="muted">No incidents</p>
    return (
        <>
            <p className="muted">Giving roles back and reading a member need the server owner or an Administrator</p>
            {newest && (
                <p role="status">
                    {newest.operation.type === "restore" ? "Giving roles back" : "Reading the member"} for incident{" "}
                    {newest.operation.incidentNo}: <JobStatus state={newest.state} error={newest.error} />
                </p>
            )}
            {problem && (
                <p className="notice error" role="alert">
                    {problem}
                </p>
            )}
            <ul className="request-list">
                {incidents.map((row) => (
                    <li key={row.incidentNo}>
                        <strong>Incident {row.incidentNo}</strong>, {localTime(row.createdAt)}: Account {row.actorId},{" "}
                        {row.rule}. {incidentResult(row)}
                        {row.outcome === "uncertain" && (
                            <p>
                                <button
                                    type="button"
                                    className="secondary"
                                    disabled={!snapshot.data || busy}
                                    onClick={() => queue({ type: "settle", incidentNo: row.incidentNo })}
                                >
                                    Read incident {row.incidentNo}
                                </button>
                            </p>
                        )}
                        {antiNukeRestorable(row) && (
                            <p className="inline-field">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={ticked === row.incidentNo}
                                        onChange={(event) =>
                                            setTicked(event.target.checked ? row.incidentNo : undefined)
                                        }
                                    />
                                    Confirm giving back what incident {row.incidentNo} removed
                                </label>
                                <button
                                    type="button"
                                    className="secondary"
                                    disabled={!snapshot.data || busy || ticked !== row.incidentNo}
                                    onClick={() => queue({ type: "restore", incidentNo: row.incidentNo })}
                                >
                                    Give roles back from incident {row.incidentNo}
                                </button>
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </>
    )
}
