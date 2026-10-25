import {
    EVENTS_DESCRIPTION_LIMIT,
    EVENTS_REMINDERS,
    EVENTS_REMINDER_RANGE_MINUTES,
    eventsReminderProblem,
} from "@neonflux/contracts/events"
import type { EventsDefinition } from "@neonflux/contracts/events"
import type { SchedulesDefinition } from "@neonflux/contracts/schedules"
import { ConfigForm, ConfigurationPages, rowCard } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { CalendarFields, EditorDetails, NumberField, StringList, TemplatePicker } from "./configuration-fields"
import { calendarValue, idValue, nameValue, numberValue, stringsValue, templateValue } from "./configuration-values"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { postChannels, publicationChannels } from "./catalog-options"
import { SchedulePreview } from "./schedule-preview"

// A reminder lead has at most as many digits as the longest one a calendar allows
const REMINDER_DIGITS = String(EVENTS_REMINDER_RANGE_MINUTES).length

const initialCalendar = { localMinute: "", zone: "UTC", fold: "reject", recurrence: { type: "none" } }
// Once a repeat's first date has started, the form starts at its next date and counts the dates left from there, so a change
// continues the repeat instead of asking for a start in the past. A count with no date left leaves the end to choose
function civilCalendar(
    calendar: EventsDefinition["calendar"] | SchedulesDefinition["calendar"],
    resume?: EventsDefinition["resume"],
) {
    if (!calendar) return JSON.stringify({ ...initialCalendar, durationMinutes: 60 })
    const { dates: _dates, ...civil } = calendar
    if (!resume || civil.recurrence.type === "none") return JSON.stringify(civil)
    const { count: _count, ...recurrence } = civil.recurrence
    return JSON.stringify({
        ...civil,
        localMinute: resume.localMinute,
        recurrence: { ...recurrence, ...(resume.count ? { count: resume.count } : {}) },
    })
}
/** What a calendar form says once every date of a counted repeat has started, as chat does */
const NEW_END = "Every date of this repeat has started. Choose how it ends from its next date before you save"
type Edit = (key: string, value: string | boolean) => void
function OwnerField({ value, edit, disabled }: { value: string; edit: Edit; disabled: boolean }) {
    return (
        <label>
            Action owner ID
            <input
                required
                inputMode="numeric"
                maxLength={19}
                value={value}
                disabled={disabled}
                onChange={(event) => edit("ownerId", event.target.value)}
            />
            <span className="field-help">A current Owner or Administrator with access to the selected channel</span>
        </label>
    )
}
function EventContent({
    values,
    edit,
    disabled,
    create = false,
}: {
    values: FormValues
    edit: Edit
    disabled: boolean
    create?: boolean
}) {
    return (
        <>
            {create && (
                <label>
                    Event name
                    <input
                        required
                        maxLength={32}
                        value={String(values.name)}
                        disabled={disabled}
                        onChange={(event) => edit("name", event.target.value)}
                    />
                </label>
            )}
            <label>
                Event title
                <input
                    required
                    maxLength={256}
                    value={String(values.title)}
                    disabled={disabled}
                    onChange={(event) => edit("title", event.target.value)}
                />
            </label>
            <label>
                Event description
                <textarea
                    maxLength={EVENTS_DESCRIPTION_LIMIT}
                    value={String(values.description)}
                    disabled={disabled}
                    onChange={(event) => edit("description", event.target.value)}
                />
            </label>
        </>
    )
}
function confirm(value: string | boolean | undefined, action: string) {
    if (!value) throw new FormInputError(`Confirm ${action}`)
}
export function EventSettings(props: ConfigSectionProps<"events">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs },
        templates = {
            templates: props.templates,
            loading: props.templatesLoading,
            error: props.templatesError,
            loadMore: props.loadTemplatesPage,
            hasMore: props.templatesHasMore,
        }
    const channelField = (values: FormValues, edit: Edit, disabled: boolean) => (
        <SearchPicker
            catalog
            label="Event channel"
            options={postChannels(props.catalog)}
            loading={props.catalogLoading}
            allowManual={props.catalogError}
            value={values.channelId ? [String(values.channelId)] : []}
            disabled={disabled}
            onChange={(ids) => edit("channelId", ids[0] ?? "")}
        />
    )
    return (
        <div className="role-section">
            <ConfigForm<"events">
                {...common}
                title="Events"
                description="Enable RSVP events and their future reminders. Publishing must also be enabled"
                snapshot={{ revision, values: { enabled: data.settings.enabled } }}
                operation={(values) => ({
                    type: "settings",
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
                        Events enabled
                    </label>
                )}
            />
            <ConfigForm<"events">
                {...common}
                title="Discussion threads"
                description="Events published while this is on get a discussion thread on their card. In a forum channel the card is its own post. The thread or post is archived and locked when the event ends or is cancelled"
                snapshot={{ revision, values: { threads: data.settings.threads } }}
                operation={(values) => ({
                    type: "threads",
                    expectedRevision: data.settings.revision,
                    enabled: Boolean(values.threads),
                })}
                fields={(values, edit, disabled) => (
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(values.threads)}
                            disabled={disabled}
                            onChange={(event) => edit("threads", event.target.checked)}
                        />
                        Discussion threads
                    </label>
                )}
            />
            <ConfigForm<"events">
                {...common}
                title="Create event"
                description="Create a draft, then configure its calendar, capacity, reminders and optional template before publishing"
                resetAfterApplied
                snapshot={{
                    revision,
                    values: {
                        name: "",
                        title: "",
                        description: "",
                        channelId: "",
                        ownerId: props.defaultOwnerId ?? "",
                    },
                }}
                operation={(values) => ({
                    type: "create",
                    name: nameValue(values.name, "event name"),
                    title: String(values.title).trim(),
                    description: String(values.description),
                    channelId: idValue(values.channelId, "event channel"),
                    ownerId: idValue(values.ownerId, "event action owner ID"),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <EventContent values={values} edit={edit} disabled={disabled} create />
                        {channelField(values, edit, disabled)}
                        <OwnerField value={String(values.ownerId)} edit={edit} disabled={disabled} />
                    </>
                )}
            />
            {data.events.map((event) => {
                const binding = { eventNo: event.eventNo, expectedRevision: event.revision },
                    calendarLocked = event.state === "cancelled" || event.state === "completed"
                const { missing, card } = rowCard(common, props.removedDefinitions, String(event.eventNo))
                return (
                    <EditorDetails
                        key={event.eventNo}
                        summary={`${event.name}: ${event.state}, version ${event.revision}`}
                        row={card.row}
                    >
                        {() => (
                            <div className="role-section">
                                {missing && (
                                    <p className="notice" role="status">
                                        Not in loaded pages. This draft is kept for copying. Load remaining pages to
                                        check whether it moved
                                    </p>
                                )}
                                <ConfigForm<"events">
                                    {...card}
                                    title={`Event content ${event.name}`}
                                    description="Edit the title and description of this event"
                                    snapshot={{
                                        revision,
                                        values: { title: event.title, description: event.description },
                                    }}
                                    operation={(values) => ({
                                        type: "content",
                                        ...binding,
                                        title: String(values.title).trim(),
                                        description: String(values.description),
                                    })}
                                    fields={(values, edit, disabled) => (
                                        <EventContent values={values} edit={edit} disabled={disabled} />
                                    )}
                                />
                                <ConfigForm<"events">
                                    {...card}
                                    connected={card.connected && !calendarLocked}
                                    title={`Event calendar ${event.name}`}
                                    description={
                                        calendarLocked
                                            ? "A cancelled or completed event keeps its dates"
                                            : event.state === "draft"
                                              ? "Set explicit local dates. Native calendar validation resolves daylight-saving transitions before saving"
                                              : event.resume?.count === 0
                                                ? NEW_END
                                                : "Dates that have started stay as they were, and the start shows the next date that has not. Upcoming dates keep their numbers and replies, and members who replied Going or Maybe are told by DM"
                                    }
                                    snapshot={{
                                        revision,
                                        values: { calendar: civilCalendar(event.calendar, event.resume) },
                                    }}
                                    operation={(values) => {
                                        const calendar = calendarValue(values.calendar, true)
                                        // A repeat's reminders reach only as far ahead as its stored dates
                                        const problem = eventsReminderProblem(calendar, event.reminderOffsets)
                                        if (problem) throw new FormInputError(problem)
                                        return { type: "calendar", ...binding, calendar }
                                    }}
                                    fields={(values, edit, disabled) => (
                                        <CalendarFields
                                            event
                                            value={String(values.calendar)}
                                            onChange={(value) => edit("calendar", value)}
                                            disabled={disabled}
                                        />
                                    )}
                                />
                                <ConfigForm<"events">
                                    {...card}
                                    title={`Event capacity ${event.name}`}
                                    description="An unlimited event has no seat cap. Capacity changes preserve existing RSVP ordering"
                                    snapshot={{
                                        revision,
                                        values: {
                                            unlimited: event.capacity === null,
                                            capacity: String(event.capacity ?? 50),
                                        },
                                    }}
                                    operation={(values) => ({
                                        type: "capacity",
                                        ...binding,
                                        capacity: values.unlimited
                                            ? null
                                            : numberValue(
                                                  values.capacity,
                                                  1,
                                                  Number.MAX_SAFE_INTEGER,
                                                  "event capacity",
                                              ),
                                    })}
                                    fields={(values, edit, disabled) => (
                                        <>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(values.unlimited)}
                                                    disabled={disabled}
                                                    onChange={(input) => edit("unlimited", input.target.checked)}
                                                />
                                                Unlimited seats
                                            </label>
                                            {!values.unlimited && (
                                                <NumberField
                                                    label="Event capacity"
                                                    value={String(values.capacity)}
                                                    onChange={(value) => edit("capacity", value)}
                                                    disabled={disabled}
                                                    min={1}
                                                    max={Number.MAX_SAFE_INTEGER}
                                                />
                                            )}
                                        </>
                                    )}
                                />
                                <ConfigForm<"events">
                                    {...card}
                                    title={`Event reminders ${event.name}`}
                                    description="Up to 20 distinct reminder offsets in minutes before the event starts. A single date takes any lead, and a reminder whose time has already passed is skipped. A repeat takes up to 257760 minutes (179 days), and less when it runs more often than weekly with more than 26 dates, since NeonFlux stores its next 26 dates"
                                    snapshot={{
                                        revision,
                                        values: { offsets: JSON.stringify(event.reminderOffsets.map(String)) },
                                    }}
                                    operation={(values) => {
                                        const offsets = stringsValue(
                                            values.offsets,
                                            EVENTS_REMINDERS,
                                            REMINDER_DIGITS,
                                            "reminder offsets",
                                        ).map((value) =>
                                            numberValue(value, 1, EVENTS_REMINDER_RANGE_MINUTES, "reminder minutes"),
                                        )
                                        if (new Set(offsets).size !== offsets.length)
                                            throw new FormInputError("Use distinct reminder offsets")
                                        const problem = event.calendar && eventsReminderProblem(event.calendar, offsets)
                                        if (problem) throw new FormInputError(problem)
                                        return { type: "reminders", ...binding, offsets: offsets.sort((a, b) => b - a) }
                                    }}
                                    fields={(values, edit, disabled) => (
                                        <StringList
                                            label="Reminder minutes"
                                            value={String(values.offsets)}
                                            onChange={(value) => edit("offsets", value)}
                                            disabled={disabled}
                                            max={EVENTS_REMINDERS}
                                            maxLength={REMINDER_DIGITS}
                                        />
                                    )}
                                />
                                <ConfigForm<"events">
                                    {...card}
                                    title={`Event template ${event.name}`}
                                    description="Use a saved template version for event posts, or clear the selection to use the standard event card"
                                    snapshot={{
                                        revision,
                                        values: {
                                            source: event.template
                                                ? JSON.stringify({
                                                      kind: "template",
                                                      name: event.template.name,
                                                      revision: event.template.revision,
                                                  })
                                                : "",
                                        },
                                    }}
                                    operation={(values) => {
                                        const source = values.source ? templateValue(values.source) : undefined
                                        return {
                                            type: "template",
                                            ...binding,
                                            templateName: source?.name ?? null,
                                            ...(source ? { expectedTemplateRevision: source.revision } : {}),
                                        }
                                    }}
                                    fields={(values, edit, disabled) => (
                                        <TemplatePicker
                                            {...templates}
                                            label="Event template"
                                            value={String(values.source)}
                                            onChange={(value) => edit("source", value)}
                                            disabled={disabled}
                                        />
                                    )}
                                />
                                <ConfigForm<"events">
                                    {...card}
                                    title={`Event destination ${event.name}`}
                                    description="Change the authored destination. Current permission and event lifecycle checks run before applying"
                                    snapshot={{ revision, values: { channelId: event.channelId } }}
                                    operation={(values) => ({
                                        type: "destination",
                                        ...binding,
                                        channelId: idValue(values.channelId, "event channel"),
                                    })}
                                    fields={channelField}
                                />
                                <ConfigForm<"events">
                                    {...card}
                                    title={`Publish event ${event.name}`}
                                    description="Publish the configured draft and activate RSVP handling"
                                    submitLabel="Publish event"
                                    submitUnchanged
                                    snapshot={{ revision, values: {}, context: event.revision }}
                                    operation={() => ({ type: "publish", ...binding })}
                                    fields={() => null}
                                />
                                {(["cancel", "forget"] as const).map((action) => (
                                    <ConfigForm<"events">
                                        {...card}
                                        key={action}
                                        title={`${action[0]!.toUpperCase() + action.slice(1)} event ${event.name}`}
                                        description={
                                            action === "cancel"
                                                ? "Cancel future event participation and reminders"
                                                : "Forget this terminal event configuration and its eligible retained records. Unresolved work prevents removal, and a partial cleanup can need another request"
                                        }
                                        snapshot={{ revision, values: { confirm: false }, context: event.revision }}
                                        submitLabel={`${action[0]!.toUpperCase() + action.slice(1)} event`}
                                        operation={(values) => {
                                            confirm(values.confirm, `${action} event`)
                                            return action === "forget"
                                                ? { type: "forget", ...binding, confirm: "forget" }
                                                : { type: action, ...binding }
                                        }}
                                        fields={(values, edit, disabled) => (
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(values.confirm)}
                                                    disabled={disabled}
                                                    onChange={(input) => edit("confirm", input.target.checked)}
                                                />
                                                Confirm {action} event
                                            </label>
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                    </EditorDetails>
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

export function ScheduleSettings(props: ConfigSectionProps<"schedules">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs },
        templates = {
            templates: props.templates,
            loading: props.templatesLoading,
            error: props.templatesError,
            loadMore: props.loadTemplatesPage,
            hasMore: props.templatesHasMore,
            kinds: ["draft", "template"] as Array<"draft" | "template">,
        }
    const channelField = (values: FormValues, edit: Edit, disabled: boolean) => (
        <SearchPicker
            catalog
            label="Schedule channel"
            options={publicationChannels(props.catalog)}
            loading={props.catalogLoading}
            allowManual={props.catalogError}
            value={values.channelId ? [String(values.channelId)] : []}
            disabled={disabled}
            onChange={(ids) => edit("channelId", ids[0] ?? "")}
        />
    )
    return (
        <div className="role-section">
            <ConfigForm<"schedules">
                {...common}
                title="Schedules"
                description="Configure scheduled publications. Publishing must also be enabled"
                snapshot={{ revision, values: { enabled: data.settings.enabled } }}
                operation={(values) => ({
                    type: "settings",
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
                        Schedules enabled
                    </label>
                )}
            />
            <ConfigForm<"schedules">
                {...common}
                title="Create schedule"
                description="Choose a saved draft or template version and a calendar. New schedules start disabled"
                resetAfterApplied
                snapshot={{
                    revision,
                    values: { name: "", source: "", channelId: "", calendar: JSON.stringify(initialCalendar) },
                }}
                operation={(values) => ({
                    type: "create",
                    name: nameValue(values.name, "schedule name"),
                    source: templateValue(values.source),
                    channelId: idValue(values.channelId, "schedule channel"),
                    calendar: calendarValue(values.calendar),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            Schedule name
                            <input
                                required
                                maxLength={32}
                                value={String(values.name)}
                                disabled={disabled}
                                onChange={(event) => edit("name", event.target.value)}
                            />
                        </label>
                        <TemplatePicker
                            {...templates}
                            label="Schedule source"
                            value={String(values.source)}
                            onChange={(value) => edit("source", value)}
                            disabled={disabled}
                        />
                        {channelField(values, edit, disabled)}
                        <CalendarFields
                            value={String(values.calendar)}
                            onChange={(value) => edit("calendar", value)}
                            disabled={disabled}
                        />
                    </>
                )}
            />
            {data.schedules.map((schedule) => {
                const binding = { scheduleNo: schedule.scheduleNo, expectedRevision: schedule.revision }
                const { missing, card } = rowCard(common, props.removedDefinitions, String(schedule.scheduleNo))
                return (
                    <details key={schedule.scheduleNo}>
                        <summary>
                            {schedule.name}:{" "}
                            {schedule.cancelled ? "Cancelled" : schedule.enabled ? "Enabled" : "Disabled"}, version{" "}
                            {schedule.revision}
                        </summary>
                        <div className="role-section">
                            {missing && (
                                <p className="notice" role="status">
                                    Not in loaded pages. This draft is kept for copying. Load remaining pages to check
                                    whether it moved
                                </p>
                            )}
                            <SchedulePreview schedule={schedule} />
                            <ConfigForm<"schedules">
                                {...card}
                                title={`Schedule source ${schedule.name}`}
                                description="Choose the saved version for future posts. Posts already on their way keep the content they had"
                                snapshot={{ revision, values: { source: JSON.stringify(schedule.source) } }}
                                operation={(values) => ({
                                    type: "content",
                                    ...binding,
                                    source: templateValue(values.source),
                                })}
                                fields={(values, edit, disabled) => (
                                    <TemplatePicker
                                        {...templates}
                                        label="Schedule source"
                                        value={String(values.source)}
                                        onChange={(value) => edit("source", value)}
                                        disabled={disabled}
                                    />
                                )}
                            />
                            <ConfigForm<"schedules">
                                {...card}
                                title={`Schedule calendar ${schedule.name}`}
                                description={
                                    schedule.resume?.count === 0
                                        ? NEW_END
                                        : "Changing the calendar creates a new plan. Already admitted work keeps its original bindings"
                                }
                                snapshot={{
                                    revision,
                                    values: { calendar: civilCalendar(schedule.calendar, schedule.resume) },
                                }}
                                operation={(values) => ({
                                    type: "calendar",
                                    ...binding,
                                    calendar: calendarValue(values.calendar),
                                })}
                                fields={(values, edit, disabled) => (
                                    <CalendarFields
                                        value={String(values.calendar)}
                                        onChange={(value) => edit("calendar", value)}
                                        disabled={disabled}
                                    />
                                )}
                            />
                            <ConfigForm<"schedules">
                                {...card}
                                title={`Schedule destination ${schedule.name}`}
                                description="Choose the destination for future publications"
                                snapshot={{ revision, values: { channelId: schedule.channelId } }}
                                operation={(values) => ({
                                    type: "destination",
                                    ...binding,
                                    channelId: idValue(values.channelId, "schedule channel"),
                                })}
                                fields={channelField}
                            />
                            <ConfigForm<"schedules">
                                {...card}
                                title={`Schedule enabled ${schedule.name}`}
                                description="Enabling activates future eligible dates. Missed dates are not replayed"
                                snapshot={{ revision, values: { enabled: schedule.enabled } }}
                                operation={(values) => ({ type: values.enabled ? "enable" : "disable", ...binding })}
                                fields={(values, edit, disabled) => (
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(values.enabled)}
                                            disabled={disabled}
                                            onChange={(input) => edit("enabled", input.target.checked)}
                                        />
                                        Schedule enabled
                                    </label>
                                )}
                            />
                            {(["cancel", "forget"] as const).map((action) => (
                                <ConfigForm<"schedules">
                                    {...card}
                                    key={action}
                                    title={`${action === "cancel" ? "Cancel" : "Forget"} schedule ${schedule.name}`}
                                    description={
                                        action === "cancel"
                                            ? "Cancel future publication dates for this schedule"
                                            : "Forget this cancelled or terminal schedule and eligible retained records. Unresolved deliveries prevent removal, and a partial cleanup can need another request"
                                    }
                                    snapshot={{ revision, values: { confirm: false }, context: schedule.revision }}
                                    submitLabel={`${action === "cancel" ? "Cancel" : "Forget"} schedule`}
                                    operation={(values) => {
                                        confirm(values.confirm, `${action} schedule`)
                                        return action === "forget"
                                            ? { type: "forget", ...binding, confirm: "forget" }
                                            : { type: "cancel", ...binding }
                                    }}
                                    fields={(values, edit, disabled) => (
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(values.confirm)}
                                                disabled={disabled}
                                                onChange={(input) => edit("confirm", input.target.checked)}
                                            />
                                            Confirm {action} schedule
                                        </label>
                                    )}
                                />
                            ))}
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
