import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "@neontechspace/fluxerly/effect"
import { createMessageRevisions } from "../src/message-revisions.ts"

const message = (id: string, overrides: { readonly [K in keyof Message]?: Message[K] | undefined } = {}) =>
    ({
        id,
        channelId: "2",
        content: "Release notes https://example.invalid",
        embeds: [],
        attachments: [],
        stickers: [],
        author: { id: "3", username: "Synthetic author", isBot: false },
        editedAt: null,
        pinned: false,
        flags: 0,
        ...overrides,
    }) as Message

test("an update that repeats the edit time, pin status and flags is skipped and any change of them is not", () => {
    const revisions = createMessageRevisions()
    revisions.created(message("10"))
    assert.equal(
        revisions.changed(
            message("10", {
                embeds: [{ type: "link", url: "https://example.invalid" }] as unknown as Message["embeds"],
            }),
        ).needed,
        false,
    )
    assert.equal(
        revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited" })).needed,
        true,
    )
    // A preview generated for the edited text repeats the edit time
    assert.equal(
        revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited" })).needed,
        false,
    )
    assert.equal(
        revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited", pinned: true }))
            .needed,
        true,
    )
    assert.equal(
        revisions.changed(
            message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited", pinned: true, flags: 4 }),
        ).needed,
        true,
    )
})

test("unknown values and messages outside the memory are always processed", () => {
    const revisions = createMessageRevisions(2)
    assert.equal(revisions.changed(message("20")).needed, true)
    revisions.created(message("21", { pinned: undefined }))
    assert.equal(revisions.changed(message("21", { pinned: undefined })).needed, true)
    assert.equal(revisions.changed(message("21", { pinned: undefined })).needed, true)
    revisions.created(message("22"))
    revisions.created(message("23"))
    revisions.created(message("24"))
    assert.equal(revisions.changed(message("22")).needed, true)
    assert.equal(revisions.changed(message("24")).needed, false)
})

const guild = (id: string, overrides: { readonly [K in keyof Message]?: Message[K] | undefined } = {}) =>
    message(id, { guildId: "1", ...overrides })

test("an edit returns the earlier text, author and attachments while the server's messages reach a log channel", () => {
    const revisions = createMessageRevisions()
    revisions.keepText("1", true)
    revisions.created(
        guild("30", {
            attachments: [
                { id: "5", filename: "cat.png", size: 2048, url: "https://cdn.example.invalid/cat.png", flags: 0 },
            ] as unknown as Message["attachments"],
        }),
    )
    const edit = revisions.changed(guild("30", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited" }))
    assert.equal(edit.needed, true)
    assert.equal(edit.previous?.text, "Release notes https://example.invalid")
    assert.equal(edit.previous?.authorId, "3")
    assert.equal(edit.previous?.authorBot, false)
    assert.deepEqual(edit.previous?.attachments, [
        { name: "cat.png", size: 2048, url: "https://cdn.example.invalid/cat.png" },
    ])
    // The next edit compares with the edited text, and a deletion returns and forgets it
    assert.equal(
        revisions.changed(guild("30", { editedAt: "2026-01-01T00:02:00.000Z", content: "Again" })).previous?.text,
        "Edited",
    )
    assert.equal(revisions.deleted("30")?.text, "Again")
    assert.equal(revisions.deleted("30"), undefined)
    // A message the memory never saw has no earlier copy
    assert.equal(revisions.changed(guild("31", { content: "x" })).previous, undefined)
    // Text is kept up to 4,000 characters, Fluxer's longest message
    revisions.created(guild("32", { content: "y".repeat(4500) }))
    assert.equal(revisions.deleted("32")?.text?.length, 4000)
})

test("DMs and servers whose message events reach no log channel keep no text, and stopping forgets it", () => {
    const revisions = createMessageRevisions()
    revisions.created(guild("40"))
    assert.equal(revisions.deleted("40")?.text, undefined)
    revisions.keepText("1", true)
    revisions.created(message("41"))
    assert.equal(revisions.deleted("41")?.text, undefined)
    revisions.created(guild("42"))
    revisions.created(guild("43", { guildId: "2" }))
    revisions.keepText("1", false)
    const forgotten = revisions.changed(guild("42", { editedAt: "2026-01-01T00:01:00.000Z" }))
    assert.equal(forgotten.previous, undefined)
    assert.equal(forgotten.needed, true)
    // Forgetting a server leaves the others
    revisions.keepText("2", true)
    revisions.created(guild("44", { guildId: "2" }))
    revisions.forgetServer("1")
    assert.equal(revisions.deleted("44")?.text, "Release notes https://example.invalid")
})

test("the oldest messages are dropped past 10,000 messages or the text size limit", () => {
    const bounded = createMessageRevisions(3)
    bounded.keepText("1", true)
    for (const id of ["50", "51", "52", "53"]) bounded.created(guild(id))
    assert.equal(bounded.deleted("50"), undefined)
    assert.equal(bounded.deleted("51")?.authorId, "3")
    // 2,000 units of text are 4,000 bytes, so the third message pushes out the first
    const sized = createMessageRevisions(10000, 8000)
    sized.keepText("1", true)
    for (const id of ["60", "61", "62"]) sized.created(guild(id, { content: "z".repeat(2000) }))
    assert.equal(sized.deleted("60"), undefined)
    assert.equal(sized.deleted("61")?.text?.length, 2000)
    assert.equal(sized.deleted("62")?.text?.length, 2000)
})
test("kept text ends before a character it would split at the 4000 limit", () => {
    const revisions = createMessageRevisions()
    revisions.keepText("1", true)
    revisions.created(guild("40", { content: `${"a".repeat(3999)}😀 after` }))
    const text = revisions.changed(guild("40", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited" })).previous
        ?.text
    assert.equal(text, "a".repeat(3999))
    assert.equal(text?.isWellFormed(), true)
})

test("a server that keeps message text keeps none of another bot's, a webhook's or the system's, while still tracking their edits", () => {
    const revisions = createMessageRevisions()
    revisions.keepText("1", true)
    const attachments = [{ id: "9", filename: "synthetic.png", url: "https://example.invalid/a.png", size: 1 }]
    const posted = (id: string, author: Partial<Message["author"]>, webhookId?: string) =>
        message(id, {
            guildId: "1",
            content: "Synthetic text",
            attachments: attachments as unknown as Message["attachments"],
            author: { id: "3", username: "Synthetic author", isBot: false, ...author } as Message["author"],
            ...(webhookId ? { webhookId } : {}),
        })
    revisions.created(posted("40", { isBot: true }))
    revisions.created(posted("41", {}, "77"))
    revisions.created(posted("42", { isSystem: true }))
    revisions.created(posted("43", {}))
    assert.equal(revisions.changed(posted("40", { isBot: true })).needed, false)
    for (const id of ["40", "41", "42"]) {
        const gone = revisions.deleted(id)!
        assert.deepEqual([gone.text, gone.attachments, gone.authorBot], [undefined, undefined, true])
    }
    const human = revisions.deleted("43")!
    assert.equal(human.text, "Synthetic text")
    assert.equal(human.attachments?.length, 1)
})
