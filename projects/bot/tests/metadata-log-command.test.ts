import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { isMetadataLogCommand, parseMetadataLogCommand } from "../src/metadata-log-command.ts"
import { parseSafetyCommand } from "../src/moderation-command.ts"
const f = createFixtures()
test("metadata grammar leaves existing moderation log commands unchanged and takes no revisions", () => {
    for (const args of [["channel", "off"], ["status"], ["show", "1"], ["list", "next"], ["recover", "1"]]) {
        assert.equal(isMetadataLogCommand(args), false); assert(!("error" in parseSafetyCommand("logs", args)))
    }
    assert.deepEqual(parseMetadataLogCommand(["metadata", "route", "membership", f.ids.channel, f.ids.user, "on"]), { type: "manage", operation: { type: "route", category: "membership", channelId: f.ids.channel, ownerId: f.ids.user, enabled: true } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "module", "off"]), { type: "manage", operation: { type: "module", enabled: false } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "clear", "audit"]), { type: "manage", operation: { type: "clear", category: "audit" } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "channels", f.ids.channel, "none"]), { type: "manage", operation: { type: "channels", messageChannelIds: [f.ids.channel], excludedChannelIds: [] } })
    assert.deepEqual(parseMetadataLogCommand(["counters"]), { type: "query", operation: { type: "counters" } })
    assert.deepEqual(parseMetadataLogCommand(["events", "list"]), { type: "query", operation: { type: "list" } })
    assert.deepEqual(parseMetadataLogCommand(["events", "list", "next"]), { type: "query", operation: { type: "list" }, next: true })
    assert("error" in parseMetadataLogCommand(["counters", "extra"]))
    assert.equal(isMetadataLogCommand(["diagnose"]), false)
    assert("error" in parseMetadataLogCommand(["metadata", "channels", `${f.ids.channel},${f.ids.channel}`, "none"]))
    for (const args of [["events", "list", "5"], ["metadata", "module", "on", "1"], ["metadata", "route", "membership", "1", f.ids.channel, f.ids.user, "on"], ["metadata", "clear", "audit", "2"], ["metadata", "channels", "1", f.ids.channel, "none"]]) assert("error" in parseMetadataLogCommand(args), JSON.stringify(args))
})

test("Event overrides distinguish disabled destinations from restored inheritance without typed revisions", () => {
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "member-remove", "off"]), { type: "manage", operation: { type: "event-route", eventType: "member-remove", enabled: false } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "member-add", f.ids.channel, f.ids.user, "on"]), { type: "manage", operation: { type: "event-route", eventType: "member-add", enabled: true, channelId: f.ids.channel, ownerId: f.ids.user } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "inherit", "member-remove"]), { type: "manage", operation: { type: "event-clear", eventType: "member-remove" } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "audit-entry:20", "off"]), { type: "manage", operation: { type: "event-route", eventType: "audit-entry:20", enabled: false } })
    assert("error" in parseMetadataLogCommand(["metadata", "event", "audit-entry:999", "off"]))
    for (const args of [["metadata", "inherit", "unknown"], ["metadata", "inherit", "member-remove", "3"], ["metadata", "event", "member-add", "on"], ["metadata", "event", "member-add", f.ids.channel, f.ids.user, "off"],
        ["metadata", "event", "member-remove", "0", "off"], ["metadata", "event", "member-add", "2", f.ids.channel, f.ids.user, "on"]]) assert("error" in parseMetadataLogCommand(args), JSON.stringify(args))
})
