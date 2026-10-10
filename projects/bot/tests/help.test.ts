import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { alertsHelp, invitesHelp } from "../src/alerts-command.ts"
import { statsHelp } from "../src/analytics-command.ts"
import { backupHelp } from "../src/backup-command.ts"
import { createBotOptions } from "../src/bot.ts"
import { cleanupHelp, cleanupHelpAll } from "../src/cleanup-command.ts"
import { eventHelp, eventHelpAll } from "../src/event-command.ts"
import { audiences, commandTable, helpAllRequest, helpCard, suggestCommand, type Audience } from "../src/help.ts"
import { answerHelp, helpDeskHelp } from "../src/helpdesk-command.ts"
import { levelHelp, levelHelpAll } from "../src/level-command.ts"
import { lfgHelp, lfgHelpAll } from "../src/lfg-command.ts"
import { memberDataHelp } from "../src/member-data-command.ts"
import { memberListHelp } from "../src/memberlist-command.ts"
import { metadataLogHelp, metadataLogHelpAll } from "../src/metadata-log-command.ts"
import { milestoneHelp, milestoneHelpAll } from "../src/milestone-command.ts"
import { safetyHelp, safetyHelpAll, safetyNames } from "../src/moderation-command.ts"
import { onboardingHelp } from "../src/onboarding-command.ts"
import { presetHelp } from "../src/preset-command.ts"
import { profileHelp } from "../src/profile-command.ts"
import { publishingHelp, publishingHelpAll } from "../src/publishing-command.ts"
import { renderCard, type Card } from "../src/reply-style.ts"
import { managementHelp, managementHelpAll, parseManagement } from "../src/response-command.ts"
import { roleHelp, roleHelpAll } from "../src/role-command.ts"
import { rolePickerHelp, rolePickerHelpAll } from "../src/rolepicker-command.ts"
import { scheduleHelp, scheduleHelpAll } from "../src/schedule-command.ts"
import { showcaseHelp } from "../src/showcase-command.ts"
import { sidebarHelp } from "../src/sidebar-command.ts"
import { stickyHelp } from "../src/sticky-command.ts"
import { suggestionHelp, suggestionHelpAll } from "../src/suggestion-command.ts"
import { temporaryRoleHelp } from "../src/temprole-command.ts"
import { ticketHelp, ticketHelpAll } from "../src/ticket-command.ts"
import { voiceHelp, voiceHelpAll } from "../src/voice-command.ts"
import { greetingsHelp, greetingsHelpAll } from "../src/welcome-command.ts"
import { youtubeHelp } from "../src/youtube-command.ts"
import { withPrefix, type GeneralSettingsStore } from "../src/general-settings.ts"
import type { ResponseStore } from "../src/responses-store.ts"
import { platform } from "./moderation-fixture.ts"

const token = Redacted.make("synthetic-help-test-token")
const general = (prefix: string): GeneralSettingsStore => ({ get: () => Effect.succeed({ prefix, replyStyle: "embed" as const, revision: 1 }), set: () => Effect.die("unused"),
    nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused") })
// A custom command named rules exists but is cooling down, and nothing else is defined
const responses: ResponseStore = { manage: () => Effect.die("unused"), evaluate: request => Effect.succeed(/^\?rules(\s|$)/.test(request.content) ? { send: false, defined: true } as const : { send: false } as const) }

type Body = { content?: string, embeds?: { title?: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }
// An embed reply as lines: its title, description, one "name: value" line per field and its footer
const shown = (body: Body) => body.content ?? body.embeds!.flatMap(embed => [embed.title, embed.description, ...(embed.fields ?? []).map(field => `${field.name}: ${field.value}`), embed.footer?.text])
    .filter(line => line !== undefined).join("\n")
function helpBot(options: { actorOwner?: boolean, actorPermissions?: bigint }) {
    return Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: createFixtures().ids.guild }, { general: general("?"), responses }))
        const native = platform(bot, options)
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () {
            const before = native.replies.requests().length
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
            yield* bot.idle()
            return native.replies.requests().slice(before).map(row => shown(row.body as Body))
        })
        return { bot, say }
    })
}

