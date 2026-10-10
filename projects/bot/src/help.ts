import { Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { cleanupHelpAll } from "./cleanup-command.ts"
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
import { rolePickerHelpAll } from "./rolepicker-command.ts"
import { scheduleHelpAll } from "./schedule-command.ts"
import { serverCommands, type DeploymentScope } from "./server-scope.ts"
import { suggestionHelpAll } from "./suggestion-command.ts"
import { ticketHelpAll } from "./ticket-command.ts"
import { voiceHelpAll } from "./voice-command.ts"
import { greetingsHelpAll } from "./welcome-command.ts"

/**
 * Who a command is for, by the native permissions it needs. The server owner and Administrators see everything.
 * staff covers members with a moderation permission, since staff roles also need the native permission of their action, and Manage Roles for temporary roles
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
interface CommandEntry { readonly name: string, readonly feature: string, readonly group: Group, readonly audience: Audience, readonly description: string }

// Every built-in command in its current form. Help, typo hints and reserved names follow this one table
export const commandTable: readonly CommandEntry[] = [
    { name: "ping", feature: "general", group: "basics", audience: "everyone", description: "Check that NeonFlux answers" },
    { name: "help", feature: "general", group: "basics", audience: "everyone", description: "List the commands you can use" },
    { name: "afk", feature: "general", group: "basics", audience: "everyone", description: "Set an away status that your next message clears" },
    { name: "prefix", feature: "general", group: "basics", audience: "everyone", description: "Show the command prefix. Managers can change it" },
    { name: "replies", feature: "general", group: "basics", audience: "everyone", description: "Show whether replies use embeds or plain text. Managers can change it" },
    { name: "nickname", feature: "general", group: "basics", audience: "everyone", description: "Show NeonFlux's nickname. Managers can change it" },
    { name: "setup", feature: "general", group: "setup", audience: "manager", description: "See which features are on and what each needs next" },
    { name: "health", feature: "general", group: "setup", audience: "manager", description: "Check NeonFlux's permissions, role position and connection" },
    { name: "recovery", feature: "general", group: "setup", audience: "manager", description: "Work that failed or needs a step, newest first" },
    { name: "preset", feature: "general", group: "setup", audience: "manager", description: "Apply a starting setup for a community type or security level" },
    { name: "stats", feature: "analytics", group: "setup", audience: "manager", description: "Server activity for the last seven days" },
    { name: "sidebar", feature: "sidebar", group: "setup", audience: "manager", description: "A link to the NeonFlux dashboard in the server sidebar" },
    { name: "backup", feature: "backup", group: "setup", audience: "admin", description: "Back up and restore server settings, in a DM, server owner only" },
    { name: "export", feature: "backup", group: "setup", audience: "admin", description: "Get the server's NeonFlux data as JSON, in a DM, server owner only" },
    { name: "mod", feature: "moderation", group: "moderation", audience: "staff", description: "Warn, time out, kick and ban members, and look up cases" },
    { name: "automod", feature: "moderation", group: "moderation", audience: "staff", description: "Rules that catch spam, mass mentions, links and blocked words" },
    { name: "security", feature: "moderation", group: "moderation", audience: "staff", description: "Raid protection, channel locks and the watchlist" },
    { name: "defcon", feature: "moderation", group: "moderation", audience: "staff", description: "Show or change the server's lockdown level" },
    { name: "logs", feature: "moderation", group: "moderation", audience: "staff", description: "Where staff logs and metadata logs are posted" },
    { name: "appeal", feature: "moderation", group: "moderation", audience: "everyone", description: "Appeal a moderation case privately. Staff review appeals" },
    { name: "alerts", feature: "alerts", group: "moderation", audience: "manager", description: "Staff alerts for invites, new bots and webhooks, and risky changes" },
    { name: "invites", feature: "alerts", group: "moderation", audience: "manager", description: "List the server's invites or revoke one" },
    { name: "roles", feature: "roles", group: "roles", audience: "everyone", description: "Reaction role panels. Members pick roles with a reaction" },
    { name: "verify", feature: "roles", group: "roles", audience: "everyone", description: "Accept the server rules to get access" },
    { name: "autorole", feature: "roles", group: "roles", audience: "admin", description: "Roles new members get automatically" },
    { name: "rolepicker", feature: "roles", group: "roles", audience: "admin", description: "Role menus members use on the website" },
    { name: "temprole", feature: "roles", group: "roles", audience: "staff", description: "Give a member a role for a set time, such as 7 days" },
    { name: "onboarding", feature: "roles", group: "roles", audience: "everyone", description: "Your newcomer checklist. Staff set it up" },
    { name: "memberlist", feature: "memberlist", group: "roles", audience: "manager", description: "The order role groups appear in the member list" },
    { name: "publish", feature: "publishing", group: "messages", audience: "admin", description: "Write announcements and schedule posts" },
    { name: "welcome", feature: "welcome", group: "messages", audience: "admin", description: "Welcome messages and DMs for new members" },
    { name: "goodbye", feature: "welcome", group: "messages", audience: "admin", description: "Goodbye messages when members leave" },
    { name: "custom", feature: "responses", group: "messages", audience: "admin", description: "Commands that answer with your own text" },
    { name: "auto", feature: "responses", group: "messages", audience: "admin", description: "Automatic replies to words members type" },
    { name: "sticky", feature: "sticky", group: "messages", audience: "manager", description: "Keep one message at the bottom of a channel" },
    { name: "youtube", feature: "youtube", group: "messages", audience: "manager", description: "Post new uploads from YouTube channels" },
    { name: "cleanup", feature: "cleanup", group: "messages", audience: "admin", description: "Delete old messages in a channel automatically" },
    { name: "ticket", feature: "tickets", group: "support", audience: "everyone", description: "Open and follow private support tickets" },
    { name: "solved", feature: "helpdesk", group: "support", audience: "everyone", description: "In a help post: Mark it solved and close it" },
    { name: "suggest", feature: "suggestions", group: "support", audience: "everyone", description: "Share ideas and vote on suggestions" },
    { name: "helpdesk", feature: "helpdesk", group: "support", audience: "manager", description: "Set up the forum help desk" },
    { name: "answer", feature: "helpdesk", group: "support", audience: "staff", description: "Post or manage saved answers for help posts" },
    { name: "escalate", feature: "helpdesk", group: "support", audience: "staff", description: "In a help post: Open a ticket for its author" },
    { name: "rank", feature: "leveling", group: "community", audience: "everyone", description: "Show XP, level and rank" },
    { name: "leaderboard", feature: "leveling", group: "community", audience: "everyone", description: "Members ordered by XP" },
    { name: "event", feature: "events", group: "community", audience: "everyone", description: "See events and RSVP. Staff create them" },
    { name: "milestone", feature: "milestones", group: "community", audience: "everyone", description: "Sign up for a birthday or anniversary post, in a DM" },
    { name: "showcase", feature: "showcase", group: "community", audience: "everyone", description: "Member showcases posted from the website" },
    { name: "profile", feature: "profile", group: "community", audience: "everyone", description: "Show a member profile. Edit yours on the website" },
    { name: "level", feature: "leveling", group: "community", audience: "admin", description: "Set up message XP and reward roles" },
    { name: "voice", feature: "voice", group: "voice", audience: "everyone", description: "Rename, hide or limit your temporary voice room" },
    { name: "lfg", feature: "lfg", group: "voice", audience: "everyone", description: "Find a group. A full group gets its own voice room" },
]
const features = new Set(commandTable.map(entry => entry.feature))
const entries = new Map(commandTable.map(entry => [entry.name, entry]))
// Commands that answer no help of their own, so a group's note names another one
const noHelp = new Set(["ping", "help", "afk", "prefix", "replies", "nickname", "setup", "health", "recovery", "rank", "leaderboard", "solved", "escalate"])
const label = (group: Group) => `${group[0]!.toUpperCase()}${group.slice(1)}`

/** The audiences a member's server permissions open */
export function audiences(bits: bigint): ReadonlySet<Audience> {
    const admin = (bits & Permissions.Administrator) !== 0n
    const staff = admin || (bits & (Permissions.KickMembers | Permissions.BanMembers | Permissions.ModerateMembers | Permissions.ManageMessages | Permissions.ManageChannels | Permissions.ManageRoles | Permissions.ManageThreads)) !== 0n
    const manager = admin || (bits & Permissions.ManageGuild) !== 0n
    return new Set<Audience>(["everyone", ...(staff ? ["staff" as const] : []), ...(manager ? ["manager" as const] : []), ...(admin ? ["admin" as const] : [])])
}

/**
 * Help for a member, printed with the server's prefix. Without a topic it lists the groups with a command the member can use.
 * A group, a feature or a command name shows that group's commands. Anything else gets one line with the closest topic
 */
export function helpCard(prefix: string, allowed: ReadonlySet<Audience>, topic?: string): Card | string {
    const visible = (group: Group) => commandTable.filter(entry => entry.group === group && allowed.has(entry.audience))
    const open = (Object.keys(groups) as Group[]).filter(group => visible(group).length)
    if (topic === undefined) return { title: "Commands you can use", fields: open.map(group => [label(group), groups[group]] as const),
        note: withPrefix(`Send ${code("!help <group>")} to see its commands, such as ${code(`!help ${open[0]}`)}`, prefix) }
    const group = Object.hasOwn(groups, topic) ? topic as Group : features.has(topic) ? commandTable.find(entry => entry.feature === topic)!.group : entries.get(topic)?.group
    if (!group) {
        const known = [...open, ...commandTable.filter(entry => allowed.has(entry.audience)).flatMap(entry => [entry.name, entry.feature])]
        const closest = suggestion(topic, new Set(known))
        return withPrefix(closest ? `No help matches that. Did you mean ${code(`!help ${closest}`)}?` : `No help matches that. Send ${code("!help")} to see the groups`, prefix)
    }
    const list = visible(group), example = list.find(entry => !noHelp.has(entry.name))
    if (!list.length) return `None of the ${label(group)} commands are available to you here`
    return { title: `${label(group)} commands`, description: withPrefix(list.map(entry => `${code(`!${entry.name}`)}: ${entry.description}`).join("\n"), prefix),
        ...(example ? { note: withPrefix(`Add help to a command to see how to use it, such as ${code(`!${example.name} help`)}`, prefix) } : {}) }
}

/**
 * The name closest to an unknown one, using the SDK router's rule: at most one edit for names of up to four characters and two
 * for longer ones, where swapping two neighboring characters counts as one edit. The router computes this only while it
 * dispatches messages itself, so the bot applies the same rule
 */
function suggestion(name: string, names: Iterable<string>) {
    const wanted = name.toLowerCase(), limit = wanted.length <= 4 ? 1 : 2
    let best: { name: string, distance: number } | undefined
    for (const candidate of names) {
        const distance = editDistance(wanted, candidate)
        if (distance <= limit && (!best || distance < best.distance)) best = { name: candidate, distance }
    }
    return best?.name
}
/** The built-in command closest to an unknown name */
export const suggestCommand = (name: string) => suggestion(name, entries.keys())
/** Changed, added or removed characters between two strings, where swapping two neighboring characters counts as one */
export function editDistance(left: string, right: string) {
    const rows = Array.from({ length: left.length + 1 }, (_, row) => Array.from({ length: right.length + 1 }, (_, column) => row ? column ? 0 : row : column))
    for (let row = 1; row <= left.length; row++) for (let column = 1; column <= right.length; column++) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1
        rows[row]![column] = Math.min(rows[row - 1]![column]! + 1, rows[row]![column - 1]! + 1, rows[row - 1]![column - 1]! + cost)
        if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) rows[row]![column] = Math.min(rows[row]![column]!, rows[row - 2]![column - 2]! + 1)
    }
    return rows[left.length]![right.length]!
}

