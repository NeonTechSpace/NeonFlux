import { errors, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"

export class MemberEvidenceError extends Data.TaggedError("MemberEvidenceError")<{ readonly stage: "identity" }> {}

/** A member read from Fluxer. Evaluation passes cached to use the SDK's member cache, which member events and the member Fluxer attaches to messages keep current, and reads only on a miss */
export function readNativeMember(
    client: Client,
    serverId: string,
    userId: string,
    options: { allowAbsent?: boolean; cached?: boolean } = {},
) {
    // Capture the exact read target before dispatch
    const target = Object.freeze({ guildId: serverId, userId })
    const fresh = client.members
        .fetch(target, { timeoutMs: 5000 })
        .pipe(
            Effect.catch((error) =>
                options.allowAbsent !== false && errors.isNotFound(error, "member")
                    ? Effect.succeed(undefined)
                    : Effect.fail(error),
            ),
        )
    return (
        options.cached
            ? client.members.get(target).pipe(Effect.flatMap((member) => (member ? Effect.succeed(member) : fresh)))
            : fresh
    ).pipe(
        Effect.flatMap((member) =>
            member && (member.guildId !== target.guildId || member.userId !== target.userId)
                ? Effect.fail(new MemberEvidenceError({ stage: "identity" }))
                : Effect.succeed({ originServerId: target.guildId, userId: target.userId, member }),
        ),
    )
}
