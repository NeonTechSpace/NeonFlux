import assert from "node:assert/strict"
import { levelForXp, nextLevelXp } from "@neonflux/contracts/leveling"
import test from "node:test"
import {
    parseLevelCommand,
    parseRankCommand,
    parseLeaderboardCommand,
    levelHelp,
    levelHelpAll,
} from "../src/level-command.ts"
import { parseManagement } from "../src/response-command.ts"
import { rankCard } from "../src/level-render.ts"

const user = "123456789012345679"
test("level grammar needs no typed revisions and takes reasons as free text before a final confirm", () => {
    assert.deepEqual(parseLevelCommand(["module", "on"]), { type: "module", enabled: true })
    assert.deepEqual(parseLevelCommand(["rate", "100", "3600"]), { type: "rate", xp: 100, cooldown: 3600 })
    assert.deepEqual(parseLevelCommand(["announce", "off"]), { type: "announce", levelUp: null })
    assert.deepEqual(parseLevelCommand(["announce", "here"]), {
        type: "announce",
        levelUp: { channelId: null, rewardsOnly: false },
    })
    assert.deepEqual(parseLevelCommand(["announce", "here", "rewards"]), {
        type: "announce",
        levelUp: { channelId: null, rewardsOnly: true },
    })
    assert.deepEqual(parseLevelCommand(["announce", "<#123456789012345681>"]), {
        type: "announce",
        levelUp: { channelId: "123456789012345681", rewardsOnly: false },
    })
    assert.deepEqual(parseLevelCommand(["announce", "123456789012345681", "rewards"]), {
        type: "announce",
        levelUp: { channelId: "123456789012345681", rewardsOnly: true },
    })
    assert.match(
        levelHelpAll.join("\n"),
        /^!level announce off\|here\|#channel \[rewards\]: Post when a member reaches a new level, optionally only levels with a reward role$/m,
    )
    assert.deepEqual(parseLevelCommand(["correct", `<@${user}>`, "1234", "Verified", "correction"]), {
        type: "correct",
        userId: user,
        xp: 1234,
        reason: "Verified correction",
    })
    // A quoted reason is still one word
    assert.deepEqual(parseLevelCommand(["correct", user, "0", "Verified correction"]), {
        type: "correct",
        userId: user,
        xp: 0,
        reason: "Verified correction",
    })
    // A negative zero would show as -0 XP
    assert.deepEqual(parseLevelCommand(["correct", user, "-0", "Verified correction"]), {
        type: "correct",
        userId: user,
        xp: 0,
        reason: "Verified correction",
    })
    assert.deepEqual(parseLevelCommand(["reset", "member", user, "Requested", "reset", "confirm"]), {
        type: "reset-member",
        userId: user,
        reason: "Requested reset",
        confirmed: true,
    })
    assert.deepEqual(parseLevelCommand(["reset", "member", user, "Requested", "reset"]), {
        type: "reset-member",
        userId: user,
        reason: "Requested reset",
        confirmed: false,
    })
    assert.deepEqual(parseLevelCommand(["reset", "server", "Requested", "reset"]), {
        type: "reset-server",
        reason: "Requested reset",
        confirmed: false,
    })
    assert.deepEqual(parseLevelCommand(["reset", "server", "Season", "two", "confirm"]), {
        type: "reset-server",
        reason: "Season two",
        confirmed: true,
    })
    assert.deepEqual(parseLevelCommand(["audit"]), { type: "audit", next: false })
    assert.deepEqual(parseLevelCommand(["audit", "next"]), { type: "audit", next: true })
    assert.deepEqual(parseLevelCommand(["config"]), { type: "config" })
    assert.deepEqual(parseLevelCommand(["config", "channels"]), { type: "config", list: "channels", next: false })
    assert.deepEqual(parseLevelCommand(["config", "rewards", "next"]), { type: "config", list: "rewards", next: true })
    assert.deepEqual(parseLevelCommand(["exclude", "channels", "none"]), {
        type: "exclude",
        field: "channels",
        ids: [],
    })
    // Fluxer's limits per server: 500 channels and 250 roles
    const many = (count: number) => Array.from({ length: count }, (_, i) => String(1000 + i))
    assert.deepEqual(parseLevelCommand(["exclude", "channels", ...many(500)]), {
        type: "exclude",
        field: "channels",
        ids: many(500),
    })
    assert.deepEqual(parseLevelCommand(["exclude", "roles", ...many(250)]), {
        type: "exclude",
        field: "roles",
        ids: many(250),
    })
    // Only these channels earn XP, up to Fluxer's 500 channels, and none lets every channel earn again
    assert.deepEqual(parseLevelCommand(["only", "channels", ...many(500)]), { type: "only", ids: many(500) })
    assert.deepEqual(parseLevelCommand(["only", "channels", "none"]), { type: "only", ids: [] })
    assert.deepEqual(parseLevelCommand(["config", "only", "next"]), { type: "config", list: "only", next: true })
    assert.match(levelHelpAll.join("\n"), /^!level only channels <IDs\.\.\.\|none>/m)
    assert.deepEqual(parseLevelCommand(["map", "5", user]), { type: "map", level: 5, roleId: user })
    assert.deepEqual(parseLevelCommand(["unmap", "5"]), { type: "unmap", level: 5 })
    assert.deepEqual(parseLevelCommand(["clear", "confirm"]), { type: "clear", confirmed: true })
    assert.match(levelHelpAll.join("\n"), /^!level reset member /m)
    assert.doesNotMatch([levelHelp(), ...levelHelpAll].join("\n"), /revision|epoch|cursor|"reason"/)
})

