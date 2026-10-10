import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { audiences, helpCard } from "../src/help.ts"
import { onboardingCritical, onboardingPublic, parseOnboardingCommand } from "../src/onboarding-command.ts"
import type { OnboardingStore } from "../src/onboarding-store.ts"
import { createOnboardingRuntime } from "../src/onboarding.ts"
import { parsePresetCommand } from "../src/preset-command.ts"
import type { PresetStore } from "../src/preset-store.ts"
import { platform, token } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles } from "./roles-native-fixture.ts"

// An in-memory onboarding backend. progress answers each member, and every request is kept
function onboardingBoundary(view: C.OnboardingView, progress: (context: C.RolesMemberContext) => C.OnboardingProgress) {
    const gets: C.OnboardingGetRequest[] = [], manages: C.OnboardingManageRequest[] = [], members: C.OnboardingMemberRequest[] = []
    const store: OnboardingStore = {
        get: input => Effect.sync(() => { gets.push(input); return structuredClone(view) }),
        manage: input => Effect.sync(() => { manages.push(structuredClone(input)); return structuredClone(view) }),
        member: input => Effect.sync(() => { members.push(structuredClone(input)); return progress(input.context) }),
    }
    return { store, gets, manages, members }
}
const settings = (roleId: string): C.OnboardingSettings => ({ enabled: true, delivery: "welcome", steps: [{ type: "panel", name: "colors" }, { type: "link", channelId: "70", text: "Say hello" }], completionRoleId: roleId })

test("Commands parse as the help describes, and only the member checklist is public", () => {
    assert.deepEqual(parseOnboardingCommand([]), { type: "progress" })
    assert.deepEqual(parseOnboardingCommand(["add", "panel", "Colors"]), { type: "add", step: { type: "panel", name: "colors" } })
    assert.deepEqual(parseOnboardingCommand(["add", "link", "<#123>", "Say", "hello"]), { type: "add", step: { type: "link", channelId: "123", text: "Say hello" } })
    assert.deepEqual(parseOnboardingCommand(["role", "none"]), { type: "role", roleId: null })
    assert.deepEqual(parseOnboardingCommand(["remove", "2"]), { type: "remove", position: 2 })
    assert.deepEqual(parseOnboardingCommand(["delivery", "dm"]), { type: "delivery", delivery: "dm" })
    for (const invalid of [["remove", "6"], ["add", "link", "<#123>", "x".repeat(101)], ["add", "panel"], ["delivery", "goodbye"]]) assert.equal("error" in parseOnboardingCommand(invalid), true)
    assert.deepEqual([[], ["help"], ["on"], ["off"], ["status"]].map(args => [onboardingPublic(parseOnboardingCommand(args)), onboardingCritical(parseOnboardingCommand(args))]),
        [[true, false], [true, false], [false, false], [false, true], [false, true]])
    assert.deepEqual(parsePresetCommand(["apply", "Strict", "0A1B2C3D"]), { type: "apply", name: "strict", token: "0a1b2c3d" })
    assert.deepEqual(parsePresetCommand([]), { type: "list" })
    assert.equal("error" in parsePresetCommand(["apply", "chaos"]), true)
    assert.deepEqual(parsePresetCommand(["show", "strict", "all"]), { type: "show", name: "strict", all: true })
    assert.deepEqual(parsePresetCommand(["show", "strict", "all", "next"]), { type: "show", name: "strict", all: true, next: true })
    for (const invalid of [["show", "strict", "next"], ["show", "strict", "all", "2"], ["show", "strict", "every"]]) assert.equal("error" in parsePresetCommand(invalid), true)
    // Every member sees their checklist command in help, and managers see presets
    assert.equal(JSON.stringify(helpCard("!", audiences(0n), "roles")).includes("!onboarding"), true)
    assert.equal(JSON.stringify(helpCard("!", audiences(Permissions.ManageGuild), "setup")).includes("!preset"), true)
})

