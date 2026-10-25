import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import type {
    MilestonesContext,
    MilestonesDelivery,
    MilestonesDeliveryGrant,
    MilestonesParticipantContext,
} from "@neonflux/contracts/milestones"
import schema from "../convex/schema.ts"
import { cleanupMilestones } from "../convex/milestonesCleanup.ts"
import { milestoneAnnual, milestoneCivil, milestoneMonthDay, renderMilestone } from "../convex/milestonesDomain.ts"
import { publicMilestoneDelivery } from "../convex/milestonesStore.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import { botCall } from "./bot-service.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID,
    oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-milestones-secret-not-a-credential-000"
beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = "1"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = oldServer
    if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = oldSecret
})
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/milestones.ts": () => import("../convex/milestones.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
    "../convex/milestonesCleanup.ts": () => import("../convex/milestonesCleanup.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
async function read(response: Response): Promise<any> {
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json()))
    assert(!JSON.stringify(await response.json()).includes(secret))
}
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"),
        sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true }),
        source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (): MilestonesContext => ({
        observedAt: now,
        actor: owner,
        channelId: "30",
        botId: "999",
        botAuthorized: true,
        actorAuthorized: true,
        member: {
            userId: "10",
            joinedAt: "2024-01-01T00:00:00.000001Z",
            roleIds: [],
            isBot: false,
            timeoutUntil: null,
            canView: true,
            canReadHistory: true,
        },
    })
    const participant = (userId = "20", joinedAt = "2024-01-01T00:00:00.000001Z"): MilestonesParticipantContext => ({
        observedAt: now,
        channelId: "30",
        botId: "999",
        member: {
            userId,
            joinedAt,
            roleIds: [],
            isBot: false,
            timeoutUntil: null,
            canView: true,
            canReadHistory: true,
        },
        userName: "Synthetic *member*",
        serverName: "Synthetic server",
    })
    const identity = (userId = "20") => ({
        userId,
        channelId: "90",
        isDirectMessage: true,
        isBot: false,
        observedAt: now,
    })
    const http = (path: string, body: unknown, auth = true) => botCall(db, path, body, auth ? {} : { secret: null })
    const manage = (operation: unknown, current = context()) =>
        http("/milestones/manage", { ...source(), context: current, operation })
    const query = (operation: unknown) => http("/milestones/query", { serverId: "1", context: context(), operation })
    const personal = (operation: unknown, userId = "20") =>
        http("/milestones/personal", { ...source(), identity: identity(userId), operation })
    const delivery = (operation: unknown) => http("/milestones/delivery", { serverId: "1", operation })
    const publish = (operation: unknown) => http("/publishing/manage", { ...source(), actor: owner, operation })
    await read(await publish({ type: "draft-create", kind: "template", name: "celebrate" }))
    await read(
        await publish({
            type: "draft-update",
            kind: "template",
            name: "celebrate",
            expectedRevision: 1,
            edit: { type: "content", content: "Celebrating {user} at {server}" },
        }),
    )
    const configure = (
        kind = "birthday",
        revision = 0,
        channelId = "30",
        zone = "UTC",
        time = "00:02",
        fold = "reject",
    ) =>
        manage(
            {
                type: "configure",
                kind,
                expectedRevision: revision,
                channelId,
                zone,
                time,
                fold,
                template: { name: "celebrate", revision: 2 },
            },
            { ...context(), channelId },
        )
    const routes = () =>
        query({ type: "settings" })
            .then(read)
            .then((result) => result.routes)
    const change = async (type: string, kind = "birthday", extra: object = {}) =>
        manage({ type, kind, expectedRevision: (await routes()).find((r: any) => r.kind === kind).revision, ...extra })
    const enroll = (kind = "birthday", monthDay = "01-01", userId = "20", proof = participant(userId)) =>
        personal(
            {
                type: "enroll",
                kind,
                ...(kind === "birthday" ? { monthDay } : {}),
                confirmChannelId: proof.channelId,
                participant: proof,
            },
            userId,
        )
    const open = async () => {
        await read(await manage({ type: "settings", expectedRevision: 1, enabled: true }))
        await read(await configure())
        await read(await change("enable"))
        await read(await enroll())
    }
    // The rows staff list, with the times staff do not see for birthdays
    const deliveries = async (kind = "birthday"): Promise<MilestonesDelivery[]> => {
        const listed: { deliveryId: string }[] = (await read(await query({ type: "deliveries", kind }))).deliveries
        return db.run(async (ctx) => {
            const rows = []
            for (const row of listed)
                rows.push(
                    publicMilestoneDelivery(
                        (await ctx.db.get(ctx.db.normalizeId("milestoneDeliveries", row.deliveryId)!))!,
                    ),
                )
            return rows
        })
    }
    const binding = (row: MilestonesDelivery) => ({
        deliveryId: row.deliveryId,
        kind: row.kind,
        intentRevision: row.intentRevision,
        userId: row.userId,
        joinedAt: row.joinedAt,
        consentRevision: row.consentRevision,
        audienceGeneration: row.audienceGeneration,
        celebrationYear: row.celebrationYear,
        completedYears: row.completedYears,
        generation: row.generation,
    })
    const automation = (): unknown => ({ observedAt: now, channelId: "30", botId: "999", botAuthorized: true })
    const reserve = (row: MilestonesDelivery, proof = participant(row.userId, row.joinedAt), current = automation()) =>
        delivery({ type: "reserve", binding: binding(row), context: { automation: current, participant: proof } })
    const dispatch = (
        grant: MilestonesDeliveryGrant,
        proof = participant(grant.consumer.userId, grant.consumer.joinedAt),
    ) =>
        http("/publishing/dispatch", {
            serverId: "1",
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            generation: grant.generation,
            sourceId: grant.sourceId,
            claimToken: "a".repeat(32),
            milestoneContext: { automation: automation(), participant: proof },
        })
    const outcome = (grant: MilestonesDeliveryGrant, value = "sent") =>
        http("/publishing/outcome", {
            serverId: "1",
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            generation: grant.generation,
            sourceId: grant.sourceId,
            claimToken: "a".repeat(32),
            outcome: value,
            ...(value === "sent" ? { messageId: "8000" } : {}),
        })
    const cleanup = () => db.run((ctx) => retentionPass(ctx, cleanupMilestones))
    return {
        db,
        source,
        context,
        participant,
        identity,
        http,
        manage,
        query,
        personal,
        delivery,
        publish,
        configure,
        routes,
        change,
        enroll,
        open,
        deliveries,
        binding,
        reserve,
        dispatch,
        outcome,
        cleanup,
        advance: (ms: number) => {
            now += ms
        },
        setNow: (value: number) => {
            now = value
        },
        now: () => now,
    }
}

