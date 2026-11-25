import assert from "node:assert/strict"
import test from "node:test"
import { Schema } from "effect"
import { ChannelId, MessageId, RoleId, ServerId, UserId, cutText } from "@neonflux/contracts/common"
import {
    BackupOverwrite,
    backupChannelSemantic,
    backupGain,
    canonicalBackupJson,
    type BackupConfigObject,
} from "@neonflux/contracts/backup"
import { structureChanges, type StructureChannel, type StructureEntry } from "@neonflux/contracts/structure"
import { backupDiff, backupNormalized, backupOrderMoves } from "../convex/backupDomain.ts"
import { memberText } from "../convex/memberContent.ts"
import { deceptiveLink, imitates, protectedDomains } from "../convex/moderationLinks.ts"
import { structureMerge } from "../convex/structureDomain.ts"

// Deterministic seeded PRNG so fuzz tests reproduce identically on every run with zero external dependencies
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
const shuffle = <T>(rng: () => number, items: readonly T[]): T[] => {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index--) {
        const swap = Math.floor(rng() * (index + 1))
        const tmp = copy[index]!
        copy[index] = copy[swap]!
        copy[swap] = tmp
    }
    return copy
}

type SameType<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

test("Branded nominal ID schemas validate Fluxer IDs, stay string-assignable and stay nominally distinct", () => {
    const serverId = Schema.decodeUnknownSync(ServerId)("100000000000000001")
    const channelId = Schema.decodeUnknownSync(ChannelId)("100000000000000002")
    const userId = Schema.decodeUnknownSync(UserId)("100000000000000003")
    const roleId = Schema.decodeUnknownSync(RoleId)("100000000000000004")
    const messageId = Schema.decodeUnknownSync(MessageId)("100000000000000005")
    // Assignable to plain strings for existing callers
    const plain: string[] = [serverId, channelId, userId, roleId, messageId]
    assert.equal(plain.length, 5)
    // Compile-time check that branded IDs remain nominally distinct from each other and from plain strings
    const distinct: [
        SameType<ServerId, ChannelId>,
        SameType<UserId, RoleId>,
        SameType<MessageId, string>,
        SameType<ServerId, ServerId>,
    ] = [false, false, false, true]
    assert.deepEqual(distinct, [false, false, false, true])
    for (const schema of [ServerId, ChannelId, UserId, RoleId, MessageId]) {
        for (const bad of ["", "0", "-1", "0123", "9223372036854775808", "abc", "123 ", 123, null])
            assert.throws(() => Schema.decodeUnknownSync(schema)(bad))
    }
})

test("Hosted fluxer.com links are protected and never flagged as deceptive lookalikes", () => {
    assert.equal(protectedDomains.includes("fluxer.com"), true)
    assert.equal(imitates("fluxer.com", protectedDomains), false)
    assert.equal(deceptiveLink("https://fluxer.com/channels/1/2/3", protectedDomains), false)
    assert.equal(deceptiveLink("https://fluxer-login.example.com", protectedDomains), true)
})

test("Fuzz: cutText preserves UTF-16 surrogate integrity, bounds length and is idempotent", () => {
    const rng = mulberry32(0x5eed0001)
    const atoms = ["a", "Z", "0", " ", "\n", "é", "😀", "🚀", "🔥", "👨‍👩‍👧‍👦", "🇺🇸", "👍🏽", "𝕳", "𠀀", "\u200d", "\ufe0f"]
    for (let trial = 0; trial < 500; trial++) {
        const count = int(rng, 0, 40)
        let text = ""
        for (let index = 0; index < count; index++) text += pick(rng, atoms)
        for (const max of [-5, -1, 0, 1, 2, 3, int(rng, 0, text.length + 5), text.length]) {
            const cut = cutText(text, max)
            const expectedMax = Math.max(0, max)
            assert.ok(cut.length <= expectedMax, `cut length ${cut.length} exceeded ${expectedMax}`)
            assert.ok(text.startsWith(cut), "cutText must return an exact prefix")
            assert.ok(cut.isWellFormed(), "cutText must never leave a lone trailing surrogate")
            assert.equal(cutText(cut, max), cut, "cutText must be idempotent")
            // Cutting a well-formed string at max can shorten by at most 1 code unit (a split high surrogate)
            if (text.isWellFormed()) {
                const target = Math.min(text.length, expectedMax)
                assert.ok(cut.length >= Math.max(0, target - 1))
            }
        }
    }
    // Explicit surrogate-boundary edge cases
    assert.equal(cutText("😀", 1), "")
    assert.equal(cutText("😀", 2), "😀")
    assert.equal(cutText("a😀b", 2), "a")
    assert.equal(cutText("a😀b", 3), "a😀")
    assert.equal(cutText("hello", 0), "")
    assert.equal(cutText("hello", -3), "")
})

