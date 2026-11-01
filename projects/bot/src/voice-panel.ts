import type { Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { serverReplyStyle } from "./general-settings.ts"
import { renderCard, type Card } from "./reply-style.ts"

// The room controls card in a temporary voice room's chat. Each reaction on it stands for a room command

/** Each reaction of the card and what it does */
export const VOICE_PANEL_EMOJI = {
    "\u{1F512}": "lock",
    "\u{1F648}": "hide",
    "\u{1F53C}": "limit-up",
    "\u{1F53D}": "limit-down",
    "\u{1F451}": "claim",
} as const
export type VoicePanelAction = (typeof VOICE_PANEL_EMOJI)[keyof typeof VOICE_PANEL_EMOJI]
export const voicePanelAction = (emoji: { readonly id?: string | null; readonly name?: string | null }) =>
    !emoji.id && emoji.name && Object.hasOwn(VOICE_PANEL_EMOJI, emoji.name)
        ? VOICE_PANEL_EMOJI[emoji.name as keyof typeof VOICE_PANEL_EMOJI]
        : undefined

/** The website page where a member controls their room, or undefined while the bot knows no website */
export const voiceRoomPage = (websiteUrl: string | undefined, serverId: string) =>
    websiteUrl ? `${websiteUrl}/?server=${serverId}&section=voice` : undefined

export const voicePanelCard = (page: string | undefined): Card => ({
    title: "Room controls",
    description: [
        "\u{1F512} Lock or unlock",
        "\u{1F648} Hide or show",
        "\u{1F53C} Raise the member limit",
        "\u{1F53D} Lower the member limit",
        "\u{1F451} Claim the room once its owner left",
    ].join("\n"),
    ...(page ? { note: `More controls: ${page}` } : {}),
})

/** Posts the card and adds its reactions. A reaction that cannot be added leaves the others, and members can still use them */
export function postVoicePanel(client: Client, serverId: string, channelId: string, page: string | undefined) {
    return Effect.gen(function* () {
        const [body] = renderCard(voicePanelCard(page), serverReplyStyle(serverId))
        const posted = yield* client.messages.send(channelId, { ...body! }, { timeoutMs: 5000 })
        return {
            messageId: posted.id,
            react: Effect.forEach(
                Object.keys(VOICE_PANEL_EMOJI),
                (emoji) => client.messages.addReaction(posted, emoji, { timeoutMs: 5000 }).pipe(Effect.ignore),
                { discard: true },
            ),
        }
    })
}
