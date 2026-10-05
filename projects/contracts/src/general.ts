import { Schema } from "effect"
import { Id, Int, origin } from "./common.ts"

// General settings: the command prefix

/** One to five punctuation characters */
export const validPrefix = (value: unknown): value is string => typeof value === "string" && /^[!$%&*+,.?~^|:/\-]{1,5}$/.test(value)
const prefix = Schema.String.check(Schema.makeFilter(validPrefix))

export const GeneralGetRequest = Schema.Struct({ serverId: Id })
export type GeneralGetRequest = typeof GeneralGetRequest.Type
export const GeneralGetResult = Schema.Struct({ prefix, revision: Int() })
export type GeneralGetResult = typeof GeneralGetResult.Type
const manage = { ...origin, serverId: Id, actorId: Id, managerAuthorized: Schema.Boolean, expectedRevision: Int() }
/** A chat command changes the prefix at the revision it read */
export const GeneralManageRequest = Schema.Struct({ ...manage, prefix })
export type GeneralManageRequest = typeof GeneralManageRequest.Type
/** A conflict means another change came first and nothing was saved */
export const GeneralManageResult = Schema.Union([Schema.Struct({ saved: Schema.Literal(true), revision: Int() }), Schema.Struct({ saved: Schema.Literal(false), conflict: Schema.Literal(true), revision: Int() })])
export type GeneralManageResult = typeof GeneralManageResult.Type
