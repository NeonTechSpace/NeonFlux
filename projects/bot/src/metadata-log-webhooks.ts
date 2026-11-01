import type { Client, GuildAuditLogEntryCreate } from "@neontechspace/fluxerly/effect"
import { Cause, Effect } from "effect"
import { remember } from "./optional-work.ts"

/** The name an audit entry recorded for its webhook, the new one first. A deleted webhook's only name is its old one */
function auditName(entry: GuildAuditLogEntryCreate) {
    const change = entry.changes?.find((item) => item.key === "name"),
        name = [change?.newValue, change?.oldValue].find((value) => typeof value === "string" && value.trim() !== "")
    return name as string | undefined
}

/**
 * A server's webhook names for log posts, kept in a bounded memory. A webhook message names itself, and may show a name of its own
 * for each post, so only audit entries and fresh reads fill the memory. An unknown webhook costs one read of it when logs would post,
 * and a failed read shows the ID, as does a deleted webhook whose entry recorded no name
 */
export function createWebhookNames() {
    const names = new Map<string, string>()
    return {
        /** The name of the webhook an audit entry is about */
        ofAudit: (client: Client, webhookId: string, entry: GuildAuditLogEntryCreate) =>
            Effect.gen(function* () {
                const recorded = auditName(entry)
                if (recorded) remember(names, webhookId, recorded)
                const known = names.get(webhookId)
                if (entry.actionType === 52) names.delete(webhookId)
                if (known || entry.actionType === 52) return known
                const read = yield* client.webhooks.fetch(webhookId, { timeoutMs: 5000 }).pipe(
                    Effect.map((webhook) => webhook.name),
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed(undefined),
                    ),
                )
                if (read) remember(names, webhookId, read)
                return read ?? undefined
            }),
    }
}
export type WebhookNames = ReturnType<typeof createWebhookNames>
