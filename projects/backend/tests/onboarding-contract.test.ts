import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createOnboardingStore, OnboardingStoreError } from "../../bot/src/onboarding-store.ts"
import { createPresetStore, PresetStoreError } from "../../bot/src/preset-store.ts"
import { createSetupStore } from "../../bot/src/setup-check.ts"

const modules = { "../convex/onboarding.ts": () => import("../convex/onboarding.ts"), "../convex/presets.ts": () => import("../convex/presets.ts"), "../convex/setupCheck.ts": () => import("../convex/setupCheck.ts") }

test("onboarding, preset and setup adapters round trip through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const onboarding = createOnboardingStore(f.config), presets = createPresetStore(f.config)
    const saved = await run(onboarding.manage({ ...f.source(), originServerId: "1", actor, operation: { type: "step-add", step: { type: "link", channelId: "50", text: "Say hello" } } }))
    assert.deepEqual(saved, { revision: 1, settings: { enabled: false, delivery: "welcome", steps: [{ type: "link", channelId: "50", text: "Say hello" }], completionRoleId: null }, roleSteps: [] })
    await run(onboarding.manage({ ...f.source(), originServerId: "1", actor, operation: { type: "module", enabled: true } }))
    assert.equal((await run(onboarding.get({ serverId: "1" }))).settings.enabled, true)
    await f.reject(onboarding.manage({ ...f.source(), originServerId: "1", actor, operation: { type: "step-add", step: { type: "panel", name: "missing" } } }), OnboardingStoreError, 404)
    const context = { originServerId: "1", userId: "20", joinedAt: "2023-11-14T22:00:00.000Z", roleIds: [], isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true, roles: [] }
    assert.deepEqual(await run(onboarding.member({ serverId: "1", context })), { enabled: true, steps: [{ text: "<#50> Say hello", state: "info" }], complete: false })
    const plans = (await run(presets.plans({ serverId: "1" }))).presets
    assert.equal(plans.length, 6)
    const gaming = plans.find((plan: { name: string }) => plan.name === "gaming")
    assert.deepEqual((await run(presets.apply({ ...f.source(), originServerId: "1", actor, name: "gaming", token: gaming.token }))).plan, gaming)
    await f.reject(presets.apply({ ...f.source(), originServerId: "1", actor, name: "gaming", token: gaming.token }), PresetStoreError, 409)
    // The bot reads every setup section the backend reports, including the checklist
    const status = await run(createSetupStore(f.config).status("1"))
    assert.deepEqual(status.sections.find((section: { id: string }) => section.id === "onboarding"), { id: "onboarding", state: "setup" })
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
