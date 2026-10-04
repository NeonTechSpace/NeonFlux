import type * as C from "@neonflux/backend/contracts"
import { ChannelOperationError, ChannelType, MessageError, MessageOperationError, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Exit } from "effect"
import { randomUUID } from "node:crypto"
import { equalPublishingContent, publishingMessageContent, canonicalPublishingContent } from "./publishing-content.ts"
import { verifyPublishingMessage } from "./publishing-permissions.ts"
import { noMentions } from "./responses.ts"
import { nativeTicketOverwrites, readTicketAuthority, snapshotTicketChannel, verifyTicketChannelIdentity, verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import type { TicketStore } from "./ticket-store.ts"

export class TicketHandlingError extends Data.TaggedError("TicketHandlingError")<{ readonly stage: "grant" | "identity" | "snapshot" | "claim" | "content" | "chain" | "transcript" }> {}
export const ticketBinding = (serverId: string, grant: C.TicketActionGrant): C.TicketBinding => ({ serverId, ticketNo: grant.ticketNo,
    generation: grant.generation, attemptId: grant.attemptId, sourceId: grant.sourceId })
const sendMask = Permissions.SendMessages
const bits = (entry: C.TicketOverwrite | undefined) => ({ allow: BigInt(entry?.allow ?? "0") & sendMask, deny: BigInt(entry?.deny ?? "0") & sendMask })
const target = (channel: C.TicketChannelSnapshot, id: string) => channel.overwrites.find(entry => entry.id === id)
// Renaming or moving a ticket channel does not block its lifecycle
const sameProfile = (a: C.TicketChannelSnapshot, b: C.TicketChannelSnapshot) => a.channelId === b.channelId && a.serverId === b.serverId
    && a.type === b.type
const sameOwned = (a: C.TicketChannelSnapshot, b: C.TicketChannelSnapshot, serverId: string, requesterId: string) => sameProfile(a, b)
    && [serverId, requesterId].every(id => { const x = bits(target(a, id)), y = bits(target(b, id)); return x.allow === y.allow && x.deny === y.deny })
const sameOverwrites = (a: readonly C.TicketOverwrite[], b: readonly C.TicketOverwrite[]) => a.length === b.length && a.every((entry, index) => {
    const other = b[index]!
    return entry.id === other.id && entry.type === other.type && entry.allow === other.allow && entry.deny === other.deny
})
const equalSnapshot = (a: C.TicketChannelSnapshot, b: C.TicketChannelSnapshot) => sameProfile(a, b) && sameOverwrites(a.overwrites, b.overwrites)

/** Compare only the two owned SendMessages bits. Other bits remain provider observations */
export function mergeTicketSendOverwrite(current: C.TicketChannelSnapshot, desired: C.TicketOverwrite) {
    const previous = target(current, desired.id)
    if (previous && previous.type !== desired.type) throw new TicketHandlingError({ stage: "snapshot" })
    return { id: desired.id, type: desired.type, allow: ((BigInt(previous?.allow ?? "0") & ~sendMask) | (BigInt(desired.allow) & sendMask)).toString(),
        deny: ((BigInt(previous?.deny ?? "0") & ~sendMask) | (BigInt(desired.deny) & sendMask)).toString() }
}

function noDefeatingSend(channel: C.TicketChannelSnapshot, grant: C.TicketActionGrant) {
    return channel.overwrites.every(entry => !(BigInt(entry.allow) & sendMask) || entry.id === channel.serverId || entry.id === grant.requesterId
        || entry.id === grant.botId || entry.type === "role" && grant.supportRoleIds.includes(entry.id))
}
function audienceMatches(channel: C.TicketChannelSnapshot, grant: C.TicketActionGrant) {
    if (grant.visibility !== "private") return true
    const everyone = target(channel, channel.serverId)
    return !!everyone && !(BigInt(everyone.allow) & Permissions.ViewChannel) && !!(BigInt(everyone.deny) & Permissions.ViewChannel)
        && channel.overwrites.every(entry => !(BigInt(entry.allow) & Permissions.ViewChannel) || entry.id === grant.botId
            || entry.id === grant.requesterId || entry.type === "role" && grant.supportRoleIds.includes(entry.id))
}

/** Execute one reservation once. A denied or unknown claim cannot finalize another invocation */
export function performTicketGrant(store: TicketStore, serverId: string, client: Client, grant: C.TicketActionGrant, privateChannelId?: string) {
    return Effect.suspend(() => {
        const binding = ticketBinding(serverId, grant), claimToken = randomUUID().replaceAll("-", "")
        let claimRequested = false, ownsClaim = false, nativeInvoked = false, nativeStage = false
        let canAbandon = false, channelId: string | undefined, messageId: string | undefined, channel: C.TicketChannelSnapshot | undefined
        let observedAt: number | undefined, channelAbsent = false, nativeDeleteConfirmed = false
        const write = Effect.gen(function* () {
            if (grant.nativeDeadlineMs !== 5000 || !Number.isSafeInteger(grant.dispatchExpiresAt) || !grant.actorId || !grant.botId) return yield* Effect.fail(new TicketHandlingError({ stage: "grant" }))
            canAbandon = true
            if ((yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new TicketHandlingError({ stage: "grant" }))
            const create = grant.action === "create", message = grant.action === "introduction" || grant.action === "reply", remove = grant.action === "delete"
            const permission = create ? Permissions.ManageChannels | Permissions.ManageRoles : message
                ? Permissions.ViewChannel | Permissions.SendMessages | (grant.content?.embed ? Permissions.EmbedLinks : 0n)
                : remove ? Permissions.ViewChannel | Permissions.ManageChannels : Permissions.ViewChannel | Permissions.ManageRoles
            const authority = yield* readTicketAuthority(client, serverId, grant.actorId, {
                ...(grant.channelId ? { channelId: grant.channelId } : {}), ...(create && grant.parentId ? { parentId: grant.parentId } : {}), botPermission: permission,
            })
            if (authority.botId !== grant.botId || create && (authority.actor.userId !== grant.requesterId || authority.actor.joinedAt !== grant.requesterJoinedAt)) {
                return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
            }
            let context = authority.context
            if (privateChannelId) {
                const dm = yield* verifyTicketPrivateAuthor(client, privateChannelId, grant.actorId)
                if (dm.botId !== grant.botId) return yield* Effect.fail(new TicketHandlingError({ stage: "identity" }))
                context = { ...context, actor: { ...context.actor, privateChannelVerified: true, privateChannelId } }
            }
            let merged: C.TicketOverwrite | undefined
            if (!create) {
                if (!grant.channelId || !authority.context.channel || !grant.expectedChannel || authority.context.channel.channelId !== grant.channelId) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                const current = authority.context.channel
                if (!audienceMatches(current, grant)) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                if (message || remove) {
                    if (!equalSnapshot(current, grant.expectedChannel)) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                } else {
                    if (!sameOwned(current, grant.expectedChannel, serverId, grant.requesterId) || !noDefeatingSend(current, grant)
                        || !grant.targetOverwrite || !grant.desiredChannel || ![serverId, grant.requesterId].includes(grant.targetOverwrite.id)) {
                        return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                    }
                    merged = yield* Effect.try({ try: () => mergeTicketSendOverwrite(current, grant.targetOverwrite!), catch: () => new TicketHandlingError({ stage: "snapshot" }) })
                    yield* nativeTicketOverwrites([merged])
                }
            } else if (!grant.channelName || !grant.overwrites || !grant.overwrites.length) return yield* Effect.fail(new TicketHandlingError({ stage: "grant" }))
            if (message && !grant.content) return yield* Effect.fail(new TicketHandlingError({ stage: "content" }))
            const createOverwrites = create ? yield* nativeTicketOverwrites(grant.overwrites!) : undefined
            claimRequested = true
            const claim = yield* store.dispatch({ ...binding, claimToken, context })
            if (!claim.claimed || claim.dispatchExpiresAt !== grant.dispatchExpiresAt || claim.nativeDeadlineMs !== 5000) return yield* Effect.fail(new TicketHandlingError({ stage: "claim" }))
            ownsClaim = true
            if ((yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new TicketHandlingError({ stage: "claim" }))
            nativeStage = true, nativeInvoked = true
            if (create) {
                const returned = yield* client.channels.create(serverId, { type: ChannelType.Text, name: grant.channelName!, parentId: grant.parentId ?? null,
                    permissionOverwrites: createOverwrites! }).pipe(Effect.timeout("5 seconds"))
                nativeStage = false
                const identity = yield* verifyTicketChannelIdentity(returned, { serverId })
                channelId = identity.channelId
                channel = yield* snapshotTicketChannel(returned)
                if (channel.name !== grant.channelName || channel.parentId !== (grant.parentId ?? null) || !sameOverwrites(channel.overwrites, grant.overwrites!)) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                const fresh = yield* client.channels.fetch(channelId).pipe(Effect.timeout("5 seconds"))
                yield* verifyTicketChannelIdentity(fresh, { serverId, channelId })
                const observed = yield* snapshotTicketChannel(fresh)
                if (!equalSnapshot(observed, channel) || !audienceMatches(observed, grant)) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                channel = observed, observedAt = yield* Clock.currentTimeMillis
            } else if (message) {
                const returned = yield* client.messages.send(grant.channelId!, { content: grant.content!.content, embeds: grant.content!.embed ? [grant.content!.embed] : [], allowedMentions: noMentions }).pipe(Effect.timeout("5 seconds"))
                nativeStage = false
                yield* verifyPublishingMessage(returned, { serverId, channelId: grant.channelId!, messageId: returned.id, botId: grant.botId, verifiedChannel: authority.channel! })
                channelId = grant.channelId, messageId = returned.id
                const comparable = publishingMessageContent(returned)
                if (!comparable || !equalPublishingContent(comparable, canonicalPublishingContent(grant.content!))) return yield* Effect.fail(new TicketHandlingError({ stage: "content" }))
                observedAt = yield* Clock.currentTimeMillis
            } else if (remove) {
                channelId = grant.channelId
                yield* client.channels.delete(channelId!).pipe(Effect.timeout("5 seconds"))
                nativeDeleteConfirmed = true, nativeStage = false
                const after = yield* client.channels.fetch(channelId!).pipe(Effect.timeout("5 seconds"), Effect.catch(error => error instanceof ChannelOperationError && error.reason === "notFound" && error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error)))
                if (after !== undefined) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                channelAbsent = true, observedAt = yield* Clock.currentTimeMillis
            } else {
                channelId = grant.channelId
                const overwrite = (yield* nativeTicketOverwrites([merged!]))[0]!
                yield* client.channels.setPermissionOverwrite(channelId!, overwrite).pipe(Effect.timeout("5 seconds"))
                nativeStage = false
                const after = yield* client.channels.fetch(channelId!).pipe(Effect.timeout("5 seconds"))
                yield* verifyTicketChannelIdentity(after, { serverId, channelId: channelId! })
                channel = yield* snapshotTicketChannel(after)
                if (!sameOwned(channel, grant.desiredChannel!, serverId, grant.requesterId) || !noDefeatingSend(channel, grant)
                    || !audienceMatches(channel, grant)) return yield* Effect.fail(new TicketHandlingError({ stage: "snapshot" }))
                observedAt = yield* Clock.currentTimeMillis
            }
        })
        const complete = Effect.gen(function* () {
            const result = yield* Effect.exit(write)
            const proof = Exit.isFailure(result) && nativeStage && result.cause.reasons.length > 0 && result.cause.reasons.every(reason => reason._tag === "Fail"
                && (reason.error instanceof ChannelOperationError || reason.error instanceof MessageError || reason.error instanceof MessageOperationError) && reason.error.outcome === "notDispatched")
            const noDispatch = Exit.isFailure(result) && (!nativeInvoked || proof)
            const outcome = Exit.isSuccess(result) ? "succeeded" as const : noDispatch ? "failed" as const : "uncertain" as const
            if (!ownsClaim && (claimRequested || !canAbandon)) return { outcome: "uncertain" as const, recorded: false }
            const acknowledgement = yield* store.outcome({ ...binding, ...(ownsClaim ? { claimToken } : {}), outcome, ...(noDispatch ? { noDispatch: true as const } : {}),
                ...(!noDispatch && channelId ? { channelId } : {}), ...(!noDispatch && channel ? { channel } : {}), ...(!noDispatch && messageId ? { messageId } : {}), ...(!noDispatch && observedAt !== undefined ? { observedAt } : {}),
                ...(channelAbsent ? { channelAbsent: true as const } : {}), ...(nativeDeleteConfirmed ? { nativeDeleteConfirmed: true as const } : {}) }).pipe(Effect.match({
                    onFailure: () => ({ recorded: false }),
                    onSuccess: value => value,
                }))
            return { ...acknowledgement, outcome, ...(channelId ? { channelId } : {}), ...(messageId ? { messageId } : {}), nativeDeleteConfirmed }
        })
        return complete.pipe(Effect.onInterrupt(() => Effect.gen(function* () {
            if (!ownsClaim || !nativeInvoked) return
            // onInterrupt masks finalization, while timeout runs an interruptible acknowledgement child.
            yield* store.outcome({ ...binding, claimToken, outcome: "uncertain",
                ...(channelId ? { channelId } : {}), ...(channel ? { channel } : {}), ...(messageId ? { messageId } : {}),
                ...(observedAt !== undefined ? { observedAt } : {}), ...(channelAbsent ? { channelAbsent: true as const } : {}),
                ...(nativeDeleteConfirmed ? { nativeDeleteConfirmed: true as const } : {}) }).pipe(Effect.interruptible, Effect.timeout("5 seconds"), Effect.catchCause(() => Effect.void))
        })))
    })
}

export function performTicketChain(store: TicketStore, serverId: string, client: Client, initial: C.TicketActionGrant, privateChannelId?: string) {
    return Effect.gen(function* () {
        let grant = initial
        const results: Effect.Success<ReturnType<typeof performTicketGrant>>[] = []
        const attempts = new Set<string>()
        for (let step = 0; step < 2; step++) {
            if (attempts.has(grant.attemptId) || grant.ticketNo !== initial.ticketNo || grant.actorId !== initial.actorId || grant.botId !== initial.botId
                || grant.requesterId !== initial.requesterId || grant.sourceId !== initial.sourceId) return yield* Effect.fail(new TicketHandlingError({ stage: "chain" }))
            attempts.add(grant.attemptId)
            const result = yield* performTicketGrant(store, serverId, client, grant, privateChannelId)
            results.push(result)
            if (result.outcome !== "succeeded" || !result.recorded || !("grant" in result) || !result.grant) return results
            const next = result.grant
            const expected = grant.action === "create" ? "introduction" : grant.action === "close-everyone" ? "close-requester" : grant.action === "reopen-requester" ? "reopen-everyone" : undefined
            if (next.action !== expected || next.generation <= grant.generation) return yield* Effect.fail(new TicketHandlingError({ stage: "chain" }))
            grant = next
        }
        return results
    })
}
