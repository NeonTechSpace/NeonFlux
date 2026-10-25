import {
    TICKET_QUESTIONS,
    ticketAudience,
    ticketAudienceWithin,
    type TicketAction,
    type TicketAttempt,
    type TicketAudience,
    type TicketCategory,
    type TicketChannelSnapshot,
    type TicketContext,
    type TicketIntake,
    type TicketIntakeCategory,
    type TicketIntakeRequest,
    type TicketIntakeResult,
    type TicketManageOperation,
    type TicketManageResult,
    type TicketQueryRequest,
    type TicketQueryResult,
    type TicketRecord,
    type TicketSource,
    type TicketState,
} from "@neonflux/contracts/tickets"
import { format, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Effect, type Types } from "effect"
import type { BotConfig } from "./config.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { ago, code, onOff, replyCard, replyText, snippet, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { serverCommands, serverLabel, serverOption, type DeploymentScope } from "./server-scope.ts"
import { ticketDestinationCommand, ticketDmOnlyCommand, ticketHelp, type TicketCommand } from "./ticket-command.ts"
import {
    readTicketAuthority,
    snapshotTicketChannel,
    TicketPermissionError,
    verifyTicketPrivateAuthor,
} from "./ticket-permissions.ts"
import { fixSentence } from "./permission-fix.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { refusedReason } from "./backend-http.ts"
import { TicketStoreError, type TicketStore } from "./ticket-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { transcriptFileParts } from "./ticket-transcripts.ts"
import { readTicketPanels, type TicketPanelIndex } from "./ticket-panels.ts"
import { performTicketChain, TicketHandlingError } from "./tickets.ts"

/** Entries per page of a ticket list in chat */
const TICKET_PAGE = 10
// The question a plain DM reply answers, or -1 once every question is answered
const unanswered = (intake: TicketIntake) => intake.category.questions.findIndex((_, index) => !intake.answers[index])
const answered = (intake: TicketIntake) => intake.category.questions.filter((_, index) => intake.answers[index]).length
// The step a plain DM reply continues: the first unanswered question, or the audience to confirm. The answers show on request
function intakeStep(intake: TicketIntake, invoke: string) {
    const { questions } = intake.category,
        current = unanswered(intake)
    if (current >= 0)
        return `Question ${current + 1} of ${questions.length}: ${questions[current]}\nReply with your answer${current > 0 ? ", back to change the previous answer" : ""} or cancel to stop`
    if (!questions.length)
        return `Sending opens a ${intake.category.visibility} conversation. Reply send to create the ticket or cancel to stop`
    return (
        `${questions.length} of ${questions.length} answered. Sending opens a ${intake.category.visibility} conversation. Reply send to create the ticket, back to change the last answer or cancel to stop. ` +
        `${code(`${invoke} review ${intake.intakeNo}`)} shows your answers`
    )
}
const intakeStates: Record<TicketIntake["state"], string> = {
    draft: "Draft",
    submitted: "Submitted",
    cancelled: "Cancelled",
    expired: "Expired",
}
/** The full review of an intake, on request: Each question with its answer, and the step that sends it */
function intakeCard(intake: TicketIntake, invoke: string): Card {
    const { questions, visibility } = intake.category,
        draft = intake.state === "draft"
    return {
        title: `Ticket intake #${intake.intakeNo}`,
        description: `${intakeStates[intake.state]} in category ${intake.category.name}${draft ? `. Sending opens a ${visibility} conversation` : ""}`,
        fields: questions.map(
            (question, index) => [`${index + 1}. ${question}`, intake.answers[index] || "Not answered"] as const,
        ),
        ...(!draft
            ? {}
            : unanswered(intake) < 0
              ? { note: `Send it with ${code(`${invoke} submit ${intake.intakeNo} ${visibility}`)}` }
              : { note: `Answer with ${code(`${invoke} answer ${intake.intakeNo} <question> "answer"`)}` }),
    }
}
const ticketStates: Record<TicketState, string> = {
    creating: "Creating",
    open: "Open",
    closing: "Closing",
    closed: "Closed",
    reopening: "Reopening",
    deleting: "Deleting",
    retired: "Channel deleted",
    failed: "Failed",
    uncertain: "Not confirmed yet",
}
const actions: Record<TicketAction, string> = {
    create: "Create the channel",
    introduction: "Post the introduction",
    reply: "Post a reply",
    "close-everyone": "Close for everyone",
    "close-requester": "Close for the requester",
    "reopen-requester": "Reopen for the requester",
    "reopen-everyone": "Reopen for everyone",
    delete: "Delete the channel",
}
const outcomes: Record<TicketAttempt["outcome"], string> = {
    pending: "in progress",
    succeeded: "done",
    failed: "failed",
    uncertain: "not confirmed yet",
}
const checks: Record<NonNullable<TicketAttempt["resolved"]>, string> = {
    before: "unchanged",
    desired: "done",
    absent: "channel gone",
}
const capital = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`
/** The step that settles a ticket whose last action is not confirmed */
const settleStep = (ticket: TicketRecord, invoke: string) =>
    ticket.channelId && ticket.currentAttempt
        ? `Check it with ${code(`${invoke} reconcile ${ticket.ticketNo}`)}`
        : `Check for a leftover channel, then run ${code(`${invoke} abandon ${ticket.ticketNo}`)}`
/** A ticket's short card for !ticket show. The last action's details stay behind !ticket attempt */
function ticketCard(ticket: TicketRecord, invoke: string): Card {
    const status =
        ticket.state === "uncertain"
            ? ticketStates.uncertain
            : ticket.transition
              ? `${ticket.transition === "close" ? "Closing" : "Reopening"}, ${ticket.completedSteps ?? 0} of 2 steps done`
              : ticketStates[ticket.state]
    const note = [
        ...(ticket.state === "uncertain" ? [settleStep(ticket, invoke)] : []),
        ...(ticket.erased ? ["Its stored answers and notes are erased"] : []),
    ].join(". ")
    return {
        title: `Ticket #${ticket.ticketNo}`,
        fields: [
            ["Status", status],
            ["Requester", format.userMention(ticket.requesterId)],
            ["Claimed by", ticket.claimedBy ? format.userMention(ticket.claimedBy) : "Nobody"],
            ["Category", `${ticket.categoryName}, ${ticket.visibility} conversation`],
            ["Priority", capital(ticket.priority)],
            ["Channel", ticket.channelId ? format.channelMention(ticket.channelId) : "Not known"],
            [
                "Opened",
                `${ago(ticket.createdAt)}${ticket.closedAt !== undefined ? `, closed ${ago(ticket.closedAt)}` : ""}`,
            ],
            ...(ticket.transcript ? [["Transcript", transcriptStatus(ticket, invoke)] as const] : []),
        ],
        ...(note ? { note } : {}),
    }
}
function transcriptStatus(ticket: TicketRecord, invoke: string) {
    const transcript = ticket.transcript!
    return transcript.state === "saving"
        ? "Saving"
        : transcript.state === "saved"
          ? `Saved, ${transcript.messageCount} messages`
          : `Not saved after 6 tries. Check NeonFlux's View channel and Read message history there, and that nobody outside the ticket's readers was given access to the channel, then run ${code(`${invoke} transcript ${ticket.ticketNo} capture`)}`
}
const ticketLine = (ticket: TicketRecord) =>
    `**#${ticket.ticketNo}** ${ticketStates[ticket.state]}${ticket.priority === "normal" ? "" : `, ${ticket.priority} priority`}, ${format.userMention(ticket.requesterId)}` +
    `${ticket.claimedBy ? `, claimed by ${format.userMention(ticket.claimedBy)}` : ""}${ticket.channelId ? ` in ${format.channelMention(ticket.channelId)}` : ""}, opened ${ago(ticket.createdAt)}`