const groups = ["basics", "setup", "moderation", "roles", "messages", "support", "community", "voice"]
// Every command's own help text, as !<command> help answers it
const commandHelps: Record<string, string> = {
    ticket: ticketHelp, event: eventHelp(), publish: publishingHelp, "publish schedule": scheduleHelp, milestone: milestoneHelp, level: levelHelp(), voice: voiceHelp,
    roles: roleHelp("roles"), verify: roleHelp("verify"), autorole: roleHelp("autorole"), custom: managementHelp("custom"), auto: managementHelp("auto"), cleanup: cleanupHelp,
    ...Object.fromEntries(safetyNames.map(name => [name, safetyHelp(name)])), suggest: suggestionHelp, "logs metadata": metadataLogHelp, backup: backupHelp, lfg: lfgHelp,
    helpdesk: helpDeskHelp, answer: answerHelp, welcome: greetingsHelp("welcome"), "welcome dm": greetingsHelp("dm"), goodbye: greetingsHelp("goodbye"), temprole: temporaryRoleHelp,
    rolepicker: rolePickerHelp, showcase: showcaseHelp, profile: profileHelp, onboarding: onboardingHelp, preset: presetHelp, memberlist: memberListHelp, sidebar: sidebarHelp,
    sticky: stickyHelp, youtube: youtubeHelp, alerts: alertsHelp, invites: invitesHelp, stats: statsHelp, mydata: memberDataHelp,
}
// The forms each help leaves out, which !<command> help all lists
const helpAlls: Record<string, readonly string[]> = {
    ticket: ticketHelpAll, event: eventHelpAll, publish: publishingHelpAll, "publish schedule": scheduleHelpAll, milestone: milestoneHelpAll, level: levelHelpAll, voice: voiceHelpAll,
    roles: roleHelpAll.roles, autorole: roleHelpAll.autorole, custom: managementHelpAll("custom"), auto: managementHelpAll("auto"), cleanup: cleanupHelpAll, ...safetyHelpAll,
    suggest: suggestionHelpAll, "logs metadata": metadataLogHelpAll, lfg: lfgHelpAll, rolepicker: rolePickerHelpAll,
    welcome: greetingsHelpAll("welcome"), "welcome dm": greetingsHelpAll("dm"), goodbye: greetingsHelpAll("goodbye"),
}
// Words that name NeonFlux's internals rather than what a member sees. Command words such as module, reconcile or dry-run stay in the forms
const internal = /\b(backend|revision|hub|stale|tracked|payload|deployment|module|intake|attempt|reconcile|dry-run|planID|planHash|archiveDigest)\b/i
// The text of a help line a member reads as prose: The purpose after a form, or the whole line when it holds no form
const prose = (line: string) => line.startsWith("!") ? line.slice(line.indexOf(": ") + 2) : line

test("help lists the groups a member can use, and a group, feature or command name shows one line per command", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        assert.deepEqual(yield* say("?help"), [["Commands you can use", "Send `?help <group>` to see its commands, such as `?help basics`",
            "Basics: Ping, help, away status, prefix and reply style", "Moderation: Cases, automatic rules, raid protection, logs and alerts",
            "Roles: Role panels, verification, newcomer roles and the member list", "Support: Tickets, the help desk and suggestions",
            "Community: Levels, events, birthdays, showcases and profiles", "Voice: Temporary voice rooms and finding a group"].join("\n")])
        const support = ["Support commands", "`?ticket`: Open and follow private support tickets", "`?solved`: In a help post: Mark it solved and close it",
            "`?suggest`: Share ideas and vote on suggestions", "Add help to a command to see how to use it, such as `?ticket help`"].join("\n")
        // A group, one of its features and one of its commands open the same page, with staff commands left out
        for (const topic of ["support", "tickets", "ticket", "helpdesk"]) assert.deepEqual(yield* say(`?help ${topic}`), [support], topic)
        assert.deepEqual(yield* say("?help general"), yield* say("?help basics"))
        assert.doesNotMatch((yield* say("?help basics"))[0]!, /Add help/)
        assert.deepEqual(yield* say("?help backup"), ["None of the Setup commands are available to you here"])
        // An unknown topic gets one line with the closest topic the member can open, or the way back to the groups
        assert.deepEqual(yield* say("?help suport"), ["No help matches that. Did you mean `?help support`?"])
        assert.deepEqual(yield* say("?help nothing-here"), ["No help matches that. Send `?help` to see the groups"])
        assert.deepEqual(yield* say("?help support tickets"), ["No help matches that. Send `?help` to see the groups"])
        assert.deepEqual(yield* say("?help setpu"), ["No help matches that. Send `?help` to see the groups"])
        assert.equal(bot.failures().length, 0)
    })))
})

