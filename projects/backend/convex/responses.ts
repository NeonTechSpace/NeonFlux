import { v } from "convex/values"
import type { ResponseDefinition, ResponseEvaluateResult, ResponseManageResult, ResponseManageRequest } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import {
    CLEANUP_BATCH, MAX_DEFINITIONS, PAGE_SIZE, RECEIPT_RETENTION, command, compareDefinitions, eligible, evaluateRequest, manageRequest, matches, render,
} from "./responseDomain.ts"
import { fail, object } from "./validation.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { readGeneral } from "./generalSettings.ts"
import { retentionPass } from "./retentionStore.ts"

export function definition(row: Doc<"responseDefinitions">): ResponseDefinition {
    return {
        kind: row.kind, name: row.name, reply: row.reply, ...(row.trigger ? { trigger: row.trigger } : {}),
        channelIds: row.channelIds, roleIds: row.roleIds, cooldownSeconds: row.cooldownSeconds,
        priority: row.priority, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt,
    }
}

async function settings(ctx: MutationCtx, serverId: string) {
    const existing = await ctx.db.query("responseSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (existing) return existing
    const id = await ctx.db.insert("responseSettings", { serverId, customEnabled: true, autoEnabled: true })
    return (await ctx.db.get(id))!
}

// Source dedup: a redelivered gateway message must not run a command or reply twice
async function reserve(ctx: MutationCtx, serverId: string, messageId: string, now: number) {
    const existing = await ctx.db.query("responseReceipts")
        .withIndex("by_server_message", q => q.eq("serverId", serverId).eq("messageId", messageId)).unique()
    if (existing) return false
    await ctx.db.insert("responseReceipts", { serverId, messageId, expiresAt: now + RECEIPT_RETENTION })
    return true
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ResponseManageResult> => {
        const now = Date.now()
        const input = manageRequest(request, now)
        if (!await reserve(ctx, input.serverId, input.messageId, now)) return { duplicate: true }
        if (["list", "show"].includes(input.operation.type)) return applyResponseManagement(ctx, input, now)
        return changeConfiguration(ctx, input.serverId, "responses", { kind: "chat", createdAt: input.createdAt, actor: { userId: input.actorId, source: "command" }, operation: input.operation },
            () => applyResponseManagement(ctx, input, now))
    },
})

// Most messages match nothing, so settings and the prefix decide which definitions could match before any is read, and
// only a reply reserves the message. A redelivered message that replied finds its receipt, or its cooldown, and stays silent
export const evaluate = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ResponseEvaluateResult> => {
        const now = Date.now()
        // Without role IDs the bot has not read the member. A candidate that could reply then asks for the member's current roles
        const rolesKnown = object(request).roleIds !== undefined
        const input = evaluateRequest(rolesKnown ? request : { ...object(request), roleIds: [] }, now)
        const state = await ctx.db.query("responseSettings").withIndex("by_server", q => q.eq("serverId", input.serverId)).unique()
        if (state && !state.customEnabled && !state.autoEnabled) return { send: false }
        const prefix = (await readGeneral(ctx, input.serverId))?.prefix ?? "!"
        // A command can only match the custom definition of its name, and other text only automatic responses
        const parsed = command(input.content, prefix)
        if (parsed ? !parsed.name || state?.customEnabled === false : state?.autoEnabled === false) return { send: false }
        const rows = parsed
            ? await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name", q => q.eq("serverId", input.serverId).eq("kind", "custom").eq("name", parsed.name)).take(MAX_DEFINITIONS)
            : await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name", q => q.eq("serverId", input.serverId).eq("kind", "auto")).take(MAX_DEFINITIONS)
        const candidates = rows.filter(row => eligible(rolesKnown ? definition(row) : { ...definition(row), roleIds: [] }, input)
            && matches(definition(row), input, prefix)).sort(compareDefinitions)
        for (const row of candidates) {
            const previous = await ctx.db.query("responseCooldowns")
                .withIndex("by_definition_user", q => q.eq("definitionId", row._id).eq("userId", input.userId)).unique()
            if (previous && previous.nextEligibleAt > now) continue
            if (!rolesKnown) return { send: false, memberRequired: true }
            const rendered = render(definition(row), input, prefix)
            if (!await reserve(ctx, input.serverId, input.messageId, now)) return parsed ? { send: false, defined: true } : { send: false }
            if (row.cooldownSeconds > 0) {
                const nextEligibleAt = now + row.cooldownSeconds * 1000
                if (previous) await ctx.db.patch(previous._id, { nextEligibleAt })
                else await ctx.db.insert("responseCooldowns", { serverId: input.serverId, definitionId: row._id, userId: input.userId, nextEligibleAt })
            } else if (previous) await ctx.db.delete(previous._id)
            return { send: true, messageId: input.messageId, ruleName: row.name, reply: rendered }
        }
        // A custom command that exists but cannot reply now still counts as known, so the bot suggests no built-in command for it
        return parsed && rows.length ? { send: false, defined: true } : { send: false }
    },
})

