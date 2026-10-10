import { ConvexError, v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { MemberAccessLists, RolePickerCompleteResult, RolePickerMemberOperation, RolePickerOperation, RolePickerReadyResult, RolePickerRoleDisplay, RolePickerSettings, RolePickerStartResult, RolePickerState } from "../contracts.js"
import type { DashboardRolePickerMember, DashboardRolePickerQueueResult } from "../dashboard-contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { memberSession } from "./dashboard.ts"
import { bumpConfigurationRevision, configurationRevision } from "./configurationRevision.ts"
import { accessAllowed, accessLists, readAccess, writeAccess } from "./memberAccess.ts"
import { grantEligibility, participationAvailability, roleOwner, rolePolicy } from "./roleClaims.ts"
import { memberContext, roleSnapshots, safeRole } from "./rolesDomain.ts"
import { ownerReferences, rolesAdmin } from "./rolesStore.ts"
import { shape } from "./publishingDomain.ts"
import { exclusiveConflict } from "./rolePickerRoles.ts"
import { defaultRolePicker, memberGrant, memberJob, publicPickerJob, readRolePicker, rolePickerRow, writeSnapshot } from "./rolePickerStore.ts"
import { memberOperation, memberRefusal, pickerKey, roleDisplay, rolePickerOperation, ROLE_PICKER_FEATURE, ROLE_PICKER_MEMBER_FAMILY, ROLE_PICKER_MENU_ROLES, ROLE_PICKER_MENUS, ROLE_PICKER_PENDING,
    ROLE_PICKER_QUEUE, ROLE_PICKER_RATE, ROLE_PICKER_RATE_WINDOW_MS, ROLE_PICKER_REQUEST_MS, ROLE_PICKER_RETENTION_MS } from "./rolePickerDomain.ts"
import { fail, source } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

const unconfirmed = "Fluxer did not confirm the role change, and it is never retried automatically. Check your roles before trying again"
const refused = "Fluxer refused the role change. Ask a moderator to check the bot's role position"
async function rolePickerState(ctx: Pick<QueryCtx, "db">, serverId: string): Promise<RolePickerState> {
    return { revision: await configurationRevision(ctx as QueryCtx, serverId, "rolepicker"), settings: await readRolePicker(ctx, serverId), access: await readAccess(ctx, serverId, ROLE_PICKER_FEATURE) }
}
// Chat commands and dashboard saves share these rules. Roles placed in a menu pass the shared self-service role rules on fresh native snapshots
async function applyRolePicker(ctx: MutationCtx, serverId: string, op: RolePickerOperation, roles: unknown, display: RolePickerRoleDisplay[] | undefined): Promise<void> {
    const row = await rolePickerRow(ctx, serverId), settings: RolePickerSettings = row ? { enabled: row.enabled, menus: structuredClone(row.menus) } : defaultRolePicker()
    const find = (menuName: string) => settings.menus.find(menu => menu.name === menuName)
    const required = (menuName: string) => find(menuName) ?? fail(404, "Menu not found")
    const placeable = async (menuName: string, roleIds: string[]) => {
        if (settings.menus.some(menu => menu.name !== menuName && menu.roleIds.some(id => roleIds.includes(id)))) fail(409, "A role can belong to only one menu")
        if (!roleIds.length) return
        const policy = await rolePolicy(ctx, serverId), observed = roleSnapshots(roles)
        for (const roleId of roleIds) safeRole(serverId, roleId, observed, policy.staffRoleIds, true)
    }
    let access: MemberAccessLists | undefined
    switch (op.type) {
        case "module": settings.enabled = op.enabled; break
        case "menu-set": case "menu-add": {
            const existing = find(op.name), roleIds = op.type === "menu-set" ? op.roleIds : []
            if (op.type === "menu-add" && existing) fail(409, "Menu already exists")
            if (!existing && settings.menus.length >= ROLE_PICKER_MENUS) fail(429, `A server can have at most ${ROLE_PICKER_MENUS} menus`)
            await placeable(op.name, roleIds)
            const menu = { name: op.name, mode: op.mode, roleIds, ...(op.description ? { description: op.description } : {}), ...(existing?.display ? { display: existing.display } : {}) }
            if (existing) settings.menus[settings.menus.indexOf(existing)] = menu
            else settings.menus.push(menu)
            break
        }
        case "menu-update": {
            const menu = required(op.name)
            if (op.mode) menu.mode = op.mode
            if (op.description === null) delete menu.description
            else if (op.description !== undefined) menu.description = op.description
            break
        }
        case "menu-role-add": {
            const menu = required(op.name), added = op.roleIds.filter(id => !menu.roleIds.includes(id))
            if (menu.roleIds.length + added.length > ROLE_PICKER_MENU_ROLES) fail(400, `A menu holds at most ${ROLE_PICKER_MENU_ROLES} roles`)
            await placeable(menu.name, added)
            menu.roleIds.push(...added)
            break
        }
        case "menu-role-remove": { const menu = required(op.name); menu.roleIds = menu.roleIds.filter(id => !op.roleIds.includes(id)); break }
        case "menu-remove": settings.menus.splice(settings.menus.indexOf(required(op.name)), 1); break
        case "access-set": access = accessLists({ allowRoleIds: op.allowRoleIds, blockRoleIds: op.blockRoleIds, allowUserIds: op.allowUserIds, blockUserIds: op.blockUserIds }, serverId); break
        case "access-add": case "access-remove": {
            const current = await readAccess(ctx, serverId, ROLE_PICKER_FEATURE), key: keyof MemberAccessLists = `${op.list}${op.kind === "role" ? "RoleIds" : "UserIds"}`
            current[key] = op.type === "access-add" ? [...new Set([...current[key], ...op.ids])] : current[key].filter(id => !op.ids.includes(id))
            access = accessLists(current, serverId)
            break
        }
    }
    // Every save stores the menu roles' current names and colors as a display fallback, keeping older names the bot did not send
    const fresh = new Map((display ?? []).map(role => [role.roleId, role]))
    for (const menu of settings.menus) {
        const stored = new Map((menu.display ?? []).map(role => [role.roleId, role]))
        const names = menu.roleIds.flatMap(roleId => { const role = fresh.get(roleId) ?? stored.get(roleId); return role ? [role] : [] })
        if (names.length) menu.display = names
        else delete menu.display
    }
    if (row) await ctx.db.patch(row._id, settings)
    else await ctx.db.insert("rolePickerSettings", { serverId, ...settings })
    if (access) await writeAccess(ctx, serverId, ROLE_PICKER_FEATURE, access)
}
// Dashboard execute bumps the family revision after this, with the roles and role names the bot read for the save
export async function applyRolePickerConfiguration(ctx: MutationCtx, serverId: string, value: Record<string, unknown>) {
    const { roles, display, ...operation } = value
    await applyRolePicker(ctx, serverId, rolePickerOperation(operation, true), roles, roleDisplay(display))
    return {}
}

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolePickerState> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "roles", "display", "operation"], ["serverId", "messageId", "createdAt", "actor", "operation"])
    const identity = source(input, Date.now()), op = rolePickerOperation(input.operation)
    // Like other role settings, configuration needs the owner or an Administrator. Turning off and removing stay available at DEFCON 1
    await rolesAdmin(ctx, identity.serverId, input.actor, op.type === "module" && !op.enabled || op.type === "menu-remove")
    await applyRolePicker(ctx, identity.serverId, op, input.roles, roleDisplay(input.display))
    await bumpConfigurationRevision(ctx, identity.serverId, "rolepicker", { kind: "chat", createdAt: identity.createdAt })
    return rolePickerState(ctx, identity.serverId)
} })
export const settings = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolePickerState> => {
    const input = shape(request, ["serverId", "actor"], ["serverId", "actor"]), serverId = String(input.serverId)
    await rolesAdmin(ctx, serverId, input.actor, true)
    return rolePickerState(ctx, serverId)
} })

