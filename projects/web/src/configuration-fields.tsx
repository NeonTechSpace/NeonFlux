import { isId } from "@neonflux/contracts/common"
import { EVENTS_DURATION_MAX_MINUTES, eventsRepeats } from "@neonflux/contracts/events"
import type { CivilRecurrence } from "@neonflux/contracts/civil"
import type { PublishingKind } from "@neonflux/contracts/publishing-base"
import { MEMBER_ACCESS_ROLES, MEMBER_ACCESS_USERS, type MemberAccessLists } from "@neonflux/contracts/shared"
import type {
    DashboardConfigurationJob,
    DashboardConfigurationOperationMap,
} from "@neonflux/backend/dashboard-contracts"
import { useState } from "react"
import type { ReactNode } from "react"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps, TemplateOption } from "./configuration-form"
import { idsValue } from "./configuration-values"
import { hasRowDraft, useDraftScope } from "./drafts"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { selectableRoles } from "./catalog-options"

/** A details block that mounts its forms only while open, so closed items cost nothing. It starts open when a form of its row has a stored draft */
export function EditorDetails({
    summary,
    row,
    children,
}: {
    summary: ReactNode
    row: string
    children: () => ReactNode
}) {
    const scope = useDraftScope()
    const [open, setOpen] = useState(() => hasRowDraft(scope, row))
    return (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>{summary}</summary>
            {open && children()}
        </details>
    )
}

interface Field {
    label: string
    value: string
    onChange: (value: string) => void
    disabled?: boolean | undefined
}
export function NumberField({
    label,
    value,
    onChange,
    disabled,
    min,
    max,
    required = true,
}: Field & { min: number; max: number; required?: boolean }) {
    return (
        <label>
            {label}
            <input
                type="number"
                inputMode="numeric"
                step={1}
                required={required}
                min={min}
                max={max}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
            />
        </label>
    )
}
export function ChoiceField({
    label,
    value,
    onChange,
    disabled,
    options,
}: Field & { options: ReadonlyArray<{ value: string; label: string }> }) {
    return (
        <label>
            {label}
            <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    )
}
// A label inside a sentence, keeping words such as IDs as written
const lowerFirst = (label: string) => label.replace(/^./, (letter) => letter.toLowerCase())
function ListField({
    label,
    value,
    onChange,
    disabled,
    max,
    maxLength,
    ids = false,
    paste = false,
}: Field & { max: number; maxLength: number; ids?: boolean; paste?: boolean }) {
    const rows = JSON.parse(value || "[]") as string[],
        name = lowerFirst(label)
    const change = (next: string[]) => onChange(JSON.stringify(next))
    return (
        <fieldset className="mapping-row">
            <legend>{label}</legend>
            {rows.map((row, index) => (
                <div className="list-row" key={index}>
                    <label>
                        {label} {index + 1}
                        <input
                            required
                            maxLength={maxLength}
                            inputMode={ids ? "numeric" : undefined}
                            value={row}
                            disabled={disabled}
                            onChange={(event) =>
                                change(rows.map((current, i) => (i === index ? event.target.value : current)))
                            }
                        />
                    </label>
                    <button
                        type="button"
                        className="secondary"
                        disabled={disabled}
                        onClick={() => change(rows.filter((_, i) => i !== index))}
                    >
                        Remove {name} {index + 1}
                    </button>
                </div>
            ))}
            {!rows.length && <p className="muted">No {name} configured</p>}
            <button
                type="button"
                className="secondary"
                disabled={disabled || rows.length >= max}
                onClick={() => change([...rows, ""])}
            >
                Add {name}
            </button>
            {paste && (
                <PasteRows
                    label={label}
                    rows={rows}
                    max={max}
                    maxLength={maxLength}
                    ids={ids}
                    disabled={disabled}
                    onChange={change}
                />
            )}
            {paste && rows.length > 0 && (
                <button type="button" className="secondary" disabled={disabled} onClick={() => change([])}>
                    Remove all {name}
                </button>
            )}
            <p className="field-help">
                Up to {max} entries{ids ? ". Use exact IDs" : ""}
            </p>
        </fieldset>
    )
}
/**
 * Adds many entries at once from pasted text, one per line, or replaces the whole list with them. IDs may also be apart or split by
 * commas, and a mention counts as its ID. Entries that are new but too long, not an ID or past the limit stay in the box
 */
