import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import {
    VOICE_GENERATOR_LIMIT,
    VOICE_ROOM_LIMIT,
    isVoiceChannelName,
    isVoiceRegion,
    isVoiceTemplate,
} from "@neonflux/contracts/voice"
import { useEffect, useRef } from "react"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { NumberField } from "./configuration-fields"
import { idValue, numberValue } from "./configuration-values"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"

const categories = (catalog?: DashboardCatalog) => catalog?.channels.filter((channel) => channel.type === 4) ?? []
function channelName(value: string | boolean | undefined) {
    const parsed = typeof value === "string" ? value.trim() : ""
    if (!isVoiceChannelName(parsed)) throw new FormInputError("Use a generator name with 1 to 100 characters")
    return parsed
}
function templateValue(value: string | boolean | undefined) {
    const parsed = typeof value === "string" ? value.trim() : ""
    if (!isVoiceTemplate(parsed))
        throw new FormInputError("Use a room name template with 1 to 100 characters and only the {owner} placeholder")
    return parsed
}
const limitValue = (value: string | boolean | undefined) =>
    typeof value === "string" && value.trim() ? numberValue(value, 1, 99, "default member limit") : null
function regionValue(value: string | boolean | undefined) {
    const parsed = typeof value === "string" ? value.trim() : ""
    if (!parsed) return null
    if (!isVoiceRegion(parsed))
        throw new FormInputError(
            "Leave the region empty for automatic routing, or enter a region ID of up to 64 letters, digits, dots, underscores or hyphens",
        )
    return parsed
}
const categoryValue = (value: string | boolean | undefined) =>
    typeof value === "string" && value ? idValue(value, "room category") : null

