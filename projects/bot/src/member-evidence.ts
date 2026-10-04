import { GuildOperationError, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"

export class MemberEvidenceError extends Data.TaggedError("MemberEvidenceError")<{ readonly stage: "identity" }> {}

export function readNativeMember(client: Client, serverId: string, userId: string, options: { allowAbsent?: boolean } = {}) {
    // Capture the exact read target before dispatch. A typed 404 has no resource body.
    const target = Object.freeze({ guildId: serverId, userId })
    return client.members.fetch(target, { timeoutMs: 5000 }).pipe(
        Effect.timeout("5 seconds"),
        Effect.catch(error => options.allowAbsent !== false && error instanceof GuildOperationError && error.operation === "members.fetch"
            && error.reason === "notFound" && error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error)),
        Effect.flatMap(member => member && (member.guildId !== target.guildId || member.userId !== target.userId)
            ? Effect.fail(new MemberEvidenceError({ stage: "identity" }))
            : Effect.succeed({ userId: target.userId, member })),
    )
}

