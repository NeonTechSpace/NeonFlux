import assert from "node:assert/strict"
import test from "node:test"
import { COMMAND_RULE_LIMIT, LIMITABLE_COMMANDS } from "@neonflux/contracts/command-rules"
import { adapterFixture } from "./adapter-fixture.ts"
import { createCommandRulesStore, CommandRulesStoreError } from "../../bot/src/command-rules-store.ts"
import { createGeneralSettingsStore } from "../../bot/src/general-settings.ts"

const modules = {
    "../convex/commandRules.ts": () => import("../convex/commandRules.ts"),
    "../convex/generalSettings.ts": () => import("../convex/generalSettings.ts"),
}
const actor = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}

test("rules are saved, read with the prefix and removed once no limit is left, and each change is audited", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createCommandRulesStore(f.config),
        general = createGeneralSettingsStore(f.config, "1"),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const manage = (operation: unknown) =>
        store.manage({ ...f.source(), actor, managerAuthorized: true, operation } as never)
    assert.equal("commandRules" in (await run(general.get())), false)
    const channels = await run(manage({ type: "set", command: "rank", channelIds: ["40"] }))
    assert.deepEqual(
        channels.rules.map((rule: { command: string; channelIds: string[]; roleIds: string[] }) => [
            rule.command,
            rule.channelIds,
            rule.roleIds,
        ]),
        [["rank", ["40"], []]],
    )
    // Setting one list keeps the other
    const both = await run(manage({ type: "set", command: "rank", roleIds: ["50", "51"] }))
    assert.deepEqual([both.rules[0].channelIds, both.rules[0].roleIds], [["40"], ["50", "51"]])
    assert.deepEqual((await run(general.get())).commandRules, both.rules)
    const roleOnly = await run(manage({ type: "set", command: "rank", channelIds: [] }))
    assert.deepEqual([roleOnly.rules[0].channelIds, roleOnly.rules[0].roleIds], [[], ["50", "51"]])
    assert.deepEqual((await run(manage({ type: "set", command: "rank", roleIds: [] }))).rules, [])
    assert.deepEqual((await run(manage({ type: "set", command: "level", roleIds: ["50"] }))).rules.length, 1)
    assert.deepEqual((await run(manage({ type: "clear", command: "level" }))).rules, [])
    const audits = await f.backend.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.equal(audits.length, 6)
    assert.ok(audits.every((row) => row.feature === "commandrules" && row.actorId === "10"))
})

test("critical commands, oversized lists and rules past the limit are refused", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createCommandRulesStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const manage = (operation: unknown) =>
        store.manage({ ...f.source(), actor, managerAuthorized: true, operation } as never)
    for (const command of ["defcon", "mod", "help", "commands", "lockdown", "ticket"])
        await f.reject(manage({ type: "set", command, channelIds: ["40"] }), CommandRulesStoreError, 400)
    await f.reject(
        manage({ type: "set", command: "rank", channelIds: Array.from({ length: 501 }, (_, i) => String(i + 1)) }),
        CommandRulesStoreError,
        400,
    )
    await f.reject(manage({ type: "set", command: "rank", roleIds: ["50", "50"] }), CommandRulesStoreError, 400)
    await f.reject(
        store.manage({
            ...f.source(),
            actor: { ...actor, nativePermissionAuthorized: false },
            managerAuthorized: true,
            operation: { type: "clear", command: "rank" },
        }),
        CommandRulesStoreError,
        403,
    )
    for (const command of LIMITABLE_COMMANDS.slice(0, COMMAND_RULE_LIMIT))
        await run(manage({ type: "set", command, channelIds: ["40"] }))
    await f.reject(
        manage({ type: "set", command: LIMITABLE_COMMANDS[COMMAND_RULE_LIMIT], channelIds: ["40"] }),
        CommandRulesStoreError,
        429,
    )
    // A rule already counted can still change
    const changed = await run(manage({ type: "set", command: LIMITABLE_COMMANDS[0], channelIds: ["41"] }))
    assert.equal(changed.rules.length, COMMAND_RULE_LIMIT)
})
