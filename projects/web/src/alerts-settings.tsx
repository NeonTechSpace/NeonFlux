import { Fragment } from "react"
import { ALERT_INVITE_PAGE } from "@neonflux/contracts/alerts"
import type { AlertAction, AlertKind } from "@neonflux/contracts/alerts"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { idValue } from "./configuration-values"
import { localTime } from "./time"

const alerts: ReadonlyArray<readonly [AlertKind, string, string]> = [
    [
        "invites",
        "Invite logs",
        "Log each invite created or deleted with its code, flagging invites that never expire or have unlimited uses",
    ],
    ["bots", "Unexpected bots", "Alert when a bot joins that is not marked expected below"],
    [
        "webhooks",
        "Unexpected webhooks",
        "Alert when a webhook that is not marked expected is created or changed, with who did it. Needs View activity log",
    ],
    [
        "privileges",
        "Privilege changes",
        "Alert when a role gains Administrator, Manage community, Manage roles, Manage channels, Manage webhooks, Ban members, Kick members or Time out members, or a member gains such a role, with who did it. Needs View activity log",
    ],
    [
        "impersonation",
        "Impersonation",
        "Alert when a member's username or server nickname closely matches the owner's or a staff member's name. Needs Manage community",
    ],
]
// The action under each alert that can act
const actions: Partial<Record<AlertKind, readonly [AlertAction, string, string]>> = {
    bots: [
        "kickBots",
        "Kick unexpected bots",
        "Kick a bot that joins and is not marked expected, when NeonFlux has Kick members and a higher role",
    ],
    webhooks: [
        "deleteWebhooks",
        "Delete unexpected webhooks",
        "Delete a new webhook that is not marked expected, unless the server owner or an expected bot created it. Changed webhooks are only reported. Needs Manage webhooks",
    ],
    privileges: [
        "removePermissions",
        "Remove gained permissions",
        "Take back the listed permissions a role gained, unless the server owner or an expected bot made the change. A member given a role is only reported. Needs Manage roles and a higher role than that role",
    ],
}
const when = (iso: string | null) => (iso ? localTime(iso) : "Never")

