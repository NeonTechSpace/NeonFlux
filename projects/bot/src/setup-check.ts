import type { DashboardOverviewSection, SetupProblem } from "@neonflux/backend/dashboard-contracts"
import { hierarchy, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { readServerManagerAuthority, withPrefix } from "./general-settings.ts"
import { fixSentence, highestRole, permissionNames } from "./permission-fix.ts"
import { noMentions } from "./responses.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

const sectionIds = ["custom", "auto", "moderation", "cleanup", "logs", "reaction", "autorole", "verification", "rolepicker", "publishing", "greetings", "schedules",
    "tickets", "leveling", "milestones", "suggestions", "events", "voice", "analytics"] as const satisfies readonly DashboardOverviewSection[]
const section = Schema.Literals(sectionIds)
const id = Schema.String.check(Schema.makeFilter(value => /^[1-9]\d{0,18}$/.test(value)))
const statusSchema = Schema.Struct({
    sections: Schema.Array(Schema.Struct({ id: section, state: Schema.Literals(["on", "setup", "off"]) })),
    managedRoles: Schema.Array(Schema.Struct({ feature: section, roleIds: Schema.Array(id) })),
})
export function createSetupStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    return {
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
}
const featureName = (feature: DashboardOverviewSection | "general") => feature === "general" ? "Replies" : features[feature].name

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
        for (const feature of enabled) missing(feature, features[feature].permissions & ~basePermissions | (managed.some(entry => entry.feature === feature) ? Permissions.ManageRoles : 0n))
        // The owner outranks every role. Otherwise the bot's highest role must be above each role it assigns
        if (guild.ownerId !== botId) for (const entry of managed) {
            const above = roles.filter(role => entry.roleIds.includes(role.id) && !(top && hierarchy.isAbove(top, role)))
            if (above.length) problems.push({ kind: "hierarchy", feature: entry.feature, roles: above.map(role => ({ id: role.id, name: role.name.slice(0, 100) || role.id })) })
        }
        const gateway = client.diagnostics()
        if (gateway.state !== "Connected") problems.push({ kind: "gateway", state: gateway.state })
        return problems
    })
}

/** One problem as a sentence that names its fix */
export function problemText(problem: SetupProblem) {
    if (problem.kind === "gateway") return `Gateway: ${problem.state}. NeonFlux reconnects on its own. If this lasts, the bot operator should check the host's network and the bot's logs`
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
        yield* replyLines(context, ["Setup checklist. Send !health to check the bot's permissions", ...lines].map(line => withPrefix(line, prefix)))
    }).pipe(Effect.catch(() => reply(context, "Setup progress is unavailable right now. Try again shortly")))
}

/** The dashboard's permission check: Answers a waiting request from the website with the bot's own reads */
export function processSetupCheckPass(store: SetupStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        if (!(yield* store.ready(serverId)).queued) return
        const problems = yield* readSetupProblems(client, serverId, yield* store.status(serverId))
        yield* store.record(serverId, problems)
    })
}