/** What a ticket action did, in one line, such as Ticket #12 claimed by you */
function ticketDone(command: TicketCommand, ticket: TicketRecord) {
    const name = `Ticket #${ticket.ticketNo}`
    switch (command.type) {
        case "claim":
            return `${name} claimed by you`
        case "unclaim":
            return `${name} is no longer claimed`
        case "priority":
            return `${name} now has ${ticket.priority} priority`
        case "reply":
        case "reply-canned":
            return `Reply posted in ${name.toLowerCase()}`
        case "close":
            return `${name} closed`
        case "reopen":
            return `${name} reopened`
        case "delete":
            return `${name} deleted with its channel`
        case "erase":
            return `The stored answers and notes of ${name.toLowerCase()} are erased`
        case "abandon":
            return `${name} set aside, so its requester can open another ticket. Remove a leftover channel yourself`
        default:
            return `${name} opened${ticket.channelId ? ` in ${format.channelMention(ticket.channelId)}` : ""}`
    }
}
const attemptCard = (attempt: TicketAttempt): Card => ({
    title: `Ticket #${attempt.ticketNo}, attempt ${attempt.attemptNo}`,
    fields: [
        ["Outcome", capital(outcomes[attempt.outcome])],
        ["Action", actions[attempt.action]],
        ["Started", ago(attempt.createdAt)],
        ...(attempt.finishedAt !== undefined ? [["Finished", ago(attempt.finishedAt)] as const] : []),
        ...(attempt.resolved ? [["Checked", capital(checks[attempt.resolved])] as const] : []),
        ...(attempt.noDispatch ? [["Reached Fluxer", "No"] as const] : []),
        ...(attempt.nativeDeleteConfirmed ? [["Channel deletion", "Confirmed by Fluxer"] as const] : []),
    ],
    footer: "Shows what happened, never the message text",
})
const categoryCard = (category: TicketCategory): Card => ({
    title: `Ticket category ${category.name}`,
    description: category.description,
    fields: [
        ["Status", onOff(category.enabled)],
        ["Parent category", category.parentId ? format.channelMention(category.parentId) : "None"],
        [
            "Support roles",
            category.supportRoleIds.map((id) => format.roleMention(id)).join(", ") ||
                "None, so only the owner and administrators",
        ],
        ["Conversation", capital(category.visibility)],
        ["Questions", category.questions.map((question, index) => `${index + 1}. ${question}`).join("\n") || "None"],
        ["Canned replies", category.cannedReplies.map((canned) => canned.name).join(", ") || "None"],
    ],
})
/** Support roles as mentions, the first five and then how many more */
const supportRoles = (ids: readonly string[]) =>
    `${ids
        .slice(0, 5)
        .map((id) => format.roleMention(id))
        .join(", ")}${ids.length > 5 ? ` and ${ids.length - 5} more` : ""}`
/** The one thing a change to an existing category did, with its new value */
function categoryChange(command: TicketCommand, category: TicketCategory) {
    const name = `Ticket category ${category.name}`,
        questions = `It has ${category.questions.length} question${category.questions.length === 1 ? "" : "s"} now`
    if (command.type === "category-set")
        switch (command.field) {
            case "enabled":
                return `${name} is ${onOff(category.enabled).toLowerCase()}`
            case "visibility":
                return `${name} now opens ${category.visibility} conversations`
            case "parent":
                return category.parentId
                    ? `${name} now opens its tickets in ${format.channelMention(category.parentId)}`
                    : `${name} now opens its tickets outside any channel category`
            case "staff":
                return category.supportRoleIds.length
                    ? `${name} now has the support roles ${supportRoles(category.supportRoleIds)}`
                    : `${name} has no support roles now, so only the owner and administrators handle its tickets`
            case "description":
                return `${name} now has the description: ${category.description}`
        }
    if (command.type === "question")
        return command.operation === "clear"
            ? `${name} has no questions now`
            : command.operation === "remove"
              ? `Question ${command.index} removed from ${category.name}. ${questions}`
              : command.operation === "set"
                ? `Question ${command.index} of ${category.name} is now: ${command.text}`
                : `Question added to ${category.name}: ${command.text}. ${questions}`
    if (command.type === "canned" && command.operation === "set")
        return `Canned reply ${command.name} of ${category.name} now uses template ${command.templateName}`
    return command.type === "canned" && command.operation === "remove"
        ? `Canned reply ${command.name} removed from ${category.name}`
        : `${name} saved`
}
function audience(category: TicketIntakeCategory) {
    const scope =
        category.visibility === "public"
            ? "Public conversation that every member can see"
            : "Private conversation that only the requester, the support roles, the owner and administrators can see"
    const roles = supportRoles(category.supportRoleIds) || "None, so only the owner and administrators"
    return `${scope}. Support roles: ${roles}. Intake answers stay private and never appear in the conversation channel. NeonFlux saves a transcript of this channel when the ticket closes`
}

/** The emoji members react with on a ticket panel */
export const TICKET_PANEL_EMOJI = "🎫"
const noMentions = { users: [], roles: [], everyone: false, repliedUser: false }
/** The member's DM, checked to be theirs alone with NeonFlux, or undefined when Fluxer refused it */
export const memberDm = (client: Client, actorId: string) =>
    client.directMessages.open(actorId, { timeoutMs: 5000 }).pipe(
        Effect.flatMap((dm) => verifyTicketPrivateAuthor(client, dm.id, actorId)),
        Effect.map(({ channel }): string | undefined => channel.id),
        Effect.catch(() => Effect.succeed(undefined)),
    )
/**
 * Opens an intake whose questions go to the member's DM, from a server command or a panel reaction. messageId names the
 * message that asked for it. Answers the intake and the DM text that starts it
 */
