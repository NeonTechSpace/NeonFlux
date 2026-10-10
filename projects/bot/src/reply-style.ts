import { format, text, TimestampStyles, type BotEventContext, type Client, type EmbedFieldInput, type EmbedInput } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { serverReplyStyle, type ReplyStyle } from "./general-settings.ts"
import { noMentions } from "./responses.ts"
import { serverLabel, serverReply, type DeploymentScope } from "./server-scope.ts"

/**
 * One status, detail or list reply, built once and rendered in the server's reply style.
 * Fields are label and value pairs. A note closes the description and may hold commands, mentions and times. Titles and the
 * footer hold plain words only, because embeds show markdown, mentions and timestamps there as raw text. Short confirmations
 * and errors are plain lines instead, sent with replyText
 */
export type Card = { readonly title: string, readonly description?: string, readonly fields?: readonly (readonly [label: string, value: string])[], readonly note?: string, readonly footer?: string }
export type { ReplyStyle }
export type RenderedReply = { readonly content: string } | { readonly embeds: readonly [EmbedInput] }

/** The dashboard's accent colour */
export const ACCENT = 0x5560e6
// Fluxerly checks each embed part against these lengths and 25 fields. All embeds of one message may hold 6000 characters together and its
// text 2000. Both keep room for the server name a private reply adds, and footers stay at 1024 so a title, a full
// description piece and the footer always fit one embed
const LIMIT = { title: 256, description: 4096, fields: 25, label: 256, value: 1024, footer: 1024, embed: 5800, content: 1900 } as const

/** Cut text to a limit, ending with an ellipsis and never splitting a surrogate pair */
const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, /[\uD800-\uDBFF]/.test(value[max - 2]!) ? max - 2 : max - 1)}…`
const normal = (card: Card) => ({ title: clip(card.title, LIMIT.title), description: [card.description, card.note].filter(Boolean).join("\n") || undefined,
    fields: (card.fields ?? []).map(([label, value]): EmbedFieldInput => ({ name: clip(label, LIMIT.label), value: clip(value, LIMIT.value) })), footer: card.footer ? clip(card.footer, LIMIT.footer) : undefined })

/**
 * Render a card as embeds, one per message. The title opens the first and the footer closes the last. A long description
 * splits at line breaks and fields continue in further embeds when one would pass 25 fields or 6000 characters
 */
export function renderEmbeds(card: Card): RenderedReply[] {
    const { title, description, fields, footer } = normal(card), room = LIMIT.embed - (footer?.length ?? 0)
    const embeds: { title?: string, description?: string, fields: EmbedFieldInput[] }[] = [{ title, fields: [] }]
    let size = title.length
    const fit = (length: number, field: boolean) => {
        const last = embeds.at(-1)!
        if (size + length > room || (field ? last.fields.length === LIMIT.fields : last.description !== undefined || last.fields.length > 0)) { embeds.push({ fields: [] }); size = 0 }
        size += length
        return embeds.at(-1)!
    }
    for (const piece of description ? text.split(description, { maxLength: LIMIT.description }) : []) fit(piece.length, false).description = piece
    for (const field of fields) fit(field.name.length + field.value.length, true).fields.push(field)
    return embeds.map((embed, index) => ({ embeds: [{ color: ACCENT, ...(embed.title ? { title: embed.title } : {}), ...(embed.description ? { description: embed.description } : {}),
        ...(embed.fields.length ? { fields: embed.fields } : {}), ...(footer && index === embeds.length - 1 ? { footer: { text: footer } } : {}) }] }))
}

/** Render a card as message text: A bold title, the description and its note, one bold label line per field and the footer, split to fit message text limits */
export function renderText(card: Card): RenderedReply[] {
    const { title, description, fields, footer } = normal(card)
    const lines = [`**${title}**`, ...(description ? [description] : []), ...fields.map(field => `**${field.name}:** ${field.value}`), ...(footer ? [footer] : [])]
    return text.split(lines.join("\n"), { maxLength: LIMIT.content }).map(content => ({ content }))
}

export const renderCard = (card: Card, style: ReplyStyle) => style === "text" ? renderText(card) : renderEmbeds(card)

type Replier = Pick<BotEventContext<"messageCreate">, "reply">
/** Reply with a card in the server's chosen style, never notifying anyone */
export const replyCard = (context: Replier, serverId: string, card: Card) =>
    Effect.forEach(renderCard(card, serverReplyStyle(serverId)), body => context.reply({ ...body, allowedMentions: noMentions }), { discard: true })
/** Reply with plain text, split to fit message text limits, never notifying anyone */
export const replyText = (context: Replier, content: string) =>
    Effect.forEach(text.split(content, { maxLength: LIMIT.content }), piece => context.reply({ content: piece, allowedMentions: noMentions }), { discard: true })

/** A past moment, shown relative to each reader's clock, such as 2 minutes ago */
export const ago = (ms: number) => format.timestamp(new Date(ms), TimestampStyles.RelativeTime)
/** A scheduled moment, shown as date and time in each reader's timezone */
export const at = (ms: number) => format.timestamp(new Date(ms), TimestampStyles.ShortDateTime)
/** Command text staff copy, shown as inline code */
export const code = (value: string) => `\`${value}\``
export const onOff = (value: boolean) => value ? "On" : "Off"
/** A count that names its limit only once at least 80% of it is used, such as 3 or 45 of 50 */
export const usage = (count: number, limit: number) => count >= limit * 0.8 ? `${count} of ${limit}` : String(count)
/** Free text on one line, cut to about max characters, such as a note or reason inside a list */
export const snippet = (value: string, max: number) => clip(value.replace(/\s+/g, " ").trim(), max)
/** The reply when a feature's storage was never set up for this bot, naming the feature as !setup does, such as Tickets */
export function notSetUp(feature: string) {
    return `${feature} isn't available on this NeonFlux yet. The bot operator needs to finish setting it up`
}
const units = [["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]] as const
/** A duration in its largest whole unit, such as 10 minutes or 1 day */
export function duration(seconds: number) {
    const [unit, size] = units.find(([, size]) => seconds % size === 0)!
    return `${seconds / size} ${unit}${seconds === size ? "" : "s"}`
}

/** Send a card to a channel, such as a private DM, in the server's style. In multi mode it names its server */
export const sendCard = (client: Client, channelId: string, config: { readonly serverId: string, readonly scope?: DeploymentScope }, card: Card) => Effect.gen(function* () {
    const label = config.scope?.mode === "multi" ? yield* serverLabel(client, config.serverId) : undefined
    for (const body of renderCard(card, serverReplyStyle(config.serverId))) yield* client.messages.send(channelId, { ...(label ? serverReply(body, label) : body), allowedMentions: noMentions }, { timeoutMs: 5000 })
})
