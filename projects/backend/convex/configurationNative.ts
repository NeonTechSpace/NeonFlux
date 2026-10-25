import type {
    DashboardConfigurationExecuteInput,
    DashboardConfigurationFamily,
    DashboardConfigurationNativeTarget,
} from "@neonflux/contracts/dashboard"
import type { PublishingKind } from "@neonflux/contracts/publishing-base"
import { SidebarDashboardContext } from "@neonflux/contracts/sidebar"
import { VoiceDashboardContext } from "@neonflux/contracts/voice"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import { configurationOperation, configurationCritical } from "./configurationDomain.ts"
import { decode, object, fail, requireId } from "./validation.ts"
import { alertInviteList } from "./alertsDomain.ts"
import { validateEventCalendar } from "./eventsDomain.ts"
import { cleanupContext } from "./cleanupDomain.ts"
import { cleanupAuthority } from "./cleanupStore.ts"
import { ticketContext } from "./ticketDomain.ts"
import { validateScheduleCalendar } from "./schedulesDomain.ts"
import { actor, administrator } from "./moderationDomain.ts"
import { readSettings } from "./moderationStore.ts"
import { composerContext } from "./publishingContext.ts"
import { currentTemplate } from "./publishing.ts"
import { followedTemplate } from "./greetings.ts"
import { followedMilestoneTemplate } from "./milestonesStore.ts"

