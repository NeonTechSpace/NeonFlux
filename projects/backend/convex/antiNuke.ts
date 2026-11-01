import { v } from "convex/values"
import {
    ANTI_NUKE_INCIDENT_LIMIT,
    ANTI_NUKE_INCIDENT_PAGE,
    ANTI_NUKE_TRUST_LIMIT,
    AntiNukeFinishRequest,
    AntiNukeGetRequest,
    AntiNukeIncidentsRequest,
    AntiNukeManageRequest,
    AntiNukeObserveRequest,
    AntiNukeOpenRequest,
    antiNukeRestorable,
    defaultAntiNukeSettings,
    type AntiNukeDashboardOperation,
    type AntiNukeOperation,
    type AntiNukeFinishResult,
    type AntiNukeIncident,
    type AntiNukeIncidentsResult,
    type AntiNukeObserveResult,
    type AntiNukeOpenResult,
    type AntiNukeResult,
    type AntiNukeRestoreResult,
    type AntiNukeRule,
    type AntiNukeSettings,
    type AntiNukeView,
} from "@neonflux/contracts/anti-nuke"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { incidentRecordFields } from "./antiNukeDomain.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { admitSecurityRecord } from "./lockdownStore.ts"
import { config as moderationConfig, readSettings as readModeration, requireAdministrator } from "./moderationStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source } from "./validation.ts"

// A new incident for the same account this soon does not act twice, matching the detector's cooldown
const INCIDENT_WINDOW_MS = 300000
// Incidents a startup checks at once. A stopped process leaves at most a handful, and the next startup checks the rest
const OBSERVE_BATCH = 100
// Incidents one account can reach within that window: Its alert and the one response that follows
const INCIDENT_WINDOW_ROWS = 3

type Read = QueryCtx | MutationCtx
export const readAntiNuke = (ctx: Read, serverId: string) =>
    ctx.db
        .query("antiNukeSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const publicAntiNuke = (row: Doc<"antiNukeSettings"> | null): AntiNukeSettings =>
    row
        ? {
              enabled: row.enabled,
              mode: row.mode,
              limits: row.limits,
              response: row.response,
              lockdown: row.lockdown,
              trustedIds: row.trustedIds,
          }
        : defaultAntiNukeSettings()
const publicIncident = (row: Doc<"antiNukeIncidents">): AntiNukeIncident => ({
    incidentNo: row.incidentNo,
    actorId: row.actorId,
    actorKind: row.actorKind,
    rule: row.rule as AntiNukeRule,
    counts: row.counts,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
    mode: row.mode,
    response: row.response,
    outcome: row.outcome,
    removedRoleIds: row.removedRoleIds,
    lockdown: row.lockdown,
    ...(row.restoredAt !== undefined ? { restoredAt: row.restoredAt } : {}),
    ...(row.restoredBy ? { restoredBy: row.restoredBy } : {}),
    ...(row.restoreOutcome ? { restoreOutcome: row.restoreOutcome } : {}),
    ...(row.restoreLeftRoleIds?.length ? { restoreLeftRoleIds: row.restoreLeftRoleIds } : {}),
    ...(row.restoreGoneRoleIds?.length ? { restoreGoneRoleIds: row.restoreGoneRoleIds } : {}),
    createdAt: row.createdAt,
})
const incidentByNo = (ctx: Read, serverId: string, incidentNo: number) =>
    ctx.db
        .query("antiNukeIncidents")
        .withIndex("by_server_number", (q) => q.eq("serverId", serverId).eq("incidentNo", incidentNo))
        .unique()
/**
 * The settings section's view. Incidents name accounts, which chat shows only to the owner and Administrators, so every website manager gets
 * only their counts. A server keeps at most 200, so counting the unconfirmed is bounded
 */
export async function antiNukeView(ctx: Read, serverId: string): Promise<AntiNukeView> {
    const row = await readAntiNuke(ctx, serverId)
    const unconfirmed = await ctx.db
        .query("antiNukeIncidents")
        .withIndex("by_server_outcome", (q) => q.eq("serverId", serverId).eq("outcome", "uncertain"))
        .take(ANTI_NUKE_INCIDENT_LIMIT)
    return {
        settings: publicAntiNuke(row),
        incidentCount: Math.min(Math.max(0, (row?.nextIncidentNo ?? 1) - 1), ANTI_NUKE_INCIDENT_LIMIT),
        unconfirmedCount: unconfirmed.length,
    }
}
/** A page of incidents for Private cases, newest first */
export async function antiNukeIncidentPage(ctx: Read, serverId: string, before: number, size: number) {
    const rows = await ctx.db
        .query("antiNukeIncidents")
        .withIndex("by_server_number", (q) => q.eq("serverId", serverId).lt("incidentNo", before))
        .order("desc")
        .take(size + 1)
    return {
        incidents: rows.slice(0, size).map(publicIncident),
        ...(rows.length > size ? { nextBeforeIncidentNo: rows[size - 1]!.incidentNo } : {}),
    }
}

// The bot reads the settings once when a server starts and keeps them in memory, so audit entries of a server with the module off cost no backend call
export const get = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AntiNukeResult> => ({
        settings: publicAntiNuke(await readAntiNuke(ctx, decode(AntiNukeGetRequest, request).serverId)),
    }),
})

