import { LFG_WORK_PAGE, type LfgGroup } from "@neonflux/contracts/lfg"
import { format, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Effect } from "effect"
import { replyPrefix } from "./general-settings.ts"
import type { LfgStore } from "./lfg-store.ts"
import { at, code } from "./reply-style.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

type LfgCardState =
    { readonly state: "open" | "cancelled" | "expired" } | { readonly state: "started"; readonly roomId: string }

/** The one message that shows a group. Its mentions name members without notifying them */
export function lfgCard(group: LfgGroup, card: LfgCardState, prefix: string) {
    const footer =
        card.state === "open"
            ? `Join with ${code(`${prefix}lfg join ${group.groupNo}`)}. Open until ${at(group.expiresAt)}`
            : card.state === "started"
              ? `Started in ${format.channelMention(card.roomId)}`
              : card.state === "cancelled"
                ? "Cancelled"
                : "Closed before it filled"
    return [
        `**Group #${group.groupNo}: ${group.activity}** ${group.memberIds.length} of ${group.size}`,
        `Host: ${format.userMention(group.hostId)}`,
        `Members: ${group.memberIds.map(format.userMention).join(", ")}`,
        ...(group.startsAt !== undefined ? [`Starts ${at(group.startsAt)}`] : []),
        ...(group.note ? [`Note: ${group.note}`] : []),
        footer,
    ].join("\n")
}
/** Brings a group's card up to date. A card that cannot be edited, for example because staff deleted it, stays as it is */
export function updateLfgCard(client: Client, serverId: string, group: LfgGroup, card: LfgCardState) {
    if (!group.messageId) return Effect.void
    return client.messages
        .edit(
            { channelId: group.channelId, id: group.messageId },
            { content: lfgCard(group, card, replyPrefix(serverId, serverId)) },
            { timeoutMs: 5000 },
        )
        .pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.logWarning("A group card could not be updated"),
            ),
        )
}

/** Pages of expired groups one pass closes at most */
const PAGES_PER_PASS = 10
export function startLfgWorker(store: LfgStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        // The backend closes the groups it returns, so the next page holds other groups
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const { groups } = yield* store.work({ serverId })
                for (const group of groups) yield* updateLfgCard(client, serverId, group, { state: "expired" })
                if (groups.length < LFG_WORK_PAGE) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Expired groups could not be closed. They stay due for the next check"),
        )
        // The work dispatcher wakes this worker once groups are due
        return { notify: () => wake }
    })
}
