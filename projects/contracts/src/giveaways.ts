import { Schema } from "effect"
import { Id, Int, List, Millis, origin, hasText } from "./common.ts"
import { PublishingGrant } from "./publishing-base.ts"
import { ModerationActor } from "./shared.ts"

// Giveaways, see docs/BOT.md#giveaways

/** Members enter by reacting with this emoji on the card */
export const GIVEAWAY_EMOJI = "\u{1F389}"
export const GIVEAWAY_LENGTH_SECONDS = [60, 5184000] as const
export const GIVEAWAY_WINNERS = [1, 20] as const
export const GIVEAWAY_PRIZE_LENGTH = 256
/** Giveaways that may run at once on a server */
export const GIVEAWAY_RUNNING = 25
/** Reactions read at a draw. Fluxer pages them by ascending account ID, so a larger giveaway counts the oldest accounts' reactions */
export const GIVEAWAY_ENTRANTS = 5000,
    GIVEAWAY_ENTRANTS_TEXT = "5,000"
/** Winners one giveaway records across its draw and rerolls, which keeps its card within Fluxer's message limit */
export const GIVEAWAY_WINNERS_STORED = 50
/** Due giveaways the worker handles per request */
export const GIVEAWAY_WORK_BATCH = 5
export const GIVEAWAY_PAGE = 10
/** Giveaways the dashboard shows, newest first */
export const GIVEAWAY_VIEW = 25
export const GIVEAWAY_DEFAULTS = { enabled: true, requiredRoleId: null } as const

const winnerCount = Int(GIVEAWAY_WINNERS[0], GIVEAWAY_WINNERS[1])
/** One line of visible text, since a prize appears in the card's title */
export const isGiveawayPrize = (value: string) =>
    value.length <= GIVEAWAY_PRIZE_LENGTH && !/[\r\n]/.test(value) && hasText(value)
export const GiveawayPrize = Schema.String.check(Schema.makeFilter(isGiveawayPrize))
/** The module switch and the role a member needs to win, which a giveaway copies when it starts */
export const GiveawaySettings = Schema.Struct({ enabled: Schema.Boolean, requiredRoleId: Schema.NullOr(Id) })
export type GiveawaySettings = typeof GiveawaySettings.Type
export const GiveawaySettingsPatch = Schema.Struct({
    enabled: Schema.optionalKey(Schema.Boolean),
    requiredRoleId: Schema.optionalKey(Schema.NullOr(Id)),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0))
export type GiveawaySettingsPatch = typeof GiveawaySettingsPatch.Type
export const GiveawayState = Schema.Literals(["running", "ended", "cancelled"])
export type GiveawayState = typeof GiveawayState.Type
/**
 * What the giveaway waits for next. post waits to be posted and sending holds a publishing attempt, while blocked waits for staff to settle
 * a post with an unknown outcome. wait waits for its end time, or for a reroll. draw reads the entries. announce and cancel owe the card an
 * edit, announcing and cancelling hold that edit's claim. done has nothing left to do
 */
export const GiveawayPhase = Schema.Literals([
    "post",
    "sending",
    "blocked",
    "wait",
    "draw",
    "announce",
    "announcing",
    "cancel",
    "cancelling",
    "done",
])
export type GiveawayPhase = typeof GiveawayPhase.Type
/**
 * What staff should know. channel and card mean the channel or the card was deleted, which ended the giveaway, and permission that
 * NeonFlux cannot read the entries or post, which it tries again. post-failed and post-uncertain concern the card's post, post-late a card whose giveaway ended before it could go out, result-failed and
 * result-uncertain the edit that names the winners or the cancellation, and reaction the entry emoji NeonFlux could not add
 */
