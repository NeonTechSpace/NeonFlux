import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { CivilCalendarError } from "../../bot/src/civil-calendar.ts"
import { createScheduleCalendar } from "../../bot/src/schedule-calendar.ts"
import { createSchedulesStore, SchedulesStoreError } from "../../bot/src/schedule-store.ts"
import { createPublishingStore, PublishingStoreError } from "../../bot/src/publishing-store.ts"
import { processSchedulesPass } from "../../bot/src/schedule-worker.ts"
import { handleScheduleCommand } from "../../bot/src/schedule-management.ts"
import { parsePublishingCommand } from "../../bot/src/publishing-command.ts"

const modules = {
    "../convex/schedules.ts": () => import("../convex/schedules.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
}
const actor: C.ModerationActor = { userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
const owner: C.ModerationActor = { ...actor, userId: "10", isOwner: true }
const admin: C.ModerationActor = { ...actor, userId: "11", isAdministrator: true }
const member = (userId: string): C.SchedulesMemberContext => ({ userId, joinedAt: "2026-03-24T10:00:00.000000Z", roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true })

// Use the production civil expander, retaining the exact resolved instants in the API request
function calendar(localMinute = "2026-03-26T12:00", zone = "UTC", fold: C.CivilFoldPolicy = "reject", recurrence: C.CivilRecurrence = { type: "none" }): C.SchedulesCalendar {
    return createScheduleCalendar(localMinute, zone, fold, recurrence)
}
function scheduleResult(result: C.SchedulesManageResult) {
    assert(!result.duplicate && result.type === "schedule")
    return result.schedule
}
function deliveryBinding(value: C.SchedulesDelivery): C.SchedulesDeliveryBinding {
    return { deliveryId: value.deliveryId, scheduleNo: value.scheduleNo, planRevision: value.planRevision, occurrenceNo: value.occurrenceNo }
}
function publishingBinding(grant: C.SchedulesDeliveryGrant, claimToken = "a".repeat(32)) {
    return { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken }
}
async function fixture(t: Parameters<typeof adapterFixture>[0]) {
    const f = await adapterFixture(t, modules)
    f.advance(Date.parse("2026-03-25T12:00Z") - f.now())
    const store = createSchedulesStore(f.config), wrongStore = createSchedulesStore(f.wrongConfig), publishing = createPublishingStore(f.config)
    const context = (who = owner, channelId = "30"): C.SchedulesContext => ({ observedAt: f.now(), actor: who, channelId, botId: "999", botAuthorized: true, actorAuthorized: true, member: member(who.userId) })
    const workerContext = (row: Pick<C.SchedulesDelivery, "channelId">): C.SchedulesAutomationContext => ({ observedAt: f.now(), channelId: row.channelId, botId: "999", botAuthorized: true })
    const manageInput = (operation: C.SchedulesManageOperation, current = context()): C.SchedulesManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: C.SchedulesManageOperation, current = context()) => f.run<C.SchedulesManageResult>(store.manage(manageInput(operation, current)))
    const queryInput = (operation: C.SchedulesQueryRequest["operation"], current = context()): C.SchedulesQueryRequest => ({ serverId: "1", context: current, operation })
    const query = (operation: C.SchedulesQueryRequest["operation"], current = context()) => f.run<C.SchedulesQueryResult>(store.query(queryInput(operation, current)))
    const show = async (row: Pick<C.SchedulesDefinition, "scheduleNo">) => {
        const value = await query({ type: "show", scheduleNo: row.scheduleNo })
        assert.equal(value.type, "schedule")
        return value.schedule
    }
    const status = async () => {
        const value = await query({ type: "status" })
        assert.equal(value.type, "status")
        return value
    }
    const deliveries = async (row: Pick<C.SchedulesDefinition, "scheduleNo">) => {
        const values: C.SchedulesDelivery[] = []
        let afterOccurrenceNo: number | undefined
        for (let page = 0; page < 12; page++) {
            const value = await query({ type: "deliveries", scheduleNo: row.scheduleNo, ...(afterOccurrenceNo === undefined ? {} : { afterOccurrenceNo }) })
            assert.equal(value.type, "deliveries")
            assert(value.deliveries.length <= 20)
            values.push(...value.deliveries)
            if (value.nextAfterOccurrenceNo === undefined) return values
            assert(value.nextAfterOccurrenceNo > (afterOccurrenceNo ?? 0), "Delivery cursor must advance")
            afterOccurrenceNo = value.nextAfterOccurrenceNo
        }
        assert.fail("Retained delivery bounds must terminate pagination")
    }
    const delivery = (operation: C.SchedulesDeliveryRequest["operation"]) => f.run<C.SchedulesDeliveryResult>(store.delivery({ serverId: "1", operation }))
    const publishingManage = (operation: C.PublishingManageOperation) => f.run<C.PublishingManageResult>(publishing.manage({ ...f.source(), actor: owner, operation }))
    const draft = async (name = `source-${f.source().messageId}`, content = "Synthetic frozen announcement"): Promise<C.PublishingDraft> => {
        const created = await publishingManage({ type: "draft-create", kind: "draft", name })
        assert(!created.duplicate && created.type === "draft")
        const updated = await publishingManage({ type: "draft-update", kind: "draft", name, expectedRevision: created.draft.revision, edit: { type: "content", content } })
        assert(!updated.duplicate && updated.type === "draft")
        return updated.draft
    }
    const create = async (name: string, dates = calendar(), selected?: C.PublishingDraft) => {
        const source = selected ?? await draft()
        return scheduleResult(await manage({ type: "create", name, source: { kind: source.kind, name: source.name, revision: source.revision }, channelId: "30", calendar: dates }))
    }
    const enableModule = async () => {
        const value = await query({ type: "settings" })
        assert.equal(value.type, "settings")
        if (!value.settings.enabled) await manage({ type: "settings", expectedRevision: value.settings.revision, enabled: true })
    }
    const open = async (name: string, dates = calendar()) => {
        await enableModule()
        const row = await create(name, dates)
        return scheduleResult(await manage({ type: "enable", scheduleNo: row.scheduleNo, expectedRevision: row.revision }))
    }
    const reserve = async (row: C.SchedulesDelivery, current = workerContext(row)) => {
        const value = await delivery({ type: "reserve", binding: deliveryBinding(row), context: current })
        assert(value.type === "reservation" && value.status === "reserved")
        return value.grant
    }
    const post = async (postNo: number) => {
        const value = await f.run<C.PublishingQueryResult>(publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo } }))
        assert.equal(value.type, "post")
        return value.post
    }
    const dispatch = (grant: C.SchedulesDeliveryGrant, current = workerContext(grant), token = "a".repeat(32)) => f.run<C.PublishingDispatchResult>(publishing.dispatch({ ...publishingBinding(grant, token), scheduleContext: current }))
    const outcome = (grant: C.SchedulesDeliveryGrant, value: C.PublishingOutcomeRequest["outcome"], messageId?: string) => f.run<C.PublishingOutcomeResult>(publishing.outcome({ ...publishingBinding(grant), outcome: value, ...(messageId === undefined ? {} : { messageId }) }))
    const sent = async (grant: C.SchedulesDeliveryGrant) => {
        assert((await dispatch(grant)).claimed)
        assert.deepEqual(await outcome(grant, "sent", f.source().messageId), { recorded: true })
    }
    return { ...f, store, wrongStore, publishing, context, workerContext, manageInput, manage, queryInput, query, show, status, deliveries, delivery, publishingManage, draft, create, enableModule, open, reserve, post, dispatch, outcome, sent }
}

