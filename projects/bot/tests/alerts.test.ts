import assert from "node:assert/strict"
import test from "node:test"
import type {
    AlertActionOutcome,
    AlertInvite,
    AlertSettings,
    AlertsActionClaimRequest,
    AlertsOperation,
} from "@neonflux/contracts/alerts"
import type { MetadataLogsEvent, MetadataLogsRecord } from "@neonflux/contracts/metadata-logs"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Fiber, Option, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import type { AlertsStore } from "../src/alerts-store.ts"
import type { MetadataLogsStore } from "../src/metadata-log-store.ts"
import { parseAlertsCommand, parseInvitesCommand } from "../src/alerts-command.ts"
import { inviteRef } from "../src/alerts-management.ts"
import { gainedPermissions, shownInviteCode } from "../src/alerts-worker.ts"
import { nameSkeleton, namesLookAlike } from "../src/alerts-names.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { claimed, mockBackend } from "./backend-fake.ts"

const token = Redacted.make("synthetic-alerts-test-token")
const memberId = "6001",
    adminId = "6003",
    modId = "6004",
    botAccountId = "6100",
    higherBotId = "6150",
    managerId = "6007",
    channelId = "5001"
/** An invite code as replies show it, in inline code */
const quoted = (code: string) => `\`${code}\``
const off: AlertSettings = {
    invites: false,
    bots: false,
    webhooks: false,
    privileges: false,
    impersonation: false,
    kickBots: false,
    deleteWebhooks: false,
    removePermissions: false,
    expectedBotIds: [],
    expectedWebhookIds: [],
}
const alertOf = { kickBots: "bots", deleteWebhooks: "webhooks", removePermissions: "privileges" } as const

/** The backend's alert settings and action claims in memory, with the backend's claim rules */
function memoryAlerts(initial: Partial<AlertSettings>) {
    let settings: AlertSettings = { ...off, ...initial }
    const calls: string[] = [],
        operations: AlertsOperation[] = [],
        claims: AlertsActionClaimRequest[] = [],
        outcomes: [string, AlertActionOutcome][] = []
    const pending = new Map<string, boolean>()
    let observed = 0
    const store: AlertsStore = {
        get: () =>
            Effect.sync(() => {
                calls.push("get")
                return { settings }
            }),
        manage: (input) =>
            Effect.sync(() => {
                calls.push("manage")
                operations.push(input.operation)
                const op = input.operation
                if (op.type === "set") settings = { ...settings, [op.alert]: op.enabled }
                else if (op.type === "action") settings = { ...settings, [op.action]: op.enabled }
                else {
                    const key = op.kind === "bot" ? "expectedBotIds" : "expectedWebhookIds"
                    settings = {
                        ...settings,
                        [key]: [...settings[key].filter((id) => !op.ids.includes(id)), ...(op.expected ? op.ids : [])],
                    }
                }
                return { settings }
            }),
        claimAction: (input) =>
            Effect.sync(() => {
                claims.push(input)
                const expected = (id?: string) => id !== undefined && settings.expectedBotIds.includes(id)
                if (
                    pending.has(input.key) ||
                    !settings[input.action] ||
                    !settings[alertOf[input.action]] ||
                    expected(input.actorId) ||
                    (input.action === "kickBots" && expected(input.targetId))
                )
                    return { claimed: false }
                pending.set(input.key, true)
                return { claimed: true }
            }),
        actionOutcome: (input) =>
            Effect.sync(() => {
                if (!pending.get(input.key)) return { recorded: false, admitted: false }
                pending.set(input.key, false)
                outcomes.push([input.key, input.outcome])
                return { recorded: true, admitted: true }
            }),
        observeActions: () =>
            Effect.sync(() => {
                observed++
                return { uncertain: 0, admitted: false }
            }),
    }
    return { store, calls, operations, claims, outcomes, observed: () => observed, settings: () => settings }
}
/** Metadata admission that keeps the security events it receives */
// Records every alert it is sent, and answers that metadata logs are off once disabled is set
function memoryMetadata() {
    const events: MetadataLogsEvent[] = []
    const state = { disabled: false }
    const store = {
        admit: (input) =>
            Effect.sync(() => {
                if (input.event.category === "security") events.push(input.event)
                return state.disabled
                    ? ({ admitted: false, duplicate: false, reason: "disabled" } as const)
                    : ({ admitted: true, duplicate: false, record: {} as MetadataLogsRecord } as const)
            }),
        work: () => Effect.succeed({ type: "work", records: [] }),
    } as Pick<MetadataLogsStore, "admit" | "work"> as MetadataLogsStore
    return { store, events, state }
}

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const segment = (path: string, index: number) => path.split("/")[index]!
const rawInvite = (bot: Bot, code: string, fields: Record<string, unknown> = {}) => ({
    code,
    type: 0,
    channel: { id: channelId, type: 0 },
    guild: { id: bot.fixtures.ids.guild, name: "Synthetic server" },
    presence_count: 1,
    member_count: 2,
    temporary: false,
    inviter: bot.fixtures.user({ id: memberId }),
    created_at: "2026-01-01T00:00:00.000Z",
    uses: 2,
    max_uses: 0,
    max_age: 0,
    expires_at: null,
    ...fields,
})
function platform(bot: Bot) {
    const f = bot.fixtures,
        ownerId = f.ids.user
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() }),
        adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    const modRole = f.role({ position: 8, permissions: Permissions.BanMembers.toString() }),
        plainRole = f.role({ position: 2, permissions: Permissions.SendMessages.toString() })
    // A bot role above NeonFlux's, a Manage community role without Administrator, and a role that holds Administrator and
    // Ban members besides Send messages
    const managerRole = f.role({ position: 9, permissions: Permissions.ManageGuild.toString() })
    const highRole = f.role({ position: 30, permissions: Permissions.SendMessages.toString() }),
        gainedRole = f.role({
            position: 3,
            permissions: (Permissions.SendMessages | Permissions.Administrator | Permissions.BanMembers).toString(),
        })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: ownerId }) })
    const roles = [
        f.role({ id: f.ids.guild, permissions: "0" }),
        botRole,
        adminRole,
        managerRole,
        modRole,
        plainRole,
        highRole,
        gainedRole,
    ]
    bot.rest.respond("GET /guilds/:id/roles", { body: roles })
    // Accounts from 6100 to 6199 are bots
    bot.rest.respond("GET /users/:id", (request) => {
        const id = segment(request.path, 2)
        return { body: f.user({ id, bot: id.startsWith("61"), system: false }) }
    })
    const kicks = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 }),
        webhookDeletes = bot.rest.respond("DELETE /webhooks/:id", { status: 204 }),
        roleEdits = bot.rest.respond("PATCH /guilds/:id/roles/:id", (request) => ({
            body: { ...gainedRole, ...(request.body as object) },
        }))
    bot.rest.respond("GET /guilds/:id/members/:id", (request) => {
        const userId = segment(request.path, 4)
        return {
            body: f.member({
                user:
                    userId === f.ids.bot
                        ? f.botUser()
                        : f.user({ id: userId, username: userId === ownerId ? "NeonAdmin" : `member${userId}` }),
                roles:
                    userId === f.ids.bot
                        ? [botRole.id]
                        : userId === adminId
                          ? [adminRole.id]
                          : userId === higherBotId
                            ? [highRole.id]
                            : userId === managerId
                              ? [managerRole.id]
                              : [],
            }),
        }
    })
    bot.rest.respond("GET /channels/:id", (request) => ({ body: f.channel({ id: segment(request.path, 2), type: 0 }) }))
    const search = bot.rest.respond("POST /guilds/:id/members-search", {
        body: {
            guild_id: f.ids.guild,
            page_result_count: 1,
            total_result_count: 1,
            indexing: false,
            members: [
                {
                    guild_id: f.ids.guild,
                    user_id: modId,
                    username: "moderator",
                    discriminator: "0001",
                    global_name: "Kestrel Watch",
                    nickname: null,
                    role_ids: [modRole.id],
                    joined_at: 1,
                    is_bot: false,
                    supplemental: { inviter_id: null, source_invite_code: null },
                },
            ],
        },
    })
    const invites = bot.rest.respond("GET /guilds/:id/invites", {
        body: [
            rawInvite(bot, "SyntheticOld", {
                created_at: "2025-06-01T00:00:00.000Z",
                max_age: 86400,
                expires_at: "2025-06-02T00:00:00.000Z",
                max_uses: 5,
            }),
            rawInvite(bot, "SyntheticNew"),
        ],
    })
    const deleted = bot.rest.respond("DELETE /invites/:code", { status: 204 })
    let next = 1000
    const messages = bot.rest.respond("POST /channels/:id/messages", (request) => ({
        body: f.message({
            id: String(++next),
            channel_id: segment(request.path, 2),
            author: f.botUser(),
            content: (request.body as { content?: string }).content ?? "",
        }),
    }))
    return {
        ownerId,
        roles,
        botRole,
        modRole,
        plainRole,
        gainedRole,
        kicks,
        webhookDeletes,
        roleEdits,
        search,
        invites,
        deleted: () => deleted.requests().map((request) => decodeURIComponent(segment(request.path, 2))),
        // A card reads as its title, description and one line per field
        replies: () =>
            messages.requests().map((request) => {
                const { content, embeds } = request.body as {
                    content?: string
                    embeds?: { title: string; description?: string; fields?: { name: string; value: string }[] }[]
                }
                return (
                    content ??
                    embeds!
                        .map((e) =>
                            [
                                e.title,
                                ...(e.description ? [e.description] : []),
                                ...(e.fields ?? []).map((x) => `${x.name}: ${x.value}`),
                            ].join("\n"),
                        )
                        .join("\n")
                )
            }),
    }
}
function run(
    initial: Partial<AlertSettings>,
    body: (
        bot: Bot,
        native: ReturnType<typeof platform>,
        alerts: ReturnType<typeof memoryAlerts>,
        metadata: ReturnType<typeof memoryMetadata>,
    ) => Effect.Effect<void, unknown>,
) {
    const f = createFixtures(),
        alerts = memoryAlerts(initial),
        metadata = memoryMetadata()
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { alerts: alerts.store, metadata: metadata.store },
                    ),
                )
                const native = platform(bot)
                yield* bot.ready()
                yield* bot.idle()
                yield* body(bot, native, alerts, metadata)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
}
const join = (bot: Bot, userId: string, fields: { bot?: boolean; username?: string } = {}) =>
    bot.emit("GUILD_MEMBER_ADD", {
        ...bot.fixtures.member({
            user: bot.fixtures.user({ id: userId, ...fields }),
            joined_at: new Date(0).toISOString(),
        }),
        guild_id: bot.fixtures.ids.guild,
    })
