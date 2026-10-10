import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { eventDelivery, eventNow, eventOccurrence, eventsBoundary } from "./event-fixture.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { EventsStoreError } from "../src/event-store.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { eventTimerGrant } from "./event-fixture.ts"
import { createEventCalendar } from "../src/event-calendar.ts"

type Embed = { title?: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }
const send = (bot: Effect.Success<ReturnType<typeof createTestBot>>, p: ReturnType<typeof platform>, content: string) => Effect.gen(function* () {
    yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle()
    return reply.body as { content?: string, embeds?: Embed[] }
})
const say = (bot: Effect.Success<ReturnType<typeof createTestBot>>, p: ReturnType<typeof platform>, content: string) => send(bot, p, content).pipe(Effect.map(body => body.content ?? JSON.stringify(body.embeds)))
const card = (bot: Effect.Success<ReturnType<typeof createTestBot>>, p: ReturnType<typeof platform>, content: string) => send(bot, p, content).pipe(Effect.map(body => body.embeds![0]!))

test("guild public event commands name the event, use fresh native membership and view without ManageRoles, raw epoch stays exact", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory, botPermissions: Permissions.ViewChannel | Permissions.SendMessages })
        p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], joined_at: "2026-01-01T00:00:00.123456789+00:00", communication_disabled_until: null }) })
        yield* bot.ready()
        for (const content of ["!event list", "!event show Study", "!event dates study", "!event attendees study 1"]) yield* say(bot, p, content)
        assert.equal(yield* say(bot, p, "!event rsvp study 1 going"), "Event study, date 1: You're going, and you have a seat")
        const source = remote.calls.find(c => c.method === "rsvp")!.input as C.EventsRsvpRequest
        assert.equal(source.eventNo, 1)
        assert.equal(source.context.member!.joinedAt, "2026-01-01T00:00:00.123456789+00:00")
        assert.equal(source.context.member!.canView, true); assert.equal(source.context.member!.canReadHistory, true)
        assert(source.createdAt > 0 && source.messageId.length > 0)
        const queries = remote.calls.filter(c => c.method === "query").map(c => c.input as C.EventsQueryRequest)
        assert(queries.every(q => q.context.channelId === f.ids.channel))
        // Each named command finds the event by its lowercased name first, and the later steps use its number
        assert.deepEqual(queries.map(q => q.operation), [{ type: "list" }, { type: "show", name: "study" }, { type: "show", name: "study" }, { type: "dates", eventNo: 1 },
            { type: "show", name: "study" }, { type: "attendees", eventNo: 1, occurrenceNo: 1 }, { type: "show", name: "study" }])
        for (const request of p.replies.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(bot.failures().length, 0)
    })))
})
test("a repeating event's reminders name each date by its start, share one hint, and the card says where it was posted", async () => {
    const f = createFixtures(), publishing = publishingBoundary(), messageId = "123456789012345698"
    const delivery = (index: number, overrides: Partial<C.EventsDelivery>) => eventDelivery(remote.event, { deliveryId: `synthetic_event_delivery_${index}`, occurrenceNo: index + 4,
        startsAt: remote.event.calendar!.dates[index]!.startsAt, dueAt: remote.event.calendar!.dates[index]!.startsAt - 3600000, ...overrides })
    const remote = eventsBoundary({
        delivery: () => Effect.succeed<C.EventsDeliveryResult>({ type: "deliveries", deliveries: [delivery(0, { state: "sent" }), delivery(1, { state: "uncertain", postNo: 7 }), delivery(2, {})] }),
    }), query = remote.store.query
    remote.store.query = input => input.operation.type === "status" ? Effect.succeed<C.EventsQueryResult>({ type: "status", settings: { enabled: true, revision: 1, threads: false }, definitions: 45, occurrences: 3, rsvps: 39999, receipts: 0 })
        : query(input)
    Object.assign(remote.event, { calendar: createEventCalendar("2026-01-02T01:00", "UTC", 60, "reject", { type: "weekly", interval: 1, count: 3 }) })
    publishing.posts.set(1, { postNo: 1, generation: 1, botId: f.ids.bot, channelId: f.ids.channel, messageId, outcome: "sent", createdAt: eventNow, updatedAt: eventNow,
        consumer: { type: "event", eventNo: 1, revision: 2, purpose: "card" }, attempt: { ...eventTimerGrant(), postNo: 1, messageId, outcome: "sent", createdAt: eventNow } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store, publishing: publishing.store })), p = platform(bot)
        yield* bot.ready()
        const status = yield* card(bot, p, "!event status study"), dates = remote.event.calendar!.dates.map(date => date.startsAt / 1000)
        assert.deepEqual(status.description!.split("\n"), [`**<t:${dates[0]}:f>, 1 hour before:** Sent, was due <t:${dates[0]! - 3600}:f>`, `**<t:${dates[1]}:f>, 1 hour before:** Not confirmed yet, post #7`,
            `**<t:${dates[2]}:f>, 1 hour before:** Due <t:${dates[2]! - 3600}:f>`, "Check a reminder that is not confirmed with `!event reconcile study <post>`"])
        assert.match(status.fields![1]!.value, new RegExp(`^Posted in <#${f.ids.channel}> <t:\\d+:R>\\. \\[Open it\\]\\(https://\\S+/channels/${f.ids.guild}/${f.ids.channel}/${messageId}\\)$`))
        // Limits show only once nearly reached
        assert.deepEqual((yield* card(bot, p, "!event status")).fields!.slice(2), [{ name: "Events", value: "45 of 50" }, { name: "Dates", value: "3" }])
    })))
})

