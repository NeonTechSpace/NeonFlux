import { useRef } from 'react'
import type { DashboardCatalog, DashboardConfigurationCollection, DashboardConfigurationCursors, DashboardConfigurationFamily, DashboardConfigurationOperationMap, DashboardConfigurationQueueResult, DashboardConfigurationSnapshot, DashboardTemplatesView } from '@neonflux/backend/dashboard-contracts'
import { SettingsForm } from './settings-form'
import type { FormSaveResult, FormValues, SettingsFormProps } from './settings-form'

/** A saved draft or template as template pickers list it */
export type TemplateOption = DashboardTemplatesView['templates'][number]
export type ConfigurationQueue<F extends DashboardConfigurationFamily> = (operation: DashboardConfigurationOperationMap[F], expectedConfigRevision: number, requestId: string) => Promise<DashboardConfigurationQueueResult>
export interface ConfigSectionProps<F extends DashboardConfigurationFamily> {
  remote: Extract<DashboardConfigurationSnapshot, { family: F }>
  queue: ConfigurationQueue<F>
  connected: boolean
  catalog?: DashboardCatalog
  userId?: string | undefined
  catalogLoading?: boolean
  catalogError?: boolean
  defaultOwnerId?: string
  loadPage?: (collection: DashboardConfigurationCollection, cursor?: string) => void
  loadingPage?: boolean
  templates?: TemplateOption[] | undefined
  templatesLoading?: boolean
  templatesError?: boolean
  loadTemplatesPage?: () => void
  templatesHasMore?: boolean
  removedDefinitions?: string[]
}
export type ConfigFormProps<F extends DashboardConfigurationFamily> = Omit<SettingsFormProps, 'save'> & {
  queue: ConfigurationQueue<F>
  operation: (values: FormValues) => DashboardConfigurationOperationMap[F]
}
export function ConfigForm<F extends DashboardConfigurationFamily>({ queue, operation, ...props }: ConfigFormProps<F>) {
  const request = useRef<{ key: string, id: string } | undefined>(undefined)
  async function save(values: FormValues, expectedRevision: number): Promise<FormSaveResult> {
    const next = operation(values), key = JSON.stringify({ next, expectedRevision })
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    const result = await queue(next, expectedRevision, request.current.id)
    request.current = undefined
    if (result.conflict) return { saved: false, conflict: true, revision: result.revision }
    if (!result.queued || !result.jobId) throw new Error('Configuration change was not queued')
    return { queued: true, jobId: result.jobId, revision: result.revision }
  }
  return <SettingsForm {...props} save={save} resetAfterApplied />
}
export function ConfigurationPages({ nextCursors, loadPage, loading = false }: { nextCursors?: DashboardConfigurationCursors, loadPage?: ConfigSectionProps<DashboardConfigurationFamily>['loadPage'], loading?: boolean }) {
  if (!nextCursors || !loadPage) return null
  return <div className="actions">{Object.entries(nextCursors).map(([collection,cursor]) => <button key={collection} type="button" className="secondary" disabled={loading} onClick={() => loadPage(collection as DashboardConfigurationCollection,cursor)}>Load more {collection}</button>)}</div>
}
