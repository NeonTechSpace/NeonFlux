import type { ConvexReactClient } from "convex/react"
import type { ComponentType } from "react"
import { useEffect, useState } from "react"
import type {
    DashboardCatalog,
    DashboardConfigurationFamily,
    DashboardConfigurationOperationMap,
    DashboardConfigurationRequest,
    DashboardConfigurationSnapshot,
    DashboardTemplatesView,
} from "@neonflux/backend/dashboard-contracts"
import type { ConfigSectionProps, ConfigurationQueue, TemplateOption } from "./configuration-form"
import { dashboardApi } from "./dashboard-api"
import { lazyComponents } from "./dashboard-sections"
import type { SectionProps } from "./dashboard-sections"
import { identitiesOf, PAGE_WINDOW, useConfigurationState } from "./configuration-live"
import { clearRowDrafts, hasRowDraft, useDraftScope, useDraftVersion } from "./drafts"
import { JobStatus } from "./job-status"
import { preserveRemovedDefinitions } from "./configuration-retained"

const configurationSections = {
    custom: { family: "responses", title: "Custom commands" },
    auto: { family: "responses", title: "Autoresponders" },
    moderation: { family: "moderation", title: "Moderation and safety" },
    publishing: { family: "publishing", title: "Drafts and templates" },
    greetings: { family: "greetings", title: "Greetings" },
    tickets: { family: "tickets", title: "Tickets" },
    leveling: { family: "leveling", title: "Leveling" },
    milestones: { family: "milestones", title: "Milestones" },
    suggestions: { family: "suggestions", title: "Suggestions" },
    cleanup: { family: "cleanup", title: "Message cleanup" },
    events: { family: "events", title: "Events" },
    schedules: { family: "schedules", title: "Schedules" },
    voice: { family: "voice", title: "Temporary voice" },
    lfg: { family: "lfg", title: "Looking for group" },
    rolepicker: { family: "rolepicker", title: "Role picker" },
    temproles: { family: "temproles", title: "Temporary roles" },
    onboarding: { family: "onboarding", title: "Newcomer checklist" },
    presets: { family: "presets", title: "Setup presets" },
    sticky: { family: "sticky", title: "Sticky messages" },
    sidebar: { family: "sidebar", title: "Dashboard link" },
    memberlist: { family: "memberlist", title: "Member list order" },
    alerts: { family: "alerts", title: "Security alerts" },
    helpdesk: { family: "helpdesk", title: "Help desk" },
} satisfies Record<string, { family: DashboardConfigurationFamily; title: string }>
type ConfigurationSectionId = keyof typeof configurationSections
interface ConfigurationSectionProps {
    section: ConfigurationSectionId
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    /** The signed-in user, so owner-only settings can say who may change them */
    userId?: string | undefined
    connected: boolean
    catalog?: DashboardCatalog | undefined
    catalogLoading: boolean
    catalogError: boolean
    templates?: TemplateOption[] | undefined
    templatesLoading?: boolean | undefined
    templatesError?: boolean | undefined
    templatesHasMore?: boolean | undefined
    loadTemplatesPage?: (() => void) | undefined
    refreshCatalog?: (() => void) | undefined
}
type SectionFamily = (typeof configurationSections)[ConfigurationSectionId]["family"]
type Form = ComponentType<
    ConfigSectionProps<SectionFamily> & { kind: "auto" | "custom"; refreshCatalog?: (() => void) | undefined }
