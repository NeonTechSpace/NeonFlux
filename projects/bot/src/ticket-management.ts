import type * as C from "@neonflux/backend/contracts"
import { Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { ticketHelp, ticketPrivateCommand, type TicketCommand } from "./ticket-command.ts"
import { readTicketAuthority, verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import { TicketStoreError, type TicketStore } from "./ticket-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { captureTicketTranscript } from "./ticket-transcripts.ts"
import { performTicketChain, TicketHandlingError } from "./tickets.ts"

const intakeSummary = (intake: C.TicketIntake) => `Intake ${intake.intakeNo}: ${intake.state}, generation ${intake.generation}, category ${intake.category.name} revision ${intake.category.revision}\n${audience(intake.category)}\n${intake.category.questions.map((question, index) => `${index + 1}. ${question}\nAnswer: ${intake.answers[index] || "Not answered"}`).join("\n")}\nReview before submitting: !ticket submit ${intake.intakeNo} ${intake.category.visibility}`
function summary(ticket: C.TicketRecord) {
    const attempt = ticket.currentAttempt
    return [
        `Ticket ${ticket.ticketNo}: ${ticket.state}, generation ${ticket.generation}, ${ticket.visibility} conversation`,
        `, requester ${ticket.requesterId}, priority ${ticket.priority}`,
        ticket.claimedBy ? `, claimed by ${ticket.claimedBy}` : "",
        ticket.channelId ? `, channel ${ticket.channelId}` : ", native channel identity unknown",
        ticket.transition ? `, ${ticket.transition} steps ${ticket.completedSteps ?? 0}/2` : "",
        attempt ? `, current attempt ${attempt.attemptNo} ${attempt.action} ${attempt.outcome}` : "",
        attempt?.resolved ? `, reconciled ${attempt.resolved}` : "",
        ticket.erased ? ", stored bodies erased" : "",
    ].join("")
}
function attemptSummary(attempt: C.TicketAttempt) {
    return [
        `Attempt ${attempt.attemptNo} for ticket ${attempt.ticketNo}: ${attempt.action}, ${attempt.outcome}`,
        `, generation ${attempt.generation}, created ${attempt.createdAt}`,
        attempt.finishedAt !== undefined ? `, finished ${attempt.finishedAt}` : "",
        attempt.resolved ? `, current observation reconciled ${attempt.resolved}` : "",
        attempt.noDispatch ? ", proven not dispatched" : "",
        attempt.messageId ? `, known message ${attempt.messageId}` : "",
        attempt.nativeDeleteConfirmed ? ", native delete acknowledged" : "",
        ". This view contains operation metadata only",
    ].join("")
}
function audience(category: C.TicketIntakeCategory) {
    const scope = category.visibility === "public" ? "Public conversation visible to members with native access"
        : "Private conversation visible to the requester, disclosed support roles, owner and administrators"
    const roles = category.supportRoleIds.join(", ") || "None, owner and administrators only"
    return `${scope}. Support role IDs: ${roles}. Intake answers remain private and never enter the conversation channel`
}

export function handleTicketCommand(store: TicketStore, publishing: PublishingStore | undefined, config: BotConfig,
    command: TicketCommand | { error: string }, event: BotEventContext<"messageCreate">) {
    const reply = (content: string) => event.reply({ content, allowedMentions: noMentions }).pipe(Effect.asVoid)
    const chunks = (content: string) => Effect.gen(function* () { for (let offset = 0; offset < content.length; offset += 1900) yield* reply(content.slice(offset, offset + 1900)) })
    return Effect.gen(function* () {
        const { client, message } = event, serverId = config.serverId, actorId = message.author.id
        const privateInvocation = message.guildId === undefined
        if (message.guildId !== undefined && message.guildId !== serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (ticketPrivateCommand(command) && !privateInvocation) { yield* reply("Use this command in a verified one-to-one DM with the bot. Do not post intake answers or staff notes in a server channel"); return }
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
        const query = (operation: C.TicketQueryRequest["operation"]) => store.query({ serverId, context: facts.context, operation })
        if (command.type === "help") { yield* chunks(ticketHelp); return }
        if (command.type === "categories") {
            const result = yield* query({ type: "categories" })
            if (result.type !== "categories") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            yield* chunks(result.categories.map(category => `${category.name}: ${category.visibility} conversation, ${category.enabled ? "Enabled" : "Disabled"}, revision ${category.revision}\n${category.description}`).join("\n") || "No ticket categories")
            return
        }
        if (command.type === "settings") {
            const result = yield* query({ type: "settings" })
            if (result.type === "settings") yield* reply(`Tickets: ${result.settings.enabled ? "On" : "Off"}. Closed private body retention ${result.settings.retentionDays} days. Native channels are not automatically deleted`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const source = (): C.TicketSource => ({ serverId, context: facts.context, messageId: message.id, createdAt })
        const manage = (operation: C.TicketManageOperation) => store.manage({ ...source(), operation })
        const display = (result: C.TicketManageResult | C.TicketIntakeResult) => Effect.gen(function* () {
            if (result.duplicate) return
            if (result.type === "ticket") {
                if (result.grant) {
                    const actions = yield* performTicketChain(store, serverId, client, result.grant, privateInvocation ? message.channelId : undefined)
                    const final = actions.at(-1)
                    if (final && "ticket" in final && final.ticket) yield* reply(`${summary(final.ticket)}\nNative operation ${final.outcome}, acknowledgment ${final.recorded ? "Confirmed" : "Unconfirmed"}. Unknown effects are never retried automatically`)
                    else yield* reply(`Ticket ${result.ticket.ticketNo}: Native operation ${final?.outcome ?? "Unconfirmed"}, acknowledgment unconfirmed. Inspect status before any further operation`)
                } else yield* reply(summary(result.ticket))
            } else if (result.type === "intake") yield* chunks(intakeSummary(result.intake))
            else if (result.type === "category") yield* reply(`Category ${result.category.name}, revision ${result.category.revision}, ${result.category.visibility}, ${result.category.enabled ? "Enabled" : "Disabled"}`)
            else if (result.type === "deleted") yield* reply(`Category ${result.name} deleted. Retained tickets keep their original audience`)
            else if (result.type === "entry") yield* reply(`Stored ${result.entry.kind} ${result.entry.entryNo} for ticket ${result.entry.ticketNo}`)
            else yield* reply(`Tickets: ${result.settings.enabled ? "On" : "Off"}. Closed private body retention ${result.settings.retentionDays} days`)
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
            if (command.type === "category-show") {
                yield* chunks([
                    `${category.name}: ${category.visibility}, ${category.enabled ? "Enabled" : "Disabled"}, revision ${category.revision}`,
                    category.description,
                    `Parent ${category.parentId ?? "None"}, support roles ${category.supportRoleIds.join(", ") || "None"}`,
                    `Questions: ${category.questions.map((q, i) => `${i + 1}. ${q}`).join("\n") || "None"}`,
                    `Canned replies: ${category.cannedReplies.map(c => c.name).join(", ") || "None"}`,
                ].join("\n"))
                return
            }
            if (command.type === "canned" && command.operation === "list") { yield* reply(category.cannedReplies.map(c => `${c.name}: Template ${c.templateName} revision ${c.templateRevision}`).join("\n") || "No canned replies"); return }
            let operation: C.TicketManageOperation
            if (command.type === "category-delete") operation = { type: "category-delete", name, expectedRevision: category.revision }
            else if (command.type === "category-set") {
                const patch: C.TicketManageOperation & { type: "category-update" } = { type: "category-update", name, expectedRevision: category.revision, patch: {} }
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
            yield* display(yield* store.intake({ ...source(), operation: { type: "open", categoryName: command.category, expectedCategoryRevision: category.category.revision } }))
            return
        }
        if (command.type === "answer" || command.type === "review" || command.type === "cancel" || command.type === "submit") {
            const result = yield* query({ type: "intake", intakeNo: command.intakeNo })
            if (result.type !== "intake") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            if (command.type === "review") { yield* chunks(intakeSummary(result.intake)); return }
            facts = yield* refresh(command.type === "submit" ? { botPermission: Permissions.ManageChannels | Permissions.ManageRoles,
                ...(result.intake.category.parentId ? { parentId: result.intake.category.parentId } : {}) } : {})
            const base = { intakeNo: result.intake.intakeNo, expectedGeneration: result.intake.generation }
            const operation: C.TicketIntakeRequest["operation"] = command.type === "answer" ? { ...base, type: "answer", question: command.index, answer: command.text }
                : command.type === "submit" ? { ...base, type: "submit", visibility: command.visibility, expectedCategoryRevision: result.intake.category.revision } : { ...base, type: "cancel" }
            yield* display(yield* store.intake({ ...source(), operation }))
            return
        }
        if (command.type === "list") {
            const result = yield* query({ type: "tickets", ...(command.beforeTicketNo ? { beforeTicketNo: command.beforeTicketNo } : {}), own: false })
            if (result.type === "tickets") yield* chunks(`${result.tickets.map(summary).join("\n") || "No tickets"}${result.nextBeforeTicketNo ? `\nNext: !ticket list ${result.nextBeforeTicketNo}` : ""}`)
            return
        }
        if (!("ticketNo" in command)) return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const located = yield* query({ type: "locate", ticketNo: command.ticketNo })
        if (located.type !== "locate") return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
        const locator = located.ticket
        if (command.type === "status") {
            const result = yield* query({ type: "ticket", ticketNo: locator.ticketNo })
            if (result.type === "ticket") yield* reply(summary(result.ticket))
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
            if (result.type === "attempt") yield* reply(attemptSummary(result.attempt))
            return
        }
        if (command.type === "reconcile") {
            if (!ticket.channelId || !ticket.currentAttempt) { yield* reply("There is no known native channel identity and current attempt to reconcile. Reconciliation cannot search for a channel or repeat a write"); return }
            const result = yield* store.reconcile({ ...source(), ticketNo: ticket.ticketNo, expectedGeneration, attemptId: ticket.currentAttempt.attemptId,
                observation: { observedAt: facts.observedAt, channelId: ticket.channelId, channelAbsent: facts.channelAbsent, ...(facts.context.channel ? { channel: facts.context.channel } : {}) } })
            yield* reply(`${summary(result.ticket)}\n${result.recorded ? "Recorded the current native observation without replaying the original operation"
                : "Nothing recorded. The current native state proves neither the previous nor the requested state"}`)
            return
        }
        if (command.type === "intake") {
            const result = yield* query({ type: "private-intake", ticketNo: ticket.ticketNo })
            if (result.type === "private-intake") yield* chunks(result.erased ? "Stored intake bodies were erased" : result.questions.map((q,i) => `${i + 1}. ${q}\n${result.answers[i] ?? ""}`).join("\n") || "No intake questions")
            return
        }
        if (command.type === "notes") {
            const result = yield* query({ type: "entries", ticketNo: ticket.ticketNo, kind: "note", ...(command.beforeEntryNo ? { beforeEntryNo: command.beforeEntryNo } : {}) })
            if (result.type === "entries") yield* chunks(`${result.entries.map(e => `Note ${e.entryNo}, author ${e.authorId}: ${e.erased ? "Erased" : e.content?.content ?? ""}`).join("\n") || "No staff notes"}${result.nextBeforeEntryNo ? `\nNext: !ticket note ${ticket.ticketNo} list ${result.nextBeforeEntryNo}` : ""}`)
            return
        }
        if (command.type === "transcript-list") {
            const result = yield* query({ type: "transcripts", ticketNo: ticket.ticketNo,
                ...(command.beforeTranscriptNo ? { beforeTranscriptNo: command.beforeTranscriptNo } : {}) })
            if (result.type !== "transcripts") return
            const rows = result.transcripts.map(t => `Transcript ${t.transcriptNo}: ${t.erased ? "Erased" : `${t.messageCount} messages, ${t.pages} pages`}${t.truncated ? ", truncated" : ""}`)
            const next = result.nextBeforeTranscriptNo ? `\nNext: !ticket transcript ${ticket.ticketNo} list ${result.nextBeforeTranscriptNo}` : ""
            yield* chunks(`${rows.join("\n") || "No transcripts"}${next}`)
            return
        }
        if (command.type === "transcript-show") {
            const result = yield* query({ type: "transcript", ticketNo: ticket.ticketNo, transcriptNo: command.transcriptNo, page: command.page })
            if (result.type !== "transcript") return
            const { transcript } = result
            const notice = transcript.truncated ? ". Bounded capture truncated, older or longer messages are missing" : ""
            const next = result.page < transcript.pages ? `\nNext: !ticket transcript ${ticket.ticketNo} show ${transcript.transcriptNo} ${result.page + 1}` : ""
            yield* chunks(`Transcript ${transcript.transcriptNo}, page ${result.page}/${transcript.pages}, observed channel text only${notice}\n${transcript.erased ? "Erased" : result.text}${next}`)
            return
        }
        if (command.type === "transcript-capture") {
            const transcript = yield* captureTicketTranscript(store, client, source(), ticket, command.maxMessages, () => ticketFacts().pipe(Effect.map(f => f.context)))
            yield* reply(`Transcript ${transcript.transcriptNo}: ${transcript.messageCount} observed text messages${transcript.truncated ? ", bounded capture truncated" : ""}. Attachments and rich embed bodies omitted. Capture is not complete or atomic`)
            return
        }
        const base = { ticketNo: ticket.ticketNo, expectedGeneration }
        let operation: C.TicketManageOperation
        if (command.type === "reply") operation = { ...base, type: "reply", content: { content: command.text } }
        else if (command.type === "reply-canned") operation = { ...base, type: "canned-reply", cannedName: command.name }
        else if (command.type === "note") operation = { ...base, type: "note", content: command.text }
        else if (command.type === "priority") operation = { ...base, type: "priority", priority: command.priority }
        else if (command.type === "delete") operation = { ...base, type: command.type, confirm: true }
        else if (["claim", "unclaim", "close", "reopen"].includes(command.type)) operation = { ...base, type: command.type as "claim" | "unclaim" | "close" | "reopen" }
        else return yield* Effect.fail(new TicketHandlingError({ stage: "grant" }))
        yield* display(yield* manage(operation))
    }).pipe(Effect.catch(error => reply(error instanceof TicketStoreError && error.status === 403
        ? "Ticket access or operation is blocked by current membership, native permissions, audience or DEFCON policy"
        : "The ticket operation could not be verified. Inspect status before another write. Unknown native effects are never replayed")))
}