function PasteRows({
    label,
    rows,
    max,
    maxLength,
    ids = false,
    disabled,
    onChange,
}: {
    label: string
    rows: string[]
    max: number
    maxLength: number
    ids?: boolean
    disabled?: boolean | undefined
    onChange: (next: string[]) => void
}) {
    const [text, setText] = useState(""),
        [note, setNote] = useState("")
    const name = lowerFirst(label),
        unit = ids ? "IDs" : "lines"
    const apply = (replace: boolean) => {
        const kept = replace ? [] : rows
        const entries = ids
            ? text.split(/[\s,]+/).map((entry) => entry.replace(/^<@!?(\d+)>$/, "$1"))
            : text.split(/\r?\n/).map((line) => line.trim())
        const fresh = [...new Set(entries)].filter((entry) => entry && !kept.includes(entry))
        const added = fresh
            .filter((entry) => (ids ? isId(entry) : entry.length <= maxLength))
            .slice(0, Math.max(0, max - kept.length))
        const left = fresh.filter((entry) => !added.includes(entry))
        onChange([...kept, ...added])
        setText(left.join("\n"))
        setNote(
            `${replace ? "The list now holds" : "Added"} ${added.length}` +
                (left.length
                    ? `. ${left.length} left in the box, ${ids ? "each entry is an exact ID" : `each entry has at most ${maxLength} characters`} and the list at most ${max}`
                    : ""),
        )
    }
    return (
        <div className="paste-rows">
            <label>
                Add several {name}, {ids ? "apart or split by commas or lines" : "one per line"}
                <textarea value={text} rows={4} disabled={disabled} onChange={(event) => setText(event.target.value)} />
            </label>
            <button
                type="button"
                className="secondary"
                disabled={disabled || !text.trim()}
                onClick={() => apply(false)}
            >
                Add {unit}
            </button>
            <button type="button" className="secondary" disabled={disabled || !text.trim()} onClick={() => apply(true)}>
                Replace the list with these {unit}
            </button>
            {note && (
                <p role="status" className="field-help">
                    {note}
                </p>
            )}
        </div>
    )
}
/** A list of exact IDs, which also takes many at once from pasted text and can be replaced or cleared whole */
export function IdList(props: Field & { max: number }) {
    return <ListField {...props} maxLength={19} ids paste />
}
export function StringList(props: Field & { max: number; maxLength: number; paste?: boolean }) {
    return <ListField {...props} />
}

interface TemplateBinding {
    kind: PublishingKind
    name: string
    revision: number
}
export function TemplatePicker({
    label,
    value,
    onChange,
    disabled,
    templates,
    loading = false,
    error = false,
    kinds = ["template"],
    loadMore,
    hasMore = false,
    follows = false,
}: Field & {
    templates?: TemplateOption[] | undefined
    /** The route sends the template's latest content, so the chosen version only confirms the template */
    follows?: boolean | undefined
    loading?: boolean | undefined
    error?: boolean | undefined
    kinds?: PublishingKind[]
    loadMore?: (() => void) | undefined
    hasMore?: boolean | undefined
}) {
    const selected = value ? (JSON.parse(value) as TemplateBinding) : undefined
    const key = (row: TemplateBinding) => JSON.stringify({ kind: row.kind, name: row.name, revision: row.revision })
    const options = (templates ?? [])
        .filter((row) => kinds.includes(row.kind))
        .map((row) => ({ id: key(row), name: `${row.name} (${row.kind}, version ${row.revision})` }))
    const current = selected
        ? templates?.find((row) => row.kind === selected.kind && row.name === selected.name)
        : undefined
    if (selected && !options.some((option) => option.id === key(selected)))
        options.unshift({
            id: key(selected),
            name: `${selected.name} (${selected.kind}, saved version ${selected.revision})`,
        })
    return (
        <div>
            <SearchPicker
                label={label}
                options={options}
                value={selected ? [key(selected)] : []}
                onChange={(values) => onChange(values[0] ?? "")}
                disabled={disabled}
                loading={loading && !selected}
            />
            <p className="field-help">
                {follows
                    ? "Follows this template. Edits apply to the next post right away"
                    : "Uses the selected saved version. Later template edits do not change it until you choose the newer version"}
            </p>
            {!follows && current && selected && current.revision > selected.revision && (
                <p className="notice" role="status">
                    A newer template version is available: Version {current.revision}. Your saved version is kept until
                    you choose the new one
                </p>
            )}
            {error && (
                <p className="notice error" role="status">
                    Template choices are unavailable. Your saved selection is kept
                </p>
            )}
            {hasMore && loadMore && (
                <button type="button" className="secondary" disabled={disabled || loading} onClick={loadMore}>
                    Load more templates
                </button>
            )}
        </div>
    )
}