test("Milestone indexes have no duplicate field sets", () => {
    for (const name of [
        "milestoneSettings",
        "milestoneRoutes",
        "milestoneMembers",
        "milestoneEnrollments",
        "milestoneDeliveries",
        "milestoneReceipts",
        "milestoneConsumed",
        "publishingPosts",
        "publishingAttempts",
    ] as const) {
        const indexes = schema.tables[name][" indexes"]().map((index) => JSON.stringify(index.fields))
        assert.equal(new Set(indexes).size, indexes.length, name)
    }
})
test("Annual civil rules cover leap fallback, raw membership timezone years and skipped gaps/folds", () => {
    for (const value of ["13-01", "00-00", "02-30", "04-31", "2020-01-01", "1-01", "01-1"])
        assert.throws(
            () => milestoneMonthDay(value),
            (error) => (error as { data: { status: number } }).data?.status === 400,
        )
    assert.equal(milestoneMonthDay("02-29"), "02-29")
    const utc = { zone: "UTC", time: "09:00", fold: "reject" as const }
    assert.equal(
        milestoneAnnual("birthday", "2020-01-01T00:00Z", "02-29", utc, 2027).instantAt,
        Date.parse("2027-02-28T09:00Z"),
    )
    assert.equal(
        milestoneAnnual("anniversary", "2024-02-29T00:00Z", undefined, utc, 2027).instantAt,
        Date.parse("2027-02-28T09:00Z"),
    )
    assert.equal(
        milestoneAnnual(
            "anniversary",
            "2024-12-31T23:30:00.000001Z",
            undefined,
            { ...utc, zone: "Europe/Berlin" },
            2026,
        ).completedYears,
        1,
    )
    assert.equal(
        milestoneAnnual(
            "birthday",
            "2020-01-01T00:00Z",
            "03-29",
            { zone: "Europe/Berlin", time: "02:30", fold: "reject" },
            2026,
        ).reason,
        "civil-gap",
    )
    assert.equal(
        milestoneAnnual(
            "birthday",
            "2020-01-01T00:00Z",
            "10-25",
            { zone: "Europe/Berlin", time: "02:30", fold: "reject" },
            2026,
        ).reason,
        "civil-fold",
    )
    const earlier = milestoneAnnual(
            "birthday",
            "2020-01-01T00:00Z",
            "10-25",
            { zone: "Europe/Berlin", time: "02:30", fold: "earlier" },
            2026,
        ),
        later = milestoneAnnual(
            "birthday",
            "2020-01-01T00:00Z",
            "10-25",
            { zone: "Europe/Berlin", time: "02:30", fold: "later" },
            2026,
        )
    assert.equal(later.instantAt - earlier.instantAt, 3600000)
    assert.throws(() => renderMilestone({ content: "{years}" }, "birthday", "Test", "Server", 0))
})
test("An unknown timezone is refused in words the bot shows", () => {
    assert.throws(
        () => milestoneCivil({ zone: "Not/AZone", time: "12:00", fold: "reject" }),
        (error: { data?: { status?: number; code?: string; error?: string } }) =>
            error.data?.status === 400 &&
            error.data.code === "REFUSED" &&
            /valid IANA timezone/.test(error.data.error!),
    )
    assert.equal(milestoneCivil({ zone: "Europe/Berlin", time: "12:00", fold: "reject" }).zone, "Europe/Berlin")
})
test("The anniversary line counts one year in the singular", () => {
    const line = (years: number) => renderMilestone({ content: "" }, "anniversary", "Test", "Server", years).content
    assert.equal(line(1), "Membership anniversary (1 completed year)")
    assert.equal(line(3), "Membership anniversary (3 completed years)")
})
test("Authenticated private author, explicit destination and fresh participant evidence bound enrollment", async (t) => {
    const f = await fixture(t)
    await status(
        await f.http(
            "/milestones/query",
            { serverId: "1", context: f.context(), operation: { type: "status" } },
            false,
        ),
        401,
    )
    await read(await f.configure())
    for (const monthDay of ["13-01", "00-00", "02-30", "2020-01-01"])
        await status(await f.enroll("birthday", monthDay), 400)
    const op = {
        type: "enroll",
        kind: "birthday",
        monthDay: "01-01",
        confirmChannelId: "30",
        participant: f.participant(),
    }
    // The contract allows only isDirectMessage true, so false is malformed. A DM from another member is refused
    await status(
        await f.http("/milestones/personal", {
            ...f.source(),
            identity: { ...f.identity(), isDirectMessage: false },
            operation: op,
        }),
        400,
    )
    await status(
        await f.http("/milestones/personal", { ...f.source(), identity: f.identity("21"), operation: op }),
        403,
    )
    await status(await f.personal({ ...op, confirmChannelId: "31" }), 409)
    await read(await f.enroll())
    assert.equal((await read(await f.personal({ type: "me" }, "21"))).enrollments.length, 0)
    const receipts = await f.db.run((ctx) => ctx.db.query("milestoneReceipts").collect())
    assert(!JSON.stringify(receipts).includes("01-01"))
    assert(receipts.filter((r) => r.category === "member").every((r) => /^[a-f0-9]{64}$/.test(r.operationKey)))
})
test("Actual source idempotency rejects changed private operation and stale enrollment after removal", async (t) => {
    const f = await fixture(t)
    await read(await f.configure())
    const src = f.source(),
        request = {
            ...src,
            identity: f.identity(),
            operation: {
                type: "enroll",
                kind: "birthday",
                monthDay: "01-01",
                confirmChannelId: "30",
                participant: f.participant(),
            },
        }
    await read(await f.http("/milestones/personal", request))
    assert.deepEqual(await read(await f.http("/milestones/personal", request)), { duplicate: true })
    await status(
        await f.http("/milestones/personal", { ...request, operation: { ...request.operation, monthDay: "02-01" } }),
        409,
    )
    const delayed = { ...f.source(), identity: f.identity(), operation: request.operation }
    f.advance(1)
    await read(await f.personal({ type: "remove", kind: "all" }))
    await status(await f.http("/milestones/personal", delayed), 409)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
})
test("The profile's birthday choice lives on the birthday sign-up, so every new sign-up starts without it", async (t) => {
    const f = await fixture(t)
    await f.open()
    const birthday = () =>
        f.db.run((ctx) =>
            ctx.db
                .query("milestoneEnrollments")
                .withIndex("by_user_kind", (q) => q.eq("serverId", "1").eq("userId", "20").eq("kind", "birthday"))
                .unique(),
        )
    // The website sets it on the current sign-up, see profiles.test.ts
    const choose = async () => {
        const row = await birthday()
        assert.ok(row)
        await f.db.run((ctx) => ctx.db.patch(row._id, { showOnProfile: true }))
    }
    const shown = async () => {
        const row = await birthday()
        return row ? (row.showOnProfile ?? false) : "no sign-up"
    }
    await read(await f.enroll("birthday", "03-03"))
    assert.equal(await shown(), false)
    await choose()
    assert.equal(await shown(), true)
    // A new date is a new sign-up
    f.advance(1)
    await read(await f.enroll("birthday", "05-05"))
    assert.equal(await shown(), false)
    // Removing and adding the birthday again
    await choose()
    f.advance(1)
    await read(await f.personal({ type: "remove", kind: "birthday" }))
    assert.equal(await shown(), "no sign-up")
    f.advance(1)
    await read(await f.enroll())
    assert.equal(await shown(), false)
    // Leaving the server and joining again
    await choose()
    const target = (await read(await f.delivery({ type: "member-targets", userId: "20" }))).targets.find(
        (row: { kind: string }) => row.kind === "birthday",
    )
    await read(
        await f.delivery({
            type: "member-observation",
            target,
            observation: { observedAt: f.now(), userId: "20", status: "absent" },
        }),
    )
    assert.equal(await shown(), "no sign-up")
    f.advance(1)
    await read(await f.enroll("birthday", "04-04", "20", f.participant("20", "2025-06-01T00:00:00.000001Z")))
    assert.equal(await shown(), false)
    // Deleting member data removes the sign-up with its choice
    await choose()
    const deleted = await f.http("/service/member-data/delete", {
        userId: "20",
        userName: "Synthetic member",
        serverId: "1",
        cursor: null,
    })
    assert.equal(deleted.status, 200)
    assert.equal(await shown(), "no sign-up")
})

