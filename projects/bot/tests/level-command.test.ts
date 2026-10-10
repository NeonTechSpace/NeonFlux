import assert from "node:assert/strict"
import test from "node:test"
import { parseLevelCommand, parseRankCommand, parseLeaderboardCommand, levelHelp, levelHelpAll } from "../src/level-command.ts"
import { parseManagement } from "../src/response-command.ts"
import { rankCard } from "../src/level-render.ts"

const user = "123456789012345679"
test("level grammar needs no typed revisions and takes reasons as free text before a final confirm", () => {
    assert.deepEqual(parseLevelCommand(["module", "on"]), { type: "module", enabled: true })
    assert.deepEqual(parseLevelCommand(["rate", "100", "3600"]), { type: "rate", xp: 100, cooldown: 3600 })
    assert.deepEqual(parseLevelCommand(["correct", `<@${user}>`, "1234", "Verified", "correction"]), { type: "correct", userId: user, xp: 1234, reason: "Verified correction" })
    // A quoted reason is still one word
    assert.deepEqual(parseLevelCommand(["correct", user, "0", "Verified correction"]), { type: "correct", userId: user, xp: 0, reason: "Verified correction" })
    assert.deepEqual(parseLevelCommand(["reset", "member", user, "Requested", "reset", "confirm"]), { type: "reset-member", userId: user, reason: "Requested reset", confirmed: true })
    assert.deepEqual(parseLevelCommand(["reset", "member", user, "Requested", "reset"]), { type: "reset-member", userId: user, reason: "Requested reset", confirmed: false })
    assert.deepEqual(parseLevelCommand(["reset", "server", "Requested", "reset"]), { type: "reset-server", reason: "Requested reset", confirmed: false })
    assert.deepEqual(parseLevelCommand(["reset", "server", "Season", "two", "confirm"]), { type: "reset-server", reason: "Season two", confirmed: true })
    assert.deepEqual(parseLevelCommand(["audit"]), { type: "audit", next: false })
    assert.deepEqual(parseLevelCommand(["audit", "next"]), { type: "audit", next: true })
    assert.deepEqual(parseLevelCommand(["config"]), { type: "config" })
    assert.deepEqual(parseLevelCommand(["config", "channels"]), { type: "config", list: "channels", next: false })
    assert.deepEqual(parseLevelCommand(["config", "rewards", "next"]), { type: "config", list: "rewards", next: true })
    assert.deepEqual(parseLevelCommand(["exclude", "channels", "none"]), { type: "exclude", field: "channels", ids: [] })
    assert.deepEqual(parseLevelCommand(["map", "5", user]), { type: "map", level: 5, roleId: user })
    assert.deepEqual(parseLevelCommand(["unmap", "5"]), { type: "unmap", level: 5 })
    assert.deepEqual(parseLevelCommand(["clear", "confirm"]), { type: "clear", confirmed: true })
    assert.match(levelHelpAll.join("\n"), /^!level reset member /m)
    assert.doesNotMatch([levelHelp(), ...levelHelpAll].join("\n"), /revision|epoch|cursor|"reason"/)
})

test("level grammar rejects malformed bounds, trailing arguments, confirmation and duplicate IDs", () => {
    for (const args of [
        ["rate", "0", "60"], ["rate", "101", "60"], ["rate", "15", "14"], ["rate", "15", "3601"],
        ["rate", "01", "60"], ["rate", "15", "60", "1"], ["module", "on", "1"], ["module", "maybe"],
        ["correct", user, "100000001", "Reason"], ["correct", "0", "1", "Reason"], ["correct", user, "1"],
        ["map", "1001", user], ["map", "1", user, "1"], ["clear", "yes"], ["reset", "server"], ["reset", "server", "confirm"],
        ["reset", "member", user, ""], ["reset", "member", user, "confirm"], ["correct", user, "1", "a".repeat(501)],
        ["exclude", "roles", user, user], ["audit", "0"], ["audit", "5"], ["audit", "next", "next"], ["reconcile", user, "extra"],
        ["config", "next"], ["config", "mappings"], ["config", "roles", "2"], ["config", "roles", "next", "next"],
        ["exclude", "channels", ...Array.from({ length: 51 }, (_, i) => String(1000 + i))],
    ]) assert("error" in parseLevelCommand(args), args.join(" "))
})

test("rank grammar bounds IDs and the leaderboard pages only with next", () => {
    assert.deepEqual(parseRankCommand([]), {})
    assert.deepEqual(parseRankCommand([user]), { userId: user })
    assert.deepEqual(parseLeaderboardCommand([]), { next: false })
    assert.deepEqual(parseLeaderboardCommand(["next"]), { next: true })
    for (const args of [["arbitrary"], [`150:${user}:2`], ["2"], ["next", "next"]]) assert("error" in parseLeaderboardCommand(args))
    assert("error" in parseRankCommand(["9999999999999999999999999999"]))
    assert("error" in parseRankCommand([user, user]))
})

test("leveling names are reserved for response definitions and cards have bounded native content", () => {
    for (const name of ["level", "rank", "leaderboard"]) assert("error" in parseManagement("custom", ["create", name, "text", "Response"]))
    const normal = rankCard(user, 450, 3), maximum = rankCard(user, 100000000, "outside-top-1000")
    assert.equal(normal.description, `<@${user}>`)
    assert.equal(normal.fields![0]![1], "2")
    assert.match(normal.fields![3]![1], /50 of 500 XP/)
    assert.match(maximum.fields![3]![1], /Maximum level/)
    assert.equal(maximum.fields![2]![1], "Outside the top 1000")
    assert.equal(rankCard(user, 0, "unranked").fields![2]![1], "Unranked")
    assert.equal(rankCard(user, 50, { from: 3102, to: 3400 }).fields![2]![1], "#3102 to #3400")
})