const update = (bot: Bot, userId: string, username: string, nick: string | null = null) =>
    bot.emit("GUILD_MEMBER_UPDATE", {
        ...bot.fixtures.member({ user: bot.fixtures.user({ id: userId, username }), nick }),
        guild_id: bot.fixtures.ids.guild,
    })
const audit = (bot: Bot, id: string, action: number, target: string, changes: unknown[] = [], userId = adminId) =>
    bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
        guild_id: bot.fixtures.ids.guild,
        id,
        action_type: action,
        user_id: userId,
        target_id: target,
        changes,
    })
const say = (bot: Bot, userId: string, content: string) =>
    bot.emit(
        "MESSAGE_CREATE",
        bot.fixtures.message({ channel_id: channelId, content, author: bot.fixtures.user({ id: userId }) }),
    )
const summary = (events: readonly MetadataLogsEvent[]) =>
    events.map((event) => ({
        type: event.type,
        actor: event.actor,
        resourceIds: event.resourceIds,
        changedFields: event.changedFields,
        source: event.source.kind,
        ...(event.details ? { details: event.details } : {}),
    }))

test("with every alert off, members, audit entries and invites raise nothing and cost no backend call", async () => {
    await run({}, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            yield* join(bot, botAccountId, { bot: true })
            yield* join(bot, memberId, { username: "NeonAdmin" })
            yield* audit(bot, "7001", 31, native.plainRole.id, [{ key: "permissions", old_value: "0", new_value: "8" }])
            yield* bot.emit("INVITE_CREATE", rawInvite(bot, "SyntheticCode"))
            yield* bot.idle()
            assert.deepEqual(metadata.events, [])
            // The settings were read once when the server started, and unfinished actions were checked once
            assert.deepEqual(alerts.calls, ["get"])
            assert.equal(alerts.observed(), 1)
            assert.equal(native.search.requests().length, 0)
        }),
    )
})

test("a bot that joins raises an alert unless staff marked it expected", async () => {
    await run({ bots: true, expectedBotIds: ["6101"] }, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            yield* join(bot, botAccountId, { bot: true })
            yield* join(bot, "6101", { bot: true })
            yield* join(bot, memberId)
            yield* bot.idle()
            // With its action off, the alert only reports
            assert.deepEqual([alerts.claims, native.kicks.requests().length], [[], 0])
            assert.deepEqual(summary(metadata.events), [
                {
                    type: "bot-join",
                    actor: { kind: "unknown" },
                    resourceIds: [botAccountId],
                    changedFields: [],
                    source: "observation",
                },
            ])
        }),
    )
})

