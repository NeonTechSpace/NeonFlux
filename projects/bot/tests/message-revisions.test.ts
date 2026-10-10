import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "@neontechspace/fluxerly/effect"
import { createMessageRevisions } from "../src/message-revisions.ts"

const message = (id: string, overrides: { readonly [K in keyof Message]?: Message[K] | undefined } = {}) => ({ id, channelId: "2", content: "Release notes https://example.invalid", embeds: [], attachments: [], stickers: [],
    author: { id: "3", username: "Synthetic author", isBot: false }, editedAt: null, pinned: false, flags: 0, ...overrides }) as Message

test("an update that repeats the edit time, pin status and flags is skipped and any change of them is not", () => {
    const revisions = createMessageRevisions()
    revisions.created(message("10"))
    assert.equal(revisions.changed(message("10", { embeds: [{ type: "link", url: "https://example.invalid" }] as unknown as Message["embeds"] })), false)
    assert.equal(revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited" })), true)
    // A preview generated for the edited text repeats the edit time
    assert.equal(revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited" })), false)
    assert.equal(revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited", pinned: true })), true)
    assert.equal(revisions.changed(message("10", { editedAt: "2026-01-01T00:01:00.000Z", content: "Edited", pinned: true, flags: 4 })), true)
})

test("unknown values and messages outside the memory are always processed", () => {
    const revisions = createMessageRevisions(2)
    assert.equal(revisions.changed(message("20")), true)
    revisions.created(message("21", { pinned: undefined }))
    assert.equal(revisions.changed(message("21", { pinned: undefined })), true)
    assert.equal(revisions.changed(message("21", { pinned: undefined })), true)
    revisions.created(message("22")); revisions.created(message("23")); revisions.created(message("24"))
    assert.equal(revisions.changed(message("22")), true)
    assert.equal(revisions.changed(message("24")), false)
})
