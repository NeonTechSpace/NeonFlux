import {
    SETUP_PROBLEM_LIMIT,
    SetupReadyResult,
    SetupRecordResult,
    SetupStatus,
    type DashboardOverviewSection,
    type SetupProblem,
} from "@neonflux/contracts/setup"
import { format, hierarchy, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { readServerManagerAuthority, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { labelList, permissionNames, sentenceList } from "./permission-fix.ts"
import { clip, code, notSetUp, replyCard, replyText } from "./reply-style.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export function createSetupStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    return {
        status: (serverId: string) =>
            request("/setup/status", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SetupStatus))),
        ready: (serverId: string) =>
            request("/setup/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SetupReadyResult))),
        record: (serverId: string, problems: readonly SetupProblem[]) =>
            request("/setup/record", { serverId, problems }).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(SetupRecordResult)),
            ),
    }
}
export type SetupStore = ReturnType<typeof createSetupStore>

const send = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
/** What replies and every feature need, checked server-wide */
const basePermissions = send | Permissions.ReadMessageHistory
// Each feature's server-wide permissions, its name and the next step when it is off or needs setup. A feature that assigns roles also needs Manage roles
const features: Record<DashboardOverviewSection, { name: string; permissions: bigint; on: string; setup?: string }> = {
    custom: {
        name: "Custom commands",
        permissions: 0n,
        on: "Turn it on with `!custom module on`",
        setup: 'Create one with `!custom create <name> text "response"`',
    },
    auto: {
        name: "Autoresponders",
        permissions: 0n,
        on: "Turn it on with `!auto module on`",
        setup: 'Create one with `!auto create <name> exact "trigger" text "response"`',
    },
    moderation: {
        name: "Moderation",
        permissions:
            Permissions.KickMembers | Permissions.BanMembers | Permissions.ModerateMembers | Permissions.ManageMessages,
        on: "Turn it on with `!mod module on`",
    },
    cleanup: {
        name: "Message cleanup",
        permissions: Permissions.ManageMessages,
        on: "Turn it on with `!cleanup module on`",
        setup: "Add a channel with `!cleanup configure #channel <age>`, then `!cleanup enable #channel`",
    },
    logs: {
        name: "Metadata logs",
        permissions: Permissions.ViewAuditLog,
        on: "Turn it on with `!logs metadata module on`",
        setup: "Send a category to a channel with `!logs metadata route`",
    },
    reaction: {
        name: "Reaction roles",
        permissions: Permissions.AddReactions,
        on: "Turn it on with `!roles module on`",
        setup: "Publish a panel with `!roles publish <panel> #channel <draft>`",
    },
    autorole: {
        name: "Autorole",
        permissions: Permissions.ManageRoles,
        on: "Turn it on with `!autorole module on`",
        setup: "Add a role with `!autorole add @role`",
    },
    verification: {
        name: "Rules verification",
        permissions: Permissions.ManageRoles | Permissions.AddReactions,
        on: "Turn it on with `!verify module on`",
        setup: "Set it up with `!verify configure @role <emoji>`, then `!verify publish #channel <draft>` and `!verify module on`, and `!roles enable rules` if the panel was turned off. Until members can accept the rules, a configured rules panel holds back role grants",
    },
    rolepicker: {
        name: "Role picker",
        permissions: Permissions.ManageRoles,
        on: "Turn it on with `!rolepicker on`",
        setup: "Add a menu with `!rolepicker menu add <name> single|multi`",
    },
    publishing: { name: "Publishing", permissions: 0n, on: "Turn it on with `!publish module on`" },
    greetings: {
        name: "Welcome and goodbye",
        permissions: 0n,
        on: "Set a route with `!welcome configure <template> #channel join`, then `!welcome module on`",
    },
    schedules: {
        name: "Scheduled posts",
        permissions: 0n,
        on: "Turn it on with `!publish schedule module on`",
        setup: "Create one with `!publish schedule create`",
    },
    tickets: {
        name: "Tickets",
        permissions: Permissions.ManageChannels | Permissions.ManageRoles,
        on: "Turn it on with `!ticket module on`",
        setup: "Create a category with `!ticket category create` in a DM with NeonFlux",
    },
    leveling: { name: "Leveling", permissions: 0n, on: "Turn it on with `!level module on`" },
    milestones: {
        name: "Birthdays and anniversaries",
        permissions: 0n,
        on: "Turn it on with `!milestone module on`",
        setup: "Set a route with `!milestone configure birthday|anniversary`",
    },
    suggestions: {
        name: "Suggestions",
        permissions: 0n,
        on: "Choose a channel with `!suggest configure #channel`, then `!suggest enable`",
        setup: "Choose a channel with `!suggest configure #channel`",
    },
    events: { name: "Events", permissions: 0n, on: "Turn it on with `!event module on`" },
    voice: {
        name: "Temporary voice rooms",
        permissions:
            Permissions.ManageChannels | Permissions.MoveMembers | Permissions.ManageRoles | Permissions.Connect,
        on: 'Add a generator with `!voice generator add "Join to create"`',
    },
    analytics: { name: "Analytics", permissions: 0n, on: "Turn it on with `!stats on`" },
}
const featureName = (feature: DashboardOverviewSection | "general") =>
    feature === "general" ? "Replies" : features[feature].name