export function VoiceSettings(props: ConfigSectionProps<"voice"> & { refreshCatalog?: (() => void) | undefined }) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs },
        saved = savedRows(data.generators, props.removedDefinitions, (generator) => `generator:${generator.channelId}`)
    const nameOf = (id: string) => props.catalog?.channels.find((channel) => channel.id === id)?.name
    // Channel names come from the channel list loaded with the dashboard. A generator created or renamed after that,
    // from the dashboard or from chat, reloads the list once so its current name shows instead of its ID
    const signature = data.generators.map((generator) => `${generator.channelId}:${generator.revision}`).join(","),
        shown = useRef(signature),
        refreshed = useRef<string | undefined>(undefined)
    const ready = Boolean(props.catalog) && !props.catalogLoading,
        missing = ready && data.generators.some((generator) => !nameOf(generator.channelId))
    const refreshCatalog = props.refreshCatalog
    useEffect(() => {
        if (!ready || refreshed.current === signature || (!missing && shown.current === signature)) return
        refreshed.current = signature
        shown.current = signature
        refreshCatalog?.()
    }, [ready, missing, signature, refreshCatalog])
    const label = (id: string) =>
        nameOf(id) ??
        (props.catalogLoading
            ? "Loading channel name"
            : !props.catalog
              ? `Channel ${id}`
              : refreshed.current === signature
                ? `Unavailable channel ${id}`
                : "Loading channel name")
    const fields = (
        values: FormValues,
        edit: (key: string, value: string | boolean) => void,
        disabled: boolean,
        label: string,
    ) => (
        <>
            <label>
                {label}
                <input
                    required
                    maxLength={100}
                    value={String(values.channelName)}
                    disabled={disabled}
                    onChange={(event) => edit("channelName", event.target.value)}
                />
            </label>
            <SearchPicker
                catalog
                label="Room category"
                options={categories(props.catalog)}
                loading={props.catalogLoading}
                allowManual={props.catalogError}
                value={values.categoryId ? [String(values.categoryId)] : []}
                disabled={disabled}
                onChange={(ids) => edit("categoryId", ids[0] ?? "")}
            />
            <label>
                Room name template
                <input
                    required
                    maxLength={100}
                    value={String(values.template)}
                    disabled={disabled}
                    onChange={(event) => edit("template", event.target.value)}
                />
            </label>
            <NumberField
                label="Default member limit"
                value={String(values.userLimit)}
                min={1}
                max={99}
                disabled={disabled}
                required={false}
                onChange={(value) => edit("userLimit", value)}
            />
            <label>
                Voice region
                <input
                    maxLength={64}
                    value={String(values.region)}
                    disabled={disabled}
                    onChange={(event) => edit("region", event.target.value)}
                />
            </label>
            <p className="field-help">
                Leave the category empty for top-level rooms, the limit empty for no limit and the region empty for
                automatic routing. {"{owner}"} becomes the room owner's name
            </p>
        </>
    )
    return (
        <div className="role-section">
            <section className="panel">
                <h2>Temporary voice rooms</h2>
                <p className="muted">
                    Generators {saved.length}/{VOICE_GENERATOR_LIMIT}, live rooms {data.rooms}/{VOICE_ROOM_LIMIT}.
                    Members who join a generator get their own room, which NeonFlux deletes after it has been empty for
                    45 seconds
                </p>
            </section>
            <ConfigForm<"voice">
                {...common}
                title="Add generator"
                description="NeonFlux creates a new voice channel and uses it as a generator"
                resetAfterApplied
                submitLabel="Add generator"
                submitUnchanged
                snapshot={{
                    revision,
                    values: {
                        channelName: "Join to create",
                        categoryId: "",
                        template: "{owner}'s room",
                        userLimit: "",
                        region: "",
                    },
                }}
                operation={(values) => {
                    if (saved.length >= VOICE_GENERATOR_LIMIT)
                        throw new FormInputError(
                            `A server can have at most ${VOICE_GENERATOR_LIMIT} generators. Remove one first`,
                        )
                    return {
                        type: "generator-add",
                        channelName: channelName(values.channelName),
                        categoryId: categoryValue(values.categoryId),
                        template: templateValue(values.template),
                        userLimit: limitValue(values.userLimit),
                        region: regionValue(values.region),
                    }
                }}
                fields={(values, edit, disabled) => fields(values, edit, disabled, "New generator name")}
            />
            {data.generators.map((generator) => {
                const name = nameOf(generator.channelId)
                const { card } = rowCard(common, props.removedDefinitions, `generator:${generator.channelId}`)
                return (
                    <details key={generator.channelId}>
                        <summary>{label(generator.channelId)}</summary>
                        <div className="role-section">
                            <ConfigForm<"voice">
                                {...card}
                                draftKey={`generator:${generator.channelId}`}
                                title={`Generator ${name ?? generator.channelId}`}
                                description="Room settings apply to rooms created after saving. A new name renames the generator channel"
                                snapshot={{
                                    revision,
                                    values: {
                                        channelName: name ?? "",
                                        categoryId: generator.categoryId ?? "",
                                        template: generator.template,
                                        userLimit: generator.userLimit === null ? "" : String(generator.userLimit),
                                        region: generator.region ?? "",
                                    },
                                }}
                                operation={(values) => {
                                    const renamed =
                                        typeof values.channelName === "string" &&
                                        values.channelName.trim() &&
                                        values.channelName.trim() !== name
                                            ? { channelName: channelName(values.channelName) }
                                            : {}
                                    return {
                                        type: "generator-set",
                                        channelId: generator.channelId,
                                        expectedRevision: generator.revision,
                                        patch: {
                                            ...renamed,
                                            categoryId: categoryValue(values.categoryId),
                                            template: templateValue(values.template),
                                            userLimit: limitValue(values.userLimit),
                                            region: regionValue(values.region),
                                        },
                                    }
                                }}
                                fields={(values, edit, disabled) => fields(values, edit, disabled, "Generator name")}
                            />
                            <ConfigForm<"voice">
                                {...card}
                                draftKey={`generator-remove:${generator.channelId}`}
                                title={`Remove generator ${name ?? generator.channelId}`}
                                description="The channel stays as an ordinary voice channel. Existing rooms are still deleted once they are empty"
                                submitLabel="Remove generator"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: generator.revision }}
                                operation={() => ({
                                    type: "generator-remove",
                                    channelId: generator.channelId,
                                    expectedRevision: generator.revision,
                                })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
        </div>
    )
}
