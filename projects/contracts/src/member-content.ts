import { Schema } from "effect"
import { Id, Ids, IsoTime, List, Millis, Str, Token } from "./common.ts"
import { MemberAccessLists } from "./shared.ts"

// Website requests of member features, which the bot handles with a fresh read of the member, see docs/BOT.md#showcases-and-profiles

/** Members add up to three links of up to 500 characters each */
export const MEMBER_LINKS = 3, MEMBER_LINK_LENGTH = 500
export const memberLinks = List(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MEMBER_LINK_LENGTH)), MEMBER_LINKS)
/** A member's name as the bot read it, up to 100 characters with something besides space */
export const memberName = Str(100).check(Schema.makeFilter((value: string) => value.trim() !== ""))

/** Access list changes shared by member features. Chat commands add and remove entries, and the website replaces the lists */
export const MemberAccessOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("access-set"), ...MemberAccessLists.fields }),
    Schema.Struct({ type: Schema.Literals(["access-add", "access-remove"]), list: Schema.Literals(["allow", "block"]), kind: Schema.Literals(["role", "user"]), ids: Ids(100).check(Schema.isMinLength(1)) }),
])
export type MemberAccessOperation = typeof MemberAccessOperation.Type
/** A member's website request that the bot handles with a fresh read of the member */
export const MemberRequestJob = <O extends Schema.Top>(operation: O) => Schema.Struct({ id: Token, actorId: Id, operation, state: Schema.Literals(["queued", "applied", "failed"]),
    createdAt: Millis, expiresAt: Millis, error: Schema.optionalKey(Str(512)) })
export type MemberRequestJob<O> = ReturnType<typeof MemberRequestJob<Schema.Codec<O>>>["Type"]
/** The bot's fresh read of the member who asked. userName is the name the bot's posts show */
export const MemberContentContext = Schema.Struct({ userId: Id, userName: memberName, roleIds: Ids(1000), isBot: Schema.Boolean, timeoutUntil: Schema.NullOr(IsoTime), botId: Id })
export type MemberContentContext = typeof MemberContentContext.Type
