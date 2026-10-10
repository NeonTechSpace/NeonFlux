import type { PublishingKind } from '@neonflux/backend/contracts'
import type { DashboardEventCalendar, DashboardScheduleCalendar } from '@neonflux/backend/dashboard-contracts'
import { FormInputError } from './settings-form'

export function numberValue(value: string | boolean | undefined, min: number, max: number, label: string): number {
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new FormInputError(`Choose ${label} between ${min} and ${max}`)
  return parsed
}
export function idValue(value: string | boolean | undefined, label: string): string {
  const parsed = typeof value === 'string' ? value.trim() : ''
  if (!/^[1-9]\d{0,18}$/.test(parsed) || BigInt(parsed) > 9223372036854775807n) throw new FormInputError(`Enter a valid ${label}`)
  return parsed
}
function arrayValue(value: string | boolean | undefined, label: string): unknown[] {
  try { const parsed: unknown = JSON.parse(String(value)); if (Array.isArray(parsed)) return parsed } catch { /* Report a readable form error below */ }
  throw new FormInputError(`Review ${label}`)
}
export function idsValue(value: string | boolean | undefined, max: number, label: string): string[] {
  const parsed = arrayValue(value,label).map(value => idValue(typeof value === 'string' ? value : undefined,label))
  if (parsed.length > max || new Set(parsed).size !== parsed.length) throw new FormInputError(`Choose up to ${max} distinct ${label}`)
  return parsed
}
export function stringsValue(value: string | boolean | undefined, max: number, maxLength: number, label: string): string[] {
  const parsed = arrayValue(value,label)
  if (parsed.length > max || parsed.some(value => typeof value !== 'string' || !value.trim() || value.length > maxLength)) throw new FormInputError(`Enter up to ${max} ${label}, each with one to ${maxLength} characters`)
  return parsed as string[]
}
export function nameValue(value: string | boolean | undefined, label: string): string {
  const parsed = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(parsed)) throw new FormInputError(`Use a ${label} with up to thirty-two lowercase letters, digits, underscores or hyphens`)
  return parsed
}
export function templateValue(value: string | boolean | undefined): { kind: PublishingKind, name: string, revision: number } {
  try {
    const parsed = JSON.parse(String(value)) as { kind: PublishingKind, name: string, revision: number }
    if (parsed.kind !== 'draft' && parsed.kind !== 'template' || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1) throw new Error()
    return { kind: parsed.kind,name: nameValue(parsed.name,'template or draft name'),revision: parsed.revision }
  } catch { throw new FormInputError('Choose a saved draft or template version') }
}
export function calendarValue(value: string | boolean | undefined, event: true): DashboardEventCalendar
export function calendarValue(value: string | boolean | undefined, event?: false): DashboardScheduleCalendar
export function calendarValue(value: string | boolean | undefined, event = false): DashboardEventCalendar | DashboardScheduleCalendar {
  try {
    const parsed = JSON.parse(String(value)) as DashboardEventCalendar
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(parsed.localMinute) || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(parsed.zone) || !['reject','earlier','later'].includes(parsed.fold)) throw new Error()
    const recurrence = parsed.recurrence.type === 'none' ? { type: 'none' as const } : { type: parsed.recurrence.type,interval: numberValue(String(parsed.recurrence.interval),1,12,'recurrence interval'),count: numberValue(String(parsed.recurrence.count),1,26,'occurrence count') }
    if (!['none','daily','weekly'].includes(recurrence.type)) throw new Error()
    const calendar: DashboardScheduleCalendar = { localMinute: parsed.localMinute,zone: parsed.zone,fold: parsed.fold,recurrence }
    return event ? { ...calendar,durationMinutes: numberValue(String(parsed.durationMinutes),1,10080,'duration minutes') } : calendar
  } catch (error) { if (error instanceof FormInputError) throw error; throw new FormInputError('Choose an explicit local date, time, timezone and fold policy') }
}