test("schedules adapters authenticate all routes and read disabled defaults without mutation", async t => {
    const f = await fixture(t), before = await f.status()
    assert.equal(before.settings.enabled, false)
    assert.equal(before.settings.revision, 1)
    assert.equal(before.settings.activatedAt, 0)
    assert.equal(before.definitions, 0)
    assert.equal(before.deliveries, 0)
    assert.equal(before.receipts, 0)
    assert.deepEqual(await f.query({ type: "settings" }), { type: "settings", settings: before.settings })
    const persisted = () => f.backend.run(async ctx => ({ settings: await ctx.db.query("scheduleSettings").collect(), receipts: await ctx.db.query("scheduleReceipts").collect() }))
    assert.deepEqual(await persisted(), { settings: [], receipts: [] })
    for (const effect of [
        f.wrongStore.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: true })),
        f.wrongStore.query(f.queryInput({ type: "settings" })),
        f.wrongStore.delivery({ serverId: "1", operation: { type: "list" } }),
    ]) await f.reject(effect, SchedulesStoreError, 401)
    await f.reject(f.store.query({ ...f.queryInput({ type: "settings" }), serverId: "2" }), SchedulesStoreError, 403)
    await f.reject(f.store.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: true }, f.context(actor))), SchedulesStoreError, 403)
    assert.deepEqual(await f.status(), before)
    assert.deepEqual(await persisted(), { settings: [], receipts: [] })
    assert.deepEqual(new Set(f.calls.filter(call => call.status === 401).map(call => call.path)), new Set(["/schedules/manage", "/schedules/query", "/schedules/delivery"]))
    const input = f.manageInput({ type: "settings", expectedRevision: 1, enabled: true })
    const enabled = await f.run<C.SchedulesManageResult>(f.store.manage(input))
    assert(!enabled.duplicate && enabled.type === "settings")
    assert.equal(enabled.settings.activatedAt, f.now())
    assert.deepEqual(await f.run<C.SchedulesManageResult>(f.store.manage(input)), { duplicate: true })
    const after = await f.status()
    await f.reject(f.store.manage({ ...input, operation: { type: "settings", expectedRevision: 2, enabled: false } }), SchedulesStoreError, 409)
    await f.reject(f.store.manage({ ...input, context: f.context(admin) }), SchedulesStoreError, 409)
    await f.reject(f.store.manage({ ...input, createdAt: input.createdAt - 1 }), SchedulesStoreError, 409)
    await f.reject(f.store.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: false })), SchedulesStoreError, 409)
    assert.deepEqual(await f.status(), after)
})

