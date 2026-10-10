import { Schema } from "effect"
import { Id, Int, Millis, origin } from "./common.ts"

// General settings: the command prefix and reply style, which chat and the website share under one revision, and the bot's nickname

/** One to five punctuation characters */
export const validPrefix = (value: unknown): value is string => typeof value === "string" && /^[!$%&*+,.?~^|:/\-]{1,5}$/.test(value)
/** Fluxer's 1 to 32 UTF-16 code units, without surrounding spaces or control characters, so the returned nickname compares exactly */
export const validNickname = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 32 && value.trim() === value
    && !/[\u0000-\u001f\u007f\u202e]/.test(value)
const prefix = Schema.String.check(Schema.makeFilter(validPrefix)), replyStyle = Schema.Literals(["embed", "text"])
const nickname = Schema.NullOr(Schema.String.check(Schema.makeFilter(validNickname)))

/** The bot's desired display name in one server. Null means no nickname, so Fluxer shows the bot's username */
export const GeneralNicknameResult = Schema.Struct({ state: Schema.Literals(["pending", "applied", "failed"]), nickname, at: Int(), error: Schema.optionalKey(Schema.String) })
export type GeneralNicknameResult = typeof GeneralNicknameResult.Type
export const GeneralNickname = Schema.Struct({ nickname, revision: Int(), result: Schema.NullOr(GeneralNicknameResult) })
export type GeneralNickname = typeof GeneralNickname.Type
export const GeneralGetRequest = Schema.Struct({ serverId: Id })
export type GeneralGetRequest = typeof GeneralGetRequest.Type
export const GeneralGetResult = Schema.Struct({ prefix, replyStyle, revision: Int(), nickname: GeneralNickname })
export type GeneralGetResult = typeof GeneralGetResult.Type
const manage = { ...origin, serverId: Id, actorId: Id, managerAuthorized: Schema.Boolean, expectedRevision: Int() }
/** A chat command changes one setting at the revision it read */
export const GeneralManageRequest = Schema.Union([Schema.Struct({ ...manage, prefix }), Schema.Struct({ ...manage, replyStyle })])
export type GeneralManageRequest = typeof GeneralManageRequest.Type
/** A conflict means another change came first and nothing was saved */
export const GeneralManageResult = Schema.Union([Schema.Struct({ saved: Schema.Literal(true), revision: Int() }), Schema.Struct({ saved: Schema.Literal(false), conflict: Schema.Literal(true), revision: Int() })])
export type GeneralManageResult = typeof GeneralManageResult.Type
export const GeneralNicknameRequest = Schema.Struct({ ...origin, serverId: Id, actorId: Id, managerAuthorized: Schema.Boolean, createdAt: Millis, nickname })
export type GeneralNicknameRequest = typeof GeneralNicknameRequest.Type
/** The nickname revision the change took. The bot reports the native result for it */
export const GeneralNicknameSetResult = Schema.Struct({ revision: Int() })
export type GeneralNicknameSetResult = typeof GeneralNicknameSetResult.Type
export const GeneralNicknameResultRequest = Schema.Struct({ ...origin, serverId: Id, revision: Int(1), nickname, state: Schema.Literals(["applied", "failed"]),
    error: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))) })
export type GeneralNicknameResultRequest = typeof GeneralNicknameResultRequest.Type
/** recorded is false for a result that is no longer the latest change's */
export const GeneralNicknameRecordResult = Schema.Struct({ recorded: Schema.Boolean })
export type GeneralNicknameRecordResult = typeof GeneralNicknameRecordResult.Type
