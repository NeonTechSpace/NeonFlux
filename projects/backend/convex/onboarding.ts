import { v } from "convex/values"
import type { OnboardingOperation, OnboardingProgress, OnboardingSettings, OnboardingStep, OnboardingStepState, OnboardingView, PublishingContent, RolesEvaluateResult, RolesMemberContext } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { shape } from "./publishingDomain.ts"
import { readGeneral } from "./generalSettings.ts"
import { countOnboarded } from "./analytics.ts"
import { ensureOwner, desiredReference, grantEligibility, reserveRole, rolePolicy } from "./roleClaims.ts"
import { readRolesSettings, rolesAcknowledgment, rolesAdmin } from "./rolesStore.ts"
import { defaultRolesSettings, evaluationKey, memberContext, roleSnapshots, safeRole } from "./rolesDomain.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { defaultOnboarding, ONBOARDING_ROLE_KEY, onboardingOperation, onboardingSteps } from "./onboardingDomain.ts"
import { completionRow, onboardingRow, onboardingSource, readOnboarding } from "./onboardingStore.ts"
import { fail, requireId, requireServer, source } from "./validation.ts"

type Read = QueryCtx | MutationCtx
type Member = { userId: string, joinedAt: string, roleIds: string[] }
/** A step as a member sees it. unavailable steps, such as a panel that is not published, are left out of what members see */
type StepView = { step: OnboardingStep, text: string, state: OnboardingStepState | "unavailable", roleIds: string[] }

// Each step reads the feature that finishes it. Without a member every step that needs finishing is open
async function stepViews(ctx: Read, serverId: string, settings: OnboardingSettings, member?: Member): Promise<StepView[]> {
    const roles = (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings(), picker = await readRolePicker(ctx, serverId)
    const held = (roleIds: string[]): OnboardingStepState => member && roleIds.some(id => member.roleIds.includes(id)) ? "done" : "open"
    const views: StepView[] = []
    for (const step of settings.steps) {
        if (step.type === "link") { views.push({ step, text: `<#${step.channelId}> ${step.text}`, state: "info", roleIds: [] }); continue }
        if (step.type === "menu") {
            const menu = picker.enabled ? picker.menus.find(row => row.name === step.name && row.roleIds.length) : undefined
            views.push(menu ? { step, text: `Choose your ${step.name} roles in the role picker on the NeonFlux website`, state: held(menu.roleIds), roleIds: menu.roleIds }
                : { step, text: step.name, state: "unavailable", roleIds: [] })
            continue
        }
        const panel = step.type === "rules" ? await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", serverId).eq("kind", "verification")).unique()
            : await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", step.name)).unique()
        const usable = step.type === "rules" ? roles.verificationEnabled : panel?.kind === "reaction" && roles.panelsEnabled
        const published = usable && panel?.enabled && !panel.withdrawing ? panel.published : undefined
        if (!published) { views.push({ step, text: step.type, state: "unavailable", roleIds: [] }); continue }
        const roleIds = published.mappings.map(mapping => mapping.roleId)
        if (step.type === "panel") { views.push({ step, text: `Pick your ${step.name} roles in <#${published.channelId}>`, state: held(roleIds), roleIds }); continue }
        const accepted = member ? (await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds)).acknowledged : false
        views.push({ step, text: `Accept the server rules in <#${published.channelId}>`, state: accepted ? "done" : "open", roleIds })
    }
    return views
}
const finished = (views: StepView[]) => views.some(view => view.state === "done") && views.every(view => view.state !== "open")

async function onboardingView(ctx: Read, serverId: string): Promise<OnboardingView> {
    const settings = await readOnboarding(ctx, serverId), views = await stepViews(ctx, serverId, settings)
    return { revision: await configurationRevision(ctx, serverId, "onboarding"), settings, roleSteps: views.filter(view => view.state === "open").map(view => view.roleIds) }
}

