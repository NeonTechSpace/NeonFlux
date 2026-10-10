import { Schema } from "effect"
import { Cursor, Id, Ids, Int, Millis } from "./common.ts"

// The bot service: the deployment scope, multi-mode installations, the work dispatcher, its signal and the bill guard

/** Single mode names its one server. Multi mode serves the active installations listed by /service/installations/list */
export const ServiceScope = Schema.Union([Schema.Struct({ mode: Schema.Literal("single"), serverIds: Ids(1) }), Schema.Struct({ mode: Schema.Literal("multi") })])
export type ServiceScope = typeof ServiceScope.Type
export const ServiceInstallationsListRequest = Schema.Struct({ cursor: Schema.optionalKey(Schema.NullOr(Cursor)) })
export type ServiceInstallationsListRequest = typeof ServiceInstallationsListRequest.Type
export const ServiceInstallationPage = Schema.Struct({ serverIds: Schema.mutable(Schema.Array(Id)), nextCursor: Schema.NullOr(Cursor) })
export type ServiceInstallationPage = typeof ServiceInstallationPage.Type
/** A join or a leave of one server */
export const ServiceInstallationRequest = Schema.Struct({ serverId: Id })
export type ServiceInstallationRequest = typeof ServiceInstallationRequest.Type
/** welcome is set by the join that starts an installation, either the first or one after a removal, so the bot posts its note once per install */
export const ServiceInstallation = Schema.Struct({ serverId: Id, active: Schema.Boolean, welcome: Schema.optionalKey(Schema.Literal(true)) })
export type ServiceInstallation = typeof ServiceInstallation.Type
/** Background workers the bot wakes when /service/work reports due work for their server */
export const ServiceWorkKind = Schema.Literals(["dashboard", "verification", "events", "schedules", "milestones", "suggestions", "cleanup", "metadata", "levels", "temproles", "helpdesk", "lfg", "youtube"])
export type ServiceWorkKind = typeof ServiceWorkKind.Type
/** The cursor is the previous answer's. requestedAt only makes each call distinct, so a cached result never hides work that became due since */
export const ServiceWorkRequest = Schema.Struct({ cursor: Schema.optionalKey(Schema.NullOr(Cursor)), requestedAt: Schema.optionalKey(Millis) })
export type ServiceWorkRequest = typeof ServiceWorkRequest.Type
const delay = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
/**
 * Servers with due work per worker, oldest due first. The cursor is opaque and goes back with the next request.
 * nextDueIn is how many milliseconds from now, by the backend clock, the next listed row becomes due, or null when none waits
 */
export const ServiceWork = Schema.Struct({ kinds: Schema.Record(ServiceWorkKind, Ids(100).check(Schema.isUnique())),
    cursor: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))), nextDueIn: Schema.NullOr(delay) })
export type ServiceWork = typeof ServiceWork.Type
/** The bot's work signal. version changes whenever a writer other than the bot creates work for it */
export const ServiceWorkSignal = Schema.Struct({ version: Int() })
export type ServiceWorkSignal = typeof ServiceWorkSignal.Type
/** The most calls one report may add, far above what one bot process makes between two reports */
export const USAGE_REPORT_LIMIT = 100000000
/** The function calls the bot caused since its last accepted report */
export const ServiceUsageRequest = Schema.Struct({ calls: Int(0, USAGE_REPORT_LIMIT) })
export type ServiceUsageRequest = typeof ServiceUsageRequest.Type
/**
 * The month's billed calls after a bot usage report, as /service/usage answers it. budget is null when no budget is set.
 * state is paused from 90 percent of the budget and warning from the warning share. warn is true for the month's first report past the warning share
 */
export const ServiceUsage = Schema.Struct({ month: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}$/)), calls: Int(), budget: Schema.NullOr(Int(1)),
    state: Schema.Literals(["normal", "warning", "paused"]), warn: Schema.Boolean })
export type ServiceUsage = typeof ServiceUsage.Type
/** A bot mutation's answer. dueIn is set when its writes created work, in milliseconds from now by the backend clock */
export const ServiceMutationResult = <S extends Schema.Top>(value: S) => Schema.Struct({ value, dueIn: Schema.optionalKey(delay) })
export type ServiceMutationResult<T = unknown> = ReturnType<typeof ServiceMutationResult<Schema.Codec<T>>>["Type"]
