import {
    BOARD_TEXT_MAX,
    BoardDeliveryContext,
    BoardOperation,
    type BoardCard,
    type BoardDeliveryContext as BoardContext,
} from "@neonflux/contracts/boards"
import { cutText } from "@neonflux/contracts/common"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { publishingContent } from "./publishingDomain.ts"
import { neutralMentions } from "./memberContent.ts"
import { decode, fail } from "./validation.ts"

export { BOARD_LIMIT } from "@neonflux/contracts/boards"
export const BOARD_DAY_MS = 86400000
/** A queued post waits this long after a failed read, and a count changes on a card at most once in this time */
export const BOARD_RETRY_MS = 60000,
    BOARD_COUNT_MS = 60000
/** A record without a post, and a removal whose outcome stays unknown, ends after 30 days. A removal that keeps failing ends after a day */
export const BOARD_ENTRY_RETENTION_MS = 30 * BOARD_DAY_MS,
    BOARD_REMOVE_MS = BOARD_DAY_MS
export const BOARD_COUNT_FIELD = "Reactions"

export const boardOperation = (value: unknown): BoardOperation => decode(BoardOperation, value)
export function boardDeliveryContext(value: unknown, now = Date.now()): BoardContext {
    const context = decode(BoardDeliveryContext, value)
    if (context.observedAt < now - 60000 || context.observedAt > now + 1000) fail(400, "Invalid request")
    return context
}
const countValue = (emoji: string, count: number) => `${emoji} ${count}`
/**
 * The card. Mentions are neutralized, so nothing pings even if a client renders them. Text a content rule catches is left out with a
 * note: The card still points at the original, where the server's own rules apply, and a silent refusal would leave staff guessing
 */
export function renderBoardCard(card: BoardCard, emoji: string, withheld: boolean): PublishingContent {
    const text = withheld
        ? "The text of this post is withheld, because it breaks this server's content rules"
        : neutralMentions(card.text).trim()
    return publishingContent(
        {
            content: "",
            embed: {
                author: { name: cutText(neutralMentions(card.authorName), 256) },
                ...(text
                    ? { description: text.length > BOARD_TEXT_MAX ? `${cutText(text, BOARD_TEXT_MAX - 1)}…` : text }
                    : {}),
                ...(card.imageUrl ? { image: { url: card.imageUrl } } : {}),
                fields: [
                    { name: BOARD_COUNT_FIELD, value: countValue(emoji, card.count), inline: true },
                    { name: "Original", value: `[Jump to the message](${card.link})`, inline: true },
                ],
            },
        },
        true,
    )
}
/** The posted card with a new count, or undefined when it holds no count field */
export function withBoardCount(
    current: PublishingContent,
    emoji: string,
    count: number,
): PublishingContent | undefined {
    const fields = current.embed?.fields
    if (!fields?.some((field) => field.name === BOARD_COUNT_FIELD)) return undefined
    return publishingContent(
        {
            ...current,
            embed: {
                ...current.embed,
                fields: fields.map((field) =>
                    field.name === BOARD_COUNT_FIELD ? { ...field, value: countValue(emoji, count) } : field,
                ),
            },
        },
        true,
    )
}
