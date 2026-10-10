import { Schema } from "effect"
import { Id, Int, List } from "./common.ts"
import { StaffClass } from "./moderation.ts"

// What !setup, !health and the dashboard permission check read, the bot's answer to that check, and the recovery inbox

/** A check keeps at most 50 problems, and a feature lists at most 100 roles it assigns */
export const SETUP_PROBLEM_LIMIT = 50, SETUP_ROLES_PER_FEATURE = 100
/** A recovery inbox shows at most 100 entries */
export const RECOVERY_LIMIT = 100
const sections = ["custom", "auto", "moderation", "cleanup", "logs", "reaction", "autorole", "verification", "rolepicker", "temproles", "onboarding", "publishing", "greetings", "schedules",
    "tickets", "leveling", "milestones", "suggestions", "events", "voice", "analytics", "sticky", "sidebar", "alerts", "helpdesk", "lfg", "showcase", "profile", "youtube"] as const
export const DashboardOverviewSection = Schema.Literals(sections)
export type DashboardOverviewSection = typeof DashboardOverviewSection.Type
/** On is enabled and able to act, setup is enabled but missing what it needs, such as a channel or a first definition, and off is disabled */
export const DashboardOverviewState = Schema.Literals(["on", "setup", "off"])
export type DashboardOverviewState = typeof DashboardOverviewState.Type
const role = Schema.Struct({ id: Id, name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)) })
const permissions = List(Schema.String.check(Schema.isPattern(/^[A-Za-z]{1,40}$/)), 40).check(Schema.isMinLength(1))
/**
 * One problem the bot found with its own access. permissions are keys of the SDK's Permissions, such as KickMembers, that the bot
 * lacks server-wide for an enabled feature. roles are roles an enabled feature assigns that rank at or above the bot's highest role.
 * general covers what every feature needs, such as sending replies.
 * The safety audit adds roles that give dangerous permissions to many members, with members absent for the everyone role,
 * staff roles that lack the permissions their staff class's commands check, and role features that are on while Fluxer's
 * verification level is set, which Fluxer skips for any member with a role
 */
export const SetupProblem = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("permissions"), feature: Schema.Literals([...sections, "general"]), permissions }),
    Schema.Struct({ kind: Schema.Literal("hierarchy"), feature: DashboardOverviewSection, roles: List(role, SETUP_ROLES_PER_FEATURE) }),
    Schema.Struct({ kind: Schema.Literal("gateway"), state: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)) }),
    Schema.Struct({ kind: Schema.Literal("dangerous-role"), role, permissions, members: Schema.optionalKey(Int()) }),
    Schema.Struct({ kind: Schema.Literal("staff-permissions"), staffClass: StaffClass, role, permissions }),
    Schema.Struct({ kind: Schema.Literal("verification-bypass"), features: List(DashboardOverviewSection, 20).check(Schema.isMinLength(1)) }),
])
export type SetupProblem = typeof SetupProblem.Type
export const SetupStatusRequest = Schema.Struct({ serverId: Id })
export type SetupStatusRequest = typeof SetupStatusRequest.Type
const ids = Schema.mutable(Schema.Array(Id))
/**
 * Each section's state, the roles each feature assigns and the moderation staff roles.
 * threadFeatures lists the features that start discussion threads, which need Create Public Threads
 */
export const SetupStatus = Schema.Struct({ sections: Schema.mutable(Schema.Array(Schema.Struct({ id: DashboardOverviewSection, state: DashboardOverviewState }))),
    managedRoles: Schema.mutable(Schema.Array(Schema.Struct({ feature: DashboardOverviewSection, roleIds: ids }))), staffRoleIds: Schema.Record(StaffClass, ids),
    threadFeatures: Schema.mutable(Schema.Array(DashboardOverviewSection)) })
export type SetupStatus = typeof SetupStatus.Type
export const SetupReadyRequest = Schema.Struct({ serverId: Id })
export type SetupReadyRequest = typeof SetupReadyRequest.Type
/** Whether the website waits for a permission check from the bot */
export const SetupReadyResult = Schema.Struct({ queued: Schema.Boolean })
export type SetupReadyResult = typeof SetupReadyResult.Type
export const SetupRecordRequest = Schema.Struct({ serverId: Id, problems: List(SetupProblem, SETUP_PROBLEM_LIMIT) })
export type SetupRecordRequest = typeof SetupRecordRequest.Type
/** recorded is false for a late answer, since the website already reports that the bot did not answer */
export const SetupRecordResult = Schema.Struct({ recorded: Schema.Boolean })
export type SetupRecordResult = typeof SetupRecordResult.Type
export const RecoverySource = Schema.Literals(["publishing", "schedules", "events", "suggestions", "roles", "temproles", "tickets", "cleanup", "greetings", "milestones", "logs", "helpdesk", "youtube", "defcon"])
export type RecoverySource = typeof RecoverySource.Type
/**
 * One entry of the recovery inbox. A work entry says what happened, when, and the command or step that resolves it, and one without at
 * describes the current state. A setup entry is a problem the latest permission check found, and a feature entry a feature that is on but
 * cannot act yet
 */
export const RecoveryEntry = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("work"), source: RecoverySource, at: Schema.optionalKey(Schema.Number), summary: Schema.String, next: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("setup"), at: Schema.Number, problem: SetupProblem }),
    Schema.Struct({ kind: Schema.Literal("feature"), feature: DashboardOverviewSection }),
])
export type RecoveryEntry = typeof RecoveryEntry.Type
export const RecoveryListRequest = Schema.Struct({ serverId: Id })
export type RecoveryListRequest = typeof RecoveryListRequest.Type
/** The recovery inbox, current state first and then newest first. truncated is true when it held more entries than it shows */
export const RecoveryInbox = Schema.Struct({ serverId: Id, entries: List(RecoveryEntry, RECOVERY_LIMIT), truncated: Schema.Boolean })
export type RecoveryInbox = typeof RecoveryInbox.Type