// Website member requests. Each one rechecks the session, the installation and the enabled role picker
export const request = mutation({ args: { sessionToken: v.string(), serverId: v.string(), requestId: v.string(), operation: v.any() }, handler: async (ctx, input): Promise<DashboardRolePickerQueueResult> => {
    const session = await memberSession(ctx, input.sessionToken, input.serverId), op = memberOperation(input.operation), now = Date.now()
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId)) fail(400, "Invalid role picker request")
    const existing = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_request", q => q.eq("sessionId", session._id).eq("serverId", input.serverId).eq("requestId", input.requestId)).unique()
    if (existing) {
        if (existing.family !== ROLE_PICKER_MEMBER_FAMILY || JSON.stringify(existing.operation) !== JSON.stringify(op)) fail(409, "Role picker request already used")
        return { jobId: existing._id }
    }
    if (op.type !== "lookup" && !(await readRolePicker(ctx, input.serverId)).menus.some(menu => menu.name === op.menu && menu.roleIds.includes(op.roleId))) fail(400, "This role is not in that menu")
    // Per member, ten claims or drops and ten lookups a minute with a few pending at once. Per server, a bounded queue
    const recent = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_actor", q => q.eq("serverId", input.serverId).eq("family", ROLE_PICKER_MEMBER_FAMILY).eq("actorId", session.userId).gt("createdAt", now - ROLE_PICKER_REQUEST_MS)).take(4 * ROLE_PICKER_RATE + 1)
    const lookup = (value: unknown) => (value as RolePickerMemberOperation).type === "lookup"
    if (recent.filter(row => row.createdAt > now - ROLE_PICKER_RATE_WINDOW_MS && lookup(row.operation) === (op.type === "lookup")).length >= ROLE_PICKER_RATE) fail(429, "Too many role requests. Wait a minute and try again")
    if (recent.filter(row => row.state === "queued" && row.expiresAt > now).length >= ROLE_PICKER_PENDING) fail(429, "Wait for your earlier requests to finish")
    const queued = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_work", q => q.eq("serverId", input.serverId).eq("family", ROLE_PICKER_MEMBER_FAMILY).eq("state", "queued")).take(ROLE_PICKER_QUEUE)
    if (queued.length >= ROLE_PICKER_QUEUE) fail(429, "The role picker is busy. Try again in a minute")
    const expiresAt = Math.min(now + ROLE_PICKER_REQUEST_MS, session.expiresAt, session.lifetimeAt), cleanupAt = now + ROLE_PICKER_RETENTION_MS
    const id = await ctx.db.insert("dashboardConfigurationJobs", { serverId: input.serverId, family: ROLE_PICKER_MEMBER_FAMILY, actorId: session.userId, sessionId: session._id, requestId: input.requestId,
        expectedConfigRevision: await configurationRevision(ctx, input.serverId, "rolepicker"), operation: op, state: "queued", createdAt: now, expiresAt, cleanupAt })
    await ctx.scheduler.runAt(expiresAt, internal.rolePicker.expireRequest, { id })
    await ctx.scheduler.runAt(cleanupAt, internal.dashboardConfiguration.cleanup, { id })
    await ringWork(ctx)
    return { jobId: id }
} })
export const member = query({ args: { sessionToken: v.string(), serverId: v.string() }, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardRolePickerMember> => {
    const session = await memberSession(ctx, sessionToken, serverId), settings = await readRolePicker(ctx, serverId)
    const row = await ctx.db.query("rolePickerSnapshots").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", session.userId)).unique()
    const requests = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_actor", q => q.eq("serverId", serverId).eq("family", ROLE_PICKER_MEMBER_FAMILY).eq("actorId", session.userId)).order("desc").take(10)
    const menuRoles = new Set(settings.menus.flatMap(menu => menu.roleIds))
    // The access decision uses the snapshot's role IDs with the current lists, so list changes show at once
    // Role names come from the bot's reads, never from the member's sign-in, and only for current menu roles
    const snapshot = row && row.expiresAt > Date.now() ? { roleIds: row.roleIds.filter(id => menuRoles.has(id)), roles: (row.roles ?? []).filter(role => menuRoles.has(role.roleId)),
        allowed: accessAllowed(await readAccess(ctx, serverId, ROLE_PICKER_FEATURE), { userId: session.userId, roleIds: row.roleIds }), observedAt: row.observedAt, expiresAt: row.expiresAt } : null
    return { serverId, menus: settings.menus, snapshot, requests: requests.map(publicPickerJob) }
} })
export const expireRequest = internalMutation({ args: { id: v.id("dashboardConfigurationJobs") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row?.family === ROLE_PICKER_MEMBER_FAMILY && row.state === "queued" && row.expiresAt <= Date.now()) await ctx.db.patch(id, { state: "failed", error: "The bot did not handle this request in time. Try again" })
} })
export const expireSnapshot = internalMutation({ args: { id: v.id("rolePickerSnapshots") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(id)
} })

