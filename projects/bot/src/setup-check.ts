import type { StaffClass } from "@neonflux/backend/contracts"
import type { DashboardOverviewSection, RecoveryInbox, RecoverySource, SetupProblem } from "@neonflux/backend/dashboard-contracts"
import { hierarchy, Permissions, type BotEventContext, type Client, type Guild, type GuildRole } from "@neontechspace/fluxerly/effect"
import { Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { readServerManagerAuthority, withPrefix } from "./general-settings.ts"
import { fixSentence, highestRole, labelList, permissionNames, sentenceList } from "./permission-fix.ts"
import { noMentions } from "./responses.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

const sectionIds = ["custom", "auto", "moderation", "cleanup", "logs", "reaction", "autorole", "verification", "rolepicker", "temproles", "onboarding", "publishing", "greetings", "schedules",
    "tickets", "leveling", "milestones", "suggestions", "events", "voice", "analytics", "sticky", "sidebar", "alerts", "helpdesk", "lfg", "showcase", "profile"] as const satisfies readonly DashboardOverviewSection[]
const section = Schema.Literals(sectionIds)
const id = Schema.String.check(Schema.makeFilter(value => /^[1-9]\d{0,18}$/.test(value)))
const statusSchema = Schema.Struct({
    sections: Schema.Array(Schema.Struct({ id: section, state: Schema.Literals(["on", "setup", "off"]) })),
    managedRoles: Schema.Array(Schema.Struct({ feature: section, roleIds: Schema.Array(id) })),
    staffRoleIds: Schema.Struct({ moderation: Schema.Array(id), cases: Schema.Array(id), automod: Schema.Array(id), security: Schema.Array(id), appeals: Schema.Array(id) }),
    threadFeatures: Schema.Array(section),
})
const name = Schema.String.check(Schema.isMaxLength(100))
const keys = Schema.Array(Schema.String.check(Schema.isPattern(/^[A-Za-z]{1,40}$/)))
const role = Schema.Struct({ id, name })
const problemSchema: Schema.Codec<SetupProblem> = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("permissions"), feature: Schema.Literals([...sectionIds, "general"]), permissions: keys }),
    Schema.Struct({ kind: Schema.Literal("hierarchy"), feature: section, roles: Schema.Array(role) }),
    Schema.Struct({ kind: Schema.Literal("gateway"), state: Schema.String.check(Schema.isMaxLength(32)) }),
    Schema.Struct({ kind: Schema.Literal("dangerous-role"), role, permissions: keys, members: Schema.optionalKey(Schema.Number) }),
    Schema.Struct({ kind: Schema.Literal("staff-permissions"), staffClass: Schema.Literals(["moderation", "cases", "automod", "security", "appeals"]), role, permissions: keys }),
    Schema.Struct({ kind: Schema.Literal("verification-bypass"), features: Schema.Array(section) }),
]) as unknown as Schema.Codec<SetupProblem>
const sources = ["publishing", "schedules", "events", "suggestions", "roles", "temproles", "tickets", "cleanup", "greetings", "milestones", "logs", "helpdesk", "defcon"] as const satisfies readonly RecoverySource[]
const inboxSchema: Schema.Codec<RecoveryInbox> = Schema.Struct({ serverId: id, truncated: Schema.Boolean, entries: Schema.Array(Schema.Union([
    Schema.Struct({ kind: Schema.Literal("work"), source: Schema.Literals(sources), at: Schema.optionalKey(Schema.Number), summary: Schema.String, next: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("setup"), at: Schema.Number, problem: problemSchema }),
    Schema.Struct({ kind: Schema.Literal("feature"), feature: section }),
])).check(Schema.isMaxLength(100)) }) as unknown as Schema.Codec<RecoveryInbox>
export function createSetupStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    return {
        recovery: (serverId: string) => request("/recovery/list", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(inboxSchema))),
        status: (serverId: string) => request("/setup/status", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(statusSchema))),
        ready: (serverId: string) => request("/setup/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ queued: Schema.Boolean })))),
        record: (serverId: string, problems: readonly SetupProblem[]) => request("/setup/record", { serverId, problems }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ recorded: Schema.Boolean })))),
    }
}
export type SetupStore = ReturnType<typeof createSetupStore>

