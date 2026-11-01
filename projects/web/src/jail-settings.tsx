import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { SearchPicker } from "./search-picker"

export function JailSettings(props: ConfigSectionProps<"jail">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const { settings, setup } = data
    const channelName = (id: string) =>
        props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const roleName = (id: string) => props.catalog?.roles.find((role) => role.id === id)?.name ?? `Role ${id}`
    const single = (value: unknown) => (typeof value === "string" && value ? [value] : [])
    const channels = props.catalog?.channels.filter((channel) => channel.type !== 4) ?? []
    const roles = props.catalog?.roles.filter((role) => role.id !== props.remote.serverId) ?? []
    return (
        <div className="role-section">
            <section className="panel" aria-label="Jail status">
                <h2>Jail</h2>
                <p>{settings.enabled ? "On" : "Off. Members already jailed stay jailed"}</p>
                <p className="muted">
                    !mod jail takes a member's roles and leaves them only the jail role, which is denied every channel
                    but the jail channel. !mod unjail gives the roles back in one edit. A role deleted meanwhile or
                    ranked above NeonFlux stays out and is named. A member who leaves and comes back is jailed again
                    right away. It does not hold against a member overwrite someone adds by hand, or a channel created
                    while the bot was down, until the next start closes it. The chat command !jail changes the same
                    settings, and jailing itself runs only in chat
                </p>
                <ul>
                    <li>Role: {settings.roleId ? roleName(settings.roleId) : "None"}</li>
                    <li>Channel: {settings.channelId ? channelName(settings.channelId) : "None"}</li>
                    <li>
                        Jailed: {data.count}. Their names follow the rule of private cases, so !jail list shows them
                    </li>
                    {setup && (
                        <li>
                            Setup: {setup.state === "running" ? "Running, " : ""}
                            {setup.done} of {setup.total} channels
                        </li>
                    )}
                    {setup?.problems.map((problem) => (
                        <li key={problem.channelId}>
                            {channelName(problem.channelId)}: {problem.state === "failed" ? "Failed" : "Not confirmed"}
                        </li>
                    ))}
                </ul>
            </section>
            <ConfigForm<"jail">
                {...common}
                draftKey="setup"
                title="Set up jail"
                description="Makes the Jailed role and a jail channel when none is set, or uses the channel named here, then denies the role every other channel, one at a time. Needs the owner or an Administrator, and NeonFlux needs Manage roles and Manage channels"
                submitLabel="Run setup"
                submitUnchanged
                snapshot={{ revision, values: { channelId: "" } }}
                operation={(values) => ({
                    type: "setup",
                    ...(values.channelId ? { channelId: String(values.channelId) } : {}),
                })}
                fields={(values, edit, disabled) => (
                    <SearchPicker
                        catalog
                        label="Jail channel (optional)"
                        options={channels}
                        loading={props.catalogLoading}
                        allowManual={props.catalogError}
                        value={single(values.channelId)}
                        disabled={disabled}
                        onChange={(ids) => edit("channelId", ids[0] ?? "")}
                    />
                )}
            />
            <ConfigForm<"jail">
                {...common}
                draftKey="module"
                title="Jail on"
                description="Off stops new jails. Members already jailed stay jailed, and a length that ends still releases them"
                submitLabel="Save jail"
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
                        Jail on
                    </label>
                )}
            />
            <ConfigForm<"jail">
                {...common}
                draftKey="role"
                title="Jail role"
                description="A role you already have, ranked below NeonFlux and with no permissions. It can't change while members are jailed"
                submitLabel="Save role"
                snapshot={{ revision, values: { roleId: settings.roleId ?? "" } }}
                operation={(values) => ({ type: "role", roleId: String(values.roleId) })}
                fields={(values, edit, disabled) => (
                    <SearchPicker
                        catalog
                        label="Jail role"
                        options={roles}
                        loading={props.catalogLoading}
                        allowManual={props.catalogError}
                        value={single(values.roleId)}
                        disabled={disabled}
                        onChange={(ids) => edit("roleId", ids[0] ?? "")}
                    />
                )}
            />
            <ConfigForm<"jail">
                {...common}
                draftKey="channel"
                title="Jail channel"
                description="The one channel a jailed member can see. Staff with a moderation staff role can read it too"
                submitLabel="Save channel"
                snapshot={{ revision, values: { channelId: settings.channelId ?? "" } }}
                operation={(values) => ({ type: "channel", channelId: String(values.channelId) })}
                fields={(values, edit, disabled) => (
                    <SearchPicker
                        catalog
                        label="Jail channel"
                        options={channels}
                        loading={props.catalogLoading}
                        allowManual={props.catalogError}
                        value={single(values.channelId)}
                        disabled={disabled}
                        onChange={(ids) => edit("channelId", ids[0] ?? "")}
                    />
                )}
            />
        </div>
    )
}
