import assert from "node:assert/strict"
import { test } from "node:test"
import type { MetadataLogsContext } from "@neonflux/contracts/metadata-logs"
import { adapterFixture } from "./adapter-fixture.ts"
import { botCall } from "./bot-service.ts"
import { projectBackupConfig } from "../convex/backupProjections.ts"
import { backupConfig, backupDisabled } from "../convex/backupDomain.ts"

const modules = {
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/metadataLogsRetention.ts": () => import("../convex/metadataLogsRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/protection.ts": () => import("../convex/protection.ts"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }

test("Metadata log override destinations are safely projected into disabled backups", async t => {
    const f = await adapterFixture(t, modules)
    const member = (userId: string, isBot = false) => ({ userId, joinedAt: "2020-01-01T00:00:00.000001Z", roleIds: [], isBot, timeoutUntil: null, canView: true, canReadHistory: true })
    const context = (userId = "10", channelId = "30"): MetadataLogsContext => ({ observedAt: f.now(), actor: { ...owner, userId, isOwner: userId === "10", isAdministrator: userId === "11" }, member: member(userId), channelId, channelType: 0, botId: "999", botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot", botMember: member("999", true) })
    const privateRead = { channelId: "90", recipientIds: ["10", "999"], oneToOne: true }
    const post = (path: string, body: unknown) => botCall(f.backend, path, body)
    async function read(response: Response) { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return response.json() as Promise<any> }
    const manage = (operation: unknown) => post("/metadata-logs/manage", { ...f.source(), context: context(), operation })
    const settings = async () => (await read(await post("/metadata-logs/query", { serverId: "1", context: context(), privateRead, operation: { type: "settings" } }))).settings
    const old = (await settings()).routes.find((r: { category: string }) => r.category === "membership")
    await read(await manage({ type: "route", category: "membership", expectedRevision: old.revision, enabled: true, channelId: "30", ownerId: "10", recipientOwner: context("10", "30") }))
    await read(await manage({ type: "module", expectedRevision: (await settings()).revision, enabled: true }))
    await read(await manage({ type: "event-route", eventType: "member-add", expectedRevision: (await settings()).configRevision, enabled: true, channelId: "31", ownerId: "10", recipientOwner: context("10", "31") }))
    await read(await manage({ type: "channels", expectedRevision: (await settings()).revision, messageChannelIds: ["31"], excludedChannelIds: [] }))
    const state = await f.backend.run(ctx => ctx.db.query("metadataLogSettings").withIndex("by_server", q => q.eq("serverId", "1")).unique()); assert(state)
    const projected = projectBackupConfig("metadata", state), disabled = backupDisabled(projected); assert.equal(projected.family, "metadata"); assert.equal(disabled.family, "metadata")
    assert.equal(projected.value.eventRoutes![0]!.enabled, true); assert.equal(disabled.value.eventRoutes![0]!.enabled, false)
    assert.equal(disabled.value.eventRoutes![0]!.channelId, "31"); assert(!JSON.stringify(projected).includes("configRevision"))
    assert.deepEqual(backupConfig(disabled), disabled)
    const legacy = { ...projected.value }; delete legacy.eventRoutes
    assert.equal(backupConfig({ family: "metadata", sourceId: "metadata", value: legacy }).family, "metadata")
})
