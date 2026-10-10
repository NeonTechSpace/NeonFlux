import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { readWelcomeDestination, readWelcomeMember } from "./welcome-permissions.ts"
import { greetingsHelp, type GreetingsCommand } from "./welcome-command.ts"
import { sourceTimestamp, noMentions } from "./responses.ts"
import { GreetingsStoreError, type GreetingsStore } from "./welcome-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import type { startGreetingsWorker } from "./welcome-worker.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

function routeSummary(route: C.GreetingsRoute, settings: C.GreetingsSettings) {
    const value = settings.routes[route]
    return `${route}: ${value.enabled ? "On" : "Off"}, revision ${value.revision}, timing ${value.timing}, channel ${value.channelId ?? "Private DM"}, template ${value.templateName ?? "Not configured"}${value.templateRevision ? ` revision ${value.templateRevision}` : ""}. Combined budget ${settings.claimsPerMinute}/minute, history ${settings.retentionDays} days`
}

export function handleGreetingsCommand(store: GreetingsStore, publishing: PublishingStore | undefined, config: BotConfig,
    command: GreetingsCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: Effect.Success<ReturnType<typeof startGreetingsWorker>>) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => context.reply({ content, allowedMentions: noMentions }).pipe(Effect.asVoid)
    return Effect.gen(function* () {
        if ("error" in command) { yield* reply(command.error); return }
        const authority = yield* readSafetyAuthority(context.client, config.serverId, context.message.author.id)
        if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage greetings"); return }
        const actor = moderationActor(authority)
        if (command.type === "help") { yield* reply(withPrefix(greetingsHelp(command.route), prefix)); return }
        if (command.type === "query") {
            const result = yield* store.query({ serverId: config.serverId, actor, operation: command.operation })
            if (result.type === "settings") yield* reply(routeSummary(command.route, result.settings))
            else if (result.type === "delivery") yield* reply(`Delivery ${result.delivery.deliveryNo}: ${result.delivery.route}, ${result.delivery.state}${result.delivery.reason ? ` (${result.delivery.reason})` : ""}, user ${result.delivery.userId}${result.delivery.messageId ? `, message ${result.delivery.messageId}` : ""}. No automatic replay`)
            else if (result.type === "member") yield* reply(result.member ? `Member ${result.member.userId}: ${result.member.present ? "Tracked membership active" : "Tracked membership inactive"}, generation ${result.member.generation}, raw join epoch ${result.member.joinedAt}` : "No retained membership observation")
            return
        }
        if (command.type === "history") {
            const start = `${prefix}${command.route === "dm" ? "welcome dm" : command.route} history`
            const key = pageKey(config.serverId, context.message, "greetings", command.route, "history"), before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* store.query({ serverId: config.serverId, actor, operation: { type: "deliveries", ...(before ? { beforeDeliveryNo: before } : {}) } })
            if (result.type !== "deliveries") return
            rememberPosition(key, result.nextBeforeDeliveryNo)
            yield* reply(`${result.deliveries.map((d) => `Delivery ${d.deliveryNo}: ${d.route}, ${d.state}, user ${d.userId}`).join("\n") || "No retained greeting deliveries"}${result.nextBeforeDeliveryNo ? `\nNext: ${start} next` : ""}`)
            return
        }
        if (command.type === "preview") {
            const member = yield* readWelcomeMember(context.client, config.serverId, actor.userId)
            if (!member.context) return
            const result = yield* store.query({ serverId: config.serverId, actor, operation: { type: "preview", route: command.route, userId: actor.userId,
                userName: member.context.userName, serverName: member.context.serverName, channelId: context.message.channelId } })
            if (result.type !== "preview") return
            yield* readWelcomeDestination(context.client, config.serverId, context.message.channelId, !!result.content.embed)
            yield* reply(`Preview of ${command.route} using your membership in this channel`)
            yield* context.reply({ content: result.content.content, embeds: result.content.embed ? [result.content.embed] : [], allowedMentions: noMentions })
            return
        }
        let operation: C.GreetingsManageRequest["operation"]
        if (command.type === "configure") {
            if (!publishing) { yield* reply("Publishing templates are not configured"); return }
            const template = yield* publishing.query({ serverId: config.serverId, actor, operation: { type: "draft-show", kind: "template", name: command.templateName } })
            if (template.type !== "draft") return
            if (command.channelId) yield* readWelcomeDestination(context.client, config.serverId, command.channelId, !!template.draft.content.embed)
            operation = { type: "configure", route: command.route, templateName: command.templateName, expectedTemplateRevision: template.draft.revision,
                timing: command.timing, ...(command.channelId ? { channelId: command.channelId } : {}) }
        } else if (command.type === "module") operation = { type: "module", route: command.route, enabled: command.enabled }
        else if (command.type === "clear") operation = { type: "clear", route: command.route }
        else operation = { type: "settings", ...(command.claimsPerMinute !== undefined ? { claimsPerMinute: command.claimsPerMinute } : {}),
            ...(command.retentionDays !== undefined ? { retentionDays: command.retentionDays } : {}) }
        // Respect an observed administrator downgrade during template/destination reads.
        const fresh = yield* readSafetyAuthority(context.client, config.serverId, actor.userId)
        if (!fresh.isOwner && !fresh.isAdmin) { yield* reply("Your current administrator permission could not be verified"); return }
        const saved = yield* store.manage({ serverId: config.serverId, actor: moderationActor(fresh), messageId: context.message.id,
            createdAt: yield* sourceTimestamp(context.message), operation })
        if (!saved.duplicate) yield* reply(routeSummary(command.route, saved.settings))
        if (worker) yield* worker.notify()
    }).pipe(Effect.catch((error) => reply(error instanceof GreetingsStoreError && error.status === 403
        ? "Greeting configuration is blocked by current permissions or DEFCON policy"
        : "Greeting configuration or delivery status could not be verified. Inspect current settings before another change")))
}