/** !help and a mention of the bot followed by help. The member's server permissions decide which commands are listed */
export function handleHelpCommand(serverId: string, prefix: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const bits = yield* context.client.permissions.fetch({ guildId: serverId, userId: context.message.author.id }, { timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(0n)))
        const result = args.length > 1 ? withPrefix(`No help matches that. Send ${code("!help")} to see the groups`, prefix) : helpCard(prefix, audiences(bits), args[0]?.toLowerCase())
        if (typeof result === "object") yield* replyCard(context, serverId, result)
        else yield* replyText(context, result)
    })
}

/**
 * The forms each command's own help leaves out, which `!<command> help all` lists, keyed by the words before help.
 * A command's help shows its most used forms and ends with a line that points here
 */
const moreForms: Readonly<Record<string, readonly string[]>> = {
    ticket: ticketHelpAll, event: eventHelpAll, publish: publishingHelpAll, "publish schedule": scheduleHelpAll, milestone: milestoneHelpAll, level: levelHelpAll,
    voice: voiceHelpAll, lfg: lfgHelpAll, roles: roleHelpAll.roles, autorole: roleHelpAll.autorole, rolepicker: rolePickerHelpAll, cleanup: cleanupHelpAll,
    custom: managementHelpAll("custom"), auto: managementHelpAll("auto"), mod: safetyHelpAll.mod, automod: safetyHelpAll.automod, security: safetyHelpAll.security,
    "logs metadata": metadataLogHelpAll, suggest: suggestionHelpAll, welcome: greetingsHelpAll("welcome"), "welcome dm": greetingsHelpAll("dm"), goodbye: greetingsHelpAll("goodbye"),
}
/** Forms on one page of `help all` */
const FORMS_PER_PAGE = 10
export type HelpAllRequest = { readonly path: string, readonly next: boolean, readonly helpArgs: readonly string[] }
/** `!<command> [words] help all [next]` for a command whose help leaves forms out, with the words that ask for that command's own help */
export function helpAllRequest(name: string | undefined, args: readonly string[]): HelpAllRequest | undefined {
    const at = args.findIndex(arg => arg.toLowerCase() === "help"), rest = args.slice(at + 2)
    const path = [name, ...args.slice(0, at)].join(" ").toLowerCase()
    if (!name || at < 0 || args[at + 1]?.toLowerCase() !== "all" || !Object.hasOwn(moreForms, path) || rest.length > 1 || rest.length === 1 && rest[0]!.toLowerCase() !== "next") return undefined
    return { path, next: rest.length === 1, helpArgs: args.slice(0, at + 1) }
}
/** One page of the forms a command's help leaves out. In a DM, commands name this server when NeonFlux serves several */
export function handleHelpAll(config: { readonly serverId: string, readonly scope?: DeploymentScope }, prefix: string, request: HelpAllRequest, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const forms = moreForms[request.path]!, start = `!${request.path} help all`, key = pageKey(config.serverId, context.message, "help", request.path)
        const page = request.next ? nextPosition<number>(key) : 0
        const more = page !== undefined && (page + 1) * FORMS_PER_PAGE < forms.length
        if (page !== undefined) rememberPosition(key, more ? page + 1 : undefined)
        const lines = page === undefined ? [noNextPage(start)] : [...forms.slice(page * FORMS_PER_PAGE, (page + 1) * FORMS_PER_PAGE), ...(more ? [`Send ${start} next for more`] : [])]
        const text = withPrefix(lines.join("\n"), prefix)
        yield* replyText(context, context.message.guildId === config.serverId ? text : serverCommands(text, config))
    })
}
