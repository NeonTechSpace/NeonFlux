import type { ModerationActor, RolesMemberContext } from "@neonflux/contracts/shared"
import {
    TEMPORARY_ROLE_DEFAULTS,
    type TemporaryRoleGrant,
    type TemporaryRoleOperation,
    type TemporaryRoleSettings,
} from "@neonflux/contracts/temporary-roles"
import { format, hierarchy, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { moderationActor } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { sourceTimestamp } from "./responses.ts"
import { ago, at, code, duration, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { readRoleAuthority, rolePermissionFix, RolePermissionError } from "./role-permissions.ts"
import { backgroundRoleWork, reconcileRoleChange, roleSnapshots, RoleHandlingError, withRoleMember } from "./roles.ts"
import type { RolesStore } from "./roles-store.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { temporaryRoleHelp, type TemporaryRoleCommand } from "./temprole-command.ts"
import {
    temporaryRoleErrorMessage,
    temporaryRoleProblemText,
    TemporaryRoleStoreError,
    type TemporaryRoleStore,
} from "./temprole-store.ts"
import { settleTemporaryRole } from "./temprole-worker.ts"
import { readNativeMember } from "./member-evidence.ts"

const mentionRole = format.roleMention,
    mentionUser = format.userMention
// A problem recorded before the end time is not retried until the grant ends, except a grant that waits for its member
const grantLine = (grant: TemporaryRoleGrant, prefix: string, now: number) =>
    `${mentionUser(grant.userId)} ${mentionRole(grant.roleId)}, ${
        !grant.problem
            ? `ends ${at(grant.endsAt)}`
            : grant.endsAt > now && grant.problem === "waiting"
              ? `ends ${at(grant.endsAt)}, waits for the member: ${temporaryRoleProblemText(grant.problem, grant.roleId, prefix)}`
              : grant.endsAt > now
                ? `ends ${at(grant.endsAt)}, needs attention: ${temporaryRoleProblemText(grant.problem, grant.roleId, prefix, false)}`
                : `ended ${ago(grant.endsAt)}, not removed yet: ${temporaryRoleProblemText(grant.problem, grant.roleId, prefix)}`
    }`
const defaultsLine = (row: TemporaryRoleSettings["roles"][number]) =>
    `${mentionRole(row.roleId)}: Default ${row.defaultSeconds === undefined ? "none" : duration(row.defaultSeconds)}, longest ${row.maxSeconds === undefined ? "none" : duration(row.maxSeconds)}`
const settledWords = {
    added: "Given",
    removed: "Removed",
    unchanged: "No change needed",
    ended: "Ended",
    away: "The member left. The role comes back if they rejoin before it ends",
} as const
/** Role defaults and grants per page, and the most roles a server can give defaults */
const DEFAULTS_PAGE = 10,
    LIST_PAGE = 10,
    DEFAULTS_LIMIT = TEMPORARY_ROLE_DEFAULTS

/** The reply for a store refusal or a permission NeonFlux can name, which a reconcile's background work gives too */
const failureText = (error: unknown, prefix: string) =>
    error instanceof TemporaryRoleStoreError
        ? withPrefix(temporaryRoleErrorMessage(error), prefix)
        : (error instanceof RolePermissionError && rolePermissionFix(error)) || undefined

export function handleTemporaryRoleCommand(
    store: TemporaryRoleStore | undefined,
    roles: RolesStore | undefined,
    config: BotConfig,
    command: TemporaryRoleCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const reply = (content: string) => replyText(context, content),
        card = (value: Card) => replyCard(context, config.serverId, value)
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    return Effect.gen(function* () {
        if (context.message.guildId !== config.serverId) return
        if (!store || !roles) {
            yield* reply(notSetUp("Temporary roles"))
            return
        }
        if ("error" in command) {
            yield* reply(withPrefix(command.error, prefix))
            return
        }
        if (command.type === "help") {
            yield* reply(withPrefix(temporaryRoleHelp, prefix))
            return
        }
        const { client, message } = context,
            serverId = config.serverId,
            actorId = message.author.id
        const authority = yield* readSafetyAuthority(client, serverId, actorId)
        const defaults = command.type === "defaults" || command.type === "default" || command.type === "max"
        const needed = defaults ? Permissions.ManageGuild : Permissions.ManageRoles
        const holds =
            (client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles }) &
                needed) ===
            needed
        if (
            command.type === "reconcile"
                ? !authority.isOwner && !authority.isAdmin
                : !holds && !authority.isOwner && !authority.isAdmin
        ) {
            yield* reply(
                command.type === "reconcile"
                    ? "Only the server owner or an administrator can reconcile temporary roles"
                    : defaults
                      ? "You need Manage community to change temporary role defaults"
                      : "You need Manage roles to manage temporary roles",
            )
            return
        }
        const actor: ModerationActor = { ...moderationActor(authority), nativePermissionAuthorized: holds }
        const source = { messageId: message.id, createdAt: yield* sourceTimestamp(message) }
        if (command.type === "defaults") {
            const start = `${prefix}temprole defaults`,
                key = pageKey(serverId, message, "temprole", "defaults"),
                from = command.next ? nextPosition<number>(key) : 0
            if (from === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const found = yield* store.query({ serverId, actor, operation: { type: "settings" } })
            if (found.type !== "settings") return
            const rows = found.settings.roles,
                next = from + DEFAULTS_PAGE < rows.length ? from + DEFAULTS_PAGE : undefined
            // The count names the limit only once most of it is used
            const count = `${rows.length}${rows.length >= DEFAULTS_LIMIT * 0.8 ? ` of ${DEFAULTS_LIMIT}` : ""} role${rows.length === 1 ? " has" : "s have"} defaults`
            yield* card({
                title: "Temporary role defaults",
                description: rows.length
                    ? [count, ...rows.slice(from, from + DEFAULTS_PAGE).map(defaultsLine)].join("\n")
                    : `No role defaults yet. Add one with ${code(`${prefix}temprole default @role <duration>`)}`,
                fields: next === undefined ? [] : [["Next", code(`${start} next`)]],
            })
            rememberPosition(key, next)
            return
        }
        if (command.type === "default" || command.type === "max") {
            if (
                command.seconds !== null &&
                (command.roleId === serverId || !authority.roles.some((role) => role.id === command.roleId))
            ) {
                yield* reply("Name a role of this server other than the everyone role")
                return
            }
            const operation: TemporaryRoleOperation =
                command.type === "default"
                    ? { type: "role", roleId: command.roleId, defaultSeconds: command.seconds }
                    : { type: "role", roleId: command.roleId, maxSeconds: command.seconds }
            const saved = yield* store.manage({ serverId, ...source, actor, operation })
            const row =
                saved.type === "settings"
                    ? saved.settings.roles.find((row) => row.roleId === command.roleId)
                    : undefined
            const role = mentionRole(command.roleId)
            if (saved.type === "settings")
                yield* reply(
                    command.type === "max"
                        ? row?.maxSeconds === undefined
                            ? `${role} has no longest duration now`
                            : `${role} can now be given for at most ${duration(row.maxSeconds)}`
                        : row?.defaultSeconds === undefined
                          ? `${role} has no default duration now, so each add names one`
                          : `${role} now lasts ${duration(row.defaultSeconds)} by default`,
                )
            return
        }
        if (command.type === "list") {
            const start = `${prefix}temprole list${command.userId ? ` ${format.userMention(command.userId)}` : ""}`
            const key = pageKey(serverId, message, "temprole", "list", command.userId),
                cursor = command.next ? nextPosition<string | number>(key) : undefined
            if (command.next && cursor === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            // The server's grants come a page at a time. A member's come all at once, at most one per role, and show a page at a time
            const found = yield* store.query({
                serverId,
                actor,
                operation: {
                    type: "list",
                    ...(command.userId ? { userId: command.userId } : {}),
                    ...(typeof cursor === "string" ? { cursor } : {}),
                },
            })
            if (found.type !== "grants") return
            const offset = typeof cursor === "number" ? cursor : 0,
                grants = command.userId ? found.grants.slice(offset, offset + LIST_PAGE) : found.grants,
                next = command.userId
                    ? found.grants.length > offset + LIST_PAGE
                        ? offset + LIST_PAGE
                        : undefined
                    : found.nextCursor
            rememberPosition(key, next)
            const now = yield* Clock.currentTimeMillis
            yield* card({
                title: "Temporary roles",
                description:
                    grants.map((grant) => grantLine(grant, prefix, now)).join("\n") || "No temporary roles yet",
                fields: next !== undefined ? [["Next", code(`${start} next`)]] : [],
                ...(grants.length > 1 ? { footer: "The earliest end first" } : {}),
            })
            return
        }
        // Reconciling settles every grant of the member, each with fresh member reads, so it runs as the server's background role work and
        // never holds the messages after it. It reads the staff member's authority again when it starts, and its record of an unconfirmed
        // change counts from when it is made, since the work may wait behind other role work
        if (command.type === "reconcile") {
            const userId = command.userId
            const work = Effect.gen(function* () {
                const current = yield* readSafetyAuthority(client, serverId, actorId)
                if (!current.isOwner && !current.isAdmin) {
                    yield* reply("Only the server owner or an administrator can reconcile temporary roles")
                    return
                }
                const manages =
                    (client.permissions.calculate({
                        guild: current.guild,
                        member: current.actor,
                        roles: current.roles,
                    }) &
                        Permissions.ManageRoles) ===
                    Permissions.ManageRoles
                yield* reconcileMember(
                    store,
                    roles,
                    serverId,
                    context,
                    { ...moderationActor(current), nativePermissionAuthorized: manages },
                    message.id,
                    userId,
                    card,
                    prefix,
                )
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : reply(
                              failureText(Cause.squash(cause), prefix) ??
                                  `Checking the temporary roles of ${mentionUser(userId)} stopped. Send the command again to continue`,
                          ).pipe(Effect.ignore),
                ),
            )
            yield* backgroundRoleWork(client, serverId, work)
            yield* reply(
                `Checking the temporary roles of ${mentionUser(userId)}. NeonFlux replies here when it is done`,
            )
            return
        }
        const { userId, roleId } = command
        if (command.type === "remove") {
            // Ending a grant needs the same rank over the role as giving it, while the role exists
            const role = authority.roles.find((row) => row.id === roleId)
            if (
                role &&
                !hierarchy.canManageRole({
                    guild: authority.guild,
                    actor: authority.actor,
                    role,
                    roles: authority.roles,
                })
            ) {
                yield* reply(`Your highest role must rank above ${mentionRole(roleId)} to end it`)
                return
            }
            const saved = yield* store.manage({
                serverId,
                ...source,
                actor,
                operation: { type: "remove", userId, roleId },
            })
            if (saved.type !== "grant") return
            const settled = yield* settleTemporaryRole(store, roles, serverId, client, saved.grant, actorId)
            yield* reply(
                settled.state === "removed"
                    ? `Removed ${mentionRole(roleId)} from ${mentionUser(userId)}`
                    : settled.state === "problem"
                      ? `Ended the grant, but ${mentionRole(roleId)} is still on ${mentionUser(userId)}. ${temporaryRoleProblemText(settled.problem, roleId, prefix)}`
                      : settled.state === "ended"
                        ? "Ended the grant. The member left or the role was deleted, so there was nothing to remove"
                        : `Ended the grant. NeonFlux left ${mentionRole(roleId)} in place because the member no longer had it from this grant or another feature still gives it`,
            )
            return
        }
        // Granting needs NeonFlux and the staff member to rank above the role, read fresh, and only ordinary member permissions on it
        const checked = yield* readRoleAuthority(client, serverId, actorId, {
            targetId: userId,
            roleIds: [roleId],
            configuration: true,
        })
        const member = checked.target ?? checked.actor
        if (member.userId !== userId || member.communicationDisabledUntil === undefined)
            return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
        if (command.type === "add" && member.roleIds.includes(roleId)) {
            yield* reply(
                `${mentionUser(userId)} already has ${mentionRole(roleId)}. NeonFlux removes only roles it adds, so remove the role first to give it for a set time`,
            )
            return
        }
        const memberContext: RolesMemberContext = {
            originServerId: member.guildId,
            userId,
            joinedAt: member.joinedAt,
            roleIds: [...member.roleIds],
            isBot: member.isBot,
            timeoutUntil: member.communicationDisabledUntil,
            botId: checked.botId,
            botAuthorized: checked.botPermissionAuthorized,
            roles: roleSnapshots(checked),
        }
        const saved = yield* store.manage({
            serverId,
            ...source,
            actor,
            context: memberContext,
            operation:
                command.type === "set"
                    ? { type: "set", userId, roleId, durationSeconds: command.seconds }
                    : { type: "add", userId, roleId, ...(command.seconds ? { durationSeconds: command.seconds } : {}) },
        })
        if (saved.type !== "grant") return
        const settled = yield* settleTemporaryRole(store, roles, serverId, client, saved.grant, actorId)
        const until = `until ${at(saved.grant.endsAt)}`
        if (settled.state === "added" || settled.state === "unchanged") {
            yield* reply(
                command.type === "add"
                    ? `Gave ${mentionRole(roleId)} to ${mentionUser(userId)} ${until}`
                    : `${mentionUser(userId)} keeps ${mentionRole(roleId)} ${until}`,
            )
            return
        }
        if (settled.state === "problem" && settled.problem === "uncertain") {
            yield* reply(`Saved the grant ${until}, but ${temporaryRoleProblemText("uncertain", roleId, prefix)}`)
            return
        }
        // A role that could not be given is not left as a grant
        if (command.type === "add" && settled.state === "problem") {
            const cancelled = yield* store.manage({
                serverId,
                messageId: message.id,
                createdAt: source.createdAt,
                actor,
                operation: { type: "remove", userId, roleId },
            })
            if (cancelled.type === "grant")
                yield* settleTemporaryRole(store, roles, serverId, client, cancelled.grant, actorId)
        }
        // Nothing is retried before the grant ends, and a cancelled add leaves nothing to retry
        yield* reply(
            settled.state !== "problem"
                ? "The member left or the role was deleted, so the grant ended"
                : command.type === "add"
                  ? `Could not give ${mentionRole(roleId)}, so no grant was kept. ${temporaryRoleProblemText(settled.problem, roleId, prefix, false)}. Run the command again once it is fixed`
                  : `Could not give ${mentionRole(roleId)}. ${temporaryRoleProblemText(settled.problem, roleId, prefix, false)}`,
        )
    }).pipe(
        Effect.catch((error) =>
            reply(failureText(error, prefix) ?? "The member, role or permissions could not be read. Try again shortly"),
        ),
        Effect.asVoid,
    )
}

// Reads the member once more after an unconfirmed role change, records what Fluxer shows and then settles the member's grants.
// The shared role recovery records one observation per command, so a second unconfirmed role needs another run. A member who
// left has no roles to read, so only their stored grants are settled
function reconcileMember(
    store: TemporaryRoleStore,
    roles: RolesStore,
    serverId: string,
    context: BotEventContext<"messageCreate">,
    actor: ModerationActor,
    messageId: string,
    userId: string,
    card: (value: Card) => Effect.Effect<void, unknown>,
    prefix: string,
) {
    return Effect.gen(function* () {
        const client = context.client
        const member = (yield* readNativeMember(client, serverId, userId)).member
        const recorded = member
            ? yield* withRoleMember(
                  client,
                  userId,
                  Effect.gen(function* () {
                      const source = { messageId, createdAt: yield* Clock.currentTimeMillis }
                      return yield* reconcileRoleChange(
                          roles,
                          serverId,
                          client,
                          actor,
                          source,
                          userId,
                          (key) => key === "temporary",
                      )
                  }),
                  serverId,
              )
            : "The member is not in the server, so only their temporary roles were checked"
        const lines = [
            recorded === "No unconfirmed role change for this member"
                ? "No unconfirmed temporary role change for this member"
                : recorded,
        ]
        const grants = yield* store.query({ serverId, actor, operation: { type: "list", userId } })
        const now = yield* Clock.currentTimeMillis
        for (const grant of grants.type === "grants" ? grants.grants : []) {
            const outcome = yield* settleTemporaryRole(store, roles, serverId, client, grant, actor.userId)
            lines.push(
                `${mentionRole(grant.roleId)}: ${outcome.state === "problem" ? temporaryRoleProblemText(outcome.problem, grant.roleId, prefix, grant.endsAt <= now) : settledWords[outcome.state]}`,
            )
        }
        yield* card({
            title: "Temporary role check",
            description: lines.join("\n"),
            fields: [["Member", mentionUser(userId)]],
        })
    })
}
