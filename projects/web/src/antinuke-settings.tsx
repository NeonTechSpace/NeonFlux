import {
    ANTI_NUKE_MAX_COUNT,
    ANTI_NUKE_MAX_SECONDS,
    ANTI_NUKE_MIN_COUNT,
    ANTI_NUKE_MIN_SECONDS,
    ANTI_NUKE_TRUST_LIMIT,
} from "@neonflux/contracts/anti-nuke"
import type { AntiNukeLimitName } from "@neonflux/contracts/anti-nuke"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { ChoiceField, IdList, NumberField } from "./configuration-fields"
import { idsValue, numberValue } from "./configuration-values"

const limitNames: ReadonlyArray<readonly [AntiNukeLimitName, string]> = [
    ["bans", "Bans"],
    ["kicks", "Kicks"],
    ["channels", "Channels deleted"],
    ["roles", "Roles deleted"],
]
const responses = [
    { value: "strip", label: "Remove dangerous roles" },
    { value: "kick", label: "Kick" },
    { value: "ban", label: "Ban" },
]
const modes = [
    { value: "dry-run", label: "Dry run: Record and alert only" },
    { value: "enforce", label: "Enforce: Also act" },
]
export function AntiNukeSettings(props: ConfigSectionProps<"antinuke">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs },
        settings = data.settings
    return (
        <div className="role-section">
            <section className="panel">
                <h2>Anti-nuke</h2>
                <p className="muted">
                    Anti-nuke watches the activity log for one account destroying the server faster than a person works.
                    It starts off and in dry-run, and needs View activity log. It only alerts about the owner, NeonFlux,
                    trusted accounts and anyone ranked at or above NeonFlux, and cannot stop them. Only the server owner
                    or an Administrator can change it. The chat command !antinuke changes the same settings
                </p>
            </section>
            <ConfigForm<"antinuke">
                {...common}
                draftKey="module"
                title="Anti-nuke on"
                description="Count what accounts do. It costs nothing while off"
                submitLabel="Save anti-nuke"
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
                        Anti-nuke on
                    </label>
                )}
            />
            <ConfigForm<"antinuke">
                {...common}
                draftKey="mode"
                title="Mode"
                description="Enforcing needs Manage roles and Kick members, or Ban members for that response"
                submitLabel="Save mode"
                snapshot={{ revision, values: { mode: settings.mode } }}
                operation={(values) => ({ type: "mode", mode: values.mode === "enforce" ? "enforce" : "dry-run" })}
                fields={(values, edit, disabled) => (
                    <ChoiceField
                        label="Mode"
                        value={String(values.mode)}
                        options={modes}
                        disabled={disabled}
                        onChange={(value) => edit("mode", value)}
                    />
                )}
            />
            <ConfigForm<"antinuke">
                {...common}
                draftKey="response"
                title="Response"
                description="What enforce does to an account. Removing roles keeps a record so they can be given back, and a bot with no such role is kicked"
                submitLabel="Save response"
                snapshot={{ revision, values: { response: settings.response } }}
                operation={(values) => ({
                    type: "response",
                    response: values.response === "kick" ? "kick" : values.response === "ban" ? "ban" : "strip",
                })}
                fields={(values, edit, disabled) => (
                    <ChoiceField
                        label="Response"
                        value={String(values.response)}
                        options={responses}
                        disabled={disabled}
                        onChange={(value) => edit("response", value)}
                    />
                )}
            />
            {limitNames.map(([limit, label]) => (
                <ConfigForm<"antinuke">
                    {...common}
                    key={limit}
                    draftKey={`limit-${limit}`}
                    title={label}
                    description={`How many one account may do that fast, ${ANTI_NUKE_MIN_COUNT} to ${ANTI_NUKE_MAX_COUNT} in ${ANTI_NUKE_MIN_SECONDS} to ${ANTI_NUKE_MAX_SECONDS} seconds`}
                    submitLabel={`Save ${label.toLowerCase()}`}
                    snapshot={{
                        revision,
                        values: {
                            count: String(settings.limits[limit].count),
                            seconds: String(settings.limits[limit].seconds),
                        },
                    }}
                    operation={(values) => ({
                        type: "limit",
                        limit,
                        value: {
                            count: numberValue(values.count, ANTI_NUKE_MIN_COUNT, ANTI_NUKE_MAX_COUNT, "The count"),
                            seconds: numberValue(
                                values.seconds,
                                ANTI_NUKE_MIN_SECONDS,
                                ANTI_NUKE_MAX_SECONDS,
                                "The seconds",
                            ),
                        },
                    })}
                    fields={(values, edit, disabled) => (
                        <>
                            <NumberField
                                label="Count"
                                value={String(values.count)}
                                min={ANTI_NUKE_MIN_COUNT}
                                max={ANTI_NUKE_MAX_COUNT}
                                disabled={disabled}
                                onChange={(value) => edit("count", value)}
                            />
                            <NumberField
                                label="Seconds"
                                value={String(values.seconds)}
                                min={ANTI_NUKE_MIN_SECONDS}
                                max={ANTI_NUKE_MAX_SECONDS}
                                disabled={disabled}
                                onChange={(value) => edit("seconds", value)}
                            />
                        </>
                    )}
                />
            ))}
            <ConfigForm<"antinuke">
                {...common}
                draftKey="lockdown"
                title="Allow the lockdown"
                description="Let an incident start the server-wide lockdown when stopping one account cannot contain it: Two accounts at once, or one ranked at or above NeonFlux. It needs enforce"
                submitLabel="Save lockdown"
                snapshot={{ revision, values: { enabled: settings.lockdown } }}
                operation={(values) => ({ type: "lockdown", enabled: Boolean(values.enabled) })}
                fields={(values, edit, disabled) => (
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(values.enabled)}
                            disabled={disabled}
                            onChange={(event) => edit("enabled", event.target.checked)}
                        />
                        Incidents may start the lockdown
                    </label>
                )}
            />
            <ConfigForm<"antinuke">
                {...common}
                draftKey="trust"
                title="Trusted accounts"
                description={`Anti-nuke only alerts about these, up to ${ANTI_NUKE_TRUST_LIMIT}. Saving replaces the whole list`}
                submitLabel="Save trusted accounts"
                snapshot={{ revision, values: { ids: JSON.stringify(settings.trustedIds) } }}
                operation={(values) => ({
                    type: "trust-set",
                    userIds: idsValue(values.ids, ANTI_NUKE_TRUST_LIMIT, "trusted accounts"),
                })}
                fields={(values, edit, disabled) => (
                    <IdList
                        label="Trusted accounts"
                        value={String(values.ids)}
                        onChange={(value) => edit("ids", value)}
                        disabled={disabled}
                        max={ANTI_NUKE_TRUST_LIMIT}
                    />
                )}
            />
            <section className="panel" aria-label="Anti-nuke incidents">
                <h2>Incidents</h2>
                <p>
                    {data.incidentCount} kept
                    {data.unconfirmedCount ? `, ${data.unconfirmedCount} not confirmed` : ""}
                </p>
                <p className="muted">
                    Incidents name accounts, so they are private data. The server owner and members with the private
                    data role read them under Private cases, which is also where roles are given back. The chat command
                    !antinuke incidents shows them to the owner and Administrators, also while logs are off
                </p>
            </section>
        </div>
    )
}