test("actual schedule list adapter passes ready future-nextCheckAt rows to scoped publishing performer", async t => {
    const f = await fixture(t), row = await f.open("actual-worker-discovery"), pending = (await f.deliveries(row))[0]!
    f.advance(pending.dueAt - f.now())
    const botRequire = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Effect } = await import(pathToFileURL(botRequire.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(botRequire.resolve("effect/testing")).href)
    const sdkRoot = new URL("./", pathToFileURL(botRequire.resolve("@neontechspace/fluxerly/effect")))
    const sdkPackage = JSON.parse(readFileSync(new URL("package.json", sdkRoot), "utf8"))
    const { Permissions } = await import(new URL(sdkPackage.exports["./effect"].import, sdkRoot).href)
    const { createTestBot } = await import(new URL(sdkPackage.exports["./effect/testing"].import, sdkRoot).href)
    await f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-adapter-sdk-token" })
        const native = bot.fixtures
        const actorRole = native.role({ permissions: Permissions.Administrator.toString() })
        const botRole = native.role({ permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory).toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [native.role({ id: "1", permissions: "0" }), actorRole, botRole] })
        bot.rest.respond("GET /guilds/1/members/10", { body: native.member({ user: native.user({ id: "10" }), roles: [actorRole.id], joined_at: "2026-03-24T10:00:00Z", communication_disabled_until: null }) })
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], joined_at: "2026-03-24T10:00:00Z", communication_disabled_until: null }) })
        bot.rest.respond("GET /channels/30", { body: native.channel({ id: "30", guild_id: "1" }) })
        const send = bot.rest.respond("POST /channels/30/messages", (request: { body: { content: string } }) => ({ body: native.message({ id: "2000", guild_id: "1", channel_id: "30", author: native.botUser({ id: "999" }), content: request.body.content }) }))
        let discovered: C.SchedulesDelivery[] = []
        const actualStore = createSchedulesStore(f.config)
        const observedStore = { ...actualStore, delivery: (input: C.SchedulesDeliveryRequest) => actualStore.delivery(input).pipe(Effect.tap((result: C.SchedulesDeliveryResult) => Effect.sync(() => {
            if (input.operation.type === "list" && result.type === "deliveries") {
                discovered = result.deliveries
                assert.equal(discovered.length, 1)
                assert.equal(discovered[0]!.deliveryId, pending.deliveryId)
                assert.equal(discovered[0]!.dueAt, f.now())
                assert.equal(discovered[0]!.nextCheckAt, f.now() + 60000)
            }
        }))) }
        const before = f.calls.length
        const pass = yield* processSchedulesPass(observedStore, createPublishingStore(f.config), "1", bot.client)
        assert.equal(pass.considered, 1)
        assert.equal(pass.hasMore, false)
        assert.equal(send.requests().length, 1)
        assert.deepEqual((send.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.deepEqual(f.calls.slice(before).map(call => call.path), ["/schedules/delivery", "/schedules/delivery", "/publishing/dispatch", "/publishing/outcome"])
    })).pipe(Effect.provide(TestClock.layer())))
    const retained = (await f.deliveries(row))[0]!
    assert.equal(retained.state, "sent")
    assert.equal(retained.claimedAt, f.now())
    assert(retained.postNo)
    const post = await f.post(retained.postNo)
    assert.equal(post.outcome, "sent")
    assert.equal(post.messageId, "2000")
    assert.equal(post.attempt.source?.type, "schedule-timer")
    assert.equal(post.attempt.dispatchedAt, f.now())
})

