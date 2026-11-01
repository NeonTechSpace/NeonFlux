// The anti-nuke detector: Pure counting over what accounts did, which holds no Effect or client code. The live runtime keeps one state per
// server in memory, and evals/anti-nuke/train.json replays the same functions, see docs/CONTRIBUTING.md#detector-evals. A false positive strips
// a real moderator, so each rule is set above what a person does by hand. A person bans about one account every five seconds at most,
// so a family limit fires at machine speed, and the slower rules look for what no raid response or evening of tidying adds up to
import {
    ANTI_NUKE_DEFAULT_LIMITS,
    type AntiNukeAction,
    type AntiNukeCounts,
    type AntiNukeLimits,
    type AntiNukeRule,
} from "@neonflux/contracts/anti-nuke"

/** What the eval knows about an account. Owners, NeonFlux and trusted accounts never count as a nuke */
export type AntiNukeKind = "staff" | "bot" | "high" | "owner" | "neonflux" | "trusted"
export type AntiNukeEvent = {
    readonly at: number
    readonly actor: string
    readonly action: AntiNukeAction
    readonly viaBot?: boolean
}
/** One account the detector just reported, with what it saw over the rule's window. alertOnly means tell staff and touch nothing */
export type AntiNukeFired = {
    readonly actor: string
    readonly rule: AntiNukeRule
    readonly alertOnly: boolean
    readonly counts: AntiNukeCounts
    readonly firstAt: number
    readonly lastAt: number
}

const SECOND = 1000
const MINUTE = 60 * SECOND
// How long a fired account stays quiet, so one wipe is one incident. Two accounts firing this close count as acting at once
export const ANTI_NUKE_COOLDOWN_MS = 5 * MINUTE
// How long an account stays quiet after an alert that touches nothing, so a long evening of work is a few lines, not hundreds
const ALERT_COOLDOWN_MS = 30 * MINUTE
// A prune removes many members in one entry, so two in a short time need no count of members
const PRUNE_WINDOW = 5 * MINUTE,
    PRUNES = 2
// Webhooks flood channels with spam, and setting up an integration or two never comes near this
const WEBHOOK_WINDOW = 30 * SECOND,
    WEBHOOKS = 10
// Setting up a server is a burst of creates, even from a template bot, and only a flood far above that counts
const CREATE_WINDOW = 15 * SECOND,
    CREATES = 30
// Handing a dangerous role to many members or dangerous permissions to many roles at machine speed. Role bots give roles all day, so
// their member role changes do not count here
const GRANT_WINDOW = 30 * SECOND,
    MEMBER_GRANTS = 20,
    ROLE_GRANTS = 5
// Undoing a ban wave by hand can be quick, so mass unbans have a higher limit than bans
const UNBAN_WINDOW = 30 * SECOND,
    UNBANS = 15
// Weights of what one account does across families, for destruction spread thin enough to stay under every family's limit. Member
// role changes weigh little, since role bots make many, and creates weigh nothing, since setting up a server is a burst of them
const WEIGHTS: Partial<Record<AntiNukeAction, number>> = {
    ban: 1,
    kick: 1,
    "channel-delete": 2,
    "role-delete": 2,
    "role-perms": 3,
    prune: 4,
    "member-roles": 0.5,
    "webhook-create": 1,
    restrict: 1,
}
const MIXED_WINDOW = 30 * SECOND,
    MIXED_SCORE = 9
// Slow burns: Members over an hour and channels or roles over half an hour. Each threshold follows its family's limit, so one setting moves
// both. Ordinary maintenance reaches these paces, so a slow burn only alerts. Only a bot working faster than a filter paces itself is stopped
const MEMBER_BURN_WINDOW = 60 * MINUTE,
    MEMBER_BURN_FACTOR = 4,
    MEMBER_BURN_SPAN = 20 * MINUTE,
    RESOURCE_BURN_WINDOW = 30 * MINUTE,
    RESOURCE_BURN_FACTOR = 2.4
// A filter bot bans steadily all day. A bot pacing itself slower than this is doing its job, however long it goes on
const BOT_STEADY_GAP = 15 * SECOND
// Two accounts acting at once are colluding when each reached this share of a limit within half its window, and together reached the limit.
// Half the window keeps out two people tidying side by side, each at a pace one person may keep
const COLLUSION_SHARE = 0.6,
    COLLUSION_WINDOW_SHARE = 0.5
// What one server's state holds. The oldest account and an account's oldest events go first
const MAX_EVENTS_PER_ACTOR = 400,
    MAX_ACTORS = 200

const families = {
    bans: ["ban"],
    kicks: ["kick"],
    channels: ["channel-delete"],
    roles: ["role-delete"],
} as const satisfies Record<keyof AntiNukeLimits, readonly AntiNukeAction[]>
const familyNames = Object.keys(families) as (keyof AntiNukeLimits)[]
const familyOf = (action: AntiNukeAction) => familyNames.find((name) => action === families[name][0])

