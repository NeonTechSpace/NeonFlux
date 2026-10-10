import assert from "node:assert/strict"
import test from "node:test"
import type { AlertInvite, AlertSettings, AlertsOperation } from "@neonflux/contracts/alerts"
import type { MetadataLogsEvent } from "@neonflux/contracts/metadata-logs"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import type { AlertsStore } from "../src/alerts-store.ts"
import type { MetadataLogsStore } from "../src/metadata-log-store.ts"
import { parseAlertsCommand } from "../src/alerts-command.ts"
import { inviteRef } from "../src/alerts-management.ts"
import { gainedPermissions } from "../src/alerts-worker.ts"
import { nameSkeleton, namesLookAlike } from "../src/alerts-names.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { mockBackend } from "./backend-fake.ts"

const token = Redacted.make("synthetic-alerts-test-token")
const memberId = "6001", adminId = "6003", modId = "6004", botAccountId = "6100", channelId = "5001"
/** An invite reference as replies show it, in inline code */
const quoted = (code: string) => `\`${inviteRef(code)}\``
const off: AlertSettings ={ invites: false, bots: false, webhooks: false, privileges: false, impersonation: false, expectedBotIds: [], expectedWebhookIds: [] }

/** The backend's alert settings in memory */
function memoryAlerts(initial: Partial<AlertSettings>) {
    let settings: AlertSettings = { ...off, ...initial }
    const calls: string[] = [], operations: AlertsOperation[] = []
    const store: AlertsStore = {
        get: () => Effect.sync(() => { calls.push("get"); return { settings } }),
        manage: input => Effect.sync(() => {
            calls.push("manage"); operations.push(input.operation)
            const op = input.operation
            if (op.type === "set") settings = { ...settings, [op.alert]: op.enabled }
            else {
                const key = op.kind === "bot" ? "expectedBotIds" : "expectedWebhookIds"
                settings = { ...settings, [key]: [...settings[key].filter(id => id !== op.id), ...op.expected ? [op.id] : []] }
            }
            return { settings }
        }),
    }
    return { store, calls, operations }
}
/** Metadata admission that keeps the security events it receives */
function memoryMetadata() {
    const events: MetadataLogsEvent[] = []
    const store = {
        admit: input => Effect.sync(() => { if (input.event.category === "security") events.push(input.event); return { admitted: false, duplicate: false, reason: "disabled" } as const }),
        work: () => Effect.succeed({ type: "work", records: [] }),
    } as Pick<MetadataLogsStore, "admit" | "work"> as MetadataLogsStore
    return { store, events }
}

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const segment = (path: string, index: number) => path.split("/")[index]!
const rawInvite = (bot: Bot, code: string, fields: Record<string, unknown> = {}) => ({ code, type: 0, channel: { id: channelId, type: 0 }, guild: { id: bot.fixtures.ids.guild, name: "Synthetic server" },
    presence_count: 1, member_count: 2, temporary: false, inviter: bot.fixtures.user({ id: memberId }), created_at: "2026-01-01T00:00:00.000Z", uses: 2, max_uses: 0, max_age: 0, expires_at: null, ...fields })