type Read = QueryCtx | MutationCtx
export async function configurationNativeTarget(
    ctx: Read,
    serverId: string,
    family: DashboardConfigurationFamily,
    value: unknown,
): Promise<DashboardConfigurationNativeTarget> {
    const raw = object(configurationOperation(family, value)),
        op = family === "responses" ? object(raw.operation) : raw,
        target: { -readonly [K in keyof DashboardConfigurationNativeTarget]: DashboardConfigurationNativeTarget[K] } =
            {}
    const channels = new Set<string>(),
        roles = new Set<string>(),
        add = (value: unknown, set: Set<string>) => {
            if (Array.isArray(value)) value.forEach((id) => set.add(requireId(id)))
        }
    const patch = op.patch === undefined ? {} : object(op.patch)
    if (family === "responses") {
        const def = op.definition ? object(op.definition) : op
        add(def.channelIds, channels)
        add(def.roleIds, roles)
    }
    if (family === "moderation") {
        // Only added honeypots are checked, so a stored channel that was deleted since does not block the change
        if (Array.isArray(patch.honeypotChannelIds)) {
            const stored = new Set((await readSettings(ctx, serverId))?.config.honeypotChannelIds)
            add(
                patch.honeypotChannelIds.filter((id) => !stored.has(id)),
                channels,
            )
        }
        if (patch.logChannelId) channels.add(requireId(patch.logChannelId))
        if (patch.staffRoleIds) Object.values(object(patch.staffRoleIds)).forEach((list) => add(list, roles))
        const rule = op.rule ? object(op.rule) : patch
        add(rule.channelIds, channels)
        add(rule.exemptChannelIds, channels)
        add(rule.exemptRoleIds, roles)
        if (typeof op.roleId === "string") roles.add(requireId(op.roleId))
    }
    if (family === "rolepicker") {
        add(op.roleIds, roles)
        add(op.allowRoleIds, roles)
        add(op.blockRoleIds, roles)
    }
    // Clearing a deleted role's defaults needs no proof that the role exists
    if (family === "temproles" && (op.defaultSeconds !== null || op.maxSeconds !== null))
        roles.add(requireId(op.roleId))
    if (family === "leveling") {
        add(patch.excludedChannelIds, channels)
        add(patch.excludedRoleIds, roles)
        // A fixed level-up channel is checked like the other channels, so it must be in this server
        if (patch.levelUp && typeof object(patch.levelUp).channelId === "string")
            channels.add(requireId(object(patch.levelUp).channelId))
        if (Array.isArray(op.mappings)) op.mappings.forEach((map) => roles.add(requireId(object(map).roleId)))
    }
    if (family === "tickets") {
        const current =
            typeof op.name === "string"
                ? await ctx.db
                      .query("ticketCategories")
                      .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("config.name", String(op.name)))
                      .unique()
                : null
        const fields = op.type === "category-create" ? op : patch
        if (["category-create", "category-update"].includes(String(op.type))) {
            target.parentId =
                fields.parentId === undefined
                    ? (current?.config.parentId ?? null)
                    : fields.parentId === null
                      ? null
                      : requireId(fields.parentId)
            add(fields.supportRoleIds ?? current?.config.supportRoleIds ?? [], roles)
        }
    }
    if (family === "greetings" && !configurationCritical(family, raw)) {
        const row = await ctx.db
                .query("greetingSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique(),
            route = String(op.route) as "welcome" | "dm" | "goodbye",
            saved = row?.config.routes[route]
        if (op.type === "configure" || (op.type === "module" && op.enabled === true)) {
            if (op.channelId || saved?.channelId) target.channelId = requireId(op.channelId ?? saved?.channelId)
            const templateName = op.templateName ?? saved?.templateName
            // A saved route posts what the greeting itself sends: its template's latest content while that is valid for the
            // route, otherwise the copy saved with it. A newly chosen template is checked as it is, and configuring validates it
            const content =
                saved?.content &&
                (op.type === "module" ||
                    (saved.templateName === String(templateName).trim().toLowerCase() &&
                        saved.templateRevision === op.expectedTemplateRevision))
                    ? (await followedTemplate(ctx, serverId, route, { ...saved, content: saved.content })).content
                    : ((templateName ? await currentTemplate(ctx, serverId, String(templateName)) : null)?.content ??
                      saved?.content)
            if (templateName || content) target.hasEmbed = !!content?.embed
        }
    }
    if (
        ["events", "schedules", "milestones", "suggestions", "cleanup"].includes(family) &&
        !configurationCritical(family, raw) &&
        op.type !== "settings" &&
        op.type !== "module" &&
        !(family === "cleanup" && op.type === "exclude")
    ) {
        let saved: {
            ownerId?: string
            channelId?: string
            template?: { name: string; revision: number }
            content?: { embed?: unknown }
            configured?: boolean
        } | null = null
        if (family === "events" && op.eventNo !== undefined)
            saved = await ctx.db
                .query("events")
                .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("eventNo", Number(op.eventNo)))
                .unique()
        if (family === "schedules" && op.scheduleNo !== undefined)
            saved = await ctx.db
                .query("schedules")
                .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("scheduleNo", Number(op.scheduleNo)))
                .unique()
        const milestone =
            family === "milestones"
                ? await ctx.db
                      .query("milestoneRoutes")
                      .withIndex("by_kind", (q) =>
                          q.eq("serverId", serverId).eq("kind", op.kind as "birthday" | "anniversary"),
                      )
                      .unique()
                : null
        if (milestone) saved = milestone
        if (family === "suggestions")
            saved = await ctx.db
                .query("suggestionSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
        if (family === "cleanup")
            saved = await ctx.db
                .query("cleanupPolicies")
                .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", String(op.channelId)))
                .unique()
        if (op.ownerId ?? saved?.ownerId) target.ownerId = requireId(op.ownerId ?? saved?.ownerId)
        if (op.channelId ?? saved?.channelId) target.channelId = requireId(op.channelId ?? saved?.channelId)
        target.hasEmbed = family !== "cleanup"
        // Schedules and celebrations may post plain text, so they need Embed links only for content with an embed: the
        // chosen template or draft when the operation binds a new one, otherwise the content saved with the schedule or route
        if (family === "schedules") {
            const source = (["create", "content"].includes(String(op.type)) && op.source) as
                { kind: PublishingKind; name: string; revision: number } | false
            const kept =
                source &&
                saved?.configured === true &&
                saved.template?.name === source.name &&
                saved.template.revision === source.revision
            const content =
                source && !kept
                    ? (
                          await ctx.db
                              .query("publishingDrafts")
                              .withIndex("by_server_kind_name", (q) =>
                                  q.eq("serverId", serverId).eq("kind", source.kind).eq("name", source.name),
                              )
                              .unique()
                      )?.content
                    : saved?.content
            target.hasEmbed = !content || content.embed !== undefined
        }
        // A saved route posts what the celebration itself sends: its template's latest content while that is valid for the
        // kind, otherwise the copy saved with the route. A newly chosen template is checked as it is, and configuring validates it
        if (family === "milestones") {
            const chosen = op.type === "configure" ? object(op.template) : undefined,
                keeps =
                    milestone?.configured &&
                    (!chosen ||
                        (milestone.template.name === String(chosen.name).trim().toLowerCase() &&
                            milestone.template.revision === chosen.revision))
            const content = keeps
                ? (await followedMilestoneTemplate(ctx, serverId, milestone.kind, milestone)).content
                : ((chosen ? await currentTemplate(ctx, serverId, String(chosen.name)) : null)?.content ??
                  saved?.content)
            target.hasEmbed = !content || content.embed !== undefined
        }
    }
    if (family === "voice") {
        if (op.type === "generator-set") {
            channels.add(requireId(op.channelId))
            if (typeof patch.categoryId === "string") channels.add(requireId(patch.categoryId))
        }
        if (op.type === "generator-add" && typeof op.categoryId === "string") channels.add(requireId(op.categoryId))
    }
    if (family === "sticky" && op.type === "set") channels.add(requireId(op.channelId))
    if (family === "youtube" && op.type === "add") channels.add(requireId(op.channelId))
    if (family === "lfg")
        for (const key of ["channelId", "generatorChannelId"])
            if (typeof patch[key] === "string") channels.add(requireId(patch[key]))
    if (family === "sidebar" && op.type === "add" && typeof op.categoryId === "string")
        channels.add(requireId(op.categoryId))
    if (family === "memberlist") add(op.roleIds, roles)
    if (family === "showcase" || family === "profile") {
        if (typeof op.channelId === "string") channels.add(requireId(op.channelId))
        add(op.allowRoleIds, roles)
        add(op.blockRoleIds, roles)
    }
    if (family === "helpdesk") {
        if (op.type === "forum-add") channels.add(requireId(op.channelId))
        if (typeof op.guardChannelId === "string") channels.add(requireId(op.guardChannelId))
    }
    if (family === "onboarding") {
        if (op.type === "role" && op.roleId !== null) roles.add(requireId(op.roleId))
        if (Array.isArray(op.steps))
            op.steps.forEach((step) => {
                const row = object(step)
                if (row.type === "link") channels.add(requireId(row.channelId))
            })
    }
    if (
        op.type === "policy-delete" ||
        op.type === "forget" ||
        (family === "moderation" && patch.defcon !== undefined) ||
        (family === "memberlist" && op.type === "reset") ||
        family === "onboarding" ||
        family === "presets" ||
        // An alert action spends NeonFlux's own permissions, so only the owner or an Administrator turns one on
        (family === "alerts" && op.type === "action" && op.enabled === true)
    )
        target.requiresOwnerAdmin = true
    if (channels.size) target.channelIds = [...channels]
    if (roles.size) target.roleIds = [...roles]
    return target
}
export async function configurationNativeOperation(
    ctx: MutationCtx,
    serverId: string,
    family: DashboardConfigurationFamily,
    value: unknown,
    input: DashboardConfigurationExecuteInput,
) {
    const raw = configurationOperation(family, value),
        op = { ...object(raw) },
        target = await configurationNativeTarget(ctx, serverId, family, raw)
    const who = actor(input.actor)
    if (who.userId !== input.actorId || !who.nativePermissionAuthorized || input.managerAuthorized !== true)
        fail(403, "Fresh manager authority required")
    if (target.requiresOwnerAdmin && !administrator(who)) fail(403, "Owner or Administrator permission required")
    // Only the server owner chooses who may view private cases
    if (family === "moderation" && op.type === "private-role" && !who.isOwner) fail(403, "Owner permission required")
    const proofs = input.references ?? []
    for (const [type, ids] of [
        [
            "channel",
            [
                ...(target.channelIds ?? []),
                ...(target.channelId ? [target.channelId] : []),
                ...(target.parentId ? [target.parentId] : []),
            ],
        ],
        ["role", target.roleIds ?? []],
    ] as const)
        for (const id of ids)
            if (
                !proofs.some(
                    (proof) =>
                        proof.id === id && proof.type === type && proof.serverId === serverId && proof.exists === true,
                )
            )
                fail(403, "Native configuration reference unavailable")
    let context:
        | ReturnType<typeof composerContext>
        | ReturnType<typeof cleanupContext>
        | ReturnType<typeof ticketContext>
        | undefined
    // The bot creates a dashboard generator's channel and returns it here. Other voice requests carry no native context
    // The same holds for the link channel of a dashboard link add request
    if (family === "voice" || family === "sidebar") {
        if (op.type === "generator-add" || op.type === "add")
            op.channelId = decode(
                family === "voice" ? VoiceDashboardContext : SidebarDashboardContext,
                input.context,
            ).channelId
        else if (input.context !== undefined) fail(400, "Unexpected native context")
    }
    // An invite refresh or revocation carries the page of invites the bot read afterwards, with their codes
    else if (family === "alerts" && (op.type === "invites-refresh" || op.type === "invite-revoke"))
        op.invites = alertInviteList(input.context, input.observedAt)
    else if (family === "tickets") {
        context = ticketContext(input.context)
        if (
            context.actor.userId !== input.actorId ||
            !context.botAuthorized ||
            (target.parentId && context.parentVerified !== true)
        )
            fail(403, "Ticket configuration authority mismatch")
    } else if (target.ownerId && target.channelId) {
        context = family === "cleanup" ? cleanupContext(input.context) : composerContext(input.context)
        if (
            context.actor.userId !== target.ownerId ||
            context.channelId !== target.channelId ||
            !administrator(context.actor) ||
            !context.actor.nativePermissionAuthorized ||
            !context.actorAuthorized ||
            !context.botAuthorized
        )
            fail(403, "Current action owner and destination required")
    } else if (
        ["events", "schedules", "milestones"].includes(family) &&
        target.channelId &&
        input.context !== undefined
    ) {
        context = composerContext(input.context)
        if (
            context.channelId !== target.channelId ||
            !administrator(context.actor) ||
            !context.actor.nativePermissionAuthorized ||
            !context.actorAuthorized ||
            !context.botAuthorized
        )
            fail(403, "Current administrator and destination required")
    } else if (family === "greetings" && target.channelId) {
        context = composerContext(input.context)
        if (context.actor.userId !== input.actorId || context.channelId !== target.channelId || !context.botAuthorized)
            fail(403, "Greeting destination unavailable")
    } else if (input.context !== undefined) fail(400, "Unexpected native context")
    if (family === "cleanup" && target.ownerId && target.channelId && context)
        await cleanupAuthority(
            ctx,
            serverId,
            context as ReturnType<typeof cleanupContext>,
            target.channelId,
            target.ownerId,
        )
    if (op.ownerId !== undefined) delete op.ownerId
    if (
        (family === "tickets" && ["category-create", "category-update"].includes(String(op.type))) ||
        (family === "leveling" && op.type === "mappings") ||
        (family === "rolepicker" && op.type === "menu-set") ||
        (family === "onboarding" && op.type === "role" && op.roleId !== null)
    )
        op.roles = input.roles
    else if (input.roles !== undefined) fail(400, "Unexpected native role snapshots")
    if (family === "rolepicker") op.display = input.display
    else if (input.display !== undefined) fail(400, "Unexpected role names")
    if (op.calendar !== undefined) {
        const desired = object(op.calendar),
            resolved =
                family === "events" ? validateEventCalendar(input.calendar) : validateScheduleCalendar(input.calendar)
        const { dates, ...civil } = resolved
        if (JSON.stringify(desired) !== JSON.stringify(civil)) {
            for (const key of Object.keys(desired))
                if (JSON.stringify(desired[key]) !== JSON.stringify((civil as unknown as Record<string, unknown>)[key]))
                    fail(403, "Resolved calendar intent mismatch")
        }
        op.calendar = resolved
    } else if (input.calendar !== undefined) fail(400, "Unexpected calendar proof")
    return { operation: family === "responses" ? raw : op, context }
}