>
const form = <C,>(component: C) => component as unknown as Form
// Each family's form loads with its section the first time it opens, so a section never loads the code of the others. Each form
// receives its own family's snapshot. Responses read kind, and voice and member list order read refreshCatalog
const forms = lazyComponents<SectionFamily, Form>({
    responses: () => import("./response-settings").then((module) => form(module.ResponseSettings)),
    moderation: () => import("./safety-settings").then((module) => form(module.SafetySettings)),
    publishing: () => import("./publishing-settings").then((module) => form(module.PublishingSettings)),
    greetings: () => import("./greeting-settings").then((module) => form(module.GreetingSettings)),
    tickets: () => import("./ticket-settings").then((module) => form(module.TicketSettings)),
    leveling: () => import("./community-settings").then((module) => form(module.LevelingSettings)),
    milestones: () => import("./community-settings").then((module) => form(module.MilestoneSettings)),
    suggestions: () => import("./community-settings").then((module) => form(module.SuggestionSettings)),
    cleanup: () => import("./cleanup-settings").then((module) => form(module.CleanupSettings)),
    events: () => import("./calendar-settings").then((module) => form(module.EventSettings)),
    schedules: () => import("./calendar-settings").then((module) => form(module.ScheduleSettings)),
    voice: () => import("./voice-settings").then((module) => form(module.VoiceSettings)),
    rolepicker: () => import("./role-picker-settings").then((module) => form(module.RolePickerSettings)),
    sticky: () => import("./sticky-settings").then((module) => form(module.StickySettings)),
    sidebar: () => import("./sidebar-settings").then((module) => form(module.SidebarSettings)),
    memberlist: () => import("./memberlist-settings").then((module) => form(module.MemberListSettings)),
    temproles: () => import("./temporary-role-settings").then((module) => form(module.TemporaryRoleSettings)),
    alerts: () => import("./alerts-settings").then((module) => form(module.AlertsSettings)),
    helpdesk: () => import("./helpdesk-settings").then((module) => form(module.HelpDeskSettings)),
    onboarding: () => import("./onboarding-checklist").then((module) => form(module.OnboardingSettings)),
    presets: () => import("./preset-settings").then((module) => form(module.PresetSettings)),
    lfg: () => import("./lfg-settings").then((module) => form(module.LfgSettings)),
})
/** Loads every configuration form ahead of use, for tests that render sections without waiting */
export const preloadForms = forms.preload
// Families whose forms choose a saved template revision
const templateFamilies = new Set<DashboardConfigurationFamily>([
    "greetings",
    "tickets",
    "milestones",
    "events",
    "schedules",
])
// Template choices load page by page with live updates, and loading more adds the next page of names
export function useTemplateOptions(client: ConvexReactClient, sessionToken: string, serverId: string, active: boolean) {
    const [pages, setPages] = useState(1),
        [state, setState] = useState<{ templates?: TemplateOption[]; more: boolean; error: boolean; current: boolean }>(
            { more: false, error: false, current: false },
        )
    useEffect(() => {
        setPages(1)
        setState({ more: false, error: false, current: false })
    }, [serverId])
    useEffect(() => {
        if (!active) return
        let disposed = false
        const subscriptions = new Map<
            string,
            { watch: ReturnType<ConvexReactClient["watchQuery"]>; unsubscribe: () => void }
        >()
        function update() {
            if (disposed) return
            try {
                const used = new Set<string>(),
                    templates: TemplateOption[] = []
                let cursor: string | null = null,
                    complete = true
                for (let page = 0; page < pages; page++) {
                    const key = cursor ?? ""
                    used.add(key)
                    let subscription = subscriptions.get(key)
                    if (!subscription) {
                        const watch = client.watchQuery(dashboardApi.templates, { sessionToken, serverId, cursor })
                        subscription = { watch, unsubscribe: watch.onUpdate(update) }
                        subscriptions.set(key, subscription)
                    }
                    const result = subscription.watch.localQueryResult() as DashboardTemplatesView | undefined
                    if (!result) {
                        complete = false
                        break
                    }
                    templates.push(...result.templates)
                    cursor = result.cursor
                    if (cursor === null) break
                }
                for (const [key, subscription] of subscriptions)
                    if (!used.has(key)) {
                        subscription.unsubscribe()
                        subscriptions.delete(key)
                    }
                if (complete) setState({ templates, more: cursor !== null, error: false, current: true })
                else setState((current) => ({ ...current, current: false }))
            } catch {
                setState((current) => ({ ...current, error: true }))
            }
        }
        update()
        return () => {
            disposed = true
            subscriptions.forEach((subscription) => subscription.unsubscribe())
        }
    }, [client, sessionToken, serverId, active, pages])
    return {
        ...state,
        loadMore: () => {
            if (state.more && state.current) setPages((current) => current + 1)
        },
    }
}
/** A configuration section of the dashboard. Template consumers also subscribe to template names and revisions, without content */
export function ConfigurationView(props: SectionProps & { section: ConfigurationSectionId }) {
    const { client, sessionToken, serverId, section } = props,
        consumer = templateFamilies.has(configurationSections[section].family)
    const templates = useTemplateOptions(client, sessionToken, serverId, consumer)
    return (
        <ConfigurationSection
            section={section}
            client={client}
            sessionToken={sessionToken}
            serverId={serverId}
            userId={props.userId}
            connected={props.connected}
            catalog={props.catalog}
            catalogLoading={props.catalogLoading}
            catalogError={props.catalogError}
            refreshCatalog={props.refreshCatalog}
            templates={templates.templates}
            templatesLoading={consumer && !templates.current}
            templatesError={templates.error}
            templatesHasMore={templates.more}
            loadTemplatesPage={templates.loadMore}
        />
    )
}
export function ConfigurationSection(props: ConfigurationSectionProps) {
    const { client, sessionToken, serverId, section } = props
    const state = useConfigurationState(client, sessionToken, serverId, configurationSections[section].family)
    const scope = useDraftScope(),
        drafts = useDraftVersion()
    const [memory, setMemory] = useState<{
        source: DashboardConfigurationSnapshot
        drafts: number
        start: string
        view: DashboardConfigurationSnapshot
        missing: string[]
    }>()
    // A row removed from the snapshot stays while one of its forms holds an unsaved edit, and goes when the last of them ends.
    // Rows of pages that left the loaded window are not kept as removed definitions
    const retention = state.remote
        ? memory?.source === state.remote && (!memory.missing.length || memory.drafts === drafts)
            ? memory
            : {
                  source: state.remote,
                  drafts,
                  start: state.start,
                  ...preserveRemovedDefinitions(
                      state.remote,
                      memory?.start === state.start ? memory.view : undefined,
                      (row) => hasRowDraft(scope, row),
                  ),
              }
        : undefined
    if (retention && retention !== memory) setMemory(retention)
    const common = {
        connected: props.connected && !state.error && !state.loadingPage,
        userId: props.userId,
        catalog: props.catalog,
        catalogLoading: props.catalogLoading,
        catalogError: props.catalogError,
        defaultOwnerId: props.catalog?.ownerId,
        loadPage: state.loadPage,
        loadingPage: state.loadingPage,
        templates: props.templates,
        templatesLoading: props.templatesLoading,
        templatesError: props.templatesError,
        templatesHasMore: props.templatesHasMore,
        loadTemplatesPage: props.loadTemplatesPage,
        removedDefinitions: retention?.missing,
    }
    function queue<F extends DashboardConfigurationFamily>(family: F): ConfigurationQueue<F> {
        return (operation: DashboardConfigurationOperationMap[F], expectedConfigRevision: number, requestId: string) =>
            client.action(dashboardApi.queueConfiguration, {
                sessionToken,
                serverId,
                family,
                operation,
                expectedConfigRevision,
                requestId,
            } as DashboardConfigurationRequest)
    }
    const remote = retention?.view,
        { component: Form, failed, retry } = forms.use(configurationSections[section].family)
    return (
        <div className="role-section">
            {state.error && (
                <p className="notice error" role="alert">
                    Live configuration is unavailable. Your draft is kept. Refresh sign-in or check server permission
                    before saving
                </p>
            )}
            {remote && !Form && failed ? (
                <section className="panel">
                    <p className="notice error" role="alert">
                        This section could not be loaded. Check your connection{" "}
                        <button type="button" className="secondary" onClick={retry}>
                            Try again
                        </button>
                    </p>
                </section>
            ) : (
                (!remote || !Form) && (
                    <section className="panel">
                        <p role="status">Loading {configurationSections[section].title.toLowerCase()}…</p>
                    </section>
                )
            )}
            {retention?.missing.length ? (
                <div className="notice" role="alert">
                    {identitiesOf(configurationSections[section].family) ? (
                        <p>
                            Definitions are no longer in the loaded pages. They may have been removed or moved to a
                            later page. Their forms and drafts are kept below for copying, with saves disabled until
                            those definitions are loaded again
                        </p>
                    ) : (
                        <p>
                            Items were removed. Their forms and drafts are kept below for copying, with saves disabled
                        </p>
                    )}
                    <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                            if (scope) for (const row of retention.missing) clearRowDrafts(scope, row)
                            if (state.remote)
                                setMemory({
                                    source: state.remote,
                                    drafts,
                                    start: state.start,
                                    view: state.remote,
                                    missing: [],
                                })
                        }}
                    >
                        Dismiss unavailable definitions and their drafts
                    </button>
                </div>
            ) : null}
            {state.skipped.map((collection) => (
                <p className="notice" role="status" key={collection}>
                    Earlier pages of {collection} are hidden, so only {PAGE_WINDOW} later pages stay loaded and live.
                    Drafts on hidden pages are kept{" "}
                    <button
                        type="button"
                        className="secondary"
                        disabled={state.loadingPage}
                        onClick={() => state.firstPages(collection)}
                    >
                        Show {collection} from the start
                    </button>
                </p>
            ))}
            {remote && Form && (
                <Form
                    {...common}
                    remote={remote as ConfigSectionProps<SectionFamily>["remote"]}
                    queue={queue(remote.family as SectionFamily)}
                    kind={section === "auto" ? "auto" : "custom"}
                    refreshCatalog={props.refreshCatalog}
                />
            )}
            {remote && (
                <section className="panel">
                    <h2>Recent configuration requests</h2>
                    {remote.jobs.length ? (
                        <ul className="request-list">
                            {remote.jobs.map((job) => {
                                const operation =
                                    "operation" in job.operation ? job.operation.operation.type : job.operation.type
                                return (
                                    <li key={job.id}>
                                        <strong>
                                            {operation[0]!.toUpperCase() + operation.slice(1).replaceAll("-", " ")}
                                        </strong>
                                        : <JobStatus state={job.state} error={job.error} />
                                    </li>
                                )
                            })}
                        </ul>
                    ) : (
                        <p className="muted">No recent requests</p>
                    )}
                    <p className="field-help">
                        The running bot rechecks current permissions before applying a change. Requests expire after two
                        minutes
                        {remote.family === "events"
                            ? ". Applied confirms configuration, while native card delivery follows its own status"
                            : ""}
                    </p>
                </section>
            )}
        </div>
    )
}
