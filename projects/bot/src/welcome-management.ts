import type { GreetingsDelivery, GreetingsManageRequest, GreetingsRoute, GreetingsSettings, GreetingsState } from "@neonflux/contracts/greetings"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { readWelcomeDestination, readWelcomeMember } from "./welcome-permissions.ts"
import { greetingsHelp, type GreetingsCommand } from "./welcome-command.ts"
import { sourceTimestamp, noMentions } from "./responses.ts"
import { ago, code, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { GreetingsStoreError, type GreetingsStore } from "./welcome-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import type { startGreetingsWorker } from "./welcome-worker.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

const routeNames: Record<GreetingsRoute, string> = { welcome: "Welcome greeting", dm: "DM greeting", goodbye: "Goodbye greeting" }
const stateNames: Record<GreetingsState, string> = { waiting: "Waiting", ready: "Ready to send", reserved: "Sending", sent: "Sent", failed: "Could not be sent",
    uncertain: "Not confirmed yet", cancelled: "Cancelled", expired: "Expired" }
const reasons: Record<NonNullable<GreetingsDelivery["reason"]>, string> = { verification: "the member did not verify", eligibility: "the member could not get it",
    configuration: "the greeting settings changed", membership: "the member left or rejoined", lifetime: "it waited too long", capacity: "too many greetings at once" }
function routeCard(route: GreetingsRoute, settings: GreetingsSettings, prefix: string, title = routeNames[route]): Card {
    const value = settings.routes[route], command = route === "dm" ? "welcome dm" : route
    return { title, fields: [["Status", onOff(value.enabled)], ["Channel", route === "dm" ? "The member's DMs" : value.channelId ? format.channelMention(value.channelId) : "Not set"],
        ["Template", value.templateName ?? `Not set. Run ${code(`${prefix}${command} help`)}`], ...(route === "goodbye" ? [] : [["Sent", value.timing === "verified" ? "After the member verifies" : "When the member joins"] as const]),
        ["Shared limit", `${settings.claimsPerMinute} greetings a minute`], ["History kept", `${settings.retentionDays} days`]] }
}

export function handleGreetingsCommand(store: GreetingsStore, publishing: PublishingStore | undefined, config: BotConfig,
    command: GreetingsCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: Effect.Success<ReturnType<typeof startGreetingsWorker>>) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        if ("error" in command) { yield* reply(command.error); return }
        const authority = yield* readSafetyAuthority(context.client, config.serverId, context.message.author.id)
        if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage greetings"); return }
        const actor = moderationActor(authority)
        if (command.type === "help") { yield* reply(withPrefix(greetingsHelp(command.route), prefix)); return }
        if (command.type === "query") {
            const result = yield* store.query({ serverId: config.serverId, actor, operation: command.operation })
            if (result.type === "settings") yield* card(routeCard(command.route, result.settings, prefix))
            else if (result.type === "delivery") {
                const d = result.delivery
                yield* card({ title: `Greeting #${d.deliveryNo}`, fields: [
                    ["Status", `${stateNames[d.state]}${d.reason ? `, because ${reasons[d.reason]}` : ""}${d.state === "sent" && d.channelId && d.route !== "dm" ? ` in ${format.channelMention(d.channelId)}` : ""}`],
                    ["Member", format.userMention(d.userId)], ["Greeting", routeNames[d.route]], ["Created", ago(d.createdAt)]],
                    footer: "NeonFlux never sends a greeting again on its own" })
            }
            else if (result.type === "member") yield* result.member ? card({ title: "Greeting member", fields: [["Member", format.userMention(result.member.userId)],
                ["In the server", result.member.present ? "Yes" : "No"], ["Joined", ago(Date.parse(result.member.joinedAt))]] }) : reply("NeonFlux has no join record for that member")
            return
        }
        if (command.type === "history") {
            const start = `${prefix}${command.route === "dm" ? "welcome dm" : command.route} history`
            const key = pageKey(config.serverId, context.message, "greetings", command.route, "history"), before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* store.query({ serverId: config.serverId, actor, operation: { type: "deliveries", ...(before ? { beforeDeliveryNo: before } : {}) } })
            if (result.type !== "deliveries") return
            rememberPosition(key, result.nextBeforeDeliveryNo)
            yield* card({ title: "Greeting history", description: result.deliveries.map((d) => `**#${d.deliveryNo}** ${routeNames[d.route]} for ${format.userMention(d.userId)}: ${stateNames[d.state]}, ${ago(d.createdAt)}`).join("\n") || "No greetings yet",
                fields: result.nextBeforeDeliveryNo ? [["Next", code(`${start} next`)]] : [] })
            return
        }
        if (command.type === "preview") {
            const member = yield* readWelcomeMember(context.client, config.serverId, actor.userId)
            if (!member.context) return
            const result = yield* store.query({ serverId: config.serverId, actor, operation: { type: "preview", route: command.route, userId: actor.userId,
                userName: member.context.userName, serverName: member.context.serverName, channelId: context.message.channelId } })
            if (result.type !== "preview") return
            yield* readWelcomeDestination(context.client, config.serverId, context.message.channelId, !!result.content.embed)
            yield* reply(`Preview of the ${routeNames[command.route].toLowerCase()}, filled in with your details`)
            yield* context.reply({ content: result.content.content, embeds: result.content.embed ? [result.content.embed] : [], allowedMentions: noMentions })
            return
        }
        let operation: GreetingsManageRequest["operation"]
        if (command.type === "configure") {
            if (!publishing) { yield* reply(notSetUp("Publishing")); return }
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
        if (!fresh.isOwner && !fresh.isAdmin) { yield* reply("NeonFlux could not confirm that you are still an administrator, so nothing changed"); return }
        const saved = yield* store.manage({ serverId: config.serverId, actor: moderationActor(fresh), messageId: context.message.id,
            createdAt: yield* sourceTimestamp(context.message), operation })
        const name = routeNames[command.route], settings = saved.settings
        // A new template is several settings at once and shows them all. Every other change names its one new value
        if (!saved.duplicate) yield* command.type === "configure" ? card(routeCard(command.route, settings, prefix, `${name} saved`))
            : reply(command.type === "module" ? `${name} is ${onOff(settings.routes[command.route].enabled).toLowerCase()}` : command.type === "clear" ? `${name} is cleared and off`
                : command.claimsPerMinute !== undefined ? `Greetings now send at most ${settings.claimsPerMinute} a minute` : `Greeting history is now kept ${settings.retentionDays} days`)
        if (worker) yield* worker.notify()
    }).pipe(Effect.catch((error) => reply(error instanceof GreetingsStoreError && error.status === 403
        ? "Greetings can't be changed right now because of your permissions or the server's DEFCON level"
        : "NeonFlux could not confirm the greeting settings or delivery. Check them before you try again")))
}
