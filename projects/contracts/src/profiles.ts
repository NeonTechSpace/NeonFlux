import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, Str, Token, origin } from "./common.ts"
import { MemberAccessLists, ModerationActor } from "./shared.ts"
import { PublishingContent } from "./publishing-base.ts"
import { MemberAccessOperation, MemberContentContext, MemberRequestJob, memberLinks, memberName } from "./member-content.ts"

// Profiles, see docs/BOT.md#profiles

export const PROFILE_BIO = 300, PROFILE_MAX_COOLDOWN_SECONDS = 3600

/** cooldownSeconds is the time between two !profile commands of one member, or null for none */
export const ProfileSettings = Schema.Struct({ enabled: Schema.Boolean, cooldownSeconds: Schema.NullOr(Int(1, PROFILE_MAX_COOLDOWN_SECONDS)) })
export type ProfileSettings = typeof ProfileSettings.Type
export const ProfileOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), enabled: Schema.optionalKey(Schema.Boolean), cooldownSeconds: Schema.optionalKey(ProfileSettings.fields.cooldownSeconds) })
        .check(Schema.makeFilter(value => Object.keys(value).length > 1)),
    MemberAccessOperation,
])
export type ProfileOperation = typeof ProfileOperation.Type
export const ProfileState = Schema.Struct({ revision: Int(), settings: ProfileSettings, access: MemberAccessLists })
export type ProfileState = typeof ProfileState.Type
/** A bio of up to 300 characters, up to 3 links and an accent color, null for the default */
export const ProfileContent = Schema.Struct({ bio: Str(PROFILE_BIO), links: memberLinks, color: Schema.NullOr(Int(0, 0xffffff)) })
export type ProfileContent = typeof ProfileContent.Type
export const Profile = Schema.Struct({ ...ProfileContent.fields, userId: Id, updatedAt: Millis })
export type Profile = typeof Profile.Type
export const ProfileMemberOperation = Schema.Struct({ type: Schema.Literal("save"), ...ProfileContent.fields })
export type ProfileMemberOperation = typeof ProfileMemberOperation.Type
export const ProfileJob = MemberRequestJob(ProfileMemberOperation)
export type ProfileJob = typeof ProfileJob.Type
export const ProfileManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: ProfileOperation })
export type ProfileManageRequest = typeof ProfileManageRequest.Type
export const ProfileSettingsRequest = Schema.Struct({ serverId: Id })
export type ProfileSettingsRequest = typeof ProfileSettingsRequest.Type
/** The bot's fresh reads of the member who asked and the member whose profile is shown, in the channel of the command */
export const ProfileShowRequest = Schema.Struct({ serverId: Id, channelId: Id, caller: Schema.Struct({ userId: Id, roleIds: Ids(1000) }),
    target: Schema.Struct({ userId: Id, userName: memberName, roleIds: Ids(1000) }) })
export type ProfileShowRequest = typeof ProfileShowRequest.Type
/** content is the embed to reply with. A refusal names its reason, and rule the automod rule that blocked the profile */
export const ProfileShowResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("profile"), content: PublishingContent, cooldownSeconds: ProfileSettings.fields.cooldownSeconds }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: Schema.Literals(["off", "access", "missing", "automod"]), rule: Schema.optionalKey(Str(100)) }),
])
export type ProfileShowResult = typeof ProfileShowResult.Type
export const ProfileReadyRequest = Schema.Struct({ serverId: Id })
export type ProfileReadyRequest = typeof ProfileReadyRequest.Type
export const ProfileReadyResult = Schema.Struct({ jobs: List(ProfileJob, 4) })
export type ProfileReadyResult = typeof ProfileReadyResult.Type
export const ProfileApplyRequest = Schema.Struct({ serverId: Id, jobId: Token, actorId: Id, member: MemberContentContext })
export type ProfileApplyRequest = typeof ProfileApplyRequest.Type
export const ProfileApplyResult = Schema.Struct({ job: ProfileJob })
export type ProfileApplyResult = typeof ProfileApplyResult.Type
export const ProfileFailRequest = Schema.Struct({ serverId: Id, jobId: Token })
export type ProfileFailRequest = typeof ProfileFailRequest.Type
export const ProfileFailResult = Schema.Null
export type ProfileFailResult = typeof ProfileFailResult.Type