/** The checklist a new member receives with the greeting of the configured route, or nothing while onboarding is off or has no step to show */
export async function onboardingChecklist(ctx: Read, serverId: string, route: "welcome" | "dm" | "goodbye") {
    const settings = await readOnboarding(ctx, serverId)
    if (!settings.enabled || settings.delivery !== route) return undefined
    const views = (await stepViews(ctx, serverId, settings)).filter(view => view.state !== "unavailable")
    if (!views.length) return undefined
    const prefix = (await readGeneral(ctx, serverId))?.prefix ?? "!"
    return { list: ["**Getting started**", ...views.map((view, index) => `${index + 1}. ${view.text}`)].join("\n"), hint: `Send ${prefix}onboarding in the server to see what is left` }
}
/** Adds the checklist after the greeting text. When it does not fit one message, only the hint is added, and nothing when even that does not fit */
export function withChecklist(content: PublishingContent, checklist: { list: string, hint: string } | undefined): PublishingContent {
    if (!checklist) return content
    for (const addition of [`${checklist.list}\n${checklist.hint}`, checklist.hint]) {
        const next = content.content ? `${content.content}\n\n${addition}` : addition
        if (next.length <= 2000) return { ...content, content: next }
    }
    return content
}

async function stepAvailable(ctx: Read, serverId: string, step: OnboardingStep) {
    if (step.type === "panel" && (await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", step.name)).unique())?.kind !== "reaction") fail(404, `No reaction role panel is named ${step.name}`)
    if (step.type === "menu" && !(await readRolePicker(ctx, serverId)).menus.some(menu => menu.name === step.name)) fail(404, `No role picker menu is named ${step.name}`)
}
// Chat and dashboard saves share these rules. The completion role passes the self-service role rules on fresh snapshots
async function applyOnboarding(ctx: MutationCtx, serverId: string, op: OnboardingOperation, roles: unknown) {
    const row = await onboardingRow(ctx, serverId), settings = row ? await readOnboarding(ctx, serverId) : defaultOnboarding()
    switch (op.type) {
        case "module": settings.enabled = op.enabled; break
        case "delivery": settings.delivery = op.delivery; break
        case "step-add": await stepAvailable(ctx, serverId, op.step); settings.steps = onboardingSteps([...settings.steps, op.step]); break
        case "step-remove": if (op.position > settings.steps.length) fail(404, "No step has that position"); settings.steps = settings.steps.filter((_, index) => index !== op.position - 1); break
        case "steps": for (const step of op.steps) await stepAvailable(ctx, serverId, step); settings.steps = op.steps; break
        case "role":
            if (op.roleId !== null) safeRole(serverId, op.roleId, roleSnapshots(roles), (await rolePolicy(ctx, serverId)).staffRoleIds, true)
            settings.completionRoleId = op.roleId
            break
    }
    if (row) await ctx.db.patch(row._id, settings)
    else await ctx.db.insert("onboardingSettings", { serverId, ...settings })
}
// Dashboard execute bumps the family revision after this, with the role snapshots the bot read for a completion role
export async function applyOnboardingConfiguration(ctx: MutationCtx, serverId: string, value: Record<string, unknown>) {
    const { roles, ...operation } = value
    await applyOnboarding(ctx, serverId, onboardingOperation(operation), roles)
    return {}
}

// The bot keeps this in memory and reads it again after its own changes and every ten minutes
export const get = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<OnboardingView> => {
    const serverId = requireId(shape(request, ["serverId"], ["serverId"]).serverId); requireServer(serverId)
    return onboardingView(ctx, serverId)
} })

// Like other role settings, the checklist needs the owner or an Administrator. Turning it off still works at DEFCON 1
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<OnboardingView> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "roles", "operation"], ["serverId", "messageId", "createdAt", "actor", "operation"])
    const identity = source(input, Date.now()), op = onboardingOperation(input.operation)
    const who = await rolesAdmin(ctx, identity.serverId, input.actor, op.type === "module" && !op.enabled)
    await changeConfiguration(ctx, identity.serverId, "onboarding", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        () => applyOnboarding(ctx, identity.serverId, op, input.roles))
    return onboardingView(ctx, identity.serverId)
} })

