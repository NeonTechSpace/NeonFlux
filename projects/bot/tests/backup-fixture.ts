import type { BackupPlan } from "@neonflux/contracts/backup"
import { createFixtures, type createTestBot, type TestRoute } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect } from "effect"
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
    backupId: "synthetic-archive",
    manifestDigest: "c".repeat(64),
    provider: "https://api.fluxer.app",
    serverId: f.ids.guild,
    ownerId: f.ids.user,
    gain: { items: 0, bits: "0", switches: 0 },
    match: false,
    forgotten: false,
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