/** Chat and dashboard share these rules. A restore carries what the bot read and did, since Fluxer holds the roles */
export async function applyAntiNukeManagement(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    op: (AntiNukeDashboardOperation | AntiNukeOperation) & { result?: AntiNukeRestoreResult },
): Promise<AntiNukeResult> {
    if (op.type === "restore") {
        if (!op.result) fail(400, "Restore result required")
        const incident = await incidentByNo(ctx, serverId, op.result.incidentNo)
        // The website names the incident, and chat the member
        if (!incident || ("userId" in op ? incident.actorId !== op.userId : op.incidentNo !== op.result.incidentNo))
            fail(404, "This member has no such incident")
        const now = Date.now()
        await ctx.db.patch(incident._id, {
            restoreOutcome: op.result.outcome,
            restoreLeftRoleIds: op.result.left ?? [],
            restoreGoneRoleIds: op.result.gone ?? [],
            ...(op.result.outcome === "succeeded" ? { restoredAt: now, restoredBy: actorId } : {}),
        })
        return { settings: publicAntiNuke(await readAntiNuke(ctx, serverId)) }
    }
    // The bot read the member before this request and recorded what it found, so only the audit log has more to do
    if (op.type === "settle") return { settings: publicAntiNuke(await readAntiNuke(ctx, serverId)) }
    const row = await readAntiNuke(ctx, serverId),
        settings = publicAntiNuke(row)
    let patch: Partial<AntiNukeSettings> = {}
    if (op.type === "module") patch = { enabled: op.enabled }
    else if (op.type === "mode") patch = { mode: op.mode }
    else if (op.type === "limit") patch = { limits: { ...settings.limits, [op.limit]: op.value } }
    else if (op.type === "response") patch = { response: op.response }
    else if (op.type === "lockdown") patch = { lockdown: op.enabled }
    else {
        const trustedIds =
            op.type === "trust-set"
                ? [...new Set(op.userIds)]
                : op.trusted
                  ? [...new Set([...settings.trustedIds, op.userId])]
                  : settings.trustedIds.filter((id) => id !== op.userId)
        if (trustedIds.length > ANTI_NUKE_TRUST_LIMIT)
            fail(429, `A server can trust at most ${ANTI_NUKE_TRUST_LIMIT} accounts`)
        patch = { trustedIds }
    }
    const fields = { ...patch, updatedAt: Date.now(), updatedBy: actorId }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert("antiNukeSettings", { serverId, ...settings, nextIncidentNo: 1, ...fields })
    return { settings: publicAntiNuke(await readAntiNuke(ctx, serverId)) }
}

/** A restore writes the settings whole, since they name nothing that must exist */
export async function restoreAntiNuke(ctx: MutationCtx, serverId: string, actorId: string, value: AntiNukeSettings) {
    const row = await readAntiNuke(ctx, serverId),
        fields = { ...value, updatedAt: Date.now(), updatedBy: actorId }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert("antiNukeSettings", { serverId, nextIncidentNo: 1, ...fields })
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AntiNukeResult> => {
        const input = decode(AntiNukeManageRequest, request),
            identity = source(input, Date.now()),
            op = input.operation
        // Turning protection down and giving roles back stay reachable for an Administrator at DEFCON 1
        const critical =
            op.type === "restore" ||
            ((op.type === "module" || op.type === "lockdown") && !op.enabled) ||
            (op.type === "mode" && op.mode === "dry-run")
        const who = await requireAdministrator(ctx, identity.serverId, input.actor, critical)
        return changeConfiguration(
            ctx,
            identity.serverId,
            "antinuke",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                // Every website manager reads the audit log, and an incident's account is private
                operation: op.type === "restore" ? { type: "restore", incidentNo: op.result.incidentNo } : op,
            },
            () => applyAntiNukeManagement(ctx, identity.serverId, who.userId, op),
        )
    },
})

/**
 * The bot claims an incident before it acts, so an account already reported within the window, on this process or the last, acts once. The
 * backend rechecks the settings, and a trusted account or dry-run only records. A server keeps its newest incidents
 */
