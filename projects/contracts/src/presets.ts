import { Schema } from "effect"
import { Id, List, Millis, Str, Token, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Setup presets, see docs/BOT.md#setup-presets

export const PRESET_NAMES = ["gaming", "support", "creator", "relaxed", "balanced", "strict"] as const
const text = Str(200).check(Schema.isMinLength(1))

export const PresetName = Schema.Literals(PRESET_NAMES)
export type PresetName = typeof PresetName.Type
export const PresetFamily = Schema.Literals(["moderation", "leveling", "tickets", "events"])
export type PresetFamily = typeof PresetFamily.Type
/** One setting a preset changes, with its current and new value as managers see them */
export const PresetChange = Schema.Struct({ family: PresetFamily, setting: text, from: text, to: text })
export type PresetChange = typeof PresetChange.Type
/** The changes applying a preset makes now. token confirms exactly this preview, and any change to the settings changes it */
export const PresetPlan = Schema.Struct({ name: PresetName, kind: Schema.Literals(["community", "security"]), description: text, changes: List(PresetChange, 30),
    token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{8}$/)) })
export type PresetPlan = typeof PresetPlan.Type
export const PresetPlansRequest = Schema.Struct({ serverId: Id })
export type PresetPlansRequest = typeof PresetPlansRequest.Type
export const PresetPlansResult = Schema.Struct({ presets: List(PresetPlan, PRESET_NAMES.length) })
export type PresetPlansResult = typeof PresetPlansResult.Type
export const PresetApplyRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, name: PresetName, token: Token })
export type PresetApplyRequest = typeof PresetApplyRequest.Type
export const PresetApplyResult = Schema.Struct({ plan: PresetPlan })
export type PresetApplyResult = typeof PresetApplyResult.Type