const squash = (value: string) => value.toLowerCase().replace(/[\s-]+/g, "")
// The words that name each feature in !setup <feature>: its ID, its name without spaces and the command its on step uses. An earlier feature wins a shared word, so publish names publishing
const featureWords = (Object.keys(features) as DashboardOverviewSection[]).map(
    (id) => [id, [id, squash(features[id].name), /`!(\w+)/.exec(features[id].on)![1]!]] as const,
)
/** The feature a word or name means, in any case and in singular or plural */
export function findFeature(query: string) {
    const word = squash(query)
    return featureWords.find(([, words]) =>
        words.some((known) => known === word || known === `${word}s` || `${known}s` === word),
    )?.[0]
}

/** The bot's missing permissions for each enabled feature, roles it assigns that rank at or above it, and gateway trouble. Reads Fluxer as the bot */
function readSetupProblems(client: Client, serverId: string, status: SetupStatus | undefined) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const { guild, roles, bot } = yield* readSafetyAuthority(client, serverId, botId)
        const bits = client.permissions.calculate({ guild, member: bot, roles })
        const enabled = new Set(status?.sections.filter((row) => row.state !== "off").map((row) => row.id))
        const managed = status?.managedRoles.filter((entry) => enabled.has(entry.feature)) ?? []
        const problems: SetupProblem[] = []
        const missing = (feature: DashboardOverviewSection | "general", required: bigint) => {
            if ((required & ~bits) !== 0n)
                problems.push({ kind: "permissions", feature, permissions: permissionNames(required & ~bits) })
        }
        missing("general", basePermissions)
        for (const feature of enabled)
            missing(
                feature,
                (features[feature].permissions & ~basePermissions) |
                    (managed.some((entry) => entry.feature === feature) ? Permissions.ManageRoles : 0n),
            )
        // The owner outranks every role. Otherwise the bot's highest role must be above each role it assigns
        for (const entry of managed) {
            const above = roles.filter(
                (role) =>
                    entry.roleIds.includes(role.id) && !hierarchy.canManageRole({ guild, actor: bot, role, roles }),
            )
            if (above.length)
                problems.push({
                    kind: "hierarchy",
                    feature: entry.feature,
                    roles: above.map((role) => ({
                        id: role.id,
                        name: clip(role.name, 100, "") || role.id,
                    })),
                })
        }
        const gateway = client.diagnostics()
        if (gateway.state !== "Connected") problems.push({ kind: "gateway", state: gateway.state })
        return problems
    })
}

const managerOnly = "Only the server owner or members with Manage community can run this check"
const reply = (context: BotEventContext<"messageCreate">, content: string) => replyText(context, content)
/** Up to five names and how many more, joined for a sentence */
const someNames = (names: readonly string[]) =>
    sentenceList(names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names)
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** Lines per !health permissions page */
const DETAIL_PAGE = 10
/** The bot's permission problems as lines: Each missing permission with the features that need it, then each role it gives that ranks at or above its own */
function permissionLines(problems: readonly SetupProblem[]) {
    const needs = new Map<string, string[]>(),
        above = new Map<string, string[]>()
    const add = (map: Map<string, string[]>, key: string, name: string) => map.set(key, [...(map.get(key) ?? []), name])
    for (const problem of problems) {
        if (problem.kind === "permissions")
            for (const key of problem.permissions) add(needs, key, featureName(problem.feature))
        if (problem.kind === "hierarchy")
            for (const role of problem.roles) add(above, role.id, featureName(problem.feature))
    }
    return {
        permissions: needs.size,
        roles: above.size,
        features: [
            ...new Set(
                problems.flatMap((problem) => (problem.kind === "permissions" ? [featureName(problem.feature)] : [])),
            ),
        ],
        lines: [
            ...[...needs].map(([key, names]) => `${labelList([key])}: ${names.join(", ")}`),
            ...[...above].map(
                ([id, names]) => `${format.roleMention(id)} ranks at or above NeonFlux's role: ${names.join(", ")}`,
            ),
        ],
    }
}

/**
 * !health: whether NeonFlux reaches its data service and Fluxer, and how many permissions and role order problems it found.
 * !health permissions lists them with their fixes, 10 at a time
 */
