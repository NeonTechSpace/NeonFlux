import { REMINDER_WORK_BATCH, type ClaimedReminder, type ReminderOutcome } from "@neonflux/contracts/reminders"
import { errors, format, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Effect, Exit, Cause } from "effect"
import { readChannelParent } from "./channel-parents.ts"
import { readNativeMember } from "./member-evidence.ts"
import type { ReminderStore } from "./remind-store.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"
import { serverLabel } from "./server-scope.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

const noMentions = { users: [], roles: [], everyone: false, repliedUser: false }
const posting = Permissions.ViewChannel | Permissions.SendMessages

/**
 * What became of a send. refused is Fluxer's own answer, a 4xx other than a rate limit, which alone lets private text move to a channel.
 * retry means nothing was sent, such as after a rate limit or a connection failure, and uncertain that it may have been
 */
function sendResult(send: Effect.Effect<unknown, unknown>) {
    return Effect.gen(function* () {
        const result = yield* Effect.exit(send)
        if (Exit.isSuccess(result)) return "sent" as const
        if (Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        const failure = Cause.squash(result.cause) as { readonly status?: unknown } | undefined,
            status = typeof failure?.status === "number" ? failure.status : undefined
        // A refusal of the step that opens the DM counts too, although the message itself was then never dispatched
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) return "refused" as const
        return status === 429 || errors.outcome(result.cause) === "notDispatched" || errors.isRetryable(result.cause)
            ? ("retry" as const)
            : ("uncertain" as const)
    })
}

// A post in the reminder's channel for a member NeonFlux could not DM: Only where NeonFlux can post and the server's content rules let the
// text through. Whatever stops it leaves the reminder undelivered, and only an unknown outcome is uncertain
function postInChannel(
    store: ReminderStore,
    client: Client,
    serverId: string,
    reminder: ClaimedReminder,
    roleIds: readonly string[],
) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, {
            channelId: reminder.channelId,
            permission: posting,
        })
        if (!authority.botPermissionAuthorized) return "undelivered" as const
        const parentChannelId = yield* readChannelParent(client, reminder.channelId)
        const checked = yield* store.work({
            serverId,
            operation: {
                type: "check",
                userId: reminder.userId,
                reminderNo: reminder.reminderNo,
                roleIds: [...roleIds],
                ...(parentChannelId ? { parentChannelId } : {}),
            },
        })
        if (checked.type !== "check" || !checked.allowed) return "undelivered" as const
        const outcome = yield* sendResult(
            client.messages.send(
                reminder.channelId,
                {
                    content: `${format.userMention(reminder.userId)} NeonFlux could not DM you this reminder: ${reminder.text}`,
                    allowedMentions: noMentions,
                },
                { timeoutMs: 5000 },
            ),
        )
        return outcome === "sent" ? ("delivered" as const) : outcome === "refused" ? ("undelivered" as const) : outcome
    }).pipe(
        Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed("undelivered" as const),
        ),
    )
}

/** One claimed reminder, which is sent at most once. A member who left is skipped, and a failed read of the member sends nothing and waits */
export function deliverReminder(store: ReminderStore, client: Client, serverId: string, reminder: ClaimedReminder) {
    return Effect.gen(function* () {
        const read = yield* Effect.exit(readNativeMember(client, serverId, reminder.userId))
        if (Exit.isFailure(read) && Cause.hasInterrupts(read.cause)) return yield* Effect.failCause(read.cause)
        let outcome: ReminderOutcome
        if (Exit.isFailure(read)) outcome = "retry"
        else if (!read.value.member) outcome = "skipped"
        else {
            const name = yield* serverLabel(client, serverId)
            const dm = yield* sendResult(
                client.directMessages.send(
                    reminder.userId,
                    { content: `Reminder from ${name}: ${reminder.text}`, allowedMentions: noMentions },
                    { timeoutMs: 5000 },
                ),
            )
            outcome =
                dm === "sent"
                    ? "delivered"
                    : dm === "refused"
                      ? yield* postInChannel(store, client, serverId, reminder, read.value.member.roleIds)
                      : dm
        }
        yield* store.work({
            serverId,
            operation: { type: "outcome", userId: reminder.userId, reminderNo: reminder.reminderNo, outcome },
        })
        return outcome
    })
}

/** Pages of due reminders one pass handles at most. A busy minute continues on the next wake, since the dispatcher still sees what is due */
const PAGES_PER_PASS = 10
export function startReminderWorker(store: ReminderStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const claimed = yield* store.work({ serverId, operation: { type: "claim" } })
                if (claimed.type !== "claimed") return
                // A failed report leaves its claim, which turns uncertain. The rest of the page still goes out
                for (const reminder of claimed.reminders)
                    yield* deliverReminder(store, client, serverId, reminder).pipe(
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.void,
                        ),
                    )
                if (claimed.reminders.length < REMINDER_WORK_BATCH) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Reminders could not be checked. They stay due for the next check"),
        )
        // The work dispatcher wakes this worker once reminders are due
        return { notify: () => wake }
    })
}
