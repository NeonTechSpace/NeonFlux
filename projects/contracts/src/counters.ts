import { Schema } from "effect"
import { Id, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Counter channels, see docs/BOT.md#counter-channels

/** A server has at most five counters, one per channel */
export const COUNTER_LIMIT = 5
/** A channel name's longest form, which a rendered template stays inside */
export const COUNTER_NAME_MAX = 100
export const COUNTER_PLACEHOLDER = "{count}"
const whitespace = /\s+/g
/** The form a template is saved and rendered in. Fluxer trims channel names and collapses their spaces too, so the comparison with the current name matches */
export const counterTemplate = (value: string) => value.replace(whitespace, " ").trim()
/**
 * A template holds {count} and at most 100 characters. {count} is as long as a seven-digit count, so what a template renders stays
 * in a channel name's 1 to 100 characters
 */
export const isCounterTemplate = (value: string) =>
    value === counterTemplate(value) && value.length <= COUNTER_NAME_MAX && value.includes(COUNTER_PLACEHOLDER)
export const CounterTemplate = Schema.String.check(Schema.makeFilter(isCounterTemplate))
/** A channel name for a count. The count shows plainly, with no separators */
export function renderCounter(template: string, count: number) {
    return template.replaceAll(COUNTER_PLACEHOLDER, String(count)).slice(0, COUNTER_NAME_MAX)
}
/** What a counter counts: The server's members, or the members who hold one role. Fluxer's presence stays off, so online counts are left out */
export const CounterKind = Schema.Literals(["members", "role"])
export type CounterKind = typeof CounterKind.Type
/** Why NeonFlux turned a counter off: Its channel is gone, or NeonFlux may not rename it */
export const CounterProblem = Schema.Literals(["channel", "permission"])
export type CounterProblem = typeof CounterProblem.Type
/** Why a role counter's count cannot be read: NeonFlux holds no permission Fluxer's member search takes, or Fluxer asks for two-factor authentication */
export const CounterCountProblem = Schema.Literals(["permission", "twoFactor"])
export type CounterCountProblem = typeof CounterCountProblem.Type
/** The fix for a count that cannot be read */
export const counterCountProblemText = (problem: CounterCountProblem) =>
    problem === "permission"
        ? "Fluxer's member search needs NeonFlux to hold Manage community, Manage roles, Manage nicknames, Ban members, Kick members or Time out members"
        : "Fluxer refuses NeonFlux's member search while this server requires two-factor authentication for moderation. Give NeonFlux Manage nicknames instead of its moderation permissions, or remove that requirement"
const counted = {
    kind: CounterKind,
    /** The counted role of a role counter */
    roleId: Schema.optionalKey(Id),
}
const hasRole = (v: { kind: CounterKind; roleId?: string }) => (v.kind === "role") === (v.roleId !== undefined)
export const Counter = Schema.Struct({
    channelId: Id,
    ...counted,
    template: CounterTemplate,
    enabled: Schema.Boolean,
    problem: Schema.optionalKey(CounterProblem),
    /** A counter that stays on but cannot read its count, so its channel keeps its name */
    countProblem: Schema.optionalKey(CounterCountProblem),
    createdAt: Millis,
}).check(Schema.makeFilter(hasRole))
export type Counter = typeof Counter.Type
/** enabled is the feature's switch, and each counter's own enabled is false while NeonFlux has turned it off */
export const CounterView = Schema.Struct({ enabled: Schema.Boolean, counters: List(Counter, COUNTER_LIMIT) })
export type CounterView = typeof CounterView.Type
/** add makes a counter or replaces the channel's counter, and set changes a counter's template. Both turn it back on */
export const CounterOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({
        type: Schema.Literal("add"),
        channelId: Id,
        ...counted,
        template: CounterTemplate,
    }).check(Schema.makeFilter(hasRole)),
    Schema.Struct({ type: Schema.Literal("set"), channelId: Id, template: CounterTemplate }),
    Schema.Struct({ type: Schema.Literal("remove"), channelId: Id }),
])
export type CounterOperation = typeof CounterOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const CounterManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Literal(true),
    operation: CounterOperation,
})
export type CounterManageRequest = typeof CounterManageRequest.Type
export const CounterQueryRequest = Schema.Struct({ serverId: Id })
export type CounterQueryRequest = typeof CounterQueryRequest.Type
/**
 * A rename Fluxer refused turns the channel's counter off, and a count that became unreadable or readable again is noted once. template
 * names what the bot rendered, so a report about a counter changed since then changes nothing
 */
export const CounterWorkRequest = Schema.Union([
    Schema.Struct({ serverId: Id, channelId: Id, template: CounterTemplate, reason: CounterProblem }),
    Schema.Struct({
        serverId: Id,
        channelId: Id,
        template: CounterTemplate,
        countProblem: Schema.NullOr(CounterCountProblem),
    }),
])
export type CounterWorkRequest = typeof CounterWorkRequest.Type
export const CounterWorkResult = Schema.Struct({ recorded: Schema.Boolean })
export type CounterWorkResult = typeof CounterWorkResult.Type