function platform(bot: Bot) {
    const f = bot.fixtures, ownerId = f.ids.user
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() }), adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    const modRole = f.role({ position: 8, permissions: Permissions.BanMembers.toString() }), plainRole = f.role({ position: 2, permissions: Permissions.SendMessages.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: ownerId }) })
    bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole, adminRole, modRole, plainRole] })
    bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4)
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId, username: userId === ownerId ? "NeonAdmin" : `member${userId}` }), roles: userId === f.ids.bot ? [botRole.id] : userId === adminId ? [adminRole.id] : [] }) }
    })
    bot.rest.respond("GET /channels/:id", request => ({ body: f.channel({ id: segment(request.path, 2), type: 0 }) }))
    const search = bot.rest.respond("POST /guilds/:id/members-search", { body: { guild_id: f.ids.guild, page_result_count: 1, total_result_count: 1, indexing: false,
        members: [{ guild_id: f.ids.guild, user_id: modId, username: "moderator", discriminator: "0001", global_name: "Kestrel Watch", nickname: null, role_ids: [modRole.id], joined_at: 1, is_bot: false, supplemental: { inviter_id: null, source_invite_code: null } }] } })
    const invites = bot.rest.respond("GET /guilds/:id/invites", { body: [rawInvite(bot, "SyntheticOld", { created_at: "2025-06-01T00:00:00.000Z", max_age: 86400, expires_at: "2025-06-02T00:00:00.000Z", max_uses: 5 }), rawInvite(bot, "SyntheticNew")] })
    const deleted = bot.rest.respond("DELETE /invites/:code", { status: 204 })
    let next = 1000
    const messages = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ id: String(++next), channel_id: segment(request.path, 2), author: f.botUser(), content: (request.body as { content?: string }).content ?? "" }) }))
    return {
        ownerId, modRole, plainRole, search, invites,
        deleted: () => deleted.requests().map(request => decodeURIComponent(segment(request.path, 2))),
        // A card reads as its title, description and one line per field
        replies: () => messages.requests().map(request => {
            const { content, embeds } = request.body as { content?: string, embeds?: { title: string, description?: string, fields?: { name: string, value: string }[] }[] }
            return content ?? embeds!.map(e => [e.title, ...e.description ? [e.description] : [], ...(e.fields ?? []).map(x => `${x.name}: ${x.value}`)].join("\n")).join("\n")
        }),
    }
}
function run(initial: Partial<AlertSettings>, body: (bot: Bot, native: ReturnType<typeof platform>, alerts: ReturnType<typeof memoryAlerts>, metadata: ReturnType<typeof memoryMetadata>) => Effect.Effect<void, unknown>) {
    const f = createFixtures(), alerts = memoryAlerts(initial), metadata = memoryMetadata()
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { alerts: alerts.store, metadata: metadata.store }))
        const native = platform(bot)
        yield* bot.ready()
        yield* bot.idle()
        yield* body(bot, native, alerts, metadata)
    })).pipe(Effect.provide(TestClock.layer())))
}
const join = (bot: Bot, userId: string, fields: { bot?: boolean, username?: string } = {}) =>
    bot.emit("GUILD_MEMBER_ADD", { ...bot.fixtures.member({ user: bot.fixtures.user({ id: userId, ...fields }), joined_at: new Date(0).toISOString() }), guild_id: bot.fixtures.ids.guild })
const update = (bot: Bot, userId: string, username: string, nick: string | null = null) =>
    bot.emit("GUILD_MEMBER_UPDATE", { ...bot.fixtures.member({ user: bot.fixtures.user({ id: userId, username }), nick }), guild_id: bot.fixtures.ids.guild })
const audit = (bot: Bot, id: string, action: number, target: string, changes: unknown[] = []) =>
    bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", { guild_id: bot.fixtures.ids.guild, id, action_type: action, user_id: adminId, target_id: target, changes })
const say = (bot: Bot, userId: string, content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ channel_id: channelId, content, author: bot.fixtures.user({ id: userId }) }))
const summary = (events: readonly MetadataLogsEvent[]) => events.map(event => ({ type: event.type, actor: event.actor, resourceIds: event.resourceIds, changedFields: event.changedFields, source: event.source.kind }))

test("with every alert off, members, audit entries and invites raise nothing and cost no backend call", async () => {
    await run({}, (bot, native, alerts, metadata) => Effect.gen(function* () {
        yield* join(bot, botAccountId, { bot: true })
        yield* join(bot, memberId, { username: "NeonAdmin" })
        yield* audit(bot, "7001", 31, native.plainRole.id, [{ key: "permissions", old_value: "0", new_value: "8" }])
        yield* bot.emit("INVITE_CREATE", rawInvite(bot, "SyntheticCode"))
        yield* bot.idle()
        assert.deepEqual(metadata.events, [])
        // The settings were read once when the server started
        assert.deepEqual(alerts.calls, ["get"])
        assert.equal(native.search.requests().length, 0)
    }))
})

test("a bot that joins raises an alert unless staff marked it expected", async () => {
    await run({ bots: true, expectedBotIds: ["6101"] }, (bot, _native, _alerts, metadata) => Effect.gen(function* () {
        yield* join(bot, botAccountId, { bot: true })
        yield* join(bot, "6101", { bot: true })
        yield* join(bot, memberId)
        yield* bot.idle()
        assert.deepEqual(summary(metadata.events), [{ type: "bot-join", actor: { kind: "unknown" }, resourceIds: [botAccountId], changedFields: [], source: "observation" }])
    }))
})