export const open = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AntiNukeOpenResult> => {
        const { serverId, ...incident } = decode(AntiNukeOpenRequest, request),
            row = await readAntiNuke(ctx, serverId),
            now = Date.now()
        if (!row?.enabled) return { claimed: false }
        const recent = await ctx.db
            .query("antiNukeIncidents")
            .withIndex("by_server_actor", (q) =>
                q
                    .eq("serverId", serverId)
                    .eq("actorId", incident.actorId)
                    .gt("createdAt", now - INCIDENT_WINDOW_MS),
            )
            .take(INCIDENT_WINDOW_ROWS)
        const act =
            row.mode === "enforce" && incident.response !== "alert" && !row.trustedIds.includes(incident.actorId)
        // An earlier alert took nothing from the account, so it never keeps NeonFlux from acting on what comes next
        if (act ? recent.some((item) => item.response !== "alert") : recent.length > 0) return { claimed: false }
        const incidentNo = row.nextIncidentNo
        await ctx.db.patch(row._id, { nextIncidentNo: incidentNo + 1 })
        await ctx.db.insert("antiNukeIncidents", {
            serverId,
            incidentNo,
            ...incident,
            mode: row.mode,
            response: act ? incident.response : "alert",
            outcome: "pending",
            lockdown: "none",
            removedRoleIds: act ? incident.removedRoleIds : [],
            createdAt: now,
        })
        const oldest = await ctx.db
            .query("antiNukeIncidents")
            .withIndex("by_server_number", (q) => q.eq("serverId", serverId))
            .first()
        if (oldest && oldest.incidentNo <= incidentNo - ANTI_NUKE_INCIDENT_LIMIT) await ctx.db.delete(oldest._id)
        return { claimed: true, incidentNo, act, lockdown: row.mode === "enforce" && row.lockdown }
    },
})

const recordIncident = (ctx: MutationCtx, row: Doc<"antiNukeIncidents">) =>
    admitSecurityRecord(ctx, row.serverId, `anti-nuke:${row.incidentNo}:${row.outcome}`, {
        type: "anti-nuke-incident",
        resourceIds: [row.actorId],
        changedFields: incidentRecordFields(row),
    })

/** Records a claimed incident's outcome once with its security record. An uncertain incident settles from the bot's fresh read of the member */
export const finish = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AntiNukeFinishResult> => {
        const input = decode(AntiNukeFinishRequest, request),
            row = await incidentByNo(ctx, input.serverId, input.incidentNo)
        if (row?.outcome !== "pending" && row?.outcome !== "uncertain") return { recorded: false, admitted: false }
        const fields = { outcome: input.outcome, ...(input.lockdown ? { lockdown: input.lockdown } : {}) }
        await ctx.db.patch(row._id, fields)
        // Metadata logs start off, so the staff log hears of it too, once. A status settled later adds nothing
        if (row.outcome !== "pending") return { recorded: true, admitted: false }
        const logChannelId = moderationConfig(await readModeration(ctx, input.serverId)).logChannelId
        return {
            recorded: true,
            admitted: await recordIncident(ctx, { ...row, ...fields }),
            ...(logChannelId ? { logChannelId } : {}),
        }
    },
})

/** At startup, an incident the previous process claimed but never finished may or may not have acted, so it becomes uncertain */
export const observe = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AntiNukeObserveResult> => {
        const { serverId } = decode(AntiNukeObserveRequest, request)
        const rows = await ctx.db
            .query("antiNukeIncidents")
            .withIndex("by_server_outcome", (q) => q.eq("serverId", serverId).eq("outcome", "pending"))
            .take(OBSERVE_BATCH)
        let admitted = false
        for (const row of rows) {
            await ctx.db.patch(row._id, { outcome: "uncertain" })
            admitted = (await recordIncident(ctx, { ...row, outcome: "uncertain" })) || admitted
        }
        return { uncertain: rows.length, admitted }
    },
})

/** Reads incidents for the owner or an Administrator, also while logs are off */
export const incidents = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AntiNukeIncidentsResult> => {
        const input = decode(AntiNukeIncidentsRequest, request),
            { serverId, query } = input
        await requireAdministrator(ctx, serverId, input.actor, true)
        if (query.type === "one") {
            const row = await incidentByNo(ctx, serverId, query.incidentNo)
            return { incidents: row ? [publicIncident(row)] : [], more: false }
        }
        if (query.type === "restorable") {
            const rows = await ctx.db
                .query("antiNukeIncidents")
                .withIndex("by_server_actor", (q) => q.eq("serverId", serverId).eq("actorId", query.userId))
                .order("desc")
                .take(ANTI_NUKE_INCIDENT_PAGE)
            const row = rows.find(antiNukeRestorable)
            return { incidents: row ? [publicIncident(row)] : [], more: false }
        }
        const rows = await ctx.db
            .query("antiNukeIncidents")
            .withIndex("by_server_number", (q) =>
                query.before === undefined
                    ? q.eq("serverId", serverId)
                    : q.eq("serverId", serverId).lt("incidentNo", query.before),
            )
            .order("desc")
            .take(ANTI_NUKE_INCIDENT_PAGE + 1)
        return {
            incidents: rows.slice(0, ANTI_NUKE_INCIDENT_PAGE).map(publicIncident),
            more: rows.length > ANTI_NUKE_INCIDENT_PAGE,
        }
    },
})
