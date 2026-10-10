import type { TicketAction, TicketAttempt, TicketCategory, TicketIntake, TicketIntakeCategory, TicketIntakeRequest, TicketIntakeResult, TicketManageOperation, TicketManageResult, TicketQueryRequest, TicketRecord, TicketSource, TicketState } from "@neonflux/contracts/tickets"
import { format, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect, type Types } from "effect"
import type { BotConfig } from "./config.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { ago, code, onOff, replyCard, replyText, snippet, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { dmServerHint, serverCommands, serverLabel, serverOption, type DeploymentScope } from "./server-scope.ts"
import { ticketHelp, ticketPrivateCommand, type TicketCommand } from "./ticket-command.ts"
import { readTicketAuthority, TicketPermissionError, verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import { fixSentence } from "./permission-fix.ts"
import { TicketStoreError, type TicketStore } from "./ticket-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { captureTicketTranscript } from "./ticket-transcripts.ts"
import { performTicketChain, TicketHandlingError } from "./tickets.ts"

/** Entries per page of a ticket list in chat */
const TICKET_PAGE = 10
// The question a plain DM reply answers, or -1 once every question is answered
const unanswered = (intake: TicketIntake) => intake.category.questions.findIndex((_, index) => !intake.answers[index])
const answered = (intake: TicketIntake) => intake.category.questions.filter((_, index) => intake.answers[index]).length
// The step a plain DM reply continues: the first unanswered question, or the audience to confirm. The answers show on request
function intakeStep(intake: TicketIntake, option: string) {
    const { questions } = intake.category, current = unanswered(intake)
    if (current >= 0) return `Question ${current + 1} of ${questions.length}: ${questions[current]}\nReply with your answer${current > 0 ? ", back to change the previous answer" : ""} or cancel to stop`
    if (!questions.length) return `Sending opens a ${intake.category.visibility} conversation. Reply send to create the ticket or cancel to stop`
    return `${questions.length} of ${questions.length} answered. Sending opens a ${intake.category.visibility} conversation. Reply send to create the ticket, back to change the last answer or cancel to stop. `
        + `${code(`!ticket${option} review ${intake.intakeNo}`)} shows your answers`
}
const intakeStates: Record<TicketIntake["state"], string> = { draft: "Draft", submitted: "Submitted", cancelled: "Cancelled", expired: "Expired" }
/** The full review of an intake, on request: Each question with its answer, and the step that sends it */
function intakeCard(intake: TicketIntake, option: string): Card {
    const { questions, visibility } = intake.category, draft = intake.state === "draft"
    return { title: `Ticket intake #${intake.intakeNo}`, description: `${intakeStates[intake.state]} in category ${intake.category.name}${draft ? `. Sending opens a ${visibility} conversation` : ""}`,
        fields: questions.map((question, index) => [`${index + 1}. ${question}`, intake.answers[index] || "Not answered"] as const),
        ...(!draft ? {} : unanswered(intake) < 0 ? { note: `Send it with ${code(`!ticket${option} submit ${intake.intakeNo} ${visibility}`)}` }
            : { note: `Answer with ${code(`!ticket${option} answer ${intake.intakeNo} <question> "answer"`)}` }) }
}
const ticketStates: Record<TicketState, string> = { creating: "Creating", open: "Open", closing: "Closing", closed: "Closed", reopening: "Reopening", deleting: "Deleting", retired: "Channel deleted", failed: "Failed", uncertain: "Not confirmed yet" }
const actions: Record<TicketAction, string> = { create: "Create the channel", introduction: "Post the introduction", reply: "Post a reply", "close-everyone": "Close for everyone",
    "close-requester": "Close for the requester", "reopen-requester": "Reopen for the requester", "reopen-everyone": "Reopen for everyone", delete: "Delete the channel" }
const outcomes: Record<TicketAttempt["outcome"], string> = { pending: "in progress", succeeded: "done", failed: "failed", uncertain: "not confirmed yet" }
const checks: Record<NonNullable<TicketAttempt["resolved"]>, string> = { before: "unchanged", desired: "done", absent: "channel gone" }
const capital = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`
/** The step that settles a ticket whose last action is not confirmed */
const settleStep = (ticket: TicketRecord, option: string) => ticket.channelId && ticket.currentAttempt ? `Check it with ${code(`!ticket${option} reconcile ${ticket.ticketNo}`)}`
    : `Check for a leftover channel, then run ${code(`!ticket${option} abandon ${ticket.ticketNo}`)}`
/** A ticket's short card for !ticket show. The last action's details stay behind !ticket attempt */
function ticketCard(ticket: TicketRecord, option: string): Card {
    const status = ticket.state === "uncertain" ? ticketStates.uncertain
        : ticket.transition ? `${ticket.transition === "close" ? "Closing" : "Reopening"}, ${ticket.completedSteps ?? 0} of 2 steps done` : ticketStates[ticket.state]
    const note = [...ticket.state === "uncertain" ? [settleStep(ticket, option)] : [], ...ticket.erased ? ["Its stored answers and notes are erased"] : []].join(". ")
    return { title: `Ticket #${ticket.ticketNo}`, fields: [
        ["Status", status], ["Requester", format.userMention(ticket.requesterId)], ["Claimed by", ticket.claimedBy ? format.userMention(ticket.claimedBy) : "Nobody"],
        ["Category", `${ticket.categoryName}, ${ticket.visibility} conversation`], ["Priority", capital(ticket.priority)],
        ["Channel", ticket.channelId ? format.channelMention(ticket.channelId) : "Not known"],
        ["Opened", `${ago(ticket.createdAt)}${ticket.closedAt !== undefined ? `, closed ${ago(ticket.closedAt)}` : ""}`]], ...(note ? { note } : {}) }
}
const ticketLine = (ticket: TicketRecord) => `**#${ticket.ticketNo}** ${ticketStates[ticket.state]}${ticket.priority === "normal" ? "" : `, ${ticket.priority} priority`}, ${format.userMention(ticket.requesterId)}`
    + `${ticket.claimedBy ? `, claimed by ${format.userMention(ticket.claimedBy)}` : ""}${ticket.channelId ? ` in ${format.channelMention(ticket.channelId)}` : ""}, opened ${ago(ticket.createdAt)}`
