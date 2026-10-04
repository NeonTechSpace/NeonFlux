import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { cleanupAge, cleanupCritical, parseCleanupCommand } from "../src/cleanup-command.ts"

test("cleanup grammar requires explicit ages, exact revisions and enable confirmation", () => {
    const f = createFixtures(), channel = `<#${f.ids.channel}>`
    assert.deepEqual(parseCleanupCommand(["configure", channel, "0", "1h"]), { type: "configure", channelId: f.ids.channel, expectedRevision: 0, ageMs: 3600000 })
    assert.equal(cleanupAge("365d"), 31536000000)
    for (const age of ["59m", "366d", "1.5h", "forever", "999999999999999999999d"]) assert.equal(cleanupAge(age), undefined)
    assert.deepEqual(parseCleanupCommand(["enable", channel, "2"]), { type: "enable", channelId: f.ids.channel, expectedRevision: 2, confirmed: false })
    assert.deepEqual(parseCleanupCommand(["enable", channel, "2", "confirm"]), { type: "enable", channelId: f.ids.channel, expectedRevision: 2, confirmed: true })
    for (const args of [["configure", channel, "0"], ["enable", channel, "0", "confirm"], ["enable", channel, "2", "yes"], ["disable", channel, "2", "confirm"], ["module", "on", "01"], ["list", "1"], ["reconcile", "guessed_attempt"]]) assert("error" in parseCleanupCommand(args))
})
test("cleanup management keeps disable and status critical and rejects removed commands", () => {
    const f = createFixtures()
    for (const args of [["disable", f.ids.channel, "1"], ["status"], ["status", f.ids.channel, "20"], ["module", "off", "1"]]) assert.equal(cleanupCritical(parseCleanupCommand(args)), true)
    assert.deepEqual(parseCleanupCommand(["exclude", f.ids.channel, "1", "author", "add", `<@${f.ids.user}>`]), { type: "exclude", channelId: f.ids.channel, expectedRevision: 1, kind: "author", add: true, id: f.ids.user })
    for (const args of [["owner", f.ids.channel, "1", `<@${f.ids.user}>`], ["reconcile", f.ids.channel, "1"], ["forget", f.ids.channel, "1", "confirm"]]) assert("error" in parseCleanupCommand(args))
})
