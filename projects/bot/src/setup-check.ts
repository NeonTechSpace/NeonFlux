import type { StaffClass } from "@neonflux/contracts/moderation"
import { RecoveryInbox, SetupReadyResult, SetupRecordResult, SetupStatus, type DashboardOverviewSection, type RecoverySource, type SetupProblem } from "@neonflux/contracts/setup"
import { hierarchy, Permissions, type BotEventContext, type Client, type Guild, type GuildRole } from "@neontechspace/fluxerly/effect"
import { Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { readServerManagerAuthority, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence, highestRole, labelList, permissionLabel, permissionNames, sentenceList } from "./permission-fix.ts"
import { ago, code, notSetUp, replyCard, replyText } from "./reply-style.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export function createSetupStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    return {
        recovery: (serverId: string) => request("/recovery/list", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RecoveryInbox))),
        status: (serverId: string) => request("/setup/status", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SetupStatus))),
        ready: (serverId: string) => request("/setup/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SetupReadyResult))),
        record: (serverId: string, problems: readonly SetupProblem[]) => request("/setup/record", { serverId, problems }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SetupRecordResult))),
    }
}
export type SetupStore = ReturnType<typeof createSetupStore>

const send = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
/** What replies and every feature need, checked server-wide */
const basePermissions = send | Permissions.ReadMessageHistory
// Each feature's server-wide permissions, its name and the next step when it is off or needs setup. A feature that assigns roles also needs Manage Roles
const features: Record<DashboardOverviewSection, { name: string, permissions: bigint, on: string, setup?: string }> = {
    custom: { name: "Custom commands", permissions: 0n, on: "Turn it on with `!custom module on`", setup: "Create one with `!custom create <name> text \"response\"`" },
    auto: { name: "Autoresponders", permissions: 0n, on: "Turn it on with `!auto module on`", setup: "Create one with `!auto create <name> exact \"trigger\" text \"response\"`" },
    moderation: { name: "Moderation", permissions: Permissions.KickMembers | Permissions.BanMembers | Permissions.ModerateMembers | Permissions.ManageMessages, on: "Turn it on with `!mod module on`" },
    cleanup: { name: "Message cleanup", permissions: Permissions.ManageMessages, on: "Turn it on with `!cleanup module on`", setup: "Add a channel with `!cleanup configure #channel <age>`, then `!cleanup enable #channel`" },
    logs: { name: "Metadata logs", permissions: Permissions.ViewAuditLog, on: "Turn it on with `!logs metadata module on`", setup: "Send a category to a channel with `!logs metadata route`" },
    reaction: { name: "Reaction roles", permissions: Permissions.AddReactions, on: "Turn it on with `!roles module on`", setup: "Publish a panel with `!roles publish <panel> #channel <draft>`" },
    autorole: { name: "Autorole", permissions: Permissions.ManageRoles, on: "Turn it on with `!autorole module on`", setup: "Add a role with `!autorole add @role`" },
    verification: { name: "Rules verification", permissions: Permissions.ManageRoles | Permissions.AddReactions, on: "Turn it on with `!verify module on`", setup: "Set it up with `!verify configure @role <emoji>`, then `!verify publish #channel <draft>`" },
    rolepicker: { name: "Role picker", permissions: Permissions.ManageRoles, on: "Turn it on with `!rolepicker on`", setup: "Add a menu with `!rolepicker menu add <name> single|multi`" },
    temproles: { name: "Temporary roles", permissions: Permissions.ManageRoles, on: "Give one with `!temprole add @member @role 7d`" },
    onboarding: { name: "Newcomer checklist", permissions: Permissions.ManageRoles, on: "Add a step with `!onboarding add rules`, then `!onboarding on`", setup: "Add a rules, panel or menu step with `!onboarding add`" },
    publishing: { name: "Publishing", permissions: 0n, on: "Turn it on with `!publish module on`" },
    greetings: { name: "Welcome and goodbye", permissions: 0n, on: "Set a route with `!welcome configure <template> #channel join`, then `!welcome module on`" },
    schedules: { name: "Scheduled posts", permissions: 0n, on: "Turn it on with `!publish schedule module on`", setup: "Create one with `!publish schedule create`" },
    tickets: { name: "Tickets", permissions: Permissions.ManageChannels | Permissions.ManageRoles, on: "Turn it on with `!ticket module on`", setup: "Create a category with `!ticket category create` in a DM with NeonFlux" },
    leveling: { name: "Leveling", permissions: 0n, on: "Turn it on with `!level module on`" },
    milestones: { name: "Birthdays and anniversaries", permissions: 0n, on: "Turn it on with `!milestone module on`", setup: "Set a route with `!milestone configure birthday|anniversary`" },
    suggestions: { name: "Suggestions", permissions: 0n, on: "Choose a channel with `!suggest configure #channel`, then `!suggest enable`", setup: "Choose a channel with `!suggest configure #channel`" },
    events: { name: "Events", permissions: 0n, on: "Turn it on with `!event module on`" },
    voice: { name: "Temporary voice rooms", permissions: Permissions.ManageChannels | Permissions.MoveMembers | Permissions.ManageRoles | Permissions.Connect, on: "Add a generator with `!voice generator add \"Join to create\"`" },
    analytics: { name: "Analytics", permissions: 0n, on: "Turn it on with `!stats on`" },
    sticky: { name: "Sticky messages", permissions: 0n, on: "Add one with `!sticky add #channel \"text\"`" },
    sidebar: { name: "Dashboard link", permissions: Permissions.ManageChannels, on: "Add it with `!sidebar add`" },
    // Webhook and privilege alerts read audit entries, and invite lists and the staff names impersonation compares need Manage Server
    alerts: { name: "Security alerts", permissions: Permissions.ViewAuditLog | Permissions.ManageGuild, on: "Turn one on with `!alerts on <alert>`, such as `!alerts on bots`",
        setup: "Turn on metadata logs and send the security category to a staff channel with `!logs metadata route security`" },
    helpdesk: { name: "Help desk", permissions: Permissions.ManageThreads | Permissions.SendMessagesInThreads, on: "Add a forum with `!helpdesk forum add #forum`" },
    // Group rooms are temporary voice rooms that only the group may see
    lfg: { name: "Looking for group", permissions: Permissions.ManageChannels | Permissions.ManageRoles | Permissions.Connect, on: "Turn it on with `!lfg config on`",
        setup: "Choose the group channel and a voice generator with `!lfg config channel #channel` and `!lfg config generator #generator`" },
    showcase: { name: "Showcases", permissions: 0n, on: "Choose a channel with `!showcase channel #channel`, then `!showcase on`", setup: "Choose a channel with `!showcase channel #channel`" },
    profile: { name: "Member profiles", permissions: 0n, on: "Turn it on with `!profile on`" },
    // Alerts need permissions only in their channels, which NeonFlux checks before each alert
    youtube: { name: "YouTube alerts", permissions: 0n, on: "Follow a channel with `!youtube add <channel-ID> #channel`",
        setup: "Fix what `!youtube status` names, then turn each channel back on with `!youtube add <channel-ID> #channel`" },
}
const featureName = (feature: DashboardOverviewSection | "general") => feature === "general" ? "Replies" : features[feature].name
const squash = (value: string) => value.toLowerCase().replace(/[\s-]+/g, "")
// The words that name each feature in !setup <feature>: its ID, its name without spaces and the command its on step uses. An earlier feature wins a shared word, so publish names publishing
const featureWords = (Object.keys(features) as DashboardOverviewSection[]).map(id => [id, [id, squash(features[id].name), /`!(\w+)/.exec(features[id].on)![1]!]] as const)
/** The feature a word or name means, in any case and in singular or plural */
export function findFeature(query: string) {
    const word = squash(query)
    return featureWords.find(([, words]) => words.some(known => known === word || known === `${word}s` || `${known}s` === word))?.[0]
}

/** The bot's missing permissions for each enabled feature, roles it assigns that rank at or above it, and gateway trouble. Reads Fluxer as the bot */
export function readSetupProblems(client: Client, serverId: string, status: SetupStatus | undefined) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const { guild, roles, bot } = yield* readSafetyAuthority(client, serverId, botId)
        const bits = client.permissions.calculate({ guild, member: bot, roles }), top = highestRole(bot, roles)
        const enabled = new Set(status?.sections.filter(row => row.state !== "off").map(row => row.id))
        const managed = status?.managedRoles.filter(entry => enabled.has(entry.feature)) ?? []
        const problems: SetupProblem[] = []
        const missing = (feature: DashboardOverviewSection | "general", required: bigint) => {
            if ((required & ~bits) !== 0n) problems.push({ kind: "permissions", feature, permissions: permissionNames(required & ~bits) })
        }
        missing("general", basePermissions)
        // A feature that starts discussion threads also needs Create Public Threads
        for (const feature of enabled) missing(feature, features[feature].permissions & ~basePermissions | (managed.some(entry => entry.feature === feature) ? Permissions.ManageRoles : 0n)
            | (status?.threadFeatures.includes(feature) ? Permissions.CreatePublicThreads : 0n))
        // The owner outranks every role. Otherwise the bot's highest role must be above each role it assigns
        if (guild.ownerId !== botId) for (const entry of managed) {
            const above = roles.filter(role => entry.roleIds.includes(role.id) && !(top && hierarchy.isAbove(top, role)))
            if (above.length) problems.push({ kind: "hierarchy", feature: entry.feature, roles: above.map(role => ({ id: role.id, name: role.name.slice(0, 100) || role.id })) })
        }
        if (status) problems.push(...yield* readSafetyAudit(client, serverId, guild, roles, status))
        const gateway = client.diagnostics()
        if (gateway.state !== "Connected") problems.push({ kind: "gateway", state: gateway.state })
        return problems
    })
}

// Permissions that let a member harm the server or its members, and how many members holding them through one role count as many
const dangerous = Permissions.Administrator | Permissions.ManageGuild | Permissions.ManageRoles | Permissions.ManageChannels | Permissions.ManageWebhooks
    | Permissions.BanMembers | Permissions.KickMembers | Permissions.ModerateMembers | Permissions.ManageMessages | Permissions.MentionEveryone
const MANY_MEMBERS = 20
// Each counted role costs one member search, so a check counts at most this many roles
const COUNTED_ROLES = 10
// The permissions each staff class's commands check on the member who runs them. Case, automod and appeal commands check none
const staffPermissions: Record<StaffClass, bigint> = {
    moderation: Permissions.KickMembers | Permissions.BanMembers | Permissions.ModerateMembers | Permissions.ManageMessages | Permissions.ManageChannels,
    security: Permissions.ModerateMembers | Permissions.ManageRoles | Permissions.ManageChannels, cases: 0n, automod: 0n, appeals: 0n,
}
// Features that give a role to a member on their own action or join, which lifts Fluxer's verification level for that member
const roleGrantingFeatures = ["autorole", "reaction", "verification", "rolepicker"] as const satisfies readonly DashboardOverviewSection[]
const granted = (bits: bigint) => (bits & Permissions.Administrator) !== 0n ? Permissions.Administrator : bits & dangerous

/**
 * The safety audit: roles that give dangerous permissions to the everyone role or to many members, staff roles without the
 * permissions their class's commands check, and role features that let members past Fluxer's verification level, which Fluxer
 * skips for any member with a role. Member counts come from Fluxer's member search, which needs a member management permission.
 * A role whose count cannot be read is left out
 */
function readSafetyAudit(client: Client, serverId: string, guild: Guild, roles: readonly GuildRole[], status: SetupStatus) {
    return Effect.gen(function* () {
        const problems: SetupProblem[] = []
        const named = (role: GuildRole) => ({ id: role.id, name: role.name.slice(0, 100) || role.id })
        const everyone = roles.find(role => role.id === serverId)
        if (everyone && granted(everyone.permissions)) problems.push({ kind: "dangerous-role", role: named(everyone), permissions: permissionNames(granted(everyone.permissions)) })
        const risky = roles.filter(role => role.id !== serverId && granted(role.permissions))
            .sort((a, b) => Number((b.permissions & Permissions.Administrator) !== 0n) - Number((a.permissions & Permissions.Administrator) !== 0n) || a.position - b.position)
        for (const role of risky.slice(0, COUNTED_ROLES)) {
            const page = yield* client.members.search(serverId, { roleIds: [role.id], isBot: false, limit: 1 }, { timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (page && !page.indexing && page.totalResultCount >= MANY_MEMBERS) problems.push({ kind: "dangerous-role", role: named(role), permissions: permissionNames(granted(role.permissions)), members: page.totalResultCount })
        }
        const on = (id: DashboardOverviewSection) => status.sections.some(row => row.id === id && row.state === "on")
        if (on("moderation")) for (const staffClass of Object.keys(staffPermissions) as StaffClass[]) {
            for (const role of roles.filter(role => status.staffRoleIds[staffClass].includes(role.id))) {
                const held = role.permissions | (everyone?.permissions ?? 0n)
                const lacking = (held & Permissions.Administrator) !== 0n ? 0n : staffPermissions[staffClass] & ~held
                if (lacking) problems.push({ kind: "staff-permissions", staffClass, role: named(role), permissions: permissionNames(lacking) })
            }
        }
        const bypassing = roleGrantingFeatures.filter(on)
        if ((guild.verificationLevel ?? 0) > 0 && bypassing.length) problems.push({ kind: "verification-bypass", features: bypassing })
        return problems
    })
}

const staffCommands: Record<StaffClass, string> = { moderation: "!mod", security: "!security", cases: "!mod", automod: "!automod", appeals: "!appeal" }
type Safety = Extract<SetupProblem, { kind: "dangerous-role" | "staff-permissions" | "verification-bypass" }>
const isSafety = (problem: SetupProblem): problem is Safety => problem.kind === "dangerous-role" || problem.kind === "staff-permissions" || problem.kind === "verification-bypass"
/** A safety warning as a sentence that names its fix */
function safetyText(problem: Safety) {
    const them = (names: readonly string[]) => names.length > 1 ? "them" : "it"
    if (problem.kind === "dangerous-role") return problem.members === undefined
        ? `The everyone role gives ${labelList(problem.permissions)} to every member. Remove ${them(problem.permissions)} from that role`
        : `<@&${problem.role.id}> gives ${labelList(problem.permissions)} to ${problem.members} members. Keep ${them(problem.permissions)} on a role only trusted staff hold`
    if (problem.kind === "staff-permissions") return `The ${problem.staffClass} staff role <@&${problem.role.id}> lacks ${labelList(problem.permissions)}, which its ${staffCommands[problem.staffClass]} commands need. Grant ${them(problem.permissions)} to the role`
    return `Fluxer skips its verification level for members with any role, so ${sentenceList(problem.features.map(id => features[id].name))} let${problem.features.length > 1 ? "" : "s"} members past it. `
        + "If you rely on it, turn these off or use rules verification with advanced verification on"
}
/** One problem as a sentence that names its fix */
export function problemText(problem: SetupProblem) {
    if (problem.kind === "gateway") return `Connection: NeonFlux's connection to Fluxer is ${problem.state.toLowerCase()}. It reconnects on its own. If this lasts, tell the bot operator`
    if (isSafety(problem)) return `Safety: ${safetyText(problem)}`
    return `${featureName(problem.feature)}: ${fixSentence(problem.kind === "permissions" ? { permissions: problem.permissions } : { roles: problem.roles.map(role => role.id) })}`
}

const managerOnly = "Only the server owner or members with Manage Server can run this check"
const reply = (context: BotEventContext<"messageCreate">, content: string) => replyText(context, content)
/** Up to five names and how many more, joined for a sentence */
const someNames = (names: readonly string[]) => sentenceList(names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names)
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** Lines per !health permissions, !health safety and !recovery <area> page */
const DETAIL_PAGE = 10
/** The bot's permission problems as lines: Each missing permission with the features that need it, then each role it gives that ranks at or above its own */
function permissionLines(problems: readonly SetupProblem[]) {
    const needs = new Map<string, string[]>(), above = new Map<string, string[]>()
    const add = (map: Map<string, string[]>, key: string, name: string) => map.set(key, [...map.get(key) ?? [], name])
    for (const problem of problems) {
        if (problem.kind === "permissions") for (const key of problem.permissions) add(needs, key, featureName(problem.feature))
        if (problem.kind === "hierarchy") for (const role of problem.roles) add(above, role.id, featureName(problem.feature))
    }
    return { permissions: needs.size, roles: above.size, features: [...new Set(problems.flatMap(problem => problem.kind === "permissions" ? [featureName(problem.feature)] : []))],
        lines: [...[...needs].map(([key, names]) => `${permissionLabel(key)}: ${names.join(", ")}`), ...[...above].map(([id, names]) => `<@&${id}> ranks at or above NeonFlux's role: ${names.join(", ")}`)] }
}

/**
 * !health: whether NeonFlux reaches its data service and Fluxer, and how many permissions, role order problems and safety warnings it found.
 * !health permissions and !health safety list them with their fixes, 10 at a time
 */
export function handleHealthCommand(store: SetupStore | undefined, serverId: string, prefix: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* reply(context, managerOnly); return }
        const view = args[0], more = args[1] === "next"
        if (args.length > 2 || view !== undefined && view !== "permissions" && view !== "safety" || args.length === 2 && !more) { yield* reply(context, withPrefix("Use !health, !health permissions or !health safety", prefix)); return }
        // Every read checks again, so next continues by page number
        const key = pageKey(serverId, context.message, "health", view), next = more ? nextPosition<number>(key) : 1
        if (next === undefined) { yield* reply(context, withPrefix(noNextPage(`!health ${view}`), prefix)); return }
        const status = store ? yield* store.status(serverId).pipe(Effect.catch(() => Effect.succeed(undefined))) : undefined
        const problems = yield* readSetupProblems(context.client, serverId, status), missing = permissionLines(problems), safety = problems.filter(isSafety)
        if (view) {
            const lines = view === "permissions" ? missing.lines : safety.map(safetyText), pages = Math.max(1, Math.ceil(lines.length / DETAIL_PAGE)), page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            const fix = [missing.permissions ? "Grant these permissions to the NeonFlux role" : "", missing.roles ? "move the NeonFlux role above these roles" : ""].filter(Boolean).join(" and ")
            yield* replyCard(context, serverId, { title: view === "permissions" ? "Missing permissions" : "Safety warnings",
                description: withPrefix(lines.slice((page - 1) * DETAIL_PAGE, page * DETAIL_PAGE).join("\n") || (view === "permissions" ? "NeonFlux has the permissions and role position the features that are on need"
                    : status ? "No safety warnings" : "Safety can't be checked while NeonFlux can't reach its data service"), prefix),
                fields: page < pages ? [["Next", code(`${prefix}health ${view} next`)]] : [], ...(view === "permissions" && fix ? { note: `${fix[0]!.toUpperCase()}${fix.slice(1)}` } : {}) })
            return
        }
        const gateway = context.client.diagnostics().state
        const connection = !status ? store ? "NeonFlux can't reach its data service. Tell the bot operator" : `NeonFlux has no data service yet, so only ${code(`${prefix}ping`)} works. Tell the bot operator`
            : gateway !== "Connected" ? `NeonFlux's connection to Fluxer is ${gateway.toLowerCase()}. It reconnects on its own` : "OK"
        const permissions = [missing.permissions ? `Missing ${plural(missing.permissions, "permission")} used by ${plural(missing.features.length, "feature")}: ${someNames(missing.features)}` : "",
            missing.roles ? `${plural(missing.roles, "role")} NeonFlux gives ${missing.roles === 1 ? "ranks" : "rank"} at or above its own role` : ""].filter(Boolean).join(". ")
        const views = [missing.lines.length ? code(`${prefix}health permissions`) : "", safety.length ? code(`${prefix}health safety`) : ""].filter(Boolean)
        yield* replyCard(context, serverId, { title: "Health check", fields: [["Connection", connection], ["Permissions", permissions || "OK"],
            ["Safety", !status ? "Not checked without the data service" : safety.length ? plural(safety.length, "warning") : "No warnings"]],
            ...(views.length ? { note: `Send ${views.join(" or ")} to see ${views.length > 1 ? "each one" : "them"}` } : {}) })
    }).pipe(Effect.catch(() => reply(context, "NeonFlux's own permissions could not be read. Try again shortly")))
}

