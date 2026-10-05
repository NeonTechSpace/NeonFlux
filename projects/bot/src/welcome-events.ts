import type { Client } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { GreetingsStore } from "./welcome-store.ts"
import { readWelcomeMember } from "./welcome-permissions.ts"

export function observeGreetingJoin(store: GreetingsStore, serverId: string, client: Client, userId: string, eventJoinedAt: string) {
    return Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const joined = Date.parse(eventJoinedAt)
        if (!Number.isFinite(joined) || joined < now - 900000 || joined > now + 60000) return false
        const facts = yield* readWelcomeMember(client, serverId, userId, { expectedJoinedAt: eventJoinedAt })
        if (!facts.context || facts.context.isBot || facts.botId === userId) return false
        const result = yield* store.observe({ serverId, operation: { type: "join", eventJoinedAt, observedAt: facts.observedAt, member: facts.context } })
        return result.recorded
    })
}

export function observeGreetingMembership(store: GreetingsStore, serverId: string, client: Client, userId: string, departed = false) {
    return Effect.gen(function* () {
        const current = yield* store.member({ serverId, userId })
        if (!current.member && !departed) return false
        const facts = yield* readWelcomeMember(client, serverId, userId, { allowAbsent: true })
        if (!current.member) {
            // Members who joined before greetings recorded them still get a goodbye once their absence is confirmed
            if (!facts.memberAbsent) return false
            const user = yield* client.users.fetch(userId, { timeoutMs: 5000 })
            return (yield* store.observe({ serverId, operation: { type: "departed", originServerId: facts.memberOriginServerId, userId, userName: user.username,
                serverName: facts.guild.name, observedAt: facts.observedAt, memberAbsent: true } })).recorded
        }
        const operation = facts.memberAbsent
            ? { type: "absent" as const, originServerId: facts.memberOriginServerId, userId, expectedGeneration: current.member.generation, joinedAt: current.member.joinedAt,
                observedAt: facts.observedAt, memberAbsent: true as const }
            : facts.context ? { type: "present" as const, expectedGeneration: current.member.generation, observedAt: facts.observedAt, member: facts.context } : undefined
        if (!operation) return false
        return (yield* store.observe({ serverId, operation })).recorded
    })
}
