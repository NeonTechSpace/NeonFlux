import type { TicketPanel } from "@neonflux/contracts/tickets"
import type { Client, MessageReaction } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { serverLabel, serverOption } from "./server-scope.ts"
import type { TicketStore } from "./ticket-store.ts"
import { readTicketAuthority } from "./ticket-permissions.ts"
import { memberDm, openDmIntake, TICKET_PANEL_EMOJI, ticketRefusalText } from "./ticket-management.ts"

export type TicketPanelIndex = ReturnType<typeof createTicketPanelIndex>
/** Each running server's panel index, so a category the dashboard deletes takes its panel out of it */
export const ticketPanelIndexes = new Map<string, TicketPanelIndex>()
/** Every ticket panel of a server, read a page at a time until the last */
export function readTicketPanels(store: TicketStore, serverId: string) {
    return Effect.gen(function* () {
        const found: TicketPanel[] = []
        let after: string | undefined
        do {
            const result = yield* store.work({
                serverId,
                operation: { type: "panels", ...(after === undefined ? {} : { after }) },
            })
            if (result.type !== "panels") break
            found.push(...result.panels)
            after = result.nextAfter
        } while (after !== undefined)
        return found
    })
}
/**
 * The ticket panel messages of one server, read from the backend on the first reaction and then kept up to date by the
 * panel commands, which are the only way panels change. A reaction on any other message then costs nothing
 */
export function createTicketPanelIndex(store: TicketStore, serverId: string) {
    let panels: Map<string, TicketPanel> | undefined
    // Each read asks the backend again, so the index holds every panel or, after a failed read, none
    const load = readTicketPanels(store, serverId).pipe(
        Effect.map((found) => (panels = new Map(found.map((panel) => [panel.messageId, panel] as const)))),
        // A failed read leaves the index unread, so the next reaction tries again
        Effect.catch(() => Effect.logWarning("Ticket panels could not be read").pipe(Effect.as(undefined))),
    )
    return {
        /** The panel a message is, or undefined */
        panel: (messageId: string) =>
            Effect.suspend(() => (panels ? Effect.succeed(panels) : load)).pipe(
                Effect.map((known) => known?.get(messageId)),
            ),
        saved: (panel: TicketPanel, replaced?: TicketPanel) =>
            Effect.sync(() => {
                if (replaced) panels?.delete(replaced.messageId)
                panels?.set(panel.messageId, panel)
            }),
        removed: (panel: TicketPanel) =>
            Effect.sync(() => {
                panels?.delete(panel.messageId)
            }),
    }
}

/**
 * A reaction on a ticket panel opens an intake for the member, whose questions and every refusal go to their DM. The
 * member's reaction is removed once, also when no DM can be opened, and then nothing is posted. Answers whether the message was a panel
 */
export function handleTicketPanelReaction(
    store: TicketStore,
    index: TicketPanelIndex,
    config: BotConfig,
    client: Client,
    reaction: Pick<MessageReaction, "id" | "channelId" | "guildId" | "emoji">,
    userId: string,
) {
    return Effect.gen(function* () {
        if (reaction.guildId !== config.serverId) return false
        const panel = yield* index.panel(reaction.id)
        if (!panel) return false
        if (reaction.emoji.name !== TICKET_PANEL_EMOJI || reaction.emoji.id) return true
        // Only a member who is no bot gets a DM, and the bot's own reaction is no request
        const facts = yield* readTicketAuthority(client, config.serverId, userId).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
        )
        if (!facts) return true
        // The member's reaction goes once either way, so a later 🎫 after they allow DMs opens the intake at once
        const removeReaction = client.messages
            .removeUserReaction({ id: reaction.id, channelId: reaction.channelId }, TICKET_PANEL_EMOJI, userId, {
                timeoutMs: 5000,
            })
            .pipe(Effect.ignore)
        const dmId = yield* memberDm(client, userId)
        if (dmId === undefined) {
            yield* removeReaction
            return true
        }
        const label = yield* serverLabel(client, config.serverId)
        const send = (content: string) =>
            client.messages.send(
                dmId,
                { content, allowedMentions: { users: [], roles: [], everyone: false, repliedUser: false } },
                { timeoutMs: 5000 },
            )
        // The DM message is the intake's source, a fresh Fluxer ID for each request
        const opening = yield* send(`Opening a ${panel.categoryName} ticket on **${label}**`).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
        )
        if (opening) {
            const createdAt = yield* Clock.currentTimeMillis
            yield* openDmIntake(store, config, client, facts, dmId, panel.categoryName, opening.id, createdAt).pipe(
                Effect.flatMap(({ text }) => send(text)),
                Effect.catch((error) => send(ticketRefusalText(error, `!ticket${serverOption(config)}`))),
                Effect.ignore,
            )
        }
        yield* removeReaction
        return true
    })
}