test("A role change that may finish the checklist asks the backend once and adds the completion role through the role lifecycle", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), serverId = createFixtures().ids.guild
        let done = false
        const remote = onboardingBoundary({ revision: 1, settings: settings("0"), roleSteps: [] }, () => done
            ? { enabled: true, steps: [{ text: "Pick your colors roles", state: "done" }], complete: true, completedAt: 1, grant: { sourceId: "onboarding_synthetic", roleId: completion } }
            : { enabled: true, steps: [{ text: "Pick your colors roles", state: "open" }], complete: false })
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, onboarding: remote.store })), f = bot.fixtures, p = nativeRoles(bot)
        const completion = p.second.id
        remote.store.get = input => Effect.sync(() => { remote.gets.push(input); return { revision: 1, settings: settings(completion), roleSteps: [[p.role.id]] } })
        yield* bot.ready()
        const update = (roleIds: string[]) => bot.emit("GUILD_MEMBER_UPDATE", { ...f.member({ user: f.user({ id: p.targetId }), roles: roleIds }), guild_id: f.ids.guild }).pipe(Effect.andThen(bot.idle()))
        // Without a role of every step nothing is asked
        yield* update([p.targetRole.id])
        assert.deepEqual([remote.gets.length, remote.members.length], [1, 0])
        done = true
        yield* update([p.targetRole.id, p.role.id])
        assert.equal(remote.members.length, 1)
        assert.equal(remote.members[0]!.context.userId, p.targetId)
        // Startup reads the role state, then the completion role is one evaluate, dispatch and outcome
        const changes = roles.calls.filter(call => call.method !== "observe" && call.method !== "reactionJobs")
        assert.deepEqual(changes.map(call => call.method), ["evaluate", "dispatch", "outcome"])
        assert.deepEqual((changes[0]!.input as C.RolesEvaluateRequest).operation, { type: "onboarding", roleId: completion })
        assert.equal(p.add.requests().length, 1)
        assert.equal(p.roleIds.has(completion), true)
        // A member seen finished costs nothing on later role changes
        yield* update([p.targetRole.id, p.role.id, completion])
        assert.deepEqual([remote.gets.length, remote.members.length, p.add.requests().length], [1, 1, 1])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("The checklist is read again after ten minutes, and a changed checklist is used at once", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const remote = onboardingBoundary({ revision: 1, settings: settings("1"), roleSteps: [["5"]] }, () => ({ enabled: true, steps: [], complete: false }))
        const runtime = createOnboardingRuntime(remote.store, undefined, "1")
        yield* runtime.current; yield* runtime.current
        assert.equal(remote.gets.length, 1)
        yield* TestClock.adjust("10 minutes")
        yield* runtime.current
        assert.equal(remote.gets.length, 2)
        yield* runtime.updated({ revision: 2, settings: { ...settings("1"), enabled: false }, roleSteps: [["5"]] })
        assert.equal((yield* runtime.current)?.settings.enabled, false)
        assert.equal(remote.gets.length, 2)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Members see their checklist, and only the owner or an Administrator changes it", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), serverId = createFixtures().ids.guild
        const remote = onboardingBoundary({ revision: 1, settings: settings("9"), roleSteps: [["9"]] }, () => ({ enabled: true, complete: false,
            steps: [{ text: "Pick your colors roles in <#31>", state: "done" }, { text: "Accept the server rules in <#30>", state: "open" }, { text: "<#32> Say hello", state: "info" }] }))
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, onboarding: remote.store })), f = bot.fixtures, p = platform(bot)
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(bot.idle()))
        const replies = () => p.replies.requests().map(row => (row.body as { embeds?: object[] }).embeds?.[0])
        yield* send("!onboarding")
        assert.deepEqual(replies().at(-1), { color: 0x5560e6, title: "Your newcomer checklist", description: "Done: Pick your colors roles in <#31>\nTo do: Accept the server rules in <#30>\nVisit: <#32> Say hello" })
        assert.equal(remote.members[0]!.context.userId, f.ids.user)
        yield* send("!onboarding add panel colors")
        assert.deepEqual(remote.manages.map(row => [row.operation, row.actor.userId]), [[{ type: "step-add", step: { type: "panel", name: "colors" } }, f.ids.user]])
        // A change answers with one line that names it, and the full checklist stays in !onboarding status
        assert.equal((p.replies.requests().at(-1)!.body as { content: string }).content, "Step added: Roles from the colors reaction panel. The checklist has 2 steps now")
        yield* send("!onboarding on")
        assert.equal((p.replies.requests().at(-1)!.body as { content: string }).content, "The newcomer checklist is on")
        yield* send("!onboarding status")
        assert.deepEqual(replies().at(-1), { color: 0x5560e6, title: "Newcomer checklist", fields: [{ name: "Status", value: "On" }, { name: "Sent with", value: "The welcome greeting" },
            { name: "Steps", value: "1. Roles from the colors reaction panel\n2. <#70> Say hello" }, { name: "Completion role", value: "<@&9>" }] })
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const remote = onboardingBoundary({ revision: 1, settings: settings("9"), roleSteps: [] }, () => ({ enabled: false, steps: [], complete: false })), serverId = createFixtures().ids.guild
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { onboarding: remote.store })), f = bot.fixtures
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ManageGuild | Permissions.ManageRoles })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!onboarding on" })); yield* bot.idle()
        yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!onboarding" })); yield* bot.idle()
        assert.deepEqual(p.replies.requests().map(row => (row.body as { content: string }).content), ["Only the server owner or an Administrator can change the newcomer checklist", "This server has no newcomer checklist"])
        assert.equal(remote.manages.length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Presets show their changes with a confirmation code, and applying sends the code the manager confirmed", async () => {
    const plan: C.PresetPlan = { name: "gaming", kind: "community", description: "Leveling with quick XP and events for game nights", token: "0a1b2c3d",
        changes: [{ family: "leveling", setting: "leveling", from: "off", to: "on" }, { family: "events", setting: "events", from: "off", to: "on" }] }
    const applied: C.PresetApplyRequest[] = []
    const presets: PresetStore = { plans: () => Effect.succeed({ presets: [plan] }), apply: input => Effect.sync(() => { applied.push(input); return { plan } }) }
    for (const owner of [true, false]) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: createFixtures().ids.guild }, { presets })), f = bot.fixtures
        const p = platform(bot, owner ? {} : { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ManageGuild })
        yield* bot.ready()
        for (const content of ["!preset show gaming", "!preset apply gaming 0a1b2c3d"]) { yield* bot.emit("MESSAGE_CREATE", f.message({ content })); yield* bot.idle() }
        const replies = p.replies.requests().map(row => row.body as { content?: string, embeds?: object[] })
        assert.deepEqual(replies[0]!.embeds, [{ color: 0x5560e6, title: "Preset gaming", description: "Leveling with quick XP and events for game nights\n`!preset show gaming all` lists each change",
            fields: [{ name: "Kind", value: "Community" }, { name: "Changes", value: "Changes 2 settings" }, { name: "Confirm", value: "`!preset apply gaming 0a1b2c3d`" }] }])
        assert.equal(replies[1]!.content, owner ? "Applied gaming. It changed 2 settings" : "Only the server owner or an Administrator can apply a preset")
    })).pipe(Effect.provide(TestClock.layer())))
    assert.deepEqual(applied.map(row => [row.name, row.token]), [["gaming", "0a1b2c3d"]])
})

