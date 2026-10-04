import assert from "node:assert/strict"
import { test } from "node:test"
import type { BackupNativeProof } from "@neonflux/contracts/backup"
import type { MetadataLogsContext } from "@neonflux/contracts/metadata-logs"
import { adapterFixture } from "./adapter-fixture.ts"
import { botCall } from "./bot-service.ts"
import { projectBackupConfig } from "../convex/backupProjections.ts"
import { backupConfig } from "../convex/backupDomain.ts"
import { backupImports } from "../convex/backupImports.ts"

const modules = {
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/metadataLogsRetention.ts": () => import("../convex/metadataLogsRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/protection.ts": () => import("../convex/protection.ts"),
}
const owner = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}

test("Metadata log destinations and switches are projected into backups as the server has them, and restore accepts the setup", async (t) => {
    const f = await adapterFixture(t, modules)
    const member = (userId: string, isBot = false) => ({
        userId,
        joinedAt: "2020-01-01T00:00:00.000001Z",
        roleIds: [],
        isBot,
        timeoutUntil: null,
        canView: true,
        canReadHistory: true,
    })
    const context = (userId = "10", channelId = "30"): MetadataLogsContext => ({
        observedAt: f.now(),
        actor: { ...owner, userId, isOwner: userId === "10", isAdministrator: userId === "11" },
        member: member(userId),
        channelId,
        channelType: 0,
        botId: "999",
        botAuthorized: true,
        actorAuthorized: true,
        actorKind: "human",
        botKind: "bot",
        botMember: member("999", true),
    })
    const privateRead = { channelId: "90", recipientIds: ["10", "999"], oneToOne: true }
    const post = (path: string, body: unknown) => botCall(f.backend, path, body)
    async function read(response: Response) {
        assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
        return response.json() as Promise<any>
    }
    const manage = (operation: unknown) =>
        post("/metadata-logs/manage", { ...f.source(), context: context(), operation })
    const settings = async () =>
        (
            await read(
                await post("/metadata-logs/query", {
                    serverId: "1",
                    context: context(),
                    privateRead,
                    operation: { type: "settings" },
                }),
            )
        ).settings
    const old = (await settings()).routes.find((r: { category: string }) => r.category === "membership")
    await read(
        await manage({
            type: "route",
            category: "membership",
            expectedRevision: old.revision,
            enabled: true,
            channelId: "30",
            ownerId: "10",
            recipientOwner: context("10", "30"),
        }),
    )
    await read(await manage({ type: "module", expectedRevision: (await settings()).revision, enabled: true }))
    await read(
        await manage({
            type: "event-route",
            eventType: "member-add",
            expectedRevision: (await settings()).configRevision,
            enabled: true,
            channelId: "31",
            ownerId: "10",
            recipientOwner: context("10", "31"),
        }),
    )
    await read(
        await manage({
            type: "channels",
            expectedRevision: (await settings()).revision,
            messageChannelIds: ["31"],
            excludedChannelIds: [],
        }),
    )
    const state = await f.backend.run((ctx) =>
        ctx.db
            .query("metadataLogSettings")
            .withIndex("by_server", (q) => q.eq("serverId", "1"))
            .unique(),
    )
    assert(state)
    const projected = projectBackupConfig("metadata", state)
    assert.equal(projected.family, "metadata")
    // An archive keeps every switch and destination as the server has them
    assert.equal(projected.value.eventRoutes![0]!.enabled, true)
    assert.equal(projected.value.eventRoutes![0]!.channelId, "31")
    assert(!JSON.stringify(projected).includes("configRevision"))
    assert.deepEqual(backupConfig(projected), projected)
    // The feature saves a logged channel that also receives logs, so a restore of that setup is not blocked
    const reference = (id: string, type: "text" | "member") => ({
        originServerId: "1",
        id,
        type,
        serverId: "1",
        observedAt: f.now(),
        exists: true,
        actorCanAccess: true,
        botCanAccess: true,
        actorCanManage: true,
        botCanManage: true,
        permissions: "0",
    })
    const proof: BackupNativeProof = {
        originServerId: "1",
        observedAt: f.now(),
        serverId: "1",
        ownerId: "10",
        botId: "999",
        actorPermissions: "0",
        botPermissions: "0",
        actorCanManageChannels: true,
        botCanManageChannels: true,
        references: [reference("30", "text"), reference("31", "text"), reference("10", "member")],
        observations: [],
        channels: [],
    }
    assert.equal(
        await f.backend.run((ctx) => backupImports.backupValidateConfigReferences(ctx, "1", projected, proof)),
        null,
    )
})
