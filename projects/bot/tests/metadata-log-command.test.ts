import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { isMetadataLogCommand, parseMetadataLogCommand } from "../src/metadata-log-command.ts"
import { parseSafetyCommand } from "../src/moderation-command.ts"
const f = createFixtures()
test("metadata grammar leaves existing moderation log commands unchanged", () => {
    for (const args of [["channel", "off"], ["status"], ["show", "1"], ["list", "2"], ["recover", "1"]]) {
        assert.equal(isMetadataLogCommand(args), false); assert(!("error" in parseSafetyCommand("logs", args)))
    }
    assert.deepEqual(parseMetadataLogCommand(["metadata", "route", "membership", "1", f.ids.channel, f.ids.user, "on"]), { type: "route", category: "membership", expectedRevision: 1, channelId: f.ids.channel, ownerId: f.ids.user, enabled: true })
    assert.deepEqual(parseMetadataLogCommand(["counters"]), { type: "query", operation: { type: "counters" } })
    assert.deepEqual(parseMetadataLogCommand(["events", "list", "5"]), { type: "query", operation: { type: "list", beforeRecordNo: 5 } })
    assert("error" in parseMetadataLogCommand(["counters", "extra"]))
    assert.equal(isMetadataLogCommand(["diagnose"]), false)
    assert("error" in parseMetadataLogCommand(["metadata", "channels", "1", `${f.ids.channel},${f.ids.channel}`, "none"]))
})

test("Event overrides distinguish disabled destinations from restored inheritance and use global configuration revisions", () => {
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "member-remove", "0", "off"]), { type: "manage", operation: { type: "event-route", eventType: "member-remove", expectedRevision: 0, enabled: false } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "member-add", "2", f.ids.channel, f.ids.user, "on"]), { type: "event-route", eventType: "member-add", expectedRevision: 2, channelId: f.ids.channel, ownerId: f.ids.user })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "inherit", "member-remove", "3"]), { type: "manage", operation: { type: "event-clear", eventType: "member-remove", expectedRevision: 3 } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "audit-entry:20", "4", "off"]), { type: "manage", operation: { type: "event-route", eventType: "audit-entry:20", expectedRevision: 4, enabled: false } })
    assert("error" in parseMetadataLogCommand(["metadata", "event", "audit-entry:999", "4", "off"]))
    for (const args of [["metadata", "inherit", "unknown", "1"], ["metadata", "event", "member-add", "1", "on"], ["metadata", "event", "member-add", "1", f.ids.channel, f.ids.user, "off"]]) assert("error" in parseMetadataLogCommand(args))
})
