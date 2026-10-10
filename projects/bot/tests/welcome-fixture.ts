import type { GreetingsGrant, GreetingsMember, GreetingsOutcomeRequest, GreetingsPendingResult, GreetingsSettings } from "@neonflux/contracts/greetings"
import { Clock, Effect, type Types } from "effect"
import { GreetingsStoreError, type GreetingsStore } from "../src/welcome-store.ts"
import { canonicalPublishingContent } from "@neonflux/contracts/publishing-base"

export function greetingsBoundary(overrides: Partial<GreetingsStore> = {}) {
    const settings: Types.DeepMutable<GreetingsSettings> = { routes: {
        welcome: { revision: 1, enabled: false, timing: "join" }, dm: { revision: 1, enabled: false, timing: "join" }, goodbye: { revision: 1, enabled: false, timing: "join" },
    }, claimsPerMinute: 10, retentionDays: 30 }
    const calls: { method: string, input: unknown }[] = []
    const members = new Map<string, GreetingsMember>()
    const candidates = new Map<string, GreetingsPendingResult["candidates"][number]>()
    const grants = new Map<string, GreetingsGrant>(), outcomes = new Map<string, GreetingsOutcomeRequest>(), claimed = new Set<string>()
    const record = (method: string, input: unknown) => calls.push({ method, input })
    let nextClaimAt = 0
    const store: GreetingsStore = {
        manage: (input) => Effect.sync(() => {
            record("manage", input); const op = input.operation
            if (op.type === "settings") { if (op.claimsPerMinute !== undefined) settings.claimsPerMinute = op.claimsPerMinute; if (op.retentionDays !== undefined) settings.retentionDays = op.retentionDays }
            else if (op.type === "module") { settings.routes[op.route].enabled = op.enabled; settings.routes[op.route].revision++ }
            else if (op.type === "clear") settings.routes[op.route] = { revision: settings.routes[op.route].revision + 1, enabled: false, timing: "join" }
            else settings.routes[op.route] = { ...settings.routes[op.route], revision: settings.routes[op.route].revision + 1, templateName: op.templateName,
                templateRevision: op.expectedTemplateRevision, content: { content: "Synthetic configured greeting" }, timing: op.timing ?? "join", ...(op.channelId ? { channelId: op.channelId } : {}) }
            return { duplicate: false, settings: structuredClone(settings) }
        }),
        query: (input) => Effect.gen(function* () {
            record("query", input); const op = input.operation
            if (op.type === "settings") return { type: "settings", settings: structuredClone(settings) }
            if (op.type === "member") return { type: "member", member: members.get(op.userId) ?? null }
            if (op.type === "deliveries") return { type: "deliveries", deliveries: [] }
            if (op.type === "preview") { const content = { content: `Preview for ${op.userName} in ${op.serverName}` }; return { type: "preview", content, canonicalContent: canonicalPublishingContent(content) } }
            return yield* Effect.fail(new GreetingsStoreError({ operation: "query", status: 404 }))
        }),
        member: (input) => Effect.sync(() => { record("member", input); return { member: members.get(input.userId) ?? null } }),
        discover: (input) => Clock.currentTimeMillis.pipe(Effect.map(now => { record("discover", input); return { scanAt: input.scanAt ?? now, examined: 0, queued: 0 } })),
        observe: (input) => Effect.sync(() => {
            record("observe", input); const op = input.operation
            if (op.type === "departed") {
                const member: GreetingsMember = { userId: op.userId, joinedAt: new Date(op.observedAt).toISOString(), generation: 1, present: false, observedAt: op.observedAt, expiresAt: op.observedAt + 86400000 }
                members.set(op.userId, member); return { recorded: true, member, admitted: 1 }
            }
            const userId = op.type === "absent" ? op.userId : op.member.userId, previous = members.get(userId)
            const member: Types.DeepMutable<GreetingsMember> = { userId, joinedAt: op.type === "absent" ? op.joinedAt : op.member.joinedAt, generation: previous?.generation ?? 1,
                present: op.type !== "absent", observedAt: op.observedAt, expiresAt: op.observedAt + 86400000 }
            if (op.type === "present" && previous && op.member.joinedAt !== previous.joinedAt) {
                member.joinedAt = previous.joinedAt; member.present = false; member.generation = previous.generation + 1
            } else if (op.type === "absent" && previous?.present) member.generation++
            members.set(userId, member); return { recorded: true, member, admitted: 0 }
        }),
        pending: (input) => Clock.currentTimeMillis.pipe(Effect.map(now => { record("pending", input); return { scanAt: input.scanAt ?? now, candidates: [...candidates.values()].filter((c) => !input.userId || c.userId === input.userId).slice(0, 10), nextClaimAt } })),
        reserve: (input) => Effect.gen(function* () {
            record("reserve", input)
            if (input.context.member && input.context.member.joinedAt !== input.joinedAt) { candidates.delete(input.deliveryId); return { status: "cancelled" } }
            const route = settings.routes[input.route], content = route.content ?? { content: "Synthetic greeting" }
            const grant: GreetingsGrant = { deliveryId: input.deliveryId, deliveryNo: 1, route: input.route, routeRevision: input.routeRevision, userId: input.userId,
                joinedAt: input.joinedAt, memberGeneration: input.memberGeneration, templateName: "greeting", templateRevision: 1, botId: input.context.botId,
                content, canonicalContent: canonicalPublishingContent(content), dispatchExpiresAt: (yield* Clock.currentTimeMillis) + 180000, nativeDeadlineMs: 5000,
                ...(route.channelId ? { channelId: route.channelId } : {}) }
            grants.set(input.deliveryId, grant); candidates.delete(input.deliveryId); return { status: "reserved", grant }
        }),
        dispatch: (input) => Effect.gen(function* () {
            record("dispatch", input); const grant = grants.get(input.deliveryId)!
            const owns = !claimed.has(input.deliveryId); if (owns) { claimed.add(input.deliveryId); nextClaimAt = (yield* Clock.currentTimeMillis) + Math.ceil(60000 / settings.claimsPerMinute) }
            return { claimed: owns, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000, nextClaimAt }
        }),
        outcome: (input) => Effect.sync(() => { record("outcome", input); outcomes.set(input.deliveryId, input); return { recorded: true } }),
        defer: (input) => Effect.sync(() => { record("defer", input); candidates.delete(input.deliveryId); return { deferred: true } }),
        ...overrides,
    }
    return { store, settings, calls, members, candidates, grants, outcomes, claimed }
}