export const GiveawayProblem = Schema.Literals([
    "channel",
    "card",
    "permission",
    "post-failed",
    "post-late",
    "post-uncertain",
    "result-failed",
    "result-uncertain",
    "reaction",
])
export type GiveawayProblem = typeof GiveawayProblem.Type
export const GiveawayDm = Schema.Literals(["pending", "sending", "sent", "failed", "uncertain"])
export type GiveawayDm = typeof GiveawayDm.Type
/** drawNo is 1 for the first draw and counts up with each reroll */
export const GiveawayWinner = Schema.Struct({ userId: Id, drawNo: Int(1), dm: GiveawayDm })
export type GiveawayWinner = typeof GiveawayWinner.Type
/** hostId is gone once a host deleted their data from a finished giveaway. entrants and capped describe the latest draw */
export const Giveaway = Schema.Struct({
    giveawayNo: Int(1),
    hostId: Schema.optionalKey(Id),
    channelId: Id,
    prize: GiveawayPrize,
    winnerCount,
    requiredRoleId: Schema.optionalKey(Id),
    endsAt: Millis,
    createdAt: Millis,
    endedAt: Schema.optionalKey(Millis),
    state: GiveawayState,
    phase: GiveawayPhase,
    messageId: Schema.optionalKey(Id),
    postNo: Schema.optionalKey(Int(1)),
    problem: Schema.optionalKey(GiveawayProblem),
    entrants: Schema.optionalKey(Int()),
    capped: Schema.optionalKey(Schema.Literal(true)),
    winners: List(GiveawayWinner, GIVEAWAY_WINNERS_STORED),
})
export type Giveaway = typeof Giveaway.Type
export const GiveawayOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), patch: GiveawaySettingsPatch }),
    Schema.Struct({
        type: Schema.Literal("start"),
        lengthSeconds: Int(GIVEAWAY_LENGTH_SECONDS[0], GIVEAWAY_LENGTH_SECONDS[1]),
        winners: winnerCount,
        channelId: Id,
        prize: GiveawayPrize,
    }),
    Schema.Struct({ type: Schema.Literal("end"), giveawayNo: Int(1) }),
    /** count defaults to the giveaway's number of winners */
    Schema.Struct({ type: Schema.Literal("reroll"), giveawayNo: Int(1), count: Schema.optionalKey(winnerCount) }),
    Schema.Struct({ type: Schema.Literal("cancel"), giveawayNo: Int(1) }),
])
export type GiveawayOperation = typeof GiveawayOperation.Type
/** actor carries a fresh read. Every operation needs the server owner, Manage community or Administrator */
export const GiveawayManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    operation: GiveawayOperation,
})
export type GiveawayManageRequest = typeof GiveawayManageRequest.Type
export const GiveawayManageResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: GiveawaySettings }),
    Schema.Struct({ type: Schema.Literal("giveaway"), giveaway: Giveaway }),
])
export type GiveawayManageResult = typeof GiveawayManageResult.Type
/** One giveaway by giveawayNo, or the page of the newest ones below beforeNo */
export const GiveawayQueryRequest = Schema.Struct({
    serverId: Id,
    giveawayNo: Schema.optionalKey(Int(1)),
    beforeNo: Schema.optionalKey(Int(1)),
})
export type GiveawayQueryRequest = typeof GiveawayQueryRequest.Type
export const GiveawayQueryResult = Schema.Struct({
    settings: GiveawaySettings,
    running: Int(0, GIVEAWAY_RUNNING),
    giveaways: List(Giveaway, GIVEAWAY_PAGE),
    nextBeforeNo: Schema.optionalKey(Int(1)),
})
export type GiveawayQueryResult = typeof GiveawayQueryResult.Type
/** The dashboard's view: Settings and the newest giveaways */
export const GiveawayView = Schema.Struct({
    settings: GiveawaySettings,
    giveaways: List(Giveaway, GIVEAWAY_VIEW),
})
export type GiveawayView = typeof GiveawayView.Type
/** The bot's fresh read of a card's destination, acting as itself */
export const GiveawayDeliveryContext = Schema.Struct({
    ...origin,
    observedAt: Millis,
    channelId: Id,
    botId: Id,
    botAuthorized: Schema.Literal(true),
})
export type GiveawayDeliveryContext = typeof GiveawayDeliveryContext.Type
export const GiveawayAction = Schema.Literals(["post", "draw", "announce", "cancel"])
export type GiveawayAction = typeof GiveawayAction.Type
export const GiveawayDue = Schema.Struct({ giveawayNo: Int(1), channelId: Id, action: GiveawayAction })
export type GiveawayDue = typeof GiveawayDue.Type
/** How an edit of the card went. gone means the card or its channel no longer exists */
export const GiveawayCardOutcome = Schema.Literals(["sent", "gone", "failed", "uncertain"])
export type GiveawayCardOutcome = typeof GiveawayCardOutcome.Type
const giveawayNo = Int(1)
/**
 * list returns what is due. reserve claims a card's post for the publisher, blocked ends a giveaway whose destination is gone, and defer
 * waits after a failed read. draw-claim, draw-record and draw-gone cover a draw, announce-claim and announce-outcome the edit that names
 * its winners and their DMs, cancel-claim and cancel-outcome the edit of a cancelled card. Each claim comes before its native work, and a
 * claim that never reported counts as uncertain. reaction records an entry emoji that could not be added and confirm a card read back that
 * shows the expected text
 */