test("actual schedule forgetting follows the bot's advertised advanced-revision continuation to completion", async t => {
    const f = await fixture(t), created = await f.create("advertised-forgetting", calendar("2026-03-26T12:00", "UTC", "reject", { type: "daily", interval: 1, count: 26 }))
    const row = scheduleResult(await f.manage({ type: "cancel", scheduleNo: created.scheduleNo, expectedRevision: created.revision }))
    assert.equal(row.revision, 2)
    const botRequire = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Effect, Redacted } = await import(pathToFileURL(botRequire.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(botRequire.resolve("effect/testing")).href)
    const sdkRoot = new URL("./", pathToFileURL(botRequire.resolve("@neontechspace/fluxerly/effect")))
    const sdkPackage = JSON.parse(readFileSync(new URL("package.json", sdkRoot), "utf8"))
    const { Permissions } = await import(new URL(sdkPackage.exports["./effect"].import, sdkRoot).href)
    const { createTestBot } = await import(new URL(sdkPackage.exports["./effect/testing"].import, sdkRoot).href)
    await f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-forgetting-sdk-token" })
        const native = bot.fixtures, actorRole = native.role({ permissions: Permissions.Administrator.toString() }), botRole = native.role({ permissions: Permissions.Administrator.toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [native.role({ id: "1", permissions: "0" }), actorRole, botRole] })
        bot.rest.respond("GET /guilds/1/members/10", { body: native.member({ user: native.user({ id: "10" }), roles: [actorRole.id], joined_at: "2026-03-24T10:00:00Z", communication_disabled_until: null }) })
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], joined_at: "2026-03-24T10:00:00Z", communication_disabled_until: null }) })
        bot.rest.respond("GET /channels/30", { body: native.channel({ id: "30", guild_id: "1" }) })
        const replies = bot.rest.respond("POST /channels/30/messages", { body: native.message({ guild_id: "1", channel_id: "30", author: native.botUser({ id: "999" }) }) })
        const invoke = (content: string) => Effect.gen(function* () {
            const messageId = f.source().messageId
            bot.rest.respond(`GET /channels/30/messages/${messageId}`, { body: native.message({ id: messageId, guild_id: "1", channel_id: "30", author: native.user({ id: "10" }), timestamp: new Date(f.now()).toISOString(), content }) })
            const message = yield* bot.client.messages.fetch({ channelId: "30", id: messageId })
            const parsed = parsePublishingCommand(content.slice("!publish ".length).split(" "))
            assert(!("error" in parsed) && parsed.type === "schedule")
            const context = { client: bot.client, message, reply: (value: unknown) => bot.client.messages.send("30", value) } as Parameters<typeof handleScheduleCommand>[4]
            yield* handleScheduleCommand(f.store, f.publishing, { token: Redacted.make("synthetic-schedule-forgetting-sdk-token"), serverId: "1" }, parsed.command, context)
        })
        yield* invoke(`!publish schedule forget ${row.scheduleNo} ${row.revision} confirm`)
        const first = replies.requests()[0]!
        const text = (first.body as { content: string }).content
        assert.match(text, /20 retained records removed, forgetting Incomplete/)
        const continuation = /Continue (!publish schedule forget \d+ \d+ confirm) with a new message/.exec(text)?.[1]
        assert.equal(continuation, `!publish schedule forget ${row.scheduleNo} ${row.revision + 1} confirm`)
        yield* invoke(continuation!)
        const second = replies.requests()[1]!
        assert.match((second.body as { content: string }).content, /6 retained records removed, forgetting Complete/)
        assert.equal(bot.failures().length, 0)
        assert.equal(replies.requests().length, 2)
    })).pipe(Effect.provide(TestClock.layer())))
    const status = await f.status()
    assert.equal(status.definitions, 0)
    assert.equal(status.deliveries, 0)
    await f.reject(f.store.query(f.queryInput({ type: "show", scheduleNo: row.scheduleNo })), SchedulesStoreError, 404)
})

test("schedules copy exact source snapshots atomically and ignore later source edits and deletion", async t => {
    const f = await fixture(t), source = await f.draft("frozen-source")
    const before = await f.status()
    await f.reject(f.store.manage(f.manageInput({ type: "create", name: "stale-source", source: { kind: source.kind, name: source.name, revision: source.revision - 1 }, channelId: "30", calendar: calendar() })), SchedulesStoreError, 409)
    assert.deepEqual(await f.status(), before)
    const row = await f.create("copied-source", calendar(), source)
    assert.equal(row.enabled, false)
    assert.equal(row.createdBy, owner.userId)
    assert.deepEqual(row.source, { kind: source.kind, name: source.name, revision: source.revision })
    assert.deepEqual(row.content, source.content)
    assert.deepEqual(row.canonicalContent, source.canonicalContent)
    const frozen = await f.deliveries(row)
    const changed = await f.publishingManage({ type: "draft-update", kind: source.kind, name: source.name, expectedRevision: source.revision, edit: { type: "content", content: "Synthetic changed source" } })
    assert(!changed.duplicate && changed.type === "draft")
    await f.publishingManage({ type: "draft-delete", kind: source.kind, name: source.name, expectedRevision: changed.draft.revision })
    assert.deepEqual(await f.show(row), row)
    assert.deepEqual(await f.deliveries(row), frozen)
})

test("schedules act as the bot after administrator configuration and fence its fresh destination", async t => {
    const f = await fixture(t), original = await f.open("bot-automation")
    const edited = scheduleResult(await f.manage({ type: "destination", scheduleNo: original.scheduleNo, expectedRevision: original.revision, channelId: "31" }, f.context(admin, "31")))
    assert.equal(edited.createdBy, owner.userId)
    assert.equal(edited.planRevision, original.planRevision + 1)
    const oldRows = await f.deliveries(edited)
    assert(oldRows.some(row => row.planRevision === original.planRevision && row.state === "superseded"))
    const current = (await f.deliveries(edited)).find(row => row.planRevision === edited.planRevision)!
    assert(current)
    f.advance(current.dueAt - f.now())
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(current), context: f.workerContext({ channelId: "30" }) }), { type: "reservation", status: "waiting" })
    assert.equal((await f.deliveries(edited)).find(row => row.deliveryId === current.deliveryId)!.postNo, undefined)
    f.advance(60000)
    const grant = await f.reserve(current)
    assert.equal(grant.actorId, grant.botId)
    await f.reject(f.publishing.dispatch({ ...publishingBinding(grant), scheduleContext: f.workerContext({ channelId: "30" }) }), PublishingStoreError, 403)
    assert.equal((await f.post(grant.postNo)).attempt.dispatchedAt, undefined)
    assert((await f.dispatch(grant)).claimed)
    assert.deepEqual(await f.outcome(grant, "sent", f.source().messageId), { recorded: true })
})

