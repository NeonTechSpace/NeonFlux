import assert from "node:assert/strict"
import test from "node:test"
import { ANTI_NUKE_DEFAULT_LIMITS } from "@neonflux/contracts/anti-nuke"
import { createAntiNukeState, replayAntiNuke } from "../src/antinuke-detector.ts"

const events = (actor: string, action: "ban" | "kick" | "channel-delete" | "role-delete", count: number, gap: number) =>
    Array.from({ length: count }, (_, index) => ({ at: index * gap, actor, action }))

test("A family limit fires at machine speed and not at the pace a person works", () => {
    assert.equal(replayAntiNuke(events("1", "ban", 20, 1), { "1": "staff" }).nuke, true)
    assert.equal(replayAntiNuke(events("1", "ban", 30, 6), { "1": "staff" }).nuke, false)
    assert.equal(replayAntiNuke(events("1", "channel-delete", 6, 2), { "1": "staff" }).nuke, true)
    assert.equal(replayAntiNuke(events("1", "channel-delete", 30, 300), { "1": "staff" }).nuke, false)
})

test("The owner, NeonFlux and trusted accounts never nuke, and an account ranked above NeonFlux wants a lockdown", () => {
    for (const kind of ["owner", "neonflux", "trusted"] as const)
        assert.deepEqual(replayAntiNuke(events("1", "ban", 50, 0.2), { "1": kind }), { nuke: false, lockdown: false })
    assert.deepEqual(replayAntiNuke(events("1", "ban", 50, 0.2), { "1": "high" }), { nuke: true, lockdown: true })
    assert.deepEqual(replayAntiNuke(events("1", "ban", 50, 0.2), { "1": "staff" }), { nuke: true, lockdown: false })
})

test("Two accounts firing at once want a lockdown, and two wipes an hour apart do not", () => {
    const together = [...events("1", "ban", 20, 1), ...events("2", "ban", 20, 1)].sort((a, b) => a.at - b.at),
        apart = [...events("1", "ban", 20, 1), ...events("2", "ban", 20, 1).map((e) => ({ ...e, at: e.at + 3600 }))]
    const actors = { "1": "staff", "2": "staff" } as const
    assert.deepEqual(replayAntiNuke(together, actors), { nuke: true, lockdown: true })
    assert.deepEqual(replayAntiNuke(apart, actors), { nuke: true, lockdown: false })
})

test("Two accounts each under a limit fire together when they reach it between them", () => {
    const both = [...events("1", "channel-delete", 3, 2), ...events("2", "channel-delete", 3, 2)].sort(
        (a, b) => a.at - b.at,
    )
    assert.deepEqual(replayAntiNuke(both, { "1": "staff", "2": "staff" }), { nuke: true, lockdown: true })
})

test("A steady bot passes, a bot faster than a filter is stopped, and a person at that pace only draws an alert", () => {
    const pace = events("1", "ban", 120, 30)
    assert.equal(replayAntiNuke(pace, { "1": "bot" }).nuke, false)
    assert.equal(replayAntiNuke(pace, { "1": "staff" }).nuke, false)
    assert.equal(replayAntiNuke(events("1", "ban", 60, 10), { "1": "bot" }).nuke, true)
    const state = createAntiNukeState()
    const fired = pace.flatMap((event) => state.observe("1", "ban", event.at * 1000))
    assert.deepEqual(fired.map((each) => [each.rule, each.alertOnly]).slice(0, 1), [["slow", true]])
    // A long evening is a few lines, one per half hour at most
    assert.ok(fired.length <= 3)
})

test("A bot deleting channels faster than a voice bot closes rooms is stopped, and a slower one is left alone", () => {
    assert.equal(replayAntiNuke(events("1", "channel-delete", 20, 8), { "1": "bot" }).nuke, true)
    assert.equal(replayAntiNuke(events("1", "role-delete", 20, 10), { "1": "bot" }).nuke, true)
    assert.equal(replayAntiNuke(events("1", "channel-delete", 80, 30), { "1": "bot" }).nuke, false)
    assert.equal(replayAntiNuke(events("1", "channel-delete", 20, 8), { "1": "staff" }).nuke, false)
})

test("Entries that arrive out of order count at their own time", () => {
    const state = createAntiNukeState()
    for (const at of [48000, 0, 36000, 12000, 24000]) assert.deepEqual(state.observe("1", "channel-delete", at), [])
    assert.deepEqual(
        [60000, 60500, 61000, 61500, 62000]
            .flatMap((at) => state.observe("2", "channel-delete", at))
            .map((f) => f.rule),
        ["channels"],
    )
})

test("Releasing an account lets its next action fire again", () => {
    const state = createAntiNukeState()
    const fire = (from: number) =>
        Array.from({ length: 5 }, (_, index) => state.observe("1", "channel-delete", from + index * 100)).flat()
    assert.equal(fire(0).length, 1)
    assert.equal(fire(1000).length, 0)
    state.release("1")
    assert.equal(fire(2000).length, 1)
})

