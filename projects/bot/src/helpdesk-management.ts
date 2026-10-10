import type * as C from "@neonflux/backend/contracts"
import { ChannelType, isThreadChannel, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { answerHelp, helpDeskHelp, parseAnswerCommand, parseHelpDeskCommand } from "./helpdesk-command.ts"
import { HelpDeskStoreError, type HelpDeskStore } from "./helpdesk-store.ts"
import { helpDeskThreadCap, type HelpDeskRuntime } from "./helpdesk-worker.ts"
import { fixSentence, nativeFix, permissionNames } from "./permission-fix.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { channelPermissionInput, readSafetyAuthority, SafetyPermissionError, type SafetyAuthority } from "./safety-permissions.ts"
import { readTicketAuthority, TicketPermissionError } from "./ticket-permissions.ts"
import { TicketStoreError, type TicketStore } from "./ticket-store.ts"
import { performTicketChain } from "./tickets.ts"

export const helpDeskCommands = ["helpdesk", "answer", "solved", "escalate"]
/** The help desk's commands. !solved is a member command, and the others are staff commands */
export function handleHelpDeskInvocation(name: string, stores: { helpDesk?: HelpDeskStore | undefined, tickets?: TicketStore | undefined }, runtime: HelpDeskRuntime | undefined, config: BotConfig,
    args: readonly string[], context: BotEventContext<"messageCreate">) {
    return name === "helpdesk" ? handleHelpDeskCommand(stores.helpDesk, runtime, config, args, context) : name === "answer" ? handleAnswerCommand(stores.helpDesk, config, args, context)
        : name === "solved" ? handleSolvedCommand(runtime, config, context) : handleEscalateCommand(stores.tickets, runtime, config, args, context)
}

/** What the bot needs in a help desk forum: Greet posts, post answers and reminders, and tag and close posts */
const forumPermissions = Permissions.ViewChannel | Permissions.SendMessagesInThreads | Permissions.ReadMessageHistory | Permissions.ManageThreads
const staffPermissions = Permissions.Administrator | Permissions.ManageGuild | Permissions.ManageThreads
const missing = (required: bigint, bits: bigint) => permissionNames(required & ~bits)

function describe(error: unknown) {
    if (error instanceof HelpDeskStoreError) {
        if (error.status === 404) return "Nothing has that name. Check !helpdesk or !answer list"
        if (error.status === 429) return "That limit is reached: 10 help desk forums or 50 saved answers. Remove one first"
        if (error.status === 409) return "That forum already uses the help desk, or the settings changed on the website while this command ran. Check !helpdesk"
        if (error.status === 403) return "Only the server owner or members with Manage Server can change the help desk, and saved answers also accept Manage Threads"
        if (error.status === 400) return "Check the help desk command values. Use !helpdesk help"
        return "The help desk is unavailable right now. Try again shortly"
    }
    if (error instanceof TicketStoreError) {
        if (error.status === 404) return "No ticket category has that name. Check !ticket categories"
        if (error.status === 429) return "The post's author already has three open tickets"
        if (error.status === 409) return "That ticket category is turned off"
        if (error.status === 403) return "Escalating needs tickets turned on and the server owner, an Administrator or a support role of that category"
        return "Tickets are unavailable right now. Try again shortly"
    }
    if (error instanceof TicketPermissionError && error.missing?.length) return fixSentence({ permissions: error.missing, channelId: error.channelId })
    if (error instanceof SafetyPermissionError || error instanceof TicketPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The help desk command could not be completed"
}
const reply = (context: BotEventContext<"messageCreate">, config: BotConfig, content: string) =>
    context.reply({ content: withPrefix(content, replyPrefix(config.serverId, context.message.guildId)), allowedMentions: noMentions }).pipe(Effect.asVoid)

/** Help desk staff: The server owner, Administrator, Manage Server or Manage Threads, read in the command's channel */
function staff(client: Client, authority: SafetyAuthority) {
    return authority.isOwner || (client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, ...channelPermissionInput(authority) }) & staffPermissions) !== 0n
}
const botBits = (client: Client, authority: SafetyAuthority) => client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
/** The help post a command was sent in, when it is a thread of a help desk forum */
function helpPost(runtime: HelpDeskRuntime, authority: SafetyAuthority) {
    const thread = authority.channel, forum = authority.parentChannel, settings = runtime.settings()
    return thread && isThreadChannel(thread) && forum && settings?.forumIds.includes(forum.id) ? { thread, forum, settings } : undefined
}

