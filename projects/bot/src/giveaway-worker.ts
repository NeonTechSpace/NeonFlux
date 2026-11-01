import {
    GIVEAWAY_EMOJI,
    GIVEAWAY_ENTRANTS,
    GIVEAWAY_WORK_BATCH,
    giveawayCard,
    type Giveaway,
    type GiveawayCardOutcome,
    type GiveawayDeliveryContext,
    type GiveawayDue,
} from "@neonflux/contracts/giveaways"
import { ChannelType, errors, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Stream } from "effect"
import { randomInt } from "node:crypto"
import type { GiveawayStore } from "./giveaway-store.ts"
import { readNativeMembers } from "./member-evidence.ts"
import { sendOutcome } from "./moderation.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readAuthenticatedBotId, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import { serverLabel } from "./server-scope.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

export class GiveawayHandlingError extends Data.TaggedError("GiveawayHandlingError")<{
    readonly stage: "destination" | "response" | "grant"
}> {}
const noMentions = { users: [], roles: [], everyone: false, repliedUser: false }
/** Cards go to text and announcement channels, where members can react to one message */
export const giveawayChannel = (channel: { type: unknown } | undefined) =>
    channel?.type === ChannelType.Text || channel?.type === ChannelType.Announcement
export const giveawayPermissions =
    Permissions.ViewChannel | Permissions.SendMessages | Permissions.AddReactions | Permissions.ReadMessageHistory
export const giveawayPermissionNames = ["ViewChannel", "SendMessages", "AddReactions", "ReadMessageHistory"] as const
/** Members read in one request to Fluxer, which allows 100 */
const MEMBER_BATCH = 100
const MEMBER_READ_MS = 30000

/** The bot's fresh read of a card's destination. A missing channel or permission is a problem, and any other failed read tries again */
export function readGiveawayDestination(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const read = yield* readSafetyAuthority(client, serverId, botId, {
            channelId,
            permission: giveawayPermissions,
        }).pipe(
            Effect.map((authority) => ({ authority })),
            Effect.catch((error) =>
                error instanceof SafetyPermissionError &&
                (error.stage === "channel" ||
                    (error.operation === "channel" && (error.notFound || error.status === 403)))
                    ? Effect.succeed({ problem: error.status === 403 ? ("permission" as const) : ("channel" as const) })
                    : Effect.fail(error),
            ),
        )
        if ("problem" in read) return { problem: read.problem }
        const { authority } = read
        if (!giveawayChannel(authority.channel)) return { problem: "channel" as const }
        if (!authority.botPermissionAuthorized) return { problem: "permission" as const }
        const context: GiveawayDeliveryContext = {
            originServerId: authority.guild.id,
            observedAt: yield* Clock.currentTimeMillis,
            channelId,
            botId: authority.botId,
            botAuthorized: true,
        }
        return { context }
    })
}

/** A uniform shuffle from a cryptographic source. The draw takes candidates from its front */
export function drawOrder(ids: readonly string[], random: (range: number) => number = randomInt) {
    const order = [...ids]
    for (let index = order.length - 1; index > 0; index--) {
        const other = random(index + 1)
        ;[order[index], order[other]] = [order[other]!, order[index]!]
    }
    return order
}
const permissionFailure = (error: unknown) =>
    errors.apiCode(error) === "missingPermissions" || errors.apiCode(error) === "missingAccess"

/** How an edit of the card went. Only a refusal or a deleted card is known, and the rest may have reached Fluxer */
function editCard(client: Client, giveaway: Giveaway) {
    return Effect.gen(function* () {
        const edited = yield* Effect.exit(
            client.messages.edit(
                { channelId: giveaway.channelId, id: giveaway.messageId! },
                { content: giveawayCard(giveaway), allowedMentions: noMentions },
                { timeoutMs: 5000 },
            ),
        )
        if (Exit.isSuccess(edited)) return "sent" satisfies GiveawayCardOutcome
        if (Cause.hasInterrupts(edited.cause)) return yield* Effect.failCause(edited.cause)
        if (errors.isNotFound(Cause.squash(edited.cause))) return "gone" satisfies GiveawayCardOutcome
        const outcome = errors.outcome(edited.cause)
        return (
            outcome === "notDispatched" || outcome === "rejected" ? "failed" : "uncertain"
        ) satisfies GiveawayCardOutcome
    })
}

