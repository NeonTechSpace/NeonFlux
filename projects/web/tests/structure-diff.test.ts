import assert from "node:assert/strict"
import { test } from "node:test"
import type { StructureEntry } from "@neonflux/contracts/structure"
import { changeText, diffRows } from "../src/structure-diff.ts"

// Chat holds general and lounge, Info holds rules, and welcome sits at the top level
const base: StructureEntry[] = [
    { id: "200", type: "category", name: "Chat", parentId: null },
    { id: "201", type: "text", name: "general", parentId: "200" },
    { id: "202", type: "voice", name: "lounge", parentId: "200" },
    { id: "100", type: "category", name: "Info", parentId: null },
    { id: "101", type: "text", name: "rules", parentId: "100" },
    { id: "300", type: "text", name: "welcome", parentId: null },
]
const at = (id: string) => base.find((entry) => entry.id === id)!

test("A draft marks only the entries it renames or moves, in the draft's order", () => {
    const rename = base.map((entry) => (entry.id === "201" ? { ...entry, name: "chat" } : entry))
    const across = [at("200"), at("201"), at("100"), at("101"), { ...at("202"), parentId: "100" }, at("300")]
    const reorder = [at("200"), at("202"), at("201"), at("100"), at("101"), at("300")]
    const both = [
        at("200"),
        at("201"),
        at("100"),
        at("101"),
        { ...at("202"), parentId: "100", name: "talk" },
        at("300"),
    ]
    const top = [at("100"), at("101"), at("200"), at("201"), at("202"), at("300")]
    assert.deepEqual(diffRows(base, rename), [{ id: "201", marks: ["was general"] }])
    assert.deepEqual(diffRows(base, across), [
        { id: "202", marks: ["moved from Chat, after general to Info, after rules"] },
    ])
    assert.deepEqual(diffRows(base, reorder), [{ id: "201", marks: ["moved from Chat, first to Chat, after lounge"] }])
    assert.deepEqual(diffRows(base, both), [
        { id: "202", marks: ["was lounge", "moved from Chat, after general to Info, after rules"] },
    ])
    assert.deepEqual(diffRows(base, top), [
        { id: "200", marks: ["moved from the top level, first to the top level, after Info"] },
    ])
    assert.deepEqual(diffRows(base, base), [])
})

test("A change reads as a sentence in the last save", () => {
    assert.equal(
        changeText({ type: "rename", channelId: "201", from: "general", to: "chat" }),
        "Rename general to chat",
    )
    assert.equal(
        changeText({
            type: "move",
            channelId: "202",
            name: "lounge",
            from: { parentId: "200", parentName: "Chat", afterId: "201", afterName: "general" },
            to: { parentId: null, parentName: null, afterId: null, afterName: null },
        }),
        "Move lounge from Chat, after general to the top level, first",
    )
})
