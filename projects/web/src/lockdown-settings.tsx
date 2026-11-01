import { LOCKDOWN_CHANNEL_LIMIT } from "@neonflux/contracts/lockdown"
import type { LockdownView } from "@neonflux/contracts/lockdown"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { confirmValue } from "./configuration-values"
import { SearchPicker } from "./search-picker"
import { localTime } from "./time"

const stateText: Record<LockdownView["state"], string> = {
    locking: "On, still locking channels",
    active: "On",
    restoring: "Being lifted, still restoring channels",
    ended: "Off",
}

export function LockdownSettings(props: ConfigSectionProps<"lockdown">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const row = data.lockdown,
        on = row?.state === "locking" || row?.state === "active",
        restoring = row?.state === "restoring",
        owes = !!row && row.counts.failed + row.counts.uncertain > 0,
        // An ended lockdown that owes channels refuses a new start, so the form offers what it needs
        lifts = on || (row?.state === "ended" && owes)
    const nameOf = (id: string) => props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const reason = (values: Record<string, string | boolean>) =>
        typeof values.reason === "string" && values.reason.trim() ? { reason: values.reason.trim() } : {}
    return (
        <div className="role-section">
            <section className="panel" aria-label="Lockdown status">
                <h2>Server-wide lockdown</h2>
                <p>{row ? stateText[row.state] : "Off. No lockdown has run in this server"}</p>
                <p className="muted">
                    A lockdown stops posting in every text, announcement, forum and voice channel the everyone role can
                    see, and gives each channel back only what the lockdown changed. Other role or member grants may
                    still let members post. A channel created during a lockdown is not touched. The chat command
                    !lockdown does the same
                </p>
                {row && (
                    <ul>
                        <li>
                            Started {localTime(row.startedAt)}
                            {row.origin === "antinuke" ? " by anti-nuke" : ""}
                            {row.reason ? `: ${row.reason}` : ""}
                        </li>
                        <li>Locked: {row.counts.locked}</li>
                        <li>Waiting: {row.counts.queued + row.counts.writing}</li>
                        <li>Left alone: {row.counts.skipped}</li>
                        <li>Restored: {row.counts.restored}</li>
                        <li>Failed: {row.counts.failed}</li>
                        <li>Uncertain: {row.counts.uncertain}</li>
                        {row.problems.slice(0, 10).map((problem) => (
                            <li key={problem.channelId}>
                                {nameOf(problem.channelId)}: {problem.state === "failed" ? "Failed" : "Uncertain"}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            {!restoring && (
                <ConfigForm<"lockdown">
                    {...common}
                    title={lifts ? "Lift the lockdown" : "Start a lockdown"}
                    description={
                        on
                            ? "Give every channel back what the lockdown took. A channel locked with !security lock stays locked"
                            : lifts
                              ? "The last lockdown still owes channels what it took. Repeat them before a new lockdown can start"
                              : "Saving locks the channels at once. Needs the server owner, an Administrator or security staff. NeonFlux needs Manage roles"
                    }
                    submitLabel={on ? "Lift lockdown" : lifts ? "Repeat restoring channels" : "Start lockdown"}
                    snapshot={{ revision, values: { confirm: false, reason: "" } }}
                    operation={(values) => {
                        confirmValue(values.confirm, lifts ? "lifting the lockdown" : "locking the server")
                        return { type: lifts ? "off" : "on", ...reason(values) }
                    }}
                    fields={(values, edit, disabled) => (
                        <>
                            <label>
                                Reason (optional)
                                <input
                                    type="text"
                                    maxLength={512}
                                    value={String(values.reason ?? "")}
                                    disabled={disabled}
                                    onChange={(event) => edit("reason", event.target.value)}
                                />
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={Boolean(values.confirm)}
                                    disabled={disabled}
                                    onChange={(event) => edit("confirm", event.target.checked)}
                                />
                                {lifts ? "Confirm lifting the lockdown" : "Confirm locking the server"}
                            </label>
                        </>
                    )}
                />
            )}
            {on && row.counts.failed > 0 && (
                <ConfigForm<"lockdown">
                    {...common}
                    draftKey="repeat-failed"
                    title="Failed channels"
                    description={`Try the ${row.counts.failed} failed ${row.counts.failed === 1 ? "channel" : "channels"} again, once what stopped them is fixed`}
                    submitLabel="Repeat failed channels"
                    submitUnchanged
                    snapshot={{ revision, values: {} }}
                    operation={() => ({ type: "on" })}
                    fields={() => null}
                />
            )}
            {owes && (
                <ConfigForm<"lockdown">
                    {...common}
                    draftKey="repeat"
                    title="Channels with a problem"
                    description={
                        on
                            ? "Read the uncertain channels again, which never repeats a write. Starting the lockdown again from chat repeats failed channels"
                            : "Read the uncertain channels again, which never repeats a write, or send !lockdown off to repeat what is left"
                    }
                    submitLabel="Read uncertain channels"
                    submitUnchanged
                    snapshot={{ revision, values: {} }}
                    operation={() => ({ type: "settle" })}
                    fields={() => null}
                />
            )}
            <ConfigForm<"lockdown">
                {...common}
                draftKey="exempt"
                title="Exempt channels"
                description={`Leave these out of the next lockdown, up to ${LOCKDOWN_CHANNEL_LIMIT}. A lockdown already on is not changed`}
                submitLabel="Save exempt channels"
                snapshot={{ revision, values: { channelIds: JSON.stringify(data.settings.exemptChannelIds) } }}
                operation={(values) => ({
                    type: "exempt-set",
                    channelIds: JSON.parse(String(values.channelIds)) as string[],
                })}
                fields={(values, edit, disabled) => (
                    <SearchPicker
                        catalog
                        multiple
                        label="Exempt channels"
                        options={props.catalog?.channels.filter((channel) => channel.type !== 4) ?? []}
                        loading={props.catalogLoading}
                        allowManual={props.catalogError}
                        value={JSON.parse(String(values.channelIds)) as string[]}
                        disabled={disabled}
                        onChange={(ids) => edit("channelIds", JSON.stringify(ids))}
                    />
                )}
            />
        </div>
    )
}