function postCard(
    store: GiveawayStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    item: GiveawayDue,
) {
    return Effect.gen(function* () {
        const destination = yield* readGiveawayDestination(client, serverId, item.channelId)
        if ("problem" in destination) {
            yield* store.work({
                serverId,
                operation: {
                    type: "blocked",
                    giveawayNo: item.giveawayNo,
                    channelId: item.channelId,
                    reason: destination.problem,
                },
            })
            return
        }
        const result = yield* store.work({
            serverId,
            operation: { type: "reserve", giveawayNo: item.giveawayNo, context: destination.context },
        })
        if (result.type === "skipped") return
        if (result.type !== "reserved") return yield* Effect.fail(new GiveawayHandlingError({ stage: "response" }))
        const grant = result.grant
        if (
            grant.consumer?.type !== "giveaway" ||
            grant.consumer.giveawayNo !== item.giveawayNo ||
            grant.actorId !== grant.botId ||
            grant.botId !== destination.context.botId ||
            grant.channelId !== item.channelId ||
            grant.action !== "send"
        )
            return yield* Effect.fail(new GiveawayHandlingError({ stage: "grant" }))
        const posted = yield* performPublishingGrant(publishing, serverId, grant.botId, client, grant, () =>
            readGiveawayDestination(client, serverId, item.channelId).pipe(
                Effect.flatMap((read) =>
                    "context" in read
                        ? Effect.succeed(read.context)
                        : Effect.fail(new GiveawayHandlingError({ stage: "destination" })),
                ),
            ),
        )
        if (posted.outcome !== "sent" || !posted.messageId) return
        // The entry emoji goes on once, and members can add it themselves when this fails
        const reacted = yield* Effect.exit(
            client.messages.addReaction({ channelId: item.channelId, id: posted.messageId }, GIVEAWAY_EMOJI, {
                timeoutMs: 5000,
            }),
        )
        if (Exit.isFailure(reacted)) {
            if (Cause.hasInterrupts(reacted.cause)) return yield* Effect.failCause(reacted.cause)
            yield* store.work({ serverId, operation: { type: "reaction", giveawayNo: item.giveawayNo } })
        }
    })
}

/** Reads the entries and picks winners. A failed read changes nothing, so a later pass reads again. Only a recorded draw has winners */
function draw(
    store: GiveawayStore,
    serverId: string,
    client: Client,
    giveawayNo: number,
    random: (range: number) => number,
) {
    return Effect.gen(function* () {
        const claim = yield* store.work({ serverId, operation: { type: "draw-claim", giveawayNo } })
        if (claim.type !== "draw") return false
        const { giveaway, count, excludeIds } = claim
        const botId = yield* readAuthenticatedBotId(client)
        const read = yield* Effect.exit(
            client.messages
                .iterateReactionUsers(
                    { channelId: giveaway.channelId, id: giveaway.messageId! },
                    GIVEAWAY_EMOJI,
                    { maxItems: GIVEAWAY_ENTRANTS + 1, pageSize: 100 },
                    { timeoutMs: 5000 },
                )
                .pipe(Stream.runCollect),
        )
        if (Exit.isFailure(read)) {
            if (Cause.hasInterrupts(read.cause)) return yield* Effect.failCause(read.cause)
            const error = Cause.squash(read.cause)
            if (errors.isNotFound(error))
                yield* store.work({
                    serverId,
                    operation: {
                        type: "draw-gone",
                        giveawayNo,
                        reason: errors.isNotFound(error, "channel") ? "channel" : "card",
                    },
                })
            else
                yield* store.work({
                    serverId,
                    operation: {
                        type: "defer",
                        giveawayNo,
                        ...(permissionFailure(error) ? { problem: "permission" as const } : {}),
                    },
                })
            return false
        }
        const users = [...read.value],
            capped = users.length > GIVEAWAY_ENTRANTS,
            excluded = new Set(excludeIds)
        const pool = users
            .slice(0, GIVEAWAY_ENTRANTS)
            .filter((user) => !user.isBot && user.id !== botId && !excluded.has(user.id))
            .map((user) => user.id)
        // Fresh reads of the candidates in draw order, until enough hold up or the pool ends. Only a confirmed absence is passed over, and a
        // candidate Fluxer did not answer for puts the whole draw off, so a failed read never costs an entrant their entry
        const order = drawOrder(pool, random),
            winnerIds: string[] = []
        for (let start = 0; start < order.length && winnerIds.length < count; start += MEMBER_BATCH) {
            const batch = order.slice(start, start + MEMBER_BATCH),
                members = yield* readNativeMembers(client, serverId, batch, MEMBER_READ_MS)
            for (const id of batch) {
                if (winnerIds.length === count) break
                const read = members.get(id)
                if (!read) {
                    yield* store.work({ serverId, operation: { type: "defer", giveawayNo } })
                    return false
                }
                if (read.member && (!giveaway.requiredRoleId || read.member.roleIds.includes(giveaway.requiredRoleId)))
                    winnerIds.push(id)
            }
        }
        const recorded = yield* store.work({
            serverId,
            operation: { type: "draw-record", giveawayNo, winnerIds, entrants: pool.length, capped },
        })
        return recorded.type === "progress" && recorded.recorded
    })
}