export function openDmIntake(
    store: TicketStore,
    config: BotConfig,
    client: Client,
    facts: { readonly context: TicketContext },
    dmId: string,
    categoryName: string,
    messageId: string,
    createdAt: number,
) {
    return Effect.gen(function* () {
        const serverId = config.serverId,
            context: TicketContext = {
                ...facts.context,
                actor: { ...facts.context.actor, privateChannelVerified: true, privateChannelId: dmId },
            }
        const category = yield* store.query({ serverId, context, operation: { type: "category", name: categoryName } })
        if (category.type !== "category") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const opened = yield* store.intake({
            serverId,
            context,
            messageId,
            createdAt,
            operation: { type: "open", categoryName, expectedCategoryRevision: category.category.revision },
        })
        if (opened.duplicate || opened.type !== "intake")
            return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const intake = opened.intake,
            label = yield* serverLabel(client, serverId)
        return {
            intake,
            text: `Intake #${intake.intakeNo} for ${intake.category.name} on **${label}**\n${intake.category.questions.length ? `${audience(intake.category)}\n` : ""}${intakeStep(intake, `!ticket${serverOption(config)}`)}`,
        }
    })
}
// Whether a server channel could hold a private answer for some ticket: only the bot besides roles may be allowed to view
// it for staff, and only roles and members for readers. The ticket's own audience is checked once its record is read
function mayAnswerHere(destination: TicketChannelSnapshot, audience: TicketAudience, botId: string, serverId: string) {
    const ids = (type: "role" | "member") =>
        destination.overwrites.filter((row) => row.type === type).map((row) => row.id)
    return ticketAudienceWithin(destination.overwrites, {
        serverId,
        roleIds: ids("role"),
        memberIds: audience === "staff" ? [botId] : ids("member"),
    })
}
function destinationRefusal(command: TicketCommand) {
    if (command.type === "intake")
        return "Intake answers show only in a DM with NeonFlux or in a channel that only this ticket's support roles can see. They never appear in a ticket channel"
    if (ticketDestinationCommand(command) === "staff")
        return "Staff notes answer only in a DM with NeonFlux or in a channel that only this ticket's support roles can see, so the requester never reads them"
    if (command.type === "list") return "Ticket lists answer in a DM with NeonFlux or in a server text channel"
    return "This answers only in a DM with NeonFlux, the private ticket channel or a channel that only the ticket's readers can see"
}

