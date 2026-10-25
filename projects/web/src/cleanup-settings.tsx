import { ConfigForm, ConfigurationPages, rowCard } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { CLEANUP_EXCLUSIONS_PER_LIST, CLEANUP_SERVER_EXCLUSIONS } from "@neonflux/contracts/cleanup"
import { ChoiceField, IdList, NumberField } from "./configuration-fields"
import { idValue, numberValue } from "./configuration-values"
import { FormInputError } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { publicationChannels } from "./catalog-options"

const ageUnits: Record<string, number> = {
    days: 86400000,
    hours: 3600000,
    minutes: 60000,
    seconds: 1000,
    milliseconds: 1,
}
function ageDraft(ageMs: number) {
    const unit = Object.keys(ageUnits).find((unit) => ageMs % ageUnits[unit]! === 0) ?? "milliseconds"
    return { age: String(ageMs / ageUnits[unit]!), ageUnit: unit }
}
function ageValue(values: Record<string, string | boolean>) {
    const multiplier = ageUnits[String(values.ageUnit)]
    if (!multiplier) throw new FormInputError("Choose a message age unit")
    const ageMs = numberValue(values.age, 1, 31536000000, "minimum message age") * multiplier
    if (!Number.isSafeInteger(ageMs) || ageMs < 3600000 || ageMs > 31536000000)
        throw new FormInputError("Choose a minimum message age from one hour to 365 days")
    return ageMs
}

/** The IDs of an exclusion list. An entry that is not an ID stays in the form to correct */
function exclusionIds(value: string | boolean | undefined, label: string) {
    const ids = (JSON.parse(String(value || "[]")) as string[]).map((id) => idValue(id, label))
    if (ids.length > CLEANUP_EXCLUSIONS_PER_LIST || new Set(ids).size !== ids.length)
        throw new FormInputError(
            `Keep up to ${CLEANUP_EXCLUSIONS_PER_LIST.toLocaleString("en-US")} distinct entries in each exclusion list`,
        )
    return ids
}

