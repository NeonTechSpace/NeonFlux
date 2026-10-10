import { commands, Permissions, type BotEventContext, type PrefixCommandMetadata } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { withPrefix } from "./general-settings.ts"
import { noMentions } from "./responses.ts"

/**
 * Who a command is for, by the native permissions it needs. The server owner and Administrators see everything.
 * staff covers members with a moderation permission, since staff roles also need the native permission of their action, and Manage Roles for temporary roles
 */
export type Audience = "everyone" | "staff" | "manager" | "admin"
interface CommandEntry { readonly name: string, readonly feature: string, readonly audience: Audience, readonly usage: string, readonly description: string }

// Every built-in command in its current form. Help, typo hints and reserved names follow this one table
export const commandTable: readonly CommandEntry[] = [
    { name: "ping", feature: "general", audience: "everyone", usage: "", description: "Check that NeonFlux answers" },
    { name: "help", feature: "general", audience: "everyone", usage: "[feature]", description: "List the commands you can use, or one feature's commands" },
    { name: "afk", feature: "general", audience: "everyone", usage: "[reason]", description: "Set an away status that your next message clears" },
    { name: "prefix", feature: "general", audience: "everyone", usage: "[new prefix]", description: "Show the prefix. Server managers can change it" },
    { name: "nickname", feature: "general", audience: "everyone", usage: "[set <name>|reset]", description: "Show the bot's nickname. Server managers can change it" },
    { name: "health", feature: "general", audience: "manager", usage: "", description: "Check the bot's permissions, role position and connection" },
    { name: "setup", feature: "general", audience: "manager", usage: "", description: "Show which features are on, off or need setup, with the next step for each" },
    { name: "recovery", feature: "general", audience: "manager", usage: "[page]", description: "List failed, stuck or uncertain work and permission problems, newest first, with the step that resolves each" },
    { name: "custom", feature: "responses", audience: "admin", usage: "create|show|list|update|enable|disable|delete|module ...", description: "Custom commands. Run !custom help for the full syntax" },
    { name: "auto", feature: "responses", audience: "admin", usage: "create|show|list|update|enable|disable|delete|module ...", description: "Autoresponders. Run !auto help for the full syntax" },
    { name: "mod", feature: "moderation", audience: "staff", usage: "warn|kick|ban|unban|timeout|untimeout|purge|slowmode|staff|private-role|module|status|erase ...", description: "Moderation actions. Run !mod help for the full syntax" },
    { name: "case", feature: "moderation", audience: "staff", usage: "list|show|reason|void|recover ...", description: "Moderation cases. Run !case help for the full syntax" },
    { name: "logs", feature: "moderation", audience: "staff", usage: "channel|status|list|show|recover|metadata|events|delivery|counters ...", description: "Staff logs and metadata logs. Run !logs help or !logs metadata help" },
    { name: "automod", feature: "moderation", audience: "staff", usage: "create|list|show|update|enable|disable|delete|mode|module|bots|status ...", description: "Automatic moderation rules. Run !automod help for the full syntax" },
    { name: "security", feature: "moderation", audience: "staff", usage: "quarantine|release|lock|unlock|joins|watchlist|honeypot|recovery|recover|mode|module|status ...", description: "Raid and channel protection. Run !security help for the full syntax" },
    { name: "defcon", feature: "moderation", audience: "staff", usage: "status|diagnose|set <1-3>", description: "Show or change the server's lockdown level" },
    { name: "appeals", feature: "moderation", audience: "staff", usage: "list|show|approve|reject|module ...", description: "Review appeals. Run !appeals help for the full syntax" },
    { name: "appeal", feature: "moderation", audience: "everyone", usage: "cases|submit|list|show|withdraw ...", description: "Appeal a moderation case, in a one-to-one DM with NeonFlux" },
    { name: "publish", feature: "publishing", audience: "admin", usage: "create|set|field|preview|send|edit|template|schedule|posts|status ...", description: "Drafts, templates, posts and scheduled posts. Run !publish help for the full syntax" },
    { name: "roles", feature: "roles", audience: "everyone", usage: "choose|create|map|publish|list|show|retire|status|module ...", description: "Reaction role panels. Members use !roles choose <panel> <emoji>. Run !roles help for the full syntax" },
    { name: "verify", feature: "roles", audience: "everyone", usage: "[status|configure|publish|module ...]", description: "Accept the server rules. Run !verify help for the full syntax" },
    { name: "autorole", feature: "roles", audience: "admin", usage: "add|remove|list|reserve|unreserve|reservations|module ...", description: "Roles for new members and reserved roles. Run !autorole help for the full syntax" },
    { name: "rolepicker", feature: "roles", audience: "admin", usage: "on|off|menu|access ...", description: "Role menus members use on the website. Run !rolepicker help for the full syntax" },
    { name: "temprole", feature: "roles", audience: "staff", usage: "add|set|remove|list|defaults|default|max|reconcile ...", description: "Give a member a role for a set time, such as 7 days. Run !temprole help for the full syntax" },
    { name: "welcome", feature: "welcome", audience: "admin", usage: "configure|module|clear|preview|show|status|history|member|rate|retention|dm ...", description: "Welcome messages and DMs. Run !welcome help for the full syntax" },
    { name: "goodbye", feature: "welcome", audience: "admin", usage: "configure|module|clear|preview|show|status|history|member ...", description: "Goodbye messages. Run !goodbye help for the full syntax" },
    { name: "ticket", feature: "tickets", audience: "everyone", usage: "open|answer|submit|list|status|claim|reply|close|reopen ...", description: "Support tickets. Run !ticket help for the full syntax" },
    { name: "rank", feature: "leveling", audience: "everyone", usage: "[@user]", description: "Show XP, level and rank" },
    { name: "leaderboard", feature: "leveling", audience: "everyone", usage: "[next-page cursor]", description: "Show members ordered by XP" },
    { name: "level", feature: "leveling", audience: "admin", usage: "config|module|rate|exclude|map|unmap|correct|reset|status|reconcile|audit ...", description: "Message XP and reward roles. Run !level help for the full syntax" },
    { name: "events", feature: "events", audience: "everyone", usage: "[before-event-number]", description: "List events in this channel" },
    { name: "event", feature: "events", audience: "everyone", usage: "show|dates|attendees|rsvp|create|time|publish|threads|status ...", description: "Events and RSVPs. Run !event help for the full syntax" },
    { name: "milestone", feature: "milestones", audience: "everyone", usage: "me|birthday|anniversary|remove|status|configure ...", description: "Birthday and anniversary posts, in a one-to-one DM with NeonFlux. Run !milestone help there" },
    { name: "suggest", feature: "suggestions", audience: "everyone", usage: "submit|show|list|vote|mine|withdraw|status|configure ...", description: "Suggestions and voting. Run !suggest help for the full syntax" },
    { name: "cleanup", feature: "cleanup", audience: "admin", usage: "configure|show|preview|list|status|enable|disable|module|exclude ...", description: "Delete old messages automatically. Run !cleanup help for the full syntax" },
    { name: "voice", feature: "voice", audience: "everyone", usage: "rename|hide|show|allow|block|limit|generator ...", description: "Temporary voice rooms. Run !voice help for the full syntax" },
    { name: "lfg", feature: "lfg", audience: "everyone", usage: "\"activity\" <size>|join|leave|start|cancel|list|config ...", description: "Find a group, which gets its own voice room once it is full. Run !lfg help for the full syntax" },
    { name: "backup", feature: "backup", audience: "admin", usage: "export|inspect|preview|plan|confirm|status|reconcile|forget ...", description: "Server owner only, in a one-to-one DM with NeonFlux. Run !backup help there" },
    { name: "export", feature: "backup", audience: "admin", usage: "[help]", description: "Server owner only, in a one-to-one DM with NeonFlux. Sends the server's NeonFlux data as readable JSON for other bots" },
    { name: "onboarding", feature: "roles", audience: "everyone", usage: "[status|on|off|add|remove|delivery|role ...]", description: "Your newcomer checklist. Staff set it up. Run !onboarding help for the full syntax" },
    { name: "showcase", feature: "showcase", audience: "everyone", usage: "list [@member]|on|off|channel|limit|interval|access ...", description: "Member showcases posted from the website. Staff set them up. Run !showcase help for the full syntax" },
    { name: "profile", feature: "profile", audience: "everyone", usage: "[@member]|on|off|cooldown|access ...", description: "Show a member profile. Members edit theirs on the website. Run !profile help for the full syntax" },
    { name: "preset", feature: "general", audience: "manager", usage: "list|show|apply ...", description: "Starting configurations for community types and security levels. Run !preset help" },
    { name: "stats", feature: "analytics", audience: "manager", usage: "[on|off]", description: "Server activity for the last seven days" },
    { name: "sticky", feature: "sticky", audience: "manager", usage: "add|interval|remove|list ...", description: "Keep one bot message at the bottom of a channel. Run !sticky help for the full syntax" },
    { name: "sidebar", feature: "sidebar", audience: "manager", usage: "add|set|remove", description: "A link to the NeonFlux dashboard in the server sidebar" },
    { name: "memberlist", feature: "memberlist", audience: "manager", usage: "set|move|reset", description: "The order role groups appear in the member list" },
    { name: "alerts", feature: "alerts", audience: "manager", usage: "status|on|off|expect|unexpect ...", description: "Staff alerts for invites, unexpected bots and webhooks, privilege changes and impersonation. Run !alerts help" },
    { name: "invites", feature: "alerts", audience: "manager", usage: "list|revoke ...", description: "List the server's invites with creator, uses and expiry, or revoke one" },
    { name: "helpdesk", feature: "helpdesk", audience: "manager", usage: "forum|greeting|tag|nudge|guard|archive ...", description: "The forum help desk. Run !helpdesk help for the full syntax" },
    { name: "solved", feature: "helpdesk", audience: "everyone", usage: "", description: "In a help post: Mark it solved and close it, for its author and help desk staff" },
    { name: "answer", feature: "helpdesk", audience: "staff", usage: "<name>|list|set|remove ...", description: "Post or manage saved answers. Run !answer help for the full syntax" },
    { name: "escalate", feature: "helpdesk", audience: "staff", usage: "<ticket-category>", description: "In a help post: Open a ticket for its author" },
]
const features = [...new Set(commandTable.map(entry => entry.feature))]
const entries = new Map(commandTable.map(entry => [entry.name, entry]))

