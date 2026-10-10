import { Schema } from "effect"
import { Id, Ids, List } from "./common.ts"

// The bot's live checks of website viewers' access to private cases

export const PrivateAccessReadyRequest = Schema.Struct({ serverId: Id })
export type PrivateAccessReadyRequest = typeof PrivateAccessReadyRequest.Type
/** Website viewers waiting for the bot to check their access to private cases, see /private-data/ready */
export const PrivateAccessReady = Schema.Struct({ checks: List(Schema.Struct({ userId: Id }), 10) })
export type PrivateAccessReady = typeof PrivateAccessReady.Type
const read = { originServerId: Schema.String, isOwner: Schema.Boolean, present: Schema.Boolean, roleIds: Ids(1000) }, failed = { failed: Schema.Literal(true) }
/**
 * The bot's fresh read of one viewer for /private-data/record: whether they own the server and the roles they hold. present is false
 * when they are not a member, and failed reports that Fluxer could not be read
 */
export const PrivateAccessAnswer = Schema.Union([Schema.Struct(read), Schema.Struct(failed)])
export type PrivateAccessAnswer = typeof PrivateAccessAnswer.Type
const viewer = { serverId: Id, userId: Id }
export const PrivateAccessRecordRequest = Schema.Union([Schema.Struct({ ...viewer, ...read }), Schema.Struct({ ...viewer, ...failed })])
export type PrivateAccessRecordRequest = typeof PrivateAccessRecordRequest.Type
/** recorded is false for a late answer, since the website already reports that the bot did not answer */
export const PrivateAccessRecordResult = Schema.Struct({ recorded: Schema.Boolean })
export type PrivateAccessRecordResult = typeof PrivateAccessRecordResult.Type
