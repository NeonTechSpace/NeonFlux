// What an ordinary evaluation reads from Fluxer and what it takes from the SDK's caches, which events keep current
import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { readSafetyAuthority } from "../src/safety-permissions.ts"
import { platform, token } from "./moderation-fixture.ts"

const createBot = () => createTestBot(createBotOptions({ token, serverId: "1456074443980800001" }))
type Bot = Effect.Success<ReturnType<typeof createBot>>
const run = (body: (bot: Bot, p: ReturnType<typeof platform>) => Effect.Effect<void, unknown>) =>
    Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createBot()
                const p = platform(bot)
                yield* bot.ready()
                yield* body(bot, p)
                assert.equal(bot.failures().length, 0)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
test("evaluation reads each input once and then cached copies, rereads roles a member holds unknown, and actions always read Fluxer", async () => {
    await run((bot, p) =>
        Effect.gen(function* () {
            const f = bot.fixtures,
                serverId = f.ids.guild
            const reads = () =>
                [p.guildRoute, p.rolesRoute, p.actor, p.ownMember, p.channel].map((route) => route.requests().length)
            const evaluate = readSafetyAuthority(bot.client, serverId, f.ids.user, {
                channelId: f.ids.channel,
                cached: true,
            })
            assert.equal((yield* evaluate).isOwner, true)
            assert.deepEqual(reads(), [1, 1, 1, 1, 1])
            // The bot's own member comes from the member cache
            assert.equal((yield* bot.client.members.getSelf(serverId))?.userId, f.ids.bot)
            yield* evaluate
            assert.deepEqual(reads(), [1, 1, 1, 1, 1])
            // A member update naming a role the kept list lacks shows that the list missed a change
            const unseen = f.role({ position: 5, permissions: Permissions.BanMembers.toString() })
            p.rolesRoute.remove()
            const roles = bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, unseen] })
            yield* bot.emit(
                "GUILD_MEMBER_UPDATE",
                f.member({ roles: [p.actorRole.id, unseen.id], communication_disabled_until: null }),
            )
            yield* bot.idle()
            assert.equal(
                (yield* evaluate).roles.some((role) => role.id === unseen.id),
                true,
            )
            assert.equal(roles.requests().length, 1)
            assert.deepEqual(reads().slice(2), [1, 1, 1])
            // Without cached, as for an action, every input is read again
            yield* readSafetyAuthority(bot.client, serverId, f.ids.user, { channelId: f.ids.channel })
            assert.deepEqual([...reads().slice(0, 1), roles.requests().length, ...reads().slice(2)], [2, 2, 2, 2, 2])
        }),
    )
})