test("schedules preserve past and claimed intent while replacing only future unclaimed plans", async t => {
    const f = await fixture(t), original = await f.open("plan-history", calendar("2026-03-26T12:00", "UTC", "reject", { type: "daily", interval: 1, count: 3 }))
    const rows = await f.deliveries(original), first = rows[0]!
    f.advance(first.dueAt - f.now())
    const grant = await f.reserve(first)
    assert((await f.dispatch(grant)).claimed)
    const attemptBefore = await f.post(grant.postNo)
    const changed = scheduleResult(await f.manage({ type: "destination", scheduleNo: original.scheduleNo, expectedRevision: original.revision, channelId: "31" }, f.context(admin, "31")))
    assert.equal(changed.revision, original.revision + 1)
    assert.equal(changed.planRevision, original.planRevision + 1)
    assert.deepEqual(changed.calendar, original.calendar)
    assert.deepEqual(await f.post(grant.postNo), attemptBefore)
    const history = await f.deliveries(changed)
    assert.equal(history.length, 5)
    assert.equal(history.find(row => row.deliveryId === first.deliveryId)!.attemptId, grant.attemptId)
    for (const prior of rows.slice(1)) {
        const retained = history.find(row => row.deliveryId === prior.deliveryId)!
        assert.equal(retained.state, "superseded")
        assert.equal(retained.reason, "superseded")
        assert.equal(retained.channelId, "30")
        const replacement = history.find(row => row.planRevision === changed.planRevision && row.dueAt === prior.dueAt)!
        assert(replacement)
        assert.equal(replacement.channelId, "31")
        assert.deepEqual(replacement.source, original.source)
        assert.equal(replacement.localMinute, prior.localMinute)
        assert.equal(replacement.offsetMinutes, prior.offsetMinutes)
    }
    const replacementSource = await f.draft("replacement-source", "Synthetic explicitly replaced announcement")
    const replaced = scheduleResult(await f.manage({ type: "content", scheduleNo: changed.scheduleNo, expectedRevision: changed.revision,
        source: { kind: replacementSource.kind, name: replacementSource.name, revision: replacementSource.revision } }, f.context(admin, "31")))
    assert.deepEqual(replaced.calendar, original.calendar, "Content replacement retains resolved dates even when their first instant is now past")
    assert.equal(replaced.planRevision, changed.planRevision + 1)
    assert.deepEqual(replaced.content, replacementSource.content)
    const currentRows = (await f.deliveries(replaced)).filter(value => value.planRevision === replaced.planRevision)
    assert.equal(currentRows.length, 2)
    assert(currentRows.every(value => value.channelId === "31" && value.dueAt > f.now()))
    assert.deepEqual(await f.post(grant.postNo), attemptBefore)
    const cancelled = scheduleResult(await f.manage({ type: "cancel", scheduleNo: replaced.scheduleNo, expectedRevision: replaced.revision }, f.context(admin, "31")))
    assert.deepEqual(await f.outcome(grant, "sent", f.source().messageId), { recorded: true })
    assert.equal((await f.deliveries(cancelled)).find(row => row.deliveryId === first.deliveryId)!.state, "sent")
    const post = await f.post(grant.postNo)
    assert.deepEqual(post.consumer, grant.consumer)
    assert.deepEqual(post.attempt.provenance, grant.provenance)
    assert.equal(post.channelId, "30")
    await f.reject(f.store.manage(f.manageInput({ type: "enable", scheduleNo: cancelled.scheduleNo, expectedRevision: cancelled.revision })), SchedulesStoreError, 409)
})

for (const scope of ["definition", "module", "publisher"] as const) test(`schedules ${scope} activation cutoff fences reserved attempts and never catches up`, async t => {
    const f = await fixture(t), row = await f.open(`cutoff-${scope}`, calendar("2026-03-26T12:00", "UTC", "reject", { type: "daily", interval: 1, count: 2 }))
    const [first, next] = await f.deliveries(row)
    assert(first && next)
    f.advance(first.dueAt - f.now())
    const grant = await f.reserve(first)
    let updated = row
    if (scope === "definition") {
        updated = scheduleResult(await f.manage({ type: "disable", scheduleNo: row.scheduleNo, expectedRevision: row.revision }))
        f.advance(1)
        updated = scheduleResult(await f.manage({ type: "enable", scheduleNo: row.scheduleNo, expectedRevision: updated.revision }))
        assert.equal(updated.planRevision, row.planRevision)
        assert.equal(updated.activatedAt, f.now())
    } else if (scope === "module") {
        const value = await f.query({ type: "settings" })
        assert.equal(value.type, "settings")
        const disabled = await f.manage({ type: "settings", expectedRevision: value.settings.revision, enabled: false })
        assert(!disabled.duplicate && disabled.type === "settings")
        f.advance(1)
        const enabled = await f.manage({ type: "settings", expectedRevision: disabled.settings.revision, enabled: true })
        assert(!enabled.duplicate && enabled.type === "settings")
        assert.equal(enabled.settings.activatedAt, f.now())
    } else {
        await f.publishingManage({ type: "settings", patch: { enabled: false } })
        f.advance(1)
        await f.publishingManage({ type: "settings", patch: { enabled: true } })
    }
    assert.equal((await f.dispatch(grant, f.workerContext(first))).claimed, false)
    const attempt = (await f.post(grant.postNo)).attempt
    assert.equal(attempt.dispatchedAt, undefined)
    assert.equal(attempt.noDispatch, true)
    assert.equal(attempt.outcome, "failed")
    const closed = (await f.deliveries(updated)).find(value => value.deliveryId === first.deliveryId)!
    assert.equal(closed.state, "skipped")
    assert.equal(closed.reason, "activation-cutoff")
    const page = await f.delivery({ type: "list" })
    assert.equal(page.type, "deliveries")
    assert(!page.deliveries.some(value => value.deliveryId === first.deliveryId))
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(first), context: f.workerContext(first) }), { type: "reservation", status: "terminal" })
    f.advance(next.dueAt - f.now())
    const nextGrant = await f.reserve(next)
    assert((await f.dispatch(nextGrant)).claimed)
    const claimed = await f.post(nextGrant.postNo)
    if (scope === "definition") await f.manage({ type: "disable", scheduleNo: row.scheduleNo, expectedRevision: updated.revision })
    else if (scope === "module") {
        const value = await f.query({ type: "settings" })
        assert.equal(value.type, "settings")
        await f.manage({ type: "settings", expectedRevision: value.settings.revision, enabled: false })
    } else await f.publishingManage({ type: "settings", patch: { enabled: false } })
    f.advance(1)
    assert.deepEqual(await f.outcome(nextGrant, "sent", f.source().messageId), { recorded: true })
    const completed = await f.post(nextGrant.postNo)
    for (const field of ["attemptId", "generation", "sourceId", "actorId", "channelId", "content", "canonicalContent", "consumer", "provenance", "dispatchedAt"] as const) assert.deepEqual(completed.attempt[field], claimed.attempt[field])
    assert.equal((await f.deliveries(updated)).find(value => value.deliveryId === next.deliveryId)!.state, "sent")
})

