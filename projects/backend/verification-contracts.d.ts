import type { api } from "./convex/_generated/api.js"
import type { Doc } from "./convex/_generated/dataModel.js"
/** The verification functions the website server calls, typed by their own definitions */
export type VerificationApi = typeof api.verification
export type VerificationStatus = Doc<"verificationLinks">["status"]
export interface VerificationView {
    challengeId: string
    serverId: string
    panelName: string
    status: VerificationStatus
    linkExpiresAt: number
    expiresAt: number
    attemptsRemaining: number
    instruction: string
    motionFrames?: string
    deliveryOutcome?: "succeeded" | "failed"
}
