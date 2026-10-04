import type * as C from "@neonflux/backend/contracts"
import { GuildOperationError, type Client, type GuildMember } from "@neontechspace/fluxerly/effect"
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

export function levelingMember(member: GuildMember, serverId: string, userId: string): Omit<C.SchedulesMemberContext, "canView" | "canReadHistory"> | undefined {
    if (member.guildId !== serverId || member.userId !== userId || member.communicationDisabledUntil === undefined
        || typeof member.joinedAt !== "string" || member.joinedAt.length > 64
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(member.joinedAt) || !Number.isFinite(Date.parse(member.joinedAt))) return
    return { userId, joinedAt: member.joinedAt, roleIds: [...member.roleIds], isBot: member.isBot, timeoutUntil: member.communicationDisabledUntil }
}