test("schedules recover the same unclaimed attempt, shorten late deadlines and retain unknown uncertainty", async t => {
    const f = await fixture(t), row = await f.open("attempt-recovery"), pending = (await f.deliveries(row))[0]!
    const lateRow = await f.open("shortened-deadline", calendar("2026-03-27T12:00")), latePending = (await f.deliveries(lateRow))[0]!
    f.advance(pending.dueAt - f.now())
    const grant = await f.reserve(pending)
    assert.deepEqual(grant.source, { type: "schedule-timer", deliveryId: pending.deliveryId, dueAt: pending.dueAt })
    assert.deepEqual(grant.provenance, { type: "schedule", scheduleNo: row.scheduleNo, planRevision: row.planRevision, source: row.source })
    assert.deepEqual(grant.consumer, { type: "schedule", ...deliveryBinding(pending) })
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    assert.equal(grant.nativeDeadlineMs, 5000)
    const before = { post: await f.post(grant.postNo), status: await f.status() }
    f.advance(60000)
    const page = await f.delivery({ type: "list" })
    assert.equal(page.type, "deliveries")
    const recovered = page.deliveries.find(value => value.deliveryId === pending.deliveryId)!
    assert(recovered)
    assert.equal(recovered.state, "reserved")
    assert.equal(recovered.attemptId, grant.attemptId)
    assert.deepEqual(await f.reserve(recovered), grant)
    assert.deepEqual({ post: await f.post(grant.postNo), status: await f.status() }, before)
    for (const operation of [
        { type: "forget", postNo: grant.postNo, expectedGeneration: grant.generation },
        { type: "edit", postNo: grant.postNo, expectedGeneration: grant.generation, kind: row.source.kind, name: row.source.name, expectedRevision: row.source.revision, context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } },
    ] satisfies C.PublishingManageOperation[]) await f.reject(f.publishing.manage({ ...f.source(), actor: owner, operation }), PublishingStoreError, 409)
    assert((await f.dispatch(grant)).claimed)
    assert.equal((await f.dispatch(grant, f.workerContext(pending), "b".repeat(32))).claimed, false)
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(pending), context: f.workerContext(pending) }), { type: "reservation", status: "terminal" })
    assert.deepEqual(await f.outcome(grant, "uncertain"), { recorded: true })
    const cancelled = scheduleResult(await f.manage({ type: "cancel", scheduleNo: row.scheduleNo, expectedRevision: row.revision }))
    const retained = { post: await f.post(grant.postNo), deliveries: await f.deliveries(cancelled), status: await f.status() }
    await f.reject(f.store.manage(f.manageInput({ type: "reconcile", scheduleNo: row.scheduleNo, expectedRevision: cancelled.revision, deliveryId: pending.deliveryId, attemptId: grant.attemptId, expectedGeneration: grant.generation,
        observation: { observedAt: f.now(), messageId: f.source().messageId, channelId: grant.channelId, botId: grant.botId, content: grant.content } })), SchedulesStoreError, 409)
    await f.reject(f.store.manage(f.manageInput({ type: "forget", scheduleNo: row.scheduleNo, expectedRevision: cancelled.revision, confirm: "forget" })), SchedulesStoreError, 409)
    assert.deepEqual({ post: await f.post(grant.postNo), deliveries: await f.deliveries(cancelled), status: await f.status() }, retained)
    assert.equal(retained.post.messageId, undefined)
    assert.equal(retained.post.outcome, "uncertain")
    assert(!f.calls.some(call => /search|adopt|delete/.test(call.path)))
    f.advance(latePending.dueAt + 270000 - f.now())
    const shortened = await f.reserve(latePending)
    assert.equal(shortened.dispatchExpiresAt, f.now() + 180000)
    assert.equal((await f.post(shortened.postNo)).attempt.dispatchExpiresAt, shortened.dispatchExpiresAt)
    await f.sent(shortened)
})