export function handleHelpDeskCommand(store: HelpDeskStore | undefined, runtime: HelpDeskRuntime | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) { yield* reply(context, config, "Help desk persistence is not configured"); return }
        const command = parseHelpDeskCommand(args)
        if ("error" in command) { yield* reply(context, config, command.error); return }
        if (command.type === "help") { yield* reply(context, config, helpDeskHelp); return }
        const channelId = command.type === "forum" ? command.channelId : command.type === "guard" ? command.channelId ?? undefined : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, channelId)
        if (!manager) { yield* reply(context, config, "Only the server owner or members with Manage Server can change the help desk"); return }
        if (command.type === "status") {
            const settings = runtime.settings()
            if (!settings) { yield* reply(context, config, "Help desk settings are unavailable right now. Try again shortly"); return }
            const active = yield* client.threads.fetchActive(serverId, { timeoutMs: 10000 }).pipe(Effect.map(threads => String(threads.length)), Effect.catch(() => Effect.succeed("unknown")))
            yield* reply(context, config, [
                `Help desk forums: ${settings.forumIds.map(id => `<#${id}>`).join(", ") || "None. Add one with !helpdesk forum add #forum"}`,
                `Greeting: ${settings.greeting ?? "Off"}`,
                `Solved tag: ${settings.solvedTag}`,
                `Reply reminder: ${settings.nudgeHours === null ? "Off" : `After ${settings.nudgeHours} hours without a reply`}`,
                `Thread warnings: ${settings.guardChannelId ? `In <#${settings.guardChannelId}>` : "Off"}. Auto-archive defaults: ${settings.autoArchive ? "On" : "Off"}`,
                `Active threads: ${active} of ${helpDeskThreadCap}`,
            ].join("\n"))
            return
        }
        const bits = botBits(client, authority)
        if (command.type === "forum" && command.add) {
            if (authority.channel?.type !== ChannelType.Forum && authority.channel?.type !== ChannelType.Media) { yield* reply(context, config, "Choose a forum or media channel of this server"); return }
            const lacking = missing(forumPermissions, bits)
            if (lacking.length) { yield* reply(context, config, fixSentence({ permissions: lacking, channelId: command.channelId })); return }
        }
        if (command.type === "guard" && command.channelId) {
            if (authority.channel?.type !== ChannelType.Text && authority.channel?.type !== ChannelType.Announcement) { yield* reply(context, config, "Choose a text or announcement channel for the warnings"); return }
            const lacking = missing(Permissions.ViewChannel | Permissions.SendMessages, bits)
            if (lacking.length) { yield* reply(context, config, fixSentence({ permissions: lacking, channelId: command.channelId })); return }
        }
        if (command.type === "archive" && command.enabled && (authority.botServerPermissions & Permissions.ManageThreads) === 0n) { yield* reply(context, config, fixSentence({ permissions: ["ManageThreads"] })); return }
        const operation: C.HelpDeskOperation = command.type === "forum" ? { type: command.add ? "forum-add" : "forum-remove", channelId: command.channelId }
            : command.type === "greeting" ? { type: "settings", greeting: command.text } : command.type === "tag" ? { type: "settings", solvedTag: command.name }
            : command.type === "nudge" ? { type: "settings", nudgeHours: command.hours } : command.type === "guard" ? { type: "settings", guardChannelId: command.channelId }
            : { type: "settings", autoArchive: command.enabled }
        const createdAt = yield* sourceTimestamp(message)
        const result = yield* store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, authorized: "manager", operation })
        if (result.type === "settings") yield* runtime.saved(result.settings)
        yield* reply(context, config, "Help desk saved. Check !helpdesk")
    }).pipe(Effect.catch(error => reply(context, config, describe(error))), Effect.asVoid)
}

export function handleAnswerCommand(store: HelpDeskStore | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply(context, config, "Help desk persistence is not configured"); return }
        const command = parseAnswerCommand(args)
        if ("error" in command) { yield* reply(context, config, command.error); return }
        if (command.type === "help") { yield* reply(context, config, answerHelp); return }
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id, { channelId: message.channelId })
        if (!staff(client, authority)) { yield* reply(context, config, "Only help desk staff can use saved answers: The server owner, Administrator, Manage Server or Manage Threads"); return }
        if (command.type === "list") {
            const { answers } = yield* store.answers({ serverId })
            yield* reply(context, config, answers.length ? [`Saved answers ${answers.length}/50`, ...answers.map(answer => `${answer.name}: ${answer.title}`)].join("\n") : "No saved answers. Save one with !answer set <name> \"title\" \"text\"")
            return
        }
        if (command.type === "post") {
            const answer = (yield* store.answers({ serverId, name: command.name })).answers[0]
            if (!answer) { yield* reply(context, config, `No saved answer is named ${command.name}. Check !answer list`); return }
            yield* client.messages.send(message.channelId, { content: `**${answer.title}**\n${answer.content}`.slice(0, 2000), allowedMentions: noMentions }, { timeoutMs: 5000 }).pipe(
                Effect.catch(error => reply(context, config, nativeFix(error, message.channelId) ?? "The answer could not be posted here")))
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const actor: C.ModerationActor = { originServerId: serverId, userId: message.author.id, roleIds: authority.roleIds, isOwner: authority.isOwner, isAdministrator: authority.isAdmin, nativePermissionAuthorized: true }
        yield* store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, authorized: "staff",
            operation: command.type === "set" ? { type: "answer-set", name: command.name, title: command.title, content: command.content } : { type: "answer-remove", name: command.name } })
        yield* reply(context, config, command.type === "set" ? `Answer ${command.name} saved. Post it with !answer ${command.name}` : `Answer ${command.name} removed`)
    }).pipe(Effect.catch(error => reply(context, config, describe(error))), Effect.asVoid)
}