export const GiveawayWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({ type: Schema.Literal("reserve"), giveawayNo, context: GiveawayDeliveryContext }),
    Schema.Struct({
        type: Schema.Literal("blocked"),
        giveawayNo,
        channelId: Id,
        reason: Schema.Literals(["channel", "permission"]),
    }),
    Schema.Struct({
        type: Schema.Literal("defer"),
        giveawayNo,
        problem: Schema.optionalKey(Schema.Literal("permission")),
    }),
    Schema.Struct({ type: Schema.Literal("draw-claim"), giveawayNo }),
    Schema.Struct({
        type: Schema.Literal("draw-record"),
        giveawayNo,
        winnerIds: List(Id, GIVEAWAY_WINNERS[1]),
        entrants: Int(0, GIVEAWAY_ENTRANTS),
        capped: Schema.Boolean,
    }),
    Schema.Struct({ type: Schema.Literal("draw-gone"), giveawayNo, reason: Schema.Literals(["channel", "card"]) }),
    Schema.Struct({ type: Schema.Literal("announce-claim"), giveawayNo }),
    Schema.Struct({
        type: Schema.Literal("announce-outcome"),
        giveawayNo,
        card: GiveawayCardOutcome,
        dms: List(
            Schema.Struct({ userId: Id, outcome: Schema.Literals(["sent", "failed", "uncertain"]) }),
            GIVEAWAY_WINNERS[1],
        ),
    }),
    Schema.Struct({ type: Schema.Literal("cancel-claim"), giveawayNo }),
    Schema.Struct({ type: Schema.Literal("cancel-outcome"), giveawayNo, card: GiveawayCardOutcome }),
    Schema.Struct({ type: Schema.Literal("reaction"), giveawayNo }),
    Schema.Struct({ type: Schema.Literal("confirm"), giveawayNo }),
])
export type GiveawayWorkOperation = typeof GiveawayWorkOperation.Type
export const GiveawayWorkRequest = Schema.Struct({ serverId: Id, operation: GiveawayWorkOperation })
export type GiveawayWorkRequest = typeof GiveawayWorkRequest.Type
export const GiveawayWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("due"), items: List(GiveawayDue, GIVEAWAY_WORK_BATCH) }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: PublishingGrant }),
    /** Nothing to do, since another pass took this work or the giveaway changed */
    Schema.Struct({ type: Schema.Literal("skipped") }),
    /** count is how many winners to draw, and excludeIds the earlier winners */
    Schema.Struct({
        type: Schema.Literal("draw"),
        giveaway: Giveaway,
        count: winnerCount,
        excludeIds: List(Id, GIVEAWAY_WINNERS_STORED),
    }),
    /** winnerIds are the winners of the draw this edit announces, whom NeonFlux tells by DM */
    Schema.Struct({ type: Schema.Literal("announce"), giveaway: Giveaway, winnerIds: List(Id, GIVEAWAY_WINNERS[1]) }),
    Schema.Struct({ type: Schema.Literal("cancel"), giveaway: Giveaway }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])
export type GiveawayWorkResult = typeof GiveawayWorkResult.Type

/** What a giveaway without stored winners shows where its winners go */
export const noWinnersText = (giveaway: Giveaway) =>
    giveaway.state === "running"
        ? `${giveaway.winnerCount} to draw`
        : giveaway.state === "ended" && giveaway.entrants !== undefined
          ? "None, no valid entries"
          : "None"
const seconds = (ms: number) => Math.floor(ms / 1000)
const list = (ids: readonly string[]) => ids.map((id) => `<@${id}>`).join(", ")
/**
 * The one message that shows a giveaway, which the backend reserves and the bot edits, with mentions that never notify. Winners are
 * named per draw, so a reroll adds its line and the earlier winners stay on record
 */
export function giveawayCard(giveaway: Giveaway) {
    const title = `Giveaway #${giveaway.giveawayNo}`,
        host = giveaway.hostId ? [`Hosted by <@${giveaway.hostId}>`] : []
    if (giveaway.state === "cancelled") return [`**${title} cancelled: ${giveaway.prize}**`, ...host].join("\n")
    if (giveaway.state === "ended") {
        const draws = new Map<number, string[]>()
        for (const winner of giveaway.winners)
            draws.set(winner.drawNo, [...(draws.get(winner.drawNo) ?? []), winner.userId])
        const lines = [...draws]
            .sort(([a], [b]) => a - b)
            .map(([drawNo, ids]) => `${drawNo === 1 ? "Winners" : "Rerolled"}: ${list(ids)}`)
        return [
            `**${title} ended: ${giveaway.prize}**`,
            `Ended <t:${seconds(giveaway.endedAt ?? giveaway.endsAt)}:f>`,
            ...(lines.length ? lines : ["No winner: No valid entries"]),
            ...host,
            ...(giveaway.capped ? [`Only the first ${GIVEAWAY_ENTRANTS_TEXT} entries by account age were read`] : []),
        ].join("\n")
    }
    return [
        `**${title}: ${giveaway.prize}**`,
        `Ends <t:${seconds(giveaway.endsAt)}:f>, <t:${seconds(giveaway.endsAt)}:R>`,
        `Winners: ${giveaway.winnerCount}`,
        ...host,
        ...(giveaway.requiredRoleId ? [`Needs the role <@&${giveaway.requiredRoleId}> to win`] : []),
        `React with ${GIVEAWAY_EMOJI} to enter`,
    ].join("\n")
}
