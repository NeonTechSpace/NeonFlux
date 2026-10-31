import type { ServerCommand } from "@neonflux/contracts/responses"
import { permissionBits, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { cleanupHelpAll } from "./cleanup-command.ts"
import { anyOf, closestNames, isCloseToAny } from "./closest-name.ts"
import { eventHelpAll } from "./event-command.ts"
import { withPrefix } from "./general-settings.ts"
import { levelHelpAll } from "./level-command.ts"
import { lfgHelpAll } from "./lfg-command.ts"
import { metadataLogHelpAll } from "./metadata-log-command.ts"
import { milestoneHelpAll } from "./milestone-command.ts"
import { safetyHelpAll } from "./moderation-command.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { publishingHelpAll } from "./publishing-command.ts"
import { code, replyCard, replyText, type Card } from "./reply-style.ts"
import { managementHelpAll } from "./response-command.ts"
import { roleHelpAll } from "./role-command.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { rolePickerHelpAll } from "./rolepicker-command.ts"
import { scheduleHelpAll } from "./schedule-command.ts"
import { serverCommands, type DeploymentScope } from "./server-scope.ts"
import { suggestionHelpAll } from "./suggestion-command.ts"
import { ticketHelpAll } from "./ticket-command.ts"
import { voiceHelpAll } from "./voice-command.ts"
import { greetingsHelpAll } from "./welcome-command.ts"

/**
 * Who a command is for, by the native permissions it needs. The server owner and Administrators see everything.
 * staff covers members with a moderation permission, since staff roles also need the native permission of their action, and Manage roles for temporary roles
 */
export type Audience = "everyone" | "staff" | "manager" | "admin"
/** The groups !help lists, in this order, with the purpose it shows for each */
const groups = {
    basics: "Ping, help, away status, prefix and reply style",
    setup: "Check NeonFlux, apply presets, see activity and back up the server",
    moderation: "Cases, automatic rules, raid protection, logs and alerts",
    roles: "Role panels, verification, newcomer roles and the member list",
    messages: "Announcements, greetings, custom replies and message cleanup",
    support: "Tickets, the help desk and suggestions",
    community: "Levels, events, birthdays, showcases and profiles",
    voice: "Temporary voice rooms and finding a group",
} as const
type Group = keyof typeof groups
interface CommandEntry {
    readonly name: ServerCommand
    readonly feature: string
    readonly group: Group
    readonly audience: Audience
    readonly description: string
}

// Every built-in server command of the shared catalog in its current form, which help and typo hints follow. DM-only commands such as !mydata
// answer no help in a server
export const commandTable = [
    {
        name: "ping",
        feature: "general",
        group: "basics",
        audience: "everyone",
        description: "Check that NeonFlux answers",
    },
    {
        name: "help",
        feature: "general",
        group: "basics",
        audience: "everyone",
        description: "List the commands you can use",
    },
    {
        name: "afk",
        feature: "general",
        group: "basics",
        audience: "everyone",
        description: "Set an away status that your next message clears",
    },
    {
        name: "prefix",
        feature: "general",
        group: "basics",
        audience: "everyone",
        description: "Show the command prefix. Managers can change it",
    },
    {
        name: "replies",
        feature: "general",
        group: "basics",
        audience: "everyone",
        description: "Show whether replies use embeds or plain text. Managers can change it",
    },
    {
        name: "nickname",
        feature: "general",
        group: "basics",
        audience: "everyone",
        description: "Show NeonFlux's nickname. Managers can change it",
    },
    {
        name: "setup",
        feature: "general",
        group: "setup",
        audience: "manager",
        description: "See which features are on and what each needs next",
    },
    {
        name: "health",
        feature: "general",
        group: "setup",
        audience: "manager",
        description: "Check NeonFlux's permissions, role position and connection",
    },
    {
        name: "recovery",
        feature: "general",
        group: "setup",
        audience: "manager",
        description: "Work that failed or needs a step, newest first",
    },
    {
        name: "preset",
        feature: "general",
        group: "setup",
        audience: "manager",
        description: "Apply a starting setup for a community type or security level",
    },
    {
        name: "stats",
        feature: "analytics",
        group: "setup",
        audience: "manager",
        description: "Server activity for the last seven days",
    },
    {
        name: "sidebar",
        feature: "sidebar",
        group: "setup",
        audience: "manager",
        description: "A link to the NeonFlux dashboard in the server sidebar",
    },
    {
        name: "backup",
        feature: "backup",
        group: "setup",
        audience: "admin",
        description: "Back up and restore server settings, in a DM, server owner only",
    },
    {
        name: "export",
        feature: "backup",
        group: "setup",
        audience: "admin",
        description: "Get the server's NeonFlux data as JSON, in a DM, server owner only",
    },
    {
        name: "mod",
        feature: "moderation",
        group: "moderation",
        audience: "staff",
        description: "Warn, time out, kick and ban members, and look up cases",
    },
    {
        name: "automod",
        feature: "moderation",
        group: "moderation",
        audience: "staff",
        description: "Rules that catch spam, mass mentions, links and blocked words",
    },
    {
        name: "security",
        feature: "moderation",
        group: "moderation",
        audience: "staff",
        description: "Raid protection, channel locks and the watchlist",
    },
    {
        name: "defcon",
        feature: "moderation",
        group: "moderation",
        audience: "staff",
        description: "Show or change the server's lockdown level",
    },
    {
        name: "logs",
        feature: "moderation",
        group: "moderation",
        audience: "staff",
        description: "Where staff logs and metadata logs are posted",
    },
    {
        name: "appeal",
        feature: "moderation",
        group: "moderation",
        audience: "everyone",
        description: "Appeal a moderation case privately. Staff review appeals",
    },
    {
        name: "alerts",
        feature: "alerts",
        group: "moderation",
        audience: "manager",
        description: "Staff alerts for invites, new bots and webhooks, and risky changes",
    },
    {
        name: "invites",
        feature: "alerts",
        group: "moderation",
        audience: "manager",
        description: "List the server's invites or revoke one",
    },
    {
        name: "roles",
        feature: "roles",
        group: "roles",
        audience: "everyone",
        description: "Reaction role panels. Members pick roles with a reaction",
    },
    {
        name: "verify",
        feature: "roles",
        group: "roles",
        audience: "everyone",
        description: "Accept the server rules to get access",
    },
    {
        name: "autorole",
        feature: "roles",
        group: "roles",
        audience: "admin",
        description: "Roles new members get automatically",
    },
    {
        name: "rolepicker",
        feature: "roles",
        group: "roles",
        audience: "admin",
        description: "Role menus members use on the website",
    },
    {
        name: "temprole",
        feature: "roles",
        group: "roles",
        audience: "staff",
        description: "Give a member a role for a set time, such as 7 days",
    },
    {
        name: "onboarding",
        feature: "roles",
        group: "roles",
        audience: "everyone",
        description: "Your newcomer checklist. Staff set it up",
    },
    {
        name: "memberlist",
        feature: "memberlist",
        group: "roles",
        audience: "manager",
        description: "The order role groups appear in the member list",
    },
    {
        name: "publish",
        feature: "publishing",
        group: "messages",
        audience: "admin",
        description: "Write announcements and schedule posts",
    },
    {
        name: "welcome",
        feature: "welcome",
        group: "messages",
        audience: "admin",
        description: "Welcome messages and DMs for new members",
    },
    {
        name: "goodbye",
        feature: "welcome",
        group: "messages",
        audience: "admin",
        description: "Goodbye messages when members leave",
    },
    {
        name: "custom",
        feature: "responses",
        group: "messages",
        audience: "admin",
        description: "Commands that answer with your own text",
    },
    {
        name: "auto",
        feature: "responses",
        group: "messages",
        audience: "admin",
        description: "Automatic replies to words members type",
    },
    {
        name: "sticky",
        feature: "sticky",
        group: "messages",
        audience: "manager",
        description: "Keep one message at the bottom of a channel",
    },
    {
        name: "youtube",
        feature: "youtube",
        group: "messages",
        audience: "manager",
        description: "Post new uploads from YouTube channels",
    },
    {
        name: "twitch",
        feature: "twitch",
        group: "messages",
        audience: "manager",
        description: "Post live alerts from Twitch streamers",
    },
    {
        name: "cleanup",
        feature: "cleanup",
        group: "messages",
        audience: "admin",
        description: "Delete old messages in a channel automatically",
    },
    {
        name: "ticket",
        feature: "tickets",
        group: "support",
        audience: "everyone",
        description: "Open and follow private support tickets",
    },
    {
        name: "solved",
        feature: "helpdesk",
        group: "support",
        audience: "everyone",
        description: "In a help post: Mark it solved and close it",
    },
    {
        name: "suggest",
        feature: "suggestions",
        group: "support",
        audience: "everyone",
        description: "Share ideas and vote on suggestions",
    },
    {
        name: "helpdesk",
        feature: "helpdesk",
        group: "support",
        audience: "manager",
        description: "Set up the forum help desk",
    },
    {
        name: "answer",
        feature: "helpdesk",
        group: "support",
        audience: "staff",
        description: "Post or manage saved answers for help posts",
    },
    {
        name: "escalate",
        feature: "helpdesk",
        group: "support",
        audience: "staff",
        description: "In a help post: Open a ticket for its author",
    },
    {
        name: "rank",
        feature: "leveling",
        group: "community",
        audience: "everyone",
        description: "Show XP, level and rank",
    },
    {
        name: "leaderboard",
        feature: "leveling",
        group: "community",
        audience: "everyone",
        description: "Members ordered by XP",
    },
    {
        name: "event",
        feature: "events",
        group: "community",
        audience: "everyone",
        description: "See events and RSVP. Staff create them",
    },
    {
        name: "milestone",
        feature: "milestones",
        group: "community",
        audience: "everyone",
        description: "Sign up for a birthday or anniversary post, in a DM",
    },
    {
        name: "showcase",
        feature: "showcase",
        group: "community",
        audience: "everyone",
        description: "Member showcases posted from the website",
    },
    {
        name: "profile",
        feature: "profile",
        group: "community",
        audience: "everyone",
        description: "Show a member profile. Edit yours on the website",
    },
    {
        name: "level",
        feature: "leveling",
        group: "community",
        audience: "admin",
        description: "Set up message XP and reward roles",
    },
    {
        name: "voice",
        feature: "voice",
        group: "voice",
        audience: "everyone",
        description: "Rename, hide, limit, claim or hand over your temporary voice room",
    },
    {
        name: "lfg",
        feature: "lfg",
        group: "voice",
        audience: "everyone",
        description: "Find a group. A full group gets its own voice room",
    },
] as const satisfies readonly CommandEntry[]
// The table names every server command of the catalog, and the backend reserves the same names
const complete: [Exclude<ServerCommand, (typeof commandTable)[number]["name"]>] extends [never] ? true : false = true
void complete
const features = new Set<string>(commandTable.map((entry) => entry.feature))
const entries = new Map<string, CommandEntry>(commandTable.map((entry) => [entry.name, entry]))
// Commands that answer no help of their own, so a group's note names another one
const noHelp = new Set([
    "ping",
    "help",
    "afk",
    "prefix",
    "replies",
    "nickname",
    "setup",
    "health",
    "recovery",
    "rank",
    "leaderboard",
    "solved",
    "escalate",
])
const label = (group: Group) => `${group[0]!.toUpperCase()}${group.slice(1)}`

/** The audiences a member's server permissions open */
export function audiences(bits: bigint): ReadonlySet<Audience> {
    const admin = permissionBits.has(bits, "Administrator")
    const staff =
        admin ||
        (bits &
            (Permissions.KickMembers |
                Permissions.BanMembers |
                Permissions.ModerateMembers |
                Permissions.ManageMessages |
                Permissions.ManageChannels |
                Permissions.ManageRoles |
                Permissions.ManageThreads)) !==
            0n
    const manager = admin || permissionBits.has(bits, "ManageGuild")
    return new Set<Audience>([
        "everyone",
        ...(staff ? ["staff" as const] : []),
        ...(manager ? ["manager" as const] : []),
        ...(admin ? ["admin" as const] : []),
    ])
}

/**
 * Help for a member, printed with the server's prefix. Without a topic it lists the groups with a command the member can use.
 * A group, a feature or a command name shows that group's commands. Anything else gets one line with the closest topic
 */
export function helpCard(prefix: string, allowed: ReadonlySet<Audience>, topic?: string): Card | string {
    const visible = (group: Group) =>
        commandTable.filter((entry) => entry.group === group && allowed.has(entry.audience))
    const open = (Object.keys(groups) as Group[]).filter((group) => visible(group).length)
    if (topic === undefined)
        return {
            title: "Commands you can use",
            fields: open.map((group) => [label(group), groups[group]] as const),
            note: withPrefix(
                `Send ${code("!help <group>")} to see its commands, such as ${code(`!help ${open[0]}`)}`,
                prefix,
            ),
        }
    const group = Object.hasOwn(groups, topic)
        ? (topic as Group)
        : features.has(topic)
          ? commandTable.find((entry) => entry.feature === topic)!.group
          : entries.get(topic)?.group
    if (!group) {
        const known = [
            ...open,
            ...commandTable
                .filter((entry) => allowed.has(entry.audience))
                .flatMap((entry) => [entry.name, entry.feature]),
        ]
        const closest = closestNames({ word: topic, builtIn: known })
        return withPrefix(
            closest.length
                ? `No help matches that. Did you mean ${anyOf(closest.map((name) => code(`!help ${name}`)))}?`
                : `No help matches that. Send ${code("!help")} to see the groups`,
            prefix,
        )
    }
    const list = visible(group),
        example = list.find((entry) => !noHelp.has(entry.name))
    if (!list.length) return `None of the ${label(group)} commands are available to you here`
    return {
        title: `${label(group)} commands`,
        description: withPrefix(
            list.map((entry) => `${code(`!${entry.name}`)}: ${entry.description}`).join("\n"),
            prefix,
        ),
        ...(example && list.length <= 8
            ? {
                  note: withPrefix(
                      `Add help to a command to see how to use it, such as ${code(`!${example.name} help`)}`,
                      prefix,
                  ),
              }
            : {}),
    }
}

/** The answer to a command sent in a DM that runs only in a server, such as help, or to a name that is no command */
export const serverOnlyReply = (name: string | undefined) =>
    name && entries.has(name)
        ? `Send ${code(`!${name}`)} in the server. It does not work in a DM`
        : `No command matches that. Send ${code("!help")} in the server to see the commands you can use`
const namesFor = (allowed: ReadonlySet<Audience>) =>
    commandTable.filter((entry) => allowed.has(entry.audience)).map((entry) => entry.name)
/** The commands to name for an unknown one: built-in ones this audience can use and the server's custom commands */
export const suggestCommand = (
    word: string,
    allowed: ReadonlySet<Audience>,
    custom: readonly string[] = [],
    following = 0,
) => closestNames({ word, builtIn: namesFor(allowed), custom, following })
/** The audiences of the message's author. Help and hints only choose what to show, so this reads the copies that member, role and message events keep current */
function authorAudiences(serverId: string, context: BotEventContext<"messageCreate">) {
    return readSafetyAuthority(context.client, serverId, context.message.author.id, { cached: true }).pipe(
        Effect.flatMap((authority) =>
            Effect.try(() =>
                context.client.permissions.calculate({
                    guild: authority.guild,
                    member: authority.actor,
                    roles: authority.roles,
                }),
            ),
        ),
        Effect.catch(() => Effect.succeed(0n)),
        Effect.map(audiences),
    )
}
/** The hint for the message's author. Their permissions are read only for a word close to some command */
export function commandHint(
    serverId: string,
    name: string,
    customNames: readonly string[],
    following: number,
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        if (!isCloseToAny({ word: name, builtIn: entries.keys(), custom: customNames, following })) return []
        return suggestCommand(name, yield* authorAudiences(serverId, context), customNames, following)
    })
}
/** !help and a mention of the bot followed by help. The member's server permissions decide which commands are listed */
export function handleHelpCommand(
    serverId: string,
    prefix: string,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        const allowed = yield* authorAudiences(serverId, context)
        const result =
            args.length > 1
                ? withPrefix(`No help matches that. Send ${code("!help")} to see the groups`, prefix)
                : helpCard(prefix, allowed, args[0]?.toLowerCase())
        if (typeof result === "object") yield* replyCard(context, serverId, result)
        else yield* replyText(context, result)
    })
}