// Bot routes. The bot reads the member fresh, then the backend decides with the current menus, access lists and role rules
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolePickerReadyResult> => {
    const serverId = String(shape(request, ["serverId"], ["serverId"]).serverId), now = Date.now()
    const rows = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_work", q => q.eq("serverId", serverId).eq("family", ROLE_PICKER_MEMBER_FAMILY).eq("state", "queued")).take(8)
    return { jobs: rows.filter(row => row.expiresAt > now).slice(0, 4).map(publicPickerJob) }
} })
export const start = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolePickerStartResult> => {
    const input = shape(request, ["serverId", "jobId", "actorId", "context", "display"], ["serverId", "jobId", "actorId", "context"])
    const serverId = String(input.serverId), job = await memberJob(ctx, serverId, input.jobId, input.actorId), now = Date.now(), display = roleDisplay(input.display)
    const finish = async (error?: string): Promise<RolePickerStartResult> => {
        await ctx.db.patch(job._id, error ? { state: "failed", error } : { state: "applied" })
        return { proceed: false, job: publicPickerJob((await ctx.db.get(job._id))!) }
    }
    if (job.state !== "queued") return { proceed: false, job: publicPickerJob(job) }
    if (!await memberGrant(ctx, job, now)) return finish("Your sign-in expired before the bot could act. Sign in again and retry")
    const member = memberContext(input.context), op = job.operation as RolePickerMemberOperation
    if (member.userId !== job.actorId) fail(403, "Role picker grant mismatch")
    const settings = await readRolePicker(ctx, serverId)
    if (!settings.enabled) return finish("The role picker is turned off in this server")
    if (op.type === "lookup") { await writeSnapshot(ctx, serverId, member, now, settings, display); return finish() }
    const menu = settings.menus.find(row => row.name === op.menu)
    if (!menu?.roleIds.includes(op.roleId)) return finish("This role is no longer in that menu")
    if (!accessAllowed(await readAccess(ctx, serverId, ROLE_PICKER_FEATURE), member)) return finish("You cannot use the role picker in this server")
    try {
        // The shared self-service rules decide first, so a refusal reaches the member with its reason
        if (op.type === "claim") await grantEligibility(ctx, serverId, member, pickerKey(menu.name), op.roleId)
        else await participationAvailability(ctx, serverId, member)
    } catch (error) {
        const data = error instanceof ConvexError ? error.data as { status?: unknown, error?: unknown } | null : null
        if (data?.status === 403 && typeof data.error === "string") return finish(memberRefusal(data.error))
        throw error
    }
    if (op.type === "claim" && menu.mode === "single" && await exclusiveConflict(ctx, serverId, member, pickerKey(menu.name), menu.roleIds.filter(id => id !== op.roleId)))
        return finish("Another role in this menu was not added by the role picker or is still used by another feature. Ask a moderator to remove it first")
    return { proceed: true, job: publicPickerJob(job) }
} })
export const complete = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolePickerCompleteResult> => {
    const input = shape(request, ["serverId", "jobId", "actorId", "context", "display"], ["serverId", "jobId", "actorId", "context"])
    const serverId = String(input.serverId), job = await memberJob(ctx, serverId, input.jobId, input.actorId), now = Date.now(), display = roleDisplay(input.display)
    if (job.state !== "queued") return { job: publicPickerJob(job) }
    const member = memberContext(input.context), op = job.operation as RolePickerMemberOperation
    if (member.userId !== job.actorId || op.type === "lookup") fail(409, "Role picker request changed")
    const attempt = await ctx.db.query("roleAttempts").withIndex("by_source", q => q.eq("serverId", serverId).eq("sourceId", `picker_${job._id}`)).order("desc").first()
    const owner = await roleOwner(ctx, serverId, member, op.roleId), refs = owner ? await ownerReferences(ctx, owner._id) : []
    let error: string | undefined
    if (attempt?.outcome === "pending" || attempt?.outcome === "uncertain") error = unconfirmed
    else if (op.type === "claim" ? !member.roleIds.includes(op.roleId) : member.roleIds.includes(op.roleId)) {
        if (owner && owner.status !== "idle") error = "An earlier change to this role is still unconfirmed. Ask a moderator to check it"
        else if (attempt?.outcome === "failed") error = refused
        else if (op.type === "claim") error = "The role could not be added"
        else if (refs.some(ref => ref.desired && ref.consumerKey !== pickerKey(op.menu))) error = "Another NeonFlux feature still uses this role, so it stays"
        else error = owner?.owned ? "The role could not be removed" : "The role picker did not add this role, so it cannot remove it"
    }
    await ctx.db.patch(job._id, error ? { state: "failed", error } : { state: "applied" })
    // The member's roles after the change refresh the selections the website shows
    await writeSnapshot(ctx, serverId, member, now, await readRolePicker(ctx, serverId), display)
    return { job: publicPickerJob((await ctx.db.get(job._id))!) }
} })
export const failRequest = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "jobId"], ["serverId", "jobId"]), serverId = String(input.serverId)
    const id = typeof input.jobId === "string" ? ctx.db.normalizeId("dashboardConfigurationJobs", input.jobId) : null, job = id ? await ctx.db.get(id) : null
    if (!job || job.family !== ROLE_PICKER_MEMBER_FAMILY || job.serverId !== serverId) fail(403, "Role picker grant mismatch")
    if (job.state === "queued") await ctx.db.patch(job._id, { state: "failed", error: "The bot could not read your membership or change the role. Try again shortly" })
    return null
} })
