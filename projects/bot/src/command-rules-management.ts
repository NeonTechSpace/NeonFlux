import {
    COMMAND_RULE_CHANNELS,
    COMMAND_RULE_LIMIT,
    COMMAND_RULE_ROLES,
    type CommandRule,
    type CommandRuleOperation,
} from "@neonflux/contracts/command-rules"
import { format, type BotEventContext, type Client, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import { readChannelParent, readKnownChannel } from "./channel-parents.ts"
import { commandRulesHelp, type CommandRulesCommand } from "./command-rules-command.ts"
import { CommandRulesStoreError, type CommandRulesStore } from "./command-rules-store.ts"
import type { BotConfig } from "./config.ts"
import { warnFailure } from "./contained.ts"
import {
    readServerManager,
    rememberCommandRules,
    replyPrefix,
    withPrefix,
    type GeneralSettingsStore,
} from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"

const managerOnly = "Only the server owner or members with Manage community can change command rules"
const channelList = (ids: readonly string[]) => ids.map(format.channelMention).join(", ")
const roleList = (ids: readonly string[]) => ids.map(format.roleMention).join(", ")
/** Rules on one page of !commands rules */
const PAGE = 8

const where = (rule: Pick<CommandRule, "channelIds" | "roleIds">) =>
    [
        rule.channelIds.length ? `In ${channelList(rule.channelIds)}` : "In every channel",
        rule.roleIds.length ? `for ${roleList(rule.roleIds)}` : "for everyone",
    ].join(", ")

function describe(error: unknown, prefix: string) {
    if (error instanceof CommandRulesStoreError) {
        if (error.status === 403) return managerOnly
        if (error.status === 429) return `A server can have at most ${COMMAND_RULE_LIMIT} command rules`
        if (error.status === 409)
            return withPrefix(
                "Command rules changed on the website while this command ran. Check !commands rules and try again",
                prefix,
            )
        if (error.status === 400)
            return withPrefix(
                `Check the command. Use !commands help. A rule holds up to ${COMMAND_RULE_CHANNELS} channels and ${COMMAND_RULE_ROLES} roles`,
                prefix,
            )
    }
    return "Command rules are unavailable right now. Try again shortly"
}

/** Whether every ID names a channel of this server, with one read for a channel the bot does not hold */
function channelsExist(client: Client, serverId: string, channelIds: readonly string[]) {
    return Effect.forEach(
        channelIds,
        (id) =>
            readKnownChannel(client, id).pipe(
                Effect.map((channel) => channel.guildId === serverId),
                Effect.catch(() => Effect.succeed(false)),
            ),
        { concurrency: 4 },
    ).pipe(Effect.map((found) => found.every(Boolean)))
}

export function handleCommandRulesCommand(
    general: GeneralSettingsStore | undefined,
    store: CommandRulesStore | undefined,
    config: BotConfig,
    command: CommandRulesCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId),
        reply = (content: string) => replyText(context, withPrefix(content, prefix)),
        card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { client, message } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!general || !store) {
            yield* reply(notSetUp("Command rules"))
            return
        }
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(commandRulesHelp)
            return
        }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) {
            yield* reply(managerOnly)
            return
        }
        if (command.type === "rules" || command.type === "show") {
            const rules = (yield* general.get()).commandRules ?? []
            yield* rememberCommandRules(serverId, rules)
            if (command.type === "show") {
                const rule = rules.find((row) => row.command === command.command)
                yield* card({
                    title: `Rule for !${command.command}`,
                    description: rule ? where(rule) : "No rule. It works everywhere for everyone",
                })
                return
            }
            const key = pageKey(serverId, message, "commands", "rules"),
                from = command.next ? nextPosition<number>(key) : 0
            if (from === undefined) {
                yield* reply(noNextPage("!commands rules"))
                return
            }
            const page = rules.slice(from, from + PAGE),
                more = from + PAGE < rules.length
            rememberPosition(key, more ? from + PAGE : undefined)
            yield* card({
                title: "Command rules",
                description:
                    page.map((rule) => `${code(`${prefix}${rule.command}`)}: ${where(rule)}`).join("\n") ||
                    withPrefix(
                        `No rules yet. Add one with ${code("!commands rule rank channels #bot-commands")}`,
                        prefix,
                    ),
                ...(more ? { note: withPrefix(`Send ${code("!commands rules next")} for more`, prefix) } : {}),
                footer: `${rules.length} of ${COMMAND_RULE_LIMIT} rules`,
            })
            return
        }
        if (command.type === "channels" && !(yield* channelsExist(client, serverId, command.channelIds))) {
            yield* reply("Name channels of this server")
            return
        }
        if (
            command.type === "roles" &&
            command.roleIds.some((id) => id === serverId || !authority.roles.some((role) => role.id === id))
        ) {
            yield* reply("Name existing roles of this server. Use roles all for everyone instead of the everyone role")
            return
        }
        const operation: CommandRuleOperation =
            command.type === "clear"
                ? { type: "clear", command: command.command }
                : command.type === "channels"
                  ? { type: "set", command: command.command, channelIds: command.channelIds }
                  : { type: "set", command: command.command, roleIds: command.roleIds }
        const saved = yield* store.manage({
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
            actor,
            managerAuthorized: true,
            operation,
        })
        yield* rememberCommandRules(serverId, saved.rules)
        const rule = saved.rules.find((row) => row.command === command.command)
        yield* reply(
            rule
                ? `!${command.command}: ${where(rule)}`
                : `!${command.command} has no rule now, so it works everywhere for everyone`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error, prefix))),
        Effect.asVoid,
    )
}