export function handleTicketCommand(
    store: TicketStore,
    publishing: PublishingStore | undefined,
    config: BotConfig,
    command: TicketCommand | { error: string },
    event: BotEventContext<"messageCreate">,
    panels?: TicketPanelIndex,
) {
    const reply = (content: string) => replyText(event, content),
        card = (value: Card) => replyCard(event, config.serverId, value),
        // How hints name the command: with the server's prefix in its channels, and with the server selector in a DM
        invoke = `${replyPrefix(config.serverId, event.message.guildId)}ticket${
            event.message.guildId === undefined ? serverOption(config) : ""
        }`
    // A list is a card, and an empty one says so in its description. A hint for every line goes once in the note
    const list = (title: string, lines: readonly string[], empty: string, next?: string, note?: string) =>
        card({
            title,
            description: lines.join("\n") || empty,
            fields: next ? [["Next", code(next)]] : [],
            ...(note ? { note } : {}),
        })
    // A category's canned replies and the ticket panels are read whole, so their lists page by number
    const paged = <T>(
        rows: readonly T[],
        key: string,
        start: string,
        next: boolean | undefined,
        show: (rows: readonly T[], more: string | undefined) => Effect.Effect<void, unknown>,
    ) => {
        const position = next ? nextPosition<number>(key) : 1
        if (position === undefined) return reply(noNextPage(start))
        const pages = Math.max(1, Math.ceil(rows.length / TICKET_PAGE)),
            page = Math.min(position, pages)
        rememberPosition(key, page < pages ? page + 1 : undefined)
        return show(
            rows.slice((page - 1) * TICKET_PAGE, page * TICKET_PAGE),
            page < pages ? `${start} next` : undefined,
        )
    }
    return Effect.gen(function* () {
        const { client, message } = event,
            serverId = config.serverId,
            actorId = message.author.id
        const privateInvocation = message.guildId === undefined
        if (message.guildId !== undefined && message.guildId !== serverId) return
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (ticketDmOnlyCommand(command) && !privateInvocation) {
            yield* reply("Answer intake questions only in a one-to-one DM with NeonFlux, never in a server channel")
            return
        }
        if (command.type === "help") {
            yield* reply(
                privateInvocation
                    ? serverCommands(ticketHelp, config)
                    : withPrefix(ticketHelp, replyPrefix(serverId, message.guildId)),
            )
            return
        }
        // Private text answers in a server channel only where its audience allows, read fresh from the channel itself
        const needs = ticketDestinationCommand(command)
        const destination =
            !privateInvocation && (needs || command.type === "list")
                ? yield* client.channels.fetch(message.channelId, { timeoutMs: 5000 }).pipe(
                      Effect.flatMap(snapshotTicketChannel),
                      Effect.map((value): TicketChannelSnapshot | undefined => value),
                      Effect.catch(() => Effect.succeed(undefined)),
                  )
                : undefined
        const refresh = (options: Parameters<typeof readTicketAuthority>[3] = {}) =>
            Effect.gen(function* () {
                const facts = yield* readTicketAuthority(client, serverId, actorId, options)
                if (destination) facts.context = { ...facts.context, destination }
                if (privateInvocation) {
                    const dm = yield* verifyTicketPrivateAuthor(client, message.channelId, actorId)
                    if (dm.botId !== facts.botId)
                        return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
                    facts.context = {
                        ...facts.context,
                        actor: {
                            ...facts.context.actor,
                            privateChannelVerified: true,
                            privateChannelId: message.channelId,
                        },
                    }
                }
                return facts
            })
        let facts = yield* refresh()
        if (
            !privateInvocation &&
            (needs || command.type === "list") &&
            (!destination || (needs && !mayAnswerHere(destination, needs, facts.botId, serverId)))
        ) {
            yield* reply(destinationRefusal(command))
            return
        }
        const query = (operation: TicketQueryRequest["operation"]) =>
            store.query({ serverId, context: facts.context, operation })
        const admin = () => facts.context.actor.isOwner || facts.context.actor.isAdministrator
        const deleteOnce = (channelId: string, messageId: string) =>
            client.messages.delete({ id: messageId, channelId }, { timeoutMs: 5000 }).pipe(Effect.ignore)
        // Categories page in the backend by name, so a server with many of them lists each page with one read
        if (command.type === "categories") {
            const start = `${invoke} categories`,
                key = pageKey(serverId, message, "ticket", "categories"),
                after = command.next ? nextPosition<string>(key) : undefined
            if (command.next && after === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const result = yield* query({ type: "categories", ...(after === undefined ? {} : { after }) })
            if (result.type !== "categories") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            rememberPosition(key, result.nextAfter)
            yield* list(
                "Ticket categories",
                result.categories.map(
                    (category) =>
                        `**${category.name}** ${capital(category.visibility)} conversation${category.enabled ? "" : ", off"}${category.description ? `: ${snippet(category.description, 80)}` : ""}`,
                ),
                "No ticket categories yet",
                result.nextAfter === undefined ? undefined : `${start} next`,
                result.categories.length
                    ? `Open a ticket with ${code(`${invoke} open <category>`)}. NeonFlux asks its questions in a DM`
                    : undefined,
            )
            return
        }
        if (command.type === "settings") {
            const result = yield* query({ type: "settings" })
            if (result.type === "settings")
                yield* card({
                    title: "Tickets",
                    fields: [
                        ["Status", onOff(result.settings.enabled)],
                        [
                            "Stored answers, notes and transcripts",
                            `Kept ${result.settings.retentionDays} days after a ticket closes`,
                        ],
                        ["Ticket channels", "Stay until staff delete them"],
                    ],
                })
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const source = (): TicketSource => ({ serverId, context: facts.context, messageId: message.id, createdAt })
        const manage = (operation: TicketManageOperation) => store.manage({ ...source(), operation })
        const display = (result: TicketManageResult | TicketIntakeResult) =>
            Effect.gen(function* () {
                if (result.duplicate) return
                // An action answers with one line. Its details stay behind !ticket show
                if (result.type === "ticket") {
                    const ticketNo = result.ticket.ticketNo,
                        show = code(`${invoke} show ${ticketNo}`)
                    if (result.grant) {
                        const final = (yield* performTicketChain(
                            store,
                            serverId,
                            client,
                            result.grant,
                            privateInvocation ? message.channelId : undefined,
                        )).at(-1)
                        if (final && "ticket" in final && final.ticket)
                            yield* reply(
                                final.outcome === "succeeded"
                                    ? final.recorded
                                        ? ticketDone(command, final.ticket)
                                        : `${ticketDone(command, final.ticket)}, but NeonFlux could not save the result. Check ${show} before you try again`
                                    : final.outcome === "failed"
                                      ? `Fluxer did not finish the change to ticket #${ticketNo}. Check ${show}`
                                      : `The change to ticket #${ticketNo} is not confirmed yet, and NeonFlux never repeats it. ${final.ticket.state === "uncertain" ? settleStep(final.ticket, invoke) : `Check ${show}`}`,
                            )
                        else
                            yield* reply(
                                `The change to ticket #${ticketNo} is not confirmed yet, and NeonFlux never repeats it. Check ${show} before you try again`,
                            )
                    } else yield* reply(ticketDone(command, result.ticket))
                } else if (result.type === "intake") {
                    const intake = result.intake,
                        total = intake.category.questions.length
                    yield* command.type === "answer"
                        ? reply(
                              `Answer ${command.index} saved for intake #${intake.intakeNo}, ${answered(intake)} of ${total} answered${
                                  unanswered(intake) >= 0
                                      ? ""
                                      : `. Send ${code(`${invoke} submit ${intake.intakeNo} ${intake.category.visibility}`)} to open a ${intake.category.visibility} conversation`
                              }`,
                          )
                        : intake.state === "cancelled"
                          ? reply(`Intake #${intake.intakeNo} cancelled`)
                          : card(intakeCard(intake, invoke))
                }
                // A new category shows its whole card, and a change to one names what changed
                else if (result.type === "category")
                    yield* command.type === "category-create"
                        ? card(categoryCard(result.category))
                        : reply(categoryChange(command, result.category))
                else if (result.type === "deleted") {
                    if (result.panel) {
                        yield* deleteOnce(result.panel.channelId, result.panel.messageId)
                        if (panels) yield* panels.removed(result.panel)
                    }
                    yield* reply(
                        `Ticket category ${result.name} deleted${result.panel ? " with its panel" : ""}. Existing tickets keep their audience`,
                    )
                } else if (result.type === "panel" || result.type === "panel-removed")
                    return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
                else if (result.type === "entry")
                    yield* reply(
                        `${result.entry.kind === "note" ? "Note" : "Reply"} saved for ticket #${result.entry.ticketNo}`,
                    )
                else
                    yield* reply(
                        command.type === "retention"
                            ? `Stored answers, notes and transcripts are now kept ${result.settings.retentionDays} days after a ticket closes`
                            : `Tickets are ${onOff(result.settings.enabled).toLowerCase()}`,
                    )
            })
        if (command.type === "module" || command.type === "retention") {
            yield* display(
                yield* manage({
                    type: "settings",
                    ...(command.type === "module" ? { enabled: command.enabled } : { retentionDays: command.days }),
                }),
            )
            return
        }
        if (command.type === "category-create") {
            facts = yield* refresh({
                ...(command.parentId ? { parentId: command.parentId } : {}),
                roleIds: command.supportRoleIds,
            })
            yield* display(
                yield* manage({
                    type: "category-create",
                    name: command.name,
                    visibility: command.visibility,
                    ...(command.parentId ? { parentId: command.parentId } : {}),
                    supportRoleIds: command.supportRoleIds,
                    roles: facts.roleSnapshots.filter((role) => command.supportRoleIds.includes(role.roleId)),
                }),
            )
            return
        }
        if (["category-show", "category-delete", "category-set", "question", "canned"].includes(command.type)) {
            const name =
                "name" in command && command.type !== "canned"
                    ? command.name
                    : command.type === "canned"
                      ? command.category
                      : undefined
            if (!name) return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            const result = yield* query({ type: "category-config", name })
            if (result.type !== "category-config")
                return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            const category = result.category
            if (command.type === "category-show") {
                yield* card(categoryCard(category))
                return
            }
            if (command.type === "canned" && command.operation === "list") {
                yield* paged(
                    category.cannedReplies,
                    pageKey(serverId, message, "ticket", "canned", category.name),
                    `${invoke} canned ${category.name} list`,
                    command.next,
                    (rows, more) =>
                        list(
                            `Canned replies of ${category.name}`,
                            rows.map((canned) => `**${canned.name}** from template ${canned.templateName}`),
                            `No canned replies in ${category.name} yet`,
                            more,
                        ),
                )
                return
            }
            let operation: TicketManageOperation
            if (command.type === "category-delete")
                operation = { type: "category-delete", name, expectedRevision: category.revision }
            else if (command.type === "category-set") {
                const patch: Types.DeepMutable<TicketManageOperation & { type: "category-update" }> = {
                    type: "category-update",
                    name,
                    expectedRevision: category.revision,
                    patch: {},
                }
                if (command.field === "staff") {
                    patch.patch.supportRoleIds = command.value
                    facts = yield* refresh({ roleIds: command.value })
                    patch.roles = facts.roleSnapshots.filter((role) => command.value.includes(role.roleId))
                } else if (command.field === "parent") {
                    patch.patch.parentId = command.value
                    facts = yield* refresh(command.value ? { parentId: command.value } : {})
                } else if (command.field === "enabled") patch.patch.enabled = command.value
                else if (command.field === "visibility") patch.patch.visibility = command.value
                else patch.patch.description = command.value
                operation = patch
            } else if (command.type === "question") {
                const questions = [...category.questions]
                if (command.operation === "clear") questions.length = 0
                else if (command.operation === "add") {
                    if (questions.length >= TICKET_QUESTIONS) {
                        yield* reply(
                            `${category.name} already asks ${TICKET_QUESTIONS} questions, the most a category asks. Remove one first`,
                        )
                        return
                    }
                    questions.push(command.text)
                } else {
                    if (command.index > questions.length) {
                        yield* reply("That question does not exist")
                        return
                    }
                    if (command.operation === "set") questions[command.index - 1] = command.text
                    else questions.splice(command.index - 1, 1)
                }
                operation = { type: "category-update", name, expectedRevision: category.revision, patch: { questions } }
            } else if (command.type === "canned") {
                if (command.operation === "remove")
                    operation = {
                        type: "canned-remove",
                        name,
                        expectedRevision: category.revision,
                        cannedName: command.name,
                    }
                else {
                    if (command.operation !== "set" || !publishing)
                        return yield* Effect.fail(new TicketHandlingError({ stage: "content" }))
                    const template = yield* publishing.query({
                        serverId,
                        actor: facts.context.actor,
                        operation: { type: "draft-show", kind: "template", name: command.templateName },
                    })
                    if (template.type !== "draft")
                        return yield* Effect.fail(new TicketHandlingError({ stage: "content" }))
                    operation = {
                        type: "canned-set",
                        name,
                        expectedRevision: category.revision,
                        cannedName: command.name,
                        templateName: command.templateName,
                        expectedTemplateRevision: template.draft.revision,
                    }
                }
            } else return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            // Configuration uses the latest observed actor, including after parent/template/role reads.
            const fresh = yield* refresh()
            facts.context = { ...facts.context, observedAt: fresh.context.observedAt, actor: fresh.context.actor }
            yield* display(yield* manage(operation))
            return
        }
        if (command.type === "open") {
            // Without a name the one category that is on opens, and otherwise the categories are listed
            let categoryName = command.category
            if (categoryName === undefined) {
                const on = yield* query({ type: "categories", enabled: true })
                if (on.type !== "categories") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
                if (on.categories.length !== 1 || on.nextAfter !== undefined) {
                    yield* list(
                        "Ticket categories",
                        on.categories.map(
                            (category) =>
                                `**${category.name}** ${capital(category.visibility)} conversation${category.description ? `: ${snippet(category.description, 80)}` : ""}`,
                        ),
                        "No ticket category is on yet",
                        undefined,
                        on.categories.length
                            ? `Open one with ${code(`${invoke} open <category>`)}${on.nextAfter === undefined ? "" : `. ${code(`${invoke} categories`)} lists them all`}`
                            : undefined,
                    )
                    return
                }
                categoryName = on.categories[0]!.name
            }
            if (!privateInvocation) {
                // The intake runs in the member's DM, so its answers never reach the server channel
                const dmId = yield* memberDm(client, actorId)
                if (dmId === undefined) {
                    yield* reply(
                        "NeonFlux could not send you a DM. Allow direct messages from this server, then try again",
                    )
                    return
                }
                const { intake, text } = yield* openDmIntake(
                    store,
                    config,
                    client,
                    facts,
                    dmId,
                    categoryName,
                    message.id,
                    createdAt,
                )
                const sent = yield* client.messages
                    .send(dmId, { content: text, allowedMentions: noMentions }, { timeoutMs: 5000 })
                    .pipe(
                        Effect.as(true),
                        Effect.catch(() => Effect.succeed(false)),
                    )
                yield* reply(
                    sent
                        ? `Intake #${intake.intakeNo} for ${intake.category.name} started in your DMs with NeonFlux. Answer the questions there`
                        : `Intake #${intake.intakeNo} opened, but NeonFlux could not send the first question. Send ${code(`!ticket${serverOption(config)} review ${intake.intakeNo}`)} to NeonFlux in a DM to continue`,
                )
                return
            }
            const category = yield* query({ type: "category", name: categoryName })
            if (category.type !== "category") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            const opened = yield* store.intake({
                ...source(),
                operation: {
                    type: "open",
                    categoryName,
                    expectedCategoryRevision: category.category.revision,
                },
            })
            if (opened.duplicate || opened.type !== "intake") yield* display(opened)
            else
                yield* reply(
                    `Intake #${opened.intake.intakeNo} opened in category ${opened.intake.category.name}\n${opened.intake.category.questions.length ? `${audience(opened.intake.category)}\n` : ""}${intakeStep(opened.intake, invoke)}`,
                )
            return
        }
        if (command.type === "panel" || command.type === "panel-remove" || command.type === "panels") {
            if (!admin()) {
                yield* reply("Only the server owner or an Administrator can manage ticket panels")
                return
            }
            if (command.type === "panels") {
                yield* paged(
                    yield* readTicketPanels(store, serverId),
                    pageKey(serverId, message, "ticket", "panels"),
                    `${invoke} panels`,
                    command.next,
                    (rows, more) =>
                        list(
                            "Ticket panels",
                            rows.map(
                                (panel) => `**${panel.categoryName}** in ${format.channelMention(panel.channelId)}`,
                            ),
                            "No ticket panels yet",
                            more,
                            `Post one with ${code(`${invoke} panel <category> #channel`)}`,
                        ),
                )
                return
            }
            if (command.type === "panel-remove") {
                const result = yield* manage({ type: "panel-remove", categoryName: command.category })
                if (result.duplicate || result.type !== "panel-removed") return
                yield* deleteOnce(result.panel.channelId, result.panel.messageId)
                if (panels) yield* panels.removed(result.panel)
                yield* reply(`The ticket panel of ${result.panel.categoryName} was removed`)
                return
            }
            const category = yield* query({ type: "category", name: command.category })
            if (category.type !== "category") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            facts = yield* refresh({
                channelId: command.channelId,
                botPermission:
                    Permissions.ViewChannel |
                    Permissions.SendMessages |
                    Permissions.AddReactions |
                    Permissions.ReadMessageHistory,
            })
            const { name, description } = category.category
            const posted = yield* client.messages
                .send(
                    command.channelId,
                    {
                        content: `**${capital(name)} tickets**\n${description ? `${description}\n` : ""}React with ${TICKET_PANEL_EMOJI} to open a ticket. NeonFlux sends the questions in a DM, so allow direct messages from this server`,
                        allowedMentions: noMentions,
                    },
                    { timeoutMs: 5000 },
                )
                .pipe(
                    // A definite refusal posted nothing, while any other failure may have posted the panel
                    Effect.catch((error) =>
                        Effect.succeed(
                            (error as { status?: unknown }).status === 403 ? ("refused" as const) : undefined,
                        ),
                    ),
                )
            if (!posted || posted === "refused") {
                yield* reply(
                    posted === "refused"
                        ? `Fluxer refused the panel post in ${format.channelMention(command.channelId)}, so nothing was posted. Check NeonFlux's permissions there, then post it again`
                        : `The panel post was not confirmed, and NeonFlux never repeats it. Check ${format.channelMention(command.channelId)} and post again if it is missing`,
                )
                return
            }
            yield* client.messages.addReaction(posted, TICKET_PANEL_EMOJI, { timeoutMs: 5000 }).pipe(Effect.ignore)
            const result = yield* manage({
                type: "panel-save",
                categoryName: name,
                channelId: command.channelId,
                messageId: posted.id,
            })
            if (result.duplicate || result.type !== "panel") return
            if (result.replaced) yield* deleteOnce(result.replaced.channelId, result.replaced.messageId)
            if (panels) yield* panels.saved(result.panel, result.replaced)
            yield* reply(
                `Ticket panel for ${name} posted in ${format.channelMention(command.channelId)}${result.replaced ? ". The old panel was removed" : ""}`,
            )
            return
        }
        if (
            command.type === "answer" ||
            command.type === "review" ||
            command.type === "cancel" ||
            command.type === "submit" ||
            command.type === "intake-reply"
        ) {
            const result = yield* query({ type: "intake", intakeNo: command.intakeNo })
            if (result.type !== "intake") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            if (command.type === "review") {
                yield* card(intakeCard(result.intake, invoke))
                return
            }
            const intake = result.intake,
                base = { intakeNo: intake.intakeNo, expectedGeneration: intake.generation }
            let operation: TicketIntakeRequest["operation"]
            if (command.type === "intake-reply") {
                const current = unanswered(intake),
                    word = command.text.toLowerCase(),
                    last = (current < 0 ? intake.category.questions.length : current) - 1
                if (word === "cancel") operation = { ...base, type: "cancel" }
                else if (word === "back") {
                    if (last < 0) {
                        yield* reply(`There is no earlier answer to change\n${intakeStep(intake, invoke)}`)
                        return
                    }
                    operation = { ...base, type: "clear", question: last + 1 }
                } else if (word === "send") {
                    if (current >= 0) {
                        yield* reply(`Answer every question before sending\n${intakeStep(intake, invoke)}`)
                        return
                    }
                    operation = {
                        ...base,
                        type: "submit",
                        visibility: intake.category.visibility,
                        expectedCategoryRevision: intake.category.revision,
                    }
                } else if (current < 0) {
                    yield* reply(`Every question is answered\n${intakeStep(intake, invoke)}`)
                    return
                } else if (message.attachments.length || message.stickers.length || !command.text) {
                    yield* reply(
                        "Send each answer as text. Attachments and stickers cannot be kept in an intake answer",
                    )
                    return
                } else if (command.text.length > 2000) {
                    yield* reply(
                        `An answer allows at most 2000 characters, and this one has ${command.text.length}. Send a shorter answer`,
                    )
                    return
                } else operation = { ...base, type: "answer", question: current + 1, answer: command.text }
            } else
                operation =
                    command.type === "answer"
                        ? { ...base, type: "answer", question: command.index, answer: command.text }
                        : command.type === "submit"
                          ? {
                                ...base,
                                type: "submit",
                                visibility: command.visibility,
                                expectedCategoryRevision: intake.category.revision,
                            }
                          : { ...base, type: "cancel" }
            facts = yield* refresh(
                operation.type === "submit"
                    ? {
                          botPermission: Permissions.ManageChannels | Permissions.ManageRoles,
                          ...(intake.category.parentId ? { parentId: intake.category.parentId } : {}),
                      }
                    : {},
            )
            const changed = yield* store.intake({ ...source(), operation })
            if (command.type !== "intake-reply" || changed.duplicate || changed.type !== "intake") {
                yield* display(changed)
                return
            }
            if (operation.type === "cancel") yield* reply(`Intake #${intake.intakeNo} cancelled`)
            else
                yield* reply(
                    `${operation.type === "clear" ? `Previous answer: ${intake.answers[operation.question - 1]}\n` : ""}${intakeStep(changed.intake, invoke)}`,
                )
            return
        }
        if (command.type === "list") {
            const start = `${invoke} list`,
                key = pageKey(serverId, message, "ticket", "list"),
                before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const result = yield* query({ type: "tickets", ...(before ? { beforeTicketNo: before } : {}) })
            if (result.type !== "tickets") return
            rememberPosition(key, result.nextBeforeTicketNo)
            const note = [
                ...(result.tickets.length ? [`Details: ${code(`${invoke} show <number>`)}`] : []),
                ...(result.hidden
                    ? ["Tickets whose readers differ from this channel's are left out. Use a DM for the full list"]
                    : []),
            ].join(". ")
            yield* card({
                title: "Tickets",
                description:
                    result.tickets.map(ticketLine).join("\n") ||
                    (result.nextBeforeTicketNo ? "None of the newest tickets are yours to see" : "No tickets yet"),
                fields: result.nextBeforeTicketNo ? [["Next", code(`${start} next`)]] : [],
                ...(note ? { note } : {}),
            })
            return
        }
        if (
            !("ticketNo" in command) &&
            !["show", "claim", "unclaim", "close", "reopen", "priority", "reply", "reply-canned"].includes(command.type)
        )
            return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const number = "ticketNo" in command ? command.ticketNo : undefined
        // In a ticket's own channel the number may be left out
        if (number === undefined && privateInvocation) {
            yield* reply(
                `Name the ticket, such as ${code(`${invoke} ${command.type === "reply-canned" ? "reply" : command.type} 12`)}`,
            )
            return
        }
        const located = yield* query(
            number === undefined
                ? { type: "ticket", channelId: message.channelId }
                : { type: "ticket", ticketNo: number },
        )
        if (located.type !== "ticket") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const locator = located.ticket
        if (
            destination &&
            needs &&
            !ticketAudienceWithin(destination.overwrites, ticketAudience(locator, needs, serverId))
        ) {
            yield* reply(destinationRefusal(command))
            return
        }
        if (command.type === "show") {
            yield* card(ticketCard(locator, invoke))
            return
        }
        if (command.type === "erase") {
            yield* display(
                yield* manage({
                    type: "erase",
                    ticketNo: locator.ticketNo,
                    expectedGeneration: locator.generation,
                    confirm: true,
                }),
            )
            return
        }
        if (command.type === "abandon") {
            yield* display(
                yield* manage({ type: "abandon", ticketNo: locator.ticketNo, expectedGeneration: locator.generation }),
            )
            return
        }
        const ticketFacts = () =>
            refresh(locator.channelId ? { channelId: locator.channelId, allowAbsentChannel: true } : {})
        facts = yield* ticketFacts()
        const detailed = yield* query({ type: "ticket", ticketNo: locator.ticketNo })
        if (detailed.type !== "ticket") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const ticket = detailed.ticket,
            expectedGeneration = ticket.generation
        if (command.type === "attempt") {
            // Attempt numbers count across the server, so without one the ticket's last action is shown
            const attemptNo = command.attemptNo ?? ticket.currentAttempt?.attemptNo
            if (attemptNo === undefined) {
                yield* reply(`Ticket #${ticket.ticketNo} has no recorded action to show`)
                return
            }
            const result = yield* query({ type: "attempt", ticketNo: ticket.ticketNo, attemptNo })
            if (result.type === "attempt") yield* card(attemptCard(result.attempt))
            return
        }
        if (command.type === "reconcile") {
            if (!ticket.channelId || (!ticket.currentAttempt && !facts.channelAbsent)) {
                yield* reply(
                    `Ticket #${ticket.ticketNo} has no known channel or last action to check. Checking never searches for a channel or repeats an action`,
                )
                return
            }
            const result = yield* store.reconcile({
                ...source(),
                ticketNo: ticket.ticketNo,
                expectedGeneration,
                ...(ticket.currentAttempt ? { attemptId: ticket.currentAttempt.attemptId } : {}),
                observation: {
                    originServerId: config.serverId,
                    observedAt: facts.observedAt,
                    channelId: ticket.channelId,
                    channelAbsent: facts.channelAbsent,
                    ...(facts.context.channel ? { channel: facts.context.channel } : {}),
                },
            })
            yield* reply(
                result.recorded
                    ? `Checked ticket #${ticket.ticketNo} and saved what its channel shows: ${ticketStates[result.ticket.state].toLowerCase()}. Nothing was repeated`
                    : `Nothing saved for ticket #${ticket.ticketNo}. Its channel matches neither the state before the last action nor the state it asked for`,
            )
            return
        }
        if (command.type === "intake") {
            const result = yield* query({ type: "private-intake", ticketNo: ticket.ticketNo })
            if (result.type !== "private-intake") return
            if (result.erased) yield* reply(`The stored intake answers of ticket #${ticket.ticketNo} were erased`)
            else if (!result.questions.length) yield* reply(`Ticket #${ticket.ticketNo} had no intake questions`)
            else
                yield* card({
                    title: `Intake answers for ticket #${ticket.ticketNo}`,
                    fields: result.questions.map(
                        (question, index) =>
                            [`${index + 1}. ${question}`, result.answers[index] || "Not answered"] as const,
                    ),
                })
            return
        }
        // Notes list as numbered snippets, 5 per page, and show reads one in full
        if (command.type === "notes") {
            const start = `${invoke} note ${ticket.ticketNo} list`,
                key = pageKey(serverId, message, "ticket", ticket.ticketNo, "notes"),
                before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const result = yield* query({
                type: "entries",
                ticketNo: ticket.ticketNo,
                kind: "note",
                ...(before ? { beforeEntryNo: before } : {}),
            })
            if (result.type !== "entries") return
            rememberPosition(key, result.nextBeforeEntryNo)
            yield* card({
                title: `Staff notes on ticket #${ticket.ticketNo}`,
                description:
                    result.entries
                        .map(
                            (e) =>
                                `**#${e.entryNo}** ${format.userMention(e.authorId)} ${ago(e.createdAt)}: ` +
                                `${e.erased ? "Erased" : snippet(e.content?.content ?? "", 150)}`,
                        )
                        .join("\n") || "No staff notes yet",
                fields: result.nextBeforeEntryNo ? [["Next", code(`${start} next`)]] : [],
                ...(result.entries.length
                    ? {
                          note: `Read one in full with ${code(`${invoke} note ${ticket.ticketNo} show <number>`)}`,
                      }
                    : {}),
            })
            return
        }
        if (command.type === "note-show") {
            // The newest note at or below the number is the one asked for only when its number matches
            const result = yield* query({
                type: "entries",
                ticketNo: ticket.ticketNo,
                kind: "note",
                beforeEntryNo: command.noteNo + 1,
            })
            const entry = result.type === "entries" ? result.entries[0] : undefined
            if (!entry || entry.entryNo !== command.noteNo) {
                yield* reply(
                    `Ticket #${ticket.ticketNo} has no staff note #${command.noteNo}. Check ${code(`${invoke} note ${ticket.ticketNo} list`)}`,
                )
                return
            }
            yield* card({
                title: `Staff note #${entry.entryNo} on ticket #${ticket.ticketNo}`,
                description: `${format.userMention(entry.authorId)} ${ago(entry.createdAt)}\n${entry.erased ? "Erased" : (entry.content?.content ?? "")}`,
            })
            return
        }
        if (command.type === "transcript-list") {
            const start = `${invoke} transcript ${ticket.ticketNo} list`,
                key = pageKey(serverId, message, "ticket", ticket.ticketNo, "transcripts"),
                before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const result = yield* query({
                type: "transcripts",
                ticketNo: ticket.ticketNo,
                ...(before ? { beforeTranscriptNo: before } : {}),
            })
            if (result.type !== "transcripts") return
            rememberPosition(key, result.nextBeforeTranscriptNo)
            const rows = result.transcripts.map(
                (t) =>
                    `**#${t.transcriptNo}** ${t.automatic ? "Automatic, " : ""}${t.erased ? "Erased" : `${t.messageCount} messages, ${t.pages} ${t.pages === 1 ? "page" : "pages"}`}${t.truncated ? ", cut short" : ""}, ${t.automatic ? "saved" : "captured"} ${ago(t.capturedAt)}`,
            )
            yield* list(
                `Transcripts of ticket #${ticket.ticketNo}`,
                rows,
                "No transcripts yet",
                result.nextBeforeTranscriptNo ? `${start} next` : undefined,
                rows.length
                    ? `Read one with ${code(`${invoke} transcript ${ticket.ticketNo} show <number>`)}`
                    : undefined,
            )
            return
        }
        if (command.type === "transcript-show") {
            const start = `${invoke} transcript ${ticket.ticketNo} show ${command.transcriptNo}`
            const key = pageKey(serverId, message, "ticket", ticket.ticketNo, "transcript", command.transcriptNo),
                page = command.next ? nextPosition<number>(key) : 1
            if (page === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const result = yield* query({
                type: "transcript",
                ticketNo: ticket.ticketNo,
                transcriptNo: command.transcriptNo,
                page,
            })
            if (result.type !== "transcript") return
            const { transcript } = result
            rememberPosition(key, result.page < transcript.pages ? result.page + 1 : undefined)
            yield* card({
                title: `Transcript #${transcript.transcriptNo} of ticket #${ticket.ticketNo}`,
                description: transcript.erased ? "Erased" : result.text,
                fields: result.page < transcript.pages ? [["Next", code(`${start} next`)]] : [],
                footer: transcript.automatic
                    ? "Attachment links work while Fluxer keeps the files"
                    : `An earlier capture of channel text, without attachments or embeds${transcript.truncated ? ". It was cut short, so older or longer messages are missing" : ""}`,
            })
            return
        }
        if (command.type === "transcript-file") {
            let transcriptNo = command.transcriptNo
            if (transcriptNo === undefined) {
                const all = yield* query({ type: "transcripts", ticketNo: ticket.ticketNo })
                if (all.type !== "transcripts") return
                transcriptNo = (all.transcripts.find((t) => t.automatic) ?? all.transcripts[0])?.transcriptNo
                if (transcriptNo === undefined) {
                    yield* reply(`Ticket #${ticket.ticketNo} has no saved transcript yet`)
                    return
                }
            }
            // A file in a server channel needs NeonFlux's own Attach files there, checked before any part is sent
            if (!privateInvocation)
                yield* refresh({
                    channelId: message.channelId,
                    botPermission: Permissions.ViewChannel | Permissions.SendMessages | Permissions.AttachFiles,
                })
            // Pages are read 100 at a time and each file part is sent once full, so a long transcript never sits in memory whole
            const parts = transcriptFileParts(),
                stem = `ticket-${ticket.ticketNo}-transcript-${transcriptNo}`
            let part = 0
            const sendPart = (data: Uint8Array, last: boolean) => {
                part++
                return client.messages.send(
                    message.channelId,
                    {
                        content:
                            last && part === 1
                                ? `Transcript #${transcriptNo} of ticket #${ticket.ticketNo}`
                                : `Transcript #${transcriptNo} of ticket #${ticket.ticketNo}, part ${part}${last ? ", the last" : ""}`,
                        attachments: [
                            {
                                filename: last && part === 1 ? `${stem}.txt` : `${stem}-part-${part}.txt`,
                                contentType: "text/plain",
                                data,
                            },
                        ],
                    },
                    { timeoutMs: 30000 },
                )
            }
            for (let from: number | undefined = 1; from !== undefined;) {
                const result: TicketQueryResult = yield* query({
                    type: "transcript-pages",
                    ticketNo: ticket.ticketNo,
                    transcriptNo,
                    fromPage: from,
                })
                if (result.type !== "transcript-pages") return
                if (result.transcript.erased) {
                    yield* reply(`Transcript #${transcriptNo} of ticket #${ticket.ticketNo} was erased`)
                    return
                }
                for (const text of result.texts) for (const full of parts.add(text)) yield* sendPart(full, false)
                from = result.nextPage
            }
            yield* sendPart(parts.finish(), true)
            return
        }
        if (command.type === "transcript-capture") {
            const result = yield* manage({ type: "transcript-capture", ticketNo: ticket.ticketNo, expectedGeneration })
            if (result.duplicate) return
            yield* reply(
                `The transcript of ticket #${ticket.ticketNo} is being brought up to date. ${code(`${invoke} transcript ${ticket.ticketNo} list`)} shows it once it is saved`,
            )
            return
        }
        const base = { ticketNo: ticket.ticketNo, expectedGeneration }
        let operation: TicketManageOperation
        if (command.type === "reply") operation = { ...base, type: "reply", content: { content: command.text } }
        else if (command.type === "reply-canned")
            operation = { ...base, type: "canned-reply", cannedName: command.name }
        else if (command.type === "note") operation = { ...base, type: "note", content: command.text }
        else if (command.type === "priority") operation = { ...base, type: "priority", priority: command.priority }
        else if (command.type === "delete") operation = { ...base, type: command.type, confirm: true }
        else if (["claim", "unclaim", "close", "reopen"].includes(command.type))
            operation = { ...base, type: command.type as "claim" | "unclaim" | "close" | "reopen" }
        else return yield* Effect.fail(new TicketHandlingError({ stage: "grant" }))
        yield* display(yield* manage(operation))
    }).pipe(
        // Permissions are read before any write, and a ticket chain handles its own reads, so a failed read ran nothing
        Effect.catch((error) => reply(ticketRefusalText(error, invoke))),
    )
}

/** What a failed ticket request tells the member */
export const ticketRefusalText = (error: unknown, invoke: string) =>
    error instanceof TicketPermissionError
        ? error.missing?.length
            ? fixSentence({ permissions: error.missing, channelId: error.channelId })
            : "Current permissions could not be read. Try again shortly"
        : (error instanceof TicketStoreError &&
              (refusedReason(error) ?? (error.status !== null && ticketRefusals(invoke)[error.status]))) ||
          unknownTicketResult

// A definite backend answer means nothing happened, so only an unknown result warns that the action may have run
const unknownTicketResult =
    "The ticket action could not be confirmed. Check the ticket's status before you try again. NeonFlux never repeats an action whose result is unknown"
const ticketRefusals = (invoke: string): Record<number, string> => ({
    400: `Some values in the command are not valid. Check them with ${code(`${invoke} help`)} and try again`,
    403: "You can't do that with this ticket. Check your roles, the ticket's audience and the server's DEFCON level",
    404: "NeonFlux could not find that ticket, category or saved reply. Check the number or name",
    409: `The ticket changed or does not allow that right now. Check it with ${code(`${invoke} show <number>`)} before you try again`,
    429: "A ticket limit was reached. Close tickets you no longer need, or wait a minute and try again",
})

/** The one open intake a plain DM answers. With several, the member gets one hint that names them instead of a guess */
export function findTicketIntake(
    store: TicketStore,
    event: BotEventContext<"messageCreate">,
    served: (serverId: string) => boolean,
    scope: DeploymentScope,
) {
    return Effect.gen(function* () {
        const { client, message } = event
        const open = (yield* store
            .openIntakes({ userId: message.author.id })
            .pipe(
                Effect.catch(() => Effect.logWarning("Open ticket intakes could not be read").pipe(Effect.as([]))),
            )).filter((intake) => served(intake.serverId))
        if (open.length < 2) return open[0]
        // The list names servers, so it goes only to a one-to-one DM with this member
        if (
            !(yield* verifyTicketPrivateAuthor(client, message.channelId, message.author.id).pipe(
                Effect.as(true),
                Effect.catch(() => Effect.succeed(false)),
            ))
        )
            return undefined
        const multi = scope.mode === "multi",
            option = multi ? " --server <server>" : ""
        const names = yield* Effect.forEach(open, ({ serverId, intakeNo }) =>
            (multi
                ? serverLabel(client, serverId).pipe(
                      Effect.map((label) => ` on ${label} (${code(`--server ${serverId}`)})`),
                  )
                : Effect.succeed("")
            ).pipe(Effect.map((where) => `#${intakeNo}${where}`)),
        )
        yield* replyText(
            event,
            `You have ${open.length} open ticket intakes: ${names.join(", ")}. A plain reply cannot tell which one it answers, so answer with ` +
                `${code(`!ticket${option} answer <intake> <question> "answer"`)}, or cancel the ones you do not need with ${code(`!ticket${option} cancel <intake>`)}`,
        )
        return undefined
    })
}