const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")].map((zone) => ({ id: zone, name: zone }))
export function CalendarFields({
    value,
    onChange,
    disabled,
    event = false,
}: {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    event?: boolean
}) {
    const calendar = JSON.parse(value || "{}") as Record<string, unknown>
    const recurrence =
        calendar.recurrence && typeof calendar.recurrence === "object"
            ? (calendar.recurrence as Record<string, unknown>)
            : { type: "none" }
    const patch = (key: string, next: unknown) => onChange(JSON.stringify({ ...calendar, [key]: next }))
    return (
        <fieldset className="mapping-row">
            <legend>Dates and timezone</legend>
            <label>
                Local date and time
                <input
                    required
                    type="datetime-local"
                    step={60}
                    value={String(calendar.localMinute ?? "")}
                    disabled={disabled}
                    onChange={(input) => patch("localMinute", input.target.value)}
                />
            </label>
            <SearchPicker
                label="Timezone"
                options={zones}
                value={calendar.zone ? [String(calendar.zone)] : []}
                disabled={disabled}
                onChange={(selected) => patch("zone", selected[0] ?? "")}
            />
            <ChoiceField
                label="Repeated local time"
                value={String(calendar.fold ?? "reject")}
                disabled={disabled}
                options={[
                    { value: "reject", label: "Reject ambiguous time" },
                    { value: "earlier", label: "Earlier offset" },
                    { value: "later", label: "Later offset" },
                ]}
                onChange={(fold) => patch("fold", fold)}
            />
            {event && (
                <NumberField
                    label="Duration (minutes)"
                    value={String(calendar.durationMinutes ?? 60)}
                    min={1}
                    max={
                        eventsRepeats(recurrence as CivilRecurrence)
                            ? EVENTS_DURATION_MAX_MINUTES
                            : Number.MAX_SAFE_INTEGER
                    }
                    disabled={disabled}
                    onChange={(duration) => patch("durationMinutes", duration)}
                />
            )}
            <ChoiceField
                label="Repeat"
                value={String(recurrence.type ?? "none")}
                disabled={disabled}
                options={[
                    { value: "none", label: "Once" },
                    { value: "daily", label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                ]}
                onChange={(type) =>
                    patch(
                        "recurrence",
                        type === "none"
                            ? { type: "none" }
                            : {
                                  type,
                                  interval: recurrence.interval ?? 1,
                                  ...(recurrence.count !== undefined ? { count: recurrence.count } : {}),
                                  ...(recurrence.until !== undefined ? { until: recurrence.until } : {}),
                              },
                    )
                }
            />
            {recurrence.type !== "none" && (
                <>
                    <NumberField
                        label="Repeat interval"
                        value={String(recurrence.interval ?? 1)}
                        min={1}
                        max={Number.MAX_SAFE_INTEGER}
                        disabled={disabled}
                        onChange={(interval) => patch("recurrence", { ...recurrence, interval })}
                    />
                    <ChoiceField
                        label="Ends"
                        value={
                            recurrence.count !== undefined
                                ? "count"
                                : recurrence.until !== undefined
                                  ? "until"
                                  : "never"
                        }
                        disabled={disabled}
                        options={[
                            { value: "never", label: "Never" },
                            { value: "count", label: "After a number of dates" },
                            { value: "until", label: "On a date" },
                        ]}
                        onChange={(ends) =>
                            patch("recurrence", {
                                type: recurrence.type,
                                interval: recurrence.interval ?? 1,
                                ...(ends === "count" ? { count: 2 } : {}),
                                ...(ends === "until" ? { until: String(calendar.localMinute ?? "").slice(0, 10) } : {}),
                            })
                        }
                    />
                    {recurrence.count !== undefined && (
                        <NumberField
                            label="Number of dates"
                            value={String(recurrence.count)}
                            min={1}
                            max={Number.MAX_SAFE_INTEGER}
                            disabled={disabled}
                            onChange={(count) => patch("recurrence", { ...recurrence, count })}
                        />
                    )}
                    {recurrence.until !== undefined && (
                        <label>
                            Last date
                            <input
                                required
                                type="date"
                                value={String(recurrence.until)}
                                disabled={disabled}
                                onChange={(input) => patch("recurrence", { ...recurrence, until: input.target.value })}
                            />
                        </label>
                    )}
                </>
            )}
            <p className="field-help">
                Dates stay in the selected timezone. The bot validates daylight-saving gaps and repeated times before
                applying them. A later date whose time does not exist, or repeats while repeated times are rejected, is
                skipped and shown
            </p>
        </fieldset>
    )
}

const ids = (value: string | boolean | undefined) => JSON.parse(String(value)) as string[]
/** Who may use a member feature: the allow and block lists of the role picker, showcases or profiles, saved for that feature only */
export function AccessForm<F extends "rolepicker" | "showcase" | "profile">(
    props: ConfigSectionProps<F> & { access: MemberAccessLists; what: string },
) {
    const roles = selectableRoles(props.catalog),
        picks = { loading: props.catalogLoading, allowManual: props.catalogError, catalog: true },
        { access } = props
    const remote: { configRevision: number; jobs: DashboardConfigurationJob[] } = props.remote
    return (
        <ConfigForm<F>
            queue={props.queue}
            connected={props.connected}
            jobs={remote.jobs}
            title={`Who may ${props.what}`}
            description="A block always wins over an allow. With both allow lists empty, every member who is not blocked may use it"
            snapshot={{
                revision: remote.configRevision,
                values: {
                    allowRoleIds: JSON.stringify(access.allowRoleIds),
                    blockRoleIds: JSON.stringify(access.blockRoleIds),
                    allowUserIds: JSON.stringify(access.allowUserIds),
                    blockUserIds: JSON.stringify(access.blockUserIds),
                },
            }}
            operation={(values: FormValues) =>
                ({
                    type: "access-set",
                    allowRoleIds: idsValue(values.allowRoleIds, MEMBER_ACCESS_ROLES, "allowed roles"),
                    blockRoleIds: idsValue(values.blockRoleIds, MEMBER_ACCESS_ROLES, "blocked roles"),
                    allowUserIds: idsValue(values.allowUserIds, MEMBER_ACCESS_USERS, "allowed user IDs"),
                    blockUserIds: idsValue(values.blockUserIds, MEMBER_ACCESS_USERS, "blocked user IDs"),
                }) as DashboardConfigurationOperationMap[F]
            }
            fields={(values, edit, disabled) => (
                <>
                    <SearchPicker
                        {...picks}
                        label="Allowed roles"
                        options={roles}
                        multiple
                        value={ids(values.allowRoleIds)}
                        disabled={disabled}
                        onChange={(next) => edit("allowRoleIds", JSON.stringify(next))}
                    />
                    <IdList
                        label="Allowed user IDs"
                        value={String(values.allowUserIds)}
                        onChange={(value) => edit("allowUserIds", value)}
                        disabled={disabled}
                        max={MEMBER_ACCESS_USERS}
                    />
                    <SearchPicker
                        {...picks}
                        label="Blocked roles"
                        options={roles}
                        multiple
                        value={ids(values.blockRoleIds)}
                        disabled={disabled}
                        onChange={(next) => edit("blockRoleIds", JSON.stringify(next))}
                    />
                    <IdList
                        label="Blocked user IDs"
                        value={String(values.blockUserIds)}
                        onChange={(value) => edit("blockUserIds", value)}
                        disabled={disabled}
                        max={MEMBER_ACCESS_USERS}
                    />
                </>
            )}
        />
    )
}
