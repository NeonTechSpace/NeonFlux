import { ONBOARDING_STEPS, OnboardingOperation, type OnboardingSettings, type OnboardingStep } from "@neonflux/contracts/onboarding"
import { decode, fail, name } from "./validation.ts"

/** The consumer key of the completion role in the role ownership references */
export const ONBOARDING_ROLE_KEY = "onboarding"
export const defaultOnboarding = (): OnboardingSettings => ({ enabled: false, delivery: "welcome", steps: [], completionRoleId: null })

// Steps keep names in lowercase and a link step's line without surrounding space
const onboardingStep = (step: OnboardingStep): OnboardingStep =>
    step.type === "panel" || step.type === "menu" ? { type: step.type, name: name(step.name) } : step.type === "link" ? { ...step, text: step.text.trim() } : step
/** Two steps are the same when they name the same rules, panel, menu or channel */
export const stepKey = (step: OnboardingStep) => step.type === "rules" ? "rules" : step.type === "link" ? `link:${step.channelId}` : `${step.type}:${step.name}`
export function onboardingSteps(value: readonly OnboardingStep[]): OnboardingStep[] {
    if (value.length > ONBOARDING_STEPS) fail(400, `A checklist has at most ${ONBOARDING_STEPS} steps`)
    const steps = value.map(onboardingStep)
    if (new Set(steps.map(stepKey)).size !== steps.length) fail(409, "This step is already on the checklist")
    return steps
}
export function onboardingOperation(value: unknown): OnboardingOperation {
    const op = decode(OnboardingOperation, value)
    return op.type === "step-add" ? { type: op.type, step: onboardingStep(op.step) } : op.type === "steps" ? { type: op.type, steps: onboardingSteps(op.steps) } : op
}