test("A preset preview counts its changes, and all lists each one ten to a page", async () => {
    const changes: C.PresetChange[] = [...Array.from({ length: 8 }, (_, i): C.PresetChange => ({ family: "moderation", setting: `setting ${i + 1}`, from: "off", to: "on" })),
        ...Array.from({ length: 4 }, (_, i): C.PresetChange => ({ family: "moderation", setting: `rule preset-${i + 1}`, from: "none", to: "spam, delete at 6 in 10 seconds" })),
        { family: "moderation", setting: "rule preset-lookalikes", from: "deceptive-links, log", to: "deceptive-links, delete" }]
    const plan: C.PresetPlan = { name: "strict", kind: "security", description: "Strong protection", token: "0a1b2c3d", changes }
    const presets: PresetStore = { plans: () => Effect.succeed({ presets: [plan] }), apply: () => Effect.succeed({ plan }) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: createFixtures().ids.guild }, { presets })), f = bot.fixtures, p = platform(bot)
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", f.message({ content })); yield* bot.idle()
            return p.replies.requests().at(-1)!.body as { content?: string, embeds?: { description: string, fields?: { name: string, value: string }[] }[] }
        })
        const shown = (yield* say("!preset show strict")).embeds![0]!
        assert.equal(shown.fields!.find(x => x.name === "Changes")!.value, "Changes 8 settings, adds 4 automod rules and updates 1 automod rule")
        const first = (yield* say("!preset show strict all")).embeds![0]!
        assert.deepEqual(first.description.split("\n"), [...Array.from({ length: 8 }, (_, i) => `Setting ${i + 1}: off → on`), "Adds automod rule preset-1: spam, delete at 6 in 10 seconds",
            "Adds automod rule preset-2: spam, delete at 6 in 10 seconds", "Confirm with `!preset apply strict 0a1b2c3d`"])
        assert.deepEqual(first.fields, [{ name: "Next", value: "`!preset show strict all next`" }])
        const second = (yield* say("!preset show strict all next")).embeds![0]!
        assert.deepEqual(second.description.split("\n").slice(-2), ["Automod rule preset-lookalikes: deceptive-links, log → deceptive-links, delete", "Confirm with `!preset apply strict 0a1b2c3d`"])
        assert.equal((yield* say("!preset show strict all next")).content, "There is no next page to show. Send !preset show strict all to start the list again")
        assert.equal((yield* say("!preset apply strict 0a1b2c3d")).content, "Applied strict. It changed 8 settings, added 4 automod rules and updated 1 automod rule")
    })).pipe(Effect.provide(TestClock.layer())))
})
