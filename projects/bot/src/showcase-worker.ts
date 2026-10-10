import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import { fixSentence } from "./permission-fix.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import type { ShowcaseStore } from "./showcase-store.ts"

/** A fresh read of the member who sent a website request, with the name the bot's posts show */
export function readMemberContent(client: Client, serverId: string, userId: string) {
    return readSafetyAuthority(client, serverId, userId).pipe(Effect.map((authority): C.MemberContentContext => ({ userId, userName: (authority.actor.nickname ?? authority.actor.username).slice(0, 100),
        roleIds: [...authority.actor.roleIds], isBot: authority.actor.isBot, timeoutUntil: authority.actor.communicationDisabledUntil ?? null, botId: authority.botId })))
}
// What the member's request names when the bot could not post or delete in the showcase channel
const postingFix = fixSentence({ permissions: ["ViewChannel", "SendMessages", "EmbedLinks"] })
const permissionRefused = (diagnostic: { failureClass: string, status?: number }) => diagnostic.failureClass === "PublishingPermissionError" || diagnostic.status === 403

// Website showcase requests from the dashboard job queue. The bot reads the member fresh, the backend decides with the current settings, access
// lists, limits and automod rules, and the bot sends or edits its message through publishing, which never repeats an unconfirmed send
export function processShowcasePass(store: ShowcaseStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const ready = yield* store.ready({ serverId })
        for (const job of ready.jobs) yield* Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= job.expiresAt) return
            const member = yield* readMemberContent(client, serverId, job.actorId)
            const started = yield* store.start({ serverId, jobId: job.id, actorId: job.actorId, member })
            if (started.grant) {
                const result = yield* performPublishingGrant(publishing, serverId, member.botId, client, started.grant)
                const fix = result.outcome === "failed" && result.diagnostics?.some(permissionRefused) ? postingFix : undefined
                yield* store.complete({ serverId, jobId: job.id, ...(fix ? { fix } : {}) })
            } else if (started.remove) {
                // Deleting is safe to repeat, and a message that is already gone counts as deleted. The bot deletes its own message, which needs only View Channel
                const outcome = yield* client.messages.delete({ channelId: started.remove.channelId, id: started.remove.messageId }, { timeoutMs: 5000 }).pipe(Effect.as({ removed: true }),
                    Effect.catch(error => { const failure = error as { reason?: unknown, status?: unknown }
                        return Effect.succeed(failure.reason === "notFound" ? { removed: true } : { removed: false, ...(failure.status === 403 ? { fix: fixSentence({ permissions: ["ViewChannel"] }) } : {}) }) }))
                yield* store.complete({ serverId, jobId: job.id, ...outcome })
            }
        }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : store.fail({ serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
    })
}
