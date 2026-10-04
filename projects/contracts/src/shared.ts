import { Schema } from "effect"
import { Id, Ids, Millis } from "./common.ts"

// Native reads that many features send with their requests

/** The bot's fresh read of the member who asked. nativePermissionAuthorized reports the permission the feature needs */
export const ModerationActor = Schema.Struct({ userId: Id, roleIds: Ids(1000), isOwner: Schema.Boolean, isAdministrator: Schema.Boolean, nativePermissionAuthorized: Schema.Boolean })
export type ModerationActor = typeof ModerationActor.Type
/** The chat message that asked for a change */
export const ModerationSource = Schema.Struct({ messageId: Id, createdAt: Millis })
export type ModerationSource = typeof ModerationSource.Type