const send = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
/** What replies and every feature need, checked server-wide */
const basePermissions = send | Permissions.ReadMessageHistory
// Each feature's server-wide permissions, its name and the next step when it is off or needs setup. A feature that assigns roles also needs Manage Roles
const features: Record<DashboardOverviewSection, { name: string, permissions: bigint, on: string, setup?: string }> = {
    custom: { name: "Custom commands", permissions: 0n, on: "Turn it on with !custom module on", setup: "Create one with !custom create <name> text \"response\"" },
    auto: { name: "Autoresponders", permissions: 0n, on: "Turn it on with !auto module on", setup: "Create one with !auto create <name> exact \"trigger\" text \"response\"" },
    moderation: { name: "Moderation", permissions: Permissions.KickMembers | Permissions.BanMembers | Permissions.ModerateMembers | Permissions.ManageMessages, on: "Turn it on with !mod module on" },
    cleanup: { name: "Message cleanup", permissions: Permissions.ManageMessages, on: "Turn it on with !cleanup module on <settings-revision> from !cleanup status", setup: "Add a channel with !cleanup configure #channel 0 <age>, then !cleanup enable" },
    logs: { name: "Metadata logs", permissions: Permissions.ViewAuditLog, on: "Turn it on with !logs metadata module on <revision> from !logs metadata status", setup: "Send a category to a channel with !logs metadata route" },
    reaction: { name: "Reaction roles", permissions: Permissions.AddReactions, on: "Turn it on with !roles module on", setup: "Publish a panel with !roles publish <panel> #channel <draft>" },
    autorole: { name: "Autorole", permissions: Permissions.ManageRoles, on: "Turn it on with !autorole module on", setup: "Add a role with !autorole add @role" },
    verification: { name: "Rules verification", permissions: Permissions.ManageRoles | Permissions.AddReactions, on: "Turn it on with !verify module on", setup: "Set it up with !verify configure @role <emoji>, then !verify publish #channel <draft>" },
    rolepicker: { name: "Role picker", permissions: Permissions.ManageRoles, on: "Turn it on with !rolepicker on", setup: "Add a menu with !rolepicker menu add <name> single|multi" },
    temproles: { name: "Temporary roles", permissions: Permissions.ManageRoles, on: "Give one with !temprole add @member @role 7d" },
    onboarding: { name: "Newcomer checklist", permissions: Permissions.ManageRoles, on: "Add a step with !onboarding add rules, then !onboarding on", setup: "Add a rules, panel or menu step with !onboarding add" },
    publishing: { name: "Publishing", permissions: 0n, on: "Turn it on with !publish module on" },
    greetings: { name: "Welcome and goodbye", permissions: 0n, on: "Set a route with !welcome configure <template> #channel join, then !welcome module on" },
    schedules: { name: "Scheduled posts", permissions: 0n, on: "Turn it on with !publish schedule module on <settings-revision>", setup: "Create one with !publish schedule create" },
    tickets: { name: "Tickets", permissions: Permissions.ManageChannels | Permissions.ManageRoles, on: "Turn it on with !ticket module on", setup: "Create a category with !ticket category create in a DM with NeonFlux" },
    leveling: { name: "Leveling", permissions: 0n, on: "Turn it on with !level module on" },
    milestones: { name: "Birthdays and anniversaries", permissions: 0n, on: "Turn it on with !milestone module on <settings-revision>", setup: "Set a route with !milestone configure birthday|anniversary" },
    suggestions: { name: "Suggestions", permissions: 0n, on: "Choose a channel with !suggest configure <settings-revision> #channel, then !suggest enable <settings-revision>", setup: "Choose a channel with !suggest configure <settings-revision> #channel" },
    events: { name: "Events", permissions: 0n, on: "Turn it on with !event module on <settings-revision>" },
    voice: { name: "Temporary voice rooms", permissions: Permissions.ManageChannels | Permissions.MoveMembers | Permissions.ManageRoles | Permissions.Connect, on: "Add a generator with !voice generator add \"Join to create\"" },
    analytics: { name: "Analytics", permissions: 0n, on: "Turn it on with !stats on" },
    sticky: { name: "Sticky messages", permissions: 0n, on: "Add one with !sticky add #channel \"text\"" },
    sidebar: { name: "Dashboard link", permissions: Permissions.ManageChannels, on: "Add it with !sidebar add" },
    // Webhook and privilege alerts read audit entries, and invite lists and the staff names impersonation compares need Manage Server
    alerts: { name: "Security alerts", permissions: Permissions.ViewAuditLog | Permissions.ManageGuild, on: "Turn one on with !alerts on <alert>, such as !alerts on bots",
        setup: "Turn on metadata logs and send the security category to a staff channel with !logs metadata route security" },
    helpdesk: { name: "Help desk", permissions: Permissions.ManageThreads | Permissions.SendMessagesInThreads, on: "Add a forum with !helpdesk forum add #forum" },
    // Group rooms are temporary voice rooms that only the group may see
    lfg: { name: "Looking for group", permissions: Permissions.ManageChannels | Permissions.ManageRoles | Permissions.Connect, on: "Turn it on with !lfg config on",
        setup: "Choose the group channel and a voice generator with !lfg config channel #channel and !lfg config generator #generator" },
    showcase: { name: "Showcases", permissions: 0n, on: "Choose a channel with !showcase channel #channel, then !showcase on", setup: "Choose a channel with !showcase channel #channel" },
    profile: { name: "Member profiles", permissions: 0n, on: "Turn it on with !profile on" },
}
const featureName = (feature: DashboardOverviewSection | "general") => feature === "general" ? "Replies" : features[feature].name
/** A feature that is on but cannot act yet, with the step that completes its setup */
export const featureSetupText = (feature: DashboardOverviewSection) => `${features[feature].name} is on but needs setup. Next: ${features[feature].setup ?? features[feature].on}`

