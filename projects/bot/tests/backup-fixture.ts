import type {
    BackupConfigObject,
    BackupItem,
    BackupPlan,
    BackupQueryRequest,
    BackupWorkRequest,
} from "@neonflux/contracts/backup"
import type { Client } from "@neontechspace/fluxerly/effect"
import { createFixtures, type createTestBot, type TestRoute } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect } from "effect"
import { processBackupPlanPass } from "../src/backup.ts"
import { backupBinding, type BackupStore } from "../src/backup-store.ts"
import type { platform } from "./moderation-fixture.ts"

const f = createFixtures()
type TestBot = Effect.Success<ReturnType<typeof createTestBot>>
export type Change = (bot: TestBot, p: ReturnType<typeof platform>) => TestRoute

/** An account that is neither the Owner nor the bot */
const stranger = "900000000000000001"
/** Changes that make the requester no longer the actual Owner in a private one-to-one DM */
export const ownerChanges: Record<string, Change> = {
    "the server changed owner": (bot) =>
        bot.rest.respond(`GET /guilds/${f.ids.guild}`, { body: bot.fixtures.guild({ owner_id: stranger }) }),
    "the DM gained a recipient": (bot, p) =>
        bot.rest.respond(`GET /channels/${p.dmId}`, {
            body: { id: p.dmId, type: 1, recipients: [bot.fixtures.user(), bot.fixtures.user({ id: stranger })] },
        }),
}

/** A plan of the fixture server and its Owner with synthetic hashes and no gains. The scenario gives its name, times and counts */
export const syntheticPlan = (
    scenario: Pick<BackupPlan, "planId" | "createdAt" | "expiresAt" | "itemCount" | "counts"> & Partial<BackupPlan>,
): BackupPlan => ({
    revision: 1,
    planHash: "e".repeat(64),
    archiveDigest: "f".repeat(64),
    backupId: "5".repeat(32),
    manifestDigest: "c".repeat(64),
    provider: "https://api.fluxer.app",
    serverId: f.ids.guild,
    ownerId: f.ids.user,
    gain: { items: 0, bits: "0", switches: 0 },
    match: false,
    forgotten: false,
    state: "ready",
    warned: 0,
    states: {},
    ...scenario,
})

/** Runs an effect on a clock that shows what `now` returns, which only the test moves */
export const withClock =
    (now: () => number) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
            const real = yield* Clock.Clock
            const clock: Clock.Clock = {
                currentTimeMillisUnsafe: now,
                currentTimeMillis: Effect.sync(now),
                monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
                monotonicTimeNanos: real.monotonicTimeNanos,
                currentTimeNanosUnsafe: () => real.currentTimeNanosUnsafe(),
                currentTimeNanos: real.currentTimeNanos,
                sleep: (duration) => real.sleep(duration),
            }
            return yield* effect.pipe(Effect.provideService(Clock.Clock, clock))
        })

/**
 * Restores configuration objects of the fixture server through one real restore pass, each as an update. written runs as the
 * backend records each item, so a test changes the feature's stored settings there. Needs the moderation fixture's platform
 */
export function restoreConfig(
    client: Client,
    dmId: string,
    objects: readonly BackupConfigObject[],
    written: (object: BackupConfigObject) => void = () => {},
) {
    return Effect.gen(function* () {
        const plan = syntheticPlan({
            planId: "synthetic-restore-plan",
            createdAt: Date.now(),
            expiresAt: Date.now() + 900000,
            confirmedAt: Date.now(),
            itemCount: objects.length,
            counts: { create: 0, update: objects.length, delete: 0, skip: 0, blocked: 0 },
        })
        const items = objects.map((object, i): BackupItem => ({
            ...backupBinding(plan),
            itemNo: i + 1,
            generation: 1,
            category: "config",
            family: object.family,
            sourceId: object.sourceId,
            disposition: "update",
            reason: null,
            state: "planned",
            expectedHash: "c".repeat(64),
            desiredHash: "d".repeat(64),
            dependencyItemNo: null,
            mappedId: null,
        }))
        const store = {
            query: (input: BackupQueryRequest) =>
                Effect.sync(() => {
                    const op = input.operation
                    if (op.type === "plan") return { type: "plan", plan }
                    if (op.type === "open" || op.type === "unconfirmed")
                        return {
                            type: op.type,
                            items: items.filter((row) =>
                                op.type === "open" ? row.state === "planned" : row.state === "uncertain",
                            ),
                        }
                    if (op.type === "origins") return { type: "origins", origins: [] }
                    if (op.type === "item")
                        return {
                            type: "item",
                            item: items[op.binding.itemNo - 1],
                            object: objects[op.binding.itemNo - 1],
                        }
                    throw new Error(`Unexpected query ${op.type}`)
                }),
            work: (input: BackupWorkRequest) =>
                Effect.sync(() => {
                    const op = input.operation as Extract<BackupWorkRequest["operation"], { type: "apply" }>
                    const i = op.binding.itemNo - 1
                    written(objects[i]!)
                    items[i] = { ...items[i]!, state: "updated" }
                    return { type: "item", item: items[i] }
                }),
        } as unknown as BackupStore
        const config = { serverId: f.ids.guild } as Parameters<typeof processBackupPlanPass>[1]
        return yield* processBackupPlanPass(store, config, client, plan, dmId)
    })
}