/** What a ticket action did, in one line, such as Ticket #12 claimed by you */
function ticketDone(command: TicketCommand, ticket: TicketRecord) {
    const name = `Ticket #${ticket.ticketNo}`
    switch (command.type) {
        case "claim": return `${name} claimed by you`
        case "unclaim": return `${name} is no longer claimed`
        case "priority": return `${name} now has ${ticket.priority} priority`
        case "reply": case "reply-canned": return `Reply posted in ${name.toLowerCase()}`
        case "close": return `${name} closed`
        case "reopen": return `${name} reopened`
        case "delete": return `${name} deleted with its channel`
        case "erase": return `The stored answers and notes of ${name.toLowerCase()} are erased`
        case "abandon": return `${name} set aside, so its requester can open another ticket. Remove a leftover channel yourself`
        default: return `${name} opened${ticket.channelId ? ` in ${format.channelMention(ticket.channelId)}` : ""}`
    }
}
const attemptCard = (attempt: TicketAttempt): Card => ({ title: `Ticket #${attempt.ticketNo}, attempt ${attempt.attemptNo}`, fields: [
    ["Outcome", capital(outcomes[attempt.outcome])], ["Action", actions[attempt.action]], ["Started", ago(attempt.createdAt)],
    ...(attempt.finishedAt !== undefined ? [["Finished", ago(attempt.finishedAt)] as const] : []),
    ...(attempt.resolved ? [["Checked", capital(checks[attempt.resolved])] as const] : []),
    ...(attempt.noDispatch ? [["Reached Fluxer", "No"] as const] : []),
    ...(attempt.nativeDeleteConfirmed ? [["Channel deletion", "Confirmed by Fluxer"] as const] : [])], footer: "Shows what happened, never the message text" })
const categoryCard = (category: TicketCategory): Card => ({ title: `Ticket category ${category.name}`, description: category.description, fields: [
    ["Status", onOff(category.enabled)], ["Parent category", category.parentId ? format.channelMention(category.parentId) : "None"],
    ["Support roles", category.supportRoleIds.map(id => format.roleMention(id)).join(", ") || "None, so only the owner and administrators"], ["Conversation", capital(category.visibility)],
    ["Questions", category.questions.map((question, index) => `${index + 1}. ${question}`).join("\n") || "None"],
    ["Canned replies", category.cannedReplies.map(canned => canned.name).join(", ") || "None"]] })