test("level grammar rejects malformed bounds, trailing arguments, confirmation and duplicate IDs", () => {
    for (const args of [
        ["rate", "0", "60"],
        ["rate", "101", "60"],
        ["rate", "15", "14"],
        ["rate", "15", "3601"],
        ["rate", "01", "60"],
        ["rate", "15", "60", "1"],
        ["module", "on", "1"],
        ["module", "maybe"],
        ["correct", user, "100000001", "Reason"],
        ["correct", "0", "1", "Reason"],
        ["correct", user, "1"],
        ["map", "1001", user],
        ["map", "1", user, "1"],
        ["clear", "yes"],
        ["reset", "server"],
        ["reset", "server", "confirm"],
        ["reset", "member", user, ""],
        ["reset", "member", user, "confirm"],
        ["correct", user, "1", "a".repeat(501)],
        ["exclude", "roles", user, user],
        ["audit", "0"],
        ["audit", "5"],
        ["audit", "next", "next"],
        ["reconcile", user, "extra"],
        ["config", "next"],
        ["config", "mappings"],
        ["config", "roles", "2"],
        ["config", "roles", "next", "next"],
        ["exclude", "channels", ...Array.from({ length: 501 }, (_, i) => String(1000 + i))],
        ["exclude", "roles", ...Array.from({ length: 251 }, (_, i) => String(1000 + i))],
        ["only", "channels", ...Array.from({ length: 501 }, (_, i) => String(1000 + i))],
        ["only", "channels"],
        ["only", "roles", "none"],
        ["only", "1000"],
        ["only", "channels", "1000", "1000"],
        ["announce"],
        ["announce", "on"],
        ["announce", "off", "rewards"],
        ["announce", "here", "all"],
        ["announce", "here", "rewards", "now"],
        ["announce", `<@${user}>`],
        ["announce", "<@&123456789012345681>", "rewards"],
    ])
        assert("error" in parseLevelCommand(args), args.join(" "))
})

test("rank grammar bounds IDs and the leaderboard pages only with next", () => {
    assert.deepEqual(parseRankCommand([]), {})
    assert.deepEqual(parseRankCommand([user]), { userId: user })
    assert.deepEqual(parseLeaderboardCommand([]), { next: false })
    assert.deepEqual(parseLeaderboardCommand(["next"]), { next: true })
    for (const args of [["arbitrary"], [`150:${user}:2`], ["2"], ["next", "next"]])
        assert("error" in parseLeaderboardCommand(args))
    assert("error" in parseRankCommand(["9999999999999999999999999999"]))
    assert("error" in parseRankCommand([user, user]))
})

test("leveling names are reserved for response definitions and cards have bounded native content", () => {
    for (const name of ["level", "rank", "leaderboard"])
        assert("error" in parseManagement("custom", ["create", name, "text", "Response"]))
    const profile = (xp: number) => ({ userId: user, xp, level: levelForXp(xp), nextLevelXp: nextLevelXp(xp) })
    const normal = rankCard(profile(450), { type: "exact", position: 3, tied: 0 }),
        maximum = rankCard(profile(100000000), { type: "exact", position: 1, tied: 0 })
    assert.equal(normal.description, `<@${user}>`)
    assert.equal(normal.fields![0]![1], "2")
    assert.match(normal.fields![3]![1], /50 of 500 XP/)
    assert.match(maximum.fields![3]![1], /Maximum level/)
    assert.equal(maximum.fields![2]![1], "#1")
    assert.equal(rankCard(profile(0), { type: "unranked" }).fields![2]![1], "Unranked")
    // Equal XP shares a rank, and a server still being counted has none yet
    assert.equal(
        rankCard(profile(50), { type: "exact", position: 26, tied: 996 }).fields![2]![1],
        "#26, tied with 996 others",
    )
    assert.equal(
        rankCard(profile(50), { type: "exact", position: 26, tied: 1 }).fields![2]![1],
        "#26, tied with 1 other",
    )
    assert.equal(rankCard(profile(50), { type: "counting" }).fields![2]![1], "Counting, try again in a minute")
})

test("level arguments accept only their own kind of mention", () => {
    const role = "323456789012345679",
        channel = "223456789012345679"
    assert.deepEqual(parseRankCommand([`<@!${user}>`]), { userId: user })
    for (const other of [`<@&${role}>`, `<#${channel}>`]) assert.ok("error" in parseRankCommand([other]))
    assert.deepEqual(parseLevelCommand(["map", "5", `<@&${role}>`]), { type: "map", level: 5, roleId: role })
    assert.ok("error" in parseLevelCommand(["map", "5", `<@${user}>`]))
    assert.deepEqual(parseLevelCommand(["exclude", "channels", `<#${channel}>`]), {
        type: "exclude",
        field: "channels",
        ids: [channel],
    })
    assert.deepEqual(parseLevelCommand(["exclude", "roles", `<@&${role}>`]), {
        type: "exclude",
        field: "roles",
        ids: [role],
    })
    assert.ok("error" in parseLevelCommand(["exclude", "channels", `<@&${role}>`]))
    assert.deepEqual(parseLevelCommand(["only", "channels", `<#${channel}>`]), { type: "only", ids: [channel] })
    assert.ok("error" in parseLevelCommand(["only", "channels", `<@&${role}>`]))
    assert.ok("error" in parseLevelCommand(["exclude", "roles", `<#${channel}>`]))
    assert.ok("error" in parseLevelCommand(["correct", `<@&${role}>`, "10", "Verified"]))
    assert.ok("error" in parseLevelCommand(["reset", "member", `<#${channel}>`, "Verified"]))
    assert.ok("error" in parseLevelCommand(["reconcile", `<@&${role}>`]))
})
