import {
    backupSettingName,
    type BackupChange,
    type BackupItemState,
    type BackupPreviewFailure,
} from "@neonflux/contracts/backup"
import { permissionNames } from "@neonflux/contracts/permission-names"
import type { DashboardBackupChangedItem } from "@neonflux/backend/dashboard-contracts"
import { useCallback, useEffect, useRef, useState } from "react"
import { dashboardApi } from "./dashboard-api"
import type { SectionProps } from "./dashboard-sections"
import { useLiveQuery } from "./live-query"
import { mentionText, type MentionNames } from "./mentions"
import { dmCommand } from "./dm-command"
import { localTime } from "./time"

/** Why a check failed. The commands are the owner's DM commands, which name the server when the bot serves several */
const failures = (dm: (command: string) => string): Record<BackupPreviewFailure, string> => ({
    owner: "NeonFlux found that you no longer own this server or that its DM with you is no longer private. A check you had not confirmed was removed, and a running restore stopped",
    archive: `NeonFlux could not read the archive again. Its DM message may be deleted or its attachment expired, or the recovery key changed. Send ${dm("!backup preview")} with the archive attached again`,
    key: "Backups are off because the bot has no backup key, so the archive cannot be read. The bot operator sets NEONFLUX_BACKUP_KEY",
    refused:
        "A restore refuses this archive as a whole because it exceeds restore limits. Export fewer categories at a time",
    error: `NeonFlux could not read the archive or the server, or could not continue a restore. Check again, or send ${dm("!backup status")} in the DM and continue there with ${dm("!backup confirm")}`,
    unanswered: "NeonFlux did not answer. Check that the bot is online, then check again",
    paused: `DEFCON 1 pauses restores, so nothing more was restored. Check again, or continue in the DM with ${dm("!backup confirm")} once DEFCON is lower`,
    expired: "The check expired before the restore finished. Check again to compare with the server",
})
const itemStates: Record<BackupItemState, string> = {
    planned: "Waiting",
    reserved: "Starting",
    claimed: "In progress",
    created: "Created",
    updated: "Updated",
    deleted: "Deleted",
    skipped: "Already identical",
    conflict: "Left alone because it changed",
    blocked: "Blocked",
    failed: "Failed",
    uncertain: "Not confirmed",
}
const marks = {
    create: "+ Create",
    update: "~ Update",
    delete: "- Delete",
    skip: "= Identical",
    blocked: "! Blocked",
} as const
const capital = (text: string) => text.replace(/^./, (letter) => letter.toUpperCase())
const familyNames: Partial<Record<string, string>> = {
    ticketCategory: "Ticket category",
    milestoneRoute: "Milestone route",
}
const plural = (count: number, word: string, words = `${word}s`) => `${count} ${count === 1 ? word : words}`
/** What an archive item is, as the bot's preview names it. Restores stay in their own server, so an archive channel's ID names the channel there while it exists */
const target = (
    item: Pick<DashboardBackupChangedItem, "category" | "family" | "sourceId" | "name">,
    names?: MentionNames,
) =>
    item.category === "structure"
        ? `Channel ${item.name ?? mentionText(`<#${item.sourceId}>`, names)}`
        : item.category === "xp"
          ? `XP of ${mentionText(`<@${item.sourceId}>`)}`
          : item.family === "cleanupPolicy"
            ? `Message cleanup in ${mentionText(`<#${item.sourceId}>`, names)}`
            : item.sourceId === item.family
              ? capital(item.family)
              : `${familyNames[item.family] ?? capital(item.family)} ${item.sourceId}`
const listed = (bits: string) => permissionNames(bits).join(", ") || "none"
const permissions = (p: { allow: string; deny: string }) => `Allow ${listed(p.allow)}. Deny ${listed(p.deny)}`
/** A setting's value in words: no value is none, a switch is On or Off and a category is its name while the catalog knows it */
const shown = (value: unknown, path: string, names?: MentionNames) =>
    value === undefined || value === null
        ? "none"
        : typeof value === "boolean"
          ? value
              ? "On"
              : "Off"
          : typeof value === "string"
            ? path === "parentId"
                ? (names?.channels?.find((channel) => channel.id === value)?.name ?? value)
                : mentionText(value, names)
            : mentionText(JSON.stringify(value), names)