export function CleanupSettings(props: ConfigSectionProps<"cleanup">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const ageFields = (
        values: Record<string, string | boolean>,
        edit: (key: string, value: string | boolean) => void,
        disabled: boolean,
    ) => (
        <>
            <NumberField
                label="Minimum message age"
                value={String(values.age)}
                onChange={(value) => edit("age", value)}
                disabled={disabled}
                min={Math.ceil(3600000 / ageUnits[String(values.ageUnit)]!)}
                max={Math.floor(31536000000 / ageUnits[String(values.ageUnit)]!)}
            />
            <ChoiceField
                label="Message age unit"
                value={String(values.ageUnit)}
                onChange={(value) => {
                    const oldMs = Number(values.age) * ageUnits[String(values.ageUnit)]!,
                        next = oldMs / ageUnits[value]!
                    edit("ageUnit", value)
                    edit("age", String(next))
                }}
                disabled={disabled}
                options={Object.keys(ageUnits).map((value) => ({
                    value,
                    label: value[0]!.toUpperCase() + value.slice(1),
                }))}
            />
            <p className="field-help">
                Allowed age: One hour to 365 days. Choose a whole-number amount in the selected unit. Exact saved ages
                use the smallest required unit
            </p>
            <label>
                Cleanup action owner ID
                <input
                    required
                    inputMode="numeric"
                    maxLength={19}
                    value={String(values.ownerId)}
                    disabled={disabled}
                    onChange={(event) => edit("ownerId", event.target.value)}
                />
            </label>
        </>
    )
    return (
        <div className="role-section">
            <ConfigForm<"cleanup">
                {...common}
                title="Cleanup"
                description="Configure automatic message cleanup. Policy actions require an Owner or Administrator and current channel permissions"
                snapshot={{ revision, values: { enabled: data.settings.enabled } }}
                operation={(values) => ({
                    type: "module",
                    expectedRevision: data.settings.revision,
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
                        Cleanup enabled
                    </label>
                )}
            />
            <ConfigForm<"cleanup">
                {...common}
                title="Create cleanup policy"
                description="New policies start disabled. Configure exclusions before enabling deletion"
                resetAfterApplied
                snapshot={{
                    revision,
                    values: { channelId: "", ...ageDraft(86400000), ownerId: props.defaultOwnerId ?? "" },
                }}
                operation={(values) => ({
                    type: "configure",
                    channelId: idValue(values.channelId, "cleanup channel"),
                    expectedRevision: 0,
                    ageMs: ageValue(values),
                    ownerId: idValue(values.ownerId, "cleanup action owner ID"),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <SearchPicker
                            catalog
                            label="New cleanup channel"
                            options={publicationChannels(props.catalog)}
                            loading={props.catalogLoading}
                            allowManual={props.catalogError}
                            value={values.channelId ? [String(values.channelId)] : []}
                            disabled={disabled}
                            onChange={(ids) => edit("channelId", ids[0] ?? "")}
                        />
                        {ageFields(values, edit, disabled)}
                    </>
                )}
            />
            {data.policies.map((policy) => {
                const { missing, card } = rowCard(common, props.removedDefinitions, policy.channelId)
                return (
                    <details key={policy.channelId}>
                        <summary>
                            {props.catalog?.channels.find((channel) => channel.id === policy.channelId)?.name ??
                                policy.channelId}
                            : {policy.enabled ? "Enabled" : "Disabled"}
                        </summary>
                        <div className="role-section">
                            {missing && (
                                <p className="notice" role="status">
                                    Not in loaded pages. This draft is kept for copying. Load remaining pages to check
                                    whether it moved
                                </p>
                            )}
                            <ConfigForm<"cleanup">
                                {...card}
                                title={`Cleanup policy ${policy.channelId}`}
                                description="Age and ownership changes apply to future cleanup work"
                                snapshot={{ revision, values: { ...ageDraft(policy.ageMs), ownerId: policy.ownerId } }}
                                operation={(values) => ({
                                    type: "configure",
                                    channelId: policy.channelId,
                                    expectedRevision: policy.revision,
                                    ageMs: ageValue(values),
                                    ownerId: idValue(values.ownerId, "cleanup action owner ID"),
                                })}
                                fields={ageFields}
                            />
                            <ConfigForm<"cleanup">
                                {...card}
                                title={`Enable cleanup ${policy.channelId}`}
                                description="Enabling authorizes deletion of eligible old messages in the channel and its active threads. Pinned, protected and excluded messages stay protected"
                                snapshot={{
                                    revision,
                                    values: { enabled: policy.enabled, confirm: false },
                                    context: policy.revision,
                                }}
                                operation={(values) => {
                                    if (values.enabled && !values.confirm)
                                        throw new FormInputError("Confirm deletion before enabling cleanup")
                                    return {
                                        type: "enable",
                                        channelId: policy.channelId,
                                        expectedRevision: policy.revision,
                                        enabled: Boolean(values.enabled),
                                        ...(values.enabled ? { confirm: true } : {}),
                                    }
                                }}
                                fields={(values, edit, disabled) => (
                                    <>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(values.enabled)}
                                                disabled={disabled}
                                                onChange={(event) => edit("enabled", event.target.checked)}
                                            />
                                            Channel cleanup enabled
                                        </label>
                                        {Boolean(values.enabled) && (
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(values.confirm)}
                                                    disabled={disabled}
                                                    onChange={(event) => edit("confirm", event.target.checked)}
                                                />
                                                Confirm automatic message deletion
                                            </label>
                                        )}
                                    </>
                                )}
                            />
                            <ConfigForm<"cleanup">
                                {...card}
                                title={`Cleanup exclusions ${policy.channelId}`}
                                description={`Messages by these authors and these messages are never deleted. Paste many IDs at once, apart or split by commas or lines, replace the list or remove all. Each list keeps up to ${CLEANUP_EXCLUSIONS_PER_LIST}, and the server up to ${CLEANUP_SERVER_EXCLUSIONS} across its cleanup channels`}
                                snapshot={{
                                    revision,
                                    values: {
                                        authors: JSON.stringify(policy.excludedAuthorIds),
                                        messages: JSON.stringify(policy.excludedMessageIds),
                                    },
                                    context: policy.revision,
                                }}
                                operation={(values) => ({
                                    type: "exclusions",
                                    channelId: policy.channelId,
                                    expectedRevision: policy.revision,
                                    excludedAuthorIds: exclusionIds(values.authors, "excluded author ID"),
                                    excludedMessageIds: exclusionIds(values.messages, "excluded message ID"),
                                })}
                                fields={(values, edit, disabled) => (
                                    <>
                                        <IdList
                                            label="Excluded authors"
                                            value={String(values.authors)}
                                            onChange={(value) => edit("authors", value)}
                                            disabled={disabled}
                                            max={CLEANUP_EXCLUSIONS_PER_LIST}
                                        />
                                        <IdList
                                            label="Excluded messages"
                                            value={String(values.messages)}
                                            onChange={(value) => edit("messages", value)}
                                            disabled={disabled}
                                            max={CLEANUP_EXCLUSIONS_PER_LIST}
                                        />
                                    </>
                                )}
                            />
                            <ConfigForm<"cleanup">
                                {...card}
                                title={`Delete inactive policy ${policy.channelId}`}
                                description="Disable the policy first. Pending or unresolved deletion evidence prevents removal and stays retained"
                                submitUnchanged={!policy.enabled}
                                snapshot={{ revision, values: {}, context: policy.revision }}
                                submitLabel="Delete inactive policy"
                                operation={() => ({
                                    type: "policy-delete",
                                    channelId: policy.channelId,
                                    expectedRevision: policy.revision,
                                    confirm: true,
                                })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            <ConfigurationPages
                nextCursors={props.remote.nextCursors}
                loadPage={props.loadPage}
                loading={props.loadingPage}
            />
        </div>
    )
}
