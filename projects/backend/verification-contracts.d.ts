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