test("invite logs name the channel, the creator and missing limits, and never the invite code", async () => {
    await run({ invites: true }, (bot, _native, _alerts, metadata) => Effect.gen(function* () {
        yield* bot.emit("INVITE_CREATE", rawInvite(bot, "SyntheticCode"))
        yield* bot.emit("INVITE_CREATE", rawInvite(bot, "SyntheticLimited", { max_age: 3600, max_uses: 10, expires_at: "2026-01-01T01:00:00.000Z" }))
        // Different event types run in their own handlers, so the deletion waits for the creations
        yield* bot.idle()
        yield* bot.emit("INVITE_DELETE", { code: "SyntheticCode", channel_id: channelId, guild_id: bot.fixtures.ids.guild })
        yield* bot.idle()
        assert.deepEqual(summary(metadata.events), [
            { type: "invite-create", actor: { kind: "event", userId: memberId }, resourceIds: [channelId], changedFields: ["never-expires", "unlimited-uses"], source: "observation" },
            { type: "invite-create", actor: { kind: "event", userId: memberId }, resourceIds: [channelId], changedFields: [], source: "observation" },
            { type: "invite-delete", actor: { kind: "unknown" }, resourceIds: [channelId], changedFields: [], source: "observation" },
        ])
        assert.ok(!JSON.stringify(metadata.events).includes("Synthetic"))
    }))
})

test("privilege and webhook alerts come from audit entries and name the actor the entry names", async () => {
    await run({ privileges: true, webhooks: true, expectedWebhookIds: ["9002"] }, (bot, native, _alerts, metadata) => Effect.gen(function* () {
        // A role gaining Administrator and Ban Members, a role gaining only Send Messages, and a member given the moderator role
        yield* audit(bot, "7001", 31, native.plainRole.id, [{ key: "permissions", old_value: "2048", new_value: String(2048n | Permissions.Administrator | Permissions.BanMembers) }])
        yield* audit(bot, "7002", 31, native.plainRole.id, [{ key: "permissions", old_value: "0", new_value: "2048" }])
        yield* audit(bot, "7003", 25, memberId, [{ key: "$add", new_value: [native.modRole.id, native.plainRole.id] }])
        yield* audit(bot, "7004", 50, "9001")
        yield* audit(bot, "7005", 51, "9002")
        yield* bot.idle()
        const actor = { kind: "audit", userId: adminId }
        assert.deepEqual(summary(metadata.events), [
            { type: "privilege-change", actor, resourceIds: [native.plainRole.id], changedFields: ["role-permissions", "Administrator", "BanMembers"], source: "audit" },
            { type: "privilege-change", actor, resourceIds: [memberId, native.modRole.id], changedFields: ["member-roles", "BanMembers"], source: "audit" },
            { type: "webhook-change", actor, resourceIds: ["9001"], changedFields: ["created"], source: "audit" },
        ])
    }))
})

test("an entry that names gained permissions by name is read the same as a bitfield change", () => {
    assert.deepEqual(gainedPermissions([{ key: "permissions", newValue: { added: ["ADMINISTRATOR", "SEND_MESSAGES", "MANAGE_GUILD"], removed: [] } }]), ["Administrator", "ManageGuild"])
    assert.deepEqual(gainedPermissions([{ key: "name", oldValue: "a", newValue: "b" }]), [])
})

test("alerts are limited to ten at once per server, then one a minute, and staff can see how many were skipped", async () => {
    await run({ bots: true }, (bot, native, alerts, metadata) => Effect.gen(function* () {
        for (let index = 0; index < 12; index++) yield* join(bot, String(6200 + index), { bot: true })
        yield* bot.idle()
        assert.equal(metadata.events.length, 10)
        yield* TestClock.adjust("59 seconds")
        yield* join(bot, "6300", { bot: true })
        yield* bot.idle()
        assert.equal(metadata.events.length, 10)
        yield* TestClock.adjust("1 second")
        yield* join(bot, "6301", { bot: true })
        yield* bot.idle()
        assert.equal(metadata.events.length, 11)
        assert.deepEqual(metadata.events.at(-1)!.resourceIds, ["6301"])
        yield* say(bot, adminId, "!alerts status")
        yield* bot.idle()
        assert.ok(native.replies().at(-1)!.includes("Skipped by the rate limit: 3 alerts since NeonFlux started"))
        assert.equal(alerts.calls.filter(call => call === "get").length, 1)
    }))
})

