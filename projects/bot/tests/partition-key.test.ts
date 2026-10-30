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
const events = options.events as unknown as Record<
    string,
    { partition?: "guild" | ((event: object) => string | undefined) }
>
// Only a server's join and removal have their own partition functions, which also report the change to the registry
const reporting = ["guildCreate", "guildDelete"]
const keyOf = (name: string, event: object) => (events[name]!.partition as (event: object) => string | undefined)(event)

test("routed events use the SDK's guild partition, and a server's join and removal are keyed by the server", () => {
    for (const [name, settings] of Object.entries(events))
        if (!reporting.includes(name)) assert.equal(settings.partition, "guild", name)
    assert.equal(keyOf("guildCreate", { id: "1" }), "1")
    assert.equal(keyOf("guildDelete", { id: "1", unavailable: true }), "1")
})

test("the join and removal partition functions give the keys of the SDK's own guild partition for real frames", async () => {
    const seen: { name: string; event: object }[] = []
    const keys: { name: string; key: string }[] = []
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({
                    token: "synthetic-token",
                    events: Object.fromEntries(
                        reporting.map((name) => [
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
                yield* bot.emit("GUILD_DELETE", { id: f.ids.guild, unavailable: true })
                yield* bot.emit("GUILD_CREATE", f.guildCreate({ channels: [], voice_states: [] }))
                yield* bot.idle({ timeoutMs: 30000 })
            }),
        ),
    )
    // Each subscription sees its events in arrival order, so the keys pair with the events by name
    for (const name of reporting) {
        const named = seen.filter((entry) => entry.name === name).map((entry) => entry.event)
        assert.equal(named.length > 0, true, `${name} was not delivered`)
        assert.deepEqual(
            named.map((event) => keyOf(name, event) ?? ""),
            keys.filter((entry) => entry.name === name).map((entry) => entry.key),
            name,
        )
    }
})
