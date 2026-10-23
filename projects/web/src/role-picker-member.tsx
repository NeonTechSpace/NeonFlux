import type { ConvexReactClient } from "convex/react"
import { useEffect, useRef, useState } from "react"
import type { RolePickerMemberOperation, RolePickerRoleDisplay } from "@neonflux/contracts/role-picker"
import { dashboardApi } from "./dashboard-api"
import { useLiveQuery } from "./live-query"
import { requestError } from "./request-error"
import { MemberRequests } from "./member-requests"
import { localTime } from "./time"

// The member view. The bot reads the member's roles in a lookup, and claims and drops wait for the bot like other dashboard requests
export function RolePickerMember({
    client,
    sessionToken,
    serverId,
    connected,
    title = "Role picker",
}: {
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    connected: boolean
    /** The region and heading, which differ from the settings form's when a manager opens this page beside it */
    title?: string
}) {
    const { data: remote, error } = useLiveQuery(client, dashboardApi.rolePickerMember, { sessionToken, serverId })
    const [sending, setSending] = useState(false),
        [notice, setNotice] = useState("")
    const looked = useRef(false)
    async function send(operation: RolePickerMemberOperation) {
        setSending(true)
        setNotice("")
        try {
            await client.mutation(dashboardApi.rolePickerRequest, {
                sessionToken,
                serverId,
                requestId: crypto.randomUUID(),
                operation,
            })
        } catch (cause) {
            setNotice(requestError(cause))
        } finally {
            setSending(false)
        }
    }
    const pendingLookup =
        remote?.requests.some((row) => row.state === "queued" && row.operation.type === "lookup") ?? false
    // One lookup when the view opens without fresh roles, so the menus can show what you hold
    useEffect(() => {
        if (!remote || looked.current || !connected) return
        looked.current = true
        if (!remote.snapshot && !pendingLookup) void send({ type: "lookup" })
    }, [remote, connected])
    // Role names and colors come from the bot: The last lookup's read first, then the names stored with the menus at their last save
    const roles = new Map<string, RolePickerRoleDisplay>(
        [...(remote?.menus.flatMap((menu) => menu.display ?? []) ?? []), ...(remote?.snapshot?.roles ?? [])].map(
            (role) => [role.roleId, role],
        ),
    )
    const name = (roleId: string) => roles.get(roleId)?.name ?? "Unnamed role"
    const swatch = (roleId: string) => {
        const color = roles.get(roleId)?.color ?? 0
        return color ? (
            <span
                aria-hidden="true"
                style={{
                    display: "inline-block",
                    width: "0.75em",
                    height: "0.75em",
                    borderRadius: "50%",
                    marginRight: "0.4em",
                    background: `#${color.toString(16).padStart(6, "0")}`,
                }}
            />
        ) : null
    }
    const label = (operation: RolePickerMemberOperation) =>
        operation.type === "lookup"
            ? "Check my roles"
            : `${operation.type === "claim" ? "Claim" : "Drop"} ${name(operation.roleId)}`
    if (error)
        return (
            <section className="panel">
                <p role="alert" className="notice error">
                    The role picker is not available in this server right now. It may have been turned off, or your
                    sign-in needs a refresh
                </p>
            </section>
        )
    if (!remote)
        return (
            <section className="panel">
                <p role="status">Loading the role picker…</p>
            </section>
        )
    const snapshot = remote.snapshot,
        usable = connected && !sending && Boolean(snapshot?.allowed)
    return (
        <>
            <section className="panel" aria-label={title}>
                <h2>{title}</h2>
                <p className="muted">
                    Claim or drop roles from the menus below. The bot checks your current roles and permissions before
                    each change, so a change shows as pending until it is applied
                </p>
                {!snapshot && (
                    <p role="status" className="notice">
                        {pendingLookup ? "Checking your current roles…" : "Your current roles are not loaded yet"}
                    </p>
                )}
                {snapshot && !snapshot.allowed && (
                    <p role="alert" className="notice error">
                        You cannot use the role picker in this server
                    </p>
                )}
                {!remote.menus.length && <p className="muted">No menus are set up yet</p>}
                {remote.menus.map((menu) => (
                    <fieldset className="mapping-row" key={menu.name}>
                        <legend>{menu.name}</legend>
                        {menu.description && <p>{menu.description}</p>}
                        <p className="field-help">
                            {menu.mode === "single"
                                ? "Choose one. Claiming a role drops the other role of this menu"
                                : "Choose any number"}
                        </p>
                        <ul className="request-list">
                            {menu.roleIds.map((roleId) => {
                                const held = snapshot?.roleIds.includes(roleId) ?? false
                                const pending = remote.requests.some(
                                    (row) =>
                                        row.state === "queued" &&
                                        row.operation.type !== "lookup" &&
                                        row.operation.roleId === roleId,
                                )
                                return (
                                    <li key={roleId}>
                                        {swatch(roleId)}
                                        {name(roleId)}
                                        {held && <span className="muted"> · You have this role</span>}{" "}
                                        <button
                                            type="button"
                                            className={held ? "secondary" : undefined}
                                            disabled={!usable || pending}
                                            aria-label={`${held ? "Drop" : "Claim"} ${name(roleId)}`}
                                            onClick={() =>
                                                void send({ type: held ? "drop" : "claim", menu: menu.name, roleId })
                                            }
                                        >
                                            {pending ? "Pending…" : held ? "Drop" : "Claim"}
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    </fieldset>
                ))}
                <div className="actions">
                    <button
                        type="button"
                        className="secondary"
                        disabled={!connected || sending || pendingLookup}
                        onClick={() => void send({ type: "lookup" })}
                    >
                        Refresh my roles
                    </button>
                    {snapshot && (
                        <span className="muted">
                            Roles checked {localTime(snapshot.observedAt)}. This check expires after ten minutes
                        </span>
                    )}
                </div>
                {notice && (
                    <p role="alert" className="notice error">
                        {notice}
                    </p>
                )}
            </section>
            <MemberRequests requests={remote.requests} label={label} />
        </>
    )
}
