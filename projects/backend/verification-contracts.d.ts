import type { RolesMemberContext } from "./contracts.js"

export type VerificationStatus = "issued" | "started" | "solved" | "failed" | "expired" | "redeemed"
export interface VerificationView {
    challengeId: string
    serverId: string
    panelName: string
    status: VerificationStatus
    linkExpiresAt: number
    expiresAt: number
    attemptsRemaining: number
    instruction: string
    captchaKind?: "motion"
    round?: number
    roundCount?: number
    imageDataUri?: string
    motionFrames?: string
    deliveryOutcome?: "succeeded" | "failed"
}
export interface VerificationIssueRequest { serverId: string, sourceId: string, createdAt: number, context: RolesMemberContext, panelName: string, revision: number, messageId: string, panelVerified: true, reactionPresent: true, linkToken: string }
export interface VerificationIssueResult { issued: boolean, challengeId?: string, expiresAt?: number }
export interface VerificationReady { challengeId: string, userId: string, joinedAt: string, panelName: string, revision: number, messageId: string }
export interface VerificationClaimResult { claimed: boolean, sourceId?: string, createdAt?: number }
