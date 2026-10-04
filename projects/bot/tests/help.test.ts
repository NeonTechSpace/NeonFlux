import assert from "node:assert/strict"
import test from "node:test"
import { BUILT_IN_COMMANDS } from "@neonflux/contracts/responses"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { helpAllRequest } from "../src/help.ts"
import { managementHelp, managementHelpAll, parseManagement } from "../src/response-command.ts"
import { withPrefix, type GeneralSettingsStore } from "../src/general-settings.ts"

const token = Redacted.make("synthetic-help-test-token")
const general = (prefix: string): GeneralSettingsStore => ({
    get: () => Effect.succeed({ prefix, revision: 1 }),
    set: () => Effect.die("unused"),
})

type Body = {
    content?: string
    embeds?: {
        title?: string
        description?: string
        fields?: { name: string; value: string }[]
        footer?: { text: string }
    }[]
}
// An embed reply as lines: its title, description, one "name: value" line per field and its footer
const shown = (body: Body) =>
    body.content ??
    body
        .embeds!.flatMap((embed) => [
            embed.title,
            embed.description,
            ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
            embed.footer?.text,
        ])
        .filter((line) => line !== undefined)
        .join("\n")
function helpBot() {
    return Effect.gen(function* () {
        const bot = yield* createTestBot(
            createBotOptions({ token, serverId: createFixtures().ids.guild }, { general: general("?") }),
        )
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        const say = (content: string) =>
            Effect.gen(function* () {
                const before = replies.requests().length
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
                yield* bot.idle()
                return replies
                    .requests()
                    .slice(before)
                    .map((row) => shown(row.body as Body))
            })
        return { bot, say }
    })
}

// Every command's own help text, as !<command> help answers it
const commandHelps: Record<string, string> = {
    custom: managementHelp("custom"),
    auto: managementHelp("auto"),
}
// The forms each help leaves out, which !<command> help all lists
const helpAlls: Record<string, readonly string[]> = {
    custom: managementHelpAll("custom"),
    auto: managementHelpAll("auto"),
}
// Words that name NeonFlux's internals rather than what a member sees. Command words such as module, reconcile or dry-run stay in the forms
const internal = /\b(backend|revision|stale|tracked|payload|deployment|module|attempt|reconcile|dry-run)\b/i
// The text of a help line a member reads as prose: The purpose after a form, or the whole line when it holds no form
const prose = (line: string) => (line.startsWith("!") ? line.slice(line.indexOf(": ") + 2) : line)

test("each command's help shows at most eight forms and one hint, and the hint opens the remaining forms", () => {
    for (const [path, help] of Object.entries(commandHelps)) {
        const lines = help.split("\n"),
            hint = `Send !${path} help all for the other commands`
        assert.ok(lines.length <= 10, path)
        assert.ok(lines.filter((line) => line.startsWith("!")).length <= 8, path)
        assert.ok(
            lines.every((line) => !line.includes(hint) || line === lines.at(-1)),
            path,
        )
        // A help with a hint has its remaining forms behind help all, and only those helps answer help all
        const [name, ...words] = path.split(" ")
        const request = helpAllRequest(name, [...words, "help", "all"])
        assert.equal(lines.at(-1) === hint, request !== undefined, path)
        assert.equal(lines.at(-1) === hint, path in helpAlls, path)
        if (request) assert.deepEqual(request, { path, next: false, helpArgs: [...words, "help"] })
        for (const line of [...lines, ...(helpAlls[path] ?? [])])
            assert.doesNotMatch(prose(line), internal, `${path}: ${line}`)
        // Every form says what it is for
        for (const line of [...lines, ...(helpAlls[path] ?? [])].filter((line) => line.startsWith("!")))
            assert.match(line, /: [A-Z]/, line)
    }
    assert.deepEqual(helpAllRequest("custom", ["help", "all", "next"]), {
        path: "custom",
        next: true,
        helpArgs: ["help"],
    })
    assert.equal(helpAllRequest("custom", ["help", "all", "later"]), undefined)
    assert.equal(helpAllRequest("custom", ["help"]), undefined)
    assert.equal(helpAllRequest("ping", ["help", "all"]), undefined)
    assert.equal(helpAllRequest("custom", ["create", "help", "all"]), undefined)
    assert.equal(helpAllRequest("custom", ["constructor", "help", "all"]), undefined)
})

test("help all lists a command's remaining forms ten at a time with next", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, say } = yield* helpBot()
                const prefixed = (lines: readonly string[]) => withPrefix(lines.join("\n"), "?")
                // Fewer than ten forms fill one page, so the page offers no next
                assert.equal(managementHelpAll("auto").length, 7)
                assert.deepEqual(yield* say("?auto help all"), [prefixed(managementHelpAll("auto"))])
                assert.deepEqual(yield* say("?auto help all next"), [
                    "There is no next page to show. Send ?auto help all to start the list again",
                ])
                for (const [path, forms] of Object.entries(helpAlls))
                    assert.ok(forms.length > 0 && forms.length <= 30, path)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("every built-in command name is reserved from custom commands and autoresponders", () => {
    assert.ok(!("error" in parseManagement("custom", ["create", "hello", "text", "Synthetic reply"])))
    for (const name of BUILT_IN_COMMANDS)
        assert.ok("error" in parseManagement("custom", ["create", name, "text", "Synthetic reply"]), name)
    // Names close to built-in commands that are not built-in themselves stay free
    for (const name of ["pings", "customs", "autos"])
        assert.ok(!("error" in parseManagement("custom", ["create", name, "text", "Synthetic reply"])), name)
})