export function AlertsSettings(props: ConfigSectionProps<"alerts">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs },
        settings = data.settings
    // The website knows only who owns the server. The bot checks the owner or Administrator rule when it applies a change
    const owner = props.catalog?.ownerId !== undefined && props.catalog.ownerId === props.userId
    const channelName = (id: string) =>
        props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const expected = [
        ...settings.expectedBotIds.map((id) => ["bot", id] as const),
        ...settings.expectedWebhookIds.map((id) => ["webhook", id] as const),
    ]
    // The invite list shows one page, and a revocation or page change names the page to read next
    const offset = data.invites?.offset ?? 0,
        page = (start: number) => (start > 0 ? { offset: start } : {})
    return (
        <div className="role-section">
            <section className="panel">
                <h2>Security alerts</h2>
                <p className="muted">
                    Every alert starts off. Alerts go to the Security alerts group in Channel logs, so turn on logging
                    and route that group to a staff-only channel, since invite logs show invite codes. NeonFlux acts on
                    an alert only where its action below is on, and only while the alert is on. The chat command !alerts
                    changes the same settings
                </p>
            </section>
            {alerts.map(([kind, title, description]) => {
                const action = actions[kind]
                return (
                    <Fragment key={kind}>
                        <ConfigForm<"alerts">
                            {...common}
                            title={title}
                            description={description}
                            submitLabel={`Save ${title.toLowerCase()}`}
                            snapshot={{ revision, values: { enabled: settings[kind] } }}
                            operation={(values) => ({ type: "set", alert: kind, enabled: Boolean(values.enabled) })}
                            fields={(values, edit, disabled) => (
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(values.enabled)}
                                        disabled={disabled}
                                        onChange={(event) => edit("enabled", event.target.checked)}
                                    />
                                    {title} on
                                </label>
                            )}
                        />
                        {action && (
                            <ConfigForm<"alerts">
                                {...common}
                                title={action[1]}
                                description={`${action[2]}. ${owner ? "Every action starts off" : "Turning it on needs the server owner or an Administrator. Any alerts manager can turn it off"}`}
                                submitLabel={`Save ${action[1].toLowerCase()}`}
                                snapshot={{ revision, values: { enabled: settings[action[0]] } }}
                                operation={(values) => ({
                                    type: "action",
                                    action: action[0],
                                    enabled: Boolean(values.enabled),
                                })}
                                fields={(values, edit, disabled) => (
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(values.enabled)}
                                            disabled={disabled}
                                            onChange={(event) => edit("enabled", event.target.checked)}
                                        />
                                        {action[1]} on
                                    </label>
                                )}
                            />
                        )}
                    </Fragment>
                )
            })}
            <ConfigForm<"alerts">
                {...common}
                title="Mark a bot or webhook expected"
                description="An expected bot or webhook raises no alert"
                submitLabel="Mark expected"
                snapshot={{ revision, values: { kind: "bot", id: "" } }}
                operation={(values) => ({
                    type: "expect",
                    kind: values.kind === "webhook" ? "webhook" : "bot",
                    id: idValue(values.id, "bot or webhook ID"),
                    expected: true,
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            Kind
                            <select
                                value={String(values.kind)}
                                disabled={disabled}
                                onChange={(event) => edit("kind", event.target.value)}
                            >
                                <option value="bot">Bot</option>
                                <option value="webhook">Webhook</option>
                            </select>
                        </label>
                        <label>
                            ID
                            <input
                                required
                                inputMode="numeric"
                                maxLength={19}
                                value={String(values.id)}
                                disabled={disabled}
                                onChange={(event) => edit("id", event.target.value)}
                            />
                        </label>
                    </>
                )}
            />
            {expected.length > 0 && (
                <details>
                    <summary>Expected bots and webhooks ({expected.length})</summary>
                    <div className="role-section">
                        {expected.map(([kind, id]) => (
                            <ConfigForm<"alerts">
                                {...common}
                                key={`${kind}:${id}`}
                                title={`${kind === "bot" ? "Bot" : "Webhook"} ${id}`}
                                description="Alerts resume for it once it is no longer expected"
                                submitLabel="No longer expected"
                                submitUnchanged
                                snapshot={{ revision, values: {} }}
                                operation={() => ({ type: "expect", kind, id, expected: false })}
                                fields={() => null}
                            />
                        ))}
                    </div>
                </details>
            )}
            <ConfigForm<"alerts">
                {...common}
                title="Invites"
                description={`NeonFlux reads the server's invites with its own permissions, which needs Manage community, and lists them with their codes, newest first, ${ALERT_INVITE_PAGE} at a time`}
                submitLabel="Refresh invite list"
                snapshot={{ revision, values: { refresh: false } }}
                operation={() => ({ type: "invites-refresh" })}
                fields={(values, edit, disabled) => (
                    <>
                        {data.invites ? (
                            <p className="field-help">
                                Read {localTime(data.invites.readAt)}. {data.invites.invites.length}{" "}
                                {data.invites.invites.length === 1 ? "invite" : "invites"}
                                {offset ? `, from invite ${offset + 1}` : ""}
                                {data.invites.more ? ", and the server has older ones" : ""}
                            </p>
                        ) : (
                            <p className="field-help">Not read yet</p>
                        )}
                        <label>
                            <input
                                type="checkbox"
                                checked={Boolean(values.refresh)}
                                disabled={disabled}
                                onChange={(event) => edit("refresh", event.target.checked)}
                            />
                            Read the current invites
                        </label>
                    </>
                )}
            />
            {data.invites?.invites.map((invite) => {
                const flags = [
                    ...(invite.expiresAt === null ? ["never expires"] : []),
                    ...(invite.maxUses === 0 ? ["unlimited uses"] : []),
                    ...(invite.temporary ? ["temporary membership"] : []),
                ]
                return (
                    <ConfigForm<"alerts">
                        {...common}
                        key={invite.ref}
                        draftKey={invite.ref}
                        title={`Invite ${invite.code ? `${invite.code} ` : ""}to ${channelName(invite.channelId)}`}
                        description={`Created by ${invite.inviterId ?? "unknown"} on ${when(invite.createdAt)}. ${invite.uses} of ${invite.maxUses || "unlimited"} uses. Expires: ${when(invite.expiresAt)}${flags.length ? `. Flagged: ${flags.join(", ")}` : ""}`}
                        submitLabel="Revoke invite"
                        snapshot={{ revision, values: { confirm: false } }}
                        operation={() => ({ type: "invite-revoke", ref: invite.ref, ...page(offset) })}
                        fields={(values, edit, disabled) => (
                            <label>
                                <input
                                    type="checkbox"
                                    checked={Boolean(values.confirm)}
                                    disabled={disabled}
                                    onChange={(event) => edit("confirm", event.target.checked)}
                                />
                                Confirm revoking this invite. Members who joined with it stay
                            </label>
                        )}
                    />
                )
            })}
            {offset > 0 && (
                <ConfigForm<"alerts">
                    {...common}
                    title="Newer invites"
                    description={`Read the ${ALERT_INVITE_PAGE} invites before these`}
                    submitLabel="Show newer invites"
                    submitUnchanged
                    snapshot={{ revision, values: {} }}
                    operation={() => ({ type: "invites-refresh", ...page(offset - ALERT_INVITE_PAGE) })}
                    fields={() => null}
                />
            )}
            {data.invites?.more && (
                <ConfigForm<"alerts">
                    {...common}
                    title="Older invites"
                    description={`Read the ${ALERT_INVITE_PAGE} invites after these`}
                    submitLabel="Show older invites"
                    submitUnchanged
                    snapshot={{ revision, values: {} }}
                    operation={() => ({ type: "invites-refresh", offset: offset + ALERT_INVITE_PAGE })}
                    fields={() => null}
                />
            )}
        </div>
    )
}
