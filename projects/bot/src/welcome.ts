import type * as C from "@neonflux/backend/contracts"
import { MessageError, MessageOperationError, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import { randomUUID } from "node:crypto"
import { canonicalPublishingContent, equalPublishingContent, publishingMessageContent } from "./publishing-content.ts"
import { noMentions } from "./responses.ts"
import { readWelcomeDestination, readWelcomeMember, verifyWelcomeMessage, verifyWelcomePrivateChannel } from "./welcome-permissions.ts"
import type { GreetingsStore } from "./welcome-store.ts"
import { publishingDiagnostic } from "./publishing.ts"

export class GreetingsHandlingError extends Data.TaggedError("GreetingsHandlingError")<{ readonly stage: "membership" | "destination" | "claim" | "identity" | "content" }> {}
export type GreetingsCandidate = C.GreetingsPendingResult["candidates"][number]
export const greetingsBinding = (serverId: string, grant: Omit<C.GreetingsBinding, "serverId">): C.GreetingsBinding => ({ serverId, deliveryId: grant.deliveryId, route: grant.route,
    routeRevision: grant.routeRevision, userId: grant.userId, joinedAt: grant.joinedAt, memberGeneration: grant.memberGeneration })

export function readGreetingsContext(client: Client, serverId: string, candidate: Omit<C.GreetingsBinding, "serverId">, channelId?: string, hasEmbed = false) {
    return Effect.gen(function* () {
        const facts = yield* readWelcomeMember(client, serverId, candidate.userId, { allowAbsent: true })
        if (candidate.route === "goodbye") {
            if (!facts.memberAbsent && facts.context?.joinedAt !== candidate.joinedAt) return { context: {
                originServerId: facts.guild.id, memberOriginServerId: facts.memberOriginServerId, memberUserId: facts.memberUserId, botId: facts.botId, botAuthorized: false, observedAt: facts.observedAt, member: facts.context, memberAbsent: false,
            } satisfies C.GreetingsContext, verifiedChannel: undefined }
        }
        const destination = channelId ? yield* readWelcomeDestination(client, serverId, channelId, hasEmbed) : undefined
        if (destination && destination.botId !== facts.botId) return yield* Effect.fail(new GreetingsHandlingError({ stage: "identity" }))
        return { context: { originServerId: facts.guild.id, botId: facts.botId, botAuthorized: destination?.botAuthorized ?? true, observedAt: facts.observedAt,
            memberOriginServerId: facts.memberOriginServerId, memberUserId: facts.memberUserId, member: facts.context, memberAbsent: facts.memberAbsent, ...(channelId ? { channelId } : {}) } satisfies C.GreetingsContext,
            ...(destination ? { verifiedChannel: { id: destination.channel.id, guildId: serverId } } : {}) }
    })
}

export function performGreetingsGrant(store: GreetingsStore, serverId: string, client: Client, grant: C.GreetingsGrant,
    authority?: Effect.Success<ReturnType<typeof readGreetingsContext>>) {
    return Effect.gen(function* () {
        const tuple = greetingsBinding(serverId, grant)
        const claimToken = randomUUID().replaceAll("-", "")
        let claimRequested = false
        let ownsClaim = false
        let nativeInvoked = false
        let dmOpenInvoked = false
        let dmOpened = false
        let nativeStage = false
        let messageId: string | undefined
        let channelId: string | undefined
        const write = Effect.gen(function* () {
            if (grant.nativeDeadlineMs !== 5000 || (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new GreetingsHandlingError({ stage: "claim" }))
            const facts = authority ?? (yield* readGreetingsContext(client, serverId, grant, grant.channelId, !!grant.content.embed))
            const context = facts.context
            if (context.botId !== grant.botId) return yield* Effect.fail(new GreetingsHandlingError({ stage: "identity" }))
            claimRequested = true
            const claim = yield* store.dispatch({ ...tuple, claimToken, context })
            if (!claim.claimed || claim.dispatchExpiresAt !== grant.dispatchExpiresAt || claim.nativeDeadlineMs !== 5000) return yield* Effect.fail(new GreetingsHandlingError({ stage: "claim" }))
            ownsClaim = true
            const verifiedChannel = facts.verifiedChannel
            if (grant.route === "dm") {
                dmOpenInvoked = true
                const dm = yield* client.directMessages.open(grant.userId, { timeoutMs: 5000 })
                dmOpened = true
                yield* verifyWelcomePrivateChannel(dm, grant.userId, grant.botId)
                channelId = dm.id
            } else {
                if (!grant.channelId) return yield* Effect.fail(new GreetingsHandlingError({ stage: "destination" }))
                if (!verifiedChannel || verifiedChannel.id !== grant.channelId || verifiedChannel.guildId !== serverId) return yield* Effect.fail(new GreetingsHandlingError({ stage: "identity" }))
                channelId = grant.channelId
            }
            if ((yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new GreetingsHandlingError({ stage: "claim" }))
            nativeStage = true
            nativeInvoked = true
            // Only the greeted member can be notified, through an explicit {user.mention}
            const allowedMentions = { ...noMentions, users: [grant.userId] }
            const message = { content: grant.content.content, embeds: grant.content.embed ? [grant.content.embed] : [], allowedMentions }
            const returned = yield* client.messages.send(channelId!, message, { timeoutMs: 5000 })
            nativeStage = false
            yield* verifyWelcomeMessage(returned, { botId: grant.botId, channelId: channelId!, ...(verifiedChannel ? { serverId, verifiedChannel } : {}) })
            messageId = returned.id
            const comparable = publishingMessageContent(returned)
            if (!comparable || !equalPublishingContent(comparable, canonicalPublishingContent(grant.canonicalContent))) return yield* Effect.fail(new GreetingsHandlingError({ stage: "content" }))
        })
        const result = yield* Effect.exit(write)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        const nativeNoDispatch = Exit.isFailure(result) && nativeStage && result.cause.reasons.length > 0 && result.cause.reasons.every((reason) => reason._tag === "Fail"
            && (reason.error instanceof MessageError || reason.error instanceof MessageOperationError) && reason.error.outcome === "notDispatched")
        const noDispatch = Exit.isFailure(result) && (!nativeInvoked && !dmOpenInvoked || nativeNoDispatch)
        const outcome = Exit.isSuccess(result) ? "sent" as const : noDispatch ? "failed" as const : "uncertain" as const
        const failure = Exit.isFailure(result) ? result.cause.reasons.find((reason) => reason._tag === "Fail" || reason._tag === "Die") : undefined
        const diagnostic = failure ? publishingDiagnostic(nativeStage ? "native" : nativeInvoked ? "readback" : claimRequested ? "claim" : "authorization", failure._tag === "Fail" ? failure.error : undefined) : undefined
        if (!ownsClaim && claimRequested) return { outcome: "uncertain" as const, recorded: false, dmOpened, ...(diagnostic ? { diagnostic } : {}) }
        const acknowledgement = yield* store.outcome({ ...tuple, ...(ownsClaim ? { claimToken } : {}), outcome,
            ...(noDispatch ? { noDispatch: true as const } : {}), ...(messageId ? { messageId, channelId: channelId! } : {}) }).pipe(Effect.match({
                onFailure: (error) => ({ recorded: false, diagnostic: publishingDiagnostic("acknowledgement", error) }),
                onSuccess: (recorded) => ({ recorded: recorded.recorded, diagnostic }),
            }))
        return { outcome, recorded: acknowledgement.recorded, dmOpened, ...(messageId ? { messageId, channelId } : {}),
            ...(acknowledgement.diagnostic ? { diagnostic: acknowledgement.diagnostic } : {}) }
    })
}

export function processGreetingsCandidate(store: GreetingsStore, serverId: string, client: Client, candidate: GreetingsCandidate) {
    return Effect.gen(function* () {
        const facts = yield* readGreetingsContext(client, serverId, candidate, candidate.channelId, candidate.hasEmbed)
        const reserved = yield* store.reserve({ ...greetingsBinding(serverId, candidate), context: facts.context })
        if (reserved.status !== "reserved") return reserved.status
        const result = yield* performGreetingsGrant(store, serverId, client, reserved.grant, facts)
        if (result.diagnostic) yield* Effect.logWarning("Greeting delivery could not be confirmed", result.diagnostic)
        return result.recorded ? result.outcome : "uncertain"
    })
}
