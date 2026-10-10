import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { createShowcaseStore, ShowcaseStoreError } from "../../bot/src/showcase-store.ts"
import { createProfileStore } from "../../bot/src/profile-store.ts"
import { createPublishingStore } from "../../bot/src/publishing-store.ts"

const modules = {
    "../convex/showcases.ts": () => import("../convex/showcases.ts"), "../convex/profiles.ts": () => import("../convex/profiles.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/dashboardConfiguration.ts": () => import("../convex/dashboardConfiguration.ts"),
}
const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const member: C.MemberContentContext = { userId: "20", userName: "Member", roleIds: [], isBot: false, timeoutUntil: null, botId: "999" }

test("Bot showcase and profile adapters decode real settings, grants, outcomes and profiles", async t => {
    const f = await adapterFixture(t, modules)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const showcases = createShowcaseStore(f.config), profiles = createProfileStore(f.config), publishing = createPublishingStore(f.config)
    const saved = await run(showcases.manage({ ...f.source(), originServerId: "1", actor, managerAuthorized: true, operation: { type: "settings", enabled: true, channelId: "40" } }))
    assert.deepEqual(saved.settings, { enabled: true, channelId: "40", maxPerMember: null, intervalMinutes: null })
    await f.reject(showcases.manage({ ...f.source(), originServerId: "1", actor, managerAuthorized: true, operation: { type: "settings", maxPerMember: 0 } }), ShowcaseStoreError, 400)
    await run(profiles.manage({ ...f.source(), originServerId: "1", actor, managerAuthorized: true, operation: { type: "settings", enabled: true, cooldownSeconds: 10 } }))
    // Website requests as the member mutations store them
    const [create, save] = await f.backend.run(async ctx => {
        const sessionId = await ctx.db.insert("dashboardSessions", { tokenHash: "a".repeat(64), accessToken: "synthetic-provider-token", userId: "20", userName: "Member", servers: [], memberServers: [{ id: "1", name: "Server" }], expiresAt: f.now() + 300000, lifetimeAt: f.now() + 28800000 })
        const insert = (family: "member-showcase" | "member-profile", requestId: string, operation: unknown) => ctx.db.insert("dashboardConfigurationJobs", { serverId: "1", family, actorId: "20", sessionId, requestId, expectedConfigRevision: 0, operation, state: "queued", createdAt: f.now(), expiresAt: f.now() + 120000, cleanupAt: f.now() + 86400000 })
        return [await insert("member-showcase", "00000000-0000-4000-8000-000000000001", { type: "create", title: "Game", text: "Text", links: [] }),
            await insert("member-profile", "00000000-0000-4000-8000-000000000002", { type: "save", bio: "Bio", links: [], color: null })]
    })
    assert.deepEqual((await run(showcases.ready({ serverId: "1" }))).jobs.map((job: C.ShowcaseJob) => job.id), [create])
    const started = await run(showcases.start({ serverId: "1", jobId: create!, actorId: "20", member })) as C.ShowcaseStartResult
    const grant = started.grant!
    assert.deepEqual([grant.action, grant.actorId, grant.source], ["send", "999", { type: "showcase", jobId: create, createdAt: f.now() }])
    const binding = { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "d".repeat(32) }
    assert.equal((await run(publishing.dispatch(binding))).claimed, true)
    await run(publishing.outcome({ ...binding, outcome: "sent", messageId: "500" }))
    assert.equal((await run(showcases.complete({ serverId: "1", jobId: create! }))).job.state, "applied")
    const listed = await run(showcases.list({ serverId: "1" }))
    assert.deepEqual(listed.showcases.map((row: C.Showcase) => [row.showcaseNo, row.status, row.messageId]), [[1, "posted", "500"]])
    // The tracked post decodes for !publish status with its showcase provenance
    assert.deepEqual((await run(publishing.query({ serverId: "1", actor, operation: { type: "post-show", postNo: grant.postNo } }))).post.attempt.provenance, { type: "showcase", showcaseNo: 1 })
    assert.equal((await run(profiles.apply({ serverId: "1", jobId: save!, actorId: "20", member }))).job.state, "applied")
    const shown = await run(profiles.show({ serverId: "1", channelId: "40", caller: { userId: "21", roleIds: [] }, target: { userId: "20", userName: "Member", roleIds: [] } }))
    assert.deepEqual(shown, { type: "profile", cooldownSeconds: 10, content: { content: "", embed: { title: "Member", description: "Bio" } } })
})