test("schedules reject dispatch at the exact late deadline without recording a claim", async t => {
    const f = await fixture(t), row = await f.open("exact-expiry"), pending = (await f.deliveries(row))[0]!
    f.advance(pending.dueAt + 290000 - f.now())
    const grant = await f.reserve(pending)
    f.advance(grant.dispatchExpiresAt - f.now())
    assert.equal((await f.dispatch(grant, f.workerContext(pending))).claimed, false)
    assert.equal((await f.post(grant.postNo)).attempt.dispatchedAt, undefined)
    assert.equal((await f.post(grant.postNo)).attempt.noDispatch, true)
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(pending), context: f.workerContext(pending) }), { type: "reservation", status: "terminal" })
})

test("schedules validate real civil expansion", async t => {
    const f = await fixture(t)
    const expanded = calendar("2026-03-28T09:00", "Europe/Berlin", "reject", { type: "daily", interval: 1, count: 3 })
    const row = await f.create("civil-spring", expanded)
    assert.deepEqual(row.calendar, expanded)
    assert.deepEqual((await f.deliveries(row)).map(({ localMinute, dueAt, offsetMinutes }) => ({ localMinute, dueAt, offsetMinutes })), expanded.dates)
    assert.equal(expanded.dates[1]!.dueAt - expanded.dates[0]!.dueAt, 23 * 3600000)
    assert.throws(() => calendar("2026-03-29T02:30", "Europe/Berlin"), CivilCalendarError)
    assert.throws(() => calendar("2026-10-25T02:30", "Europe/Berlin"), CivilCalendarError)
    const before = await f.status()
    for (const malformed of [
        { ...expanded, dates: expanded.dates.map((date, index) => index === 1 ? { ...date, dueAt: date.dueAt + 60000 } : date) },
        { ...expanded, dates: expanded.dates.slice(0, 2) },
        { ...expanded, recurrence: { type: "daily", interval: 1, count: 27 } },
        { ...expanded, localMinute: "2026-02-30T09:00" },
    ] satisfies C.SchedulesCalendar[]) {
        await f.reject(f.store.manage(f.manageInput({ type: "calendar", scheduleNo: row.scheduleNo, expectedRevision: row.revision, calendar: malformed })), SchedulesStoreError, 400)
        assert.deepEqual(await f.status(), before)
        assert.deepEqual(await f.show(row), row)
    }
    f.advance(Date.parse("2026-05-01T12:00Z") - f.now())
    const folds: C.SchedulesCalendar[] = []
    for (const fold of ["earlier", "later"] as const) {
        const dates = calendar("2026-10-25T02:30", "Europe/Berlin", fold)
        const folded = await f.create(`civil-fold-${fold}`, dates)
        assert.deepEqual(folded.calendar, dates)
        folds.push(dates)
    }
    assert.equal(folds[1]!.dates[0]!.dueAt - folds[0]!.dates[0]!.dueAt, 3600000)
})

test("schedules bound fair discovery pages and advance past twenty denied destinations", async t => {
    const f = await fixture(t), source = await f.draft("fair-source"), rows: C.SchedulesDefinition[] = []
    await f.enableModule()
    for (let index = 0; index < 21; index++) {
        const row = await f.create(`fair-${index}`, calendar(), source)
        rows.push(scheduleResult(await f.manage({ type: "enable", scheduleNo: row.scheduleNo, expectedRevision: row.revision })))
    }
    const firstList = await f.query({ type: "list" })
    assert.equal(firstList.type, "schedules")
    assert.equal(firstList.schedules.length, 20)
    assert(firstList.nextBeforeScheduleNo)
    const secondList = await f.query({ type: "list", beforeScheduleNo: firstList.nextBeforeScheduleNo })
    assert.equal(secondList.type, "schedules")
    assert.equal(secondList.schedules.length, 1)
    assert.equal(new Set([...firstList.schedules, ...secondList.schedules].map(row => row.scheduleNo)).size, 21)
    assert.equal(secondList.nextBeforeScheduleNo, undefined)
    f.advance(rows[0]!.calendar.dates[0]!.dueAt - f.now())
    const first = await f.delivery({ type: "list" })
    assert.equal(first.type, "deliveries")
    assert.equal(first.deliveries.length, 20)
    assert.equal(first.hasMore, true)
    assert(first.nextCursor)
    for (const row of first.deliveries) assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(row), context: f.workerContext({ channelId: "32" }) }), { type: "reservation", status: "waiting" })
    const second = await f.delivery({ type: "list", cursor: first.nextCursor })
    assert.equal(second.type, "deliveries")
    assert(second.deliveries.length > 0 && second.deliveries.length <= 20)
    const available = second.deliveries.find(row => !first.deliveries.some(prior => prior.deliveryId === row.deliveryId))
    assert(available, "Durable continuation must reach the eligible sibling past the denied page")
    await f.sent(await f.reserve(available))
    for (const denied of first.deliveries) {
        const row = (await f.deliveries({ scheduleNo: denied.scheduleNo }))[0]!
        assert.equal(row.state, "blocked")
        assert.equal(row.postNo, undefined)
    }
})

