import assert from "node:assert/strict"
import test from "node:test"
import type { Client, GuildThreadChannel } from "@neontechspace/fluxerly/effect"
import {
    forgetServerThreads,
    forgetShardThreads,
    forgetThreadsOf,
    noticeThread,
    rememberThread,
    threadForgets,
} from "../src/thread-memory.ts"

// Servers "10" and "12" are on shard 0, server "11" on shard 1
const shardIdForGuild = (guildId: string) => (Number(guildId) % 2 === 0 ? 0 : 1)
const thread = (id: string, guildId: string, parentId = "900") =>
    ({ id, guildId, parentId, type: 11, name: id }) as unknown as GuildThreadChannel

test("a shard that loses its connection makes the bot forget only the threads of its servers", () => {
    const own = new FakeClient()
    for (const [id, guildId] of [
        ["1", "10"],
        ["2", "11"],
        ["3", "12"],
    ] as const)
        rememberThread(own.client, thread(id, guildId))
    forgetShardThreads(own.client, 0)
    assert.deepEqual(
        [
            rememberThread(own.client, thread("1", "10")),
            rememberThread(own.client, thread("2", "11")),
            rememberThread(own.client, thread("3", "12")),
        ].map((previous) => previous?.id),
        [undefined, "2", undefined],
    )
})

test("a read teaches a thread only when no event did and nothing was forgotten since the read began", () => {
    const own = new FakeClient()
    const before = threadForgets(own.client)
    noticeThread(own.client, thread("1", "10"), before)
    assert.equal(rememberThread(own.client, thread("1", "10"))?.id, "1")
    const stale = threadForgets(own.client)
    forgetServerThreads(own.client, "10")
    noticeThread(own.client, thread("2", "10"), stale)
    assert.equal(rememberThread(own.client, thread("2", "10")), undefined)
    // A thread an event taught keeps the event's copy
    const event = thread("3", "10")
    rememberThread(own.client, event)
    noticeThread(own.client, { ...event, name: "read" } as GuildThreadChannel, threadForgets(own.client))
    assert.equal(rememberThread(own.client, event)?.name, "3")
    assert.deepEqual(forgetThreadsOf(own.client, "900").sort(), ["2", "3"])
})

// Each test takes its own client, because the memory belongs to the client
class FakeClient {
    readonly client = { shardIdForGuild } as unknown as Client
}
