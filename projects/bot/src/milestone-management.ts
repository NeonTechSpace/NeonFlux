import { serverCommands, serverOption, serverReply } from "./server-scope.ts"
import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { milestoneHelp, milestonePersonal, type MilestoneCommand } from "./milestone-command.ts"
import { readMilestoneParticipant, resolveMilestoneChannel, readMilestonesContext, readMilestonesStaffContext, verifyMilestonePrivateAuthor } from "./milestone-permissions.ts"
import { milestonesErrorMessage, MilestonesStoreError, type MilestonesStore } from "./milestone-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { publishingMessageContent } from "./publishing-content.ts"
import { milestoneDeliveryBinding, MilestonesHandlingError } from "./milestones.ts"
import { verifyWelcomePrivateChannel } from "./welcome-permissions.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"

export function milestoneRouteSummary(route: C.MilestonesRoute) {
    return `${route.kind}: ${route.enabled ? "Enabled" : "Disabled"}, route revision ${route.revision}, intent ${route.intentRevision}, audience generation ${route.audienceGeneration}\nPublic destination ${route.channelId}, ${route.zone} ${route.time}, fold ${route.fold}\nFrozen template ${route.template.name} revision ${route.template.revision}, created by ${route.createdBy}`
}
const retention = "Removal deletes enrollment and month/day. Previous native posts and original DMs remain. Truthful claimed publishing history is retained, settled tracking retires after 30 days, body-free annual fences last 400 days and unresolved ownership remains until settled"
export function handleMilestoneCommand(store: MilestonesStore, publishing: PublishingStore | undefined, config: BotConfig, command: MilestoneCommand | { error: string }, context: BotEventContext<"messageCreate">,
    worker?: { notify: () => Effect.Effect<void> }) {
    return Effect.gen(function* () {
        const { client, message } = context, serverId = config.serverId, actorId = message.author.id
        if (message.author.isSystem || message.guildId !== undefined && message.guildId !== serverId) return
        const privateInvocation = message.guildId === undefined
        const channelId = privateInvocation ? message.channelId : (yield* client.directMessages.open(actorId, { timeoutMs: 5000 })).id
        if (privateInvocation) yield* verifyMilestonePrivateAuthor(client, channelId, actorId)
        else {
            const botId = yield* readAuthenticatedBotId(client)
            const dm = yield* client.directMessages.fetch(channelId, { timeoutMs: 5000 })
            yield* verifyWelcomePrivateChannel(dm, actorId, botId)
        }
        // Replies go to the private DM, which accepts only the fixed !
        const reply = (content: string) => Effect.gen(function* () {
            if (config.scope?.mode === "multi") content = serverReply(content, serverId)
            for (let offset = 0; offset < content.length; offset += 1900) yield* client.messages.send(channelId, { content: content.slice(offset, offset + 1900), allowedMentions: noMentions }, { timeoutMs: 5000 })
        })
        yield* Effect.gen(function* () {
            if ("error" in command) { yield* reply(command.error); return }
            if (command.type === "help") { yield* reply(serverCommands(milestoneHelp, config)); return }
            if (milestonePersonal(command) && !privateInvocation) { yield* reply(`Send personal milestone commands in this verified one-to-one DM. Enrollment requires explicit confirmation of the configured public channel. Use !milestone${serverOption(config)} me or help here`); return }
            const createdAt = yield* sourceTimestamp(message)
            if (command.type === "me" || command.type === "remove" || command.type === "enroll") {
                const identity: C.MilestonesDmIdentity = { originServerId: config.serverId, userId: actorId, channelId, isDirectMessage: true, isBot: false, observedAt: yield* Clock.currentTimeMillis }
                let operation: C.MilestonesPersonalRequest["operation"]
                if (command.type === "me") operation = { type: "me" }
                else if (command.type === "remove") operation = { type: "remove", kind: command.route ?? "all" }
                else {
                    const resolved = yield* resolveMilestoneChannel(client, serverId, command.channel)
                    if ("error" in resolved) { yield* reply(resolved.error); return }
                    const participant = yield* readMilestoneParticipant(client, serverId, actorId, resolved.channelId)
                    operation = command.route === "birthday" ? { type: "enroll", kind: "birthday", monthDay: command.monthDay!, confirmChannelId: resolved.channelId, participant }
                        : { type: "enroll", kind: "anniversary", confirmChannelId: resolved.channelId, participant }
                }
                const result = yield* store.personal({ serverId, messageId: message.id, createdAt, identity, operation })
                if (result.duplicate) { yield* reply(`This private operation was already recorded. Read !milestone${serverOption(config)} me before another change`); return }
                if (worker && command.type !== "me") yield* worker.notify()
                if (result.type === "removed") yield* reply(`Removed ${result.removed} enrollments\n${retention}`)
                else if (result.type === "enrollment") yield* reply(`${result.enrollment.kind} consent recorded for public channel ${result.enrollment.channelId}, revision ${result.enrollment.revision}, audience generation ${result.enrollment.audienceGeneration}. Use !milestone${serverOption(config)} me to inspect or remove to withdraw\n${retention}`)
                else yield* reply([`Configured server ${serverId}. Your private enrollments:`, ...result.enrollments.map(e => `${e.kind}: ${e.needsReconsent ? "New destination consent required" : "Consented"}, channel ${e.channelId}, consent revision ${e.revision}${e.monthDay ? `, month/day ${e.monthDay}` : ""}`),
                    ...(result.enrollments.length ? [] : ["None"]), "Current routes:", ...result.routes.map(milestoneRouteSummary),
                    "Enrollment confirms public celebration in the exact channel using its timezone. A destination change invalidates consent, including a return to a previous channel. Publishing must be enabled separately", retention].join("\n"))
                return
            }
            const fresh = () => readMilestonesStaffContext(client, serverId, actorId, channelId)
            let staff = yield* fresh()
            const query = (operation: C.MilestonesQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId, context, operation })))
            if (command.type === "status") {
                const result = yield* query(command.route ? { type: "deliveries", kind: command.route, ...(command.cursor ? { cursor: command.cursor } : {}) } : { type: "status" })
                if (result.type === "deliveries") yield* reply([...result.deliveries.map(d => `${d.kind} year ${d.celebrationYear}, user ${d.userId}: ${d.state}${d.reason ? ` (${d.reason})` : ""}, generation ${d.generation}, due ${new Date(d.dueAt).toISOString()} ${d.zone}${d.postNo ? `, tracked post ${d.postNo}` : ""}${d.claimedAt !== undefined ? ", dispatch claimed" : ""}`),
                    ...(result.deliveries.length ? [] : ["No retained deliveries"]), ...(result.nextCursor ? [`Next: !milestone${serverOption(config)} status ${command.route} ${JSON.stringify(result.nextCursor)}`] : []), `Known posts: !milestone${serverOption(config)} reconcile <kind> <post> or forget <kind> <settled-post> confirm. Unknown message identity cannot be searched, adopted or replayed`].join("\n"))
                else if (result.type === "status") yield* reply([`Milestones ${result.settings.enabled ? "On" : "Off"}, settings revision ${result.settings.revision}`, ...result.routes.map(milestoneRouteSummary),
                    `${result.accounts}/1000 accounts, ${result.enrollments}/2000 enrollments, ${result.deliveries}/4000 retained deliveries`, `${result.staffReceipts}/1000 staff and ${result.memberReceipts}/10000 member receipts per day`,
                    `Publishing ${result.publishing.enabled ? "On" : "Off"}`, "First configuration uses route revision 0. Clear and off prevent new work. Capacity pressure defers new announcements and preserves unresolved history", retention].join("\n"))
                else return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
                return
            }
            if (command.type === "preview") {
                const result = yield* query({ type: "preview", kind: command.route })
                if (result.type !== "preview") return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
                yield* reply(`Private preview of ${command.route}, template ${result.route.template.name} revision ${result.route.template.revision}. Example sample only, no enrollment or due admission`)
                yield* client.messages.send(channelId, { content: result.content.content, embeds: result.content.embed ? [result.content.embed] : [], allowedMentions: noMentions }, { timeoutMs: 5000 })
                return
            }
            let operation: C.MilestonesManageOperation
            if (command.type === "module") operation = { type: "settings", expectedRevision: command.expectedRevision, enabled: command.enabled }
            else if (command.type === "configure") {
                if (!publishing) { yield* reply("Publishing transport is unavailable. Route configuration remains unfinished"); return }
                const template = yield* publishing.query({ serverId, actor: staff.actor, operation: { type: "draft-show", kind: "template", name: command.templateName } })
                if (template.type !== "draft" || template.draft.revision !== command.templateRevision) return yield* Effect.fail(new MilestonesStoreError({ operation: "manage", status: 409 }))
                staff = yield* readMilestonesContext(client, serverId, actorId, command.channelId, true, !!template.draft.content.embed)
                operation = { type: "configure", kind: command.route, expectedRevision: command.expectedRevision, channelId: command.channelId, zone: command.zone, time: command.time, fold: command.fold, template: { name: command.templateName, revision: command.templateRevision } }
            } else if (command.type === "enable" || command.type === "disable" || command.type === "clear") operation = { type: command.type, kind: command.route, expectedRevision: command.expectedRevision }
            else if (command.type === "reconcile" || command.type === "forget") {
                if (!publishing) { yield* reply("Publishing transport is unavailable. Exact known-post recovery remains unfinished"); return }
                const current = yield* publishing.query({ serverId, actor: staff.actor, operation: { type: "post-show", postNo: command.postNo } })
                if (current.type !== "post" || current.post.consumer?.type !== "milestone" || current.post.consumer.kind !== command.route) return yield* Effect.fail(new MilestonesHandlingError({ stage: "grant" }))
                const post = current.post, binding = milestoneDeliveryBinding(current.post.consumer)
                if (command.type === "forget") {
                    if (!command.confirmed) { yield* reply(`Forgetting releases only this settled milestone tracking. Native post stays. Pending or unresolved ownership blocks removal\nConfirm: !milestone${serverOption(config)} forget ${command.route} ${post.postNo} confirm`); return }
                    operation = { type: "forget", binding, confirm: "forget" }
                } else {
                    if (!post.messageId) { yield* reply(`Post ${post.postNo} has no known native message identity. Reconciliation cannot search, adopt or resend`); return }
                    const authority = yield* readPublishingAuthority(client, serverId, actorId, post.channelId, false, true)
                    if (authority.botId !== post.botId) return yield* Effect.fail(new MilestonesHandlingError({ stage: "grant" }))
                    const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
                    yield* verifyPublishingMessage(native, { serverId, channelId: post.channelId, messageId: post.messageId, botId: post.botId, verifiedChannel: authority.channel! })
                    const content = publishingMessageContent(native)
                    if (!content) return yield* Effect.fail(new MilestonesHandlingError({ stage: "grant" }))
                    operation = { type: "reconcile", binding, attemptId: post.attempt.attemptId, expectedGeneration: post.generation, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } }
                }
            } else return
            if (command.type !== "configure") staff = yield* fresh()
            const result = yield* store.manage({ serverId, context: staff, messageId: message.id, createdAt, operation })
            if (result.duplicate) { yield* reply("This management command was already recorded. Read current status before another change"); return }
            if (worker) yield* worker.notify()
            if (result.type === "route") yield* reply(`${milestoneRouteSummary(result.route)}\nDestination changes require new consent. Template and time changes replace only future unclaimed intent`)
            else if (result.type === "settings") yield* reply(`Milestones ${result.settings.enabled ? "On" : "Off"}, settings revision ${result.settings.revision}. Activation skips already-due unclaimed work. Publishing remains separately configured`)
            else if (result.type === "cleared") yield* reply(`${result.kind} route cleared and disabled. Existing consent cannot transfer to a new destination. Claimed and unresolved history remains`)
            else if (result.type === "forgotten") yield* reply(`${result.removed} settled tracking records forgotten. Native posts and annual consumed fences remain`)
            else yield* reply(`Post ${result.post.postNo}: ${result.recorded ? "Observation recorded" : "Observation already current"}, operational outcome ${result.post.outcome}. Original delivery history remains truthful. No native announcement was sent, edited or deleted`)
        }).pipe(Effect.catch(error => reply(error instanceof MilestonesStoreError ? milestonesErrorMessage(error) : "Current private identity, human authority, participant membership, destination access or publisher state could not be verified. Read me or staff status before another change")))
    })
}
