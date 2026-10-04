import type { Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { MilestonesStore } from "./milestone-store.ts"
import { readMilestoneMembership } from "./milestone-permissions.ts"
import { milestoneMembershipObservation, MilestonesHandlingError } from "./milestones.ts"

export function observeMilestoneDeparture(store: MilestonesStore, serverId: string, client: Client, userId: string, cursor?: string) {
    return Effect.gen(function* () {
        const targets = yield* store.delivery({ serverId, operation: { type: "member-targets", userId, ...(cursor ? { cursor } : {}) } })
        if (targets.type !== "member-targets" || targets.targets.length > 20) return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
        if (!targets.targets.length) return { considered: 0, hasMore: targets.hasMore, nextCursor: targets.nextCursor }
        const current = yield* readMilestoneMembership(client, serverId, userId)
        let considered = 0
        for (const target of targets.targets) {
            if (target.userId !== userId) return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
            if (current.status === "present" && current.member.joinedAt === target.joinedAt) continue
            yield* store.delivery({ serverId, operation: { type: "member-observation", target, observation: milestoneMembershipObservation(current) } })
            considered++
        }
        return { considered, hasMore: targets.hasMore, nextCursor: targets.nextCursor }
    })
}