export function handleHealthCommand(
    store: SetupStore | undefined,
    serverId: string,
    prefix: string,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) {
            yield* reply(context, managerOnly)
            return
        }
        const view = args[0],
            more = args[1] === "next"
        if (args.length > 2 || (view !== undefined && view !== "permissions") || (args.length === 2 && !more)) {
            yield* reply(context, withPrefix("Use !health or !health permissions", prefix))
            return
        }
        // Every read checks again, so next continues by page number
        const key = pageKey(serverId, context.message, "health", view),
            next = more ? nextPosition<number>(key) : 1
        if (next === undefined) {
            yield* reply(context, withPrefix(noNextPage(`!health ${view}`), prefix))
            return
        }
        const status = store
            ? yield* store.status(serverId).pipe(Effect.catch(() => Effect.succeed(undefined)))
            : undefined
        const problems = yield* readSetupProblems(context.client, serverId, status),
            missing = permissionLines(problems)
        if (view) {
            const lines = missing.lines,
                pages = Math.max(1, Math.ceil(lines.length / DETAIL_PAGE)),
                page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            const fix = [
                missing.permissions ? "Grant these permissions to the NeonFlux role" : "",
                missing.roles ? "move the NeonFlux role above these roles" : "",
            ]
                .filter(Boolean)
                .join(" and ")
            yield* replyCard(context, {
                title: "Missing permissions",
                description: withPrefix(
                    lines.slice((page - 1) * DETAIL_PAGE, page * DETAIL_PAGE).join("\n") ||
                        "NeonFlux has the permissions and role position the features that are on need",
                    prefix,
                ),
                fields: page < pages ? [["Next", code(`${prefix}health ${view} next`)]] : [],
                ...(fix ? { note: `${fix[0]!.toUpperCase()}${fix.slice(1)}` } : {}),
            })
            return
        }
        const gateway = context.client.diagnostics().state
        const connection = !status
            ? store
                ? "NeonFlux can't reach its data service. Tell the bot operator"
                : "NeonFlux has no data service yet, so features that store data are unavailable. Tell the bot operator"
            : gateway !== "Connected"
              ? `NeonFlux's connection to Fluxer is ${gateway.toLowerCase()}. It reconnects on its own`
              : "OK"
        const permissions = [
            missing.permissions
                ? `Missing ${plural(missing.permissions, "permission")} used by ${plural(missing.features.length, "feature")}: ${someNames(missing.features)}`
                : "",
            missing.roles
                ? `${plural(missing.roles, "role")} NeonFlux gives ${missing.roles === 1 ? "ranks" : "rank"} at or above its own role`
                : "",
        ]
            .filter(Boolean)
            .join(". ")
        yield* replyCard(context, {
            title: "Health check",
            fields: [
                ["Connection", connection],
                ["Permissions", permissions || "OK"],
            ],
            ...(missing.lines.length ? { note: `Send ${code(`${prefix}health permissions`)} to see them` } : {}),
        })
    }).pipe(Effect.catch(() => reply(context, "NeonFlux's own permissions could not be read. Try again shortly")))
}

/** !setup: how many features are on and their names by state. !setup <feature>: one feature's state and its next step */
export function handleSetupCommand(
    store: SetupStore | undefined,
    serverId: string,
    prefix: string,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) {
            yield* reply(context, managerOnly)
            return
        }
        if (!store) {
            yield* reply(context, notSetUp("The setup check"))
            return
        }
        const query = args.join(" "),
            id = query ? findFeature(query) : undefined
        if (query && !id) {
            yield* reply(
                context,
                `No feature called ${query}. ${withPrefix(`Send ${code("!setup")} to see them all`, prefix)}`,
            )
            return
        }
        const status = yield* store.status(serverId)
        if (id) {
            const feature = features[id],
                state = status.sections.find((row) => row.id === id)?.state ?? "off"
            yield* replyCard(context, {
                title: feature.name,
                description:
                    state === "on" ? "On" : state === "off" ? "Off" : "On, but it needs a step before it works",
                ...(state === "on"
                    ? {}
                    : { note: withPrefix(`Next: ${(state === "setup" && feature.setup) || feature.on}`, prefix) }),
            })
            return
        }
        const names = (state: "on" | "setup" | "off") =>
            status.sections
                .filter((row) => row.state === state)
                .map((row) => features[row.id].name)
                .join(", ")
        yield* replyCard(context, {
            title: "Setup",
            description: `${status.sections.filter((row) => row.state !== "off").length} of ${status.sections.length} features are on`,
            fields: (
                [
                    ["On", names("on")],
                    ["Needs a step", names("setup")],
                    ["Off", names("off")],
                ] as const
            ).filter(([, value]) => value),
            note: withPrefix(
                `Send ${code("!setup <feature>")} to see how to set one up, for example ${code("!setup tickets")}. ${code("!health")} checks NeonFlux's permissions`,
                prefix,
            ),
        })
    }).pipe(Effect.catch(() => reply(context, "Setup progress is unavailable right now. Try again shortly")))
}

/** The dashboard's permission check: Answers a waiting request from the website with the bot's own reads */
export function processSetupCheckPass(store: SetupStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        if (!(yield* store.ready(serverId)).queued) return
        const problems = yield* readSetupProblems(client, serverId, yield* store.status(serverId))
        yield* store.record(serverId, problems.slice(0, SETUP_PROBLEM_LIMIT))
    })
}