/** The bot's missing permissions for each enabled feature, roles it assigns that rank at or above it, and gateway trouble. Reads Fluxer as the bot */
export function readSetupProblems(client: Client, serverId: string, status: typeof statusSchema.Type | undefined) {
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
function readSafetyAudit(client: Client, serverId: string, guild: Guild, roles: readonly GuildRole[], status: typeof statusSchema.Type) {
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

const staffCommands: Record<StaffClass, string> = { moderation: "!mod", security: "!security", cases: "!case", automod: "!automod", appeals: "!appeals" }
/** One problem as a sentence that names its fix */
export function problemText(problem: SetupProblem) {
    if (problem.kind === "gateway") return `Gateway: ${problem.state}. NeonFlux reconnects on its own. If this lasts, the bot operator should check the host's network and the bot's logs`
    if (problem.kind === "dangerous-role") return problem.members === undefined
        ? `Safety: The everyone role gives ${labelList(problem.permissions)} to every member. Remove ${problem.permissions.length > 1 ? "them" : "it"} from the everyone role`
        : `Safety: <@&${problem.role.id}> gives ${labelList(problem.permissions)} to ${problem.members} members. Remove ${problem.permissions.length > 1 ? "them" : "it"} from the role, or keep ${problem.permissions.length > 1 ? "them" : "it"} on a role only trusted staff hold`
    if (problem.kind === "staff-permissions") return `Safety: The ${problem.staffClass} staff role <@&${problem.role.id}> lacks ${labelList(problem.permissions)}, so its members cannot run the ${staffCommands[problem.staffClass]} commands that need ${problem.permissions.length > 1 ? "them" : "it"}. Grant ${problem.permissions.length > 1 ? "them" : "it"} to the role, or choose other roles with !mod staff ${problem.staffClass}`
    if (problem.kind === "verification-bypass") return `Safety: Fluxer skips its verification level for members who have any role, so ${sentenceList(problem.features.map(id => features[id].name))} let${problem.features.length > 1 ? "" : "s"} members past it. `
        + "If you rely on the verification level, turn these off, or use rules verification with advanced verification on, so members solve a challenge before NeonFlux gives a role and autorole waits for it"
    return `${featureName(problem.feature)}: ${fixSentence(problem.kind === "permissions" ? { permissions: problem.permissions } : { roles: problem.roles.map(role => role.id) })}`
}

const managerOnly = "Only the server owner or members with Manage Server can run this check"
const reply = (context: BotEventContext<"messageCreate">, content: string) => context.reply({ content, allowedMentions: noMentions })
function replyLines(context: BotEventContext<"messageCreate">, lines: readonly string[]) {
    return Effect.gen(function* () {
        let page = ""
        for (const line of lines) {
            if (page && page.length + line.length + 1 > 1900) { yield* reply(context, page); page = "" }
            page = page ? `${page}\n${line}` : line
        }
        if (page) yield* reply(context, page)
    })
}

/** !health: backend reachability, the bot's missing permissions per enabled feature, role order and gateway state, each with its fix */
export function handleHealthCommand(store: SetupStore | undefined, serverId: string, prefix: string, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* reply(context, managerOnly); return }
        const status = store ? yield* store.status(serverId).pipe(Effect.catch(() => Effect.succeed(undefined))) : undefined
        const problems = yield* readSetupProblems(context.client, serverId, status)
        const gateway = context.client.diagnostics()
        const lines = [
            "Health check",
            status ? "Backend: reachable" : store ? "Backend: unreachable, so enabled features could not be read. The bot operator should check CONVEX_URL and the backend deployment"
                : "Backend: not configured, so only !ping works. The bot operator should set CONVEX_URL and NEONFLUX_BOT_API_SECRET",
            `Gateway: ${gateway.state}${gateway.gatewayLatencyMs === null ? "" : `, heartbeat ${gateway.gatewayLatencyMs} ms`}`,
            ...problems.length ? ["Problems:", ...problems.map(problem => `- ${problemText(problem)}`)] : ["No permission or role problems found for the enabled features"],
        ]
        yield* replyLines(context, lines.map(line => withPrefix(line, prefix)))
    }).pipe(Effect.catch(() => reply(context, "The bot's own permissions could not be read. Try again shortly")))
}

