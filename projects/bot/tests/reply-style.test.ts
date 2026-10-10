import assert from "node:assert/strict"
import test from "node:test"
import { ACCENT, ago, at, code, duration, notSetUp, onOff, renderEmbeds, renderText, type Card } from "../src/reply-style.ts"

const embedsOf = (card: Card) => renderEmbeds(card).map(body => { assert.ok("embeds" in body); return body.embeds[0] })
const textOf = (card: Card) => renderText(card).map(body => { assert.ok("content" in body); return body.content })

test("times render as Fluxer timestamp markup, mentions pass through and small helpers read as words", () => {
    assert.equal(ago(1_700_000_000_999), "<t:1700000000:R>")
    assert.equal(at(1_700_000_000_000), "<t:1700000000:f>")
    assert.deepEqual([duration(600), duration(3600), duration(86400), duration(1_209_600), duration(90), duration(1)], ["10 minutes", "1 hour", "1 day", "2 weeks", "90 seconds", "1 second"])
    assert.deepEqual([onOff(true), onOff(false), code("!suggest list next")], ["On", "Off", "`!suggest list next`"])
    assert.equal(notSetUp("Tickets"), "Tickets isn't available on this NeonFlux yet. The bot operator needs to finish setting it up")
})

test("both renderers show the same title, description, labelled fields and footer", () => {
    const card: Card = { title: "Suggestion #1", description: "Synthetic text", fields: [["Author", "<@1514700735009259520>"], ["Changed", "<t:1700000000:R>"]], footer: "Synthetic footer" }
    assert.deepEqual(embedsOf(card), [{ color: ACCENT, title: "Suggestion #1", description: "Synthetic text",
        fields: [{ name: "Author", value: "<@1514700735009259520>" }, { name: "Changed", value: "<t:1700000000:R>" }], footer: { text: "Synthetic footer" } }])
    assert.deepEqual(textOf(card), ["**Suggestion #1**\nSynthetic text\n**Author:** <@1514700735009259520>\n**Changed:** <t:1700000000:R>\nSynthetic footer"])
    assert.ok(!textOf(card)[0]!.includes("```"))
    assert.deepEqual(embedsOf({ title: "Empty" }), [{ color: ACCENT, title: "Empty" }])
})

test("a note with commands, mentions or times closes the description in both styles and never reaches the footer", () => {
    const note = "Reply with `!event rsvp study <date> going` by <t:1700000000:f>, or ask <@1514700735009259520>"
    const card: Card = { title: "Event study dates", description: "Date 1", fields: [["Next", "`!event dates study next`"]], note, footer: "Plain footer" }
    assert.deepEqual(embedsOf(card), [{ color: ACCENT, title: "Event study dates", description: `Date 1\n${note}`, fields: [{ name: "Next", value: "`!event dates study next`" }], footer: { text: "Plain footer" } }])
    assert.deepEqual(textOf(card), [`**Event study dates**\nDate 1\n${note}\n**Next:** \`!event dates study next\`\nPlain footer`])
    // Without a description the note is the whole description
    assert.deepEqual(embedsOf({ title: "Commands", fields: [["general", "!prefix"]], note }), [{ color: ACCENT, title: "Commands", description: note, fields: [{ name: "general", value: "!prefix" }] }])
    assert.deepEqual(textOf({ title: "Commands", note }), [`**Commands**\n${note}`])
})

test("over-long parts are cut the same way in both styles, and pairs of UTF-16 units stay whole", () => {
    const card: Card = { title: "T".repeat(300), fields: [["L".repeat(300), "V".repeat(2000)]], footer: "F".repeat(1500) }
    const [embed] = embedsOf(card)
    assert.equal(embed!.title, `${"T".repeat(255)}…`); assert.equal(embed!.fields![0]!.name.length, 256); assert.equal(embed!.fields![0]!.value, `${"V".repeat(1023)}…`)
    assert.equal(embed!.footer!.text.length, 1024)
    assert.ok(textOf(card).join("").includes(`**${"L".repeat(255)}…:** ${"V".repeat(1023)}…`))
    assert.equal(embedsOf({ title: `${"x".repeat(254)}😀😀` })[0]!.title, `${"x".repeat(254)}…`)
})

test("many fields continue in further embeds within 25 fields and the total length, with the title first and the footer last", () => {
    const fields = Array.from({ length: 60 }, (_, index) => [`Field ${index}`, "v".repeat(index < 30 ? 10 : 900)] as const)
    const embeds = embedsOf({ title: "Many", fields, footer: "End" })
    assert.deepEqual(embeds.flatMap(embed => embed.fields!.map(field => field.name)), fields.map(([name]) => name))
    for (const [index, embed] of embeds.entries()) {
        assert.ok(embed.fields!.length <= 25)
        assert.ok((embed.title?.length ?? 0) + (embed.description?.length ?? 0) + embed.fields!.reduce((sum, f) => sum + f.name.length + f.value.length, 0) + (embed.footer?.text.length ?? 0) <= 6000)
        assert.equal(embed.title, index === 0 ? "Many" : undefined); assert.equal(embed.footer?.text, index === embeds.length - 1 ? "End" : undefined)
    }
    assert.ok(embeds.length >= 3)
})

test("a long description splits at line breaks across embeds and long text splits into messages of at most 1900 characters", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `Line ${index} ${"w".repeat(30)}`), description = lines.join("\n")
    const embeds = embedsOf({ title: "Long", description, fields: [["After", "value"]] })
    assert.ok(embeds.length >= 4)
    assert.equal(embeds.map(embed => embed.description).join(""), description)
    for (const embed of embeds) assert.ok(embed.description!.length <= 4096)
    assert.deepEqual(embeds.at(-1)!.fields, [{ name: "After", value: "value" }])
    const messages = textOf({ title: "Long", description, fields: [["After", "value"]] })
    assert.ok(messages.length >= 8)
    for (const message of messages) assert.ok(message.length <= 1900)
    assert.equal(messages.join(""), `**Long**\n${description}\n**After:** value`)
})