/** !setup: how many features are on and their names by state. !setup <feature>: one feature's state and its next step */
export function handleSetupCommand(store: SetupStore | undefined, serverId: string, prefix: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* reply(context, managerOnly); return }
        if (!store) { yield* reply(context, notSetUp("The setup check")); return }
        const query = args.join(" "), id = query ? findFeature(query) : undefined
        if (query && !id) { yield* reply(context, `No feature called ${query}. ${withPrefix(`Send ${code("!setup")} to see them all`, prefix)}`); return }
        const status = yield* store.status(serverId)
        if (id) {
            const feature = features[id], state = status.sections.find(row => row.id === id)?.state ?? "off"
            yield* replyCard(context, serverId, { title: feature.name, description: state === "on" ? "On" : state === "off" ? "Off" : "On, but it needs a step before it works",
                ...(state === "on" ? {} : { note: withPrefix(`Next: ${state === "setup" && feature.setup || feature.on}`, prefix) }) })
            return
        }
        const names = (state: "on" | "setup" | "off") => status.sections.filter(row => row.state === state).map(row => features[row.id].name).join(", ")
        yield* replyCard(context, serverId, { title: "Setup", description: `${status.sections.filter(row => row.state === "on").length} of ${status.sections.length} features are on`,
            fields: ([["On", names("on")], ["Needs a step", names("setup")], ["Off", names("off")]] as const).filter(([, value]) => value),
            note: withPrefix(`Send ${code("!setup <feature>")} to see how to set one up, for example ${code("!setup tickets")}. ${code("!health")} checks NeonFlux's permissions`, prefix) })
    }).pipe(Effect.catch(() => reply(context, "Setup progress is unavailable right now. Try again shortly")))
}