/**
 * A member's progress from the features' own records, read fresh by the bot. The first time every step is done during a membership the
 * completion is recorded once and counted for analytics. grant names the completion role change while the member lacks the role and no earlier
 * change for this completion succeeded or is unconfirmed, so an unconfirmed change is never repeated
 */
export const member = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<OnboardingProgress> => {
    const input = shape(request, ["serverId", "context"], ["serverId", "context"]), serverId = requireId(input.serverId); requireServer(serverId)
    const who = memberContext(input.context), now = Date.now(), settings = await readOnboarding(ctx, serverId)
    const views = await stepViews(ctx, serverId, settings, who)
    let completion = await completionRow(ctx, serverId, who)
    if (settings.enabled && !who.isBot && !completion && finished(views)) {
        completion = (await ctx.db.get(await ctx.db.insert("onboardingCompletions", { serverId, userId: who.userId, joinedAt: who.joinedAt, completedAt: now })))!
        await countOnboarded(ctx, serverId, now)
    }
    const roleId = settings.completionRoleId, sourceId = completion ? onboardingSource(completion) : undefined
    const tried = sourceId ? await ctx.db.query("roleAttempts").withIndex("by_source", q => q.eq("serverId", serverId).eq("sourceId", sourceId)).order("desc").first() : null
    return { enabled: settings.enabled, steps: views.filter(view => view.state !== "unavailable").map(view => ({ text: view.text, state: view.state as OnboardingStepState })),
        complete: Boolean(completion), ...(completion ? { completedAt: completion.completedAt } : {}),
        ...(settings.enabled && sourceId && roleId && !who.roleIds.includes(roleId) && (!tried || tried.outcome === "failed") ? { grant: { sourceId, roleId } } : {}) }
} })

/** Adds the completion role through the shared role ownership. Onboarding never removes it, so changing the role later keeps the old one */
export async function evaluateOnboardingRole(ctx: MutationCtx, identity: { serverId: string, sourceId: string }, member: RolesMemberContext, operation: { type: "onboarding", roleId: string }): Promise<RolesEvaluateResult> {
    const now = Date.now(), { serverId, sourceId } = identity, roleId = operation.roleId
    const completion = await completionRow(ctx, serverId, member), settings = await readOnboarding(ctx, serverId)
    if (!completion || onboardingSource(completion) !== sourceId || !settings.enabled || settings.completionRoleId !== roleId) fail(409, "Onboarding completion changed")
    const result = async (status: RolesEvaluateResult["status"], duplicate = false): Promise<RolesEvaluateResult> =>
        ({ duplicate, status, acknowledgment: await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds) })
    const previous = await ctx.db.query("roleAttempts").withIndex("by_source", q => q.eq("serverId", serverId).eq("sourceId", sourceId)).order("desc").first()
    // A role change Fluxer refused or that was never sent may be tried again. Any other earlier attempt settles this completion
    if (previous && previous.outcome !== "failed") return result(previous.outcome === "succeeded" ? "unchanged" : "blocked", true)
    await grantEligibility(ctx, serverId, member, ONBOARDING_ROLE_KEY, roleId)
    const owner = await ensureOwner(ctx, serverId, member, roleId, now)
    await ctx.db.patch(owner._id, { intentSourceId: sourceId })
    await desiredReference(ctx, serverId, owner, ONBOARDING_ROLE_KEY, true, now)
    if (owner.status !== "idle") return result("blocked")
    if (member.roleIds.includes(roleId)) return result("unchanged")
    const grant = await reserveRole(ctx, serverId, member, owner, ONBOARDING_ROLE_KEY, "add", sourceId, now, evaluationKey(operation))
    return { ...await result("reserved"), grant }
}
