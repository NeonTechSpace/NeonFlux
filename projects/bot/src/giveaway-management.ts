import {
    GIVEAWAY_ENTRANTS_TEXT,
    GIVEAWAY_RUNNING,
    giveawayCard,
    noWinnersText,
    type Giveaway,
    type GiveawayOperation,
    type GiveawayProblem,
    type GiveawaySettings,
    type GiveawaySettingsPatch,
} from "@neonflux/contracts/giveaways"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { refusedReason } from "./backend-http.ts"
import type { BotConfig } from "./config.ts"
import { giveawayHelp, type GiveawayCommand } from "./giveaway-command.ts"
import { GiveawayStoreError, type GiveawayStore } from "./giveaway-store.ts"
import { giveawayChannel, giveawayPermissionNames, giveawayPermissions } from "./giveaway-worker.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence } from "./permission-fix.ts"
import { at, code, notSetUp, onOff, replyCard, replyText, snippet, usage, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { channelPermissionInput, SafetyPermissionError } from "./safety-permissions.ts"

const managers = "the server owner or members with Manage community"
function describe(error: unknown) {
    if (error instanceof GiveawayStoreError) {
        const refused = refusedReason(error)
        if (refused) return refused
        if (error.status === 403) return `Only ${managers} can manage giveaways`
        if (error.status === 409) return "Giveaways changed on the website while this command ran. Try again"
        if (error.status === 400) return "Check the command values. Use !giveaway help"
        return "Giveaways are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError)
        return error.stage === "channel"
            ? "Choose a text or announcement channel of this server"
            : "Current permissions could not be read. Try again shortly"
    return "The giveaway command could not be completed"
}
const stateText = (giveaway: Giveaway) => {
    if (giveaway.state === "cancelled") return "Cancelled"
    if (giveaway.state === "ended") return giveaway.phase === "done" ? "Ended" : "Drawing"
    return giveaway.phase === "post" || giveaway.phase === "sending"
        ? "Being posted"
        : giveaway.phase === "blocked"
          ? "Waiting for its card to be confirmed"
          : `Ends ${at(giveaway.endsAt)}`
}
/** A problem in words, with what to do. Commands use ! because replies print them with the server's prefix */
export function giveawayProblemText(problem: GiveawayProblem, giveaway: Giveaway) {
    const where = format.channelMention(giveaway.channelId)
    switch (problem) {
        case "channel":
            return `Its channel ${where} is gone or cannot hold it, so it ended`
        case "card":
            return "Its card was deleted, so it ended"
        case "permission":
            return `NeonFlux needs View channel, Add reactions and Read message history in ${where}. It tries again on its own`
        case "post-failed":
            return `Fluxer refused its card in ${where}, so it never started`
        case "post-late":
            return `Its end passed before its card could go out in ${where}, so it ended with no entries. Start it again`
        case "post-uncertain":
            return `NeonFlux does not know whether its card was posted. Run \`!publish reconcile ${giveaway.postNo ?? "<post>"}\` or \`!publish resolve\`, and it is never posted twice`
        case "result-failed":
            return "Fluxer refused the update of its card, so the card does not show this"
        case "result-uncertain":
            return "NeonFlux does not know whether its card was updated, and never updates it twice"
        case "reaction":
            return `NeonFlux could not add the entry emoji. Members can add it themselves, or give NeonFlux Add reactions in ${where}`
    }
}
const line = (giveaway: Giveaway) =>
    `**#${giveaway.giveawayNo}** ${snippet(giveaway.prize, 60)} in ${format.channelMention(giveaway.channelId)}: ${stateText(giveaway)}${giveaway.problem ? ", has a problem" : ""}`
export function giveawayList(giveaways: readonly Giveaway[], running: number, prefix: string, more: boolean): Card {
    return {
        title: "Giveaways",
        ...(giveaways.length
            ? {
                  description: giveaways.map(line).join("\n"),
                  note: `See one with ${code(`${prefix}giveaway show <number>`)}`,
                  ...(more ? { fields: [["Next", code(`${prefix}giveaway list next`)] as const] } : {}),
                  footer: `${usage(running, GIVEAWAY_RUNNING)} running`,
              }
            : {
                  description: `No giveaways yet. Start one with ${code(`${prefix}giveaway start 1d 1 #channel <prize>`)}`,
              }),
    }
}
/** One giveaway in full. Each winner is a mention that does not notify */
export function giveawayDetail(giveaway: Giveaway, prefix: string): Card {
    const winners = giveaway.winners.map((winner) => format.userMention(winner.userId)),
        notTold = giveaway.winners.filter((winner) => winner.dm === "failed" || winner.dm === "uncertain")
    return {
        title: `Giveaway #${giveaway.giveawayNo}`,
        description: giveaway.prize,
        fields: [
            ["Status", stateText(giveaway)],
            ["Channel", format.channelMention(giveaway.channelId)],
            ["Winners", winners.length ? winners.join(", ") : noWinnersText(giveaway)],
            ...(giveaway.hostId ? [["Host", format.userMention(giveaway.hostId)] as const] : []),
            ...(giveaway.requiredRoleId
                ? [["Required role", format.roleMention(giveaway.requiredRoleId)] as const]
                : []),
            ...(giveaway.entrants !== undefined
                ? [
                      [
                          "Valid entries read",
                          `${giveaway.entrants}${giveaway.capped ? `. Only the first ${GIVEAWAY_ENTRANTS_TEXT} entries by account age were read` : ""}`,
                      ] as const,
                  ]
                : []),
            ...(notTold.length
                ? [["Not told by DM", notTold.map((winner) => format.userMention(winner.userId)).join(", ")] as const]
                : []),
            ...(giveaway.problem
                ? [["Problem", withPrefix(giveawayProblemText(giveaway.problem, giveaway), prefix)] as const]
                : []),
        ],
        ...(giveaway.state === "ended" && giveaway.phase === "done"
            ? { note: `Draw again with ${code(`${prefix}giveaway reroll ${giveaway.giveawayNo}`)}` }
            : {}),
    }
}
const settingsCard = (settings: GiveawaySettings, running: number): Card => ({
    title: "Giveaways",
    fields: [
        ["Status", onOff(settings.enabled)],
        ["Required role", settings.requiredRoleId ? format.roleMention(settings.requiredRoleId) : "None"],
        ["Running", `${running} of ${GIVEAWAY_RUNNING}`],
    ],
})
function settingsChange(patch: GiveawaySettingsPatch, settings: GiveawaySettings) {
    if (patch.enabled !== undefined)
        return settings.enabled
            ? "Giveaways are on"
            : "Giveaways are off. Running ones keep their entries and draw once giveaways are on again"
    return settings.requiredRoleId
        ? `New giveaways need ${format.roleMention(settings.requiredRoleId)} to win. Running ones keep what they started with`
        : "New giveaways need no role to win. Running ones keep what they started with"
}

export function handleGiveawayCommand(
    store: GiveawayStore | undefined,
    wake: () => Effect.Effect<void>,
    config: BotConfig,
    command: GiveawayCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId),
        reply = (content: string) => replyText(context, withPrefix(content, prefix)),
        card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId,
            userId = message.author.id
        if (message.guildId !== serverId) return
        if (!store) {
            yield* reply(notSetUp("Giveaways"))
            return
        }
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(giveawayHelp)
            return
        }
        // Every other form needs a manager, read fresh, with the channel a start names
        const channelId = command.type === "start" ? command.channelId : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, userId, channelId)
        if (!manager) {
            yield* reply(`Only ${managers} can manage giveaways`)
            return
        }
        if (command.type === "settings") {
            const found = yield* store.query({ serverId })
            yield* card(settingsCard(found.settings, found.running))
            return
        }
        if (command.type === "list") {
            const key = pageKey(serverId, message, "giveaway", "list")
            const before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) {
                yield* reply(noNextPage("!giveaway list"))
                return
            }
            const found = yield* store.query({ serverId, ...(before !== undefined ? { beforeNo: before } : {}) })
            rememberPosition(key, found.nextBeforeNo)
            yield* card(giveawayList(found.giveaways, found.running, prefix, found.nextBeforeNo !== undefined))
            return
        }
        if (command.type === "show") {
            const found = (yield* store.query({ serverId, giveawayNo: command.giveawayNo })).giveaways[0]
            if (!found) {
                yield* reply(`There is no giveaway #${command.giveawayNo}. Check !giveaway list`)
                return
            }
            // An update with an unknown outcome is settled by reading the card, never by sending it again
            let giveaway = found
            if (found.problem === "result-uncertain" && found.messageId) {
                const current = yield* client.messages
                    .fetch({ channelId: found.channelId, id: found.messageId }, { timeoutMs: 5000 })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (current?.content === giveawayCard(found)) {
                    yield* store.work({
                        serverId,
                        operation: { type: "confirm", giveawayNo: found.giveawayNo },
                    })
                    const { problem: _problem, ...rest } = found
                    giveaway = rest
                }
            }
            yield* card(giveawayDetail(giveaway, prefix))
            return
        }
        const manage = (operation: GiveawayOperation) =>
            Effect.gen(function* () {
                return yield* store.manage({
                    serverId,
                    originServerId: serverId,
                    messageId: message.id,
                    createdAt: yield* sourceTimestamp(message),
                    actor,
                    operation,
                })
            })
        if (command.type === "settings-set") {
            const roleId = command.patch.requiredRoleId
            if (roleId && (roleId === serverId || !authority.roles.some((role) => role.id === roleId))) {
                yield* reply("Choose a role of this server other than everyone")
                return
            }
            const saved = yield* manage({ type: "settings", patch: command.patch })
            if (saved.type === "settings") yield* reply(settingsChange(command.patch, saved.settings))
            yield* wake()
            return
        }
        if (command.type === "start") {
            if (!giveawayChannel(authority.channel)) {
                yield* reply("Choose a text or announcement channel of this server")
                return
            }
            const bits = client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            })
            if ((bits & giveawayPermissions) !== giveawayPermissions) {
                yield* reply(fixSentence({ permissions: [...giveawayPermissionNames], channelId: command.channelId }))
                return
            }
            const { type: _type, ...fields } = command
            const started = yield* manage({ type: "start", ...fields })
            if (started.type === "giveaway")
                yield* reply(
                    `Giveaway #${started.giveaway.giveawayNo} is being posted in ${format.channelMention(command.channelId)} and ends ${at(started.giveaway.endsAt)}. Check it with \`!giveaway show ${started.giveaway.giveawayNo}\``,
                )
            yield* wake()
            return
        }
        const no = command.giveawayNo
        if (command.type === "end") {
            yield* manage({ type: "end", giveawayNo: no })
            yield* reply(
                `Giveaway #${no} is ending. Its winners appear on its card, and \`!giveaway show ${no}\` names them`,
            )
        } else if (command.type === "cancel") {
            yield* manage({ type: "cancel", giveawayNo: no })
            yield* reply(`Giveaway #${no} is cancelled. Its card says so`)
        } else if (command.type === "reroll") {
            yield* manage({
                type: "reroll",
                giveawayNo: no,
                ...(command.count !== undefined ? { count: command.count } : {}),
            })
            yield* reply(
                `Giveaway #${no} is drawing again. New winners appear on its card, and \`!giveaway show ${no}\` names them`,
            )
        }
        yield* wake()
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