test("List to publisher atomically binds the bot and member, resumes exact attempt, suppresses raw birthday", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const listed = await read(await f.delivery({ type: "list" })),
        row = listed.deliveries[0] as MilestonesDelivery
    assert(row)
    assert.equal(row.userId, "20")
    const grant = (await read(await f.reserve(row))).grant as MilestonesDeliveryGrant
    assert.equal(grant.source.type, "milestone-timer")
    assert.equal(grant.consumer.type, "milestone")
    assert.equal(grant.actorId, "999")
    assert.equal(grant.content.content, "Birthday celebration\nCelebrating Synthetic \\*member\\* at Synthetic server")
    assert(!JSON.stringify(grant).includes('"monthDay"'))
    assert.equal((await read(await f.reserve(row))).grant.attemptId, grant.attemptId)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    await read(await f.outcome(grant))
    await status(await f.publish({ type: "forget", postNo: grant.postNo, expectedGeneration: grant.generation }), 409)
    await read(await f.query({ type: "status" }))
})
test("Staff see when an anniversary is due but no time of a birthday", async (t) => {
    const f = await fixture(t)
    await f.open()
    await read(await f.configure("anniversary"))
    await read(await f.change("enable", "anniversary"))
    await read(await f.enroll("anniversary"))
    const listed = async (kind: string) =>
        (await read(await f.query({ type: "deliveries", kind }))).deliveries as Record<string, unknown>[]
    const [birthday] = await listed("birthday"),
        [anniversary] = await listed("anniversary")
    assert.equal(birthday!.state, "queued")
    for (const key of ["dueAt", "nextCheckAt", "claimedAt"]) assert(!(key in birthday!), key)
    assert.equal(anniversary!.dueAt, (await f.deliveries("anniversary"))[0]!.dueAt)
})
test("Staff see no offset or clock-change reason that would give away a birthday", async (t) => {
    const f = await fixture(t)
    await read(await f.manage({ type: "settings", expectedRevision: 1, enabled: true }))
    await read(await f.configure("birthday", 0, "30", "Europe/Berlin", "02:30", "reject"))
    await read(await f.change("enable"))
    await read(await f.enroll("birthday", "03-29"))
    const [row] = (await read(await f.query({ type: "deliveries", kind: "birthday" }))).deliveries
    assert.equal(row.state, "skipped")
    assert.equal((await f.deliveries())[0]!.reason, "civil-gap")
    for (const key of ["dueAt", "offsetMinutes", "nextCheckAt", "claimedAt", "reason"]) assert(!(key in row), key)
})
test("Destination changes require consent again even on return, and other administrators can edit the route", async (t) => {
    const f = await fixture(t)
    await f.open()
    let route = (await f.routes())[0]
    await read(await f.configure("birthday", route.revision, "31"))
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments[0].needsReconsent, true)
    route = (await f.routes())[0]
    await read(await f.configure("birthday", route.revision, "30"))
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments[0].needsReconsent, true)
    await read(await f.enroll())
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments[0].needsReconsent, false)
    const admin = {
        ...f.context(),
        actor: { ...owner, userId: "11", isOwner: false, isAdministrator: true },
        member: { ...f.context().member!, userId: "11" },
    }
    route = (await f.routes())[0]
    await read(
        await f.manage(
            {
                type: "configure",
                kind: "birthday",
                expectedRevision: route.revision,
                channelId: "30",
                zone: "UTC",
                time: "00:03",
                fold: "reject",
                template: { name: "celebrate", revision: 2 },
            },
            admin,
        ),
    )
    assert.equal((await f.routes())[0].time, "00:03")
})
test("A route edit that keeps its saved template version keeps its content after the template changes or goes", async (t) => {
    const f = await fixture(t)
    await f.open()
    await read(
        await f.publish({
            type: "draft-update",
            kind: "template",
            name: "celebrate",
            expectedRevision: 2,
            edit: { type: "content", content: "A changed celebration" },
        }),
    )
    let route = (await f.routes())[0]
    await read(
        await f.manage({
            type: "configure",
            kind: "birthday",
            expectedRevision: route.revision,
            channelId: "30",
            zone: "UTC",
            time: "00:03",
            fold: "reject",
            template: { name: "celebrate", revision: 2 },
        }),
    )
    route = (await f.routes())[0]
    assert.equal(route.time, "00:03")
    assert.deepEqual(route.template, { name: "celebrate", revision: 2 })
    assert.equal(route.content.content, "Celebrating {user} at {server}")
    await read(await f.publish({ type: "draft-delete", kind: "template", name: "celebrate", expectedRevision: 3 }))
    await read(
        await f.manage({
            type: "configure",
            kind: "birthday",
            expectedRevision: route.revision,
            channelId: "30",
            zone: "UTC",
            time: "00:04",
            fold: "reject",
            template: { name: "celebrate", revision: 2 },
        }),
    )
    assert.equal((await f.routes())[0].content.content, "Celebrating {user} at {server}")
})
test("Withdrawal before claim closes attempt, after claim preserves immutable truth and never restores enrollment", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0] as MilestonesDelivery,
        grant = (await read(await f.reserve(row))).grant
    await read(await f.personal({ type: "remove", kind: "all" }))
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    const old = (await f.deliveries())[0]!
    assert.equal(old.state, "cancelled")
    await read(await f.enroll())
    const profile = (await read(await f.personal({ type: "me" }))).enrollments[0]
    assert.equal(profile.monthDay, "01-01")
    // The configured minute already passed so the same-day re-enrollment cannot catch up
    assert.equal((await read(await f.delivery({ type: "list" }))).deliveries.length, 0)
})
test("Claim then removal and late uncertain outcomes preserve truthful publisher snapshots and annual dedupe", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0],
        grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant))
    const before = await f.db.run((ctx) => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
    await read(await f.personal({ type: "remove", kind: "all" }))
    await read(await f.outcome(grant, "uncertain"))
    const after = await f.db.run((ctx) => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
    assert.deepEqual(after!.content, before!.content)
    assert.deepEqual(after!.consumer, before!.consumer)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    assert.equal((await f.db.run((ctx) => ctx.db.query("milestoneEnrollments").collect())).length, 0)
    f.advance(31 * 86400000)
    await f.cleanup()
    assert.equal((await f.db.run((ctx) => ctx.db.query("publishingAttempts").collect())).length, 1)
    assert.equal((await f.db.run((ctx) => ctx.db.query("milestoneConsumed").collect())).length, 1)
    await read(await f.enroll())
    f.advance(60000)
    await read(await f.delivery({ type: "list" }))
    assert((await f.deliveries()).some((r) => r.celebrationYear === 2027))
})
test("Exact membership observations revoke old epochs, opaque errors reject and stale target preserves re-enrollment", async (t) => {
    const f = await fixture(t)
    await f.open()
    const targets = (await read(await f.delivery({ type: "member-targets", userId: "20" }))).targets
    assert.equal(targets.length, 1)
    await status(
        await f.delivery({
            type: "member-observation",
            target: targets[0],
            observation: { observedAt: f.now(), userId: "20", status: "error" },
        }),
        400,
    )
    assert.equal(
        (
            await read(
                await f.delivery({
                    type: "member-observation",
                    target: targets[0],
                    observation: {
                        observedAt: f.now(),
                        userId: "20",
                        status: "present",
                        joinedAt: "2024-01-01T00:00:00.000002Z",
                    },
                }),
            )
        ).recorded,
        true,
    )
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    f.advance(1)
    await read(await f.enroll("birthday", "01-01", "20", f.participant("20", "2025-01-01T00:00:00.000003Z")))
    assert.equal(
        (
            await read(
                await f.delivery({
                    type: "member-observation",
                    target: targets[0],
                    observation: { observedAt: f.now(), userId: "20", status: "absent" },
                }),
            )
        ).recorded,
        false,
    )
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 1)
})
test("Module, route and publisher activation fence undispatched reservations and shortened deadlines", async (t) => {
    for (const scope of ["module", "route", "publisher"]) {
        const f = await fixture(t)
        await f.open()
        f.advance(120000)
        const row = (await read(await f.delivery({ type: "list" }))).deliveries[0],
            grant = (await read(await f.reserve(row))).grant
        if (scope === "module") {
            await read(await f.manage({ type: "settings", expectedRevision: 2, enabled: false }))
            await read(await f.manage({ type: "settings", expectedRevision: 3, enabled: true }))
        }
        if (scope === "route") {
            await read(await f.change("disable"))
            await read(await f.change("enable"))
        }
        if (scope === "publisher") {
            await read(await f.publish({ type: "settings", patch: { enabled: false } }))
            await read(await f.publish({ type: "settings", patch: { enabled: true } }))
        }
        assert.equal((await read(await f.dispatch(grant))).claimed, false)
        assert.equal((await f.deliveries())[0]!.reason, "activation-cutoff")
    }
})
test("Removal succeeds without membership or owner evidence at full account, delivery and receipt quota", async (t) => {
    const f = await fixture(t)
    await f.open()
    await f.db.run(async (ctx) => {
        const row = (await ctx.db.query("milestoneSettings").collect())[0]!
        await ctx.db.patch(row._id, { accounts: 1000, deliveries: 4000, memberReceipts: 10000 })
    })
    const result = await read(await f.personal({ type: "remove", kind: "all" }))
    assert.equal(result.removed, 1)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    assert.equal((await f.db.run((ctx) => ctx.db.query("milestoneEnrollments").collect())).length, 0)
})
test("Thirty-day cleanup retires settled owned publisher tracking and retains 400-day body-free fences", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0],
        grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant))
    await read(await f.outcome(grant))
    f.advance(30 * 86400000 + 1)
    await f.cleanup()
    const state = await read(await f.query({ type: "status" }))
    assert.equal(state.deliveries, 0)
    assert.equal((await f.db.run((ctx) => ctx.db.query("milestoneConsumed").collect())).length, 1)
    const me = await read(await f.personal({ type: "me" }))
    assert.equal(me.enrollments.length, 1)
    await read(await f.delivery({ type: "list" }))
    assert.equal((await f.deliveries())[0]!.celebrationYear, 2027)
})
test("Cleanup keeps a settled post a role panel uses and releases it once the panel lets go", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0],
        grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant))
    await read(await f.outcome(grant))
    const panel = await f.db.run((ctx) =>
        ctx.db.insert("roleReferences", {
            serverId: "1",
            consumerKey: "panel:synthetic",
            roleId: "40",
            configuration: true,
            desired: true,
            postNo: grant.postNo,
            createdAt: f.now(),
        }),
    )
    f.advance(30 * 86400000 + 1)
    await f.cleanup()
    assert.equal((await read(await f.query({ type: "status" }))).deliveries, 1)
    await f.db.run((ctx) => ctx.db.delete(panel))
    f.advance(86400000)
    await f.cleanup()
    assert.equal((await read(await f.query({ type: "status" }))).deliveries, 0)
    assert.equal((await f.db.run((ctx) => ctx.db.query("publishingPosts").collect())).length, 0)
})
test("Indexed fair source pages advance future checks and blocked head members without starving later due members", async (t) => {
    const f = await fixture(t)
    await f.open()
    for (let i = 21; i <= 43; i++) await read(await f.enroll("birthday", "01-01", String(i)))
    f.advance(120000)
    const first = await read(await f.delivery({ type: "list" }))
    assert.equal(first.deliveries.length, 20)
    assert.equal(first.hasMore, true)
    await read(await f.delivery({ type: "defer", binding: f.binding(first.deliveries[0]) }))
    const second = await read(await f.delivery({ type: "list", cursor: first.nextCursor }))
    assert.equal(second.deliveries.length, 4)
    const ids = [...first.deliveries, ...second.deliveries].map((row) => row.userId)
    assert.equal(new Set(ids).size, 24)
    const sources = await f.db.run((ctx) => ctx.db.query("milestoneEnrollments").collect())
    assert(sources.every((row) => row.nextCheckAt > f.now()))
})
test("A celebration follows its template's edits at reserve, and an invalid template sends the copy saved with the route", async (t) => {
    const edit = (f: Awaited<ReturnType<typeof fixture>>, content: string) =>
        f.publish({
            type: "draft-update",
            kind: "template",
            name: "celebrate",
            expectedRevision: 2,
            edit: { type: "content", content },
        })
    const reserved = async (f: Awaited<ReturnType<typeof fixture>>) => {
        f.advance(120000)
        const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
        const grant = (await read(await f.reserve(row))).grant
        const attempt = await f.db.run((ctx) => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
        return { grant, content: attempt!.content.content, template: (attempt!.provenance as any).template }
    }
    const followed = await fixture(t)
    await followed.open()
    await read(await edit(followed, "Happy day {user}"))
    const sent = await reserved(followed)
    assert.match(sent.content, /Happy day Synthetic/)
    assert.deepEqual(sent.template, { name: "celebrate", revision: 3 })
    const row = (await followed.db.run((ctx) => ctx.db.query("milestoneDeliveries").collect())).find(
        (r) => r.state === "reserved",
    )!
    assert.deepEqual(row.template, { name: "celebrate", revision: 3 })
    assert.equal((await read(await followed.dispatch(sent.grant))).claimed, true)
    // A birthday has no years to fill in, so that template is not valid for it and the saved copy goes out
    const kept = await fixture(t)
    await kept.open()
    await read(await edit(kept, "{years} years of {user}"))
    const copy = await reserved(kept)
    assert.match(copy.content, /Celebrating Synthetic/)
    assert.deepEqual(copy.template, { name: "celebrate", revision: 2 })
    assert.equal((await read(await kept.dispatch(copy.grant))).claimed, true)
})
test("Concurrent recovery reserves one owned attempt and competing public dispatch claims grant only once", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
    const reserved = await Promise.all([f.reserve(row).then(read), f.reserve(row).then(read)])
    assert.equal(reserved[0].grant.attemptId, reserved[1].grant.attemptId)
    const claims = await Promise.all([
        f.dispatch(reserved[0].grant).then(read),
        f.dispatch(reserved[1].grant).then(read),
    ])
    assert.equal(claims.filter((claim) => claim.claimed).length, 1)
    await read(await f.query({ type: "status" }))
})
test("An exact expired claim cannot reopen or replay a consumed year", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000 + 270000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0],
        grant = (await read(await f.reserve(row))).grant
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    f.advance(180000)
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    const attempt = await f.db.run((ctx) => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
    assert.equal(attempt!.noDispatch, true)
    assert.equal(attempt!.unresolved, false)
    f.advance(60000)
    await read(await f.delivery({ type: "list" }))
    assert.equal((await f.deliveries()).filter((row) => row.celebrationYear === 2026).length, 1)
    assert((await f.deliveries()).some((row) => row.celebrationYear === 2027 && row.state === "queued"))
})
test("Future template changes copy frozen annual instants without consulting changed timezone data", async (t) => {
    const f = await fixture(t)
    await f.open()
    const original = (await f.deliveries())[0]!,
        route = (await f.routes())[0]
    t.mock.method(Intl, "DateTimeFormat", () => {
        throw new Error("Synthetic changed timezone data")
    })
    await read(await f.configure("birthday", route.revision))
    f.advance(1000)
    await read(await f.delivery({ type: "list" }))
    f.advance(59000)
    await read(await f.delivery({ type: "list" }))
    const rows = await f.deliveries(),
        newest = rows.find((row) => row.state === "queued")!
    assert.equal(newest.dueAt, original.dueAt)
    assert.equal(newest.offsetMinutes, original.offsetMinutes)
    assert.equal(rows.find((row) => row.deliveryId === original.deliveryId)!.state, "superseded")
    assert(newest.intentRevision > route.intentRevision)
})
test("Fresh changed raw epoch revokes at reserve and claim even when the destination is no longer available", async (t) => {
    for (const phase of ["reserve", "claim"]) {
        const f = await fixture(t)
        await f.open()
        f.advance(120000)
        const row = (await read(await f.delivery({ type: "list" }))).deliveries[0],
            proof = f.participant("20", "2024-01-01T00:00:00.000002Z")
        if (phase === "reserve") {
            const denied = { observedAt: f.now(), channelId: "31", botId: "999", botAuthorized: true }
            assert.equal((await read(await f.reserve(row, proof, denied))).status, "cancelled")
        } else {
            const grant = (await read(await f.reserve(row))).grant
            assert.equal((await read(await f.dispatch(grant, proof))).claimed, false)
        }
        assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    }
})
test("Bot automation and participant remain independent fresh authority at every public automatic boundary", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
    const botActor = { ...f.context(), member: { ...f.context().member!, isBot: true } }
    await status(await f.manage({ type: "settings", expectedRevision: 2, enabled: false }, botActor), 403)
    assert.equal(
        (
            await read(
                await f.reserve(row, { ...f.participant(), member: { ...f.participant().member, canView: false } }),
            )
        ).status,
        "waiting",
    )
    const grant = (await read(await f.reserve(row))).grant
    await status(
        await f.dispatch(grant, {
            ...f.participant(),
            member: { ...f.participant().member, timeoutUntil: new Date(f.now() + 60000).toISOString() },
        }),
        403,
    )
    await status(await f.dispatch(grant, { ...f.participant(), observedAt: f.now() - 60001 }), 400)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
})
test("A birthday hours late still sends on its local day", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000 + 6 * 3600000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
    assert.equal(row.celebrationYear, 2026)
    const grant = (await read(await f.reserve(row))).grant
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
})
test("A birthday missed for its whole local day skips without consuming the annual fence", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(86400000)
    assert.equal((await read(await f.delivery({ type: "list" }))).deliveries.length, 0)
    const rows = await f.deliveries()
    assert.equal(rows.find((row) => row.celebrationYear === 2026)!.reason, "late-window")
    assert(rows.some((row) => row.celebrationYear === 2027 && row.state === "queued"))
    assert.equal((await f.db.run((ctx) => ctx.db.query("milestoneConsumed").collect())).length, 0)
})
test("A sign-up after this year's date makes no skipped post and queues next year", async (t) => {
    const f = await fixture(t)
    await read(await f.manage({ type: "settings", expectedRevision: 1, enabled: true }))
    await read(await f.configure())
    await read(await f.change("enable"))
    f.advance(2 * 86400000)
    await read(await f.enroll())
    const counted = () => f.db.run(async (ctx) => (await ctx.db.query("milestoneSettings").first())?.deliveries)
    assert.deepEqual(await f.deliveries(), [])
    assert.equal(await counted(), 0)
    f.advance(60000)
    await read(await f.delivery({ type: "list" }))
    const rows = await f.deliveries()
    assert.deepEqual(
        rows.map((row) => [row.celebrationYear, row.state]),
        [[2027, "queued"]],
    )
    assert.equal(await counted(), 1)
})
// DEFCON changes, what the work dispatcher lists for the milestones worker, which wakes the bot, and the posts the worker gets
function held(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const change = async (level: 1 | 2 | 3) =>
        read(
            await f.http("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    // Returning to DEFCON 3 wakes held posts in scheduled batches
    const settle = () => f.db.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    return {
        change,
        settle,
        defcon: async (level: 1 | 2 | 3) => {
            await change(level)
            await settle()
        },
        signal: () => f.db.run(async (ctx) => (await ctx.db.query("workSignal").first())?.version ?? 0),
        due: async () => (await read(await f.http("/service/work", { cursor: null }))).kinds.milestones,
        // Every page of due posts, as the worker reads them
        list: async () => {
            const found: string[] = []
            let page
            do {
                page = await read(await f.delivery({ type: "list" }))
                found.push(...page.deliveries.map((row: MilestonesDelivery) => `${row.kind}:${row.userId}`))
            } while (page.hasMore)
            return found.sort()
        },
    }
}
test("Birthdays and anniversaries wait without polling while DEFCON is below 3, come back at DEFCON 3 and still skip after their day", async (t) => {
    const f = await fixture(t)
    const { defcon, due, list } = held(t, f)
    await f.open()
    await read(await f.configure("anniversary"))
    await read(await f.change("enable", "anniversary"))
    await read(await f.enroll("anniversary"))
    await read(await f.enroll("birthday", "01-02", "21"))
    const year = async (userId: string, kind = "birthday") =>
        (await f.deliveries(kind)).find((row) => row.userId === userId && row.celebrationYear === 2026)!
    await defcon(2)
    f.setNow(Date.parse("2026-01-01T00:02Z"))
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [])
    for (let i = 0; i < 2; i++) {
        assert.deepEqual(await due(), [])
        f.advance(3600000)
    }
    assert.deepEqual(await list(), [])
    await defcon(3)
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), ["anniversary:20", "birthday:20"])
    // A post DEFCON holds for its whole local day is skipped at midnight, like any late post
    await defcon(1)
    f.setNow(Date.parse("2026-01-02T00:02Z"))
    assert.deepEqual(await list(), [])
    assert.equal((await year("20")).reason, "late-window")
    assert.equal((await year("20", "anniversary")).reason, "late-window")
    f.advance(3600000)
    assert.deepEqual(await due(), [])
    f.setNow(Date.parse("2026-01-03T00:00Z"))
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [])
    assert.equal((await year("21")).reason, "late-window")
})

