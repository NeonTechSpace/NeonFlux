import { Schema } from "effect"
import { Id, Ids, List, Millis, origin } from "./common.ts"
import { RESPONSE_SCOPE_CHANNELS, RESPONSE_SCOPE_ROLES } from "./responses.ts"
import { ModerationActor } from "./shared.ts"

// Rules for built-in commands, see docs/BOT.md#rules-for-built-in-commands

/** A server keeps at most this many rules. A channel or role list holds as many as a custom command's */
export const COMMAND_RULE_LIMIT = 25
export { RESPONSE_SCOPE_CHANNELS as COMMAND_RULE_CHANNELS, RESPONSE_SCOPE_ROLES as COMMAND_RULE_ROLES }
/**
 * Commands that always work everywhere, because a safety control, recovery, access for members or the rules themselves depend
 * on them. Everything the gate treats as critical as a whole is here, and forms of other commands it treats as critical skip rules
 * in the bot. A new command stays out of LIMITABLE_COMMANDS until someone decides, so it cannot be limited by accident
 */
export const UNLIMITABLE_COMMANDS = [
    "commands",
    "help",
    "prefix",
    "defcon",
    "security",
    "mod",
    "automod",
    "lockdown",
    "antinuke",
    "jail",
    "appeal",
    "logs",
    "alerts",
    "invites",
    "recovery",
    "setup",
    "health",
    "preset",
    "backup",
    "export",
    "ticket",
    "verify",
    "milestone",
    "cleanup",
    "mydata",
] as const
/** The built-in commands a rule can limit, by the name members type */
export const LIMITABLE_COMMANDS = [
    "ping",
    "afk",
    "replies",
    "nickname",
    "stats",
    "sidebar",
    "roles",
    "autorole",
    "rolepicker",
    "temprole",
    "onboarding",
    "memberlist",
    "publish",
    "welcome",
    "goodbye",
    "custom",
    "auto",
    "sticky",
    "youtube",
    "twitch",
    "solved",
    "suggest",
    "helpdesk",
    "answer",
    "escalate",
    "rank",
    "leaderboard",
    "event",
    "showcase",
    "profile",
    "level",
    "voice",
    "lfg",
    "remind",
    "board",
    "giveaway",
    "counter",
    "feed",
] as const
export const CommandRuleName = Schema.Literals(LIMITABLE_COMMANDS)
export type CommandRuleName = typeof CommandRuleName.Type
export const isLimitableCommand = (value: string): value is CommandRuleName =>
    (LIMITABLE_COMMANDS as readonly string[]).includes(value)
export const isUnlimitableCommand = (value: string) => (UNLIMITABLE_COMMANDS as readonly string[]).includes(value)

const channelIds = Ids(RESPONSE_SCOPE_CHANNELS).check(Schema.isUnique()),
    roleIds = Ids(RESPONSE_SCOPE_ROLES).check(Schema.isUnique())
/** An empty list means every channel or every role. The backend stores no rule with both lists empty */
export const CommandRule = Schema.Struct({ command: CommandRuleName, channelIds, roleIds, updatedAt: Millis })
export type CommandRule = typeof CommandRule.Type
export const CommandRules = List(CommandRule, COMMAND_RULE_LIMIT)
export type CommandRules = typeof CommandRules.Type
/** A list left out stays as it is, and an empty one removes that limit */
export const CommandRuleOperation = Schema.Union([
    Schema.Struct({
        type: Schema.Literal("set"),
        command: CommandRuleName,
        channelIds: Schema.optionalKey(channelIds),
        roleIds: Schema.optionalKey(roleIds),
    }),
    Schema.Struct({ type: Schema.Literal("clear"), command: CommandRuleName }),
])
export type CommandRuleOperation = typeof CommandRuleOperation.Type
export const CommandRulesManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Literal(true),
    operation: CommandRuleOperation,
})
export type CommandRulesManageRequest = typeof CommandRulesManageRequest.Type
export const CommandRulesState = Schema.Struct({ rules: CommandRules })
export type CommandRulesState = typeof CommandRulesState.Type
