import assert from "node:assert/strict"
import test from "node:test"
import { Schema } from "effect"
import { BackupOverwrite, backupGain, backupSettingName } from "@neonflux/contracts/backup"
import { backupDiff, backupSwitchPath } from "../convex/backupDomain.ts"

const permissions = (allow: string, deny: string) => ({ allow, deny })
const none = permissions("0", "0")

test("The permissions an overwrite change gives are the bits it newly allows and the denies it lifts", () => {
    for (const [name, before, after, gained] of [
        ["an allow that is added", none, permissions("8192", "0"), "8192"],
        ["a deny that is lifted", permissions("0", "1024"), none, "1024"],
        ["a deny that becomes an allow", permissions("0", "1024"), permissions("1024", "0"), "1024"],
        ["an overwrite that stays", permissions("8192", "1024"), permissions("8192", "1024"), "0"],
        ["a deny that is added", none, permissions("0", "1024"), "0"],
        ["an allow that is taken away", permissions("8192", "0"), none, "0"],
        ["an overwrite that is created", none, permissions("8192", "1024"), "8192"],
        ["a bit above 63", none, permissions("9223372036854775808", "0"), "9223372036854775808"],
        ["one bit that stays allowed and one added", permissions("2", "0"), permissions("6", "0"), "4"],
    ] as const)
        assert.equal(backupGain(before, after).toString(), gained, name)
})

test("A setting's key reads as words, a parent as a category and ID and XP keep their capitals", () => {
    for (const [key, words] of [
        ["cooldownSeconds", "cooldown seconds"],
        ["xpPerMessage", "XP per message"],
        ["parentId", "category"],
        ["channelId", "channel ID"],
        ["roleIds", "role IDs"],
        ["slowmodeSeconds", "slowmode seconds"],
        ["topic", "topic"],
        ["reply.text", "reply.text"],
        ["tags[0].emojiName", "tags[0].emoji name"],
    ] as const)
        assert.equal(backupSettingName(key), words, key)
})

test("An overwrite is kept with any 64-bit permissions, and only an overlap or an oversize mask is refused", () => {
    const decode = (allow: string, deny: string) =>
        Schema.decodeUnknownSync(BackupOverwrite)({ id: "1", type: "role", allow, deny })
    // Administrator and Manage messages were refused before, and a permission nobody names was lost
    for (const [allow, deny] of [
        ["8", "0"],
        ["8192", "0"],
        ["0", (1n << 19n).toString()],
        ["18446744073709551615", "0"],
        ["0", "18446744073709551615"],
    ] as const)
        assert.deepEqual(decode(allow, deny), { id: "1", type: "role", allow, deny })
    for (const [allow, deny] of [
        ["8", "8"],
        ["3", "6"],
        ["18446744073709551616", "0"],
        ["-1", "0"],
        ["0", "8.5"],
    ] as const)
        assert.throws(() => decode(allow, deny), allow + "/" + deny)
})

test("A diff lists the leaves that differ by path, with the whole value on each side", () => {
    assert.deepEqual(backupDiff({ a: { b: 1, c: 2 }, same: "x" }, { a: { b: 1, c: 3 }, same: "x", d: true }), [
        { path: "a.c", before: 2, after: 3 },
        { path: "d", after: true },
    ])
    // Arrays go by index, and a list of entries with distinct names goes by name, so a reorder alone is no change
    assert.deepEqual(backupDiff({ ids: ["1", "2"] }, { ids: ["1", "3"] }), [
        { path: "ids[1]", before: "2", after: "3" },
    ])
    const tag = (name: string, moderated: boolean) => ({ name, moderated })
    assert.deepEqual(
        backupDiff({ tags: [tag("a", false), tag("b", false)] }, { tags: [tag("b", true), tag("a", false)] }),
        [{ path: "tags[b].moderated", before: false, after: true }],
    )
    assert.deepEqual(
        backupDiff({ tags: [tag("a", false), tag("a", true)] }, { tags: [tag("a", false), tag("a", false)] }),
        [{ path: "tags[1].moderated", before: true, after: false }],
    )
    // An empty list or object is a leaf of its own, and a property left undefined is no property
    assert.deepEqual(backupDiff({ a: [], b: {}, c: undefined }, { a: [1], b: {} }), [
        { path: "a", before: [] },
        { path: "a[0]", after: 1 },
    ])
    // Without a before, every leaf is new. Without an after, every leaf is gone
    assert.deepEqual(backupDiff(undefined, { x: { y: 1 }, z: null }), [
        { path: "x.y", after: 1 },
        { path: "z", after: null },
    ])
    assert.deepEqual(backupDiff({ x: 1 }, undefined), [{ path: "x", before: 1 }])
    assert.deepEqual(backupDiff({ a: 1 }, { a: 1 }), [])
    // The longest authored values, such as a 4,096 character topic, come back complete
    const topic = "t".repeat(4096)
    const [row] = backupDiff({ topic }, { topic: "u".repeat(4096) })
    assert.deepEqual([row!.before, (row!.after as string).length], [topic, 4096])
})

test("A path ends in a switch when its last key is enabled or ends in Enabled", () => {
    for (const path of ["enabled", "customEnabled", "automodEnabled", "routes[2].enabled", "routes.welcome.enabled"])
        assert.equal(backupSwitchPath(path), true, path)
    for (const path of [
        "enabledAt",
        "humansOnly",
        "routes[2].channelId",
        "disabled",
        "xpEnabledCount",
        "tags[enabled].name",
    ])
        assert.equal(backupSwitchPath(path), false, path)
})
