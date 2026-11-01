import type {
    Reminder,
    ReminderManageResult,
    ReminderOperation,
    ReminderSettings,
    ReminderSettingsPatch,
} from "@neonflux/contracts/reminders"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { errors, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { remindHelp, type RemindCommand } from "./remind-command.ts"
import { ReminderStoreError, type ReminderStore } from "./remind-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { at, code, notSetUp, onOff, replyCard, replyText, sendCard, snippet, type Card } from "./reply-style.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"

const managers = "the server owner or members with Manage community"
const PAGE = 10
function refusal(result: Extract<ReminderManageResult, { type: "refused" }>) {
    switch (result.reason) {
        case "off":
            return "Reminders are off on this server"
        case "member-limit":
            return `You already keep ${result.limit} reminders here, the limit. Cancel one with !remind cancel <number>`
        case "server-limit":
            return "This server keeps as many reminders as it can right now. Try again later"
        case "missing":
            return "You have no reminder with that number. Check !remind list"
    }
}
function describe(error: unknown) {
    if (error instanceof ReminderStoreError) {
        if (error.status === 403) return `Only ${managers} can change reminder settings`
        if (error.status === 400) return "Check the command values. Use !remind help"
        return "Reminders are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The reminder command could not be completed"
}
const stateText = (row: Reminder) =>
    row.state === "active"
        ? `Due ${at(row.dueAt)}`
        : row.state === "sending"
          ? "Being sent now"
          : row.state === "uncertain"
            ? `Due ${at(row.dueAt)}, not confirmed as sent. NeonFlux never sends a reminder twice`
            : `Due ${at(row.dueAt)}, could not be delivered`
/** One page of a member's reminders. Its text is theirs alone, so the card goes by DM */
export function reminderList(rows: readonly Reminder[], page: number, pages: number, prefix: string): Card {
    return {
        title: "Your reminders",
        ...(rows.length
            ? {
                  description: rows
                      .map((row) => `**#${row.reminderNo}** ${stateText(row)}: ${snippet(row.text, 80)}`)
                      .join("\n"),
                  note: `Cancel one in the server with ${code(`${prefix}remind cancel <number>`)}`,
                  ...(page < pages ? { fields: [["Next", code(`${prefix}remind list next`)] as const] } : {}),
              }
            : {
                  description: `No reminders. Set one in the server with ${code(`${prefix}remind 2h take out the bins`)}`,
              }),
    }
}
const settingsCard = (settings: ReminderSettings): Card => ({
    title: "Personal reminders",
    fields: [
        ["Status", onOff(settings.enabled)],
        ["Each member keeps", `Up to ${settings.memberLimit}`],
    ],
})
function settingsChange(patch: ReminderSettingsPatch, settings: ReminderSettings) {
    if (patch.enabled !== undefined)
        return settings.enabled
            ? "Reminders are on"
            : "Reminders are off. Reminders already set wait until they are on again, and members can still list and cancel them"
    return `Each member can now keep up to ${settings.memberLimit} reminders`
}

export function handleRemindCommand(
    store: ReminderStore | undefined,
    config: BotConfig,
    command: RemindCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId),
        reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId,
            userId = message.author.id
        if (message.guildId !== serverId) return
        if (!store) {
            yield* reply(notSetUp("Reminders"))
            return
        }
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(remindHelp)
            return
        }
        if (command.type === "settings") {
            yield* replyCard(context, serverId, settingsCard((yield* store.query({ serverId })).settings))
            return
        }
        if (command.type === "list") {
            const key = pageKey(serverId, message, "remind", "list"),
                next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) {
                yield* reply(noNextPage("!remind list"))
                return
            }
            const { reminders } = yield* store.query({ serverId, userId }),
                pages = Math.max(1, Math.ceil(reminders.length / PAGE)),
                page = Math.min(next, pages)
            const sent = yield* Effect.exit(
                client.directMessages
                    .open(userId, { timeoutMs: 5000 })
                    .pipe(
                        Effect.flatMap((dm) =>
                            sendCard(
                                client,
                                dm.id,
                                config,
                                reminderList(reminders.slice((page - 1) * PAGE, page * PAGE), page, pages, prefix),
                            ),
                        ),
                    ),
            )
            if (Exit.isFailure(sent) && Cause.hasInterrupts(sent.cause)) return yield* Effect.failCause(sent.cause)
            if (Exit.isFailure(sent)) {
                const outcome = errors.outcome(sent.cause)
                yield* reply(
                    outcome === "notDispatched" || outcome === "rejected"
                        ? "NeonFlux could not DM you. Open your DMs for this server and send !remind list again"
                        : "NeonFlux could not confirm your DM. Check it before you ask again",
                )
                return
            }
            rememberPosition(key, page < pages ? page + 1 : undefined)
            yield* reply(
                `You have ${reminders.length} reminder${reminders.length === 1 ? "" : "s"} here. NeonFlux sent the list to your DMs`,
            )
            return
        }
        const source = {
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
        }
        const member: ModerationActor = {
            originServerId: serverId,
            userId,
            roleIds: [],
            isOwner: false,
            isAdministrator: false,
            nativePermissionAuthorized: false,
        }
        const manage = (operation: ReminderOperation, actor = member, managerAuthorized = false) =>
            store.manage({ ...source, actor, managerAuthorized, operation })
        if (command.type === "settings-set") {
            const { actor, manager } = yield* readServerManager(client, serverId, userId)
            if (!manager) {
                yield* reply(`Only ${managers} can change reminder settings`)
                return
            }
            const saved = yield* manage({ type: "settings", patch: command.patch }, actor, true)
            if (saved.type === "settings") yield* reply(settingsChange(command.patch, saved.settings))
            return
        }
        const result = yield* manage(
            command.type === "cancel"
                ? { type: "cancel", reminderNo: command.reminderNo }
                : { type: "create", seconds: command.seconds, text: command.text, channelId: message.channelId },
        )
        if (result.type === "refused") yield* reply(refusal(result))
        else if (result.type === "cancelled") yield* reply(`Reminder #${result.reminderNo} cancelled`)
        else if (result.type === "created")
            yield* reply(
                `Reminder #${result.reminder.reminderNo} set for ${at(result.reminder.dueAt)}. NeonFlux will DM you`,
            )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