/** A value in full: a long one starts collapsed behind its beginning, and is never cut */
function Value({ value, path, names }: { value: unknown; path: string; names?: MentionNames | undefined }) {
    const text = shown(value, path, names)
    return text.length > 120 || text.includes("\n") ? (
        <details>
            <summary>{text.slice(0, 80).replaceAll("\n", " ")}…</summary>
            <pre>{text}</pre>
        </details>
    ) : (
        <>{text}</>
    )
}
function Changes({ changes, names }: { changes: BackupChange[]; names?: MentionNames | undefined }) {
    const fields = changes.flatMap((x) => (x.kind === "field" ? [x] : [])),
        overwrites = changes.flatMap((x) => (x.kind === "overwrite" ? [x] : []))
    return (
        <>
            {fields.length > 0 && (
                <table className="restore-diff">
                    <thead>
                        <tr>
                            <th>Change</th>
                            <th>Setting</th>
                            <th>Before</th>
                            <th>After</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map((field) => (
                            <tr key={field.path}>
                                <td data-label="Change">
                                    {!("before" in field) ? "+ Added" : !("after" in field) ? "- Removed" : "~ Changed"}
                                </td>
                                <td data-label="Setting">{capital(backupSettingName(field.path))}</td>
                                <td data-label="Before">
                                    <Value value={field.before} path={field.path} names={names} />
                                </td>
                                <td data-label="After">
                                    <Value value={field.after} path={field.path} names={names} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {overwrites.length > 0 && (
                <ul className="restore-permissions">
                    {overwrites.map((x) => {
                        const who = mentionText(x.type === "role" ? `<@&${x.id}>` : `<@${x.id}>`, names)
                        return (
                            <li key={x.id}>
                                <strong>Permissions for {who}</strong>
                                {x.dropped ? (
                                    <p>
                                        The {x.type} is gone, so this is not restored. The archive had:{" "}
                                        {permissions(x.before)}
                                    </p>
                                ) : (
                                    <>
                                        <p>Before: {permissions(x.before)}</p>
                                        <p>After: {permissions(x.after)}</p>
                                    </>
                                )}
                                {permissionNames(x.gain).length > 0 && (
                                    <p>Added allows or lifted denies: {listed(x.gain)}</p>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </>
    )
}
function Row({
    item,
    names,
    confirmed,
}: {
    item: DashboardBackupChangedItem
    names?: MentionNames | undefined
    confirmed: boolean
}) {
    const label = item.disposition === "skip" && item.reason ? "= Left alone" : marks[item.disposition]
    return (
        <li className={`restore-row ${item.disposition}`}>
            <div className="restore-head">
                <strong>{target(item, names)}</strong>
                <span className="restore-badge">{label}</span>
                {item.gain && <span className="restore-badge strong">More than now</span>}
                {item.on && <span className="restore-badge strong">Turns on</span>}
                {confirmed && <span className="restore-badge">{itemStates[item.state]}</span>}
            </div>
            {item.reason && <p>{mentionText(item.reason, names)}</p>}
            {item.warning && <p>{mentionText(item.warning, names)}</p>}
            {item.disposition !== "delete" && <Changes changes={item.changes} names={names} />}
        </li>
    )
}

/** The owner's latest restore check: what restoring would change, what needs a look first, and the button that confirms exactly this check */
export function BackupSection({ client, sessionToken, serverId, catalog, connected, multi = false }: SectionProps) {
    const dm = (command: string) => dmCommand(command, serverId, multi)
    const { data, error } = useLiveQuery(client, dashboardApi.backupRestore, { sessionToken, serverId })
    const [failed, setFailed] = useState(false),
        [wait, setWait] = useState(false),
        [confirmFailed, setConfirmFailed] = useState(false),
        [confirming, setConfirming] = useState(false),
        [identical, setIdentical] = useState(false),
        [cursors, setCursors] = useState<string[]>([]),
        asked = useRef(false)
    const plan = data?.plan ?? null,
        planId = plan?.planId
    // The button and the checkbox say when a request is not taken, and opening the page asks quietly
    const request = useCallback(
        (match?: boolean, quiet = false) => {
            setFailed(false)
            setWait(false)
            client
                .mutation(dashboardApi.requestBackupRestore, {
                    sessionToken,
                    serverId,
                    ...(match !== undefined ? { match } : {}),
                })
                .then((queued) => setWait(!queued && !quiet))
                .catch(() => setFailed(true))
        },
        [client, sessionToken, serverId],
    )
    // Opening the page asks for a fresh read, unless the plan shown is a restore that started, whose outcome stays on screen
    useEffect(() => {
        if (!data || asked.current) return
        asked.current = true
        if (plan?.confirmedAt === undefined) request(undefined, true)
    }, [data, plan, request])
    // A new check is a new list
    useEffect(() => setCursors([]), [planId, identical])
    // Nothing else shows the section again when a check reaches its confirmation cutoff, so a timer turns the button off then
    const [, setCutoff] = useState(0),
        confirmBefore = plan?.confirmedAt === undefined ? plan?.confirmBefore : undefined
    useEffect(() => {
        if (confirmBefore === undefined || confirmBefore <= Date.now()) return
        const timer = setTimeout(() => setCutoff(confirmBefore), confirmBefore - Date.now())
        return () => clearTimeout(timer)
    }, [confirmBefore])
    const page = useLiveQuery(
        client,
        dashboardApi.backupItems,
        planId ? { sessionToken, serverId, planId, identical, cursor: cursors.at(-1) ?? null } : undefined,
    )
    const items = page.current ? page.data?.items : undefined,
        next = page.current ? page.data?.nextCursor : undefined
    const confirm = () => {
        if (!plan) return
        setConfirming(true)
        setConfirmFailed(false)
        client
            .mutation(dashboardApi.confirmBackupRestore, {
                sessionToken,
                serverId,
                planId: plan.planId,
                planHash: plan.planHash,
            })
            .catch(() => setConfirmFailed(true))
            .finally(() => setConfirming(false))
    }
    const busy = data?.state === "queued" || data?.state === "running" || data?.state === "waiting"
    const counts = plan?.counts,
        changes = counts ? counts.create + counts.update : 0,
        deletes = counts?.delete ?? 0,
        confirmed = plan?.confirmedAt !== undefined,
        now = Date.now()
    const blocker =
        plan &&
        (busy
            ? "NeonFlux is working on this"
            : data?.state === "failed"
              ? "The last check failed. Check again first"
              : now >= plan.confirmBefore
                ? "This check is about to expire. Check again first"
                : changes + deletes === 0
                  ? "Nothing here can be restored"
                  : !connected
                    ? "Waiting for the connection"
                    : null)
    const attention = plan && [
        ...(plan.counts.blocked
            ? [["Blocked", `${plural(plan.counts.blocked, "item")} will not run. Each row says why and how to fix it`]]
            : []),
        ...(deletes
            ? [
                  [
                      "Deletes",
                      `${plural(deletes, "channel or category", "channels and categories")} will be deleted with ${deletes === 1 ? "its" : "their"} messages. This cannot be undone`,
                  ],
              ]
            : []),
        ...(plan.gain.items
            ? [
                  [
                      "More permission",
                      `${plural(plan.gain.items, "change")} grant${plan.gain.items === 1 ? "s" : ""} more than the server has now: ${permissionNames(plan.gain.bits).join(", ")}`,
                  ],
              ]
            : []),
        ...(plan.turnsOn.length ? [["Turns on", plan.turnsOn.map((item) => target(item, catalog)).join(", ")]] : []),
        ...(plan.warned
            ? [
                  [
                      "Starts work",
                      `${plural(plan.warned, "item")} start${plan.warned === 1 ? "s" : ""} to delete messages or post logs, as the rows say`,
                  ],
              ]
            : []),
    ]
    const unfinished = plan ? plan.itemCount - plan.settled : 0
    return (
        <div className="role-section">
            <section className="panel" aria-labelledby="backup-title">
                <h2 id="backup-title">Backup restore</h2>
                <p className="muted">
                    What restoring your latest checked archive would do to the server as it is now. Only the server
                    owner who made it sees it here and can restore from it
                </p>
                <p className="muted">
                    Make an encrypted backup in a DM with NeonFlux:{" "}
                    <code>{dm("!backup export config xp structure")}</code> (leave out any of the three categories you
                    do not want). Check an archive: send <code>{dm("!backup preview")}</code> with the archive attached.
                    The archive arrives in your DM. Keep it and the bot's backup key somewhere safe offline
                </p>
                {wait && (
                    <p className="notice" role="status">
                        A check was made a moment ago. Wait a few seconds, then try again
                    </p>
                )}
                {(failed || error) && (
                    <p className="notice error" role="alert">
                        The check could not be loaded. Refresh your sign-in or try again
                    </p>
                )}
                {data === undefined ? (
                    !error && <p role="status">Loading…</p>
                ) : data === null ? (
                    <p role="status">No check yet</p>
                ) : (
                    <>
                        {data.state === "queued" && (
                            <p role="status">Asking NeonFlux to read the archive and the server again…</p>
                        )}
                        {data.state === "failed" && data.failure && (
                            <p className="notice error" role="alert">
                                {failures(dm)[data.failure]}
                            </p>
                        )}
                        {plan && counts && attention && (
                            <>
                                <p>
                                    Archive {plan.backupId}, checked {localTime(plan.createdAt)}
                                </p>
                                <ul className="restore-counts" aria-label="Changes by kind">
                                    {counts.create > 0 && <li>{counts.create} to create</li>}
                                    {counts.update > 0 && <li>{counts.update} to update</li>}
                                    {counts.delete > 0 && <li>{counts.delete} to delete</li>}
                                    {counts.blocked > 0 && <li>{counts.blocked} blocked</li>}
                                    {counts.skip > 0 && <li>{counts.skip} identical or left alone</li>}
                                    {plan.itemCount === 0 && <li>Nothing to restore</li>}
                                </ul>
                                {attention.length > 0 && (
                                    <div className="notice restore-attention" role="status">
                                        <h3>Look at these first</h3>
                                        <ul>
                                            {attention.map(([name, text]) => (
                                                <li key={name}>
                                                    <strong>{name}:</strong> {text}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="actions">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={plan.match}
                                            disabled={busy || !connected}
                                            onChange={(event) => request(event.target.checked)}
                                        />
                                        <span>
                                            Match fully
                                            <span className="field-help">
                                                Also delete the channels and categories that the archive does not hold.
                                                Changing this makes a new check
                                            </span>
                                        </span>
                                    </label>
                                    <button
                                        type="button"
                                        className="secondary"
                                        disabled={busy || !connected}
                                        onClick={() => request()}
                                    >
                                        Check again
                                    </button>
                                </div>
                            </>
                        )}
                        {!plan && (
                            <div className="actions">
                                <button
                                    type="button"
                                    className="secondary"
                                    disabled={busy || !connected}
                                    onClick={() => request()}
                                >
                                    Check again
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>
            {plan && (
                <section className="panel" aria-labelledby="restore-changes-title">
                    <h2 id="restore-changes-title">Changes</h2>
                    <p className="muted">Problems come first, then updates and creations</p>
                    {items === undefined ? (
                        <p role="status">Loading…</p>
                    ) : (
                        <ol className="restore-list">
                            {items.map((item) => (
                                <Row key={item.itemNo} item={item} names={catalog} confirmed={confirmed} />
                            ))}
                        </ol>
                    )}
                    {items?.length === 0 && <p>Nothing to list. Identical items are hidden</p>}
                    <div className="actions">
                        <button
                            type="button"
                            className="secondary"
                            disabled={cursors.length === 0}
                            onClick={() => setCursors(cursors.slice(0, -1))}
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            className="secondary"
                            disabled={!next}
                            onClick={() => next && setCursors([...cursors, next])}
                        >
                            Next
                        </button>
                        {plan.counts.skip > 0 && (
                            <label>
                                <input
                                    type="checkbox"
                                    checked={identical}
                                    onChange={(event) => setIdentical(event.target.checked)}
                                />
                                Show {plan.counts.skip} identical or left alone
                            </label>
                        )}
                    </div>
                </section>
            )}
            {plan && (
                <section className="panel" aria-labelledby="restore-title">
                    <h2 id="restore-title">Restore</h2>
                    {confirmed ? (
                        <>
                            <p role="status">
                                Restore started {localTime(plan.confirmedAt!)}: {plan.settled} of {plan.itemCount} items
                                have an outcome
                                {data?.state === "waiting" && ". NeonFlux is waiting to confirm channel writes"}
                            </p>
                            {!busy && (
                                <p>
                                    {Object.entries(itemStates)
                                        .filter(([state]) => plan.states[state as BackupItemState])
                                        .map(([state, name]) => `${name} ${plan.states[state as BackupItemState]}`)
                                        .join(", ")}
                                    {unfinished > 0
                                        ? `. ${plural(unfinished, "item")} not finished or not confirmed. Check again to compare with the server`
                                        : ". Check again to compare with the server"}
                                </p>
                            )}
                        </>
                    ) : (
                        <>
                            <p>
                                This runs exactly the check above. Nothing is undone automatically, so read what is
                                listed first
                            </p>
                            <div className="actions">
                                <button type="button" disabled={blocker !== null || confirming} onClick={confirm}>
                                    {changes + deletes === 0
                                        ? "Nothing to restore"
                                        : `${[
                                              ...(changes ? [`Restore ${plural(changes, "change")}`] : []),
                                              ...(deletes
                                                  ? [
                                                        `${changes ? "and delete" : "Delete"} ${plural(deletes, "channel or category", "channels and categories")}`,
                                                    ]
                                                  : []),
                                          ].join(" ")}`}
                                </button>
                                {blocker && <span className="muted">{blocker}</span>}
                            </div>
                        </>
                    )}
                    {confirmFailed && (
                        <p className="notice error" role="alert">
                            The restore did not start. The check may be out of date. Check again
                        </p>
                    )}
                </section>
            )}
        </div>
    )
}
