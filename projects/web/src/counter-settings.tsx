import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import {
    COUNTER_LIMIT,
    COUNTER_NAME_MAX,
    counterCountProblemText,
    counterTemplate,
    isCounterTemplate,
    type Counter,
} from "@neonflux/contracts/counters"
import { selectableRoles } from "./catalog-options"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { ChoiceField } from "./configuration-fields"
import { SearchPicker } from "./search-picker"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"

// Voice, text and announcement channels and categories
const counterChannels = (catalog?: DashboardCatalog) =>
    catalog?.channels.filter((channel) => [0, 2, 4, 5].includes(channel.type)) ?? []
function templateValue(values: FormValues) {
    const value = counterTemplate(String(values.template ?? ""))
    if (!isCounterTemplate(value))
        throw new FormInputError(`Write the name with {count} in it, in at most ${COUNTER_NAME_MAX} characters`)
    return value
}
const problems = {
    channel: "Off: Its channel is gone. Remove this counter and add one for another channel",
    permission:
        "Off: NeonFlux cannot rename its channel. Give NeonFlux View channel and Manage channels there, then save the name below to turn it back on",
}

export function CounterSettings(props: ConfigSectionProps<"counters">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const channelName = (id: string) =>
        props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const roleName = (id: string) => props.catalog?.roles.find((role) => role.id === id)?.name ?? `Role ${id}`
    const counted = (row: Counter) => (row.roleId ? `Members of ${roleName(row.roleId)}` : "Server members")
    const saved = savedRows(data.counters, props.removedDefinitions, (row) => `counter:${row.channelId}`)
    const help = (
        <p className="field-help">
            Write the name with {"{count}"} where the number goes, such as Members: {"{count}"}. NeonFlux checks every
            10 minutes and renames the channel only when the name would change. It needs View channel and Manage
            channels there
        </p>
    )
    return (
        <div className="role-section">
            <ConfigForm<"counters">
                {...common}
                title="Counter channels"
                description={`Keep up to ${COUNTER_LIMIT} channels named with a live count`}
                snapshot={{ revision, values: { enabled: data.enabled } }}
                submitLabel="Save counters"
                operation={(values) => ({ type: "module", enabled: Boolean(values.enabled) })}
                fields={(values, edit, disabled) => (
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(values.enabled)}
                            disabled={disabled}
                            onChange={(event) => edit("enabled", event.target.checked)}
                        />
                        Counters on
                    </label>
                )}
            />
            {data.counters.map((row) => {
                const { card } = rowCard(common, props.removedDefinitions, `counter:${row.channelId}`)
                return (
                    <details key={row.channelId}>
                        <summary>
                            {channelName(row.channelId)}: {counted(row)}, {row.enabled ? "On" : "Off"}
                        </summary>
                        <div className="role-section">
                            {row.problem && (
                                <section className="panel" aria-label={`Status of ${channelName(row.channelId)}`}>
                                    <p>{problems[row.problem]}</p>
                                </section>
                            )}
                            {row.enabled && row.countProblem && (
                                <section className="panel" aria-label={`Status of ${channelName(row.channelId)}`}>
                                    <p>
                                        Its count cannot be read, so the channel keeps its name.{" "}
                                        {counterCountProblemText(row.countProblem)}
                                    </p>
                                </section>
                            )}
                            <ConfigForm<"counters">
                                {...card}
                                draftKey={`counter:${row.channelId}`}
                                title={`Name of ${channelName(row.channelId)}`}
                                description="Saving changes the name and turns the counter back on if NeonFlux turned it off"
                                submitLabel="Save name"
                                submitUnchanged={!row.enabled}
                                snapshot={{ revision, values: { template: row.template } }}
                                operation={(values) => ({
                                    type: "set",
                                    channelId: row.channelId,
                                    template: templateValue(values),
                                })}
                                fields={(values, edit, disabled) => (
                                    <>
                                        <label>
                                            Channel name
                                            <input
                                                value={String(values.template)}
                                                maxLength={200}
                                                disabled={disabled}
                                                onChange={(event) => edit("template", event.target.value)}
                                            />
                                        </label>
                                        {help}
                                    </>
                                )}
                            />
                            <ConfigForm<"counters">
                                {...card}
                                draftKey={`counter-remove:${row.channelId}`}
                                title={`Stop renaming ${channelName(row.channelId)}`}
                                description="The channel keeps the name it has"
                                submitLabel="Remove counter"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: { template: row.template } }}
                                operation={() => ({ type: "remove", channelId: row.channelId })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            {saved.length < COUNTER_LIMIT ? (
                <ConfigForm<"counters">
                    {...common}
                    title="Add a counter"
                    description="Choose what it counts and which channel it renames"
                    submitLabel="Add counter"
                    snapshot={{ revision, values: { kind: "members", roleId: "", channelId: "", template: "" } }}
                    operation={(values) => {
                        if (typeof values.channelId !== "string" || !values.channelId)
                            throw new FormInputError("Choose a channel for the counter")
                        if (values.kind === "role" && !values.roleId)
                            throw new FormInputError("Choose the role to count")
                        return {
                            type: "add",
                            channelId: values.channelId,
                            kind: values.kind === "role" ? "role" : "members",
                            ...(values.kind === "role" ? { roleId: String(values.roleId) } : {}),
                            template: templateValue(values),
                        }
                    }}
                    fields={(values, edit, disabled) => (
                        <>
                            <ChoiceField
                                label="Count"
                                value={String(values.kind)}
                                disabled={disabled}
                                onChange={(value) => edit("kind", value)}
                                options={[
                                    { value: "members", label: "Server members" },
                                    { value: "role", label: "Members of a role" },
                                ]}
                            />
                            {values.kind === "role" && (
                                <SearchPicker
                                    catalog
                                    label="Counted role"
                                    options={selectableRoles(props.catalog)}
                                    loading={props.catalogLoading}
                                    allowManual={props.catalogError}
                                    value={values.roleId ? [String(values.roleId)] : []}
                                    disabled={disabled}
                                    onChange={(ids) => edit("roleId", ids[0] ?? "")}
                                />
                            )}
                            <SearchPicker
                                catalog
                                label="Channel to rename"
                                options={counterChannels(props.catalog)}
                                loading={props.catalogLoading}
                                allowManual={props.catalogError}
                                value={values.channelId ? [String(values.channelId)] : []}
                                disabled={disabled}
                                onChange={(ids) => edit("channelId", ids[0] ?? "")}
                            />
                            <label>
                                Channel name
                                <input
                                    value={String(values.template)}
                                    maxLength={200}
                                    disabled={disabled}
                                    onChange={(event) => edit("template", event.target.value)}
                                />
                            </label>
                            {help}
                        </>
                    )}
                />
            ) : (
                <section className="panel">
                    <h2>Add a counter</h2>
                    <p className="muted">
                        This server has the maximum of {COUNTER_LIMIT} counters. Remove one to add another
                    </p>
                </section>
            )}
        </div>
    )
}
