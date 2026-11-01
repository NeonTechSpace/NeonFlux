import {
    REMINDER_MEMBER_LIMITS,
    REMINDER_SECONDS,
    REMINDER_TEXT_LENGTH,
    type ReminderSettingsPatch,
} from "@neonflux/contracts/reminders"
import { durationSeconds, wholeNumber } from "./command-arguments.ts"

export type RemindCommand =
    | { type: "help" }
    | { type: "create"; seconds: number; text: string }
    | { type: "list"; next: boolean }
    | { type: "cancel"; reminderNo: number }
    | { type: "settings" }
    | { type: "settings-set"; patch: ReminderSettingsPatch }

export const remindHelp = [
    "!remind <duration> <text>: Get a DM after a duration from 1m to 1y, such as !remind 2h take out the bins",
    "!remind list [next]: Your reminders on this server, sent to you by DM",
    "!remind cancel <number>: Cancel one of your reminders",
    "!remind settings: Whether reminders are on and the limit each member has",
    "!remind module on|off: Turn reminders on or off, for managers",
    `!remind limit <${REMINDER_MEMBER_LIMITS.join("-")}>: Reminders each member can keep, for managers`,
].join("\n")

const usage = "Check the command. Use !remind help"
/** Settings changes are manager commands. Every other form is a member command */
export const remindStaff = (command: RemindCommand | { error: string }) =>
    "type" in command && command.type === "settings-set"
/** Turning reminders off stays in reach at DEFCON 1 */
export const remindCritical = (command: RemindCommand | { error: string }) =>
    "type" in command && command.type === "settings-set" && command.patch.enabled === false

/**
 * The words of a command, and its source after the prefix so a reminder's text is stored exactly as typed. Quotes mean nothing in that
 * text, so args is undefined only when the other forms cannot be read, and a reminder still can
 */
export function parseRemindCommand(
    args: readonly string[] | undefined,
    source: string,
): RemindCommand | { error: string } {
    const parts = /^\S+\s+(\S+)(?:\s+([\s\S]*))?$/u.exec(source.trim()),
        first = parts?.[1]
    if (!first) return { type: "help" }
    const seconds = durationSeconds(first, REMINDER_SECONDS[0], REMINDER_SECONDS[1])
    if (seconds !== undefined) {
        const text = parts[2]?.trim()
        if (!text) return { error: "Say what to remind you of, such as !remind 2h take out the bins" }
        if (text.length > REMINDER_TEXT_LENGTH)
            return { error: `Reminders hold up to ${REMINDER_TEXT_LENGTH} characters` }
        return { type: "create", seconds, text }
    }
    const verb = first.toLowerCase()
    if (!args) return { error: "Check the quoting. Use !remind help" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "settings" && args.length === 1) return { type: "settings" }
    if (verb === "list" && args.length === 1) return { type: "list", next: false }
    if (verb === "list" && args.length === 2 && args[1]!.toLowerCase() === "next") return { type: "list", next: true }
    if (verb === "cancel") {
        const reminderNo = args.length === 2 ? wholeNumber(args[1]!.replace(/^#/, ""), 1, 999999) : undefined
        return reminderNo ? { type: "cancel", reminderNo } : { error: "Name the reminder, such as !remind cancel 3" }
    }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!.toLowerCase()))
        return { type: "settings-set", patch: { enabled: args[1]!.toLowerCase() === "on" } }
    if (verb === "limit") {
        const memberLimit = args.length === 2 ? wholeNumber(args[1], ...REMINDER_MEMBER_LIMITS) : undefined
        return memberLimit
            ? { type: "settings-set", patch: { memberLimit } }
            : { error: `Choose the limit from ${REMINDER_MEMBER_LIMITS.join(" to ")}` }
    }
    // A word that reads as a length but lies outside the range, such as 30s or 2y
    if (/^\d/.test(first))
        return { error: "A reminder comes due from 1 minute to 1 year from now, such as 30m, 2h or 7d" }
    return { error: usage }
}