test("Fuzz: deceptiveLink, imitates and memberText never throw on malformed Unicode, punycode, bidi or long URLs", () => {
    const rng = mulberry32(0x5eed0002)
    const pieces = [
        "a",
        "z",
        "0",
        "-",
        ".",
        "/",
        ":",
        "@",
        "?",
        "#",
        "%",
        "[",
        "]",
        "(",
        ")",
        "xn--",
        "https://",
        "http://",
        "discord.com",
        "fluxer.app",
        "а",
        "е",
        "о",
        "α",
        "ο",
        "հ",
        "\u202e",
        "\u202d",
        "\u2066",
        "\u2069",
        "\ufeff",
        "\u0000",
        "\u0007",
        "\u007f",
        "\ud800",
        "\udfff",
        "😀",
        "zzzzzzzzzz",
    ]
    // Regression inputs that previously overflowed punycode decoding to NaN and threw RangeError
    const craftedHosts = [
        `xn--${"z".repeat(250)}a.com`,
        `xn--${"9".repeat(300)}.example`,
        "xn---.com",
        "xn--.com",
        "xn--\ud800-\udfff.com",
        `xn--${"a".repeat(2000)}.example.com`,
        "\u202ediscord.com",
        "аbс.fluxer.app",
    ]
    for (const host of craftedHosts) {
        assert.equal(typeof imitates(host, protectedDomains), "boolean")
        assert.equal(typeof deceptiveLink(`https://${host}/path`, protectedDomains), "boolean")
    }
    for (let trial = 0; trial < 400; trial++) {
        const len = int(rng, 1, 60)
        let raw = ""
        for (let index = 0; index < len; index++) raw += pick(rng, pieces)
        const host = raw.slice(0, 300)
        assert.equal(typeof imitates(host, protectedDomains), "boolean")
        const message = `[${raw.slice(0, 120)}](https://${raw.slice(0, 200)}) https://${raw.slice(0, 400)}`
        assert.equal(typeof deceptiveLink(message, protectedDomains), "boolean")
    }
    // Hidden bidi and control characters are always rejected by memberText
    for (const bad of ["\u202eabc", "a\u2066b", "a\u2069b", "a\ufeffb", "a\u0000b", "a\u0007b", "a\u007fb"]) {
        assert.throws(() => memberText(bad, 100, "Bio"))
    }
})