type RecoveryEntry = RecoveryInbox["entries"][number]
type Area = RecoverySource | "setup" | "permissions"
// The areas !recovery sorts its entries into, each named by its word. Features that need a step and the latest permission check have their own
const areas: Record<Area, string> = { setup: "Setup", permissions: "Permissions", defcon: "DEFCON", publishing: "Publishing", schedules: "Scheduled posts", events: "Events",
    suggestions: "Suggestions", roles: "Roles", temproles: "Temporary roles", tickets: "Tickets", cleanup: "Message cleanup", greetings: "Welcome and goodbye",
    milestones: "Birthdays and anniversaries", logs: "Metadata logs", helpdesk: "Help desk", youtube: "YouTube alerts" }
const areaOf = (entry: RecoveryEntry): Area => entry.kind === "work" ? entry.source : entry.kind === "setup" ? "permissions" : "setup"
/** The area a word or name means, in any case and in singular or plural: Its word, its name or the name's first word, or a feature word that names it, such as welcome */
export function findArea(query: string) {
    const word = squash(query), same = (known: string) => known === word || known === `${word}s` || `${known}s` === word
    const area = (Object.keys(areas) as Area[]).find(id => [id, squash(areas[id]), squash(areas[id].split(" ")[0]!)].some(same)), feature = area ? undefined : findFeature(query)
    return area ?? (feature && feature in areas ? feature as Area : undefined)
}
const when = (at: number | undefined) => at === undefined ? "Now" : ago(at)
/** One recovery inbox entry on one line: when and what happened. The backend writes members, roles and channels as mentions */
export function recoveryLine(entry: RecoveryEntry) {
    if (entry.kind === "feature") return `Now: ${features[entry.feature].name} is on but needs a step before it works`
    if (entry.kind === "setup") return `${when(entry.at)}: ${problemText(entry.problem)}`
    return `${when(entry.at)}: ${entry.summary}`
}
/** The step that resolves a recovery inbox entry. A permission problem names its own fix */
export function recoveryFix(entry: RecoveryEntry) {
    if (entry.kind === "feature") return features[entry.feature].setup ?? features[entry.feature].on
    return entry.kind === "setup" ? `${code("!health")} checks again once it is fixed` : entry.next
}
/**
 * !recovery: how many entries need attention in each area. !recovery <area> [next]: that area's entries, 10 at a time, with their fix when they share one.
 * !recovery <area> <number>: one entry with its fix
 */