test("invite logs name the code, the channel, the creator and missing limits", async () => {
    await run({ invites: true }, (bot, _native, _alerts, metadata) =>
        Effect.gen(function* () {
            yield* bot.emit("INVITE_CREATE", rawInvite(bot, "SyntheticCode"))
            yield* bot.emit(
                "INVITE_CREATE",
                rawInvite(bot, "SyntheticLimited", {
                    max_age: 3600,
                    max_uses: 10,
                    expires_at: "2026-01-01T01:00:00.000Z",
                }),
            )
            // Different event types run in their own handlers, so the deletion waits for the creations
            yield* bot.idle()
            yield* bot.emit("INVITE_DELETE", {
                code: "SyntheticCode",
                channel_id: channelId,
                guild_id: bot.fixtures.ids.guild,
            })
            yield* bot.idle()
            assert.deepEqual(summary(metadata.events), [
                {
                    type: "invite-create",
                    actor: { kind: "event", userId: memberId },
                    resourceIds: [channelId],
                    changedFields: ["never-expires", "unlimited-uses"],
                    source: "observation",
                    details: { inviteCode: "SyntheticCode" },
                },
                {
                    type: "invite-create",
                    actor: { kind: "event", userId: memberId },
                    resourceIds: [channelId],
                    changedFields: [],
                    source: "observation",
                    details: { inviteCode: "SyntheticLimited" },
                },
                {
                    type: "invite-delete",
                    actor: { kind: "unknown" },
                    resourceIds: [channelId],
                    changedFields: [],
                    source: "observation",
                    details: { inviteCode: "SyntheticCode" },
                },
            ])
        }),
    )
})

test("privilege and webhook alerts come from audit entries and name the actor the entry names", async () => {
    await run({ privileges: true, webhooks: true, expectedWebhookIds: ["9002"] }, (bot, native, _alerts, metadata) =>
        Effect.gen(function* () {
            // A role gaining Administrator and Ban members, a role gaining only Send messages, and a member given the moderator role
            yield* audit(bot, "7001", 31, native.plainRole.id, [
                {
                    key: "permissions",
                    old_value: "2048",
                    new_value: String(2048n | Permissions.Administrator | Permissions.BanMembers),
                },
            ])
            yield* audit(bot, "7002", 31, native.plainRole.id, [
                { key: "permissions", old_value: "0", new_value: "2048" },
            ])
            // Fluxer's member role entries carry the member's roles before and after
            yield* audit(bot, "7003", 25, memberId, [
                { key: "roles", old_value: [], new_value: [native.modRole.id, native.plainRole.id] },
            ])
            yield* audit(bot, "7006", 25, memberId, [
                { key: "roles", old_value: [native.plainRole.id], new_value: [native.plainRole.id, native.modRole.id] },
            ])
            yield* audit(bot, "7004", 50, "9001")
            yield* audit(bot, "7005", 51, "9002")
            yield* bot.idle()
            const actor = { kind: "audit", userId: adminId }
            assert.deepEqual(summary(metadata.events), [
                {
                    type: "privilege-change",
                    actor,
                    resourceIds: [native.plainRole.id],
                    changedFields: ["role-permissions", "Administrator", "BanMembers"],
                    source: "audit",
                },
                {
                    type: "privilege-change",
                    actor,
                    resourceIds: [memberId, native.modRole.id],
                    changedFields: ["member-roles", "BanMembers"],
                    source: "audit",
                },
                {
                    type: "privilege-change",
                    actor,
                    resourceIds: [memberId, native.modRole.id],
                    changedFields: ["member-roles", "BanMembers"],
                    source: "audit",
                },
                { type: "webhook-change", actor, resourceIds: ["9001"], changedFields: ["created"], source: "audit" },
            ])
        }),
    )
})

test("a member given more than 19 dangerous roles at once is reported with the permissions of every role", async () => {
    await run({ privileges: true }, (bot, native, _alerts, metadata) =>
        Effect.gen(function* () {
            const f = bot.fixtures
            // 19 roles with Ban members, then one with only Manage webhooks, past the 19 roles a record lists
            const banRoles = Array.from({ length: 19 }, () =>
                    f.role({ position: 4, permissions: Permissions.BanMembers.toString() }),
                ),
                webhookRole = f.role({ position: 4, permissions: Permissions.ManageWebhooks.toString() })
            bot.rest.respond("GET /guilds/:id/roles", { body: [...native.roles, ...banRoles, webhookRole] })
            yield* audit(bot, "7010", 25, memberId, [
                { key: "roles", old_value: [], new_value: [...banRoles, webhookRole].map((role) => role.id) },
            ])
            yield* bot.idle()
            assert.deepEqual(summary(metadata.events), [
                {
                    type: "privilege-change",
                    actor: { kind: "audit", userId: adminId },
                    resourceIds: [memberId, ...banRoles.map((role) => role.id)],
                    changedFields: ["member-roles", "ManageWebhooks", "BanMembers"],
                    source: "audit",
                },
            ])
        }),
    )
})

test("an entry that names gained permissions by name is read the same as a bitfield change", () => {
    assert.deepEqual(
        gainedPermissions([
            {
                key: "permissions",
                newValue: { added: ["ADMINISTRATOR", "SEND_MESSAGES", "MANAGE_GUILD"], removed: [] },
            },
        ]),
        ["Administrator", "ManageGuild"],
    )
    assert.deepEqual(gainedPermissions([{ key: "name", oldValue: "a", newValue: "b" }]), [])
})

test("every alert in a burst is its own record, and status shows no skipped count", async () => {
    await run({ bots: true }, (bot, native, _alerts, metadata) =>
        Effect.gen(function* () {
            for (let index = 0; index < 30; index++) yield* join(bot, String(6200 + index), { bot: true })
            yield* bot.idle()
            assert.deepEqual(
                metadata.events.map((event) => event.resourceIds[0]),
                Array.from({ length: 30 }, (_, index) => String(6200 + index)),
            )
            yield* say(bot, adminId, "!alerts status")
            yield* bot.idle()
            assert.ok(!native.replies().at(-1)!.includes("Skipped"))
        }),
    )
})

