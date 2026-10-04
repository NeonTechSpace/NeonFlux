import assert from "node:assert/strict"
import test from "node:test"
import { ACCENT, ago, clip, code, duration, notSetUp, onOff, renderEmbeds, type Card } from "../src/reply-style.ts"

const embedsOf = (card: Card) =>
    renderEmbeds(card).map((body) => {
        assert.ok("embeds" in body)
        return body.embeds[0]
    })

test("times render as Fluxer timestamp markup, mentions pass through and small helpers read as words", () => {
    assert.equal(ago(1_700_000_000_999), "<t:1700000000:R>")
    assert.deepEqual(
        [duration(600), duration(3600), duration(86400), duration(1_209_600), duration(90), duration(1)],
        ["10 minutes", "1 hour", "1 day", "2 weeks", "90 seconds", "1 second"],
    )
    assert.deepEqual([onOff(true), onOff(false), code("!custom list next")], ["On", "Off", "`!custom list next`"])
    assert.equal(
        notSetUp("Custom commands"),
        "Custom commands isn't available on this NeonFlux yet. The bot operator needs to finish setting it up",
    )
})

test("embeds show the title, description, labelled fields and footer", () => {
    const card: Card = {
        title: "Custom command hello",
        description: "Synthetic text",
        fields: [
            ["Author", "<@1514700735009259520>"],
            ["Changed", "<t:1700000000:R>"],
        ],
        footer: "Synthetic footer",
    }
    assert.deepEqual(embedsOf(card), [
        {
            color: ACCENT,
            title: "Custom command hello",
            description: "Synthetic text",
            fields: [
                { name: "Author", value: "<@1514700735009259520>" },
                { name: "Changed", value: "<t:1700000000:R>" },
            ],
            footer: { text: "Synthetic footer" },
        },
    ])
    assert.deepEqual(embedsOf({ title: "Empty" }), [{ color: ACCENT, title: "Empty" }])
})

test("a field value over 1024 characters continues in further fields", () => {
    const value = `${"a".repeat(1500)} END`,
        card: Card = { title: "Custom command hello", fields: [["Answer", value]] }
    const fields = embedsOf(card).flatMap((embed) => embed.fields ?? [])
    assert.deepEqual(
        fields.map((field) => field.name),
        ["Answer", "Answer (continued)"],
    )
    assert.ok(fields.every((field) => field.value.length <= 1024))
    assert.equal(fields.map((field) => field.value).join(""), value)
})

test("a note with commands, mentions or times closes the description and never reaches the footer", () => {
    const note = "Reply with `!custom show hello` by <t:1700000000:f>, or ask <@1514700735009259520>"
    const card: Card = {
        title: "Autoresponder hello",
        description: "Answer 1",
        fields: [["Next", "`!auto list next`"]],
        note,
        footer: "Plain footer",
    }
    assert.deepEqual(embedsOf(card), [
        {
            color: ACCENT,
            title: "Autoresponder hello",
            description: `Answer 1\n${note}`,
            fields: [{ name: "Next", value: "`!auto list next`" }],
            footer: { text: "Plain footer" },
        },
    ])
    // Without a description the note is the whole description
    assert.deepEqual(embedsOf({ title: "Commands", fields: [["general", "!prefix"]], note }), [
        { color: ACCENT, title: "Commands", description: note, fields: [{ name: "general", value: "!prefix" }] },
    ])
})

test("over-long titles, labels and footers are cut, and pairs of UTF-16 units stay whole", () => {
    const card: Card = {
        title: "T".repeat(300),
        fields: [["L".repeat(300), "V".repeat(2000)]],
        footer: "F".repeat(1500),
    }
    const [embed] = embedsOf(card)
    assert.equal(embed!.title, `${"T".repeat(255)}…`)
    assert.equal(embed!.fields![0]!.name.length, 256)
    assert.equal(embed!.fields![0]!.value, "V".repeat(1024))
    assert.equal(embed!.footer!.text.length, 1024)
    assert.equal(embedsOf({ title: `${"x".repeat(254)}😀😀` })[0]!.title, `${"x".repeat(254)}…`)
})

test("many fields continue in further embeds within 25 fields and the total length, with the title first and the footer last", () => {
    const fields = Array.from(
        { length: 60 },
        (_, index) => [`Field ${index}`, "v".repeat(index < 30 ? 10 : 900)] as const,
    )
    const embeds = embedsOf({ title: "Many", fields, footer: "End" })
    assert.deepEqual(
        embeds.flatMap((embed) => embed.fields!.map((field) => field.name)),
        fields.map(([name]) => name),
    )
    for (const [index, embed] of embeds.entries()) {
        assert.ok(embed.fields!.length <= 25)
        assert.ok(
            (embed.title?.length ?? 0) +
                (embed.description?.length ?? 0) +
                embed.fields!.reduce((sum, f) => sum + f.name.length + f.value.length, 0) +
                (embed.footer?.text.length ?? 0) <=
                6000,
        )
        assert.equal(embed.title, index === 0 ? "Many" : undefined)
        assert.equal(embed.footer?.text, index === embeds.length - 1 ? "End" : undefined)
    }
    assert.ok(embeds.length >= 3)
})

test("a long description splits at line breaks across embeds", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `Line ${index} ${"w".repeat(30)}`),
        description = lines.join("\n")
    const embeds = embedsOf({ title: "Long", description, fields: [["After", "value"]] })
    assert.ok(embeds.length >= 4)
    assert.equal(embeds.map((embed) => embed.description).join(""), description)
    for (const embed of embeds) assert.ok(embed.description!.length <= 4096)
    assert.deepEqual(embeds.at(-1)!.fields, [{ name: "After", value: "value" }])
})

test("clipped text ends with an ellipsis, never splits an emoji and replaces a lone surrogate", () => {
    assert.equal(clip("short", 10), "short")
    assert.equal(clip("abcdef", 4), "abc…")
    assert.equal(clip("ab😀cd", 4), "ab…")
    assert.equal(clip("ab🇩🇪cd", 5), "ab…")
    assert.equal(clip("ab😀", 4), "ab😀")
    assert.equal(clip("a\ud800b", 5), "a\ufffdb")
})
