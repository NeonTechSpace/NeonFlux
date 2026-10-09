import { v } from "convex/values"
import type { ResponseDefinition, ResponseEvaluateResult, ResponseManageResult, ResponseManageRequest } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import {
    CLEANUP_BATCH, MAX_DEFINITIONS, PAGE_SIZE, RECEIPT_RETENTION, compareDefinitions, eligible, evaluateRequest, manageRequest, matches, render,
} from "./responseDomain.ts"
import { fail } from "./validation.ts"
import { bumpConfigurationRevision } from "./configurationRevision.ts"
import { readGeneral } from "./generalSettings.ts"

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
        const result = await applyResponseManagement(ctx, input, now)
        if (!["list", "show"].includes(input.operation.type)) await bumpConfigurationRevision(ctx, input.serverId, "responses", { kind: "chat", createdAt: input.createdAt })
        return result
    },
})

export const evaluate = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ResponseEvaluateResult> => {
        const now = Date.now()
        const input = evaluateRequest(request, now)
        if (!await reserve(ctx, input.serverId, input.messageId, now)) return { send: false }
        const state = await settings(ctx, input.serverId)
        const rows = await ctx.db.query("responseDefinitions").withIndex("by_server", q => q.eq("serverId", input.serverId)).take(MAX_DEFINITIONS)
        const prefix = (await readGeneral(ctx, input.serverId))?.prefix ?? "!"
        const candidates = rows.filter(row => (row.kind === "custom" ? state.customEnabled : state.autoEnabled)
            && eligible(definition(row), input) && matches(definition(row), input, prefix)).sort(compareDefinitions)
        for (const row of candidates) {
            const previous = await ctx.db.query("responseCooldowns")
                .withIndex("by_definition_user", q => q.eq("definitionId", row._id).eq("userId", input.userId)).unique()
            if (previous && previous.nextEligibleAt > now) continue
            const rendered = render(definition(row), input, prefix)
            if (row.cooldownSeconds > 0) {
                const nextEligibleAt = now + row.cooldownSeconds * 1000
                if (previous) await ctx.db.patch(previous._id, { nextEligibleAt })
                else await ctx.db.insert("responseCooldowns", { serverId: input.serverId, definitionId: row._id, userId: input.userId, nextEligibleAt })
            } else if (previous) await ctx.db.delete(previous._id)
            return { send: true, messageId: input.messageId, ruleName: row.name, reply: rendered }
        }
        return { send: false }
    },
})

export const cleanup = internalMutation({
    args: {},
    handler: async (ctx): Promise<{ receiptsDeleted: number, cooldownsDeleted: number }> => {
        const now = Date.now()
        const receipts = await ctx.db.query("responseReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(CLEANUP_BATCH)
        const cooldowns = await ctx.db.query("responseCooldowns").withIndex("by_expiry", q => q.lte("nextEligibleAt", now)).take(CLEANUP_BATCH)
        for (const row of [...receipts, ...cooldowns]) await ctx.db.delete(row._id)
        if (receipts.length === CLEANUP_BATCH || cooldowns.length === CLEANUP_BATCH) {
            await ctx.scheduler.runAfter(0, internal.responses.cleanup, {})
        }
        return { receiptsDeleted: receipts.length, cooldownsDeleted: cooldowns.length }
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