test("a member whose name looks like the owner's or a staff member's raises one alert per name", async () => {
    await run({ impersonation: true }, (bot, native, _alerts, metadata) =>
        Effect.gen(function* () {
            yield* join(bot, memberId, { username: "Ne0nAdmin" })
            yield* bot.idle()
            assert.deepEqual(summary(metadata.events), [
                {
                    type: "impersonation",
                    actor: { kind: "unknown" },
                    resourceIds: [memberId, native.ownerId],
                    changedFields: ["username"],
                    source: "observation",
                },
            ])
            // An update that keeps the name stays quiet, and a nickname like a staff member's display name raises a new alert
            yield* update(bot, memberId, "Ne0nAdmin")
            yield* update(bot, memberId, "Ne0nAdmin", "Kestrel Watch")
            yield* update(bot, "6002", "Alice")
            yield* bot.idle()
            assert.deepEqual(
                metadata.events.map((event) => event.resourceIds),
                [
                    [memberId, native.ownerId],
                    [memberId, native.ownerId],
                ],
            )
            yield* join(bot, "6005", { username: "kestre1.watch" })
            yield* bot.idle()
            assert.deepEqual(metadata.events.at(-1)!.resourceIds, ["6005", modId])
            // The staff names were read once for all of these, one search for each of the five staff roles
            assert.equal(native.search.requests().length, 5)
        }),
    )
})

test("impersonation covers every staff role and every member of each, over several refreshes for a very large staff", async () => {
    await run({ impersonation: true }, (bot, native, _alerts, metadata) =>
        Effect.gen(function* () {
            const f = bot.fixtures
            // A sixth staff role, the lowest, beside the five the platform has
            const sixthRole = f.role({ position: 1, permissions: Permissions.KickMembers.toString() })
            bot.rest.respond("GET /guilds/:id/roles", { body: [...native.roles, sixthRole] })
            // The moderator role has 2,000 members, so reading it takes 20 pages of 100
            const hit = (userId: string, username: string, roleId: string) => ({
                guild_id: f.ids.guild,
                user_id: userId,
                username,
                discriminator: "0001",
                global_name: null,
                nickname: null,
                role_ids: [roleId],
                joined_at: 1,
                is_bot: false,
                supplemental: { inviter_id: null, source_invite_code: null },
            })
            const members = new Map([
                [
                    native.modRole.id,
                    Array.from({ length: 2000 }, (_, index) =>
                        hit(
                            String(7000000 + index),
                            index === 150 ? "Ospreyline" : `modmember${index}`,
                            native.modRole.id,
                        ),
                    ),
                ],
                [sixthRole.id, [hit("7100000", "Harrierwatch", sixthRole.id)]],
            ])
            const search = bot.rest.respond("POST /guilds/:id/members-search", (request) => {
                const { role_ids, limit, offset } = request.body as {
                    role_ids: string[]
                    limit: number
                    offset: number
                }
                const all = members.get(role_ids[0]!) ?? []
                const page = all.slice(offset, offset + limit)
                return {
                    body: {
                        guild_id: f.ids.guild,
                        page_result_count: page.length,
                        total_result_count: all.length,
                        indexing: false,
                        members: page,
                    },
                }
            })
            // Member 151 of the moderator role is on its second page, which the first refresh reads
            yield* join(bot, "6010", { username: "0spreyline" })
            yield* bot.idle()
            assert.deepEqual(metadata.events.at(-1)?.resourceIds, ["6010", "7000150"])
            // The first refresh stops after 20 pages, before the sixth role
            yield* join(bot, "6011", { username: "Harrierwatcn" })
            yield* bot.idle()
            assert.equal(metadata.events.length, 1)
            assert.equal(search.requests().length, 20)
            // Ten minutes later the next refresh finishes the moderator role and reads the rest, keeping what it found
            yield* TestClock.adjust("10 minutes")
            yield* update(bot, "6011", "Harrierwatcn")
            yield* bot.idle()
            assert.deepEqual(metadata.events.at(-1)?.resourceIds, ["6011", "7100000"])
            yield* update(bot, "6012", "0spreyl1ne")
            yield* bot.idle()
            assert.deepEqual(metadata.events.at(-1)?.resourceIds, ["6012", "7000150"])
            // Each role starts at offset 0, and the moderator role goes on at 1,700 in the second refresh
            assert.deepEqual(
                search.requests().map((request) => (request.body as { offset: number }).offset),
                [0, 0, 0, ...Array.from({ length: 20 }, (_, index) => index * 100), 0, 0],
            )
        }),
    )
})

test("lookalike names fold accents, digits and other scripts, while short or different names stay apart", () => {
    assert.equal(nameSkeleton("Ｎéοn_Аdmin"), "neonadmln")
    assert.ok(namesLookAlike("NeonAdmin", "Ne0n.Admin"))
    assert.ok(namesLookAlike("NeonAdmin", "NeonAdmn"))
    assert.ok(namesLookAlike("rnoderator", "moderator"))
    assert.ok(!namesLookAlike("Alex", "Alec"))
    assert.ok(!namesLookAlike("Al", "Al"))
    assert.ok(!namesLookAlike("NeonAdmin", "NeonFan"))
})

test("managers turn alerts on and mark bots expected in chat, which applies at once, and other members are refused", async () => {
    await run({}, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            yield* say(bot, memberId, "!alerts on bots")
            yield* bot.idle()
            assert.deepEqual(native.replies(), [
                "Only the server owner or members with Manage community can manage security alerts and invites",
            ])
            yield* say(bot, adminId, "!alerts on bots")
            yield* say(bot, adminId, `!alerts expect bot ${botAccountId}`)
            yield* bot.idle()
            assert.deepEqual(alerts.operations, [
                { type: "set", alert: "bots", enabled: true },
                { type: "expect", kind: "bot", ids: [botAccountId], expected: true },
            ])
            yield* join(bot, botAccountId, { bot: true })
            yield* join(bot, "6101", { bot: true })
            yield* bot.idle()
            assert.deepEqual(
                metadata.events.map((event) => event.resourceIds),
                [["6101"]],
            )
            yield* say(bot, adminId, "!alerts off everything")
            yield* bot.idle()
            assert.equal(
                native.replies().at(-1),
                "Alerts are invites, bots, webhooks, privileges, impersonation or all",
            )
        }),
    )
})

const rawWebhook = (bot: Bot, id: string, name: string) => ({
    id,
    guild_id: bot.fixtures.ids.guild,
    channel_id: channelId,
    type: 1,
    name,
    avatar: null,
})
const ask = (bot: Bot, native: ReturnType<typeof platform>, content: string) =>
    say(bot, adminId, content).pipe(
        Effect.andThen(bot.idle()),
        Effect.andThen(Effect.sync(() => native.replies().at(-1)!)),
    )

