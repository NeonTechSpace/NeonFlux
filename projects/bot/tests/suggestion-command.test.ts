import assert from "node:assert/strict"
import test from "node:test"
import { parseSuggestionCommand, suggestionCritical, suggestionPublic } from "../src/suggestion-command.ts"
import { parseManagement } from "../src/response-command.ts"

test("suggestion grammar binds immutable quoted text, explicit command votes, free-text reasons and paging without revisions", () => {
    assert.deepEqual(parseSuggestionCommand(["submit", "A public proposition with spaces"]), { type: "submit", text: "A public proposition with spaces" })
    assert.deepEqual(parseSuggestionCommand(["vote", "4", "clear"]), { type: "vote", suggestionNo: 4, vote: "clear" })
    assert.deepEqual(parseSuggestionCommand(["status", "4", "planned", "Public", "reason"]), { type: "status", suggestionNo: 4, state: "planned", reason: "Public reason" })
    assert.deepEqual(parseSuggestionCommand(["status", "4", "planned", "Quoted reason"]), { type: "status", suggestionNo: 4, state: "planned", reason: "Quoted reason" })
    assert.deepEqual(parseSuggestionCommand(["replace", "4", "confirm"]), { type: "replace", suggestionNo: 4, confirmed: true })
    assert.deepEqual(parseSuggestionCommand(["reconcile", "4"]), { type: "reconcile", suggestionNo: 4, confirmed: false })
    assert.deepEqual(parseSuggestionCommand(["withdraw", "4", "confirm"]), { type: "withdraw", suggestionNo: 4, confirmed: true })
    assert.deepEqual(parseSuggestionCommand(["forget", "4"]), { type: "forget", suggestionNo: 4, confirmed: false })
    assert.deepEqual(parseSuggestionCommand(["configure", "<#123456789012345678>"]), { type: "configure", channelId: "123456789012345678" })
    assert.deepEqual(parseSuggestionCommand(["enable"]), { type: "enable" })
    assert.deepEqual(parseSuggestionCommand(["list"]), { type: "list", next: false })
    assert.deepEqual(parseSuggestionCommand(["list", "next"]), { type: "list", next: true })
    assert.deepEqual(parseSuggestionCommand(["list", "planned", "next"]), { type: "list", state: "planned", next: true })
    for (const args of [["submit", ""], ["submit", "x".repeat(2001)], ["submit", "two", "tokens"], ["vote", "0", "up"], ["vote", "01", "up"], ["vote", "4", "reaction"], ["status", "4", "withdrawn", "reason"], ["status", "4", "planned"], ["status", "4", "planned", "x".repeat(501)], ["owner", "4", "8", "0"], ["replace", "4", "8", "2", "confirm"], ["withdraw", "4", "yes"], ["withdraw", "4", "8", "confirm"], ["forget", "4", "confirm", "extra"],
        ["list", "planned", "12"], ["list", "12"], ["list", "next", "next"], ["configure", "1", "<#123456789012345678>"], ["enable", "1"], ["disable", "1"]]) assert("error" in parseSuggestionCommand(args), JSON.stringify(args))
})

test("restricted recovery and public participation stay separate", () => {
    for (const args of [["withdraw", "4", "confirm"], ["disable"], ["publication", "4"], ["reconcile", "4"], ["forget", "4", "confirm"], ["status", "4", "declined", "reason"]]) assert(suggestionCritical(parseSuggestionCommand(args)))
    for (const args of [["submit", "text"], ["vote", "4", "up"], ["enable"]]) assert(!suggestionCritical(parseSuggestionCommand(args)))
    const vote = parseSuggestionCommand(["vote", "4", "up"])
    assert(!("error" in vote) && suggestionPublic(vote))
    assert("error" in parseManagement("custom", ["create", "suggest", "text", "Response"]))
    assert(!("error" in parseManagement("custom", ["create", "ordinary", "text", "Response"])))
})