export function handleRecoveryCommand(store: SetupStore | undefined, serverId: string, prefix: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* reply(context, "Only the server owner or members with Manage Server can read the recovery inbox"); return }
        const last = args.at(-1), more = last === "next", number = last !== undefined && /^[1-9]\d{0,2}$/.test(last) ? Number(last) : undefined
        const query = args.slice(0, more || number !== undefined ? -1 : undefined).join(" "), help = query.toLowerCase() === "help", area = query && !help ? findArea(query) : undefined
        if (!area && args.length) { yield* reply(context, withPrefix(`${query && !help ? `No area called ${query}. ` : ""}Send !recovery to see what needs attention, then !recovery <area> to see one area`, prefix)); return }
        if (!store) { yield* reply(context, notSetUp("The recovery inbox")); return }
        // The inbox is read again for every reply, so next continues by page number
        const key = pageKey(serverId, context.message, "recovery", area), next = more ? nextPosition<number>(key) : 1
        if (next === undefined) { yield* reply(context, withPrefix(noNextPage(`!recovery ${area}`), prefix)); return }
        const inbox = yield* store.recovery(serverId)
        if (!area) {
            if (!inbox.entries.length) { yield* replyCard(context, serverId, { title: "Recovery inbox", description: "Nothing needs attention" }); return }
            const counts = new Map<Area, number>(), total = inbox.entries.length
            for (const entry of inbox.entries) counts.set(areaOf(entry), (counts.get(areaOf(entry)) ?? 0) + 1)
            yield* replyCard(context, serverId, { title: "Recovery inbox", description: `${total}${inbox.truncated ? " or more things need" : total === 1 ? " thing needs" : " things need"} attention: ${[...counts].map(([id, count]) => `${areas[id]} ${count}`).join(", ")}`,
                note: withPrefix(`Send ${code("!recovery <area>")} to see one, for example ${code(`!recovery ${counts.keys().next().value}`)}`, prefix) })
            return
        }
        const entries = inbox.entries.filter(entry => areaOf(entry) === area), title = `Recovery inbox: ${areas[area]}`
        if (number !== undefined) {
            const entry = entries[number - 1]
            if (entry) yield* replyCard(context, serverId, { title, description: withPrefix(recoveryLine(entry), prefix), fields: [["Next step", withPrefix(recoveryFix(entry), prefix)]] })
            else yield* reply(context, withPrefix(entries.length ? `${areas[area]} has ${entries.length === 1 ? "1 entry" : `${entries.length} entries`}. Send !recovery ${area} to see ${entries.length === 1 ? "it" : "them"}`
                : `Nothing in ${areas[area]} needs attention`, prefix))
            return
        }
        const pages = Math.max(1, Math.ceil(entries.length / DETAIL_PAGE)), page = Math.min(next, pages), shown = entries.slice((page - 1) * DETAIL_PAGE, page * DETAIL_PAGE)
        rememberPosition(key, page < pages ? page + 1 : undefined)
        if (!shown.length) { yield* replyCard(context, serverId, { title, description: "Nothing needs attention" }); return }
        // Entries that share one fix, such as channels that need the same permissions, name it once
        const fixes = [...new Set(shown.map(recoveryFix))]
        yield* replyCard(context, serverId, { title, description: withPrefix(shown.map((entry, index) => `${(page - 1) * DETAIL_PAGE + index + 1}. ${recoveryLine(entry)}`).join("\n"), prefix),
            fields: page < pages ? [["Next", code(`${prefix}recovery ${area} next`)]] : [],
            note: withPrefix(fixes.length === 1 ? `Next step: ${fixes[0]}` : `Send ${code(`!recovery ${area} <number>`)} to see how to fix one`, prefix) })
    }).pipe(Effect.catch(() => reply(context, "The recovery inbox is unavailable right now. Try again shortly")))
}

/** The dashboard's permission check: Answers a waiting request from the website with the bot's own reads */
export function processSetupCheckPass(store: SetupStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        if (!(yield* store.ready(serverId)).queued) return
        const problems = yield* readSetupProblems(client, serverId, yield* store.status(serverId))
        // The backend keeps at most 50 problems
        yield* store.record(serverId, problems.slice(0, 50))
    })
}
