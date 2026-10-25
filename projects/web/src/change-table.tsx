import { backupSettingName } from "@neonflux/contracts/backup"
import { mentionText, type MentionNames } from "./mentions"

/** One changed setting. A missing before was added and a missing after removed. cut is the full length of a value shown only in part */
export interface FieldChange {
    path: string
    before?: unknown
    after?: unknown
    cut?: number
}
export const capital = (text: string) => text.replace(/^./, (letter) => letter.toUpperCase())
// The last key of a path without its list index, such as channelIds for logs[2].channelIds[0]
const leaf = (path: string) =>
    path
        .replace(/\[[^\]]*\]$/, "")
        .split(/[.[\]]/)
        .filter(Boolean)
        .at(-1) ?? ""
/**
 * A setting's value in words: no value is none, a switch is On or Off, and a channel, category or role ID is its name while the catalog
 * knows it
 */
const shown = (value: unknown, path: string, names?: MentionNames) => {
    if (value === undefined || value === null) return "none"
    if (typeof value === "boolean") return value ? "On" : "Off"
    if (typeof value !== "string") return mentionText(JSON.stringify(value), names)
    const key = leaf(path)
    if (key === "parentId") return names?.channels?.find((channel) => channel.id === value)?.name ?? value
    if (/^\d{1,20}$/.test(value) && /(^c|C)hannelIds?$/.test(key))
        return names?.channels?.some((channel) => channel.id === value) ? mentionText(`<#${value}>`, names) : value
    if (/^\d{1,20}$/.test(value) && /(^r|R)oleIds?$/.test(key))
        return names?.roles?.some((role) => role.id === value) ? mentionText(`<@&${value}>`, names) : value
    return mentionText(value, names)
}
/** A value in full: a long one starts collapsed behind its beginning, and is never cut */
export function Value({ value, path, names }: { value: unknown; path: string; names?: MentionNames | undefined }) {
    const text = shown(value, path, names)
    return text.length > 120 || text.includes("\n") ? (
        <details>
            <summary>{text.slice(0, 80).replaceAll("\n", " ")}…</summary>
            <pre>{text}</pre>
        </details>
    ) : (
        <>{text}</>
    )
}
/** Changed settings with their before and after values, as the backup restore check and the audit log's Details show them */
export function FieldChanges({ fields, names }: { fields: readonly FieldChange[]; names?: MentionNames | undefined }) {
    return (
        <table className="restore-diff">
            <thead>
                <tr>
                    <th>Change</th>
                    <th>Setting</th>
                    <th>Before</th>
                    <th>After</th>
                </tr>
            </thead>
            <tbody>
                {fields.map((field) => (
                    <tr key={field.path}>
                        <td data-label="Change">
                            {!("before" in field) ? "+ Added" : !("after" in field) ? "- Removed" : "~ Changed"}
                        </td>
                        <td data-label="Setting">
                            {mentionText(capital(backupSettingName(field.path)), names)}
                            {field.cut !== undefined && (
                                <p className="muted">
                                    Shows the first 8,000 of {field.cut.toLocaleString("en-US")} characters
                                </p>
                            )}
                        </td>
                        <td data-label="Before">
                            <Value value={field.before} path={field.path} names={names} />
                        </td>
                        <td data-label="After">
                            <Value value={field.after} path={field.path} names={names} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