// The last refusal per member and command, so a member who keeps trying gets one line a minute. Lost on restart
const refusals = new Map<string, number>()
const REFUSAL_MS = 60000,
    REFUSAL_ENTRIES = 10000
/** Forget the refusal memory, for tests that run several bots in one process */
export const resetCommandRuleRefusals = () => refusals.clear()

/**
 * Whether a rule lets this message through. A channel rule reads the channel the message is in and, for a thread, its parent, and a
 * role rule the copy of the member the bot holds. A rule never applies to the server owner or an Administrator, so their read
 * happens only when the rule would otherwise refuse. A read that fails lets the command through, since a rule is a convenience and each command
 * checks its own permissions
 */
export function commandRuleRefusal(client: Client, serverId: string, rule: CommandRule, message: Message) {
    return Effect.gen(function* () {
        const inChannel =
            !rule.channelIds.length ||
            rule.channelIds.includes(message.channelId) ||
            rule.channelIds.includes(
                (yield* readChannelParent(client, message.channelId).pipe(
                    Effect.catch(() => Effect.succeed(undefined)),
                )) ?? "",
            )
        if (inChannel && !rule.roleIds.length) return undefined
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id, { cached: true }).pipe(
            Effect.catch((error) =>
                warnFailure("A command rule could not read the member", error).pipe(Effect.as(undefined)),
            ),
        )
        if (!authority || authority.isOwner || authority.isAdmin) return undefined
        const hasRole = !rule.roleIds.length || rule.roleIds.some((id) => authority.roleIds.includes(id))
        if (inChannel && hasRole) return undefined
        return { inChannel, hasRole }
    })
}

/** The one line a refused command gets, once per member and command per minute, naming where it works */
export function refuseCommand(
    context: Pick<BotEventContext<"messageCreate">, "reply" | "message">,
    serverId: string,
    prefix: string,
    rule: CommandRule,
    refusal: { readonly inChannel: boolean; readonly hasRole: boolean },
) {
    return Effect.gen(function* () {
        const key = `${serverId}:${context.message.author.id}:${rule.command}`,
            now = yield* Clock.currentTimeMillis
        if ((refusals.get(key) ?? Number.NEGATIVE_INFINITY) > now - REFUSAL_MS) return
        if (refusals.size >= REFUSAL_ENTRIES)
            for (const [entry, at] of refusals) if (at <= now - REFUSAL_MS) refusals.delete(entry)
        if (refusals.size >= REFUSAL_ENTRIES) refusals.clear()
        refusals.set(key, now)
        const name = `${prefix}${rule.command}`
        yield* replyText(
            context,
            refusal.inChannel
                ? `${name} needs one of these roles: ${roleList(rule.roleIds)}`
                : refusal.hasRole
                  ? `${name} works in ${channelList(rule.channelIds)}`
                  : `${name} works in ${channelList(rule.channelIds)} and needs one of these roles: ${roleList(rule.roleIds)}`,
        )
    })
}