test("the alerts command takes expected with next, and a webhook by name", () => {
    assert.deepEqual(
        [parseAlertsCommand(["expected"]), parseAlertsCommand(["expected", "next"]), parseAlertsCommand([])],
        [{ type: "expected" }, { type: "expected", next: true }, { type: "status" }],
    )
    assert.deepEqual(parseAlertsCommand(["unexpect", "webhook", "Synthetic", "Feed"]), {
        type: "expect",
        kind: "webhook",
        name: "Synthetic Feed",
        expected: false,
    })
    assert.deepEqual(parseAlertsCommand(["expect", "webhook", "9001"]), {
        type: "expect",
        kind: "webhook",
        ids: ["9001"],
        expected: true,
    })
    // Several IDs or mentions, apart or split by commas, are one change, each ID once
    assert.deepEqual(parseAlertsCommand(["unexpect", "bot", "<@6101>,6102", "6103", "6101"]), {
        type: "expect",
        kind: "bot",
        ids: ["6101", "6102", "6103"],
        expected: false,
    })
    assert.deepEqual(parseAlertsCommand(["expect", "bot", "6101", "Synthetic"]), {
        error: "Use the bot's mention or ID",
    })
    assert.deepEqual(
        [parseAlertsCommand(["expect", "bot", "Synthetic"]), parseAlertsCommand(["expected", "2"])],
        [{ error: "Use the bot's mention or ID" }, { error: "Check the alerts command syntax. Use !alerts help" }],
    )
})