/** Support roles as mentions, the first five and then how many more */
const supportRoles = (ids: readonly string[]) => `${ids.slice(0, 5).map(id => format.roleMention(id)).join(", ")}${ids.length > 5 ? ` and ${ids.length - 5} more` : ""}`
/** The one thing a change to an existing category did, with its new value */
function categoryChange(command: TicketCommand, category: TicketCategory) {
    const name = `Ticket category ${category.name}`, questions = `It has ${category.questions.length} question${category.questions.length === 1 ? "" : "s"} now`
    if (command.type === "category-set") switch (command.field) {
        case "enabled": return `${name} is ${onOff(category.enabled).toLowerCase()}`
        case "visibility": return `${name} now opens ${category.visibility} conversations`
        case "parent": return category.parentId ? `${name} now opens its tickets in ${format.channelMention(category.parentId)}` : `${name} now opens its tickets outside any channel category`
        case "staff": return category.supportRoleIds.length ? `${name} now has the support roles ${supportRoles(category.supportRoleIds)}`
            : `${name} has no support roles now, so only the owner and administrators handle its tickets`
        case "description": return `${name} now has the description: ${category.description}`
    }
    if (command.type === "question") return command.operation === "clear" ? `${name} has no questions now` : command.operation === "remove" ? `Question ${command.index} removed from ${category.name}. ${questions}`
        : command.operation === "set" ? `Question ${command.index} of ${category.name} is now: ${command.text}` : `Question added to ${category.name}: ${command.text}. ${questions}`
    if (command.type === "canned" && command.operation === "set") return `Canned reply ${command.name} of ${category.name} now uses template ${command.templateName}`
    return command.type === "canned" && command.operation === "remove" ? `Canned reply ${command.name} removed from ${category.name}` : `${name} saved`
}
function audience(category: TicketIntakeCategory) {
    const scope = category.visibility === "public" ? "Public conversation that every member can see"
        : "Private conversation that only the requester, the support roles, the owner and administrators can see"
    const roles = supportRoles(category.supportRoleIds) || "None, so only the owner and administrators"
    return `${scope}. Support roles: ${roles}. Intake answers stay private and never appear in the conversation channel`
}