/** !setup: every feature as on, off or needs setup, with the next step for each one that is not on */
export function handleSetupCommand(store: SetupStore | undefined, serverId: string, prefix: string, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* reply(context, managerOnly); return }
        if (!store) { yield* reply(context, "Setup persistence is not configured"); return }
        const status = yield* store.status(serverId)
        const lines = status.sections.map(({ id, state }) => {
            const feature = features[id]
            return state === "on" ? `${feature.name}: on` : `${feature.name}: ${state === "off" ? "off" : "needs setup"}. Next: ${state === "setup" && feature.setup || feature.on}`
        })
        yield* replyLines(context, ["Setup checklist. Send !health to check the bot's permissions and !recovery to see failed or uncertain work", ...lines, "Start from a preset of these settings with !preset list"].map(line => withPrefix(line, prefix)))
    }).pipe(Effect.catch(() => reply(context, "Setup progress is unavailable right now. Try again shortly")))
}

/** Recovery inbox entries per !recovery page */
export const RECOVERY_PAGE = 15
const when = (at: number | undefined) => at === undefined ? "Now" : `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`
/** One recovery inbox entry: when, what happened and the step that resolves it */
export function recoveryText(entry: RecoveryInbox["entries"][number]) {
    if (entry.kind === "feature") return `- Now: ${featureSetupText(entry.feature)}`
    if (entry.kind === "setup") return `- ${when(entry.at)}, permission check: ${problemText(entry.problem)}`
    return `- ${when(entry.at)}: ${entry.summary}. Next: ${entry.next}`
}
/** !recovery: failed, stuck or uncertain work, features that cannot act and permission problems, each with its next step */
export function handleRecoveryCommand(store: SetupStore | undefined, serverId: string, prefix: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* reply(context, "Only the server owner or members with Manage Server can read the recovery inbox"); return }
        if (args.length > 1 || args[0] !== undefined && !/^[1-9]\d{0,1}$/.test(args[0])) { yield* reply(context, withPrefix("Use !recovery [page]", prefix)); return }
        if (!store) { yield* reply(context, "Setup persistence is not configured"); return }
        const inbox = yield* store.recovery(serverId), pages = Math.max(1, Math.ceil(inbox.entries.length / RECOVERY_PAGE)), page = Math.min(Number(args[0] ?? 1), pages)
        if (!inbox.entries.length) { yield* reply(context, "Recovery inbox: Nothing needs attention"); return }
        const lines = [`Recovery inbox, page ${page} of ${pages}. ${inbox.entries.length}${inbox.truncated ? " or more" : ""} entries, current state first and then newest first`,
            ...inbox.entries.slice((page - 1) * RECOVERY_PAGE, page * RECOVERY_PAGE).map(recoveryText), ...page < pages ? [`Send !recovery ${page + 1} for the next page`] : []]
        yield* replyLines(context, lines.map(line => withPrefix(line, prefix)))
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