test("event lists, dates, attendees and delivery status continue with next and name the event", async () => {
    const f = createFixtures(), base = eventsBoundary(), event = base.event, occurrence = eventOccurrence(event), asked: unknown[] = []
    const attendee: C.EventsRsvp = { eventNo: 1, occurrenceNo: 1, userId: "123456789012345679", joinedAt: "2026-01-01T00:00:00Z", membershipGeneration: 1, revision: 1, choice: "going", allocation: "seat", acceptedCreatedAt: 0, acceptedMessageId: "123456789012345682" }
    const remote = eventsBoundary({
        query: input => {
            const op = input.operation
            if (op.type === "show") return base.store.query(input)
            asked.push(op)
            return Effect.succeed<C.EventsQueryResult>(op.type === "list" ? { type: "events", events: op.beforeEventNo ? [] : [event], ...(op.beforeEventNo ? {} : { nextBeforeEventNo: 1 }) }
                : op.type === "dates" ? { type: "dates", dates: [occurrence], ...(op.afterOccurrenceNo ? {} : { nextAfterOccurrenceNo: 1 }) }
                    : { type: "attendees", attendees: [attendee], ...(op.type === "attendees" && op.afterUserId ? {} : { nextAfterUserId: attendee.userId }) })
        },
        delivery: input => {
            const op = input.operation
            if (op.type !== "status") return base.store.delivery(input)
            asked.push(op)
            return Effect.succeed<C.EventsDeliveryResult>({ type: "deliveries", deliveries: [eventDelivery(event, { postNo: 2, attemptId: "synthetic_event_attempt" })], ...(op.afterDeliveryId ? {} : { nextAfterDeliveryId: "synthetic_event_delivery" }) })
        },
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot)
        yield* bot.ready()
        const next = (command: string) => [{ name: "Next", value: `\`${command} next\`` }]
        const first = yield* card(bot, p, "!event list")
        assert.deepEqual([first.title, first.description, first.fields, first.footer?.text], ["Events", "**study** Study, open\nDetails: `!event show <name>`", next("!event list"), undefined])
        assert.deepEqual((yield* card(bot, p, "!event list next")).description, "No events in this channel yet")
        assert.equal(yield* say(bot, p, "!event list next"), "There is no next page to show. Send !event list to start the list again")
        const start = occurrence.startsAt / 1000, dates = yield* card(bot, p, "!event dates study")
        // One compact line per date, and the rsvp hint once
        assert.deepEqual([dates.title, dates.description, dates.fields], ["Event study dates", `**Date 1** <t:${start}:f>, 0 going\nReply with \`!event rsvp study <date> going|maybe|not-going|none\``, next("!event dates study")])
        assert.equal((yield* card(bot, p, "!event dates study next")).fields, undefined)
        assert.equal(yield* say(bot, p, "!event dates study next"), "There is no next page to show. Send !event dates study to start the list again")
        const attendees = yield* card(bot, p, "!event attendees study 1")
        assert.deepEqual([attendees.title, attendees.description, attendees.fields], ["Event study, date 1", "<@123456789012345679>: Going, has a seat", next("!event attendees study 1")])
        assert.equal((yield* card(bot, p, "!event attendees study 1 next")).fields, undefined)
        assert.equal(yield* say(bot, p, "!event attendees study 1 next"), "There is no next page to show. Send !event attendees study 1 to start the list again")
        // Each reminder says when it is due as a timestamp in the reader's time
        const status = yield* card(bot, p, "!event status study")
        // A one-date event's reminders name no date, and the card names no internal number
        assert.deepEqual([status.title, status.description, status.fields], ["Event study reminders", `**1 hour before:** Due <t:${eventNow / 1000}:f>`,
            [{ name: "Event", value: "Open" }, { name: "Card", value: `Published in <#${f.ids.channel}>` }, ...next("!event status study")]])
        assert.equal((yield* card(bot, p, "!event status study next")).fields!.length, 2)
        assert.equal(yield* say(bot, p, "!event status study next"), "There is no next page to show. Send !event status study to start the list again")
        assert.deepEqual(asked, [{ type: "list" }, { type: "list", beforeEventNo: 1 }, { type: "dates", eventNo: 1 }, { type: "dates", eventNo: 1, afterOccurrenceNo: 1 },
            { type: "attendees", eventNo: 1, occurrenceNo: 1 }, { type: "attendees", eventNo: 1, occurrenceNo: 1, afterUserId: attendee.userId },
            { type: "status", eventNo: 1 }, { type: "status", eventNo: 1, afterDeliveryId: "synthetic_event_delivery" }])
        assert.equal(bot.failures().length, 0)
    })))
})
test("event management requires fresh owner/admin and exact forget confirmation makes no mutation", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        yield* bot.ready()
        assert.match(yield* say(bot, p, "!event module on"), /Only the server owner/)
        assert.equal(remote.calls.length, 0)
        p.guildRoute.remove(); bot.rest.respond("GET /guilds/:id", { body: bot.fixtures.guild({ owner_id: f.ids.user }) })
        assert.match(yield* say(bot, p, "!event forget study"), /Confirm: `!event forget study confirm`$/)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        yield* say(bot, p, "!event forget study confirm")
        const write = remote.calls.find(c => c.method === "manage")!.input as C.EventsManageRequest
        assert.deepEqual(write.operation, { type: "forget", eventNo: 1, expectedRevision: 2, confirm: "forget" })
    })))
})
test("an unfinished forget continues with the event's name", async () => {
    const f = createFixtures(), remote = eventsBoundary({ manage: () => Effect.succeed<C.EventsManageResult>({ duplicate: false, type: "forgotten", eventNo: 1, complete: false, removed: 20 }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot)
        yield* bot.ready()
        assert.equal(yield* say(bot, p, "!event forget study confirm"), "Removed 20 records of event study so far\nContinue: `!event forget study confirm`")
    })))
})
test("template, module and threads changes read the current revisions right before the write", async () => {
    const f = createFixtures(), remote = eventsBoundary(), publishing = publishingBoundary(), content = { content: "Synthetic notice" }
    publishing.drafts.set("template:notice", { kind: "template", name: "notice", revision: 4, content, canonicalContent: canonicalPublishingContent(content), createdAt: 0, updatedAt: 0 })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { publishing: publishing.store, events: remote.store })), p = platform(bot)
        yield* bot.ready()
        for (const content of ["!event template study notice", "!event template study off", "!event module on", "!event threads off"]) yield* say(bot, p, content)
        assert.deepEqual(remote.calls.filter(c => c.method === "manage").map(c => (c.input as C.EventsManageRequest).operation), [
            { type: "template", eventNo: 1, expectedRevision: 2, templateName: "notice", expectedTemplateRevision: 4 },
            { type: "template", eventNo: 1, expectedRevision: 2, templateName: null },
            { type: "settings", enabled: true, expectedRevision: 1 },
            { type: "threads", enabled: false, expectedRevision: 1 },
        ])
        assert.deepEqual(publishing.calls.map(c => (c.input as C.PublishingQueryRequest).operation).filter(op => op?.type === "draft-show"), [{ type: "draft-show", kind: "template", name: "notice" }])
        assert.equal(bot.failures().length, 0)
    })))
})
test("DEFCON blocks public events and preserves authorized critical disable, cancellation and status", async () => {
    const f = createFixtures(), remote = eventsBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, events: remote.store })), p = platform(bot)
        yield* bot.ready()
        moderation.current.defcon = 2
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event rsvp study 1 going" })); yield* bot.idle()
        assert.equal(remote.calls.some(c => c.method === "rsvp"), false)
        moderation.current.defcon = 1
        for (const content of ["!event module off", "!event cancel study", "!event status"]) yield* say(bot, p, content)
        assert.equal(remote.calls.filter(c => c.method === "manage").length, 2)
        assert(moderation.calls.filter(c => c.method === "gate").slice(-3).every(c => (c.input as C.ModerationGateRequest).command === "critical"))
    })))
})
test("malformed event namespace is consumed and HTTP conflicts say to send the command again", async () => {
    const f = createFixtures(), remote = eventsBoundary({ rsvp: () => Effect.fail(new EventsStoreError({ operation: "rsvp", status: 409 })) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot)
        yield* bot.ready()
        for (const content of ['!event time "broken', "!event unknown", "!event publish study 3", "!event rsvp study 1 none"])
            assert.match(yield* say(bot, p, content), content.includes(" rsvp ") ? /The event changed[^]*send the command again/ : /!event help/)
        const before = remote.calls.length
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: "!event list" })); yield* bot.idle()
        assert.equal(remote.calls.length, before)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        assert.equal(bot.failures().length, 0)
    })))
})

