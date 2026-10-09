import assert from "node:assert/strict"
import test from "node:test"
import { parseVoiceCommand, voicePublic } from "../src/voice-command.ts"

test("voice commands use plain verbs for generators and room owners", () => {
    assert.deepEqual(parseVoiceCommand([]), { type: "help" })
    assert.deepEqual(parseVoiceCommand(["generator", "add", "Join to create"]), { type: "generator-add", channelName: "Join to create", categoryId: null })
    assert.deepEqual(parseVoiceCommand(["generator", "add", "Join", "to", "create", "123"]), { type: "generator-add", channelName: "Join to create", categoryId: "123" })
    assert.deepEqual(parseVoiceCommand(["generator", "add", "Join", "none"]), { type: "generator-add", channelName: "Join", categoryId: null })
    assert.deepEqual(parseVoiceCommand(["generator", "list"]), { type: "generator-list" })
    assert.deepEqual(parseVoiceCommand(["generator", "remove", "<#55>"]), { type: "generator-remove", channelId: "55" })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "<#55>", "name", "Gaming", "lounge"]), { type: "generator-set", channelId: "55", patch: { channelName: "Gaming lounge" } })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "55", "category", "none"]), { type: "generator-set", channelId: "55", patch: { categoryId: null } })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "55", "template", "{owner}'s", "room"]), { type: "generator-set", channelId: "55", patch: { template: "{owner}'s room" } })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "55", "limit", "none"]), { type: "generator-set", channelId: "55", patch: { userLimit: null } })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "55", "limit", "8"]), { type: "generator-set", channelId: "55", patch: { userLimit: 8 } })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "55", "region", "auto"]), { type: "generator-set", channelId: "55", patch: { region: null } })
    assert.deepEqual(parseVoiceCommand(["generator", "set", "55", "region", "eu-west"]), { type: "generator-set", channelId: "55", patch: { region: "eu-west" } })
    assert.deepEqual(parseVoiceCommand(["rename", "Study", "room"]), { type: "rename", name: "Study room" })
    assert.deepEqual(parseVoiceCommand(["rename", "<#77>", "Study"]), { type: "rename", roomId: "77", name: "Study" })
    assert.deepEqual(parseVoiceCommand(["hide"]), { type: "hide" })
    assert.deepEqual(parseVoiceCommand(["show", "<#77>"]), { type: "show", roomId: "77" })
    assert.deepEqual(parseVoiceCommand(["allow", "<@88>"]), { type: "allow", userId: "88" })
    assert.deepEqual(parseVoiceCommand(["block", "<#77>", "<@!88>"]), { type: "block", roomId: "77", userId: "88" })
    assert.deepEqual(parseVoiceCommand(["limit", "0"]), { type: "limit", limit: 0 })
    assert.deepEqual(parseVoiceCommand(["limit", "<#77>", "99"]), { type: "limit", roomId: "77", limit: 99 })
})

test("voice values are validated like other text settings, with clear errors", () => {
    for (const args of [["generator", "add", "x".repeat(101)], ["rename", " \u202e "], ["generator", "set", "55", "template", "{user}"], ["generator", "set", "55", "limit", "0"],
        ["generator", "set", "55", "limit", "100"], ["generator", "set", "55", "region", "eu", "west"], ["generator", "set", "55", "region", "-bad"], ["limit", "100"], ["limit", "-1"],
        ["allow"], ["block", "<#77>", "someone"], ["transfer", "<@88>"], ["claim"], ["kick", "<@88>"], ["lock"], ["generator", "set", "55", "unknown", "x"], ["generator", "remove"]]) {
        const parsed = parseVoiceCommand(args)
        assert("error" in parsed, JSON.stringify(args))
    }
    assert.equal(voicePublic(parseVoiceCommand(["rename", "Room"])), true)
    assert.equal(voicePublic(parseVoiceCommand(["generator", "list"])), false)
    assert.equal(voicePublic(parseVoiceCommand(["bogus"])), false)
})
