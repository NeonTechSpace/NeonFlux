import assert from "node:assert/strict"
import test from "node:test"
import { cutText } from "@neonflux/contracts/common"
import { nameSkeleton, namesLookAlike } from "../src/alerts-names.ts"

function mulberry32(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const int = (rng: () => number, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!

test("Fuzz: lookalike name detector never throws on malformed Unicode and preserves symmetry, reflexivity and idempotence", () => {
    const rng = mulberry32(0x5eedb071)
    const pieces = [
        "a",
        "m",
        "w",
        "rn",
        "vv",
        "0",
        "1",
        "!",
        "|",
        "$",
        "@",
        " ",
        "_",
        "-",
        "а",
        "е",
        "о",
        "р",
        "с",
        "α",
        "β",
        "ε",
        "ᴀ",
        "ᴍ",
        "é",
        "\u0301",
        "\u0308",
        "\u202e",
        "\u2066",
        "\ufeff",
        "\u0000",
        "\u0007",
        "\ud800",
        "\udfff",
        "😀",
        "Admin",
        "Mod",
    ]
    for (let trial = 0; trial < 400; trial++) {
        const makeName = () => {
            const len = int(rng, 0, 24)
            let out = ""
            for (let index = 0; index < len; index++) out += pick(rng, pieces)
            return out
        }
        const left = makeName()
        const right = makeName()
        const skelLeft = nameSkeleton(left)
        const skelRight = nameSkeleton(right)
        assert.equal(typeof skelLeft, "string")
        assert.equal(nameSkeleton(skelLeft), skelLeft, "nameSkeleton must be idempotent")
        assert.equal(namesLookAlike(left, right), namesLookAlike(right, left), "namesLookAlike must be symmetric")
        assert.equal(
            namesLookAlike(left, left),
            skelLeft.length >= 3,
            "namesLookAlike must be reflexive iff skeleton length >= 3",
        )
        assert.equal(namesLookAlike(right, right), skelRight.length >= 3)
    }
})

test("Fuzz: cutText in bot context never splits UTF-16 surrogates across emoji boundaries", () => {
    const rng = mulberry32(0x5eedb072)
    const atoms = ["x", " ", "😀", "🛡️", "👨‍💻", "🇬🇧", "𐐷", "é"]
    for (let trial = 0; trial < 300; trial++) {
        const count = int(rng, 0, 30)
        let value = ""
        for (let index = 0; index < count; index++) value += pick(rng, atoms)
        const limit = int(rng, -2, value.length + 3)
        const cut = cutText(value, limit)
        assert.ok(cut.length <= Math.max(0, limit))
        assert.ok(cut.isWellFormed())
        assert.ok(value.startsWith(cut))
    }
})