// The switches a birthday or anniversary post needs besides DEFCON
const switches = {
    module: (f: Awaited<ReturnType<typeof fixture>>) => async (enabled: boolean) => {
        const settings = (await read(await f.query({ type: "settings" }))).settings
        await read(await f.manage({ type: "settings", expectedRevision: settings.revision, enabled }))
    },
    route: (f: Awaited<ReturnType<typeof fixture>>) => async (enabled: boolean) => {
        await read(await f.change(enabled ? "enable" : "disable"))
    },
    publishing: (f: Awaited<ReturnType<typeof fixture>>) => async (enabled: boolean) => {
        await read(await f.publish({ type: "settings", patch: { enabled } }))
    },
}
for (const [scope, toggle] of Object.entries(switches))
    test(`Birthdays wait without polling while the ${scope} switch is off and are skipped once their day ends or it is back on`, async (t) => {
        const f = await fixture(t)
        const { due, list } = held(t, f)
        const set = toggle(f)
        await f.open()
        await read(await f.enroll("birthday", "01-02", "21"))
        const year = async (userId: string) =>
            (await f.deliveries()).find((row) => row.userId === userId && row.celebrationYear === 2026)!
        const stored = async (userId: string) =>
            (await f.db.run((ctx) => ctx.db.query("milestoneDeliveries").collect())).find(
                (row) => row.userId === userId && row.celebrationYear === 2026,
            )!
        await set(false)
        f.setNow(Date.parse("2026-01-01T00:02Z"))
        // The bot hears of the post once and holds it until its local midnight, when it is skipped as late
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        for (let i = 0; i < 3; i++) {
            f.advance(3600000)
            assert.deepEqual(await due(), [])
        }
        assert.equal((await stored("20")).nextCheckAt, Date.parse("2026-01-02T00:00Z"))
        assert.deepEqual(await list(), [])
        f.setNow(Date.parse("2026-01-02T00:00Z"))
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        assert.equal((await year("20")).reason, "late-window")
        // Turning the switch back on cannot send a post that came due while it was off, so the next check is still its
        // midnight and it is skipped as before the activation
        f.setNow(Date.parse("2026-01-02T00:02Z"))
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        f.advance(3600000)
        await set(true)
        assert.deepEqual(await due(), [])
        f.setNow(Date.parse("2026-01-03T00:00Z"))
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        assert.equal((await year("21")).reason, "activation-cutoff")
    })