export function handleTicketCommand(store: TicketStore, publishing: PublishingStore | undefined, config: BotConfig,
    command: TicketCommand | { error: string }, event: BotEventContext<"messageCreate">) {
    const reply = (content: string) => replyText(event, content), card = (value: Card) => replyCard(event, config.serverId, value), option = event.message.guildId === undefined ? serverOption(config) : ""
    // A list is a card, and an empty one says so in its description. A hint for every line goes once in the note
    const list = (title: string, lines: readonly string[], empty: string, next?: string, note?: string) =>
        card({ title, description: lines.join("\n") || empty, fields: next ? [["Next", code(next)]] : [], ...(note ? { note } : {}) })
    // Categories and canned replies are read whole, so their lists page by number
    const paged = <T>(rows: readonly T[], key: string, start: string, next: boolean | undefined, show: (rows: readonly T[], more: string | undefined) => Effect.Effect<void, unknown>) => {
        const position = next ? nextPosition<number>(key) : 1
        if (position === undefined) return reply(noNextPage(start))
        const pages = Math.max(1, Math.ceil(rows.length / TICKET_PAGE)), page = Math.min(position, pages)
        rememberPosition(key, page < pages ? page + 1 : undefined)
        return show(rows.slice((page - 1) * TICKET_PAGE, page * TICKET_PAGE), page < pages ? `${start} next` : undefined)
    }
    return Effect.gen(function* () {
        const { client, message } = event, serverId = config.serverId, actorId = message.author.id
        const privateInvocation = message.guildId === undefined
        if (message.guildId !== undefined && message.guildId !== serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (ticketPrivateCommand(command) && !privateInvocation) { yield* reply("Use this command in a verified one-to-one DM with NeonFlux. Do not post intake answers or staff notes in a server channel"); return }
        const refresh = (options: Parameters<typeof readTicketAuthority>[3] = {}) => Effect.gen(function* () {
            const facts = yield* readTicketAuthority(client, serverId, actorId, options)
            if (privateInvocation) {
                const dm = yield* verifyTicketPrivateAuthor(client, message.channelId, actorId)
                if (dm.botId !== facts.botId) return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
                facts.context = { ...facts.context, actor: { ...facts.context.actor, privateChannelVerified: true, privateChannelId: message.channelId } }
            }
            return facts
        })
        let facts = yield* refresh()
        const query = (operation: TicketQueryRequest["operation"]) => store.query({ serverId, context: facts.context, operation })
        if (command.type === "help") { yield* reply(privateInvocation ? serverCommands(ticketHelp, config) : ticketHelp); return }
        if (command.type === "categories") {
            const result = yield* query({ type: "categories" })
            if (result.type !== "categories") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            yield* paged(result.categories, pageKey(serverId, message, "ticket", "categories"), `!ticket${option} categories`, command.next, (rows, more) => list("Ticket categories",
                rows.map(category => `**${category.name}** ${capital(category.visibility)} conversation${category.enabled ? "" : ", off"}${category.description ? `: ${snippet(category.description, 80)}` : ""}`),
                "No ticket categories yet", more, rows.length ? `Open a ticket with ${code(`!ticket${option} open <category>`)} in a DM with NeonFlux${privateInvocation ? "" : dmServerHint(config)}` : undefined))
            return
        }
        if (command.type === "settings") {
            const result = yield* query({ type: "settings" })
            if (result.type === "settings") yield* card({ title: "Tickets", fields: [["Status", onOff(result.settings.enabled)],
                ["Stored answers, notes and transcripts", `Kept ${result.settings.retentionDays} days after a ticket closes`], ["Ticket channels", "Stay until staff delete them"]] })
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const source = (): TicketSource => ({ serverId, context: facts.context, messageId: message.id, createdAt })
        const manage = (operation: TicketManageOperation) => store.manage({ ...source(), operation })
        const display = (result: TicketManageResult | TicketIntakeResult) => Effect.gen(function* () {
            if (result.duplicate) return
            // An action answers with one line. Its details stay behind !ticket show
            if (result.type === "ticket") {
                const ticketNo = result.ticket.ticketNo, show = code(`!ticket${option} show ${ticketNo}`)
                if (result.grant) {
                    const final = (yield* performTicketChain(store, serverId, client, result.grant, privateInvocation ? message.channelId : undefined)).at(-1)
                    if (final && "ticket" in final && final.ticket) yield* reply(final.outcome === "succeeded"
                        ? final.recorded ? ticketDone(command, final.ticket) : `${ticketDone(command, final.ticket)}, but NeonFlux could not save the result. Check ${show} before you try again`
                        : final.outcome === "failed" ? `Fluxer did not finish the change to ticket #${ticketNo}. Check ${show}`
                        : `The change to ticket #${ticketNo} is not confirmed yet, and NeonFlux never repeats it. ${final.ticket.state === "uncertain" ? settleStep(final.ticket, option) : `Check ${show}`}`)
                    else yield* reply(`The change to ticket #${ticketNo} is not confirmed yet, and NeonFlux never repeats it. Check ${show} before you try again`)
                } else yield* reply(ticketDone(command, result.ticket))
            } else if (result.type === "intake") {
                const intake = result.intake, total = intake.category.questions.length
                yield* command.type === "answer" ? reply(`Answer ${command.index} saved for intake #${intake.intakeNo}, ${answered(intake)} of ${total} answered${unanswered(intake) >= 0 ? ""
                    : `. Send ${code(`!ticket${option} submit ${intake.intakeNo} ${intake.category.visibility}`)} to open a ${intake.category.visibility} conversation`}`)
                    : intake.state === "cancelled" ? reply(`Intake #${intake.intakeNo} cancelled`) : card(intakeCard(intake, option))
            }
            // A new category shows its whole card, and a change to one names what changed
            else if (result.type === "category") yield* command.type === "category-create" ? card(categoryCard(result.category)) : reply(categoryChange(command, result.category))
            else if (result.type === "deleted") yield* reply(`Ticket category ${result.name} deleted. Existing tickets keep their audience`)
            else if (result.type === "entry") yield* reply(`${result.entry.kind === "note" ? "Note" : "Reply"} saved for ticket #${result.entry.ticketNo}`)
            else yield* reply(command.type === "retention" ? `Stored answers, notes and transcripts are now kept ${result.settings.retentionDays} days after a ticket closes` : `Tickets are ${onOff(result.settings.enabled).toLowerCase()}`)
        })
        if (command.type === "module" || command.type === "retention") {
            yield* display(yield* manage({ type: "settings", ...(command.type === "module" ? { enabled: command.enabled } : { retentionDays: command.days }) }))
            return
        }
        if (command.type === "category-create") {
            facts = yield* refresh({ ...(command.parentId ? { parentId: command.parentId } : {}), roleIds: command.supportRoleIds })
            yield* display(yield* manage({ type: "category-create", name: command.name, visibility: command.visibility,
                ...(command.parentId ? { parentId: command.parentId } : {}), supportRoleIds: command.supportRoleIds,
                roles: facts.roleSnapshots.filter(role => command.supportRoleIds.includes(role.roleId)) }))
            return
        }
        if (["category-show", "category-delete", "category-set", "question", "canned"].includes(command.type)) {
            const name = "name" in command && command.type !== "canned" ? command.name : command.type === "canned" ? command.category : undefined
            if (!name) return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            const result = yield* query({ type: "category-config", name })
            if (result.type !== "category-config") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            const category = result.category
            if (command.type === "category-show") { yield* card(categoryCard(category)); return }
            if (command.type === "canned" && command.operation === "list") {
                yield* paged(category.cannedReplies, pageKey(serverId, message, "ticket", "canned", category.name), `!ticket${option} canned ${category.name} list`, command.next, (rows, more) =>
                    list(`Canned replies of ${category.name}`, rows.map(canned => `**${canned.name}** from template ${canned.templateName}`), `No canned replies in ${category.name} yet`, more))
                return
            }
            let operation: TicketManageOperation
            if (command.type === "category-delete") operation = { type: "category-delete", name, expectedRevision: category.revision }
            else if (command.type === "category-set") {
                const patch: Types.DeepMutable<TicketManageOperation & { type: "category-update" }> = { type: "category-update", name, expectedRevision: category.revision, patch: {} }
                if (command.field === "staff") { patch.patch.supportRoleIds = command.value; facts = yield* refresh({ roleIds: command.value }); patch.roles = facts.roleSnapshots.filter(role => command.value.includes(role.roleId)) }
                else if (command.field === "parent") { patch.patch.parentId = command.value; facts = yield* refresh(command.value ? { parentId: command.value } : {}) }
                else if (command.field === "enabled") patch.patch.enabled = command.value
                else if (command.field === "visibility") patch.patch.visibility = command.value
                else patch.patch.description = command.value
                operation = patch
            } else if (command.type === "question") {
                const questions = [...category.questions]
                if (command.operation === "clear") questions.length = 0
                else if (command.operation === "add") questions.push(command.text)
                else {
                    if (command.index > questions.length) { yield* reply("That question does not exist"); return }
                    if (command.operation === "set") questions[command.index - 1] = command.text
                    else questions.splice(command.index - 1, 1)
                }
                operation = { type: "category-update", name, expectedRevision: category.revision, patch: { questions } }
            } else if (command.type === "canned") {
                if (command.operation === "remove") operation = { type: "canned-remove", name, expectedRevision: category.revision, cannedName: command.name }
                else {
                    if (command.operation !== "set" || !publishing) return yield* Effect.fail(new TicketHandlingError({ stage: "content" }))
                    const template = yield* publishing.query({ serverId, actor: facts.context.actor, operation: { type: "draft-show", kind: "template", name: command.templateName } })
                    if (template.type !== "draft") return yield* Effect.fail(new TicketHandlingError({ stage: "content" }))
                    operation = { type: "canned-set", name, expectedRevision: category.revision, cannedName: command.name, templateName: command.templateName, expectedTemplateRevision: template.draft.revision }
                }
            } else return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            // Configuration uses the latest observed actor, including after parent/template/role reads.
            const fresh = yield* refresh()
            facts.context = { ...facts.context, observedAt: fresh.context.observedAt, actor: fresh.context.actor }
            yield* display(yield* manage(operation))
            return
        }
        if (command.type === "open") {
            const category = yield* query({ type: "category", name: command.category })
            if (category.type !== "category") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            const opened = yield* store.intake({ ...source(), operation: { type: "open", categoryName: command.category, expectedCategoryRevision: category.category.revision } })
            if (opened.duplicate || opened.type !== "intake") yield* display(opened)
            else yield* reply(`Intake #${opened.intake.intakeNo} opened in category ${opened.intake.category.name}\n${opened.intake.category.questions.length ? `${audience(opened.intake.category)}\n` : ""}${intakeStep(opened.intake, option)}`)
            return
        }
        if (command.type === "answer" || command.type === "review" || command.type === "cancel" || command.type === "submit" || command.type === "intake-reply") {
            const result = yield* query({ type: "intake", intakeNo: command.intakeNo })
            if (result.type !== "intake") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            if (command.type === "review") { yield* card(intakeCard(result.intake, option)); return }
            const intake = result.intake, base = { intakeNo: intake.intakeNo, expectedGeneration: intake.generation }
            let operation: TicketIntakeRequest["operation"]
            if (command.type === "intake-reply") {
                const current = unanswered(intake), word = command.text.toLowerCase(), last = (current < 0 ? intake.category.questions.length : current) - 1
                if (word === "cancel") operation = { ...base, type: "cancel" }
                else if (word === "back") {
                    if (last < 0) { yield* reply(`There is no earlier answer to change\n${intakeStep(intake, option)}`); return }
                    operation = { ...base, type: "clear", question: last + 1 }
                } else if (word === "send") {
                    if (current >= 0) { yield* reply(`Answer every question before sending\n${intakeStep(intake, option)}`); return }
                    operation = { ...base, type: "submit", visibility: intake.category.visibility, expectedCategoryRevision: intake.category.revision }
                } else if (current < 0) { yield* reply(`Every question is answered\n${intakeStep(intake, option)}`); return }
                else if (message.attachments.length || message.stickers.length || !command.text) { yield* reply("Send each answer as text. Attachments and stickers cannot be kept in an intake answer"); return }
                else if (command.text.length > 2000) { yield* reply(`An answer allows at most 2000 characters, and this one has ${command.text.length}. Send a shorter answer`); return }
                else operation = { ...base, type: "answer", question: current + 1, answer: command.text }
            } else operation = command.type === "answer" ? { ...base, type: "answer", question: command.index, answer: command.text }
                : command.type === "submit" ? { ...base, type: "submit", visibility: command.visibility, expectedCategoryRevision: intake.category.revision } : { ...base, type: "cancel" }
            facts = yield* refresh(operation.type === "submit" ? { botPermission: Permissions.ManageChannels | Permissions.ManageRoles,
                ...(intake.category.parentId ? { parentId: intake.category.parentId } : {}) } : {})
            const changed = yield* store.intake({ ...source(), operation })
            if (command.type !== "intake-reply" || changed.duplicate || changed.type !== "intake") { yield* display(changed); return }
            if (operation.type === "cancel") yield* reply(`Intake #${intake.intakeNo} cancelled`)
            else yield* reply(`${operation.type === "clear" ? `Previous answer: ${intake.answers[operation.question - 1]}\n` : ""}${intakeStep(changed.intake, option)}`)
            return
        }
        if (command.type === "list") {
            const start = `!ticket${option} list`, key = pageKey(serverId, message, "ticket", "list"), before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* query({ type: "tickets", ...(before ? { beforeTicketNo: before } : {}), own: false })
            if (result.type !== "tickets") return
            rememberPosition(key, result.nextBeforeTicketNo)
            yield* card({ title: "Tickets", description: result.tickets.map(ticketLine).join("\n") || "No tickets yet",
                fields: result.nextBeforeTicketNo ? [["Next", code(`${start} next`)]] : [], ...(result.tickets.length ? { note: `Details: ${code(`!ticket${option} show <number>`)}` } : {}) })
            return
        }
        if (!("ticketNo" in command)) return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const located = yield* query({ type: "locate", ticketNo: command.ticketNo })
        if (located.type !== "locate") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const locator = located.ticket
        if (command.type === "show") {
            const result = yield* query({ type: "ticket", ticketNo: locator.ticketNo })
            if (result.type === "ticket") yield* card(ticketCard(result.ticket, option))
            return
        }
        if (command.type === "erase") {
            yield* display(yield* manage({ type: "erase", ticketNo: locator.ticketNo, expectedGeneration: locator.generation, confirm: true }))
            return
        }
        if (command.type === "abandon") {
            yield* display(yield* manage({ type: "abandon", ticketNo: locator.ticketNo, expectedGeneration: locator.generation }))
            return
        }
        const ticketFacts = () => refresh(locator.channelId ? { channelId: locator.channelId, allowAbsentChannel: true } : {})
        facts = yield* ticketFacts()
        const detailed = yield* query({ type: "ticket", ticketNo: command.ticketNo })
        if (detailed.type !== "ticket") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const ticket = detailed.ticket, expectedGeneration = ticket.generation
        if (command.type === "attempt") {
            const result = yield* query({ type: "attempt", ticketNo: ticket.ticketNo, attemptNo: command.attemptNo })
            if (result.type === "attempt") yield* card(attemptCard(result.attempt))
            return
        }
        if (command.type === "reconcile") {
            if (!ticket.channelId || !ticket.currentAttempt) { yield* reply(`Ticket #${ticket.ticketNo} has no known channel or last action to check. Checking never searches for a channel or repeats an action`); return }
            const result = yield* store.reconcile({ ...source(), ticketNo: ticket.ticketNo, expectedGeneration, attemptId: ticket.currentAttempt.attemptId,
                observation: { originServerId: config.serverId, observedAt: facts.observedAt, channelId: ticket.channelId, channelAbsent: facts.channelAbsent, ...(facts.context.channel ? { channel: facts.context.channel } : {}) } })
            yield* reply(result.recorded ? `Checked ticket #${ticket.ticketNo} and saved what its channel shows: ${ticketStates[result.ticket.state].toLowerCase()}. The last action was not repeated`
                : `Nothing saved for ticket #${ticket.ticketNo}. Its channel matches neither the state before the last action nor the state it asked for`)
            return
        }
        if (command.type === "intake") {
            const result = yield* query({ type: "private-intake", ticketNo: ticket.ticketNo })
            if (result.type !== "private-intake") return
            if (result.erased) yield* reply(`The stored intake answers of ticket #${ticket.ticketNo} were erased`)
            else if (!result.questions.length) yield* reply(`Ticket #${ticket.ticketNo} had no intake questions`)
            else yield* card({ title: `Intake answers for ticket #${ticket.ticketNo}`, fields: result.questions.map((question, index) => [`${index + 1}. ${question}`, result.answers[index] || "Not answered"] as const) })
            return
        }
        // Notes list as numbered snippets, 5 per page, and show reads one in full
        if (command.type === "notes") {
            const start = `!ticket${option} note ${ticket.ticketNo} list`, key = pageKey(serverId, message, "ticket", ticket.ticketNo, "notes"), before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* query({ type: "entries", ticketNo: ticket.ticketNo, kind: "note", ...(before ? { beforeEntryNo: before } : {}) })
            if (result.type !== "entries") return
            rememberPosition(key, result.nextBeforeEntryNo)
            yield* card({ title: `Staff notes on ticket #${ticket.ticketNo}`, description: result.entries.map(e => `**#${e.entryNo}** ${format.userMention(e.authorId)} ${ago(e.createdAt)}: `
                + `${e.erased ? "Erased" : snippet(e.content?.content ?? "", 150)}`).join("\n") || "No staff notes yet",
                fields: result.nextBeforeEntryNo ? [["Next", code(`${start} next`)]] : [], ...(result.entries.length ? { note: `Read one in full with ${code(`!ticket${option} note ${ticket.ticketNo} show <number>`)}` } : {}) })
            return
        }
        if (command.type === "note-show") {
            // The newest note at or below the number is the one asked for only when its number matches
            const result = yield* query({ type: "entries", ticketNo: ticket.ticketNo, kind: "note", beforeEntryNo: command.noteNo + 1 })
            const entry = result.type === "entries" ? result.entries[0] : undefined
            if (!entry || entry.entryNo !== command.noteNo) { yield* reply(`Ticket #${ticket.ticketNo} has no staff note #${command.noteNo}. Check ${code(`!ticket${option} note ${ticket.ticketNo} list`)}`); return }
            yield* card({ title: `Staff note #${entry.entryNo} on ticket #${ticket.ticketNo}`, description: `${format.userMention(entry.authorId)} ${ago(entry.createdAt)}\n${entry.erased ? "Erased" : entry.content?.content ?? ""}` })
            return
        }
        if (command.type === "transcript-list") {
            const start = `!ticket${option} transcript ${ticket.ticketNo} list`, key = pageKey(serverId, message, "ticket", ticket.ticketNo, "transcripts"), before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* query({ type: "transcripts", ticketNo: ticket.ticketNo, ...(before ? { beforeTranscriptNo: before } : {}) })
            if (result.type !== "transcripts") return
            rememberPosition(key, result.nextBeforeTranscriptNo)
            const rows = result.transcripts.map(t => `**#${t.transcriptNo}** ${t.erased ? "Erased" : `${t.messageCount} messages, ${t.pages} ${t.pages === 1 ? "page" : "pages"}`}${t.truncated ? ", cut short" : ""}, captured ${ago(t.capturedAt)}`)
            yield* list(`Transcripts of ticket #${ticket.ticketNo}`, rows, "No transcripts yet", result.nextBeforeTranscriptNo ? `${start} next` : undefined,
                rows.length ? `Read one with ${code(`!ticket${option} transcript ${ticket.ticketNo} show <number>`)}` : undefined)
            return
        }
        if (command.type === "transcript-show") {
            const start = `!ticket${option} transcript ${ticket.ticketNo} show ${command.transcriptNo}`
            const key = pageKey(serverId, message, "ticket", ticket.ticketNo, "transcript", command.transcriptNo), page = command.next ? nextPosition<number>(key) : 1
            if (page === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* query({ type: "transcript", ticketNo: ticket.ticketNo, transcriptNo: command.transcriptNo, page })
            if (result.type !== "transcript") return
            const { transcript } = result
            rememberPosition(key, result.page < transcript.pages ? result.page + 1 : undefined)
            yield* card({ title: `Transcript #${transcript.transcriptNo} of ticket #${ticket.ticketNo}`, description: transcript.erased ? "Erased" : result.text,
                fields: result.page < transcript.pages ? [["Next", code(`${start} next`)]] : [],
                footer: `Channel text only, without attachments or embeds${transcript.truncated ? ". The capture was cut short, so older or longer messages are missing" : ""}` })
            return
        }
        if (command.type === "transcript-capture") {
            const transcript = yield* captureTicketTranscript(store, client, source(), ticket, command.maxMessages, () => ticketFacts().pipe(Effect.map(f => f.context)))
            yield* reply(`Transcript #${transcript.transcriptNo} saved with ${transcript.messageCount} text messages from the channel and its public threads${transcript.truncated ? ". It was cut short at the limit" : ""}. Attachments and embeds are left out, and messages sent during the capture may be missing`)
            return
        }
        const base = { ticketNo: ticket.ticketNo, expectedGeneration }
        let operation: TicketManageOperation
        if (command.type === "reply") operation = { ...base, type: "reply", content: { content: command.text } }
        else if (command.type === "reply-canned") operation = { ...base, type: "canned-reply", cannedName: command.name }
        else if (command.type === "note") operation = { ...base, type: "note", content: command.text }
        else if (command.type === "priority") operation = { ...base, type: "priority", priority: command.priority }
        else if (command.type === "delete") operation = { ...base, type: command.type, confirm: true }
        else if (["claim", "unclaim", "close", "reopen"].includes(command.type)) operation = { ...base, type: command.type as "claim" | "unclaim" | "close" | "reopen" }
        else return yield* Effect.fail(new TicketHandlingError({ stage: "grant" }))
        yield* display(yield* manage(operation))
    }).pipe(Effect.catch(error => reply(error instanceof TicketPermissionError && error.missing?.length ? fixSentence({ permissions: error.missing, channelId: error.channelId })
        : error instanceof TicketStoreError && error.status === 403
        ? "You can't do that with this ticket. Check your roles, the ticket's audience and the server's DEFCON level"
        : "The ticket action could not be confirmed. Check the ticket's status before you try again. NeonFlux never repeats an action whose result is unknown")))
}

/** The one open intake a plain DM answers. With several, the member gets one hint that names them instead of a guess */
export function findTicketIntake(store: TicketStore, event: BotEventContext<"messageCreate">, served: (serverId: string) => boolean, scope: DeploymentScope) {
    return Effect.gen(function* () {
        const { client, message } = event
        const open = (yield* store.openIntakes({ userId: message.author.id }).pipe(Effect.catch(() => Effect.logWarning("Open ticket intakes could not be read").pipe(Effect.as([])))))
            .filter(intake => served(intake.serverId))
        if (open.length < 2) return open[0]
        // The list names servers, so it goes only to a one-to-one DM with this member
        if (!(yield* verifyTicketPrivateAuthor(client, message.channelId, message.author.id).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false))))) return undefined
        const multi = scope.mode === "multi", option = multi ? " --server <server>" : ""
        const names = yield* Effect.forEach(open, ({ serverId, intakeNo }) => (multi ? serverLabel(client, serverId).pipe(Effect.map(label => ` on ${label} (${code(`--server ${serverId}`)})`)) : Effect.succeed("")).pipe(
            Effect.map(where => `#${intakeNo}${where}`)))
        yield* replyText(event, `You have ${open.length} open ticket intakes: ${names.join(", ")}. A plain reply cannot tell which one it answers, so answer with `
            + `${code(`!ticket${option} answer <intake> <question> "answer"`)}, or cancel the ones you do not need with ${code(`!ticket${option} cancel <intake>`)}`)
        return undefined
    })
}