test("schedules selectively forget settled occurrences while retaining uncertain and future siblings", async t => {
    const f = await fixture(t), row = await f.open("selective-forget", calendar("2026-03-26T12:00", "UTC", "reject", { type: "daily", interval: 1, count: 3 }))
    const [first, second, third] = await f.deliveries(row)
    assert(first && second && third)
    f.advance(first.dueAt - f.now())
    const settled = await f.reserve(first)
    await f.sent(settled)
    f.advance(second.dueAt - f.now())
    const unknown = await f.reserve(second)
    assert((await f.dispatch(unknown)).claimed)
    assert.deepEqual(await f.outcome(unknown, "uncertain"), { recorded: true })
    const before = { status: await f.status(), unknown: await f.post(unknown.postNo), siblings: (await f.deliveries(row)).filter(value => value.deliveryId !== first.deliveryId) }
    await f.reject(f.store.manage(f.manageInput({ type: "forget", scheduleNo: row.scheduleNo, expectedRevision: row.revision, confirm: "forget", occurrenceNos: [first.occurrenceNo, second.occurrenceNo] })), SchedulesStoreError, 409)
    assert.equal((await f.post(settled.postNo)).outcome, "sent")
    assert.deepEqual(await f.status(), before.status)
    const removed = await f.manage({ type: "forget", scheduleNo: row.scheduleNo, expectedRevision: row.revision, confirm: "forget", occurrenceNos: [first.occurrenceNo] })
    assert(!removed.duplicate && removed.type === "forgotten")
    assert.equal(removed.scheduleNo, row.scheduleNo)
    assert(removed.removed > 0)
    assert.deepEqual((await f.deliveries(row)), before.siblings)
    assert.deepEqual(await f.post(unknown.postNo), before.unknown)
    assert.equal((await f.show(row)).enabled, true)
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: settled.postNo } }), PublishingStoreError, 404)
    const after = await f.status()
    assert.equal(after.definitions, before.status.definitions)
    assert.equal(after.deliveries, before.status.deliveries - 1)
    assert.equal(after.receipts, before.status.receipts + 1)
    f.advance(third.dueAt - f.now())
    await f.sent(await f.reserve(third))
    assert.equal((await f.deliveries(row)).find(value => value.deliveryId === third.deliveryId)!.state, "sent")
})

test("schedules reconcile only a known exact post and forget settled tracking without rewriting uncertain audit", async t => {
    const f = await fixture(t), row = await f.open("known-reconcile"), pending = (await f.deliveries(row))[0]!
    f.advance(pending.dueAt - f.now())
    const grant = await f.reserve(pending), messageId = f.source().messageId
    assert((await f.dispatch(grant)).claimed)
    assert.deepEqual(await f.outcome(grant, "uncertain", messageId), { recorded: true })
    const audit = (await f.post(grant.postNo)).attempt
    const cancelled = scheduleResult(await f.manage({ type: "cancel", scheduleNo: row.scheduleNo, expectedRevision: row.revision }))
    f.advance(grant.dispatchExpiresAt + 10001 - f.now())
    const input: Extract<C.SchedulesManageOperation, { type: "reconcile" }> = { type: "reconcile", scheduleNo: row.scheduleNo, expectedRevision: cancelled.revision,
        deliveryId: pending.deliveryId, attemptId: grant.attemptId, expectedGeneration: grant.generation,
        observation: { observedAt: f.now(), messageId, channelId: grant.channelId, botId: grant.botId, content: grant.content } }
    await f.reject(f.store.manage(f.manageInput({ ...input, observation: { ...input.observation, messageId: f.source().messageId } })), SchedulesStoreError, 409)
    assert.deepEqual((await f.post(grant.postNo)).attempt, audit)
    const reconciled = await f.manage(input)
    assert(!reconciled.duplicate && reconciled.type === "reconciled" && reconciled.recorded)
    assert.equal(reconciled.post.outcome, "uncertain")
    assert.equal(reconciled.post.attempt.resolution?.matched, "intended")
    for (const field of ["outcome", "attemptId", "generation", "sourceId", "content", "canonicalContent", "consumer", "provenance", "dispatchedAt", "finishedAt", "messageId"] as const) assert.deepEqual(reconciled.post.attempt[field], audit[field])
    const current = await f.show(row)
    const forgotten = await f.manage({ type: "forget", scheduleNo: row.scheduleNo, expectedRevision: current.revision, confirm: "forget" })
    assert(!forgotten.duplicate && forgotten.type === "forgotten" && forgotten.complete)
    await f.reject(f.store.query(f.queryInput({ type: "show", scheduleNo: row.scheduleNo })), SchedulesStoreError, 404)
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: grant.postNo } }), PublishingStoreError, 404)
    const status = await f.status()
    assert.equal(status.definitions, 0)
    assert.equal(status.deliveries, 0)
})
