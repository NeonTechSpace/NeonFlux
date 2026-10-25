import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import type {
    BackupBinding,
    BackupConfigObject,
    BackupContext,
    BackupItem,
    BackupManifest,
    BackupNativeProof,
    BackupPlan,
    BackupStructureObject,
} from "@neonflux/contracts/backup"
import schema from "../convex/schema.ts"
import { cleanupBackups } from "../convex/backupRetention.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import {
    backupExclusions,
    backupManifestHeader,
    backupOverwritesJson,
    backupSegments,
    type BackupChannelSummary,
} from "@neonflux/contracts/backup"
import { backupHash } from "../convex/backupDomain.ts"
import { createHash } from "node:crypto"
import { botCall } from "./bot-service.ts"

export const secret = "synthetic-backup-test-secret-000000000000000000"
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET"] as const
const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
/**
 * Registers the environment of a backup test file, which every test of the file runs in: one server in single mode. Scheduled work, such
 * as the end of a restore's lease, runs only when a test moves the timers, so no test waits on the real clock
 */
export function installBackupEnv() {
    beforeEach(() => {
        delete process.env.NEONFLUX_SERVER_MODE
        process.env.NEONFLUX_SERVER_ID = "1"
        process.env.NEONFLUX_BOT_API_SECRET = secret
        mock.timers.enable({ apis: ["setTimeout"] })
    })
    afterEach(() => {
        mock.timers.reset()
        for (const key of keys) {
            if (prior[key] === undefined) delete process.env[key]
            else process.env[key] = prior[key]
        }
    })
}
export const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/backup.ts": () => import("../convex/backup.ts"),
    "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/greetings.ts": () => import("../convex/greetings.ts"),
    "../convex/backupRetention.ts": () => import("../convex/backupRetention.ts"),
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
export const allPermissions = ((1n << 55n) - 1n).toString()
/** A channel as the categories' segments carry it, as the bot sums it up */
export const summarize = (channel: BackupStructureObject): BackupChannelSummary => ({
    sourceId: channel.sourceId,
    parentId: channel.parentId,
    overwrites: createHash("sha256").update(backupOverwritesJson(channel.overwrites)).digest("hex"),
    ...(channel.managed ? { managed: channel.managed } : {}),
    ...(channel.position !== undefined ? { position: channel.position } : {}),
})
export const binding = (r: BackupBinding): BackupBinding => ({
    planId: r.planId,
    revision: r.revision,
    planHash: r.planHash,
    archiveDigest: r.archiveDigest,
})
export async function read(r: Response): Promise<any> {
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()))
    return r.json()
}
export async function status(r: Response, expected: number) {
    const body = await r.json()
    assert.equal(r.status, expected, JSON.stringify(body))
    assert(!JSON.stringify(body).includes(secret))
}
export async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"),
        sequence = 10000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true }),
        provider = "https://api.example.test"
    const context = (): BackupContext => ({
        provider,
        observedAt: now,
        ownerId: "10",
        actorId: "10",
        actorKind: "human",
        botId: "999",
        botKind: "bot",
        ownerJoinedAt: "2024-01-01T00:00:00.123456Z",
        ownerTimeoutUntil: null,
        botTimeoutUntil: null,
        dmChannelId: "90",
        dmType: 1,
        recipientIds: ["10"],
        privateReplyAuthorized: true,
    })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const http = (path: string, body: unknown, auth = true) => botCall(db, path, body, auth ? {} : { secret: null })
    const manage = (operation: unknown, extra = {}) =>
        http("/backup/manage", { ...source(), context: context(), operation, ...extra })
    const query = (operation: unknown, extra = {}) =>
        http("/backup/query", { serverId: "1", context: context(), operation, ...extra })
    const work = (operation: unknown) => http("/backup/work", { serverId: "1", operation })
    const snapshotPage = (selected: string[], cursor?: string) =>
        http("/backup/snapshot-page", { serverId: "1", context: context(), selected, ...(cursor ? { cursor } : {}) })
    // Every page of a snapshot, as an export reads them, joined into one answer like one request's. A refused page is the answer
    const snapshot = async (selected = ["config", "xp"]) => {
        const config: unknown[] = [],
            xp: unknown[] = []
        let cursor: string | undefined
        for (let page = 0; page < 1000; page++) {
            const response = await snapshotPage(selected, cursor)
            if (response.status !== 200) return response
            const body = (await response.json()) as {
                capturedAt: number
                config: unknown[]
                xp: unknown[]
                cursor: string | null
            }
            config.push(...body.config)
            xp.push(...body.xp)
            if (body.cursor === null) return Response.json({ capturedAt: body.capturedAt, config, xp })
            cursor = body.cursor
        }
        throw new Error("The snapshot did not end")
    }
    const manifest = (
        config: BackupConfigObject[] = [],
        xp: BackupManifest["xp"] = [],
        structure: BackupStructureObject[] = [],
    ): BackupManifest => ({
        version: 2,
        backupId: (++sequence).toString(16).padStart(32, "0"),
        provider,
        serverId: "1",
        selected: [
            ...(config.length ? ["config" as const] : []),
            ...(xp.length ? ["xp" as const] : []),
            ...(structure.length ? ["structure" as const] : []),
            ...(!config.length && !xp.length && !structure.length ? ["config" as const] : []),
        ],
        capturedAt: now,
        observations: { databaseAt: now, structureStartedAt: now, structureFinishedAt: now },
        counts: {
            config: config.length,
            xp: xp.length,
            structure: structure.length,
            overwrites: structure.reduce((n, x) => n + x.overwrites.length, 0),
        },
        exclusions: [...backupExclusions],
        config,
        xp,
        structure,
    })
    // A channel the server has, with the permissions NeonFlux has in it
    const seen = (x: BackupStructureObject, botPermissions = allPermissions) => ({
        sourceId: x.sourceId,
        observedAt: now,
        status: "present" as const,
        channel: x,
        botPermissions,
    })
    // A channel as the server lists it
    const listing = (x: BackupStructureObject, patch: Partial<BackupNativeProof["channels"][number]> = {}) => ({
        id: x.sourceId,
        type: x.type,
        name: x.name,
        parentId: x.parentId,
        botCanManage: true,
        synced: false,
        ...patch,
    })
    // A role, member or category the server has or lacks, as NeonFlux read it
    const ref = (
        id: string,
        type: "role" | "member" | "category" = "role",
        patch: Partial<BackupNativeProof["references"][number]> = {},
    ): BackupNativeProof["references"][number] => ({
        id,
        type,
        serverId: "1",
        observedAt: now,
        exists: true,
        actorCanAccess: true,
        botCanAccess: true,
        actorCanManage: true,
        botCanManage: true,
        permissions: type === "category" ? allPermissions : "0",
        ...patch,
    })
    const proof = (
        channels: BackupStructureObject[] = [],
        refs: BackupNativeProof["references"] = [],
        present: BackupNativeProof["observations"] = [],
        listed: BackupNativeProof["channels"] = [],
    ): BackupNativeProof => ({
        observedAt: now,
        serverId: "1",
        ownerId: "10",
        botId: "999",
        actorPermissions: allPermissions,
        botPermissions: allPermissions,
        actorCanManageChannels: true,
        botCanManageChannels: true,
        references: [
            {
                id: "1",
                type: "role",
                serverId: "1",
                observedAt: now,
                exists: true,
                actorCanAccess: true,
                botCanAccess: true,
                actorCanManage: true,
                botCanManage: true,
                permissions: "0",
            },
            ...refs,
        ],
        observations: [
            ...channels.map((x) => ({
                sourceId: x.sourceId,
                observedAt: now,
                status: "absent" as const,
                channel: null,
                botPermissions: "0",
            })),
            ...present,
        ],
        channels: listed,
    })
    const channel = (
        sourceId = "100",
        type: BackupStructureObject["type"] = "text",
        parentId: string | null = null,
    ): BackupStructureObject => ({
        sourceId,
        type,
        name: `channel-${sourceId}`,
        parentId,
        capturedAt: now,
        overwrites: [{ id: "1", type: "role", allow: "0", deny: "1024" }],
        ...(type === "text"
            ? { topic: null, nsfw: false, slowmodeSeconds: 0 }
            : type === "voice"
              ? { bitrate: 64000, userLimit: 0 }
              : {}),
    })
    // A check starts with the archive's header and the digests of its segments, and each segment follows with the same evidence. The answer
    // is the first refusal or the last answer, as the bot sees them
    const preview = async (
        archive: BackupManifest,
        native: BackupNativeProof | null = null,
        match = false,
        extra: Record<string, unknown> = {},
    ) => {
        const segments = backupSegments(archive, summarize)
        const started = await http("/backup/preview-start", {
            serverId: "1",
            context: context(),
            header: backupManifestHeader(archive),
            segmentDigests: await Promise.all(segments.map((segment) => backupHash(segment))),
            archiveDigest: await backupHash(archive),
            archive: { channelId: "90", messageId: String(++sequence) },
            match,
            ...extra,
        })
        if (started.status !== 200 || !segments.length) return started
        const planId = ((await started.clone().json()) as { plan: BackupPlan }).plan.planId
        let last = started
        for (const [segmentNo, segment] of segments.entries()) {
            last = await http("/backup/preview-segment", {
                serverId: "1",
                context: context(),
                planId,
                segmentNo,
                segment,
                native,
            })
            if (last.status !== 200) return last
        }
        return last
    }
    // A preview is the plan a confirmation runs, so the plan comes with its items, twenty to a page
    const plan = async (archive: BackupManifest, native: BackupNativeProof | null = null, match = false) => {
        const made = (await read(await preview(archive, native, match))) as { plan: BackupPlan },
            first = (await read(await query({ type: "items", binding: binding(made.plan) }))) as {
                items: BackupItem[]
                nextCursor?: string
            }
        return { plan: made.plan, ...first }
    }
    // A confirmation starts the plan's run in the background. These tests apply the items themselves, as the bot's passes would, so the
    // run is stopped at once and a test can check an archive again
    const confirm = async (plan: BackupPlan) => {
        const confirmed = await read(await manage({ type: "confirm", binding: binding(plan) }))
        const job = await db.run(async (ctx) => (await ctx.db.query("backupPreviewJobs").collect())[0])
        if (job?.state === "running")
            await read(
                await http("/backup/run-step", {
                    serverId: "1",
                    requestedAt: job.createdAt,
                    recorded: 0,
                    stopped: "owner",
                }),
            )
        return confirmed
    }
    const apply = (item: BackupItem, native: BackupNativeProof | null = null) =>
        work({
            type: "apply",
            binding: { ...binding(item), itemNo: item.itemNo, generation: 1 },
            context: context(),
            native,
        })
    const clean = () => db.run((ctx) => retentionPass(ctx, cleanupBackups))
    const reserve = (item: BackupItem, native: BackupNativeProof) =>
        work({
            type: "reserve",
            binding: { ...binding(item), itemNo: item.itemNo, generation: 1 },
            context: context(),
            native,
        })
    const claim = (item: BackupItem, native: BackupNativeProof, claimToken = "a".repeat(32)) =>
        work({
            type: "claim",
            binding: { ...binding(item), itemNo: item.itemNo, generation: 1 },
            context: context(),
            native,
            claimToken,
        })
    const outcome = (item: BackupItem, outcome: string, result: BackupStructureObject | null = null, extra = {}) =>
        work({
            type: "outcome",
            binding: { ...binding(item), itemNo: item.itemNo, generation: 1 },
            claimToken: "a".repeat(32),
            outcome,
            channel: result,
            mappedId: result?.sourceId ?? null,
            ...extra,
        })
    return {
        db,
        provider,
        context,
        http,
        manage,
        query,
        work,
        snapshot,
        snapshotPage,
        manifest,
        proof,
        seen,
        listing,
        ref,
        channel,
        preview,
        plan,
        confirm,
        apply,
        clean,
        reserve,
        claim,
        outcome,
        now: () => now,
        advance: (ms: number) => {
            now += ms
        },
    }
}