test("a member whose name looks like the owner's or a staff member's raises one alert per name", async () => {
    await run({ impersonation: true }, (bot, native, _alerts, metadata) => Effect.gen(function* () {
        yield* join(bot, memberId, { username: "Ne0nAdmin" })
        yield* bot.idle()
        assert.deepEqual(summary(metadata.events), [{ type: "impersonation", actor: { kind: "unknown" }, resourceIds: [memberId, native.ownerId], changedFields: ["username"], source: "observation" }])
        // An update that keeps the name stays quiet, and a nickname like a staff member's display name raises a new alert
        yield* update(bot, memberId, "Ne0nAdmin")
        yield* update(bot, memberId, "Ne0nAdmin", "Kestrel Watch")
        yield* update(bot, "6002", "Alice")
        yield* bot.idle()
        assert.deepEqual(metadata.events.map(event => event.resourceIds), [[memberId, native.ownerId], [memberId, native.ownerId]])
        yield* join(bot, "6005", { username: "kestre1.watch" })
        yield* bot.idle()
        assert.deepEqual(metadata.events.at(-1)!.resourceIds, ["6005", modId])
        // The staff names were read once for all of these, one search for each of the three staff roles
        assert.equal(native.search.requests().length, 3)
    }))
})

test("lookalike names fold accents, digits and other scripts, while short or different names stay apart", () => {
    assert.equal(nameSkeleton("Ｎéοn_Аdmin"), "neonadmln")
    assert.ok(namesLookAlike("NeonAdmin", "Ne0n.Admin")); assert.ok(namesLookAlike("NeonAdmin", "NeonAdmn")); assert.ok(namesLookAlike("rnoderator", "moderator"))
    assert.ok(!namesLookAlike("Alex", "Alec")); assert.ok(!namesLookAlike("Al", "Al")); assert.ok(!namesLookAlike("NeonAdmin", "NeonFan"))
})

test("managers turn alerts on and mark bots expected in chat, which applies at once, and other members are refused", async () => {
    await run({}, (bot, native, alerts, metadata) => Effect.gen(function* () {
        yield* say(bot, memberId, "!alerts on bots")
        yield* bot.idle()
        assert.deepEqual(native.replies(), ["Only the server owner or members with Manage Server can manage security alerts and invites"])
        yield* say(bot, adminId, "!alerts on bots")
        yield* say(bot, adminId, `!alerts expect bot ${botAccountId}`)
        yield* bot.idle()
        assert.deepEqual(alerts.operations, [{ type: "set", alert: "bots", enabled: true }, { type: "expect", kind: "bot", id: botAccountId, expected: true }])
        yield* join(bot, botAccountId, { bot: true })
        yield* join(bot, "6101", { bot: true })
        yield* bot.idle()
        assert.deepEqual(metadata.events.map(event => event.resourceIds), [["6101"]])
        yield* say(bot, adminId, "!alerts off everything")
        yield* bot.idle()
        assert.equal(native.replies().at(-1), "Alerts are invites, bots, webhooks, privileges, impersonation or all")
    }))
})

const rawWebhook = (bot: Bot, id: string, name: string) => ({ id, guild_id: bot.fixtures.ids.guild, channel_id: channelId, type: 1, name, avatar: null })
const ask = (bot: Bot, native: ReturnType<typeof platform>, content: string) => say(bot, adminId, content).pipe(Effect.andThen(bot.idle()), Effect.andThen(Effect.sync(() => native.replies().at(-1)!)))

test("the alerts command takes expected with next, and a webhook by name", () => {
    assert.deepEqual([parseAlertsCommand(["expected"]), parseAlertsCommand(["expected", "next"]), parseAlertsCommand([])], [{ type: "expected" }, { type: "expected", next: true }, { type: "status" }])
    assert.deepEqual(parseAlertsCommand(["unexpect", "webhook", "Synthetic", "Feed"]), { type: "expect", kind: "webhook", name: "Synthetic Feed", expected: false })
    assert.deepEqual(parseAlertsCommand(["expect", "webhook", "9001"]), { type: "expect", kind: "webhook", id: "9001", expected: true })
    assert.deepEqual([parseAlertsCommand(["expect", "bot", "Synthetic"]), parseAlertsCommand(["expected", "2"])], [{ error: "Use the bot's mention or ID" }, { error: "Check the alerts command syntax. Use !alerts help" }])
})

