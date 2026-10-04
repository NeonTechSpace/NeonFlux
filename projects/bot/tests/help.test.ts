import assert from "node:assert/strict"
import test from "node:test"
import { BUILT_IN_COMMANDS } from "@neonflux/contracts/responses"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { helpAllRequest } from "../src/help.ts"
import { safetyHelp, safetyHelpAll, safetyNames } from "../src/moderation-command.ts"
import { publishingHelp, publishingHelpAll } from "../src/publishing-command.ts"
import { managementHelp, managementHelpAll, parseManagement } from "../src/response-command.ts"
import { roleHelp, roleHelpAll } from "../src/role-command.ts"
import { scheduleHelp, scheduleHelpAll } from "../src/schedule-command.ts"
import { ticketHelp, ticketHelpAll } from "../src/ticket-command.ts"
import { greetingsHelp, greetingsHelpAll } from "../src/welcome-command.ts"
import { withPrefix, type GeneralSettingsStore } from "../src/general-settings.ts"
import { platform } from "./moderation-fixture.ts"

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
function helpBot(options: { actorOwner?: boolean; actorPermissions?: bigint }) {
    return Effect.gen(function* () {
        const bot = yield* createTestBot(
            createBotOptions({ token, serverId: createFixtures().ids.guild }, { general: general("?") }),
        )
        const native = platform(bot, options)
        yield* bot.ready()
        const say = (content: string) =>
            Effect.gen(function* () {
                const before = native.replies.requests().length
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
                yield* bot.idle()
                return native.replies
                    .requests()
                    .slice(before)
                    .map((row) => shown(row.body as Body))
            })
        return { bot, say }
    })
}

// Every command's own help text, as !<command> help answers it
const commandHelps: Record<string, string> = {
    ticket: ticketHelp,
    publish: publishingHelp,
    "publish schedule": scheduleHelp,
    roles: roleHelp("roles"),
    verify: roleHelp("verify"),
    autorole: roleHelp("autorole"),
    custom: managementHelp("custom"),
    auto: managementHelp("auto"),
    ...Object.fromEntries(safetyNames.map((name) => [name, safetyHelp(name)])),
    welcome: greetingsHelp("welcome"),
    "welcome dm": greetingsHelp("dm"),
    goodbye: greetingsHelp("goodbye"),
}
// The forms each help leaves out, which !<command> help all lists
const helpAlls: Record<string, readonly string[]> = {
    ticket: ticketHelpAll,
    publish: publishingHelpAll,
    "publish schedule": scheduleHelpAll,
    roles: roleHelpAll.roles,
    autorole: roleHelpAll.autorole,
    custom: managementHelpAll("custom"),
    auto: managementHelpAll("auto"),
    ...safetyHelpAll,
    welcome: greetingsHelpAll("welcome"),
    "welcome dm": greetingsHelpAll("dm"),
    goodbye: greetingsHelpAll("goodbye"),
}
// Words that name NeonFlux's internals rather than what a member sees. Command words such as module, reconcile or dry-run stay in the forms
const internal = /\b(backend|revision|stale|tracked|payload|deployment|module|intake|attempt|reconcile|dry-run)\b/i
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
    assert.equal(helpAllRequest("publish", ["template", "help", "all"]), undefined)
    assert.equal(helpAllRequest("custom", ["constructor", "help", "all"]), undefined)
})

test("help all lists a command's remaining forms ten at a time with next, also for subcommands", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
                // Lines about a DM keep !, which every DM uses
                const prefixed = (lines: readonly string[]) => withPrefix(lines.join("\n"), "?")
                // Fewer than ten forms fill one page, so the page offers no next
                assert.equal(managementHelpAll("auto").length, 7)
                assert.deepEqual(yield* say("?auto help all"), [prefixed(managementHelpAll("auto"))])
                assert.deepEqual(yield* say("?auto help all next"), [
                    "There is no next page to show. Send ?auto help all to start the list again",
                ])
                // Ten forms fill one page, so the page offers no next
                assert.equal(safetyHelpAll.security.length, 10)
                assert.deepEqual(yield* say("?security help all"), [prefixed(safetyHelpAll.security)])
                assert.deepEqual(yield* say("?security help all next"), [
                    "There is no next page to show. Send ?security help all to start the list again",
                ])
                assert.ok(publishingHelpAll.length > 10 && publishingHelpAll.length <= 20)
                assert.deepEqual(yield* say("?publish help all"), [
                    prefixed([...publishingHelpAll.slice(0, 10), "Send !publish help all next for more"]),
                ])
                const last = (yield* say("?publish help all next"))[0]!
                assert.equal(last, prefixed(publishingHelpAll.slice(10)))
                assert.ok(last.split("\n").length <= 10)
                assert.deepEqual(yield* say("?publish help all next"), [
                    "There is no next page to show. Send ?publish help all to start the list again",
                ])
                assert.ok(ticketHelpAll.length > 20 && ticketHelpAll.length <= 30)
                assert.deepEqual(yield* say("?ticket help all"), [
                    prefixed([...ticketHelpAll.slice(0, 10), "Send !ticket help all next for more"]),
                ])
                assert.deepEqual(yield* say("?ticket help all next"), [
                    prefixed([...ticketHelpAll.slice(10, 20), "Send !ticket help all next for more"]),
                ])
                const third = (yield* say("?ticket help all next"))[0]!
                assert.equal(third, prefixed(ticketHelpAll.slice(20)))
                assert.ok(third.split("\n").length <= 10)
                assert.deepEqual(yield* say("?ticket help all next"), [
                    "There is no next page to show. Send ?ticket help all to start the list again",
                ])
                assert.deepEqual(yield* say("?publish schedule help all"), [prefixed(scheduleHelpAll)])
                assert.deepEqual(yield* say("?welcome dm help all"), [prefixed(greetingsHelpAll("dm"))])
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
