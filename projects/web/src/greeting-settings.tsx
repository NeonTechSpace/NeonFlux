import type { GreetingsRoute } from "@neonflux/contracts/greetings"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { ChoiceField, NumberField, TemplatePicker } from "./configuration-fields"
import { idValue, numberValue, templateValue } from "./configuration-values"
import { SearchPicker } from "./search-picker"
import { publicationChannels } from "./catalog-options"
const routeLabels = { welcome: "Channel welcome", dm: "Direct-message welcome", goodbye: "Goodbye" }
export function GreetingSettings(props: ConfigSectionProps<"greetings">) {
    const { data, configRevision: revision, jobs } = props.remote,
        { settings } = data,
        common = { queue: props.queue, connected: props.connected, jobs }
    const templates = {
        templates: props.templates,
        loading: props.templatesLoading,
        error: props.templatesError,
        loadMore: props.loadTemplatesPage,
        hasMore: props.templatesHasMore,
    }
    return (
        <div className="role-section">
            <ConfigForm<"greetings">
                {...common}
                title="Greeting limits"
                description="Set the shared delivery rate and history retention for all three routes"
                snapshot={{
                    revision,
                    values: {
                        claimsPerMinute: String(settings.claimsPerMinute),
                        retentionDays: String(settings.retentionDays),
                    },
                }}
                operation={(values) => ({
                    type: "settings",
                    claimsPerMinute: numberValue(values.claimsPerMinute, 1, 60, "greeting claims per minute"),
                    retentionDays: numberValue(values.retentionDays, 30, 3650, "greeting retention days"),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <NumberField
                            label="Greeting claims per minute"
                            value={String(values.claimsPerMinute)}
                            onChange={(value) => edit("claimsPerMinute", value)}
                            disabled={disabled}
                            min={1}
                            max={60}
                        />
                        <NumberField
                            label="Greeting history retention (days)"
                            value={String(values.retentionDays)}
                            onChange={(value) => edit("retentionDays", value)}
                            disabled={disabled}
                            min={30}
                            max={3650}
                        />
                    </>
                )}
            />
            {(["welcome", "dm", "goodbye"] as GreetingsRoute[]).map((route) => {
                const current = settings.routes[route],
                    title = routeLabels[route]
                return (
                    <details key={route}>
                        <summary>
                            {title}: {current.enabled ? "Enabled" : "Disabled"}
                        </summary>
                        <div className="role-section">
                            <ConfigForm<"greetings">
                                {...common}
                                title={`${title} enabled`}
                                description="This switch controls future greeting admissions for the configured route"
                                snapshot={{ revision, values: { enabled: current.enabled } }}
                                operation={(values) => ({ type: "module", route, enabled: Boolean(values.enabled) })}
                                fields={(values, edit, disabled) => (
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(values.enabled)}
                                            disabled={disabled}
                                            onChange={(event) => edit("enabled", event.target.checked)}
                                        />
                                        {title} enabled
                                    </label>
                                )}
                            />
                            <ConfigForm<"greetings">
                                {...common}
                                title={`${title} route`}
                                description="Choose the saved template version this route uses"
                                snapshot={{
                                    revision,
                                    values: {
                                        source:
                                            current.templateName && current.templateRevision
                                                ? JSON.stringify({
                                                      kind: "template",
                                                      name: current.templateName,
                                                      revision: current.templateRevision,
                                                  })
                                                : "",
                                        channelId: current.channelId ?? "",
                                        timing: current.timing,
                                    },
                                }}
                                operation={(values) => {
                                    const source = templateValue(values.source)
                                    return {
                                        type: "configure",
                                        route,
                                        templateName: source.name,
                                        expectedTemplateRevision: source.revision,
                                        ...(route === "dm"
                                            ? {}
                                            : { channelId: idValue(values.channelId, "greeting channel") }),
                                        ...(route === "goodbye"
                                            ? {}
                                            : { timing: values.timing as "join" | "verified" }),
                                    }
                                }}
                                fields={(values, edit, disabled) => (
                                    <>
                                        <TemplatePicker
                                            {...templates}
                                            label={`${title} template`}
                                            value={String(values.source)}
                                            onChange={(value) => edit("source", value)}
                                            disabled={disabled}
                                        />
                                        {route !== "dm" && (
                                            <SearchPicker
                                                catalog
                                                label={`${title} channel`}
                                                options={publicationChannels(props.catalog)}
                                                loading={props.catalogLoading}
                                                allowManual={props.catalogError}
                                                value={values.channelId ? [String(values.channelId)] : []}
                                                onChange={(ids) => edit("channelId", ids[0] ?? "")}
                                                disabled={disabled}
                                            />
                                        )}
                                        {route !== "goodbye" && (
                                            <ChoiceField
                                                label={`${title} timing`}
                                                value={String(values.timing)}
                                                onChange={(value) => edit("timing", value)}
                                                disabled={disabled}
                                                options={[
                                                    { value: "join", label: "On join" },
                                                    { value: "verified", label: "After verification" },
                                                ]}
                                            />
                                        )}
                                        <p className="field-help">
                                            Greeting text placeholders:{" "}
                                            {"{user.name}, {user.mention}, {user.id}, {server.name}, {server.id}"}
                                            {route !== "dm" && ", {channel.id}"}
                                        </p>
                                    </>
                                )}
                            />
                            <ConfigForm<"greetings">
                                {...common}
                                title={`Clear ${title.toLowerCase()}`}
                                description="Disable the route and remove its configured template snapshot"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: current }}
                                submitLabel="Clear greeting route"
                                operation={() => ({ type: "clear", route })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
        </div>
    )
}
