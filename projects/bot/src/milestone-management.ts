import { serverCommands, serverLabel, serverOption, serverText } from "./server-scope.ts"
import type { MilestonesDelivery, MilestonesDeliveryReason, MilestonesDmIdentity, MilestonesManageOperation, MilestonesPersonalRequest, MilestonesQueryRequest, MilestonesRoute } from "@neonflux/contracts/milestones"
import type { MilestonesKind } from "@neonflux/contracts/publishing-base"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
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
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { checkedPost, unknownMessage } from "./publishing.ts"
import { at, code, notSetUp, onOff, sendCard, usage, type Card } from "./reply-style.ts"
import { replyPrefix } from "./general-settings.ts"

const kinds: Record<MilestonesKind, string> = { birthday: "Birthday celebrations", anniversary: "Anniversary celebrations" }
/** A celebration route as one field: Whether it is on, where and when it posts, and its template */
export const milestoneRouteField = (route: MilestonesRoute): readonly [string, string] =>
    [kinds[route.kind], `${onOff(route.enabled)}. Posted in ${format.channelMention(route.channelId)} at ${route.time} ${route.zone} time, using template ${route.template.name}`]
const retention = "Removing deletes your sign-up and birthday date. Past celebration posts and these DMs stay. NeonFlux keeps the record of a posted celebration for 30 days, and that a year was celebrated for 400 days"
const reasons: Record<MilestonesDeliveryReason, string> = { "activation-cutoff": "it came due while celebrations were off", "late-window": "NeonFlux could not post it in time", superseded: "the setup changed",
    cancelled: "it was cancelled", permission: "NeonFlux could not post in the channel", capacity: "the posting limits were full", "dispatch-expired": "posting took too long", consent: "the member's sign-up no longer applies",
    membership: "the member left", "civil-gap": "that local time does not exist that day", "civil-fold": "that local time happens twice that day", consumed: "this year was already celebrated" }
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
            if (config.scope?.mode === "multi") content = serverText(content, yield* serverLabel(client, serverId))
            for (let offset = 0; offset < content.length; offset += 1900) yield* client.messages.send(channelId, { content: content.slice(offset, offset + 1900), allowedMentions: noMentions }, { timeoutMs: 5000 })
        })
        const card = (value: Card) => sendCard(client, channelId, config, value), command$ = (text: string) => code(`!milestone${serverOption(config)} ${text}`)
        yield* Effect.gen(function* () {
            if ("error" in command) { yield* reply(command.error); return }
            if (command.type === "help") { yield* reply(serverCommands(milestoneHelp, config)); return }
            if (milestonePersonal(command) && !privateInvocation) { yield* reply(`Send your milestone commands here in this DM. Signing up asks you to confirm the public channel. Start with ${command$("me")} or ${command$("help")}`); return }
            const createdAt = yield* sourceTimestamp(message)
            if (command.type === "me" || command.type === "remove" || command.type === "enroll") {
                const identity: MilestonesDmIdentity = { originServerId: config.serverId, userId: actorId, channelId, isDirectMessage: true, isBot: false, observedAt: yield* Clock.currentTimeMillis }
                let operation: MilestonesPersonalRequest["operation"]
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
                if (result.duplicate) { yield* reply(`This command was already handled, so nothing changed again. Check with ${command$("me")}`); return }
                if (worker && command.type !== "me") yield* worker.notify()
                if (result.type === "removed") yield* reply(`Removed ${result.removed} of your milestone sign-ups\n${retention}`)
                else if (result.type === "enrollment") yield* reply(`${kinds[result.enrollment.kind]} are on for you in ${format.channelMention(result.enrollment.channelId)}. Check them with ${command$("me")}, or stop with ${command$(`remove ${result.enrollment.kind}`)}\n${retention}`)
                else yield* card({ title: "Your milestones", ...(result.enrollments.length ? {} : { description: "You have not signed up for any celebrations" }), fields: [
                    ...result.enrollments.map((e): readonly [string, string] => [`Your ${e.kind}`, e.needsReconsent ? `Paused, because the celebration channel changed. Sign up again to confirm the new channel`
                        : `On in ${format.channelMention(e.channelId)}${e.monthDay ? ` on ${e.monthDay} (month and day)` : ""}`]),
                    ...result.routes.map(milestoneRouteField)], footer: `Signing up confirms a public celebration in that channel, at its local time. If the channel changes, you sign up again. ${retention}` })
                return
            }
            const fresh = () => readMilestonesStaffContext(client, serverId, actorId, channelId)
            let staff = yield* fresh()
            const query = (operation: MilestonesQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId, context, operation })))
            if (command.type === "status") {
                const list = `!milestone${serverOption(config)} status ${command.route}`, key = pageKey(serverId, message, "milestone", "status", command.route)
                const cursor = command.next ? nextPosition<string>(key) : undefined
                if (command.next && cursor === undefined) { yield* reply(noNextPage(list)); return }
                const result = yield* query(command.route ? { type: "deliveries", kind: command.route, ...(cursor ? { cursor } : {}) } : { type: "status" })
                if (result.type === "deliveries") {
                    rememberPosition(key, result.nextCursor)
                    const why = (d: MilestonesDelivery) => d.reason ? `, because ${reasons[d.reason]}` : ""
                    const state = (d: MilestonesDelivery) => d.state === "queued" ? `Due ${at(d.dueAt)}` : d.state === "blocked" ? `Due ${at(d.dueAt)}. Waiting until NeonFlux can post in ${format.channelMention(d.channelId)}`
                        : d.state === "reserved" ? "Posting now" : d.state === "uncertain" ? `Not confirmed yet${d.postNo ? `, post #${d.postNo}` : ""}`
                        : d.state === "superseded" ? "Replaced by a changed setup" : `${{ sent: "Posted", failed: "Could not be posted", skipped: "Skipped", cancelled: "Cancelled" }[d.state]}${why(d)}${d.postNo ? ` (post #${d.postNo})` : ""}. It was due ${at(d.dueAt)}`
                    // One note holds the commands for every line: Checking unconfirmed posts, and forgetting settled ones
                    const unsure = result.deliveries.some(d => d.state === "uncertain" && d.postNo), settled = result.deliveries.some(d => d.postNo && d.state !== "uncertain")
                    const note = [...unsure ? [`Check a post that is not confirmed with ${command$(`reconcile ${command.route} <post>`)}`] : [],
                        ...settled ? [`Forget a settled post with ${command$(`forget ${command.route} <post> confirm`)}`] : []].join(". ")
                    yield* card({ title: kinds[command.route!], description: result.deliveries.map(d => `**${format.userMention(d.userId)}, ${d.celebrationYear}:** ${state(d)}`).join("\n") || "No celebrations planned yet",
                        fields: result.nextCursor ? [["Next", code(`${list} next`)]] : [], ...note ? { note } : {} })
                } else if (result.type === "status") yield* card({ title: "Milestones", fields: [["Status", onOff(result.settings.enabled)], ...result.routes.map(milestoneRouteField),
                    ["Publishing", result.publishing.enabled ? "On" : `Off. Celebrations post nothing until ${code(`${replyPrefix(serverId, serverId)}publish module on`)}`],
                    // Counts name their limits only once nearly reached, and the rest show only then
                    ["Members signed up", usage(result.accounts, 1000)], ["Planned posts", usage(result.deliveries, 4000)],
                    ...result.enrollments >= 1600 ? [["Sign-ups", `${result.enrollments} of 2000`] as const] : [],
                    ...result.staffReceipts >= 800 || result.memberReceipts >= 8000 ? [["Changes today", `${usage(result.staffReceipts, 1000)} by staff, ${usage(result.memberReceipts, 10000)} by members`] as const] : []] })
                else return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
                return
            }
            if (command.type === "preview") {
                const result = yield* query({ type: "preview", kind: command.route })
                if (result.type !== "preview") return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
                yield* reply(`Private preview of ${kinds[command.route].toLowerCase()} with template ${result.route.template.name}. This sample is not a real celebration:`)
                yield* client.messages.send(channelId, { content: result.content.content, embeds: result.content.embed ? [result.content.embed] : [], allowedMentions: noMentions }, { timeoutMs: 5000 })
                return
            }
            // Chat changes apply to the current revisions, read right before the write, so the last of two changes wins
            const settings = () => store.query({ serverId, context: staff, operation: { type: "settings" } }).pipe(Effect.flatMap(result => result.type === "settings" ? Effect.succeed(result) : Effect.fail(new MilestonesHandlingError({ stage: "response" }))))
            // A route that was never configured, or was cleared, has revision 0
            const routeRevision = (kind: MilestonesKind) => settings().pipe(Effect.map(result => result.routes.find(route => route.kind === kind)?.revision ?? 0))
            let operation: MilestonesManageOperation
            if (command.type === "module") operation = { type: "settings", expectedRevision: (yield* settings()).settings.revision, enabled: command.enabled }
            else if (command.type === "configure") {
                if (!publishing) { yield* reply(notSetUp("Publishing")); return }
                // The route freezes the template's current revision
                const template = yield* publishing.query({ serverId, actor: staff.actor, operation: { type: "draft-show", kind: "template", name: command.templateName } })
                if (template.type !== "draft") return yield* Effect.fail(new MilestonesStoreError({ operation: "manage", status: 409 }))
                staff = yield* readMilestonesContext(client, serverId, actorId, command.channelId, true, !!template.draft.content.embed)
                operation = { type: "configure", kind: command.route, expectedRevision: yield* routeRevision(command.route), channelId: command.channelId, zone: command.zone, time: command.time, fold: command.fold, template: { name: command.templateName, revision: template.draft.revision } }
            } else if (command.type === "enable" || command.type === "disable" || command.type === "clear") operation = { type: command.type, kind: command.route, expectedRevision: yield* routeRevision(command.route) }
            else if (command.type === "reconcile" || command.type === "forget") {
                if (!publishing) { yield* reply(notSetUp("Publishing")); return }
                const current = yield* publishing.query({ serverId, actor: staff.actor, operation: { type: "post-show", postNo: command.postNo } })
                if (current.type !== "post" || current.post.consumer?.type !== "milestone" || current.post.consumer.kind !== command.route) return yield* Effect.fail(new MilestonesHandlingError({ stage: "grant" }))
                const post = current.post, binding = milestoneDeliveryBinding(current.post.consumer)
                if (command.type === "forget") {
                    if (!command.confirmed) { yield* reply(`Forgetting removes the stored record of post #${post.postNo}. Its message stays, and a post still sending or not confirmed is kept\nConfirm: ${command$(`forget ${command.route} ${post.postNo} confirm`)}`); return }
                    operation = { type: "forget", binding, confirm: "forget" }
                } else {
                    if (!post.messageId) { yield* reply(unknownMessage(post)); return }
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
            if (result.duplicate) { yield* reply("This command was already handled, so nothing changed again"); return }
            if (worker) yield* worker.notify()
            if (result.type === "route") {
                const [label, value] = milestoneRouteField(result.route)
                yield* reply(`${label}: ${value}. Changing the channel asks members to sign up again. Time and template changes apply to later celebrations`)
            }
            else if (result.type === "settings") yield* reply(result.settings.enabled ? `Milestones are on. Celebrations that came due while they were off are skipped. Publishing is turned on separately with ${code(`${replyPrefix(serverId, serverId)}publish module on`)}` : "Milestones are off")
            else if (result.type === "cleared") yield* reply(`${kinds[result.kind]} are cleared and off. Once a new channel is set, members sign up again`)
            else if (result.type === "forgotten") yield* reply(`Forgot ${result.removed} post record${result.removed === 1 ? "" : "s"}. Posted messages stay`)
            else yield* reply(checkedPost(result.post, `Post #${result.post.postNo}`))
        }).pipe(Effect.catch(error => reply(error instanceof MilestonesStoreError ? milestonesErrorMessage(error) : `NeonFlux could not check this DM, your access, the member or the channel. Check ${command$("me")} or the staff status before you try again`)))
    })
}