type Seen = { readonly at: number; readonly action: AntiNukeAction }
type Actor = { events: Seen[]; bot: boolean; alertOnly: boolean; firedAt?: number; alertedAt?: number }
const inWindow = (events: readonly Seen[], now: number, ms: number) => {
    const from = now - ms
    return events.filter((event) => event.at > from && event.at <= now)
}
const countOf = (events: readonly Seen[], action: AntiNukeAction) =>
    events.reduce((total, event) => total + (event.action === action ? 1 : 0), 0)
const middleGap = (events: readonly Seen[]) => {
    const gaps = events
        .slice(1)
        .map((event, index) => event.at - events[index]!.at)
        .sort((a, b) => a - b)
    return gaps[Math.floor(gaps.length / 2)] ?? Number.POSITIVE_INFINITY
}

/** The rule one account's events break now, if any, with the window it read */
function brokenRule(actor: Actor, action: AntiNukeAction, now: number, limits: AntiNukeLimits) {
    const family = familyOf(action)
    if (family) {
        const limit = limits[family]
        if (countOf(inWindow(actor.events, now, limit.seconds * SECOND), action) >= limit.count)
            return { rule: family, window: limit.seconds * SECOND }
    }
    if (action === "prune" && countOf(inWindow(actor.events, now, PRUNE_WINDOW), "prune") >= PRUNES)
        return { rule: "prunes" as const, window: PRUNE_WINDOW }
    if (action === "webhook-create" && countOf(inWindow(actor.events, now, WEBHOOK_WINDOW), action) >= WEBHOOKS)
        return { rule: "webhooks" as const, window: WEBHOOK_WINDOW }
    if (action === "unban" && countOf(inWindow(actor.events, now, UNBAN_WINDOW), action) >= UNBANS)
        return { rule: "unbans" as const, window: UNBAN_WINDOW }
    if (action === "channel-create" || action === "role-create") {
        const recent = inWindow(actor.events, now, CREATE_WINDOW)
        return countOf(recent, "channel-create") + countOf(recent, "role-create") >= CREATES
            ? { rule: "creates" as const, window: CREATE_WINDOW }
            : undefined
    }
    if (
        (action === "role-perms" && countOf(inWindow(actor.events, now, GRANT_WINDOW), action) >= ROLE_GRANTS) ||
        (action === "member-roles" &&
            !actor.bot &&
            countOf(inWindow(actor.events, now, GRANT_WINDOW), action) >= MEMBER_GRANTS)
    )
        return { rule: "grants" as const, window: GRANT_WINDOW }
    if (WEIGHTS[action] === undefined) return undefined
    const recent = inWindow(actor.events, now, MIXED_WINDOW),
        score = recent.reduce((total, event) => total + (WEIGHTS[event.action] ?? 0), 0)
    if (score >= MIXED_SCORE && new Set(recent.map((event) => event.action)).size >= 2)
        return { rule: "mixed" as const, window: MIXED_WINDOW }
    if (action === "channel-delete" || action === "role-delete") {
        const burn = inWindow(actor.events, now, RESOURCE_BURN_WINDOW).filter(
                (event) => event.action === "channel-delete" || event.action === "role-delete",
            ),
            needed = Math.ceil(Math.min(limits.channels.count, limits.roles.count) * RESOURCE_BURN_FACTOR)
        // A bot faster than a voice bot closing rooms is stopped, and anyone else only draws an alert
        if (burn.length >= needed)
            return actor.bot && middleGap(burn) < BOT_STEADY_GAP
                ? { rule: "slow" as const, window: RESOURCE_BURN_WINDOW }
                : { rule: "slow" as const, window: RESOURCE_BURN_WINDOW, gentle: true }
    }
    if (action === "ban" || action === "kick") {
        const burn = inWindow(actor.events, now, MEMBER_BURN_WINDOW).filter(
                (event) => event.action === "ban" || event.action === "kick",
            ),
            needed = Math.min(limits.bans.count, limits.kicks.count) * MEMBER_BURN_FACTOR
        if (burn.length >= needed) {
            // A bot faster than a filter paces itself is stopped. A person only draws an alert, once this outlasts a raid
            if (actor.bot && middleGap(burn) < BOT_STEADY_GAP)
                return { rule: "slow" as const, window: MEMBER_BURN_WINDOW }
            if (!actor.bot && now - burn[0]!.at >= MEMBER_BURN_SPAN)
                return { rule: "slow" as const, window: MEMBER_BURN_WINDOW, gentle: true }
        }
    }
    return undefined
}