test("help for an administrator shows all eight groups, and every command sits on exactly one group page", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* helpBot({ actorOwner: false, actorPermissions: Permissions.Administrator })
        const [index] = yield* say("?help")
        assert.deepEqual(index!.split("\n").slice(2).map(line => line.split(":")[0]!.toLowerCase()), groups)
        const pages = []
        for (const group of groups) pages.push(...(yield* say(`?help ${group}`)))
        assert.equal(pages.length, groups.length)
        // Commands used in a DM keep !, which every DM uses
        for (const entry of commandTable) assert.equal(pages.filter(page => new RegExp(`^\`[?!]${entry.name}\`: `, "m").test(page)).length, 1, entry.name)
        assert.match(pages.join("\n"), /^`!backup`: .* in a DM/m)
        assert.deepEqual(yield* say("?help mod"), yield* say("?help moderation"))
        assert.deepEqual(yield* say("?help setpu"), ["No help matches that. Did you mean `?help setup`?"])
    })))
})

test("a mention of the bot followed by help answers like the help command", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        const [mentioned] = yield* say(`<@${bot.fixtures.ids.bot}> help`)
        assert.deepEqual([mentioned], yield* say("?help"))
        assert.deepEqual(yield* say(`<@${bot.fixtures.ids.bot}> help community`), yield* say("?help community"))
        // Another member's mention is ordinary chat
        assert.deepEqual(yield* say(`<@${bot.fixtures.ids.user}> help`), [])
    })))
})

test("an unknown command close to a built-in one gets one hint, while other text after the prefix stays quiet", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        assert.deepEqual(yield* say("?hepl"), ["Did you mean ?help? Send ?help to list the commands you can use"])
        assert.deepEqual(yield* say("?pign"), ["Did you mean ?ping? Send ?help to list the commands you can use"])
        assert.deepEqual(yield* say("?wow nice"), [])
        assert.deepEqual(yield* say("?!?"), [])
        // Forms merged into one command group get the normal hint or no reply, never a migration message
        assert.deepEqual(yield* say("?events"), ["Did you mean ?event? Send ?help to list the commands you can use"])
        assert.deepEqual(yield* say("?appeals list"), ["Did you mean ?appeal? Send ?help to list the commands you can use"])
        assert.deepEqual(yield* say("?case list"), [])
        // A custom command of that name exists, so roles is not suggested for it
        assert.deepEqual(yield* say("?rules"), [])
    })))
})

test("every help page stays within ten lines and eight embed fields for each audience, in both reply styles", () => {
    assert.equal(suggestCommand("Tikcet"), "ticket")
    assert.equal(suggestCommand("leaderbord"), "leaderboard")
    assert.equal(suggestCommand("mo"), "mod")
    assert.equal(suggestCommand("xyz"), undefined)
    assert.equal(suggestCommand("bakcup"), "backup")
    const topics = [undefined, ...groups, ...new Set(commandTable.flatMap(entry => [entry.feature, entry.name]))]
    const people: Audience[][] = [["everyone"], ["everyone", "staff"], ["everyone", "manager"], ["everyone", "staff", "manager", "admin"]]
    for (const audience of people) for (const topic of topics) {
        const card = helpCard("!!!!!", new Set(audience), topic)
        if (typeof card === "string") { assert.ok(!card.includes("\n"), `${topic}`); continue }
        const [text] = renderCard(card, "text"), [embed] = renderCard(card, "embed")
        assert.equal(renderCard(card, "text").length, 1)
        assert.ok("content" in text! && text.content.split("\n").length <= 10, `${audience} ${topic}`)
        assert.ok("embeds" in embed! && (embed.embeds[0].fields ?? []).length <= 8, `${audience} ${topic}`)
    }
    assert.deepEqual([...audiences(Permissions.ManageGuild)].sort(), ["everyone", "manager"])
    assert.deepEqual([...audiences(Permissions.KickMembers)].sort(), ["everyone", "staff"])
})