export async function cleanupResponses(ctx: MutationCtx, now: number) {
    const receipts = await ctx.db.query("responseReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(CLEANUP_BATCH)
    const cooldowns = await ctx.db.query("responseCooldowns").withIndex("by_expiry", q => q.lte("nextEligibleAt", now)).take(CLEANUP_BATCH)
    for (const row of [...receipts, ...cooldowns]) await ctx.db.delete(row._id)
    return { receiptsDeleted: receipts.length, cooldownsDeleted: cooldowns.length, more: receipts.length === CLEANUP_BATCH || cooldowns.length === CLEANUP_BATCH }
}

// One pass that continues itself while a batch is full. The cron runs it through the retention chain in retention.ts
export const cleanup = internalMutation({
    args: {},
    handler: async (ctx): Promise<{ receiptsDeleted: number, cooldownsDeleted: number }> => {
        const { more, ...result } = await retentionPass(ctx, cleanupResponses)
        if (more) await ctx.scheduler.runAfter(0, internal.responses.cleanup, {})
        return result
    },
})

export async function applyResponseManagement(ctx: MutationCtx, input: Pick<ResponseManageRequest, "serverId" | "kind" | "operation">, now: number): Promise<ResponseManageResult> {
    const state = await settings(ctx, input.serverId)
    const op = input.operation
    if (op.type === "module") {
        const revision = (input.kind === "custom" ? state.customRevision : state.autoRevision) ?? 0
        if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
        await ctx.db.patch(state._id, input.kind === "custom" ? { customEnabled: op.enabled, customRevision: revision + 1 } : { autoEnabled: op.enabled, autoRevision: revision + 1 })
        return { duplicate: false, type: "module", kind: input.kind, enabled: op.enabled }
    }
    const all = await ctx.db.query("responseDefinitions").withIndex("by_server", q => q.eq("serverId", input.serverId)).take(MAX_DEFINITIONS + 1)
    if (op.type === "list") {
        const rows = all.filter(row => row.kind === input.kind).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
        const page = op.page ?? 1
        if (page > totalPages) fail(400, "Invalid request")
        return {
            duplicate: false, type: "list", kind: input.kind, page, totalPages, total: rows.length,
            moduleEnabled: input.kind === "custom" ? state.customEnabled : state.autoEnabled,
            definitions: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(definition),
        }
    }
    const existing = all.find(row => row.kind === input.kind && row.name === op.name)
    if (op.type === "create") {
        if (existing) fail(409, "Definition already exists")
        if (all.length >= MAX_DEFINITIONS) fail(429, "Definition limit reached")
        const id = await ctx.db.insert("responseDefinitions", {
            serverId: input.serverId, kind: input.kind, name: op.name, reply: op.reply,
            ...("trigger" in op ? { trigger: op.trigger } : {}), channelIds: [], roleIds: [],
            cooldownSeconds: 5, priority: 0, enabled: true, createdAt: now, updatedAt: now,
        })
        return { duplicate: false, type: "definition", definition: definition((await ctx.db.get(id))!) }
    }
    if (!existing) fail(404, "Definition not found")
    if (op.type === "show") return { duplicate: false, type: "definition", definition: definition(existing) }
    if (op.type === "delete") {
        // Cooldowns of a deleted definition expire through cleanup
        await ctx.db.delete(existing._id)
        return { duplicate: false, type: "deleted", kind: input.kind, name: existing.name }
    }
    if (op.type === "enable" || op.type === "disable") {
        await ctx.db.patch(existing._id, { enabled: op.type === "enable", updatedAt: now })
    } else if (op.type === "update") {
        const patch = op.field === "response" ? { reply: op.reply }
            : op.field === "channels" ? { channelIds: op.channelIds }
                : op.field === "roles" ? { roleIds: op.roleIds }
                    : op.field === "cooldown" ? { cooldownSeconds: op.cooldownSeconds }
                        : op.field === "trigger" ? { trigger: op.trigger } : { priority: op.priority }
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now })
    }
    return { duplicate: false, type: "definition", definition: definition((await ctx.db.get(existing._id))!) }
}
