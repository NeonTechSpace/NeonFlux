import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { isMetadataLogCommand, metadataEventLabel, metadataLogEventSelectors, parseMetadataLogCommand } from "../src/metadata-log-command.ts"
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

test("Status, categories and overrides are separate reports and overrides page with next", () => {
    assert.deepEqual(parseMetadataLogCommand(["metadata", "status"]), { type: "query", operation: { type: "settings" } })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "categories"]), { type: "query", operation: { type: "settings" }, view: "categories" })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "overrides"]), { type: "query", operation: { type: "settings" }, view: "overrides" })
    assert.deepEqual(parseMetadataLogCommand(["metadata", "overrides", "next"]), { type: "query", operation: { type: "settings" }, view: "overrides", next: true })
    for (const args of [["metadata", "status", "next"], ["metadata", "categories", "next"], ["metadata", "overrides", "2"], ["metadata", "overrides", "next", "next"]]) assert("error" in parseMetadataLogCommand(args), JSON.stringify(args))
})

test("Every event type and audit action has a plain label", () => {
    for (const selector of metadataLogEventSelectors) assert.match(metadataEventLabel(selector), /^[A-Z][A-Za-z ]+(: [A-Z][A-Za-z ]+)?$/, selector)
    assert.equal(metadataEventLabel("member-add"), "Member joined")
    assert.equal(metadataEventLabel("audit-entry:20"), "Audit: Member kicked")
    assert.equal(new Set(metadataLogEventSelectors.map(metadataEventLabel)).size, metadataLogEventSelectors.length)
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

test("Event overrides take an event's plain name in any case, spread over several words, as well as its code", () => {
    const channel = `<#${f.ids.channel}>`, owner = `<@${f.ids.user}>`
    // Every name and code reaches its own event, so no two collide
    for (const selector of metadataLogEventSelectors) for (const typed of [metadataEventLabel(selector), selector]) {
        const words = typed.split(" ")
        assert.deepEqual(parseMetadataLogCommand(["metadata", "inherit", ...words]), { type: "manage", operation: { type: "event-clear", eventType: selector } }, typed)
        assert.deepEqual(parseMetadataLogCommand(["metadata", "event", ...words, "off"]), { type: "manage", operation: { type: "event-route", eventType: selector, enabled: false } }, typed)
        assert.deepEqual(parseMetadataLogCommand(["metadata", "event", ...words, channel, owner, "on"]), { type: "manage", operation: { type: "event-route", eventType: selector, enabled: true, channelId: f.ids.channel, ownerId: f.ids.user } }, typed)
    }
    for (const words of [["MEMBER", "joined"], ["member", "JOINED"], ["Member-Add"]]) assert.deepEqual(parseMetadataLogCommand(["metadata", "event", ...words, "off"]), { type: "manage", operation: { type: "event-route", eventType: "member-add", enabled: false } }, words.join(" "))
    for (const words of [["audit", "member", "kicked"], ["Audit:", "member", "KICKED"], ["audit:member", "kicked"], ["AUDIT-ENTRY:20"]]) assert.deepEqual(parseMetadataLogCommand(["metadata", "inherit", ...words]), { type: "manage", operation: { type: "event-clear", eventType: "audit-entry:20" } }, words.join(" "))
    assert.deepEqual(parseMetadataLogCommand(["metadata", "event", "Connection", "to", "Fluxer", "interrupted", f.ids.channel, f.ids.user, "on"]),
        { type: "manage", operation: { type: "event-route", eventType: "gateway-discontinuity", enabled: true, channelId: f.ids.channel, ownerId: f.ids.user } })
    // Unknown names, a missing owner and a channel or owner inside the name are refused
    for (const args of [["metadata", "inherit", "Member", "arrived"], ["metadata", "event", "Member", "off"], ["metadata", "inherit"], ["metadata", "event", "off"], ["metadata", "event", "Member", "joined", channel, "on"],
        ["metadata", "event", "Member", channel, "joined", owner, "on"], ["metadata", "event", "Member", "joined", channel, "off"], ["metadata", "event", "Member", "joined", channel, owner, "maybe"], ["metadata", "inherit", "Member", "joined", owner]])
        assert("error" in parseMetadataLogCommand(args), JSON.stringify(args))
})
