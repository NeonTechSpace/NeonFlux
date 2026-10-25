import { v } from "convex/values"
import {
    TICKET_PANEL_PAGE,
    TicketTranscriptAppendRequest,
    TicketTranscriptDoneRequest,
    TicketWorkRequest,
    type TicketTranscriptAppendResult,
    type TicketTranscriptDoneResult,
    type TicketWorkResult,
} from "@neonflux/contracts/tickets"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail } from "./validation.ts"
import { ticketChannel, transcriptLines } from "./ticketDomain.ts"
import {
    automaticTranscript,
    bodiesGone,
    findTicket,
    ownedChannelMatches,
    rejectTicketAudience,
    ticketNumber,
    transcriptPages,
    type TicketRead,
} from "./ticketStore.ts"
import { publicPanel } from "./tickets.ts"

// Each close and capture sets a ticket's transcript due. The bot's ticket worker then reads the ticket channel and every
// public thread forward from where the transcript left off and appends what is new, so reopening and closing again never
// stores a message twice. A failed read retries every 10 minutes and stops after 6 tries, since a failure lasting an hour
// needs a staff fix, usually a permission
const RETRY_MS = 600000,
    MAX_FAILURES = 6,
    // A worker pass saves this many due tickets, and the rest wait for the next pass
    DUE_PAGE = 10

const cursorRow = (ctx: TicketRead, serverId: string, ticketNo: number, sourceId: string) =>
    ctx.db
        .query("ticketTranscriptCursors")
        .withIndex("by_source", (q) => q.eq("serverId", serverId).eq("ticketNo", ticketNo).eq("sourceId", sourceId))
        .unique()

export const append = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TicketTranscriptAppendResult> => {
        const input = decode(TicketTranscriptAppendRequest, request),
            ticket = await findTicket(ctx, input.serverId, input.ticketNo),
            channel = ticketChannel(input.channel)
        if (ticket.transcriptDueAt === undefined) fail(409, "Ticket transcript not due")
        if (bodiesGone(ticket)) fail(409, "Ticket bodies erased")
        if (
            input.botId !== ticket.botId ||
            channel.channelId !== ticket.channelId ||
            channel.serverId !== ticket.serverId ||
            !ownedChannelMatches(ticket, channel)
        )
            fail(409, "Ticket channel changed")
        rejectTicketAudience(ticket, channel)
        // Messages come oldest first, after the cursor
        let previous = input.after
        for (const message of input.messages) {
            if (previous !== null && BigInt(message.messageId) <= BigInt(previous)) fail(400, "Invalid request")
            previous = message.messageId
        }
        const cursor = await cursorRow(ctx, ticket.serverId, ticket.ticketNo, input.source.id),
            last = input.messages.at(-1)!.messageId
        if ((cursor?.lastMessageId ?? null) !== input.after) {
            // A chunk the transcript already holds is answered as a duplicate, any other gap is a conflict
            if (cursor && BigInt(cursor.lastMessageId) >= BigInt(last))
                return { duplicate: true, transcriptNo: cursor.transcriptNo }
            fail(409, "Ticket transcript cursor changed")
        }
        const now = Date.now()
        let transcript = await automaticTranscript(ctx, ticket)
        if (!transcript) {
            const transcriptNo = await ticketNumber(ctx, ticket.serverId, "nextTranscriptNo")
            transcript = (await ctx.db.get(
                await ctx.db.insert("ticketTranscripts", {
                    serverId: ticket.serverId,
                    ticketNo: ticket.ticketNo,
                    sourceId: `automatic:${ticket.ticketNo}`,
                    actorId: ticket.botId,
                    transcriptNo,
                    channelId: channel.channelId,
                    capturedAt: now,
                    messageCount: 0,
                    truncated: false,
                    pages: 0,
                    createdAt: now,
                    automatic: true,
                }),
            ))!
            await ctx.db.patch(ticket._id, { automaticTranscriptNo: transcriptNo })
        }
        // Pages split one body, so a later append starts on a new line and the pages read back as one text
        const first = transcript.pages ?? 0,
            pages = transcriptPages(
                (first ? "\n" : "") + transcriptLines(input.messages, input.source.thread).join("\n"),
            )
        for (const [index, text] of pages.entries())
            await ctx.db.insert("ticketTranscriptPages", {
                serverId: ticket.serverId,
                ticketNo: ticket.ticketNo,
                transcriptNo: transcript.transcriptNo,
                pageNo: first + index + 1,
                text,
            })
        await ctx.db.patch(transcript._id, {
            capturedAt: now,
            messageCount: transcript.messageCount + input.messages.length,
            pages: first + pages.length,
        })
        if (cursor) await ctx.db.patch(cursor._id, { lastMessageId: last })
        else
            await ctx.db.insert("ticketTranscriptCursors", {
                serverId: ticket.serverId,
                ticketNo: ticket.ticketNo,
                transcriptNo: transcript.transcriptNo,
                sourceId: input.source.id,
                lastMessageId: last,
            })
        return { duplicate: false, transcriptNo: transcript.transcriptNo }
    },
})

/** Settles one save. Only the save that is still due settles, so a capture asked for during it runs again */
export const done = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TicketTranscriptDoneResult> => {
        const input = decode(TicketTranscriptDoneRequest, request),
            ticket = await findTicket(ctx, input.serverId, input.ticketNo)
        if (ticket.transcriptDueAt !== input.dueAt) return { recorded: false }
        const failures = (ticket.transcriptFailures ?? 0) + 1
        await ctx.db.patch(
            ticket._id,
            input.outcome !== "failed"
                ? { transcriptDueAt: undefined, transcriptFailures: undefined, transcriptFailed: undefined }
                : failures >= MAX_FAILURES
                  ? { transcriptDueAt: undefined, transcriptFailures: undefined, transcriptFailed: true }
                  : { transcriptDueAt: Date.now() + RETRY_MS, transcriptFailures: failures },
        )
        return { recorded: true }
    },
})

export const work = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TicketWorkResult> => {
        const { serverId, operation: op } = decode(TicketWorkRequest, request)
        if (op.type === "due") {
            const rows = await ctx.db
                .query("tickets")
                .withIndex("by_server_transcript_due", (q) =>
                    q.eq("serverId", serverId).gt("transcriptDueAt", 0).lte("transcriptDueAt", Date.now()),
                )
                .take(DUE_PAGE)
            return {
                type: "due",
                tickets: rows.flatMap((row) =>
                    row.channelId && row.transcriptDueAt !== undefined
                        ? [
                              {
                                  ticketNo: row.ticketNo,
                                  dueAt: row.transcriptDueAt,
                                  channelId: row.channelId,
                                  botId: row.botId,
                              },
                          ]
                        : [],
                ),
            }
        }
        if (op.type === "cursor")
            return {
                type: "cursor",
                lastMessageId: (await cursorRow(ctx, serverId, op.ticketNo, op.sourceId))?.lastMessageId ?? null,
            }
        // A server has at most one panel per category, read a page at a time in category order
        const after = op.after,
            panels = await ctx.db
                .query("ticketPanels")
                .withIndex("by_category", (q) =>
                    after === undefined
                        ? q.eq("serverId", serverId)
                        : q.eq("serverId", serverId).gt("categoryName", after),
                )
                .take(TICKET_PANEL_PAGE + 1),
            page = panels.slice(0, TICKET_PANEL_PAGE)
        return {
            type: "panels",
            panels: page.map(publicPanel),
            ...(panels.length > TICKET_PANEL_PAGE ? { nextAfter: page.at(-1)!.categoryName } : {}),
        }
    },
})
