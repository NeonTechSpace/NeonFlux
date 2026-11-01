import {
    BOT_RIGHTS,
    RIGHTS_DEFAULT_LIMITS,
    RIGHTS_MAX_COUNT,
    RIGHTS_MAX_MINUTES,
    RIGHTS_MIN_MINUTES,
    RIGHTS_SERVER_FACTOR,
    type BotRight,
} from "@neonflux/contracts/rights"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { NumberField } from "./configuration-fields"
import { idValue, numberValue } from "./configuration-values"
import { SearchPicker } from "./search-picker"

const rightNames: Record<BotRight, string> = {
    kick: "Kick",
    ban: "Ban and unban",
    timeout: "Timeout and its removal",
    purge: "Purge",
    slowmode: "Slowmode",
    lock: "Lock and unlock",
    quarantine: "Quarantine and release",
    jail: "Jail and unjail",
}

export function RightsSettings(props: ConfigSectionProps<"rights">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const { settings } = data
    const roleName = (id: string) => props.catalog?.roles.find((role) => role.id === id)?.name ?? `Role ${id}`
    const roles = props.catalog?.roles.filter((role) => role.id !== props.remote.serverId) ?? []
    const chosen = (values: Record<string, string | boolean>) => BOT_RIGHTS.filter((right) => values[`right-${right}`])
    const rightBoxes = (
        values: Record<string, string | boolean>,
        edit: (key: string, value: string | boolean) => void,
        disabled: boolean,
    ) =>
        BOT_RIGHTS.map((right) => (
            <label key={right}>
                <input
                    type="checkbox"
                    checked={Boolean(values[`right-${right}`])}
                    disabled={disabled}
                    onChange={(event) => edit(`right-${right}`, event.target.checked)}
                />
                {rightNames[right]}
            </label>
        ))
    const unchecked = Object.fromEntries(BOT_RIGHTS.map((right) => [`right-${right}`, false]))
    return (
        <div className="role-section">
            <section className="panel" aria-label="Bot-only staff rights">
                <h2>Bot-only staff rights</h2>
                <p>{settings.enabled ? "On" : "Off. Staff roles need the real Fluxer permission"}</p>
                <p className="muted">
                    A staff role with no real permission can act only through NeonFlux, which limits it, so a hacked
                    staff account cannot do more than these limits allow and cannot act in Fluxer itself. Going over a
                    limit refuses the action and suspends that member's rights until the owner clears them, and
                    anti-nuke firing on a member suspends them too. It cannot limit a hacked owner or Administrator, or
                    a member holding real permissions, who acts in Fluxer directly. NeonFlux's own token becomes the
                    higher value target. Moderating runs only in chat, never from here. Only the server owner turns this
                    on, grants, changes limits and clears a suspension, and the owner or an Administrator can turn it
                    off or revoke. Backups leave this out. The chat command !mod rights does the same
                </p>
                {settings.grants.length ? (
                    <ul>
                        {settings.grants.map((grant) => (
                            <li key={grant.roleId}>
                                {roleName(grant.roleId)}: {grant.rights.map((right) => rightNames[right]).join(", ")}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>No role holds a right</p>
                )}
            </section>
            <ConfigForm<"rights">
                {...common}
                draftKey="module"
                title="Rights on"
                description="Off makes staff need the real permission again at once, and the grants stay stored"
                submitLabel="Save rights"
                snapshot={{ revision, values: { enabled: settings.enabled } }}
                operation={(values) => ({ type: "module", enabled: Boolean(values.enabled) })}
                fields={(values, edit, disabled) => (
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(values.enabled)}
                            disabled={disabled}
                            onChange={(event) => edit("enabled", event.target.checked)}
                        />
                        Bot-only staff rights on
                    </label>
                )}
            />
            <ConfigForm<"rights">
                {...common}
                draftKey="grant"
                title="Grant rights to a role"
                description="The role must also be a staff role for the area, rank below NeonFlux and rank above whoever its members act on. The everyone role can't hold rights"
                submitLabel="Grant"
                snapshot={{ revision, values: { roleId: "", ...unchecked } }}
                operation={(values) => {
                    const rights = chosen(values)
                    if (!values.roleId || !rights.length) throw new Error("Choose a role and at least one right")
                    return { type: "grant", roleId: String(values.roleId), rights }
                }}
                fields={(values, edit, disabled) => (
                    <>
                        <SearchPicker
                            catalog
                            label="Role"
                            options={roles}
                            loading={props.catalogLoading}
                            allowManual={props.catalogError}
                            value={values.roleId ? [String(values.roleId)] : []}
                            disabled={disabled}
                            onChange={(ids) => edit("roleId", ids[0] ?? "")}
                        />
                        {rightBoxes(values, edit, disabled)}
                    </>
                )}
            />
            {settings.grants.map((grant) => (
                <ConfigForm<"rights">
                    {...common}
                    key={grant.roleId}
                    draftKey={`revoke-${grant.roleId}`}
                    title={`Revoke from ${roleName(grant.roleId)}`}
                    description="Takes every right from this role. The owner or an Administrator can do this, at every DEFCON level"
                    submitLabel="Revoke"
                    submitUnchanged
                    snapshot={{ revision, values: {} }}
                    operation={() => ({ type: "revoke", roleId: grant.roleId })}
                    fields={() => null}
                />
            ))}
            {BOT_RIGHTS.map((right) => (
                <ConfigForm<"rights">
                    {...common}
                    key={right}
                    draftKey={`limit-${right}`}
                    title={`${rightNames[right]} limit`}
                    description={`What one member may do, ${RIGHTS_DEFAULT_LIMITS[right].count} in ${RIGHTS_DEFAULT_LIMITS[right].minutes} minutes by default. All members together may do ${RIGHTS_SERVER_FACTOR} times this`}
                    submitLabel="Save limit"
                    snapshot={{
                        revision,
                        values: {
                            count: String(settings.limits[right].count),
                            minutes: String(settings.limits[right].minutes),
                        },
                    }}
                    operation={(values) => ({
                        type: "limit",
                        right,
                        count: numberValue(values.count, 1, RIGHTS_MAX_COUNT, "The count"),
                        minutes: numberValue(values.minutes, RIGHTS_MIN_MINUTES, RIGHTS_MAX_MINUTES, "The minutes"),
                    })}
                    fields={(values, edit, disabled) => (
                        <>
                            <NumberField
                                label="Count"
                                value={String(values.count)}
                                min={1}
                                max={RIGHTS_MAX_COUNT}
                                disabled={disabled}
                                onChange={(value) => edit("count", value)}
                            />
                            <NumberField
                                label="Minutes"
                                value={String(values.minutes)}
                                min={RIGHTS_MIN_MINUTES}
                                max={RIGHTS_MAX_MINUTES}
                                disabled={disabled}
                                onChange={(value) => edit("minutes", value)}
                            />
                        </>
                    )}
                />
            ))}
            <section className="panel" aria-label="Suspended members">
                <h3>Suspended members</h3>
                <p>{data.suspendedCount}</p>
                <p className="muted">
                    Who they are stays with staff, and the chat command !mod rights status names them
                </p>
            </section>
            <ConfigForm<"rights">
                {...common}
                draftKey="clear"
                title="Clear a member"
                description="Lifts a suspension and starts the member's count again, for the server owner"
                submitLabel="Clear member"
                snapshot={{ revision, values: { userId: "" } }}
                operation={(values) => ({ type: "clear", userId: idValue(values.userId, "member ID") })}
                fields={(values, edit, disabled) => (
                    <label>
                        Member ID
                        <input
                            type="text"
                            value={String(values.userId ?? "")}
                            disabled={disabled}
                            onChange={(event) => edit("userId", event.target.value)}
                        />
                    </label>
                )}
            />
        </div>
    )
}
