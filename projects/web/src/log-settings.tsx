import { metadataEventLabel } from "@neonflux/contracts/metadata-logs"
import type {
    MetadataLogsCategory,
    MetadataLogsEventSelector,
    MetadataLogsSettings,
} from "@neonflux/contracts/metadata-logs"
import type {
    DashboardCatalog,
    DashboardMetadataOperation,
    DashboardMetadataQueueResult,
    DashboardMetadataSnapshot,
} from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "./dashboard-api"
import type { SectionProps } from "./dashboard-sections"
import { useLiveQuery } from "./live-query"
import { JobStatus } from "./job-status"
import type { FormValues } from "./settings-form"
import { QueuedForm } from "./configuration-form"
import { idValue, idsValue } from "./configuration-values"
import { SearchPicker } from "./search-picker"
import { publicationChannels } from "./catalog-options"

type LogSettingsQueue = (
    operation: DashboardMetadataOperation,
    expectedConfigRevision: number,
    requestId: string,
) => Promise<DashboardMetadataQueueResult>
export interface LogSettingsProps {
    remote: DashboardMetadataSnapshot
    queue: LogSettingsQueue
    connected: boolean
    catalog?: DashboardCatalog | undefined
    catalogLoading?: boolean | undefined
    catalogError?: boolean | undefined
    defaultOwnerId?: string | undefined
}
const groups = {
    membership: { title: "Membership", colors: ["#4ade80", "#22c55e", "#16a34a", "#15803d"] },
    resources: { title: "Resources", colors: ["#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8"] },
    messages: { title: "Messages", colors: ["#22d3ee", "#06b6d4", "#0891b2", "#0e7490"] },
    audit: { title: "Audit", colors: ["#c084fc", "#a855f7", "#9333ea", "#7e22ce"] },
    settings: { title: "Settings", colors: ["#fbbf24", "#f59e0b", "#d97706", "#b45309"] },
    operations: { title: "Operations", colors: ["#fb7f6b", "#f25d50", "#dc443c", "#b92f2d"] },
} satisfies Record<MetadataLogsCategory, { title: string; colors: string[] }>
const events = {
    "member-add": { category: "membership" },
    "member-update": { category: "membership" },
    "member-remove": { category: "membership" },
    "role-create": { category: "resources" },
    "role-update": { category: "resources" },
    "role-delete": { category: "resources" },
    "channel-create": { category: "resources" },
    "channel-update": { category: "resources" },
    "channel-delete": { category: "resources" },
    "thread-create": { category: "resources" },
    "thread-update": { category: "resources" },
    "thread-delete": { category: "resources" },
    "server-update": { category: "resources" },
    "message-update": { category: "messages" },
    "message-delete": { category: "messages" },
    "message-bulk-delete": { category: "messages" },
    "audit-entry": { category: "audit" },
    "settings-change": { category: "settings" },
    "backend-failure": { category: "operations" },
    "admission-failure": { category: "operations" },
    "delivery-failure": { category: "operations" },
    "gateway-discontinuity": { category: "operations" },
    "audit-entry:1": { category: "audit" },
    "audit-entry:10": { category: "audit" },
    "audit-entry:11": { category: "audit" },
    "audit-entry:12": { category: "audit" },
    "audit-entry:13": { category: "audit" },
    "audit-entry:14": { category: "audit" },
    "audit-entry:15": { category: "audit" },
    "audit-entry:20": { category: "audit" },
    "audit-entry:22": { category: "audit" },
    "audit-entry:23": { category: "audit" },
    "audit-entry:24": { category: "audit" },
    "audit-entry:25": { category: "audit" },
    "audit-entry:26": { category: "audit" },
    "audit-entry:27": { category: "audit" },
    "audit-entry:28": { category: "audit" },
    "audit-entry:30": { category: "audit" },
    "audit-entry:31": { category: "audit" },
    "audit-entry:32": { category: "audit" },
} satisfies Record<MetadataLogsEventSelector, { category: MetadataLogsCategory }>
const categories = Object.keys(groups) as MetadataLogsCategory[]
const eventTypes = Object.keys(events) as MetadataLogsEventSelector[]
const LogForm = QueuedForm<DashboardMetadataOperation>
function channelName(channelId: string, catalog?: DashboardCatalog): string {
    return catalog?.channels.find((channel) => channel.id === channelId)?.name ?? `Channel ${channelId}`
}
function destination(
    settings: MetadataLogsSettings,
    category: MetadataLogsCategory,
    eventType: MetadataLogsEventSelector | undefined,
    catalog?: DashboardCatalog,
): string {
    const override = eventType ? settings.eventRoutes.find((route) => route.eventType === eventType) : undefined
    const auditDefault = eventType?.startsWith("audit-entry:")
        ? settings.eventRoutes.find((route) => route.eventType === "audit-entry")
        : undefined
    const route = override ?? auditDefault ?? settings.routes.find((route) => route.category === category)
    const source = override
        ? "Event override"
        : auditDefault
          ? metadataEventLabel("audit-entry")
          : `${groups[category].title} group`
    if (!route?.enabled || !route.channelId) return `${source}: Disabled`
    return `${source}: ${channelName(route.channelId, catalog)}${settings.enabled ? "" : " (logging is disabled)"}`
}
function DestinationFields({
    values,
    edit,
    disabled,
    label,
    props,
}: {
    values: FormValues
    edit: (key: string, value: string | boolean) => void
    disabled: boolean
    label: string
    props: LogSettingsProps
}) {
    return (
        <>
            <SearchPicker
                catalog
                label={`${label} destination`}
                options={publicationChannels(props.catalog)}
                loading={props.catalogLoading}
                allowManual={props.catalogError}
                disabled={disabled}
                value={values.channelId ? [String(values.channelId)] : []}
                onChange={(selected) => edit("channelId", selected[0] ?? "")}
            />
            <label>
                {label} owner ID
                <input
                    required
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,18}"
                    maxLength={19}
                    value={String(values.ownerId)}
                    disabled={disabled}
                    onChange={(event) => edit("ownerId", event.target.value)}
                />
            </label>
            <p className="field-help">
                Use the ID of a current server Owner or Administrator with access to this destination. The running bot
                checks the owner and its own permissions before applying the route
            </p>
        </>
    )
}
function requestName(operation: DashboardMetadataOperation): string {
    if ("eventType" in operation) return metadataEventLabel(operation.eventType)
    if ("category" in operation) return `${groups[operation.category].title} group`
    return operation.type === "module" ? "Logging enabled" : "Channel filters"
}
export function LogsSection({
    client,
    sessionToken,
    serverId,
    connected,
    catalog,
    catalogLoading,
    catalogError,
}: SectionProps) {
    const { data: remote, error } = useLiveQuery(client, dashboardApi.metadataSnapshot, { sessionToken, serverId })
    return (
        <>
            {error && (
                <p role="alert" className="notice error">
                    Live logging settings are unavailable. Your draft has been kept. Refresh your sign-in before saving
                </p>
            )}
            {!remote && (
                <section className="panel">
                    <p role="status">Loading logging settings…</p>
                </section>
            )}
            {remote && (
                <LogSettings
                    remote={remote}
                    connected={connected && !error}
                    catalog={catalog}
                    catalogLoading={catalogLoading}
                    catalogError={catalogError}
                    defaultOwnerId={catalog?.ownerId}
                    queue={(operation, expectedConfigRevision, requestId) =>
                        client.action(dashboardApi.queueMetadata, {
                            sessionToken,
                            serverId,
                            requestId,
                            expectedConfigRevision,
                            operation,
                        })
                    }
                />
            )}
        </>
    )
}
export function LogSettings(props: LogSettingsProps) {
    const { settings, jobs } = props.remote
    const { configRevision: revision } = settings
    const common = { connected: props.connected, jobs, queue: props.queue }
    const picker = {
        options: publicationChannels(props.catalog),
        loading: props.catalogLoading,
        allowManual: props.catalogError,
        catalog: true,
    }
    return (
        <div className="role-section">
            <LogForm
                {...common}
                title="Channel logs"
                description="Post server events to staff channels. An event override wins over its group"
                snapshot={{ revision, values: { enabled: settings.enabled } }}
                submitLabel="Request logging change"
                operation={(values) => ({
                    type: "module",
                    expectedRevision: settings.revision,
                    enabled: Boolean(values.enabled),
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
                            Logging enabled
                        </label>
                        <p className="field-help">
                            Turning logging off keeps stored records and waiting posts. Changes apply once the bot
                            confirms them. A route that is on does not prove that posts arrive
                        </p>
                    </>
                )}
            />
            <LogForm
                {...common}
                title="Logging channel filters"
                description="Choose the channels whose message edits and deletions are logged"
                snapshot={{
                    revision,
                    values: {
                        messageChannelIds: JSON.stringify(settings.messageChannelIds),
                        excludedChannelIds: JSON.stringify(settings.excludedChannelIds),
                    },
                }}
                submitLabel="Request filter change"
                operation={(values) => ({
                    type: "channels",
                    expectedRevision: settings.revision,
                    messageChannelIds: idsValue(values.messageChannelIds, 50, "channels"),
                    excludedChannelIds: idsValue(values.excludedChannelIds, 50, "channels"),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <SearchPicker
                            {...picker}
                            label="Only log messages from these channels"
                            multiple
                            disabled={disabled}
                            value={JSON.parse(String(values.messageChannelIds)) as string[]}
                            onChange={(selected) => edit("messageChannelIds", JSON.stringify(selected))}
                        />
                        <p className="field-help">
                            Choose up to fifty channels in each list. With none chosen, no message events are logged
                        </p>
                        <SearchPicker
                            {...picker}
                            label="Never log messages from these channels"
                            multiple
                            disabled={disabled}
                            value={JSON.parse(String(values.excludedChannelIds)) as string[]}
                            onChange={(selected) => edit("excludedChannelIds", JSON.stringify(selected))}
                        />
                        <p className="field-help">
                            These lists also apply to message events that have their own override. Private channels and
                            messages from bots are never logged
                        </p>
                    </>
                )}
            />
            {categories.map((category) => {
                const group = groups[category],
                    route = settings.routes.find((route) => route.category === category)
                const values: FormValues = {
                    mode: route?.enabled ? "channel" : "disabled",
                    channelId: route?.channelId ?? "",
                    ownerId: route?.ownerId ?? props.defaultOwnerId ?? "",
                }
                return (
                    <div className="role-section" key={category}>
                        <LogForm
                            {...common}
                            title={`${group.title} group`}
                            description={`Default route for ${group.title.toLowerCase()} events. An event can override or disable this default`}
                            snapshot={{ revision, values }}
                            submitLabel={`Request ${group.title.toLowerCase()} route`}
                            operation={(values) =>
                                values.mode === "disabled"
                                    ? { type: "clear", category, expectedRevision: route?.revision ?? 1 }
                                    : {
                                          type: "route",
                                          category,
                                          expectedRevision: route?.revision ?? 1,
                                          enabled: true,
                                          channelId: idValue(values.channelId, "destination channel"),
                                          ownerId: idValue(values.ownerId, "owner ID"),
                                      }
                            }
                            fields={(values, edit, disabled) => (
                                <>
                                    <p className="field-help">
                                        Current destination: {destination(settings, category, undefined, props.catalog)}
                                    </p>
                                    <label>
                                        {group.title} group routing
                                        <select
                                            value={String(values.mode)}
                                            disabled={disabled}
                                            onChange={(event) => edit("mode", event.target.value)}
                                        >
                                            <option value="disabled">Disabled (clear group destination)</option>
                                            <option value="channel">Specific destination</option>
                                        </select>
                                    </label>
                                    {values.mode === "channel" && (
                                        <DestinationFields
                                            values={values}
                                            edit={edit}
                                            disabled={disabled}
                                            label={group.title}
                                            props={props}
                                        />
                                    )}
                                    <p className="field-help">
                                        Fixed {group.title.toLowerCase()} colors. The action title describes what
                                        happened
                                    </p>
                                    <ul aria-label={`${group.title} color legend`} className="request-list">
                                        {["Addition", "Neutral", "Change", "Deletion or failure"].map(
                                            (label, index) => (
                                                <li key={label}>
                                                    <span
                                                        aria-hidden="true"
                                                        style={{
                                                            display: "inline-block",
                                                            width: 14,
                                                            height: 14,
                                                            marginRight: 8,
                                                            backgroundColor: group.colors[index],
                                                            borderRadius: 3,
                                                        }}
                                                    />
                                                    {label}
                                                </li>
                                            ),
                                        )}
                                    </ul>
                                </>
                            )}
                        />
                        <details>
                            <summary>{group.title} event overrides</summary>
                            <div className="role-section">
                                {eventTypes
                                    .filter((eventType) => events[eventType].category === category)
                                    .map((eventType) => {
                                        const override = settings.eventRoutes.find(
                                                (route) => route.eventType === eventType,
                                            ),
                                            title = metadataEventLabel(eventType)
                                        const values: FormValues = {
                                            mode: !override ? "inherit" : override.enabled ? "channel" : "disabled",
                                            channelId: override?.channelId ?? "",
                                            ownerId: override?.ownerId ?? props.defaultOwnerId ?? "",
                                        }
                                        const auditAction = eventType.startsWith("audit-entry:")
                                        return (
                                            <LogForm
                                                {...common}
                                                key={eventType}
                                                title={title}
                                                description={`${auditAction ? `An override here wins over ${metadataEventLabel("audit-entry")} and the audit group` : eventType === "audit-entry" ? "Sets where audit actions without their own override post" : `An override here wins over the ${group.title.toLowerCase()} group`}. Chat commands take this name or the code ${eventType}`}
                                                snapshot={{ revision, values }}
                                                submitLabel={`Request ${title.toLowerCase()} change`}
                                                operation={(values) =>
                                                    values.mode === "inherit"
                                                        ? {
                                                              type: "event-clear",
                                                              eventType,
                                                              expectedRevision: settings.configRevision,
                                                          }
                                                        : values.mode === "disabled"
                                                          ? {
                                                                type: "event-route",
                                                                eventType,
                                                                expectedRevision: settings.configRevision,
                                                                enabled: false,
                                                            }
                                                          : {
                                                                type: "event-route",
                                                                eventType,
                                                                expectedRevision: settings.configRevision,
                                                                enabled: true,
                                                                channelId: idValue(
                                                                    values.channelId,
                                                                    "destination channel",
                                                                ),
                                                                ownerId: idValue(values.ownerId, "owner ID"),
                                                            }
                                                }
                                                fields={(values, edit, disabled) => (
                                                    <>
                                                        <p className="field-help">
                                                            Current destination:{" "}
                                                            {destination(settings, category, eventType, props.catalog)}
                                                        </p>
                                                        <label>
                                                            {title} routing
                                                            <select
                                                                value={String(values.mode)}
                                                                disabled={disabled}
                                                                onChange={(event) => edit("mode", event.target.value)}
                                                            >
                                                                <option value="inherit">
                                                                    {auditAction
                                                                        ? `Inherit ${metadataEventLabel("audit-entry")}`
                                                                        : "Inherit group"}
                                                                </option>
                                                                <option value="disabled">Disable this event</option>
                                                                <option value="channel">Specific destination</option>
                                                            </select>
                                                        </label>
                                                        {values.mode === "channel" && (
                                                            <DestinationFields
                                                                values={values}
                                                                edit={edit}
                                                                disabled={disabled}
                                                                label={title}
                                                                props={props}
                                                            />
                                                        )}
                                                        <p className="field-help">
                                                            {auditAction
                                                                ? `Inherit follows ${metadataEventLabel("audit-entry")}, then the audit group`
                                                                : "Inherit removes this event's override"}
                                                            . Disable stops this event from posting even when the route
                                                            it would inherit is on
                                                        </p>
                                                    </>
                                                )}
                                            />
                                        )
                                    })}
                            </div>
                        </details>
                    </div>
                )
            })}
            <section className="panel">
                <h2>Recent logging requests</h2>
                {jobs.length ? (
                    <ul className="request-list">
                        {jobs.map((job) => (
                            <li key={job.id}>
                                <strong>{requestName(job.operation)}</strong>:{" "}
                                <JobStatus state={job.state} error={job.error} />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="muted">No recent logging requests</p>
                )}
                <p className="field-help">
                    Logs keep a limited set of supported events without message text, so they are not a complete
                    history. Who made a change is shown only when a supported audit log entry names them. Otherwise it
                    stays unknown
                </p>
                <p className="field-help">
                    Member departures have an unknown cause. Audit actions keep their own names and color shades. An
                    audit action's override wins over {metadataEventLabel("audit-entry")}, then the audit group
                </p>
            </section>
        </div>
    )
}
