import { Schema } from "effect"
import { Id, Int, List, Millis, Str, hasText, origin } from "./common.ts"
import { ModerationActor, RolesMemberContext, RolesRoleSnapshot } from "./shared.ts"

// The newcomer checklist, see docs/BOT.md#newcomer-checklist

/** A checklist has at most five steps, and a link step's line at most 100 characters */
export const ONBOARDING_STEPS = 5, ONBOARDING_TEXT = 100
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/
const step = (name: Schema.String, text: Schema.String) => Schema.Union([Schema.Struct({ type: Schema.Literal("rules") }), Schema.Struct({ type: Schema.Literal("panel"), name }),
    Schema.Struct({ type: Schema.Literal("menu"), name }), Schema.Struct({ type: Schema.Literal("link"), channelId: Id, text })])
// A step as a manager sends it. The backend lowercases the name and trims the line
const sentStep = step(Schema.String.check(Schema.makeFilter((value: string) => NAME.test(value.trim().toLowerCase()))),
    Schema.String.check(Schema.makeFilter((value: string) => value.trim().length <= ONBOARDING_TEXT && hasText(value))))
const delivery = Schema.Literals(["welcome", "dm"])

/**
 * One newcomer checklist step. rules is the rules verification, panel a reaction role panel and menu a role picker menu, each by name, and
 * link a channel to visit with a short line. Members finish rules by accepting the current rules, and a panel or menu step by holding one of
 * its roles. A link step is guidance that never needs finishing
 */
export const OnboardingStep = step(Schema.String.check(Schema.isPattern(NAME)), Str(ONBOARDING_TEXT).check(Schema.isMinLength(1)))
export type OnboardingStep = typeof OnboardingStep.Type
/** delivery is the greeting route that carries the checklist. completionRoleId is given once a member finishes every step */
export const OnboardingSettings = Schema.Struct({ enabled: Schema.Boolean, delivery, steps: List(OnboardingStep, ONBOARDING_STEPS), completionRoleId: Schema.NullOr(Id) })
export type OnboardingSettings = typeof OnboardingSettings.Type
/** step-remove names a position from 1. steps replaces the whole list. role null clears the completion role */
export const OnboardingOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("delivery"), delivery }),
    Schema.Struct({ type: Schema.Literal("step-add"), step: sentStep }),
    Schema.Struct({ type: Schema.Literal("step-remove"), position: Int(1, ONBOARDING_STEPS) }),
    Schema.Struct({ type: Schema.Literal("steps"), steps: List(sentStep, ONBOARDING_STEPS) }),
    Schema.Struct({ type: Schema.Literal("role"), roleId: Schema.NullOr(Id) }),
])
export type OnboardingOperation = typeof OnboardingOperation.Type
/** What the bot keeps in memory. roleSteps holds, for each step a member finishes by a role, the roles that can finish it */
export const OnboardingView = Schema.Struct({ revision: Int(), settings: OnboardingSettings, roleSteps: List(Schema.mutable(Schema.Array(Id)), ONBOARDING_STEPS) })
export type OnboardingView = typeof OnboardingView.Type
export const OnboardingGetRequest = Schema.Struct({ serverId: Id })
export type OnboardingGetRequest = typeof OnboardingGetRequest.Type
/** roles are fresh snapshots of the completion role a role operation names */
export const OnboardingManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, roles: Schema.optionalKey(List(RolesRoleSnapshot, 1000)),
    operation: OnboardingOperation })
export type OnboardingManageRequest = typeof OnboardingManageRequest.Type
/** done and open steps need finishing, and info is a link step. Steps whose panel, menu or rules verification is unavailable are left out */
export const OnboardingStepState = Schema.Literals(["done", "open", "info"])
export type OnboardingStepState = typeof OnboardingStepState.Type
export const OnboardingMemberRequest = Schema.Struct({ serverId: Id, context: RolesMemberContext })
export type OnboardingMemberRequest = typeof OnboardingMemberRequest.Type
/** complete means the member finished the checklist during this membership. grant names the completion role change the bot should evaluate */
export const OnboardingProgress = Schema.Struct({ enabled: Schema.Boolean, steps: List(Schema.Struct({ text: Str(300).check(Schema.isMinLength(1)), state: OnboardingStepState }), ONBOARDING_STEPS),
    complete: Schema.Boolean, completedAt: Schema.optionalKey(Millis), grant: Schema.optionalKey(Schema.Struct({ sourceId: Schema.String, roleId: Id })) })
export type OnboardingProgress = typeof OnboardingProgress.Type
