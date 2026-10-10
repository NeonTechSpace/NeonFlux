import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { cleanupAge, cleanupCritical, parseCleanupCommand } from "../src/cleanup-command.ts"

test("cleanup grammar requires explicit ages and enable confirmation without revisions", () => {
    const f = createFixtures(), channel = `<#${f.ids.channel}>`
    assert.deepEqual(parseCleanupCommand(["configure", channel, "1h"]), { type: "configure", channelId: f.ids.channel, ageMs: 3600000 })
    assert.equal(cleanupAge("365d"), 31536000000)
    for (const age of ["59m", "366d", "1.5h", "forever", "999999999999999999999d"]) assert.equal(cleanupAge(age), undefined)
    assert.deepEqual(parseCleanupCommand(["enable", channel]), { type: "enable", channelId: f.ids.channel, confirmed: false })
    assert.deepEqual(parseCleanupCommand(["enable", channel, "confirm"]), { type: "enable", channelId: f.ids.channel, confirmed: true })
    assert.deepEqual(parseCleanupCommand(["disable", channel]), { type: "disable", channelId: f.ids.channel })
    assert.deepEqual(parseCleanupCommand(["module", "on"]), { type: "module", enabled: true })
    assert.deepEqual(parseCleanupCommand(["status"]), { type: "status" })
    assert.deepEqual(parseCleanupCommand(["status", channel]), { type: "status", channelId: f.ids.channel })
    assert.deepEqual(parseCleanupCommand(["status", channel, "messages"]), { type: "messages", channelId: f.ids.channel, next: false })
    assert.deepEqual(parseCleanupCommand(["status", channel, "messages", "next"]), { type: "messages", channelId: f.ids.channel, next: true })
    assert.deepEqual(parseCleanupCommand(["list"]), { type: "list", next: false })
    assert.deepEqual(parseCleanupCommand(["list", "next"]), { type: "list", next: true })
    for (const args of [["configure", channel], ["configure", channel, "0", "1h"], ["enable", channel, "2"], ["enable", channel, "2", "confirm"], ["enable", channel, "yes"], ["disable", channel, "confirm"], ["disable", channel, "1"], ["module", "on", "1"],
        ["status", channel, "20"], ["status", channel, "next"], ["status", "next"], ["status", "messages"], ["status", channel, "messages", "2"], ["status", channel, "messages", "next", "next"], ["list", "1"], ["list", "next", "next"], ["reconcile", "guessed_attempt"]]) assert("error" in parseCleanupCommand(args), JSON.stringify(args))
})
test("cleanup management keeps disable and status critical and rejects removed commands", () => {
    const f = createFixtures()
    for (const args of [["disable", f.ids.channel], ["status"], ["status", f.ids.channel], ["status", f.ids.channel, "messages", "next"], ["list", "next"], ["module", "off"]]) assert.equal(cleanupCritical(parseCleanupCommand(args)), true)
    assert.deepEqual(parseCleanupCommand(["exclude", f.ids.channel, "author", "add", `<@${f.ids.user}>`]), { type: "exclude", channelId: f.ids.channel, kind: "author", add: true, id: f.ids.user })
    for (const args of [["exclude", f.ids.channel, "1", "author", "add", `<@${f.ids.user}>`], ["owner", f.ids.channel, "1", `<@${f.ids.user}>`], ["reconcile", f.ids.channel, "1"], ["forget", f.ids.channel, "1", "confirm"]]) assert("error" in parseCleanupCommand(args))
})