// The SDK router holds the table's metadata and builds the help pages. It is never attached: Commands run through the bot's own pipeline
const router = commandTable.reduce((built, entry) => built.register({ name: entry.name, usage: entry.usage, description: entry.description, execute: () => Effect.void }),
    commands.create({ prefix: "!" }))

/** Fluxer's message limit is 2000 characters. Pages leave room for a heading */
const PAGE_LENGTH = 1900

/** The audiences a member's server permissions open */
export function audiences(bits: bigint): ReadonlySet<Audience> {
    const admin = (bits & Permissions.Administrator) !== 0n
    const staff = admin || (bits & (Permissions.KickMembers | Permissions.BanMembers | Permissions.ModerateMembers | Permissions.ManageMessages | Permissions.ManageChannels | Permissions.ManageRoles | Permissions.ManageThreads)) !== 0n
    const manager = admin || (bits & Permissions.ManageGuild) !== 0n
    return new Set<Audience>(["everyone", ...(staff ? ["staff" as const] : []), ...(manager ? ["manager" as const] : []), ...(admin ? ["admin" as const] : [])])
}

/** Help pages for a member, printed with the server's prefix. A topic is a feature or a command name. Unknown topics answer undefined */
export function helpPages(prefix: string, allowed: ReadonlySet<Audience>, topic?: string): string[] | undefined {
    const visible = (entry: CommandEntry | undefined) => !!entry && allowed.has(entry.audience)
    if (topic === undefined) {
        const lines = features.map(feature => [feature, commandTable.filter(entry => entry.feature === feature && visible(entry))] as const)
            .filter(([, list]) => list.length).map(([feature, list]) => `${feature}: ${list.map(entry => `!${entry.name}`).join(", ")}`)
        return pages(["Commands you can use. Send !help <feature> for details, such as !help general", ...lines], prefix)
    }
    const feature = features.includes(topic) ? topic : entries.get(topic)?.feature
    if (!feature) return undefined
    const selected = router.help({ prefix: "!", maxLength: PAGE_LENGTH, include: (command: PrefixCommandMetadata) => visible(entries.get(command.name)) && entries.get(command.name)!.feature === feature })
    if (!selected.length) return [`None of the ${feature} commands are available to you here`]
    return selected.map((page, index) => withPrefix(index ? page : `${feature} commands\n${page}`, prefix))
}
function pages(lines: readonly string[], prefix: string) {
    const result: string[] = []
    for (const line of lines.map(line => withPrefix(line, prefix))) {
        if (result.length && result.at(-1)!.length + line.length + 1 <= PAGE_LENGTH) result[result.length - 1] += `\n${line}`
        else result.push(line)
    }
    return result
}

/**
 * The built-in command closest to an unknown name, using the SDK router's rule: at most one edit for names of up to four
 * characters and two for longer ones, where swapping two neighboring characters counts as one edit. The router computes
 * this only while it dispatches messages itself, so the bot applies the same rule to the same table
 */
export function suggestCommand(name: string): string | undefined {
    const wanted = name.toLowerCase(), limit = wanted.length <= 4 ? 1 : 2
    let best: { name: string, distance: number } | undefined
    for (const entry of commandTable) {
        const distance = editDistance(wanted, entry.name)
        if (distance <= limit && (!best || distance < best.distance)) best = { name: entry.name, distance }
    }
    return best?.name
}
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
        const topic = args[0]?.toLowerCase()
        const result = args.length > 1 ? undefined : helpPages(prefix, audiences(bits), topic)
        for (const content of result ?? [withPrefix(`There is no feature or command with that name. Features: ${features.join(", ")}`, prefix)]) {
            yield* context.reply({ content, allowedMentions: noMentions })
        }
    })
}
