import {
    BOT_RIGHTS,
    RIGHTS_DEFAULT_LIMITS,
    RIGHTS_SERVER_FACTOR,
    rightsOwnerOnly,
    type RightsOperation,
    type RightsStatus,
} from "@neonflux/contracts/rights"
import { format, hierarchy, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { refusedReason } from "./backend-http.ts"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { ago, code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { rightsRuntimes } from "./rights-memory.ts"
import type { RightsCommand } from "./rights-command.ts"
import { RightsStoreError, type RightsStore } from "./rights-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { readSafetyAuthority, SafetyPermissionError, type SafetyAuthority } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"

const ownerOnly = "Only the server owner can do that. An Administrator can turn rights off or revoke them"
function describe(error: unknown) {
    if (error instanceof RightsStoreError) {
        const refused = refusedReason(error)
        if (refused) return refused
        if (error.status === 403) return ownerOnly
        return "Bot-only rights are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The command could not be completed. Check !mod rights status"
}
/** The status card: Whether it is on, then who holds what, limits changed from the default, and who is suspended */
export function rightsCard(view: RightsStatus, prefix: string): Card {
    const { settings } = view
    const changed = BOT_RIGHTS.filter(
        (right) =>
            settings.limits[right].count !== RIGHTS_DEFAULT_LIMITS[right].count ||
            settings.limits[right].minutes !== RIGHTS_DEFAULT_LIMITS[right].minutes,
    )
    return {
        title: "Bot-only staff rights",
        description: settings.enabled ? "On" : "Off. Staff roles need the real Fluxer permission",
        fields: [
            [
                "Grants",
                settings.grants
                    .slice(0, 10)
                    .map((grant) => `${format.roleMention(grant.roleId)}: ${grant.rights.join(", ")}`)
                    .join("\n") || "None",
            ],
            ...(changed.length
                ? [
                      [
                          "Limits changed",
                          changed
                              .map(
                                  (right) =>
                                      `${right}: ${settings.limits[right].count} in ${settings.limits[right].minutes}m`,
                              )
                              .join(", "),
                      ] as const,
                  ]
                : []),
            ...(view.suspended.length
                ? [
                      [
                          "Suspended",
                          `${view.suspended
                              .map(
                                  (row) =>
                                      `${format.userMention(row.userId)}: ${row.reason === "limit" ? `went over the ${row.right} limit` : "anti-nuke fired"} ${ago(row.at)}`,
                              )
                              .join("\n")}${view.moreSuspended ? "\nAnd more" : ""}`,
                      ] as const,
                  ]
                : []),
        ],
        note: settings.enabled
            ? `All members together may use a right ${RIGHTS_SERVER_FACTOR} times its limit. Lift a suspension with ${code(`${prefix}mod rights clear @member`)}`
            : `Turn it on with ${code(`${prefix}mod rights on`)}, for the server owner`,
    }
}
const said = (operation: RightsOperation) => {
    switch (operation.type) {
        case "module":
            return operation.enabled
                ? "Bot-only rights on. Roles act through NeonFlux only with a right you grant, within limits"
                : "Bot-only rights off. Staff need the real Fluxer permission again, and the grants stay stored"
        case "grant":
            return `${format.roleMention(operation.roleId)} now holds ${operation.rights.join(", ")}`
        case "revoke":
            return operation.rights
                ? `${format.roleMention(operation.roleId)} no longer holds ${operation.rights.join(", ")}`
                : `${format.roleMention(operation.roleId)} no longer holds any right`
        case "limit":
            return `A member may now use ${operation.right} ${operation.count} times in ${operation.minutes} minutes. All members together may use it ${operation.count * RIGHTS_SERVER_FACTOR} times`
        case "clear":
            return `${format.userMention(operation.userId)} may use their rights again, and their count starts over`
    }
}
/** !mod rights. A grant's role must be one NeonFlux can see in this server, from a fresh read */
export function handleRightsCommand(
    store: RightsStore | undefined,
    config: BotConfig,
    command: RightsCommand,
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId),
        reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId
        if (!store) {
            yield* reply(notSetUp("Bot-only rights"))
            return
        }
        const authority: SafetyAuthority = yield* readSafetyAuthority(client, serverId, message.author.id)
        const actor = moderationActor(authority)
        if (command.type === "status") {
            yield* replyCard(context, serverId, rightsCard(yield* store.status({ serverId, actor }), prefix))
            return
        }
        const { operation } = command
        if (rightsOwnerOnly(operation) ? !authority.isOwner : !authority.isOwner && !authority.isAdmin) {
            yield* reply(ownerOnly)
            return
        }
        if (operation.type === "grant" && !authority.roles.some((role) => role.id === operation.roleId)) {
            yield* reply("NeonFlux cannot see that role in this server. Check it and try again")
            return
        }
        const result = yield* store.manage({
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
            actor,
            operation,
        })
        yield* rightsRuntimes.get(serverId)?.changed(result.settings) ?? Effect.void
        // A grant is stored either way, and counts once the role ranks below NeonFlux, so the owner learns why it does nothing yet
        const role =
            operation.type === "grant" ? authority.roles.find((item) => item.id === operation.roleId) : undefined
        const above =
            role &&
            !hierarchy.canManageRole({ guild: authority.guild, actor: authority.bot, role, roles: authority.roles })
        yield* reply(
            `${said(operation)}${above ? ". It counts only once the role ranks below NeonFlux, so move NeonFlux's role above it" : ""}`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
