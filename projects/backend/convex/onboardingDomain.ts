import type { OnboardingOperation, OnboardingSettings, OnboardingStep } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { bool, fail, integer, name, object, requireId, text } from "./validation.ts"

/** A checklist has at most five steps, and a link step's line at most 100 characters */
export const ONBOARDING_STEPS = 5, ONBOARDING_TEXT = 100
/** The consumer key of the completion role in the role ownership references */
export const ONBOARDING_ROLE_KEY = "onboarding"
export const defaultOnboarding = (): OnboardingSettings => ({ enabled: false, delivery: "welcome", steps: [], completionRoleId: null })

export function onboardingStep(value: unknown): OnboardingStep {
    const input = object(value)
    if (input.type === "rules") { shape(input, ["type"], ["type"]); return { type: "rules" } }
    if (input.type === "panel" || input.type === "menu") { shape(input, ["type", "name"], ["type", "name"]); return { type: input.type, name: name(input.name) } }
    if (input.type === "link") {
        shape(input, ["type", "channelId", "text"], ["type", "channelId", "text"])
        if (typeof input.text !== "string" || input.text.trim().length > ONBOARDING_TEXT) fail(400, `A link step needs a line of 1 to ${ONBOARDING_TEXT} characters`)
        return { type: "link", channelId: requireId(input.channelId), text: text(input.text.trim(), ONBOARDING_TEXT) }
    }
    fail(400, "Unknown checklist step")
}
/** Two steps are the same when they name the same rules, panel, menu or channel */
export const stepKey = (step: OnboardingStep) => step.type === "rules" ? "rules" : step.type === "link" ? `link:${step.channelId}` : `${step.type}:${step.name}`
export function onboardingSteps(value: unknown): OnboardingStep[] {
    if (!Array.isArray(value) || value.length > ONBOARDING_STEPS) fail(400, `A checklist has at most ${ONBOARDING_STEPS} steps`)
    const steps = value.map(onboardingStep)
    if (new Set(steps.map(stepKey)).size !== steps.length) fail(409, "This step is already on the checklist")
    return steps
}
export function onboardingOperation(value: unknown): OnboardingOperation {
    const input = object(value)
    switch (input.type) {
        case "module": shape(input, ["type", "enabled"], ["type", "enabled"]); return { type: "module", enabled: bool(input.enabled) }
        case "delivery":
            shape(input, ["type", "delivery"], ["type", "delivery"])
            if (input.delivery !== "welcome" && input.delivery !== "dm") fail(400, "The checklist goes with the welcome or the DM greeting")
            return { type: "delivery", delivery: input.delivery }
        case "step-add": shape(input, ["type", "step"], ["type", "step"]); return { type: "step-add", step: onboardingStep(input.step) }
        case "step-remove": shape(input, ["type", "position"], ["type", "position"]); return { type: "step-remove", position: integer(input.position, 1, ONBOARDING_STEPS) }
        case "steps": shape(input, ["type", "steps"], ["type", "steps"]); return { type: "steps", steps: onboardingSteps(input.steps) }
        case "role": shape(input, ["type", "roleId"], ["type", "roleId"]); return { type: "role", roleId: input.roleId === null ? null : requireId(input.roleId) }
    }
    fail(400, "Unknown onboarding operation")
}
