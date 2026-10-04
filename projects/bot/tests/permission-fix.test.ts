import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { fixSentence, labelList, permissionNames } from "../src/permission-fix.ts"
import { createModerationStore, ModerationStoreError } from "../src/moderation-store.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { fakeClient } from "./backend-fake.ts"

test("the fix sentence names the permissions to grant, the channel they must reach and the roles to rank above", () => {
    assert.equal(fixSentence({ permissions: ["KickMembers"] }), "Grant Kick members to the NeonFlux role")
    assert.equal(
        fixSentence({
            permissions: permissionNames(Permissions.ManageGuild | Permissions.BanMembers | Permissions.ManageRoles),
        }),
        "Grant Ban members, Manage community and Manage roles to the NeonFlux role",
    )
    assert.equal(
        fixSentence({ permissions: ["SendMessages"], channelId: "11" }),
        "Grant Send messages to the NeonFlux role and allow it in <#11>",
    )
    assert.equal(
        fixSentence({ permissions: ["KickMembers"], roles: ["21"] }),
        "Grant Kick members to the NeonFlux role and move it above <@&21>",
    )
    assert.equal(fixSentence({ roles: ["21", "22"] }), "Move the NeonFlux role above <@&21> and <@&22>")
})

test("backend reason codes reach the stores, so a refusal can name its fix", async () => {
    const serverId = "123456789012345678"
    const backend = (code: string) => ({
        url: "https://synthetic.invalid",
        secret: Redacted.make("synthetic-secret"),
        serverId,
        client: fakeClient(() => Response.json({ error: "Synthetic refusal", code }, { status: 403 })),
    })
    const moderation = await Effect.runPromise(
        Effect.flip(
            createModerationStore(backend("BOT_BELOW_TARGET")).query({
                serverId,
                actor: {
                    userId: "2",
                    roleIds: [],
                    isOwner: true,
                    isAdministrator: true,
                    nativePermissionAuthorized: true,
                },
                operation: { type: "settings" },
            }),
        ),
    )
    assert.equal(moderation.code, "BOT_BELOW_TARGET")
})

test("a moderation action refused for the bot's permission or rank replies with what to change", async () => {
    for (const code of ["BOT_PERMISSION", "BOT_BELOW_TARGET", "ACTOR_BELOW_TARGET"]) {
        const f = createFixtures()
        const b = boundary({
            manage: () => Effect.fail(new ModerationStoreError({ operation: "/moderation/manage", status: 403, code })),
        })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                    )
                    const p = platform(bot, { botPermissions: Permissions.ViewChannel | Permissions.SendMessages })
                    yield* bot.ready()
                    yield* bot
                        .emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!mod kick ${p.targetId} reason` }))
                        .pipe(Effect.andThen(bot.idle()))
                    const replies = p.replies.requests().map((row) => (row.body as { content: string }).content)
                    assert.deepEqual(replies, [
                        code === "BOT_PERMISSION"
                            ? "Grant Kick members to the NeonFlux role"
                            : code === "BOT_BELOW_TARGET"
                              ? `Move the NeonFlux role above <@&${p.targetRole.id}>`
                              : `Your highest role must rank above <@&${p.targetRole.id}> to act on this member`,
                    ])
                }),
            ),
        )
    }
})

test("a purge the bot lacks Manage messages for names the permission and the channel", async () => {
    const f = createFixtures(),
        b = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }),
                )
                const p = platform(bot, {
                    botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory,
                })
                yield* bot.ready()
                yield* bot
                    .emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!mod purge 5 reason" }))
                    .pipe(Effect.andThen(bot.idle()))
                assert.deepEqual(
                    p.replies.requests().map((row) => (row.body as { content: string }).content),
                    [`Grant Manage messages to the NeonFlux role and allow it in <#${f.ids.channel}>`],
                )
                assert.equal(
                    b.calls.some((call) => call.method === "manage"),
                    false,
                )
            }),
        ),
    )
})

test("a permission key the SDK does not know shows as it is instead of failing the sentence", () => {
    assert.equal(labelList(["KickMembers", "ManageEvents"]), "Kick members and ManageEvents")
    assert.equal(fixSentence({ permissions: ["ManageEvents"] }), "Grant ManageEvents to the NeonFlux role")
})