test("alert status is a short summary, and the expected bots and webhooks page by ten with webhooks by name", async () => {
    const bots = Array.from({ length: 50 }, (_, index) => String(6500 + index)), hooks = Array.from({ length: 50 }, (_, index) => String(9100 + index))
    await run({ bots: true, invites: true, expectedBotIds: bots, expectedWebhookIds: hooks }, (bot, native) => Effect.gen(function* () {
        // NeonFlux reads every webhook but the last, which was deleted
        const list = bot.rest.respond("GET /guilds/:id/webhooks", { body: hooks.slice(0, -1).map((id, index) => rawWebhook(bot, id, `Synthetic Feed ${index}`)) })
        const status = yield* ask(bot, native, "!alerts")
        assert.equal(status, ["Security alerts", "2 of 5 alerts are on",
            "Alerts appear in the metadata log's security category, see `!logs metadata status`. `!alerts expected` lists the expected bots and webhooks",
            "On: Invites, Bots", "Off: Webhooks, Privileges, Impersonation", "Expected: 50 bots, 50 webhooks"].join("\n"))
        // With 50 bots and 50 webhooks expected, the summary still names no one and shows two commands
        assert.ok(!/\d{4}/.test(status) && status.match(/`!/g)!.length === 2)
        const pages = [yield* ask(bot, native, "!alerts expected")]
        for (let index = 0; index < 9; index++) pages.push(yield* ask(bot, native, "!alerts expected next"))
        const note = "They raise no alert. Stop expecting one with `!alerts unexpect bot <ID>` or `!alerts unexpect webhook <name>`"
        assert.deepEqual(pages[0]!.split("\n"), ["Expected bots and webhooks", ...bots.slice(0, 10).map(id => `Bot <@${id}>`), note, "Next: `!alerts expected next`"])
        assert.deepEqual(pages[5]!.split("\n").slice(1, 3), [`Webhook **Synthetic Feed 0** in <#${channelId}>`, `Webhook **Synthetic Feed 1** in <#${channelId}>`])
        // The last page has no next, and a webhook NeonFlux cannot find keeps its ID, which unexpect takes
        assert.deepEqual(pages[9]!.split("\n").slice(-2), ["Webhook `9149`, not found in this server", note])
        assert.ok(pages.every(page => page.split("\n").length <= 13 && page.match(/`!/g)!.length <= 3))
        assert.equal(list.requests().length, 5)
        assert.equal(yield* ask(bot, native, "!alerts expected next"), "There is no next page to show. Send !alerts expected to start the list again")
    }))
})

test("webhooks are marked expected by name, and without Manage Webhooks they show and take their ID", async () => {
    await run({ webhooks: true, expectedWebhookIds: ["9001"] }, (bot, native, alerts) => Effect.gen(function* () {
        const refused = bot.rest.respond("GET /guilds/:id/webhooks", { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Missing Permissions" } })
        assert.equal(yield* ask(bot, native, "!alerts expected"), "Expected bots and webhooks\nWebhook `9001`\n"
            + "They raise no alert. Stop expecting one with `!alerts unexpect bot <ID>` or `!alerts unexpect webhook <name>`. NeonFlux needs Manage Webhooks to show webhook names")
        assert.equal(yield* ask(bot, native, "!alerts unexpect webhook Synthetic Feed"), "NeonFlux needs Manage Webhooks to find a webhook by name. Use the webhook's ID instead")
        refused.remove()
        bot.rest.respond("GET /guilds/:id/webhooks", { body: [rawWebhook(bot, "9001", "Synthetic Feed"), rawWebhook(bot, "9002", "Synthetic Relay")] })
        assert.equal(yield* ask(bot, native, "!alerts expect webhook synthetic relay"), `Webhook **Synthetic Relay** in <#${channelId}> is marked expected. It raises no alert`)
        assert.equal(yield* ask(bot, native, "!alerts expect webhook Unknown Feed"), "This server has no webhook called Unknown Feed. Check the name or use the webhook's ID")
        assert.equal(yield* ask(bot, native, "!alerts unexpect webhook 9001"), "Webhook `9001` is no longer expected")
        assert.deepEqual(alerts.operations, [{ type: "expect", kind: "webhook", id: "9002", expected: true }, { type: "expect", kind: "webhook", id: "9001", expected: false }])
    }))
})

test("invite lists show references instead of codes, and revoking a reference deletes that invite", async () => {
    await run({}, (bot, native) => Effect.gen(function* () {
        yield* say(bot, adminId, "!invites list")
        yield* bot.idle()
        const list = native.replies().at(-1)!
        assert.ok(!list.includes("Synthetic"))
        const lines = list.split("\n")
        // Newest first, and an invite without limits is flagged once instead of repeating the missing limit
        assert.equal(lines[1], `${quoted("SyntheticNew")}: <#${channelId}>, by <@${memberId}>, 2 uses. Flagged: never expires, unlimited uses`)
        assert.equal(lines[2], `${quoted("SyntheticOld")}: <#${channelId}>, by <@${memberId}>, 2 of 5 uses, expires <t:1748822400:f>`)
        // One note explains the reference and the revoke step for the whole list
        assert.equal(lines.at(-1), "Each line starts with the invite's reference. Revoke one with `!invites revoke <reference>`")
        assert.equal(list.split("!invites revoke").length, 2)
        yield* say(bot, memberId, `!invites revoke ${inviteRef("SyntheticOld")}`)
        yield* say(bot, adminId, "!invites revoke 0000000000000000")
        yield* say(bot, adminId, `!invites revoke ${inviteRef("SyntheticOld")}`)
        yield* bot.idle()
        assert.deepEqual(native.deleted(), ["SyntheticOld"])
        assert.deepEqual(native.replies().slice(-3), ["Only the server owner or members with Manage Server can manage security alerts and invites",
            "No current invite has that reference. Check `!invites list`", `Invite ${quoted("SyntheticOld")} revoked. Members who joined with it stay`])
    }))
})

test("invite lists continue with next, and a page number is not a form of the command", async () => {
    await run({}, (bot, native) => Effect.gen(function* () {
        native.invites.remove()
        const twelve = bot.rest.respond("GET /guilds/:id/invites", { body: Array.from({ length: 12 }, (_, index) => rawInvite(bot, `SyntheticCode${index}`, { created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` })) })
        const refs = (reply: string) => reply.split("\n").map(line => line.split(":")[0])
        yield* say(bot, adminId, "!invites list")
        yield* bot.idle()
        const first = native.replies().at(-1)!.split("\n")
        assert.deepEqual([first[0], first[1]!.split(":")[0], first.length, first.at(-1)], ["Invites", quoted("SyntheticCode11"), 13, "Next: `!invites list next`"])
        yield* say(bot, adminId, "!invites list next")
        yield* bot.idle()
        assert.deepEqual(refs(native.replies().at(-1)!), ["Invites", quoted("SyntheticCode1"), quoted("SyntheticCode0"), "Each line starts with the invite's reference. Revoke one with `!invites revoke <reference>`"])
        yield* say(bot, adminId, "!invites list next")
        yield* say(bot, adminId, "!invites list 2")
        yield* bot.idle()
        assert.deepEqual(native.replies().slice(-2), ["There is no next page to show. Send !invites list to start the list again", "Check the invites command syntax. Use !invites help"])
        // A server without invites gets the same card
        twelve.remove()
        bot.rest.respond("GET /guilds/:id/invites", { body: [] })
        yield* say(bot, adminId, "!invites list")
        yield* bot.idle()
        assert.equal(native.replies().at(-1), "Invites\nNo invites yet. A vanity link is not listed")
    }))
})

test("a dashboard invite revocation deletes the invite and hands the backend the rest without codes, then alert changes reload", async t => {
    let jobs: DashboardConfigurationReadyJob[] = []
    const executed: unknown[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        assert.equal(call.path, "/dashboard-configuration/execute")
        executed.push(call.body)
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    await run({}, (bot, native, alerts) => Effect.gen(function* () {
        const f = bot.fixtures, config = { token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") } }
        bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
        bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
        const job = { native: {}, id: "synthetic_alerts_job", actorId: adminId, expectedConfigRevision: 0, state: "queued" as const, createdAt: 0, expiresAt: 120000 }
        jobs = [{ ...job, family: "alerts", operation: { type: "invite-revoke", ref: inviteRef("SyntheticOld") } }]
        yield* processDashboardConfigurationPass(config, bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1])
        assert.deepEqual(native.deleted(), ["SyntheticOld"])
        const context = (executed[0] as { context: { invites: AlertInvite[], more: boolean } }).context
        assert.deepEqual(context, { invites: [{ ref: inviteRef("SyntheticNew"), channelId, inviterId: memberId, uses: 2, maxUses: 0, expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", temporary: false }], more: false })
        assert.ok(!JSON.stringify(executed).includes("Synthetic"))
        // An applied settings change reads the settings again, so it applies without a restart
        jobs = [{ ...job, family: "alerts", operation: { type: "set", alert: "bots", enabled: true } }]
        yield* processDashboardConfigurationPass(config, bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1])
        assert.deepEqual(alerts.calls, ["get", "get"])
    }))
})
