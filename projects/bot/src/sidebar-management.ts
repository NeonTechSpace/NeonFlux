import type { SidebarDashboardContext, SidebarOperation } from "@neonflux/contracts/sidebar"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { ChannelType, format, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, replyCard, replyText } from "./reply-style.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { parseSidebarCommand, sidebarHelp } from "./sidebar-command.ts"
import { SidebarStoreError, type SidebarStore } from "./sidebar-store.ts"

/** The server's own dashboard page, which the link channel opens */
export const dashboardLinkUrl = (websiteUrl: string, serverId: string) => new URL(`/?server=${serverId}`, websiteUrl).href
const notFound = (error: unknown) => error !== null && typeof error === "object" && (error as { reason?: unknown }).reason === "notFound"
const missingWebsite = "Set NEONFLUX_WEBSITE_URL in the bot environment first, so the link has a dashboard address"

function describe(error: unknown) {
    if (error instanceof SidebarStoreError) {
        if (error.status === 404) return "This server has no dashboard link. Add one with !sidebar add"
        if (error.status === 409) return "The dashboard link changed on the website while this command ran. Check !sidebar and try again"
        if (error.status === 400) return "Check the sidebar command values. Use !sidebar help"
        return "The dashboard link is unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    if (error !== null && typeof error === "object" && (error as { _tag?: unknown })._tag === "ChannelOperationError") return "Fluxer refused the channel change. NeonFlux needs Manage Channels"
    return "The sidebar command could not be completed"
}

/** Creates the link channel. The caller records it and deletes it again when recording fails */
const createLink = (client: Client, serverId: string, websiteUrl: string, name: string, categoryId: string | null) =>
    client.channels.create(serverId, { type: ChannelType.Link, name, url: dashboardLinkUrl(websiteUrl, serverId), parentId: categoryId }, { auditReason: "NeonFlux dashboard link" })
const undoLink = (client: Client, channelId: string) => client.channels.delete(channelId, { auditReason: "NeonFlux dashboard link could not be saved" }).pipe(Effect.catch(() => Effect.void))
const renameLink = (client: Client, serverId: string, websiteUrl: string, channelId: string, name: string) =>
    client.channels.edit(channelId, { name, url: dashboardLinkUrl(websiteUrl, serverId) }, { auditReason: "NeonFlux dashboard link" })
/** Deletes the recorded channel when it is still a link channel of this server. A channel that is already gone counts as removed */
const deleteLink = (client: Client, serverId: string, channelId: string) => client.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(
    Effect.flatMap(channel => channel.guildId === serverId && channel.type === ChannelType.Link ? client.channels.delete(channelId, { auditReason: "NeonFlux dashboard link removed" }) : Effect.void),
    Effect.catchIf(notFound, () => Effect.void))
const isCategory = (client: Client, serverId: string, channelId: string) => client.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(
    Effect.map(channel => channel.guildId === serverId && channel.type === ChannelType.Category), Effect.catch(() => Effect.succeed(false)))

export function handleSidebarCommand(store: SidebarStore | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply(notSetUp("Dashboard link")); return }
        const command = parseSidebarCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(sidebarHelp); return }
        const { actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can manage the dashboard link"); return }
        const { link } = yield* store.get({ serverId })
        const manage = (operation: SidebarOperation) => sourceTimestamp(message).pipe(Effect.flatMap(createdAt =>
            store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation })))
        if (command.type === "status") {
            if (!link) { yield* replyCard(context, serverId, { title: "Dashboard link", description: `No dashboard link yet. Add one with ${code(`${prefix}sidebar add`)}` }); return }
            const present = yield* client.channels.fetch(link.channelId, { timeoutMs: 5000 }).pipe(Effect.as(true), Effect.catchIf(notFound, () => Effect.succeed(false)))
            yield* present ? replyCard(context, serverId, { title: "Dashboard link", fields: [["Channel", format.channelMention(link.channelId)],
                ["Opens", config.websiteUrl ? dashboardLinkUrl(config.websiteUrl, serverId) : "This server's dashboard"]] })
                : reply("The dashboard link channel was deleted. Use !sidebar remove, then !sidebar add")
            return
        }
        if (command.type === "remove") {
            if (!link) { yield* reply("This server has no dashboard link"); return }
            yield* deleteLink(client, serverId, link.channelId)
            yield* manage({ type: "remove" })
            yield* reply("Dashboard link removed")
            return
        }
        if (!config.websiteUrl) { yield* reply(missingWebsite); return }
        if (command.type === "set") {
            if (!link) { yield* reply("This server has no dashboard link. Add one with !sidebar add"); return }
            yield* renameLink(client, serverId, config.websiteUrl, link.channelId, command.name)
            yield* manage({ type: "set", name: command.name })
            yield* reply(`Dashboard link ${format.channelMention(link.channelId)} renamed to ${command.name}`)
            return
        }
        if (link) { yield* reply(`This server already has a dashboard link, ${format.channelMention(link.channelId)}. Use !sidebar set "name" or !sidebar remove`); return }
        if (command.categoryId && !(yield* isCategory(client, serverId, command.categoryId))) { yield* reply("Choose a category ID from this server"); return }
        const created = yield* createLink(client, serverId, config.websiteUrl, command.name, command.categoryId)
        yield* manage({ type: "add", channelId: created.id, name: command.name }).pipe(Effect.tapError(() => undoLink(client, created.id)))
        yield* reply(`Dashboard link ${format.channelMention(created.id)} created. It opens ${dashboardLinkUrl(config.websiteUrl, serverId)} from the server sidebar`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

/** Native work a dashboard link request needs before the backend applies it, with an undo for a channel that was only just created */
export function prepareSidebarDashboardJob(client: Client, store: SidebarStore, config: BotConfig, job: DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "sidebar") return undefined
        const op = job.operation, serverId = config.serverId
        if (op.type !== "remove" && !config.websiteUrl) return yield* Effect.fail(new Error(missingWebsite))
        if (op.type === "add") {
            const created = yield* createLink(client, serverId, config.websiteUrl!, op.name, op.categoryId)
            return { context: { originServerId: serverId, channelId: created.id } satisfies SidebarDashboardContext, undo: undoLink(client, created.id) }
        }
        const { link } = yield* store.get({ serverId })
        if (link && op.type === "set") yield* renameLink(client, serverId, config.websiteUrl!, link.channelId, op.name)
        if (link && op.type === "remove") yield* deleteLink(client, serverId, link.channelId)
        return { undo: Effect.void }
    })
}