test("even an administrator's public event details stay in the actual destination and native visibility fails closed", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    remote.event.channelId = "123456789012345699"
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot)
        yield* bot.ready()
        assert(!(yield* say(bot, p, "!event show study")).includes("Study"))
        p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], communication_disabled_until: "2099-01-01T00:00:00Z" }) })
        yield* say(bot, p, "!event rsvp study 1 going")
        assert.equal(remote.calls.some(c => c.method === "rsvp"), false)
    })))
})

test("draft configuration uses fresh staff authority without native send/embed permissions and binds full calendar DTOs", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    delete remote.event.cardPostNo
    remote.event.state = "draft"
    remote.store.manage = input => Effect.sync((): C.EventsManageResult => {
        remote.calls.push({ method: "manage", input })
        const op = input.operation
        return { duplicate: false, type: "event", event: { ...remote.event, ...op.type === "calendar" ? { calendar: op.calendar } : op.type === "capacity" ? { capacity: op.capacity } : {} } }
    })
    // A zone without daylight saving keeps the offset fixed for a week from now
    const start = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot, { botPermissions: Permissions.ViewChannel })
        yield* bot.ready()
        const replies: string[] = []
        for (const content of [`!event create study <#${f.ids.channel}> "Study group"`, `!event time study ${start} Asia/Tokyo 60 reject`, "!event capacity study 5"]) replies.push(yield* say(bot, p, content))
        const writes = remote.calls.filter(c => c.method === "manage").map(c => c.input as C.EventsManageRequest)
        // A new event shows its detail, and each change answers with one line that names it
        assert.equal((JSON.parse(replies[0]!) as Embed[])[0]!.title, "Event study")
        const date = writes[1]!.operation.type === "calendar" ? writes[1]!.operation.calendar.dates[0]! : undefined
        assert.deepEqual(replies.slice(1), [`Event study now runs once, <t:${date!.startsAt / 1000}:f> to <t:${date!.endsAt / 1000}:f>`, "Event study now has 5 seats"])
        assert.equal(writes.length, 3)
        assert.equal(writes[0]!.operation.type, "create")
        const calendar = writes[1]!.operation
        assert.equal(calendar.type, "calendar")
        if (calendar.type === "calendar") {
            assert.equal(calendar.calendar.zone, "Asia/Tokyo")
            assert.equal(calendar.calendar.dates[0]!.offsetMinutes, 540)
            assert.equal(calendar.calendar.dates[0]!.localMinute, start)
            assert.equal(calendar.expectedRevision, 2)
        }
        assert.deepEqual(writes[2]!.operation, { type: "capacity", eventNo: 1, expectedRevision: 2, capacity: 5 })
        assert(writes.every(w => w.context.actor.isOwner && w.context.botAuthorized))
        assert.equal(bot.failures().length, 0)
    })))
})
test("event reconciliation observes only an exact protected known message and unknown IDs never trigger native search", async () => {
    const f = createFixtures(), remote = eventsBoundary(), publishing = publishingBoundary(), grant = eventTimerGrant()
    const messageId = "123456789012345698"
    publishing.posts.set(2, { postNo: 2, generation: 1, botId: f.ids.bot, channelId: f.ids.channel, messageId, outcome: "uncertain", createdAt: 0, updatedAt: 0, consumer: grant.consumer,
        attempt: { ...grant, messageId, outcome: "uncertain", createdAt: 0 } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { publishing: publishing.store, events: remote.store })), p = platform(bot)
        const native = bot.rest.respond(`GET /channels/${f.ids.channel}/messages/${messageId}`, { body: bot.fixtures.message({ id: messageId, author: bot.fixtures.botUser(), content: grant.content.content,
            embeds: [{ type: "rich", ...grant.content.embed!, color: 0, fields: grant.content.embed!.fields!.map(field => ({ ...field, inline: field.inline ?? false })) }] }) })
        yield* bot.ready()
        assert.equal(yield* say(bot, p, "!event reconcile study 2"), `The reminder of event study could not be confirmed, because its message in <#${f.ids.channel}> does not match what NeonFlux sent. Nothing was sent, edited or deleted`)
        assert.equal(native.requests().length, 1)
        assert.equal(publishing.calls.filter(c => c.method === "reconcile").length, 1)
        const observation = (publishing.calls.find(c => c.method === "reconcile")!.input as C.PublishingReconcileRequest).observation
        assert.equal(observation.content.embed!.color, 0)
        assert.equal(observation.messageId, messageId)
        assert.equal(publishing.posts.get(2)!.attempt.outcome, "uncertain")
        assert.equal(publishing.calls.filter(c => c.method === "dispatch").length, 0)
        delete publishing.posts.get(2)!.messageId
        assert.equal(yield* say(bot, p, "!event reconcile study 2"), "NeonFlux does not know which message post #2 is, so it cannot check it. Nothing was sent again")
        assert.equal(native.requests().length, 1)
    })))
})