/** !solved in a help post: The author or help desk staff tag it with the solved tag and close it */
export function handleSolvedCommand(runtime: HelpDeskRuntime | undefined, config: BotConfig, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId || !runtime) return
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id, { channelId: message.channelId })
        const post = helpPost(runtime, authority)
        if (!post) { yield* reply(context, config, "Use !solved in a post of a help desk forum"); return }
        const { thread, forum, settings } = post
        if (message.author.id !== thread.ownerId && !staff(client, authority)) { yield* reply(context, config, "Only the post's author or help desk staff can mark it solved"); return }
        const tags = "availableTags" in forum ? forum.availableTags ?? [] : []
        const tag = tags.find(tag => tag.name === settings.solvedTag) ?? tags.find(tag => tag.name.toLowerCase() === settings.solvedTag.toLowerCase())
        if (!tag) { yield* reply(context, config, `<#${forum.id}> has no tag named ${settings.solvedTag}. Add it in the forum's settings, or choose another with !helpdesk tag "name"`); return }
        const lacking = missing(forumPermissions, botBits(client, authority))
        if (lacking.length) { yield* reply(context, config, fixSentence({ permissions: lacking, channelId: forum.id })); return }
        // A post carries at most five tags, so a full post keeps its first four beside the solved tag
        const applied = "appliedTagIds" in thread ? thread.appliedTagIds ?? [] : []
        const appliedTagIds = applied.includes(tag.id) ? applied : [...applied.slice(0, 4), tag.id]
        // Any message unarchives a post, so the reply comes before the post is closed
        yield* reply(context, config, "Marked as solved and closed. Send a message here to reopen it")
        yield* client.threads.edit(thread.id, { appliedTagIds, archived: true }, { timeoutMs: 5000 }).pipe(
            Effect.catch(error => reply(context, config, nativeFix(error, forum.id) ?? "The post could not be closed. Check NeonFlux's Manage Threads permission in this forum")))
    }).pipe(Effect.catch(error => reply(context, config, describe(error))), Effect.asVoid)
}

/** !escalate <category> in a help post: Staff open a ticket for the post's author through the ticket path, linking back to the post */
export function handleEscalateCommand(tickets: TicketStore | undefined, runtime: HelpDeskRuntime | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId || !runtime) return
        if (!tickets) { yield* reply(context, config, "Ticket persistence is not configured"); return }
        if (args.length !== 1) { yield* reply(context, config, "Use !escalate <ticket-category> in a help post"); return }
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id, { channelId: message.channelId })
        const post = helpPost(runtime, authority)
        if (!post) { yield* reply(context, config, "Use !escalate in a post of a help desk forum"); return }
        const requester = yield* client.members.fetch({ guildId: serverId, userId: post.thread.ownerId }, { timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!requester || requester.isBot) { yield* reply(context, config, "The post's author is no longer a member of this server"); return }
        const facts = yield* readTicketAuthority(client, serverId, message.author.id, { botPermission: Permissions.ManageChannels | Permissions.ManageRoles })
        const createdAt = yield* sourceTimestamp(message)
        const result = yield* tickets.manage({ serverId, context: facts.context, messageId: message.id, createdAt,
            operation: { type: "escalate", categoryName: args[0]!.toLowerCase(), requesterId: requester.userId, requesterJoinedAt: requester.joinedAt, postId: post.thread.id } })
        if (result.duplicate || result.type !== "ticket" || !result.grant) return
        // The first step creates the channel, and the second posts the introduction that links back to this post
        const created = (yield* performTicketChain(tickets, serverId, client, result.grant))[0]
        const channelId = created?.outcome === "succeeded" ? created.channelId : undefined
        if (!channelId) { yield* reply(context, config, `Ticket ${result.ticket.ticketNo} could not be created. Check !ticket status ${result.ticket.ticketNo}`); return }
        yield* context.reply({ content: `This post continues in ticket ${result.ticket.ticketNo}, <#${channelId}>. <@${requester.userId}> can reply there`,
            allowedMentions: { users: [requester.userId], roles: [], everyone: false, repliedUser: false } })
    }).pipe(Effect.catch(error => reply(context, config, describe(error))), Effect.asVoid)
}
