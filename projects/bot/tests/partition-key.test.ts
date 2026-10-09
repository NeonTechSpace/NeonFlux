import assert from "node:assert/strict"
import test from "node:test"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { parseServerScope } from "@neonflux/contracts/service"
import { createBotOptions } from "../src/bot.ts"
import { fakeClient, quietSignal } from "./backend-fake.ts"

const client = fakeClient(() => Response.json({ error: "Backend unavailable" }, { status: 503 }), quietSignal)
const options = createBotOptions({
    token: Redacted.make("synthetic-token"),
    scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client },
})
const events = options.events as unknown as Record<string, { partition?: (event: object) => string | undefined }>
const keyOf = (name: string, event: object) => events[name]!.partition!(event)

test("the partition functions give the keys that the SDK's guild partition documents", () => {
    // The community ID first, then the channel or thread ID, and the event's own ID for the events that describe one
    assert.equal(keyOf("messageCreate", { guildId: "1", channelId: "2" }), "1")
    assert.equal(keyOf("messageCreate", { channelId: "2" }), "2")
    assert.equal(keyOf("messageDelete", { id: "9", channelId: "2" }), "2")
    assert.equal(keyOf("guildCreate", { id: "1" }), "1")
    assert.equal(keyOf("guildUpdate", { id: "1" }), "1")
    assert.equal(keyOf("guildDelete", { id: "1" }), "1")
    assert.equal(keyOf("guildChannelCreate", { id: "2" }), "2")
    assert.equal(keyOf("guildChannelUpdate", { id: "2" }), "2")
    assert.equal(keyOf("guildChannelDelete", { id: "2" }), "2")
    assert.equal(keyOf("threadDelete", { id: "3" }), "3")
    assert.equal(keyOf("threadCreate", { id: "3" }), "3")
    assert.equal(keyOf("threadUpdate", { threadId: "3" }), "3")
    assert.equal(keyOf("threadUpdate", { guildId: "1", threadId: "3" }), "1")
    // An event with no server or channel, and an ID that is not text, have no key, which the SDK reads as the empty key
    assert.equal(keyOf("guildMemberAdd", { userId: "1" }), undefined)
    assert.equal(keyOf("messageCreate", { guildId: 5 }), undefined)
})

test("the partition functions give the keys of the SDK's own guild partition for a real frame of every event", async () => {
    // Every event name that has a partition function, which includes guildCreate and guildDelete
    const names = Object.keys(events).filter((name) => events[name]!.partition)
    const seen: { name: string; event: object }[] = []
    const keys: { name: string; key: string }[] = []
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({
                    token: "synthetic-token",
                    events: Object.fromEntries(
                        names.map((name) => [
                            name,
                            {
                                partition: "guild",
                                partitionReady: (key: string) => Effect.sync(() => void keys.push({ name, key })),
                                handler: ({ event }: { event: object }) =>
                                    Effect.sync(() => void seen.push({ name, event })),
                            },
                        ]),
                    ),
                } as never)
                yield* bot.ready()
                const f = bot.fixtures
                const guild = f.ids.guild,
                    channel = f.ids.channel
                const thread = f.thread({ name: "plans" })
                const role = f.role()
                const { guild_id: _guild, ...direct } = f.message()
                const reaction = {
                    channel_id: channel,
                    message_id: f.nextId(),
                    user_id: f.ids.user,
                    emoji: { name: "✅" },
                }
                const frames: [string, object][] = [
                    ["MESSAGE_CREATE", f.message()],
                    ["MESSAGE_CREATE", direct],
                    ["MESSAGE_UPDATE", f.message()],
                    ["MESSAGE_DELETE", { id: f.nextId(), channel_id: channel }],
                    ["MESSAGE_DELETE_BULK", { ids: [f.nextId()], channel_id: channel, guild_id: guild }],
                    ["MESSAGE_REACTION_ADD", { ...reaction, guild_id: guild }],
                    ["MESSAGE_REACTION_ADD", reaction],
                    [
                        "MESSAGE_REACTION_ADD_MANY",
                        { ...reaction, guild_id: guild, reactions: [{ user_id: f.ids.user, emoji: { name: "✅" } }] },
                    ],
                    ["MESSAGE_REACTION_REMOVE", { ...reaction, guild_id: guild }],
                    [
                        "MESSAGE_REACTION_REMOVE_ALL",
                        { channel_id: channel, message_id: reaction.message_id, guild_id: guild },
                    ],
                    [
                        "MESSAGE_REACTION_REMOVE_EMOJI",
                        {
                            channel_id: channel,
                            message_id: reaction.message_id,
                            guild_id: guild,
                            emoji: { name: "✅" },
                        },
                    ],
                    ["GUILD_MEMBER_ADD", f.member()],
                    ["GUILD_MEMBER_UPDATE", f.member()],
                    ["GUILD_MEMBER_REMOVE", { guild_id: guild, user: f.user() }],
                    ["GUILD_ROLE_CREATE", { guild_id: guild, role }],
                    ["GUILD_ROLE_UPDATE", { guild_id: guild, role }],
                    ["GUILD_ROLE_UPDATE_BULK", { guild_id: guild, roles: [role] }],
                    ["GUILD_ROLE_DELETE", { guild_id: guild, role_id: role.id }],
                    ["CHANNEL_CREATE", f.channel({ guild_id: guild })],
                    ["CHANNEL_UPDATE", f.channel({ guild_id: guild })],
                    ["CHANNEL_UPDATE_BULK", { guild_id: guild, channels: [f.channel({ guild_id: guild })] }],
                    ["CHANNEL_DELETE", f.channel({ guild_id: guild })],
                    ["GUILD_UPDATE", f.guild()],
                    ["GUILD_DELETE", { id: guild, unavailable: true }],
                    ["GUILD_CREATE", f.guildCreate({ channels: [], voice_states: [] })],
                    [
                        "GUILD_AUDIT_LOG_ENTRY_CREATE",
                        {
                            guild_id: guild,
                            id: f.nextId(),
                            action_type: 31,
                            user_id: f.ids.user,
                            target_id: role.id,
                            changes: [{ key: "permissions", old_value: "0", new_value: "8" }],
                        },
                    ],
                    [
                        "VOICE_STATE_UPDATE",
                        {
                            guild_id: guild,
                            channel_id: channel,
                            user_id: f.ids.user,
                            connection_id: "c1",
                            mute: false,
                            deaf: false,
                            self_mute: false,
                            self_deaf: false,
                            is_mobile: false,
                            suppress: false,
                        },
                    ],
                    ["THREAD_CREATE", thread],
                    ["THREAD_UPDATE", { ...thread, name: "renamed" }],
                    ["THREAD_DELETE", { id: thread.id, guild_id: guild, parent_id: channel, type: 11 }],
                    ["THREAD_LIST_SYNC", { guild_id: guild, threads: [], members: [] }],
                ]
                for (const [type, payload] of frames) yield* bot.emit(type, payload)
                yield* bot.idle({ timeoutMs: 30000 })
            }),
        ),
    )
    // Each subscription sees its events in arrival order, so the keys pair with the events by name
    for (const name of names) {
        const named = seen.filter((entry) => entry.name === name).map((entry) => entry.event)
        assert.equal(named.length > 0, true, `${name} was not delivered`)
        assert.deepEqual(
            named.map((event) => keyOf(name, event) ?? ""),
            keys.filter((entry) => entry.name === name).map((entry) => entry.key),
            name,
        )
    }
})
