import assert from "node:assert/strict"
import test from "node:test"
import { parseSuggestionCommand, suggestionCritical, suggestionPublic } from "../src/suggestion-command.ts"
import { parseManagement } from "../src/response-command.ts"

test("suggestion grammar binds immutable quoted text, explicit command votes and exact recovery revisions", () => {
    assert.deepEqual(parseSuggestionCommand(["submit", "A public proposition with spaces"]), { type: "submit", text: "A public proposition with spaces" })
    assert.deepEqual(parseSuggestionCommand(["vote", "4", "clear"]), { type: "vote", suggestionNo: 4, vote: "clear" })
    assert.deepEqual(parseSuggestionCommand(["status", "4", "8", "planned", "Public reason"]), { type: "status", suggestionNo: 4, expectedRevision: 8, state: "planned", reason: "Public reason" })
    assert.deepEqual(parseSuggestionCommand(["replace", "4", "8", "2", "confirm"]), { type: "replace", suggestionNo: 4, expectedRevision: 8, expectedGeneration: 2, confirmed: true })
    assert.deepEqual(parseSuggestionCommand(["list", "planned", "12"]), { type: "list", state: "planned", cursor: "12" })
    for (const args of [["submit", ""], ["submit", "x".repeat(2001)], ["submit", "two", "tokens"], ["vote", "0", "up"], ["vote", "01", "up"], ["vote", "4", "reaction"], ["status", "4", "8", "withdrawn", "reason"], ["status", "4", "8", "planned", "x".repeat(501)], ["owner", "4", "8", "0"], ["replace", "4", "8", "0", "confirm"], ["withdraw", "4", "8", "yes"], ["forget", "4", "8", "confirm", "extra"]]) assert("error" in parseSuggestionCommand(args), JSON.stringify(args))
})

test("restricted recovery and public participation stay separate", () => {
    for (const args of [["withdraw", "4", "8", "confirm"], ["disable", "1"], ["publication", "4"], ["reconcile", "4", "8", "2"], ["forget", "4", "8", "confirm"], ["status", "4", "8", "declined", "reason"]]) assert(suggestionCritical(parseSuggestionCommand(args)))
    for (const args of [["submit", "text"], ["vote", "4", "up"], ["enable", "1"]]) assert(!suggestionCritical(parseSuggestionCommand(args)))
    const vote = parseSuggestionCommand(["vote", "4", "up"])
    assert(!("error" in vote) && suggestionPublic(vote))
    assert("error" in parseManagement("custom", ["create", "suggest", "text", "Response"]))
    assert(!("error" in parseManagement("custom", ["create", "ordinary", "text", "Response"])))
})
