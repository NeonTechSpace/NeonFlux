import type { SuggestionsState } from "@neonflux/contracts/suggestions"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { publishingContent } from "./publishingDomain.ts"
import { fail, integer } from "./validation.ts"

export { SUGGESTIONS_DAY, SUGGESTIONS_BATCH } from "@neonflux/contracts/suggestions"
export const advanceSuggestion = (n: number) => integer(n + 1, 1, Number.MAX_SAFE_INTEGER)
export const terminalSuggestion = (state: SuggestionsState) => state === "completed" || state === "declined" || state === "withdrawn"
export function renderSuggestion(row: { suggestionNo: number, authorId: string, text: string, state: SuggestionsState, up: number, down: number, reason?: string }): PublishingContent {
    return publishingContent({ content: "", embed: { title: `Suggestion #${row.suggestionNo}`, description: row.text, fields: [
        { name: "Author", value: `<@${row.authorId}>` }, { name: "State", value: row.state },
        { name: "Votes", value: `Up: ${row.up} | Down: ${row.down}` },
        ...(row.reason ? [{ name: "Status reason", value: row.reason }] : []),
    ] } }, true)
}
export async function suggestionDigest(value: unknown) {
    const secret = process.env.NEONFLUX_BOT_API_SECRET
    if (!secret) fail(503, "Suggestion source binding unavailable")
    const encoder = new TextEncoder(), key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(value)))
    return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("")
}
