import { Schema } from "effect"
import { Id, Int, List, Millis, Str, Token } from "./common.ts"
import { ModerationActor, RolesMemberContext } from "./shared.ts"

// The bot side of advanced verification, see docs/WEB.md#web-verification. The website's own types stay in backend/verification-contracts.d.ts

const key = Str(256).check(Schema.isMinLength(1))
// A bot-made link or claim secret
const secret = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
// A panel name the backend matches in lowercase
const panelName = Schema.String.check(Schema.makeFilter((value: string) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.trim().toLowerCase())))

export const VerificationIssueRequest = Schema.Struct({ serverId: Id, sourceId: Token, createdAt: Millis, context: RolesMemberContext, panelName, revision: Int(1), messageId: Schema.String,
    panelVerified: Schema.Literal(true), reactionPresent: Schema.Literal(true), linkToken: secret })
export type VerificationIssueRequest = typeof VerificationIssueRequest.Type
export const VerificationIssueResult = Schema.Struct({ issued: Schema.Boolean, challengeId: Schema.optionalKey(key), expiresAt: Schema.optionalKey(Millis) })
    .check(Schema.makeFilter(value => value.issued === (value.challengeId !== undefined && value.expiresAt !== undefined)))
export type VerificationIssueResult = typeof VerificationIssueResult.Type
export const VerificationReady = Schema.Struct({ challengeId: key, userId: Id, joinedAt: key, panelName: key, revision: Int(), messageId: Id })
export type VerificationReady = typeof VerificationReady.Type
export const VerificationReadyRequest = Schema.Struct({ serverId: Id })
export type VerificationReadyRequest = typeof VerificationReadyRequest.Type
export const VerificationReadyResult = Schema.Struct({ requests: List(VerificationReady, 10) })
export type VerificationReadyResult = typeof VerificationReadyResult.Type
/** One proof by its challenge, which answers its VerificationReady */
export const VerificationRequestRequest = Schema.Struct({ serverId: Id, challengeId: Schema.String })
export type VerificationRequestRequest = typeof VerificationRequestRequest.Type
export const VerificationClaimRequest = Schema.Struct({ serverId: Id, challengeId: Schema.String, claimToken: secret, context: RolesMemberContext, panelVerified: Schema.Literal(true) })
export type VerificationClaimRequest = typeof VerificationClaimRequest.Type
export const VerificationClaimResult = Schema.Struct({ claimed: Schema.Boolean, sourceId: Schema.optionalKey(key), createdAt: Schema.optionalKey(Millis) })
    .check(Schema.makeFilter(value => value.claimed === (value.sourceId !== undefined && value.createdAt !== undefined)))
export type VerificationClaimResult = typeof VerificationClaimResult.Type
/** The bot confirmed the role, or the member left, which ends discovery of the proof */
export const VerificationDeliveryRequest = Schema.Struct({ serverId: Id, challengeId: Schema.String, outcome: Schema.Literals(["succeeded", "failed"]) })
export type VerificationDeliveryRequest = typeof VerificationDeliveryRequest.Type
export const VerificationDeliveryResult = Schema.Struct({ recorded: Schema.Boolean })
export type VerificationDeliveryResult = typeof VerificationDeliveryResult.Type
/** An Administrator's manual approval for a member who cannot complete the web challenge */
export const VerificationReviewRequest = Schema.Struct({ serverId: Id, challengeId: Schema.String, context: RolesMemberContext, actor: ModerationActor, panelVerified: Schema.Literal(true) })
export type VerificationReviewRequest = typeof VerificationReviewRequest.Type
export const VerificationReviewResult = Schema.Struct({ reviewed: Schema.Boolean })
export type VerificationReviewResult = typeof VerificationReviewResult.Type
