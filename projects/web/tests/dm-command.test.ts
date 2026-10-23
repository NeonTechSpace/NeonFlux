import assert from "node:assert/strict"
import { test } from "node:test"
import { dmCommand } from "../src/dm-command.ts"

test("A DM command names its server right after the command name only when the bot serves several", () => {
    assert.equal(dmCommand("!backup preview", "123", false), "!backup preview")
    assert.equal(dmCommand("!backup preview", "123", true), "!backup --server 123 preview")
    assert.equal(
        dmCommand("!backup export config xp structure", "123", true),
        "!backup --server 123 export config xp structure",
    )
    assert.equal(dmCommand("!export", "123", true), "!export --server 123")
    assert.equal(dmCommand("!export", "123", false), "!export")
})
