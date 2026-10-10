import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { audiences, helpPages } from "../src/help.ts"
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
    // Every member sees their checklist command in help, and managers see presets
    assert.equal(helpPages("!", audiences(0n), "roles")?.join("\n").includes("!onboarding"), true)
    assert.equal(helpPages("!", audiences(Permissions.ManageGuild), "general")?.join("\n").includes("!preset"), true)
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
        const replies = () => p.replies.requests().map(row => (row.body as { content: string }).content)
        yield* send("!onboarding")
        assert.equal(replies().at(-1), "Your newcomer checklist\nDone: Pick your colors roles in <#31>\nTo do: Accept the server rules in <#30>\nVisit: <#32> Say hello")
        assert.equal(remote.members[0]!.context.userId, f.ids.user)
        yield* send("!onboarding add panel colors")
        assert.deepEqual(remote.manages.map(row => [row.operation, row.actor.userId]), [[{ type: "step-add", step: { type: "panel", name: "colors" } }, f.ids.user]])
        assert.match(replies().at(-1)!, /^Saved\nNewcomer checklist on, sent with the welcome greeting\n1\. Roles from the colors reaction panel\n2\. <#70> Say hello\nCompletion role: <@&9>$/)
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
        const replies = p.replies.requests().map(row => (row.body as { content: string }).content)
        assert.equal(replies[0], "gaming (community): Leveling with quick XP and events for game nights\nChanges 2:\n- leveling: off → on\n- events: off → on\nConfirm with !preset apply gaming 0a1b2c3d")
        assert.equal(replies[1], owner ? "Applied gaming\nleveling: off → on\nevents: off → on" : "Only the server owner or an Administrator can apply a preset")
    })).pipe(Effect.provide(TestClock.layer())))
    assert.deepEqual(applied.map(row => [row.name, row.token]), [["gaming", "0a1b2c3d"]])
})