test("alert status is a short summary, and the expected bots and webhooks page by ten with webhooks by name", async () => {
    const bots = Array.from({ length: 50 }, (_, index) => String(6500 + index)),
        hooks = Array.from({ length: 50 }, (_, index) => String(9100 + index))
    await run({ bots: true, invites: true, expectedBotIds: bots, expectedWebhookIds: hooks }, (bot, native) =>
        Effect.gen(function* () {
            // NeonFlux reads every webhook but the last, which was deleted
            const list = bot.rest.respond("GET /guilds/:id/webhooks", {
                body: hooks.slice(0, -1).map((id, index) => rawWebhook(bot, id, `Synthetic Feed ${index}`)),
            })
            const status = yield* ask(bot, native, "!alerts")
            assert.equal(
                status,
                [
                    "Security alerts",
                    "2 of 5 alerts are on",
                    "Alerts appear in the metadata log's security category, see `!logs metadata status`. `!alerts expected` lists the expected bots and webhooks",
                    "On: Invites, Bots",
                    "Off: Webhooks, Privileges, Impersonation",
                    "Expected: 50 bots, 50 webhooks",
                    "Actions: kick unexpected bots off, delete unexpected webhooks off, remove gained permissions off",
                ].join("\n"),
            )
            // With 50 bots and 50 webhooks expected, the summary still names no one and shows two commands
            assert.ok(!/\d{4}/.test(status) && status.match(/`!/g)!.length === 2)
            const pages = [yield* ask(bot, native, "!alerts expected")]
            for (let index = 0; index < 9; index++) pages.push(yield* ask(bot, native, "!alerts expected next"))
            const note =
                "They raise no alert. Stop expecting one with `!alerts unexpect bot <ID>` or `!alerts unexpect webhook <name>`"
            assert.deepEqual(pages[0]!.split("\n"), [
                "Expected bots and webhooks",
                ...bots.slice(0, 10).map((id) => `Bot <@${id}>`),
                note,
                "Next: `!alerts expected next`",
            ])
            assert.deepEqual(pages[5]!.split("\n").slice(1, 3), [
                `Webhook **Synthetic Feed 0** in <#${channelId}>`,
                `Webhook **Synthetic Feed 1** in <#${channelId}>`,
            ])
            // The last page has no next, and a webhook NeonFlux cannot find keeps its ID, which unexpect takes
            assert.deepEqual(pages[9]!.split("\n").slice(-2), ["Webhook `9149`, not found in this server", note])
            assert.ok(pages.every((page) => page.split("\n").length <= 13 && page.match(/`!/g)!.length <= 3))
            assert.equal(list.requests().length, 5)
            assert.equal(
                yield* ask(bot, native, "!alerts expected next"),
                "There is no next page to show. Send !alerts expected to start the list again",
            )
        }),
    )
})

test("webhooks are marked expected by name, and without Manage webhooks they show and take their ID", async () => {
    await run({ webhooks: true, expectedWebhookIds: ["9001"] }, (bot, native, alerts) =>
        Effect.gen(function* () {
            const refused = bot.rest.respond("GET /guilds/:id/webhooks", {
                status: 403,
                body: { code: "MISSING_PERMISSIONS", message: "Missing Permissions" },
            })
            assert.equal(
                yield* ask(bot, native, "!alerts expected"),
                "Expected bots and webhooks\nWebhook `9001`\n" +
                    "They raise no alert. Stop expecting one with `!alerts unexpect bot <ID>` or `!alerts unexpect webhook <name>`. NeonFlux needs Manage webhooks to show webhook names",
            )
            assert.equal(
                yield* ask(bot, native, "!alerts unexpect webhook Synthetic Feed"),
                "NeonFlux needs Manage webhooks to find a webhook by name. Use the webhook's ID instead",
            )
            refused.remove()
            bot.rest.respond("GET /guilds/:id/webhooks", {
                body: [rawWebhook(bot, "9001", "Synthetic Feed"), rawWebhook(bot, "9002", "Synthetic Relay")],
            })
            assert.equal(
                yield* ask(bot, native, "!alerts expect webhook synthetic relay"),
                `Webhook **Synthetic Relay** in <#${channelId}> is marked expected. It raises no alert`,
            )
            assert.equal(
                yield* ask(bot, native, "!alerts expect webhook Unknown Feed"),
                "This server has no webhook called Unknown Feed. Check the name or use the webhook's ID",
            )
            assert.equal(
                yield* ask(bot, native, "!alerts unexpect webhook 9001"),
                "Webhook `9001` is no longer expected",
            )
            assert.equal(
                yield* ask(bot, native, "!alerts expect webhook 9003, 9004 9005"),
                "3 webhooks are marked expected. They raise no alert",
            )
            assert.equal(
                yield* ask(bot, native, "!alerts unexpect webhook 9003 9005"),
                "2 webhooks are no longer expected",
            )
            assert.deepEqual(alerts.operations, [
                { type: "expect", kind: "webhook", ids: ["9002"], expected: true },
                { type: "expect", kind: "webhook", ids: ["9001"], expected: false },
                { type: "expect", kind: "webhook", ids: ["9003", "9004", "9005"], expected: true },
                { type: "expect", kind: "webhook", ids: ["9003", "9005"], expected: false },
            ])
            assert.deepEqual(alerts.settings().expectedWebhookIds, ["9002", "9004"])
        }),
    )
})

test("invite lists start each line with the code, and revoking a code deletes exactly that invite", async () => {
    await run({}, (bot, native) =>
        Effect.gen(function* () {
            yield* say(bot, adminId, "!invites list")
            yield* bot.idle()
            const list = native.replies().at(-1)!
            const lines = list.split("\n")
            // Newest first, and an invite without limits is flagged once instead of repeating the missing limit
            assert.equal(
                lines[1],
                `${quoted("SyntheticNew")}: <#${channelId}>, by <@${memberId}>, 2 uses. Flagged: never expires, unlimited uses`,
            )
            assert.equal(
                lines[2],
                `${quoted("SyntheticOld")}: <#${channelId}>, by <@${memberId}>, 2 of 5 uses, expires <t:1748822400:f>`,
            )
            // One note explains the code and the revoke step for the whole list
            assert.equal(
                lines.at(-1),
                "Each line starts with the invite's code. Revoke one with `!invites revoke <code>`",
            )
            assert.equal(list.split("!invites revoke").length, 2)
            // Codes differ by case, so only the exact code matches
            yield* say(bot, memberId, "!invites revoke SyntheticOld")
            yield* say(bot, adminId, "!invites revoke syntheticold")
            yield* say(bot, adminId, "!invites revoke SyntheticOld")
            yield* bot.idle()
            assert.deepEqual(native.deleted(), ["SyntheticOld"])
            assert.deepEqual(native.replies().slice(-3), [
                "Only the server owner or members with Manage community can manage security alerts and invites",
                "No current invite has that code. Check `!invites list`",
                `Invite ${quoted("SyntheticOld")} revoked. Members who joined with it stay`,
            ])
            assert.deepEqual(
                [parseInvitesCommand(["revoke", "a".repeat(65)]), parseInvitesCommand(["revoke", "<#5001>"])],
                [
                    { error: "Use the invite code !invites list shows" },
                    { error: "Use the invite code !invites list shows" },
                ],
            )
        }),
    )
})

test("invite lists continue with next, and a page number is not a form of the command", async () => {
    await run({}, (bot, native) =>
        Effect.gen(function* () {
            native.invites.remove()
            const twelve = bot.rest.respond("GET /guilds/:id/invites", {
                body: Array.from({ length: 12 }, (_, index) =>
                    rawInvite(bot, `SyntheticCode${index}`, {
                        created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
                    }),
                ),
            })
            const refs = (reply: string) => reply.split("\n").map((line) => line.split(":")[0])
            yield* say(bot, adminId, "!invites list")
            yield* bot.idle()
            const first = native.replies().at(-1)!.split("\n")
            assert.deepEqual(
                [first[0], first[1]!.split(":")[0], first.length, first.at(-1)],
                ["Invites", quoted("SyntheticCode11"), 13, "Next: `!invites list next`"],
            )
            yield* say(bot, adminId, "!invites list next")
            yield* bot.idle()
            assert.deepEqual(refs(native.replies().at(-1)!), [
                "Invites",
                quoted("SyntheticCode1"),
                quoted("SyntheticCode0"),
                "Each line starts with the invite's code. Revoke one with `!invites revoke <code>`",
            ])
            yield* say(bot, adminId, "!invites list next")
            yield* say(bot, adminId, "!invites list 2")
            yield* bot.idle()
            assert.deepEqual(native.replies().slice(-2), [
                "There is no next page to show. Send !invites list to start the list again",
                "Check the invites command syntax. Use !invites help",
            ])
            // A server without invites gets the same card
            twelve.remove()
            bot.rest.respond("GET /guilds/:id/invites", { body: [] })
            yield* say(bot, adminId, "!invites list")
            yield* bot.idle()
            assert.equal(native.replies().at(-1), "Invites\nNo invites yet. A vanity link is not listed")
        }),
    )
})

test("a dashboard invite revocation deletes the invite and hands the backend the rest with their codes, then alert changes reload", async (t) => {
    let jobs: DashboardConfigurationReadyJob[] = [],
        outdated = true
    const executed: unknown[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        if (call.path === "/dashboard-configuration/claim")
            return claimed(jobs[0]!, undefined, outdated ? "conflict" : "queued")
        assert.equal(call.path, "/dashboard-configuration/execute")
        executed.push(call.body)
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    await run({}, (bot, native, alerts) =>
        Effect.gen(function* () {
            const f = bot.fixtures,
                config = {
                    token,
                    serverId: f.ids.guild,
                    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") },
                }
            bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
            bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
            const job = {
                native: {},
                id: "synthetic_alerts_job",
                actorId: adminId,
                expectedConfigRevision: 0,
                state: "queued" as const,
                createdAt: 0,
                expiresAt: 120000,
            }
            jobs = [{ ...job, family: "alerts", operation: { type: "invite-revoke", ref: inviteRef("SyntheticOld") } }]
            // A revocation the backend finds outdated at its claim revokes nothing and is not executed
            yield* processDashboardConfigurationPass(
                config,
                bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
            )
            assert.deepEqual([native.deleted(), executed.length], [[], 0])
            outdated = false
            yield* processDashboardConfigurationPass(
                config,
                bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
            )
            assert.deepEqual(native.deleted(), ["SyntheticOld"])
            const context = (executed[0] as { context: { invites: AlertInvite[]; more: boolean } }).context
            assert.deepEqual(context, {
                invites: [
                    {
                        ref: inviteRef("SyntheticNew"),
                        code: "SyntheticNew",
                        channelId,
                        inviterId: memberId,
                        uses: 2,
                        maxUses: 0,
                        expiresAt: null,
                        createdAt: "2026-01-01T00:00:00.000Z",
                        temporary: false,
                    },
                ],
                more: false,
            })
            // An applied settings change reads the settings again, so it applies without a restart
            jobs = [{ ...job, family: "alerts", operation: { type: "set", alert: "bots", enabled: true } }]
            yield* processDashboardConfigurationPass(
                config,
                bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
            )
            assert.deepEqual(alerts.calls, ["get", "get"])
        }),
    )
})

test("the dashboard reads older invites a page at a time, and revoking the oldest of 101 leaves the newest 100", async (t) => {
    let jobs: DashboardConfigurationReadyJob[] = []
    const executed: { context: { invites: AlertInvite[]; offset?: number; more: boolean } }[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        if (call.path === "/dashboard-configuration/claim") return claimed(jobs[0]!, undefined, "queued")
        assert.equal(call.path, "/dashboard-configuration/execute")
        executed.push(call.body as (typeof executed)[number])
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    await run({}, (bot, native) =>
        Effect.gen(function* () {
            const f = bot.fixtures,
                config = {
                    token,
                    serverId: f.ids.guild,
                    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") },
                }
            bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
            bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
            // Invite 0 is the newest and invite 100 the oldest
            const codes = Array.from({ length: 101 }, (_, index) => `Synthetic${String(index).padStart(3, "0")}`)
            bot.rest.respond("GET /guilds/:id/invites", {
                body: codes.map((code, index) =>
                    rawInvite(bot, code, { created_at: new Date(Date.UTC(2026, 0, 1) - index * 60000).toISOString() }),
                ),
            })
            const job = {
                native: {},
                id: "synthetic_alerts_job",
                actorId: adminId,
                expectedConfigRevision: 0,
                state: "queued" as const,
                createdAt: 0,
                expiresAt: 120000,
            }
            const pass = (operation: DashboardConfigurationReadyJob["operation"]) => {
                jobs = [{ ...job, family: "alerts", operation } as DashboardConfigurationReadyJob]
                return processDashboardConfigurationPass(
                    config,
                    bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
                )
            }
            const shown = () => {
                const { invites, ...rest } = executed.at(-1)!.context
                return { codes: invites.map((invite) => invite.code), ...rest }
            }
            yield* pass({ type: "invites-refresh" })
            assert.deepEqual(shown(), { codes: codes.slice(0, 100), more: true })
            yield* pass({ type: "invites-refresh", offset: 100 })
            assert.deepEqual(shown(), { codes: ["Synthetic100"], offset: 100, more: false })
            // Revoking the oldest from its page deletes only it, and the emptied page falls back to the newest 100
            yield* pass({ type: "invite-revoke", ref: inviteRef("Synthetic100"), offset: 100 })
            assert.deepEqual(native.deleted(), ["Synthetic100"])
            assert.deepEqual(shown(), { codes: codes.slice(0, 100), more: false })
        }),
    )
})

test("an action switched on from the dashboard acts on the next event without a restart", async (t) => {
    let jobs: DashboardConfigurationReadyJob[] = [],
        persist: (() => void) | undefined
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        if (call.path === "/dashboard-configuration/claim") return claimed(jobs[0]!, undefined, "queued")
        assert.equal(call.path, "/dashboard-configuration/execute")
        persist?.()
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    await run({ bots: true }, (bot, native, alerts) =>
        Effect.gen(function* () {
            const f = bot.fixtures,
                config = {
                    token,
                    serverId: f.ids.guild,
                    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") },
                }
            bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
            bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
            yield* join(bot, botAccountId, { bot: true })
            yield* bot.idle()
            assert.equal(native.kicks.requests().length, 0)
            // The backend stores the switch as the website asked
            persist = () =>
                Effect.runSync(
                    alerts.store.manage({
                        serverId: f.ids.guild,
                        operation: { type: "action", action: "kickBots", enabled: true },
                    } as Parameters<typeof alerts.store.manage>[0]),
                )
            jobs = [
                {
                    native: {},
                    id: "synthetic_alerts_action_job",
                    actorId: adminId,
                    expectedConfigRevision: 0,
                    state: "queued",
                    createdAt: 0,
                    expiresAt: 120000,
                    family: "alerts",
                    operation: { type: "action", action: "kickBots", enabled: true },
                },
            ]
            yield* processDashboardConfigurationPass(
                config,
                bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
            )
            yield* join(bot, "6102", { bot: true })
            yield* bot.idle()
            assert.deepEqual(
                native.kicks.requests().map((request) => segment(request.path, 4)),
                ["6102"],
            )
        }),
    )
})
test("a code outside Fluxer's usual form is left out of lists and logs", () => {
    assert.equal(shownInviteCode("AbC_12-3"), "AbC_12-3")
    assert.equal(shownInviteCode("a b"), undefined)
    assert.equal(shownInviteCode("a".repeat(65)), undefined)
})

const joinKey = (userId: string) => `join:${userId}:${new Date(0).toISOString()}`

test("an unexpected bot is kicked once, an expected bot stays, and a bot NeonFlux does not outrank fails", async () => {
    await run({ bots: true, kickBots: true, expectedBotIds: ["6101"] }, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            yield* join(bot, botAccountId, { bot: true })
            yield* join(bot, "6101", { bot: true })
            yield* join(bot, higherBotId, { bot: true })
            yield* bot.idle()
            // Fluxer delivers the first join again, which raises its alert again but claims nothing
            yield* join(bot, botAccountId, { bot: true })
            yield* bot.idle()
            assert.deepEqual(
                native.kicks.requests().map((request) => segment(request.path, 4)),
                [botAccountId],
            )
            assert.deepEqual(alerts.outcomes, [
                [joinKey(botAccountId), "succeeded"],
                [joinKey(higherBotId), "failed"],
            ])
            assert.deepEqual(
                alerts.claims.map((claim) => [claim.action, claim.targetId]),
                [
                    ["kickBots", botAccountId],
                    ["kickBots", higherBotId],
                    ["kickBots", botAccountId],
                ],
            )
            assert.deepEqual(
                metadata.events.map((event) => event.resourceIds[0]),
                [botAccountId, higherBotId, botAccountId],
            )
        }),
    )
})

test("an action waits for its alert to be on record, so nothing acts while metadata logs are off", async () => {
    await run({ bots: true, kickBots: true }, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            metadata.state.disabled = true
            yield* join(bot, botAccountId, { bot: true })
            yield* bot.idle()
            assert.deepEqual([native.kicks.requests().length, alerts.claims.length], [0, 0])
            metadata.state.disabled = false
            yield* join(bot, "6102", { bot: true })
            yield* bot.idle()
            assert.deepEqual(
                native.kicks.requests().map((request) => segment(request.path, 4)),
                ["6102"],
            )
        }),
    )
})
test("a kick Fluxer refuses is recorded as failed, not as an unknown result", async () => {
    await run({ bots: true, kickBots: true }, (bot, native, alerts) =>
        Effect.gen(function* () {
            native.kicks.remove()
            const refused = bot.rest.respond("DELETE /guilds/:id/members/:id", {
                status: 403,
                body: { code: "MISSING_PERMISSIONS", message: "Missing Permissions" },
            })
            yield* join(bot, botAccountId, { bot: true })
            yield* bot.idle()
            assert.equal(refused.requests().length, 1)
            assert.deepEqual(alerts.outcomes, [[joinKey(botAccountId), "failed"]])
        }),
    )
})
test("a kick that Fluxer does not answer within five seconds is uncertain and never sent again", async () => {
    await run({ bots: true, kickBots: true }, (bot, native, alerts) =>
        Effect.gen(function* () {
            native.kicks.remove()
            const hanging = bot.rest.respond("DELETE /guilds/:id/members/:id", () => new Promise<never>(() => {}))
            const handled = yield* Effect.forkChild(join(bot, botAccountId, { bot: true }))
            yield* hanging.next()
            yield* TestClock.adjust("4999 millis")
            assert.deepEqual(alerts.outcomes, [])
            // The kick ends at five seconds. A later deadline would leave the join unfinished here, which fails instead of hanging
            const settled = yield* Effect.forkChild(Fiber.join(handled).pipe(Effect.timeoutOption("1 millis")))
            yield* TestClock.adjust("1 millis")
            assert.ok(Option.isSome(yield* Fiber.join(settled)))
            yield* bot.idle()
            assert.deepEqual(alerts.outcomes, [[joinKey(botAccountId), "uncertain"]])
            yield* join(bot, botAccountId, { bot: true })
            yield* bot.idle()
            assert.equal(hanging.requests().length, 1)
        }),
    )
})