test("A birthday woken just before local midnight reaches the bot through the work signal before it is late", async (t) => {
    const f = await fixture(t)
    const { change, settle, defcon, signal, due, list } = held(t, f)
    await read(await f.manage({ type: "settings", expectedRevision: 1, enabled: true }))
    await read(await f.configure("birthday", 0, "30", "UTC", "23:00"))
    await read(await f.change("enable"))
    await read(await f.enroll())
    await defcon(2)
    f.setNow(Date.parse("2026-01-01T23:00Z"))
    assert.deepEqual(await list(), [])
    f.setNow(Date.parse("2026-01-01T23:59Z"))
    await change(3)
    // The scheduled wake itself rings the signal, on top of the DEFCON change's own ring. The bot dispatches when the signal
    // changes, so it finds the birthday at 23:59 instead of after midnight
    const before = await signal()
    await settle()
    assert((await signal()) > before)
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), ["birthday:20"])
})

test("Returning to DEFCON 3 with a full server of held posts with large templates succeeds and wakes them all", async (t) => {
    const f = await fixture(t)
    const { defcon, due, list } = held(t, f)
    // A template at the publishing limits: 2000 characters of text and 6000 in the embed, each three bytes long
    await read(await f.publish({ type: "draft-create", kind: "template", name: "large" }))
    await read(
        await f.publish({
            type: "draft-update",
            kind: "template",
            name: "large",
            expectedRevision: 1,
            edit: { type: "content", content: "€".repeat(2000) },
        }),
    )
    await read(
        await f.publish({
            type: "draft-update",
            kind: "template",
            name: "large",
            expectedRevision: 2,
            edit: {
                type: "embed",
                embed: { title: "€".repeat(256), description: "€".repeat(4096), footer: { text: "€".repeat(1648) } },
            },
        }),
    )
    await read(await f.manage({ type: "settings", expectedRevision: 1, enabled: true }))
    await read(
        await f.manage({
            type: "configure",
            kind: "birthday",
            expectedRevision: 0,
            channelId: "30",
            zone: "UTC",
            time: "00:02",
            fold: "reject",
            template: { name: "large", revision: 3 },
        }),
    )
    await read(await f.change("enable"))
    await read(await f.enroll())
    await defcon(2)
    f.setNow(Date.parse("2026-01-01T00:02Z"))
    assert.deepEqual(await list(), [])
    // Every account the server allows holds a birthday post like this one
    const accounts = 1000
    const [enrollment, delivery] = await f.db.run(async (ctx) => [
        (await ctx.db.query("milestoneEnrollments").first())!,
        (await ctx.db.query("milestoneDeliveries").first())!,
    ])
    assert(Buffer.byteLength(JSON.stringify(delivery)) > 22000)
    for (let from = 1; from < accounts; from += 50)
        await f.db.run(async (ctx) => {
            for (let i = from; i < Math.min(from + 50, accounts); i++) {
                const { _id, _creationTime, ...row } = delivery,
                    userId = String(1000 + i)
                const deliveryId = await ctx.db.insert("milestoneDeliveries", { ...row, userId })
                const { _id: e, _creationTime: c, ...member } = enrollment
                await ctx.db.insert("milestoneEnrollments", { ...member, userId, deliveryId })
            }
        })
    await f.db.run(async (ctx) => {
        const state = (await ctx.db.query("milestoneSettings").first())!
        await ctx.db.patch(state._id, { accounts, enrollments: accounts, deliveries: accounts })
    })
    assert.deepEqual(await due(), [])
    await defcon(3)
    const waiting = await f.db.run(
        async (ctx) =>
            (
                await ctx.db
                    .query("milestoneEnrollments")
                    .withIndex("by_discovery", (q) => q.eq("serverId", "1").gt("nextCheckAt", f.now()))
                    .collect()
            ).length,
    )
    assert.equal(waiting, 0)
    assert.deepEqual(await due(), ["1"])
    assert.equal((await list()).length, accounts)
})

test("Enrollments wait for their next due time and a changed route re-arms them", async (t) => {
    const f = await fixture(t)
    await f.open()
    await read(await f.enroll("birthday", "06-01", "21"))
    const source = async () =>
        (await f.db.run((ctx) => ctx.db.query("milestoneEnrollments").collect())).find((row) => row.userId === "21")!
    assert.equal((await source()).nextCheckAt, Date.parse("2026-06-01T00:02Z"))
    f.advance(120000)
    await read(await f.delivery({ type: "list" }))
    assert.equal((await source()).nextCheckAt, Date.parse("2026-06-01T00:02Z"))
    await read(await f.configure("birthday", (await f.routes())[0].revision, "30", "UTC", "00:05"))
    assert.equal((await source()).nextCheckAt, f.now())
    await read(await f.delivery({ type: "list" }))
    assert.equal((await source()).nextCheckAt, Date.parse("2026-06-01T00:05Z"))
})
