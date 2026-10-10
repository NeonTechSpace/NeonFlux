import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { AccessForm, NumberField } from "./configuration-fields"
import { numberValue } from "./configuration-values"
import { SearchPicker } from "./search-picker"
import { publicationChannels } from "./catalog-options"

const optionalNumber = (value: string | boolean | undefined, min: number, max: number, label: string) =>
    typeof value === "string" && value.trim() ? numberValue(value.trim(), min, max, label) : null

export function ShowcaseSettings(props: ConfigSectionProps<"showcase">) {
    const {
        data: { settings, access },
        configRevision: revision,
        jobs,
    } = props.remote
    return (
        <div className="role-section">
            <ConfigForm<"showcase">
                queue={props.queue}
                connected={props.connected}
                jobs={jobs}
                title="Showcases"
                description="Members post a title, text and up to three links on this website, and NeonFlux posts each one as an embed in the showcase channel. The server's automod word, domain, invite and deceptive link rules check every post and edit. The chat command !showcase changes the same settings"
                snapshot={{
                    revision,
                    values: {
                        enabled: settings.enabled,
                        channelId: settings.channelId ?? "",
                        maxPerMember: settings.maxPerMember === null ? "" : String(settings.maxPerMember),
                        intervalMinutes: settings.intervalMinutes === null ? "" : String(settings.intervalMinutes),
                    },
                }}
                operation={(values) => ({
                    type: "settings",
                    enabled: Boolean(values.enabled),
                    channelId: typeof values.channelId === "string" && values.channelId ? values.channelId : null,
                    maxPerMember: optionalNumber(values.maxPerMember, 1, 50, "a limit of 1 to 50 showcases"),
                    intervalMinutes: optionalNumber(values.intervalMinutes, 1, 10080, "a wait of 1 to 10080 minutes"),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            <input
                                type="checkbox"
                                checked={Boolean(values.enabled)}
                                disabled={disabled}
                                onChange={(event) => edit("enabled", event.target.checked)}
                            />
                            Showcases enabled
                        </label>
                        <SearchPicker
                            catalog
                            label="Showcase channel"
                            options={publicationChannels(props.catalog)}
                            loading={props.catalogLoading}
                            allowManual={props.catalogError}
                            value={values.channelId ? [String(values.channelId)] : []}
                            disabled={disabled}
                            onChange={(next) => edit("channelId", next[0] ?? "")}
                        />
                        <p className="field-help">
                            NeonFlux needs View channel, Send messages and Embed links there. Existing showcases stay in
                            the channel they were posted in
                        </p>
                        <NumberField
                            label="Showcases per member"
                            value={String(values.maxPerMember)}
                            min={1}
                            max={50}
                            disabled={disabled}
                            required={false}
                            onChange={(value) => edit("maxPerMember", value)}
                        />
                        <p className="field-help">Leave empty for no limit. Only showcases that still exist count</p>
                        <NumberField
                            label="Minutes between a member's showcases"
                            value={String(values.intervalMinutes)}
                            min={1}
                            max={10080}
                            disabled={disabled}
                            required={false}
                            onChange={(value) => edit("intervalMinutes", value)}
                        />
                        <p className="field-help">
                            Leave empty for no wait. The wait counts from the member's newest showcase that still exists
                        </p>
                    </>
                )}
            />
            <AccessForm<"showcase"> {...props} access={access} what="post showcases" />
        </div>
    )
}

export function ProfileSettings(props: ConfigSectionProps<"profile">) {
    const {
        data: { settings, access },
        configRevision: revision,
        jobs,
    } = props.remote
    return (
        <div className="role-section">
            <ConfigForm<"profile">
                queue={props.queue}
                connected={props.connected}
                jobs={jobs}
                title="Profiles"
                description="Members write a short bio, add up to three links and pick an accent color on this website. !profile shows a member's profile as an embed, and the server's automod word, domain, invite and deceptive link rules check it. The chat command !profile changes the same settings"
                snapshot={{
                    revision,
                    values: {
                        enabled: settings.enabled,
                        cooldownSeconds: settings.cooldownSeconds === null ? "" : String(settings.cooldownSeconds),
                    },
                }}
                operation={(values) => ({
                    type: "settings",
                    enabled: Boolean(values.enabled),
                    cooldownSeconds: optionalNumber(values.cooldownSeconds, 1, 3600, "a cooldown of 1 to 3600 seconds"),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            <input
                                type="checkbox"
                                checked={Boolean(values.enabled)}
                                disabled={disabled}
                                onChange={(event) => edit("enabled", event.target.checked)}
                            />
                            Profiles enabled
                        </label>
                        <NumberField
                            label="Seconds between a member's !profile commands"
                            value={String(values.cooldownSeconds)}
                            min={1}
                            max={3600}
                            disabled={disabled}
                            required={false}
                            onChange={(value) => edit("cooldownSeconds", value)}
                        />
                        <p className="field-help">Leave empty for no cooldown</p>
                    </>
                )}
            />
            <AccessForm<"profile"> {...props} access={access} what="use profiles" />
        </div>
    )
}