test("a new webhook is deleted unless the owner or an expected bot made it, and a changed one is only reported", async () => {
    await run({ webhooks: true, deleteWebhooks: true, expectedBotIds: ["6101"] }, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            yield* audit(bot, "7101", 50, "9001", [], native.ownerId)
            yield* audit(bot, "7102", 50, "9002")
            yield* audit(bot, "7103", 51, "9003")
            yield* audit(bot, "7104", 50, "9004", [], "6101")
            yield* bot.idle()
            assert.deepEqual(
                native.webhookDeletes.requests().map((request) => segment(request.path, 2)),
                ["9002"],
            )
            assert.deepEqual(alerts.outcomes, [["audit:7102", "succeeded"]])
            assert.deepEqual(
                metadata.events.map((event) => event.resourceIds[0]),
                ["9001", "9002", "9003", "9004"],
            )
        }),
    )
})

test("a role loses only the dangerous permission the entry added, and member role grants are never acted on", async () => {
    await run({ privileges: true, removePermissions: true }, (bot, native, alerts, metadata) =>
        Effect.gen(function* () {
            const send = Permissions.SendMessages,
                ban = Permissions.BanMembers,
                admin = Permissions.Administrator
            // The role already held Ban members, and the entry added Administrator
            const gained = [
                { key: "permissions", old_value: String(send | ban), new_value: String(send | ban | admin) },
            ]
            yield* audit(bot, "7201", 31, native.gainedRole.id, gained)
            yield* audit(bot, "7202", 31, native.gainedRole.id, gained, native.ownerId)
            yield* audit(bot, "7203", 25, memberId, [{ key: "roles", old_value: [], new_value: [native.modRole.id] }])
            yield* bot.idle()
            assert.deepEqual(
                native.roleEdits.requests().map((request) => [segment(request.path, 4), request.body]),
                [[native.gainedRole.id, { permissions: String(send | ban) }]],
            )
            assert.deepEqual(
                alerts.claims.map((claim) => [claim.key, claim.permissions]),
                [["audit:7201", ["Administrator"]]],
            )
            assert.deepEqual(alerts.outcomes, [["audit:7201", "succeeded"]])
            assert.deepEqual(
                metadata.events.map((event) => event.changedFields[0]),
                ["role-permissions", "role-permissions", "member-roles"],
            )
        }),
    )
})

