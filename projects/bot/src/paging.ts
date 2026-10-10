/**
 * Lists page with `next`. Each reply remembers where its page ended, and the same list sent again with `next` continues there.
 * Positions stay in memory for each server, channel, member and list, so a restart starts every list again
 */
const positions = new Map<string, unknown>()
/** Positions kept at once. The oldest is forgotten first */
const LIMIT = 10_000

/** One member's list in one channel, named by the command words that select it, such as event, dates and the event name */
export function pageKey(serverId: string, message: { readonly channelId: string, readonly author: { readonly id: string } }, ...list: readonly (string | number | undefined)[]) {
    return JSON.stringify([serverId, message.channelId, message.author.id, ...list])
}
/** Where the member's last page of this list ended, or undefined when no page with more after it was shown */
export function nextPosition<T>(key: string): T | undefined {
    return positions.get(key) as T | undefined
}
/** Remember where a page ended, or forget the list once its last page was shown */
export function rememberPosition(key: string, position: unknown) {
    positions.delete(key)
    if (position === undefined) return
    positions.set(key, position)
    if (positions.size > LIMIT) positions.delete(positions.keys().next().value!)
}
/** The reply to `next` when no page of that list with more after it is remembered */
export const noNextPage = (start: string) => `There is no next page to show. Send ${start} to start the list again`