/** One server's memory of what its accounts did. A dashboard or chat change replaces the limits without losing the counts */
export function createAntiNukeState(initial: AntiNukeLimits = ANTI_NUKE_DEFAULT_LIMITS) {
    let limits = initial
    const actors = new Map<string, Actor>()
    const report = (
        id: string,
        actor: Actor,
        rule: AntiNukeRule,
        window: number,
        now: number,
        alertOnly: boolean,
    ): AntiNukeFired => {
        if (alertOnly) actor.alertedAt = now
        else actor.firedAt = now
        const seen = inWindow(actor.events, now, window),
            counts: Record<string, number> = {}
        for (const event of seen) counts[event.action] = (counts[event.action] ?? 0) + 1
        return { actor: id, rule, alertOnly, counts, firstAt: seen[0]?.at ?? now, lastAt: now }
    }
    const quiet = (actor: Actor, now: number) =>
        actor.firedAt !== undefined && now - actor.firedAt < ANTI_NUKE_COOLDOWN_MS
    const alerted = (actor: Actor, now: number) =>
        actor.alertedAt !== undefined && now - actor.alertedAt < ALERT_COOLDOWN_MS
    return {
        setLimits: (next: AntiNukeLimits) => {
            limits = next
        },
        /** Forgets an account, such as one staff just trusted or gave its roles back */
        forget: (id: string) => actors.delete(id),
        /** Lifts an account's cooldown when nothing could be done about it, so its next action can still be acted on */
        release: (id: string) => {
            const actor = actors.get(id)
            if (actor) delete actor.firedAt
        },
        /**
         * Records one action. The accounts it reports, usually none, each once per cooldown. An alert-only account, such as the owner or a
         * trusted one, is reported only as an alert, and it is nobody's partner and never makes another account act at once
         */
        observe: (
            id: string,
            action: AntiNukeAction,
            now: number,
            { bot = false, alertOnly = false }: { readonly bot?: boolean; readonly alertOnly?: boolean } = {},
        ): AntiNukeFired[] => {
            let actor = actors.get(id)
            if (!actor) {
                actor = { events: [], bot, alertOnly }
                actors.set(id, actor)
                if (actors.size > MAX_ACTORS) actors.delete(actors.keys().next().value!)
            }
            actor.bot = bot
            actor.alertOnly = alertOnly
            // Entries can arrive late and out of order after a reconnect, and each counts at its own time
            actor.events.push({ at: now, action })
            if ((actor.events.at(-2)?.at ?? now) > now) actor.events.sort((a, b) => a.at - b.at)
            const from = now - MEMBER_BURN_WINDOW
            while (actor.events.length > MAX_EVENTS_PER_ACTOR || (actor.events[0] && actor.events[0].at <= from))
                actor.events.shift()
            if (quiet(actor, now)) return []
            const broken = brokenRule(actor, action, now, limits)
            if (broken) {
                const gentle = alertOnly || ("gentle" in broken && broken.gentle === true)
                if (!gentle) return [report(id, actor, broken.rule, broken.window, now, false)]
                if (!alerted(actor, now)) return [report(id, actor, broken.rule, broken.window, now, true)]
            }
            // Accounts acting together, each under a limit that they reach between them
            const family = familyOf(action)
            if (!family || alertOnly) return []
            const limit = limits[family],
                window = limit.seconds * SECOND * COLLUSION_WINDOW_SHARE,
                share = Math.ceil(limit.count * COLLUSION_SHARE)
            const counted = (other: Actor) => countOf(inWindow(other.events, now, window), action)
            if (counted(actor) < share) return []
            const partners = [...actors].filter(
                ([other, state]) => other !== id && !state.alertOnly && !quiet(state, now) && counted(state) >= share,
            )
            const total = partners.reduce((sum, [, state]) => sum + counted(state), counted(actor))
            if (!partners.length || total < limit.count) return []
            return [[id, actor] as const, ...partners].map(([who, state]) =>
                report(who, state, "colluding", window, now, false),
            )
        },
        /** Whether another account fired so close to this time that the accounts act at once. An alert counts for nothing here */
        otherFiredNear: (id: string, now: number) =>
            [...actors].some(
                ([other, state]) =>
                    other !== id && state.firedAt !== undefined && now - state.firedAt < ANTI_NUKE_COOLDOWN_MS,
            ),
    }
}

/** What a member can do through NeonFlux that it reports with observeBotAction, whose audit entries name NeonFlux */
export const ANTI_NUKE_VIA_BOT: readonly AntiNukeAction[] = ["ban", "kick", "unban", "restrict"]
/**
 * Replays labeled events through the live path for the eval. NeonFlux's own entries are never counted, an action through NeonFlux counts for the
 * member only when NeonFlux reports it, and the owner and trusted accounts are alert-only. nuke means stop an account now. lockdown means
 * stopping one account cannot contain it: Two accounts fired at once, or the account outranks NeonFlux
 */
export function replayAntiNuke(
    events: readonly AntiNukeEvent[],
    actors: Readonly<Record<string, AntiNukeKind>>,
    limits?: AntiNukeLimits,
) {
    const state = createAntiNukeState(limits)
    let nuke = false,
        lockdown = false
    for (const event of events) {
        const kind = actors[event.actor]
        if (!kind || kind === "neonflux" || (event.viaBot && !ANTI_NUKE_VIA_BOT.includes(event.action))) continue
        const at = event.at * SECOND
        const alertOnly = kind === "owner" || kind === "trusted"
        for (const fired of state.observe(event.actor, event.action, at, { bot: kind === "bot", alertOnly })) {
            if (fired.alertOnly) continue
            nuke = true
            if (actors[fired.actor] === "high" || state.otherFiredNear(fired.actor, at)) lockdown = true
        }
    }
    return { nuke, lockdown }
}