test("turning an action on needs the owner or an Administrator, turning it off any alerts manager", async () => {
    await run({ bots: true, kickBots: true }, (bot, native, alerts) =>
        Effect.gen(function* () {
            assert.deepEqual(
                [
                    parseAlertsCommand(["action", "bots", "on"]),
                    parseAlertsCommand(["action", "privileges", "OFF"]),
                    parseAlertsCommand(["action", "constructor", "on"]),
                    parseAlertsCommand(["action", "bots"]),
                ],
                [
                    { type: "action", action: "kickBots", enabled: true },
                    { type: "action", action: "removePermissions", enabled: false },
                    { error: "Use !alerts action bots|webhooks|privileges on|off" },
                    { error: "Check the alerts command syntax. Use !alerts help" },
                ],
            )
            // A manager with Manage community but without Administrator may only turn actions off
            const manager = (content: string) =>
                say(bot, managerId, content).pipe(
                    Effect.andThen(bot.idle()),
                    Effect.andThen(Effect.sync(() => native.replies().at(-1)!)),
                )
            assert.equal(
                yield* manager("!alerts action webhooks on"),
                "Only the server owner or an Administrator can turn an alert action on",
            )
            assert.equal(
                yield* ask(bot, native, "!alerts action webhooks on"),
                "Delete unexpected webhooks turned on. It acts once the webhooks alert is on",
            )
            assert.equal(yield* manager("!alerts action bots off"), "Kick unexpected bots turned off")
            assert.deepEqual(alerts.operations, [
                { type: "action", action: "deleteWebhooks", enabled: true },
                { type: "action", action: "kickBots", enabled: false },
            ])
            const status = yield* ask(bot, native, "!alerts status")
            assert.ok(
                status.includes(
                    "Actions: kick unexpected bots off, delete unexpected webhooks on, remove gained permissions off",
                ),
            )
            // Turning an action on names the permission NeonFlux lacks for it
            const reduced = {
                ...native.botRole,
                permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.ManageGuild).toString(),
            }
            bot.rest.respond("GET /guilds/:id/roles", {
                body: native.roles.map((role) => (role.id === reduced.id ? reduced : role)),
            })
            yield* bot.emit("GUILD_ROLE_UPDATE", { guild_id: bot.fixtures.ids.guild, role: reduced })
            assert.equal(
                yield* ask(bot, native, "!alerts action bots on"),
                "Kick unexpected bots turned on. It fails until NeonFlux has it: Grant Kick members to the NeonFlux role",
            )
        }),
    )
})
