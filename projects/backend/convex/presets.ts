import { v } from "convex/values"
import type { PresetApplyResult, PresetChange, PresetFamily, PresetPlan, PresetPlansResult } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { changeConfiguration, type ConfigurationChange } from "./configurationChange.ts"
import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { shape } from "./publishingDomain.ts"
import { config, readSettings } from "./moderationStore.ts"
import { applyModerationConfiguration } from "./moderation.ts"
import { readLeveling } from "./levelingStore.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { applyLevelingConfiguration } from "./leveling.ts"
import { readTicketSettings } from "./ticketStore.ts"
import { defaultTickets } from "./ticketDomain.ts"
import { applyTicketConfiguration } from "./tickets.ts"
import { eventSettings } from "./eventsStore.ts"
import { applyEventsManagement } from "./events.ts"
import { rolesAdmin } from "./rolesStore.ts"
import { presetDefinition, previewToken, PRESETS, ruleText, settingLabel, shown, type PresetDefinition } from "./presetsDomain.ts"
import { fail, requireId, requireServer, source, token as previewCode } from "./validation.ts"

type Read = QueryCtx | MutationCtx
type Work = Partial<Record<PresetFamily, Array<Record<string, unknown>>>>

/** What applying a preset changes now, from the current values, and the family operations that make those changes */
async function presetWork(ctx: Read, serverId: string, preset: PresetDefinition): Promise<{ plan: PresetPlan, work: Work }> {
    const changes: PresetChange[] = [], work: Work = {}
    const change = (family: PresetFamily, setting: string, from: unknown, to: unknown) => changes.push({ family, setting, from: shown(from), to: shown(to) })
    const operation = (family: PresetFamily, op: Record<string, unknown>) => { (work[family] ??= []).push(op) }
    // The fields of desired that differ from current, with one change each
    const differing = (family: PresetFamily, current: Record<string, unknown>, desired: Record<string, unknown>) => {
        const patch: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(desired)) if (current[key] !== value) { patch[key] = value; change(family, settingLabel(family, key), current[key], value) }
        return Object.keys(patch).length ? patch : undefined
    }
    if (preset.moderation) {
        const patch = differing("moderation", config(await readSettings(ctx, serverId)), preset.moderation)
        if (patch) operation("moderation", { type: "settings", patch })
    }
    for (const spec of preset.rules ?? []) {
        const row = await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", spec.name)).unique()
        const desired = { enabled: true, action: spec.action, threshold: spec.threshold, windowSeconds: spec.windowSeconds, durationSeconds: spec.durationSeconds }
        if (!row) {
            operation("moderation", { type: "rule-create", rule: { ...spec, ...desired, priority: 0, patterns: [], domainMode: "block", channelIds: [], exemptChannelIds: [], exemptRoleIds: [] } })
            change("moderation", `rule ${spec.name}`, "none", ruleText(spec))
            continue
        }
        // A rule of another type under the same name is the manager's own and stays as it is
        if (row.rule.type !== spec.type) continue
        const patch = Object.fromEntries(Object.entries(desired).filter(([key, value]) => row.rule[key as keyof typeof desired] !== value))
        if (!Object.keys(patch).length) continue
        operation("moderation", { type: "rule-update", name: spec.name, patch })
        change("moderation", `rule ${spec.name}`, ruleText(row.rule), ruleText({ ...row.rule, ...desired }))
    }
    if (preset.leveling) {
        const current = (await readLeveling(ctx, serverId))?.config ?? defaultLevelingSettings(), patch = differing("leveling", current, preset.leveling)
        if (patch) operation("leveling", { type: "settings", expectedRevision: current.revision, patch })
    }
    if (preset.tickets) {
        const patch = differing("tickets", (await readTicketSettings(ctx, serverId))?.config ?? defaultTickets(), preset.tickets)
        if (patch) operation("tickets", { type: "settings", ...patch })
    }
    if (preset.events) {
        const row = await eventSettings(ctx, serverId)
        if (differing("events", { enabled: row?.enabled ?? false }, preset.events)) operation("events", { type: "settings", expectedRevision: row?.revision ?? 1, enabled: preset.events.enabled })
    }
    return { plan: { name: preset.name, kind: preset.kind, description: preset.description, changes, token: previewToken(preset.name, changes) }, work }
}
export async function presetPlans(ctx: Read, serverId: string) {
    const plans: PresetPlan[] = []
    for (const preset of PRESETS) plans.push((await presetWork(ctx, serverId, preset)).plan)
    return plans
}

/**
 * Applies a preset whose preview the manager confirmed. Each changed family goes through its own configuration change, so the audit log
 * records every family. A preset only sets the values it names and adds or updates its own automod rules. It deletes nothing
 */
export async function applyPreset(ctx: MutationCtx, identity: ConfigurationIdentity, name: unknown, code: unknown, change: Omit<ConfigurationChange, "operation">) {
    const preset = presetDefinition(name), { plan, work } = await presetWork(ctx, identity.serverId, preset), now = Date.now()
    if (plan.token !== previewCode(code)) fail(409, "Settings changed since this preview")
    for (const [family, ops] of Object.entries(work) as Array<[PresetFamily, Array<Record<string, unknown>>]>) {
        await changeConfiguration(ctx, identity.serverId, family, { ...change, operation: { type: "preset", name: preset.name } }, async () => {
            for (const op of ops) {
                if (family === "moderation") await applyModerationConfiguration(ctx, identity.serverId, op, now)
                else if (family === "leveling") await applyLevelingConfiguration(ctx, identity.serverId, op, now)
                else if (family === "tickets") await applyTicketConfiguration(ctx, identity.serverId, op)
                else await applyEventsManagement(ctx, identity, undefined, op, now)
            }
        })
    }
    return plan
}

export const plans = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<PresetPlansResult> => {
    const serverId = requireId(shape(request, ["serverId"], ["serverId"]).serverId); requireServer(serverId)
    return { presets: await presetPlans(ctx, serverId) }
} })

// Presets change automod and security settings, so applying one needs the owner or an Administrator, like those settings
export const apply = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<PresetApplyResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "name", "token"], ["serverId", "messageId", "createdAt", "actor", "name", "token"])
    const identity = source(input, Date.now()), who = await rolesAdmin(ctx, identity.serverId, input.actor)
    const plan = await applyPreset(ctx, { serverId: identity.serverId, actorId: who.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, input.name, input.token,
        { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" } })
    return { plan }
} })