/**
 * The forms each command's own help leaves out, which `!<command> help all` lists, keyed by the words before help.
 * A command's help shows its most used forms and ends with a line that points here
 */
const moreForms: Readonly<Record<string, readonly string[]>> = {
    ticket: ticketHelpAll,
    event: eventHelpAll,
    publish: publishingHelpAll,
    "publish schedule": scheduleHelpAll,
    milestone: milestoneHelpAll,
    level: levelHelpAll,
    voice: voiceHelpAll,
    lfg: lfgHelpAll,
    roles: roleHelpAll.roles,
    autorole: roleHelpAll.autorole,
    rolepicker: rolePickerHelpAll,
    cleanup: cleanupHelpAll,
    custom: managementHelpAll("custom"),
    auto: managementHelpAll("auto"),
    mod: safetyHelpAll.mod,
    automod: safetyHelpAll.automod,
    security: safetyHelpAll.security,
    "logs metadata": metadataLogHelpAll,
    suggest: suggestionHelpAll,
    welcome: greetingsHelpAll("welcome"),
    "welcome dm": greetingsHelpAll("dm"),
    goodbye: greetingsHelpAll("goodbye"),
}
/** Forms on one page of `help all` */
const FORMS_PER_PAGE = 10
type HelpAllRequest = { readonly path: string; readonly next: boolean; readonly helpArgs: readonly string[] }
/** `!<command> [words] help all [next]` for a command whose help leaves forms out, with the words that ask for that command's own help */
export function helpAllRequest(name: string | undefined, args: readonly string[]): HelpAllRequest | undefined {
    const at = args.findIndex((arg) => arg.toLowerCase() === "help"),
        rest = args.slice(at + 2)
    const path = [name, ...args.slice(0, at)].join(" ").toLowerCase()
    if (
        !name ||
        at < 0 ||
        args[at + 1]?.toLowerCase() !== "all" ||
        !Object.hasOwn(moreForms, path) ||
        rest.length > 1 ||
        (rest.length === 1 && rest[0]!.toLowerCase() !== "next")
    )
        return undefined
    return { path, next: rest.length === 1, helpArgs: args.slice(0, at + 1) }
}
/** One page of the forms a command's help leaves out. In a DM, commands name this server when NeonFlux serves several */
export function handleHelpAll(
    config: { readonly serverId: string; readonly scope?: DeploymentScope },
    prefix: string,
    request: HelpAllRequest,
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        const forms = moreForms[request.path]!,
            start = `!${request.path} help all`,
            key = pageKey(config.serverId, context.message, "help", request.path)
        const page = request.next ? nextPosition<number>(key) : 0
        const more = page !== undefined && (page + 1) * FORMS_PER_PAGE < forms.length
        if (page !== undefined) rememberPosition(key, more ? page + 1 : undefined)
        const lines =
            page === undefined
                ? [noNextPage(start)]
                : [
                      ...forms.slice(page * FORMS_PER_PAGE, (page + 1) * FORMS_PER_PAGE),
                      ...(more ? [`Send ${start} next for more`] : []),
                  ]
        const text = withPrefix(lines.join("\n"), prefix)
        yield* replyText(context, context.message.guildId === config.serverId ? text : serverCommands(text, config))
    })
}