test("Fuzz: backup diff, overwrite normalization, canonical JSON and structure merge hold algebraic invariants", () => {
    const rng = mulberry32(0x5eed0003)
    const keys = ["alpha", "beta", "gamma", "enabled", "expectedBotIds", "tags", "nested"]
    const genValue = (depth: number): unknown => {
        const kind = int(rng, 0, depth > 0 ? 6 : 3)
        if (kind === 0) return null
        if (kind === 1) return rng() < 0.5
        if (kind === 2) return int(rng, -100, 100)
        if (kind === 3) return pick(rng, ["", "short", "value-1", "value-2", "😀"])
        if (kind === 4) return Array.from({ length: int(rng, 0, 4) }, () => String(int(rng, 1, 8)))
        if (kind === 5)
            return Array.from({ length: int(rng, 0, 4) }, (_, idx) => ({
                name: `item-${idx}`,
                enabled: rng() < 0.5,
            }))
        const obj: Record<string, unknown> = {}
        const chosen = shuffle(rng, keys).slice(0, int(rng, 0, 5))
        for (const k of chosen) {
            obj[k] =
                k === "expectedBotIds"
                    ? [...new Set(Array.from({ length: int(rng, 0, 4) }, () => String(int(rng, 10, 19))))]
                    : genValue(depth - 1)
        }
        return obj
    }

    for (let trial = 0; trial < 250; trial++) {
        const a = genValue(2)
        const b = genValue(2)
        // Reflexivity: diffing a value against itself yields zero changes
        assert.deepEqual(backupDiff(a, a), [])
        // Canonical JSON is key-order invariant for plain objects
        if (a && typeof a === "object" && !Array.isArray(a)) {
            const entries = Object.entries(a as Record<string, unknown>)
            const reordered = Object.fromEntries(shuffle(rng, entries))
            assert.equal(canonicalBackupJson(a), canonicalBackupJson(reordered))
            assert.deepEqual(backupDiff(a, reordered), [])
        }
        // Symmetry of non-emptiness: a differs from b iff b differs from a
        assert.equal(backupDiff(a, b).length > 0, backupDiff(b, a).length > 0)
    }

    // Backup normalization and channel overwrite invariants: idempotent and permutation-invariant
    for (let trial = 0; trial < 150; trial++) {
        const idsA = [...new Set(Array.from({ length: int(rng, 0, 8) }, () => String(int(rng, 100, 150))))]
        const idsB = shuffle(rng, idsA)
        const alertsA: Extract<BackupConfigObject, { family: "alerts" }> = {
            family: "alerts",
            sourceId: "alerts",
            value: {
                invites: true,
                bots: false,
                webhooks: true,
                privileges: false,
                impersonation: false,
                kickBots: false,
                deleteWebhooks: false,
                removePermissions: false,
                expectedBotIds: idsA,
                expectedWebhookIds: idsB,
            },
        }
        const alertsB: Extract<BackupConfigObject, { family: "alerts" }> = {
            ...alertsA,
            value: {
                ...alertsA.value,
                expectedBotIds: shuffle(rng, idsA),
                expectedWebhookIds: shuffle(rng, idsB),
            },
        }
        assert.deepEqual(backupNormalized(alertsA), backupNormalized(alertsB))
        assert.deepEqual(backupNormalized(backupNormalized(alertsA)), backupNormalized(alertsA))

        // Channel semantic normalization sorts overwrites by type:id and strips zero-mask/noop differences
        const overwrites = Array.from({ length: int(rng, 0, 6) }, (_, idx) => {
            const allowBits = BigInt(int(rng, 0, 1023))
            const denyBits = BigInt(int(rng, 0, 1023)) & ~allowBits
            return Schema.decodeUnknownSync(BackupOverwrite)({
                id: String(200 + idx),
                type: rng() < 0.5 ? "role" : "member",
                allow: allowBits.toString(),
                deny: denyBits.toString(),
            })
        })
        const channelA = {
            sourceId: "100",
            type: "text" as const,
            name: "general",
            topic: null,
            nsfw: false,
            slowmodeSeconds: 0,
            parentId: null,
            overwrites,
            capturedAt: 1700000000000,
        }
        const channelB = { ...channelA, overwrites: shuffle(rng, overwrites) }
        assert.equal(
            canonicalBackupJson(backupChannelSemantic(channelA)),
            canonicalBackupJson(backupChannelSemantic(channelB)),
        )
        for (const ow of overwrites) {
            assert.equal(backupGain(ow, ow), 0n)
            const other = pick(rng, overwrites)
            assert.ok(backupGain(ow, other) >= 0n)
        }
    }

    // Structure diff, merge and backupOrderMoves invariants
    for (let trial = 0; trial < 150; trial++) {
        const categoryCount = int(rng, 1, 3)
        const base: StructureEntry[] = []
        const categories = Array.from({ length: categoryCount }, (_, idx) => String(1000 + idx))
        for (const catId of categories) {
            base.push({ id: catId, type: "category", name: `cat-${catId}`, parentId: null })
            const childCount = int(rng, 0, 4)
            for (let c = 0; c < childCount; c++) {
                const childId = String(2000 + Number(catId) * 10 + c)
                base.push({ id: childId, type: "text", name: `ch-${childId}`, parentId: catId })
            }
        }
        const current: StructureChannel[] = base.map((entry) => ({ ...entry, manage: true }))
        // Reflexivity: identical base and draft produce zero structure changes and zero merge items
        assert.deepEqual(structureChanges(base, base), [])
        assert.deepEqual(structureMerge(base, base, current), [])
        // Permuting archived positions with identity order produces zero moves
        const identityPositions = new Map(base.map((entry, idx) => [entry.id, idx]))
        assert.deepEqual(backupOrderMoves(base, identityPositions), [])
        // Reordering within each category produces valid moves whose count is bounded by channel count
        const shuffledPositions = new Map(shuffle(rng, base).map((entry, idx) => [entry.id, idx]))
        const moves = backupOrderMoves(base, shuffledPositions)
        assert.ok(moves.length <= base.length)
        // Applying a rename-only draft yields all "apply" on untouched current and all "skip" when current matches draft
        const renamed = base.map((entry) => (rng() < 0.4 ? { ...entry, name: `${entry.name}-new` } : entry))
        const mergeOnBase = structureMerge(base, renamed, current)
        assert.ok(mergeOnBase.every((item) => item.disposition === "apply"))
        const mergeOnDraft = structureMerge(
            base,
            renamed,
            renamed.map((entry) => ({ ...entry, manage: true })),
        )
        assert.ok(mergeOnDraft.every((item) => item.disposition === "skip"))
    }
})