test("Two people tidying side by side are no partners, and two at machine speed are", () => {
    const side = [...events("1", "channel-delete", 6, 12), ...events("2", "channel-delete", 6, 12)].sort(
        (a, b) => a.at - b.at,
    )
    assert.deepEqual(replayAntiNuke(side, { "1": "staff", "2": "staff" }), { nuke: false, lockdown: false })
    const fast = [...events("1", "channel-delete", 3, 3), ...events("2", "channel-delete", 3, 3)].sort(
        (a, b) => a.at - b.at,
    )
    assert.deepEqual(replayAntiNuke(fast, { "1": "staff", "2": "staff" }), { nuke: true, lockdown: true })
})

test("The owner and a trusted account are nobody's partner and never make another account act at once", () => {
    for (const kind of ["owner", "trusted"] as const) {
        const both = [...events("1", "channel-delete", 3, 3), ...events("2", "channel-delete", 3, 3)].sort(
            (a, b) => a.at - b.at,
        )
        assert.deepEqual(replayAntiNuke(both, { "1": kind, "2": "staff" }), { nuke: false, lockdown: false })
        const wiping = [...events("1", "ban", 30, 0.5), ...events("2", "channel-delete", 8, 1)].sort(
            (a, b) => a.at - b.at,
        )
        assert.deepEqual(replayAntiNuke(wiping, { "1": kind, "2": "staff" }), { nuke: true, lockdown: false })
    }
    const state = createAntiNukeState()
    const fired = Array.from({ length: 12 }, (_, index) =>
        state.observe("1", "ban", index * 100, { alertOnly: true }),
    ).flat()
    assert.deepEqual(
        fired.map((each) => [each.rule, each.alertOnly]),
        [["bans", true]],
    )
    assert.equal(state.otherFiredNear("2", 2000), false)
})

test("A slow burn at maintenance pace only alerts, and leaves an account free to be stopped for what comes next", () => {
    assert.equal(replayAntiNuke(events("1", "channel-delete", 12, 60), { "1": "staff" }).nuke, false)
    assert.equal(replayAntiNuke(events("1", "kick", 41, 40), { "1": "staff" }).nuke, false)
    assert.equal(replayAntiNuke(events("1", "ban", 45, 30), { "1": "high" }).nuke, false)
    const state = createAntiNukeState()
    let at = 0
    const slow: unknown[] = []
    for (let index = 0; index < 13; index++) {
        at += 60000
        slow.push(...state.observe("1", "channel-delete", at).map((each) => [each.rule, each.alertOnly]))
    }
    assert.deepEqual(slow, [["slow", true]])
    assert.equal(state.otherFiredNear("2", at), false)
    const wipe = Array.from({ length: 5 }, (_, index) => state.observe("1", "channel-delete", at + index * 500)).flat()
    assert.deepEqual(
        wipe.map((each) => [each.rule, each.alertOnly]),
        [["channels", false]],
    )
})

test("An action through NeonFlux counts only when NeonFlux reports that kind for the member", () => {
    const via = (action: "ban" | "role-delete") =>
        Array.from({ length: 15 }, (_, index) => ({ at: index * 0.5, actor: "1", action, viaBot: true }))
    assert.equal(replayAntiNuke(via("ban"), { "1": "staff" }).nuke, true)
    assert.equal(replayAntiNuke(via("role-delete"), { "1": "staff" }).nuke, false)
    assert.equal(replayAntiNuke(events("9", "ban", 40, 0.2), { "9": "neonflux" }).nuke, false)
})

test("Setting a limit changes when it fires, and slow burns follow it", () => {
    const limits = { ...ANTI_NUKE_DEFAULT_LIMITS, bans: { count: 3, seconds: 60 } }
    assert.equal(replayAntiNuke(events("1", "ban", 3, 10), { "1": "staff" }, limits).nuke, true)
    assert.equal(replayAntiNuke(events("1", "ban", 3, 10), { "1": "staff" }).nuke, false)
})

test("One account fires once per cooldown, and its memory stays bounded", () => {
    const state = createAntiNukeState()
    const fired = Array.from({ length: 200 }, (_, index) => state.observe("1", "ban", index * 100).length).reduce(
        (sum, count) => sum + count,
    )
    assert.equal(fired, 1)
    const after = Array.from({ length: 15 }, (_, index) => state.observe("1", "ban", 400000 + index * 100)).flat()
    assert.deepEqual(
        after.map((each) => each.rule),
        ["bans"],
    )
    // Far more accounts than one server's memory holds do not throw, and each still counts on its own
    for (let id = 0; id < 1000; id++) state.observe(String(id + 2), "kick", 500000)
    assert.equal(state.observe("999", "kick", 500001).length, 0)
})