test("each command's help shows at most eight forms and one hint, and the hint opens the remaining forms", () => {
    for (const [path, help] of Object.entries(commandHelps)) {
        const lines = help.split("\n"), hint = `Send !${path} help all for the other commands`
        assert.ok(lines.length <= 10, path)
        assert.ok(lines.filter(line => line.startsWith("!")).length <= 8, path)
        assert.ok(lines.every(line => !line.includes(hint) || line === lines.at(-1)), path)
        // A help with a hint has its remaining forms behind help all, and only those helps answer help all
        const [name, ...words] = path.split(" ")
        const request = helpAllRequest(name, [...words, "help", "all"])
        assert.equal(lines.at(-1) === hint, request !== undefined, path)
        assert.equal(lines.at(-1) === hint, path in helpAlls, path)
        if (request) assert.deepEqual(request, { path, next: false, helpArgs: [...words, "help"] })
        for (const line of [...lines, ...helpAlls[path] ?? []]) assert.doesNotMatch(prose(line), internal, `${path}: ${line}`)
        // Every form says what it is for
        for (const line of [...lines, ...helpAlls[path] ?? []].filter(line => line.startsWith("!"))) assert.match(line, /: [A-Z]/, line)
    }
    assert.deepEqual(helpAllRequest("ticket", ["help", "all", "next"]), { path: "ticket", next: true, helpArgs: ["help"] })
    assert.equal(helpAllRequest("ticket", ["help", "all", "later"]), undefined)
    assert.equal(helpAllRequest("ticket", ["help"]), undefined)
    assert.equal(helpAllRequest("verify", ["help", "all"]), undefined)
    assert.equal(helpAllRequest("publish", ["template", "help", "all"]), undefined)
    assert.equal(helpAllRequest("ticket", ["constructor", "help", "all"]), undefined)
})

test("help all lists a command's remaining forms ten at a time with next, also for subcommands", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, say } = yield* helpBot({ actorOwner: false, actorPermissions: 0n })
        // Lines about a DM keep !, which every DM uses
        const prefixed = (lines: readonly string[]) => withPrefix(lines.join("\n"), "?")
        assert.ok(ticketHelpAll.length > 20 && ticketHelpAll.length <= 30)
        assert.deepEqual(yield* say("?ticket help all"), [prefixed([...ticketHelpAll.slice(0, 10), "Send !ticket help all next for more"])])
        assert.deepEqual(yield* say("?ticket help all next"), [prefixed([...ticketHelpAll.slice(10, 20), "Send !ticket help all next for more"])])
        const last = (yield* say("?ticket help all next"))[0]!
        assert.equal(last, prefixed(ticketHelpAll.slice(20)))
        assert.ok(last.split("\n").length <= 10)
        assert.deepEqual(yield* say("?ticket help all next"), ["There is no next page to show. Send ?ticket help all to start the list again"])
        assert.deepEqual(yield* say("?publish schedule help all"), [prefixed(scheduleHelpAll)])
        assert.deepEqual(yield* say("?welcome dm help all"), [prefixed(greetingsHelpAll("dm"))])
        assert.deepEqual(yield* say("?logs metadata help all"), [prefixed(metadataLogHelpAll)])
        for (const [path, forms] of Object.entries(helpAlls)) assert.ok(forms.length > 0 && forms.length <= 30, path)
        assert.equal(bot.failures().length, 0)
    })))
})

test("every built-in command name is reserved from custom commands and autoresponders", () => {
    assert.ok(!("error" in parseManagement("custom", ["create", "hello", "text", "Synthetic reply"])))
    for (const { name } of commandTable) assert.ok("error" in parseManagement("custom", ["create", name, "text", "Synthetic reply"]), name)
    // Names that are no longer built-in commands are free again
    for (const name of ["events", "appeals", "case"]) assert.ok(!("error" in parseManagement("custom", ["create", name, "text", "Synthetic reply"])), name)
})
