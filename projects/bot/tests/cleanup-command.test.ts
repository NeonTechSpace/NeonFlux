import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { cleanupCritical, parseCleanupCommand } from "../src/cleanup-command.ts"

test("cleanup grammar requires explicit ages and enable confirmation without revisions", () => {
    const f = createFixtures(),
        channel = `<#${f.ids.channel}>`
    assert.deepEqual(parseCleanupCommand(["configure", channel, "1h"]), {
        type: "configure",
        channelId: f.ids.channel,
        ageMs: 3600000,
    })
    assert.deepEqual(parseCleanupCommand(["configure", channel, "365d"]), {
        type: "configure",
        channelId: f.ids.channel,
        ageMs: 31536000000,
    })
    assert.deepEqual(parseCleanupCommand(["configure", channel, "1H"]), {
        type: "configure",
        channelId: f.ids.channel,
        ageMs: 3600000,
    })
    for (const age of ["59m", "366d", "1.5h", "forever", "999999999999999999999d", "1h500ms"])
        assert.ok("error" in parseCleanupCommand(["configure", channel, age]))
    assert.deepEqual(parseCleanupCommand(["enable", channel]), {
        type: "enable",
        channelId: f.ids.channel,
        confirmed: false,
    })
    assert.deepEqual(parseCleanupCommand(["enable", channel, "confirm"]), {
        type: "enable",
        channelId: f.ids.channel,
        confirmed: true,
    })
    assert.deepEqual(parseCleanupCommand(["disable", channel]), { type: "disable", channelId: f.ids.channel })
    assert.deepEqual(parseCleanupCommand(["module", "on"]), { type: "module", enabled: true })
    assert.deepEqual(parseCleanupCommand(["status"]), { type: "status" })
    assert.deepEqual(parseCleanupCommand(["status", channel]), { type: "status", channelId: f.ids.channel })
    assert.deepEqual(parseCleanupCommand(["status", channel, "messages"]), {
        type: "messages",
        channelId: f.ids.channel,
        next: false,
    })
    assert.deepEqual(parseCleanupCommand(["status", channel, "messages", "next"]), {
        type: "messages",
        channelId: f.ids.channel,
        next: true,
    })
    assert.deepEqual(parseCleanupCommand(["list"]), { type: "list", next: false })
    assert.deepEqual(parseCleanupCommand(["list", "next"]), { type: "list", next: true })
    for (const args of [
        ["configure", channel],
        ["configure", channel, "0", "1h"],
        ["enable", channel, "2"],
        ["enable", channel, "2", "confirm"],
        ["enable", channel, "yes"],
        ["disable", channel, "confirm"],
        ["disable", channel, "1"],
        ["module", "on", "1"],
        ["status", channel, "20"],
        ["status", channel, "next"],
        ["status", "next"],
        ["status", "messages"],
        ["status", channel, "messages", "2"],
        ["status", channel, "messages", "next", "next"],
        ["list", "1"],
        ["list", "next", "next"],
        ["reconcile", "guessed_attempt"],
    ])
        assert("error" in parseCleanupCommand(args), JSON.stringify(args))
})
test("cleanup management keeps disable and status critical and rejects removed commands", () => {
    const f = createFixtures()
    for (const args of [
        ["disable", f.ids.channel],
        ["status"],
        ["status", f.ids.channel],
        ["status", f.ids.channel, "messages", "next"],
        ["list", "next"],
        ["module", "off"],
    ])
        assert.equal(cleanupCritical(parseCleanupCommand(args)), true)
    assert.deepEqual(parseCleanupCommand(["exclude", f.ids.channel, "author", "add", `<@${f.ids.user}>`]), {
        type: "exclude",
        channelId: f.ids.channel,
        kind: "author",
        add: true,
        id: f.ids.user,
    })
    for (const args of [
        ["exclude", f.ids.channel, "1", "author", "add", `<@${f.ids.user}>`],
        ["owner", f.ids.channel, "1", `<@${f.ids.user}>`],
        ["reconcile", f.ids.channel, "1"],
        ["forget", f.ids.channel, "1", "confirm"],
    ])
        assert("error" in parseCleanupCommand(args))
})

test("cleanup arguments accept only their own kind of mention", () => {
    const f = createFixtures(),
        role = "323456789012345679",
        message = "423456789012345679"
    assert.ok("error" in parseCleanupCommand(["show", `<@${f.ids.user}>`]))
    assert.ok("error" in parseCleanupCommand(["show", `<@&${role}>`]))
    assert.deepEqual(parseCleanupCommand(["show", f.ids.channel]), { type: "show", channelId: f.ids.channel })
    const exclude = (kind: string, id: string) =>
        parseCleanupCommand(["exclude", `<#${f.ids.channel}>`, kind, "add", id])
    assert.deepEqual(exclude("author", `<@${f.ids.user}>`), {
        type: "exclude",
        channelId: f.ids.channel,
        kind: "author",
        add: true,
        id: f.ids.user,
    })
    assert.ok("error" in exclude("author", `<@&${role}>`))
    assert.ok("error" in exclude("author", `<#${f.ids.channel}>`))
    // A message has no mention form, so only its ID names it
    assert.deepEqual(exclude("message", message), {
        type: "exclude",
        channelId: f.ids.channel,
        kind: "message",
        add: true,
        id: message,
    })
    assert.ok("error" in exclude("message", `<@${f.ids.user}>`))
    // An age is a duration of whole units from 1h to 365d
    assert.deepEqual(parseCleanupCommand(["configure", `<#${f.ids.channel}>`, "2w"]), {
        type: "configure",
        channelId: f.ids.channel,
        ageMs: 1209600000,
    })
})