/** The edit that names the winners, then each new winner's DM. A failed DM stops nothing and is noted for staff */
function announce(store: GiveawayStore, serverId: string, client: Client, giveawayNo: number) {
    return Effect.gen(function* () {
        const claim = yield* store.work({ serverId, operation: { type: "announce-claim", giveawayNo } })
        if (claim.type !== "announce") return
        const { giveaway, winnerIds } = claim
        const card = yield* editCard(client, giveaway)
        const name = yield* serverLabel(client, serverId)
        const dms = []
        for (const userId of winnerIds) {
            const { outcome } = yield* sendOutcome(
                client.directMessages.send(
                    userId,
                    {
                        content: `You won ${giveaway.prize} in ${name}`,
                        allowedMentions: noMentions,
                    },
                    { timeoutMs: 5000 },
                ),
            )
            dms.push({ userId, outcome })
        }
        yield* store.work({ serverId, operation: { type: "announce-outcome", giveawayNo, card, dms } })
    })
}

function cancel(store: GiveawayStore, serverId: string, client: Client, giveawayNo: number) {
    return Effect.gen(function* () {
        const claim = yield* store.work({ serverId, operation: { type: "cancel-claim", giveawayNo } })
        if (claim.type !== "cancel") return
        const card = yield* editCard(client, claim.giveaway)
        yield* store.work({ serverId, operation: { type: "cancel-outcome", giveawayNo, card } })
    })
}

/** One due step of a giveaway. A draw announces its winners right away */
export function processGiveaway(
    store: GiveawayStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    item: GiveawayDue,
    random: (range: number) => number = randomInt,
) {
    return Effect.gen(function* () {
        if (item.action === "post") yield* postCard(store, publishing, serverId, client, item)
        else if (item.action === "cancel") yield* cancel(store, serverId, client, item.giveawayNo)
        else if (item.action === "announce") yield* announce(store, serverId, client, item.giveawayNo)
        else if (yield* draw(store, serverId, client, item.giveawayNo, random))
            yield* announce(store, serverId, client, item.giveawayNo)
    })
}

/** Pages of due giveaways one pass handles at most */
const PAGES_PER_PASS = 5
export function startGiveawayWorker(
    store: GiveawayStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
) {
    return Effect.gen(function* () {
        // A step that failed waits a minute, so the next page holds other giveaways
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const listed = yield* store.work({ serverId, operation: { type: "list" } })
                if (listed.type !== "due") return yield* Effect.fail(new GiveawayHandlingError({ stage: "response" }))
                for (const item of listed.items)
                    yield* processGiveaway(store, publishing, serverId, client, item).pipe(
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : store
                                      .work({ serverId, operation: { type: "defer", giveawayNo: item.giveawayNo } })
                                      .pipe(Effect.catch(() => Effect.void)),
                        ),
                    )
                if (listed.items.length < GIVEAWAY_WORK_BATCH) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Giveaways could not be checked. They stay due for the next check"),
        )
        // The work dispatcher wakes this worker once a giveaway is due
        return { notify: () => wake }
    })
}
