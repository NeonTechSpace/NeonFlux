import type * as C from "@neonflux/backend/contracts"
import { format, hierarchy, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { moderationActor } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { highestRole } from "./permission-fix.ts"
import { sourceTimestamp } from "./responses.ts"
import { ago, at, code, duration, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { readRoleAuthority, rolePermissionFix, RolePermissionError } from "./role-permissions.ts"
import { roleMemberContext, roleSnapshots, RoleHandlingError } from "./roles.ts"
import { RolesStoreError, type RolesStore } from "./roles-store.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { temporaryRoleHelp, type TemporaryRoleCommand } from "./temprole-command.ts"
import { temporaryRoleErrorMessage, temporaryRoleProblemText, TemporaryRoleStoreError, type TemporaryRoleStore } from "./temprole-store.ts"
import { settleTemporaryRole } from "./temprole-worker.ts"

const mentionRole = format.roleMention, mentionUser = format.userMention
const grantLine = (grant: C.TemporaryRoleGrant, prefix: string) => `${mentionUser(grant.userId)} ${mentionRole(grant.roleId)}, ${grant.problem
    ? `ended ${ago(grant.endsAt)}, not removed yet: ${temporaryRoleProblemText(grant.problem, grant.roleId, prefix)}` : `ends ${at(grant.endsAt)}`}`
const defaultsLine = (row: C.TemporaryRoleSettings["roles"][number]) =>
    `${mentionRole(row.roleId)}: Default ${row.defaultSeconds === undefined ? "none" : duration(row.defaultSeconds)}, longest ${duration(row.maxSeconds ?? 365 * 86400)}`
const settledWords = { added: "Given", removed: "Removed", unchanged: "No change needed", ended: "Ended" } as const
/** Role defaults per page, and the most roles a server can give defaults */
const DEFAULTS_PAGE = 10, DEFAULTS_LIMIT = 100

export function handleTemporaryRoleCommand(store: TemporaryRoleStore | undefined, roles: RolesStore | undefined, config: BotConfig, command: TemporaryRoleCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    return Effect.gen(function* () {
        if (context.message.guildId !== config.serverId) return
        if (!store || !roles) { yield* reply(notSetUp("Temporary roles")); return }
        if ("error" in command) { yield* reply(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* reply(withPrefix(temporaryRoleHelp, prefix)); return }
        const { client, message } = context, serverId = config.serverId, actorId = message.author.id
        const authority = yield* readSafetyAuthority(client, serverId, actorId)
        const defaults = command.type === "defaults" || command.type === "default" || command.type === "max"
        const needed = defaults ? Permissions.ManageGuild : Permissions.ManageRoles
        const holds = (client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles }) & needed) === needed
        if (command.type === "reconcile" ? !authority.isOwner && !authority.isAdmin : !holds && !authority.isOwner && !authority.isAdmin) {
            yield* reply(command.type === "reconcile" ? "Only the server owner or an administrator can reconcile temporary roles"
                : defaults ? "You need Manage Server to change temporary role defaults" : "You need Manage Roles to manage temporary roles")
            return
        }
        const actor: C.ModerationActor = { ...moderationActor(authority), nativePermissionAuthorized: holds }
        const source = { messageId: message.id, createdAt: yield* sourceTimestamp(message) }
        if (command.type === "defaults") {
            const start = `${prefix}temprole defaults`, key = pageKey(serverId, message, "temprole", "defaults"), from = command.next ? nextPosition<number>(key) : 0
            if (from === undefined) { yield* reply(noNextPage(start)); return }
            const found = yield* store.query({ serverId, actor, operation: { type: "settings" } })
            if (found.type !== "settings") return
            const rows = found.settings.roles, next = from + DEFAULTS_PAGE < rows.length ? from + DEFAULTS_PAGE : undefined
            // The count names the limit only once most of it is used
            const count = `${rows.length}${rows.length >= DEFAULTS_LIMIT * 0.8 ? ` of ${DEFAULTS_LIMIT}` : ""} role${rows.length === 1 ? " has" : "s have"} defaults`
            yield* card({ title: "Temporary role defaults", description: rows.length ? [count, ...rows.slice(from, from + DEFAULTS_PAGE).map(defaultsLine)].join("\n") : `No role defaults yet. Add one with ${code(`${prefix}temprole default @role <duration>`)}`,
                fields: next === undefined ? [] : [["Next", code(`${start} next`)]] })
            rememberPosition(key, next)
            return
        }
        if (command.type === "default" || command.type === "max") {
            if (command.seconds !== null && (command.roleId === serverId || !authority.roles.some(role => role.id === command.roleId))) { yield* reply("Name a role of this server other than the everyone role"); return }
            const operation: C.TemporaryRoleOperation = command.type === "default" ? { type: "role", roleId: command.roleId, defaultSeconds: command.seconds }
                : { type: "role", roleId: command.roleId, maxSeconds: command.seconds }
            const saved = yield* store.manage({ serverId, ...source, actor, operation })
            const row = saved.type === "settings" ? saved.settings.roles.find(row => row.roleId === command.roleId) : undefined
            const role = mentionRole(command.roleId)
            if (saved.type === "settings") yield* reply(command.type === "max" ? `${role} can now be given for at most ${duration(row?.maxSeconds ?? 365 * 86400)}`
                : row?.defaultSeconds === undefined ? `${role} has no default duration now, so each add names one` : `${role} now lasts ${duration(row.defaultSeconds)} by default`)
            return
        }
        if (command.type === "list") {
            const start = `${prefix}temprole list${command.userId ? ` <@${command.userId}>` : ""}`
            const key = pageKey(serverId, message, "temprole", "list", command.userId), cursor = command.next ? nextPosition<string>(key) : undefined
            if (command.next && cursor === undefined) { yield* reply(noNextPage(start)); return }
            const found = yield* store.query({ serverId, actor, operation: { type: "list", ...(command.userId ? { userId: command.userId } : {}), ...(cursor ? { cursor } : {}) } })
            if (found.type !== "grants") return
            rememberPosition(key, found.nextCursor)
            yield* card({ title: "Temporary roles", description: found.grants.map(grant => grantLine(grant, prefix)).join("\n") || "No temporary roles yet",
                fields: found.nextCursor ? [["Next", code(`${start} next`)]] : [], ...(found.grants.length > 1 ? { footer: "The earliest end first" } : {}) })
            return
        }
        if (command.type === "reconcile") {
            yield* reconcileMember(store, roles, serverId, context, actor, source, command.userId, card, prefix)
            return
        }
        const { userId, roleId } = command
        if (command.type === "remove") {
            // Ending a grant needs the same rank over the role as giving it, while the role exists
            const role = authority.roles.find(row => row.id === roleId), top = highestRole(authority.actor, authority.roles)
            if (role && !authority.isOwner && !(top && hierarchy.isAbove(top, role))) { yield* reply(`Your highest role must rank above ${mentionRole(roleId)} to end it`); return }
            const saved = yield* store.manage({ serverId, ...source, actor, operation: { type: "remove", userId, roleId } })
            if (saved.type !== "grant") return
            const settled = yield* settleTemporaryRole(store, roles, serverId, client, saved.grant, actorId)
            yield* reply(settled.state === "removed" ? `Removed ${mentionRole(roleId)} from ${mentionUser(userId)}`
                : settled.state === "problem" ? `Ended the grant, but ${mentionRole(roleId)} is still on ${mentionUser(userId)}. ${temporaryRoleProblemText(settled.problem, roleId, prefix)}`
                    : settled.state === "ended" ? "Ended the grant. The member left or the role was deleted, so there was nothing to remove"
                        : `Ended the grant. NeonFlux left ${mentionRole(roleId)} in place because the member no longer had it from this grant or another feature still gives it`)
            return
        }
        // Granting needs NeonFlux and the staff member to rank above the role, read fresh, and only ordinary member permissions on it
        const checked = yield* readRoleAuthority(client, serverId, actorId, { targetId: userId, roleIds: [roleId], configuration: true })
        const member = checked.target ?? checked.actor
        if (member.userId !== userId || member.communicationDisabledUntil === undefined) return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
        if (command.type === "add" && member.roleIds.includes(roleId)) {
            yield* reply(`${mentionUser(userId)} already has ${mentionRole(roleId)}. NeonFlux removes only roles it adds, so remove the role first to give it for a set time`)
            return
        }
        const memberContext: C.RolesMemberContext = { originServerId: member.guildId, userId, joinedAt: member.joinedAt, roleIds: [...member.roleIds], isBot: member.isBot,
            timeoutUntil: member.communicationDisabledUntil, botId: checked.botId, botAuthorized: checked.botPermissionAuthorized, roles: roleSnapshots(checked) }
        const saved = yield* store.manage({ serverId, ...source, actor, context: memberContext,
            operation: command.type === "set" ? { type: "set", userId, roleId, durationSeconds: command.seconds } : { type: "add", userId, roleId, ...(command.seconds ? { durationSeconds: command.seconds } : {}) } })
        if (saved.type !== "grant") return
        const settled = yield* settleTemporaryRole(store, roles, serverId, client, saved.grant, actorId)
        const until = `until ${at(saved.grant.endsAt)}`
        if (settled.state === "added" || settled.state === "unchanged") {
            yield* reply(command.type === "add" ? `Gave ${mentionRole(roleId)} to ${mentionUser(userId)} ${until}` : `${mentionUser(userId)} keeps ${mentionRole(roleId)} ${until}`)
            return
        }
        if (settled.state === "problem" && settled.problem === "uncertain") {
            yield* reply(`Saved the grant ${until}, but ${temporaryRoleProblemText("uncertain", roleId, prefix)}`)
            return
        }
        // A role that could not be given is not left as a grant
        if (command.type === "add" && settled.state === "problem") {
            const cancelled = yield* store.manage({ serverId, messageId: message.id, createdAt: source.createdAt, actor, operation: { type: "remove", userId, roleId } })
            if (cancelled.type === "grant") yield* settleTemporaryRole(store, roles, serverId, client, cancelled.grant, actorId)
        }
        yield* reply(settled.state === "problem" ? `Could not give ${mentionRole(roleId)}. ${temporaryRoleProblemText(settled.problem, roleId, prefix)}`
            : "The member left or the role was deleted, so the grant ended")
    }).pipe(Effect.catch(error => reply(error instanceof TemporaryRoleStoreError ? withPrefix(temporaryRoleErrorMessage(error), prefix)
        : error instanceof RolePermissionError && rolePermissionFix(error) || "The member, role or permissions could not be read. Try again shortly")), Effect.asVoid)
}

// Reads the member once more after an unconfirmed role change, records what Fluxer shows and then settles the member's grants.
// The shared role recovery records one observation per command, so a second unconfirmed role needs another run
function reconcileMember(store: TemporaryRoleStore, roles: RolesStore, serverId: string, context: BotEventContext<"messageCreate">, actor: C.ModerationActor,
    source: { messageId: string, createdAt: number }, userId: string, card: (value: Card) => Effect.Effect<void, unknown>, prefix: string) {
    return Effect.gen(function* () {
        const client = context.client
        const fresh = yield* roleMemberContext(client, serverId, userId, actor.userId)
        const claims = yield* roles.query({ serverId, actor, operation: { type: "claim-list", userId, joinedAt: fresh.context.joinedAt } })
        const claim = claims.type === "claims" ? claims.claims.find(row => row.status === "uncertain" && row.attempt?.consumerKey === "temporary") : undefined
        const lines: string[] = []
        if (claim?.attempt) {
            const recorded = yield* roles.reconcile({ serverId, actor, ...source, attemptId: claim.attempt.attemptId, generation: claim.generation,
                observation: { originServerId: serverId, observedAt: yield* Clock.currentTimeMillis, userId, joinedAt: fresh.context.joinedAt, roleId: claim.roleId, present: fresh.context.roleIds.includes(claim.roleId) } }).pipe(
                Effect.catch(error => error instanceof RolesStoreError && error.status === 409 ? Effect.succeed(undefined) : Effect.fail(error)))
            lines.push(recorded ? `Recorded that ${mentionRole(claim.roleId)} is ${fresh.context.roleIds.includes(claim.roleId) ? "on" : "not on"} ${mentionUser(userId)}` : "The last role change is still within its few-minute window. Try again shortly")
        } else lines.push("No unconfirmed temporary role change for this member")
        const grants = yield* store.query({ serverId, actor, operation: { type: "list", userId } })
        for (const grant of grants.type === "grants" ? grants.grants : []) {
            const outcome = yield* settleTemporaryRole(store, roles, serverId, client, grant, actor.userId)
            lines.push(`${mentionRole(grant.roleId)}: ${outcome.state === "problem" ? temporaryRoleProblemText(outcome.problem, grant.roleId, prefix) : settledWords[outcome.state]}`)
        }
        yield* card({ title: "Temporary role check", description: lines.join("\n"), fields: [["Member", mentionUser(userId)]] })
    })
}
