import { useRef } from "react"
import type {
    DashboardCatalog,
    DashboardConfigurationCollection,
    DashboardConfigurationCursors,
    DashboardConfigurationFamily,
    DashboardConfigurationOperationMap,
    DashboardConfigurationQueueResult,
    DashboardConfigurationSnapshot,
    DashboardTemplatesView,
} from "@neonflux/backend/dashboard-contracts"
import { SettingsForm } from "./settings-form"
import type { FormSaveResult, FormValues, SettingsFormProps } from "./settings-form"

/** A saved draft or template as template pickers list it */
export type TemplateOption = DashboardTemplatesView["templates"][number]
export type ConfigurationQueue<F extends DashboardConfigurationFamily> = (
    operation: DashboardConfigurationOperationMap[F],
    expectedConfigRevision: number,
    requestId: string,
) => Promise<DashboardConfigurationQueueResult>
export interface ConfigSectionProps<F extends DashboardConfigurationFamily> {
    remote: Extract<DashboardConfigurationSnapshot, { family: F }>
    queue: ConfigurationQueue<F>
    connected: boolean
    catalog?: DashboardCatalog | undefined
    userId?: string | undefined
    catalogLoading?: boolean | undefined
    catalogError?: boolean | undefined
    defaultOwnerId?: string | undefined
    loadPage?: ((collection: DashboardConfigurationCollection, cursor?: string) => void) | undefined
    loadingPage?: boolean | undefined
    templates?: TemplateOption[] | undefined
    templatesLoading?: boolean | undefined
    templatesError?: boolean | undefined
    loadTemplatesPage?: (() => void) | undefined
    templatesHasMore?: boolean | undefined
    removedDefinitions?: string[] | undefined
}
/** The props shared by the forms of one list row, and whether the row is gone from the loaded pages while a draft keeps it */
export function rowCard<P extends { connected: boolean }>(common: P, removed: string[] | undefined, row: string) {
    const missing = removed?.includes(row)
    return { missing, card: { ...common, row, connected: common.connected && !missing } }
}
/** The rows still saved, for list limits and duplicate checks, without those kept only for their unsaved drafts */
export const savedRows = <T,>(rows: readonly T[], removed: string[] | undefined, row: (value: T) => string) =>
    removed?.length ? rows.filter((value) => !removed.includes(row(value))) : rows
type QueuedFormProps<O> = Omit<SettingsFormProps, "save"> & {
    queue: (
        operation: O,
        expectedConfigRevision: number,
        requestId: string,
    ) => Promise<DashboardConfigurationQueueResult>
    operation: (values: FormValues) => O
}
type ConfigFormProps<F extends DashboardConfigurationFamily> = QueuedFormProps<DashboardConfigurationOperationMap[F]>
/** A settings form that queues one operation for the bot to apply, retrying with the same request ID until its input changes */
export function QueuedForm<O>({ queue, operation, ...props }: QueuedFormProps<O>) {
    const request = useRef<{ key: string; id: string } | undefined>(undefined)
    async function save(values: FormValues, expectedRevision: number): Promise<FormSaveResult> {
        const next = operation(values),
            key = JSON.stringify({ next, expectedRevision })
        if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
        const result = await queue(next, expectedRevision, request.current.id)
        request.current = undefined
        if (result.conflict) return { saved: false, conflict: true, revision: result.revision }
        if (!result.queued || !result.jobId) throw new Error("Change was not queued")
        return { queued: true, jobId: result.jobId, revision: result.revision }
    }
    return <SettingsForm {...props} save={save} resetAfterApplied />
}
export function ConfigForm<F extends DashboardConfigurationFamily>(props: ConfigFormProps<F>) {
    return <QueuedForm<DashboardConfigurationOperationMap[F]> {...props} />
}
export function ConfigurationPages({
    nextCursors,
    loadPage,
    loading = false,
}: {
    nextCursors?: DashboardConfigurationCursors | undefined
    loadPage?: ConfigSectionProps<DashboardConfigurationFamily>["loadPage"]
    loading?: boolean | undefined
}) {
    if (!nextCursors || !loadPage) return null
    return (
        <div className="actions">
            {Object.entries(nextCursors).map(([collection, cursor]) => (
                <button
                    key={collection}
                    type="button"
                    className="secondary"
                    disabled={loading}
                    onClick={() => loadPage(collection as DashboardConfigurationCollection, cursor)}
                >
                    Load more {collection}
                </button>
            ))}
        </div>
    )
}
