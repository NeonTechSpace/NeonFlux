import assert from "node:assert/strict"
import test from "node:test"
import { anyOf, closestNames } from "../src/closest-name.ts"
import { commandTable } from "../src/help.ts"

const names: readonly string[] = commandTable.map((entry) => entry.name)
const hint = (word: string) => closestNames({ word, builtIn: names })

test("a swapped or missing letter in a command's name finds that command", () => {
    const check = (typed: string, name: string) => {
        if (!names.includes(typed)) assert.ok(hint(typed).includes(name), typed)
    }
    for (const name of names)
        for (let index = 0; index < name.length; index += 1) {
            check(name.slice(0, index) + name.slice(index + 1), name)
            if (index + 1 === name.length || name[index] === name[index + 1]) continue
            check(name.slice(0, index) + name[index + 1] + name[index] + name.slice(index + 2), name)
        }
})

test("the typos members make find their command, ignoring case", () => {
    for (const [typed, name] of [
        ["pign", "ping"],
        ["Tikcet", "ticket"],
        ["leaderbord", "leaderboard"],
        ["bakcup", "backup"],
        ["mo", "mod"],
        ["ank", "rank"],
        ["events", "event"],
        ["hlep", "help"],
        ["rolepikcer", "rolepicker"],
        ["onbording", "onboarding"],
        ["milestoen", "milestone"],
        ["autorloe", "autorole"],
        ["memberlsit", "memberlist"],
        ["leaderbaord", "leaderboard"],
    ] as const)
        assert.equal(hint(typed)[0], name, typed)
})

test("ordinary words get no hint", () => {
    for (const word of [
        "hello",
        "thank",
        "price",
        "using",
        "being",
        "going",
        "doing",
        "thing",
        "print",
        "become",
        "public",
        "report",
        "customer",
        "author",
        "stock",
        "start",
        "god",
        "king",
        "bank",
        "ask",
        "xyz",
    ])
        assert.deepEqual(hint(word), [], word)
})

test("every close name is listed, closest first and at most five", () => {
    assert.deepEqual(closestNames({ word: "abcs", builtIn: ["abcd", "abce"] }), ["abcd", "abce"])
    assert.deepEqual(closestNames({ word: "log", builtIn: ["lfg", "logs"] }), ["logs"])
    assert.deepEqual(closestNames({ word: "lfgs", builtIn: ["lfg", "logs"] }), ["lfg"])
    assert.deepEqual(closestNames({ word: "riles", builtIn: ["roles"], custom: ["rules"] }), ["roles", "rules"])
    assert.deepEqual(closestNames({ word: "rule", builtIn: ["roles", "rules"] }), ["rules"])
    assert.deepEqual(closestNames({ word: "rule", builtIn: ["roles"] }), [])
    assert.deepEqual(closestNames({ word: "helo", builtIn: ["help", "hello"] }), ["hello", "help"])
    assert.deepEqual(closestNames({ word: "log", builtIn: ["logs", "logs"] }), ["logs"])
    const many = ["abcd", "abce", "abcf", "abcg", "abch", "abci", "abcj"]
    assert.equal(closestNames({ word: "abcdx", builtIn: many }).length, 1)
    assert.equal(closestNames({ word: "abc", builtIn: many }).length, 5)
})

test("names in a sentence read naturally", () => {
    assert.equal(anyOf([]), "")
    assert.equal(anyOf(["!a"]), "!a")
    assert.equal(anyOf(["!a", "!b"]), "!a or !b")
    assert.equal(anyOf(["!a", "!b", "!c"]), "!a, !b or !c")
})

test("a changed letter counts on both QWERTY and QWERTZ keyboards", () => {
    // z and y swap places between the two, so t touches z only on QWERTZ and a touches z only on QWERTY
    assert.deepEqual(closestNames({ word: "zoo", builtIn: ["too"] }), ["too"])
    assert.deepEqual(closestNames({ word: "zoo", builtIn: ["aoo"] }), ["aoo"])
    assert.deepEqual(closestNames({ word: "yoo", builtIn: ["too"] }), ["too"])
    assert.deepEqual(closestNames({ word: "zoo", builtIn: ["poo"] }), [])
})

test("forms of a name count, and look-alike words do not", () => {
    for (const [typed, name] of [
        ["tickets", "ticket"],
        ["role", "roles"],
        ["reply", "replies"],
        ["verification", "verify"],
        ["suggestion", "suggest"],
        ["leveling", "level"],
        ["prefixes", "prefix"],
        ["solve", "solved"],
    ] as const)
        assert.equal(hint(typed)[0], name, typed)
    for (const word of ["station", "stated", "pink", "rolls"]) assert.deepEqual(hint(word), [], word)
    // A doubled last letter is a typo even when a sentence follows, while a form then reads as chat
    assert.equal(closestNames({ word: "statss", builtIn: names, following: 4 })[0], "stats")
})

test("an exact name and a very long word answer nothing", () => {
    assert.deepEqual(closestNames({ word: "ping", builtIn: ["ping"] }), [])
    assert.deepEqual(hint("p".repeat(2000)), [])
    assert.deepEqual(hint(""), [])
})

test("a changed letter must be a nearby key or a similar sound", () => {
    for (const [typed, name] of [
        ["oing", "ping"],
        ["gelp", "help"],
        ["mof", "mod"],
        ["halp", "help"],
        ["kustom", "custom"],
    ] as const)
        assert.equal(hint(typed)[0], name, typed)
    for (const word of ["pink", "held", "rant", "lever", "logo"]) assert.deepEqual(hint(word), [], word)
})

test("a form starting a sentence and another form of a custom command get no hint", () => {
    assert.deepEqual(closestNames({ word: "tickets", builtIn: names, following: 1 }), ["ticket"])
    assert.deepEqual(closestNames({ word: "tickets", builtIn: names, following: 3 }), [])
    assert.deepEqual(closestNames({ word: "tikcet", builtIn: names, following: 5 }), ["ticket"])
    assert.deepEqual(closestNames({ word: "pizza", builtIn: [], custom: ["pizzas"] }), [])
    assert.deepEqual(closestNames({ word: "pizzsa", builtIn: [], custom: ["pizzas"] }), ["pizzas"])
    assert.deepEqual(closestNames({ word: "rule", builtIn: ["roles"], custom: ["rules"] }), [])
})
