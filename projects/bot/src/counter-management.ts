import {
    COUNTER_LIMIT,
    counterCountProblemText,
    type Counter,
    type CounterOperation,
    type CounterView,
} from "@neonflux/contracts/counters"
import { format, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { counterHelp, parseCounterCommand } from "./counter-command.ts"
import { CounterStoreError, type CounterStore } from "./counter-store.ts"
import { counterChannel, counterProblemText, readRoleCount, type CounterRuntime } from "./counter-worker.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { SafetyPermissionError, channelPermissionInput } from "./safety-permissions.ts"

const managers = "Only the server owner or members with Manage community can manage counters"
const renamePermissions = Permissions.ViewChannel | Permissions.ManageChannels
function describe(error: unknown) {
    if (error instanceof CounterStoreError) {
        if (error.status === 404) return "That channel has no counter. Check !counter list"
        if (error.status === 429) return `A server can have at most ${COUNTER_LIMIT} counters. Remove one first`
        if (error.status === 409)
            return "Counters changed on the website while this command ran. Check !counter list and try again"
        if (error.status === 403) return managers
        if (error.status === 400) return "Check the counter command values. Use !counter help"
        return "Counters are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The counter command could not be completed"
}
const counted = (counter: Counter) =>
    counter.kind === "role" ? `Members of ${format.roleMention(counter.roleId!)}` : "Server members"

/** Every counter on one line. A server has at most five, so it needs no pages */
export function counterList(view: CounterView, prefix: string, uncertain: (channelId: string) => boolean): Card {
    if (!view.counters.length)
        return {
            title: "Counters",
            description: `No counters yet. Add one with ${code(`${prefix}counter add members #channel "Members: {count}"`)}`,
        }
    return {
        title: "Counters",
        description: [
            ...(view.enabled ? [] : ["Counters are off, so no channel is renamed"]),
            ...view.counters.map(
                (row) =>
                    `${format.channelMention(row.channelId)}: ${counted(row)} as ${code(row.template)}, ${
                        !row.enabled
                            ? `off. ${counterProblemText(row.problem ?? "channel", row.channelId)}`
                            : uncertain(row.channelId)
                              ? "on. Its last rename is not confirmed, and the next check reads the channel"
                              : row.countProblem
                                ? `on, but its count cannot be read. ${counterCountProblemText(row.countProblem)}`
                                : "on"
                    }`,
            ),
        ].join("\n"),
        note: `Checked every 10 minutes. Change one with ${code(`${prefix}counter set #channel "Name: {count}"`)}`,
    }
}

export function handleCounterCommand(
    store: CounterStore | undefined,
    runtime: CounterRuntime | undefined,
    config: BotConfig,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) {
            yield* reply(notSetUp("Counters"))
            return
        }
        const command = parseCounterCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(counterHelp)
            return
        }
        const target = command.type === "add" || command.type === "set" ? command.channelId : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, target)
        if (!manager) {
            yield* reply(managers)
            return
        }
        if (command.type === "list") {
            yield* replyCard(
                context,
                serverId,
                counterList(yield* store.query({ serverId }), prefix, runtime.uncertain),
            )
            return
        }
        if (target) {
            if (!counterChannel(authority.channel)) {
                yield* reply(
                    "Choose a voice, text or announcement channel or a category of this server for the counter",
                )
                return
            }
            const bits = client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            })
            if ((bits & renamePermissions) !== renamePermissions) {
                yield* reply(`NeonFlux needs View channel and Manage channels in ${format.channelMention(target)}`)
                return
            }
        }
        if (command.type === "add" && command.roleId) {
            if (command.roleId === serverId) {
                yield* reply("Count everyone with `!counter add members` instead")
                return
            }
            if (!authority.roles.some((role) => role.id === command.roleId)) {
                yield* reply("Choose a role of this server for the counter")
                return
            }
            // A count NeonFlux can never read would leave the counter on and dead, so it is refused now. A failed read that
            // may pass, or an index still building, does not stop the counter
            const { problem } = yield* readRoleCount(client, serverId, command.roleId)
            if (problem) {
                yield* reply(`NeonFlux cannot read that role's member count. ${counterCountProblemText(problem)}`)
                return
            }
        }
        const { type: _type, ...rest } = command
        const operation: CounterOperation = { type: command.type, ...rest } as CounterOperation
        const view = yield* store.manage({
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
            actor,
            managerAuthorized: true,
            operation,
        })
        yield* runtime.changed(client, view)
        if (command.type === "module") {
            yield* reply(
                command.enabled
                    ? "Counters are on. NeonFlux checks them every 10 minutes"
                    : "Counters are off. Their channels keep the names they have",
            )
            return
        }
        if (command.type === "remove") {
            yield* reply(
                `NeonFlux no longer renames ${format.channelMention(command.channelId)}, and it keeps the name it has`,
            )
            return
        }
        const row = runtime.view().counters.find((counter) => counter.channelId === command.channelId)
        yield* reply(
            !row?.enabled
                ? `The counter is off. ${counterProblemText(row?.problem ?? "channel", command.channelId)}`
                : !runtime.view().enabled
                  ? `Saved. Counters are off, so turn them on with ${code("!counter module on")} to rename ${format.channelMention(command.channelId)}`
                  : `Counter saved in ${format.channelMention(command.channelId)}. NeonFlux checks it every 10 minutes`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
