import type { ShowcaseOperation, ShowcaseSettings, ShowcaseState, ShowcaseStatus } from "@neonflux/contracts/showcases"
import { ChannelType, format, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { fixSentence, permissionNames } from "./permission-fix.ts"
import { sourceTimestamp } from "./responses.ts"
import { clip, code, duration, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import {
    memberAccessCard,
    memberAccessChange,
    memberAccessWho,
    replyMemberAccessList,
    type MemberFeature,
} from "./rolepicker-management.ts"
import { channelPermissionInput } from "./safety-permissions.ts"
import { showcaseHelp, type ShowcaseCommand } from "./showcase-command.ts"
import { ShowcaseStoreError, type ShowcaseStore } from "./showcase-store.ts"

function settingsChange(
    operation: Extract<ShowcaseOperation, { type: "settings" }>,
    settings: ShowcaseSettings,
    prefix: string,
) {
    const { enabled, channelId, maxPerMember, intervalMinutes } = settings
    if (operation.enabled !== undefined)
        return !enabled
            ? "Showcases are off"
            : channelId
              ? `Showcases are on in ${format.channelMention(channelId)}`
              : `Showcases are on. Members can post once a channel is set with ${code(`${prefix}showcase channel #channel`)}`
    if (operation.channelId !== undefined)
        return !channelId
            ? "Showcases have no channel now, so members cannot post"
            : `Showcases now go to ${format.channelMention(channelId)}${enabled ? "" : `. Members can post once showcases are on with ${code(`${prefix}showcase on`)}`}`
    if (operation.maxPerMember !== undefined)
        return maxPerMember
            ? `Each member can now have up to ${maxPerMember} showcase${maxPerMember === 1 ? "" : "s"}`
            : "Members can now have any number of showcases"
    return intervalMinutes
        ? `Members now wait ${duration(intervalMinutes * 60)} between showcases`
        : "Members can now post showcases without waiting"
}
function statusCard(state: ShowcaseState, prefix: string): Card {
    const { settings } = state
    return {
        title: "Showcases",
        description: !settings.channelId
            ? `Members cannot post until a channel is set with ${code(`${prefix}showcase channel #channel`)}`
            : settings.enabled
              ? "Members post their showcases on the website"
              : `Members cannot post until ${code(`${prefix}showcase on`)}`,
        fields: [
            ["Status", onOff(settings.enabled)],
            ["Channel", settings.channelId ? format.channelMention(settings.channelId) : "Not set"],
            ["Who can use it", memberAccessWho(state.access)],
            ["Between posts", settings.intervalMinutes ? duration(settings.intervalMinutes * 60) : "No wait"],
            ["Per member", settings.maxPerMember ? String(settings.maxPerMember) : "No limit"],
        ],
    }
}
const statusLabel: Record<ShowcaseStatus, string> = {
    posting: ", being posted",
    posted: "",
    unconfirmed: ", not confirmed yet",
    failed: ", not posted",
}
function describe(error: unknown, prefix: string) {
    if (error instanceof ShowcaseStoreError) {
        if (error.status === 403) return "Only the server owner or members with Manage community can change showcases"
        if (error.status === 409)
            return withPrefix(
                "Showcase settings changed on the website while this command ran. Check !showcase status and try again",
                prefix,
            )
        if (error.status === 400)
            return withPrefix("Check the command. Use !showcase help. Access lists hold up to 100 entries each", prefix)
    }
    return "Showcases are unavailable right now. Try again shortly"
}
const posting = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
const showcaseFeature: MemberFeature = { command: "showcase", title: "Showcase" }

export function handleShowcaseCommand(
    store: ShowcaseStore | undefined,
    config: BotConfig,
    command: ShowcaseCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content),
        card = (value: Card) => replyCard(context, value)
    return Effect.gen(function* () {
        const { client, message } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) {
            yield* reply(notSetUp("Showcases"))
            return
        }
        if ("error" in command) {
            yield* reply(withPrefix(command.error, prefix))
            return
        }
        if (command.type === "help") {
            yield* reply(withPrefix(showcaseHelp, prefix))
            return
        }
        if (command.type === "list") {
            const listed = yield* store.list({ serverId, ...(command.authorId ? { authorId: command.authorId } : {}) })
            yield* card({
                title: "Showcases",
                description:
                    listed.showcases
                        .map(
                            (row) =>
                                `**#${row.showcaseNo}** ${clip(row.title, 100)}, by ${format.userMention(row.authorId)} in ${format.channelMention(row.channelId)}${statusLabel[row.status]}`,
                        )
                        .join("\n") || (command.authorId ? "That member has no showcases" : "No showcases yet"),
                ...(listed.more ? { footer: "The 10 newest are shown" } : {}),
            })
            return
        }
        const channelId =
            command.type === "change" && command.operation.type === "settings" && command.operation.channelId
                ? command.operation.channelId
                : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, channelId)
        if (!manager) {
            yield* reply("Only the server owner or members with Manage community can change showcases")
            return
        }
        if (command.type !== "change") {
            const state = yield* store.settings({ serverId })
            yield* command.type === "access-list"
                ? replyMemberAccessList(context, serverId, state.access, command, showcaseFeature)
                : card(
                      command.type === "access"
                          ? memberAccessCard(state.access, showcaseFeature, prefix)
                          : statusCard(state, prefix),
                  )
            return
        }
        const operation = command.operation
        if (channelId) {
            // The bot posts showcases as itself, so it checks its own permissions in the channel now and names what it lacks
            const channel = authority.channel
            if (channel?.type !== ChannelType.Text && channel?.type !== ChannelType.Announcement) {
                yield* reply("Choose a text or announcement channel of this server")
                return
            }
            const missing =
                posting &
                ~client.permissions.calculate({
                    guild: authority.guild,
                    member: authority.bot,
                    roles: authority.roles,
                    ...channelPermissionInput(authority),
                })
            if (missing) {
                yield* reply(fixSentence({ permissions: permissionNames(missing), channelId }))
                return
            }
        }
        if (
            operation.type === "access-add" &&
            operation.kind === "role" &&
            operation.ids.some((id) => id === serverId || !authority.roles.some((role) => role.id === id))
        ) {
            yield* reply(
                "Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role",
            )
            return
        }
        const saved = yield* store.manage({
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
            actor,
            managerAuthorized: true,
            operation,
        })
        yield* reply(
            operation.type === "settings"
                ? settingsChange(operation, saved.settings, prefix)
                : memberAccessChange(operation, saved.access, "showcases"),
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error, prefix))),
        Effect.asVoid,
    )
}
