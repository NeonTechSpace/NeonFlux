import { useState } from "react"
import type { SchedulesDefinition } from "@neonflux/contracts/schedules"
import { civilRepeatText } from "@neonflux/contracts/civil"
import { MessagePreview } from "./message-builder"
import { localTime } from "./time"

/** A UTC offset in minutes as shown beside a local time, such as UTC+02:00 or UTC-05:30 */
const offsetName = (minutes: number) =>
    `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`
/** What a saved schedule posts and when, read from its own copied content and its stored upcoming dates, never from the
 *  source's latest version. It mounts only when opened, so the saved message's images load on request */
export function SchedulePreview({ schedule }: { schedule: SchedulesDefinition }) {
    const [open, setOpen] = useState(false),
        now = Date.now(),
        dates = schedule.upcoming ?? schedule.calendar.dates.filter((date) => date.dueAt > now)
    return (
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>What it posts and when</summary>
            {open && (
                <>
                    <MessagePreview message={schedule.content} heading="Saved message" />
                    <p className="muted">{civilRepeatText(schedule.calendar.recurrence)}</p>
                    {dates.length ? (
                        <table className="audit-table">
                            <caption>Upcoming dates in {schedule.calendar.zone}</caption>
                            <thead>
                                <tr>
                                    <th>Schedule time</th>
                                    <th>Your time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dates.map((date) => (
                                    <tr key={date.dueAt}>
                                        <td>
                                            {date.localMinute.replace("T", " ")} ({offsetName(date.offsetMinutes)})
                                        </td>
                                        <td>{localTime(date.dueAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="muted">No upcoming dates</p>
                    )}
                </>
            )}
        </details>
    )
}
