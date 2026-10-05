import {
    BackupConfigObject,
    canonicalBackupJson,
    BackupContext,
    BackupStructureObject,
    BackupXpObject,
    backupWithinLimits,
    type BackupManifest,
    type BackupNativeProof,
} from "@neonflux/contracts/backup"
import { rule } from "./moderationDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import * as responses from "./responseDomain.ts"
import { levelMappings } from "./levelingDomain.ts"
import { autoroleIds } from "./rolesDomain.ts"
import { greetingTemplate } from "./greetingsDomain.ts"
import { ticketQuestions } from "./ticketDomain.ts"
import { milestoneCivil, validateMilestoneTemplate } from "./milestonesDomain.ts"
import { decode, fail, text } from "./validation.ts"

export {
    BACKUP_PLAN_MS,
    backupChannelSemantic,
    backupConfigIdentity,
    canonicalBackupJson,
} from "@neonflux/contracts/backup"
export const BACKUP_RETENTION = 604800000,
    BACKUP_DISPATCH_MS = 120000,
    BACKUP_SETTLE_MS = 10000
export async function backupHash(value: unknown) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalBackupJson(value)))
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
/** The owner, the actor and the private one-to-one DM, read by the bot within the last minute */
export function backupContext(value: unknown, now = Date.now()): BackupContext {
    const context = decode(BackupContext, value),
        { ownerId, recipientIds } = context
    if (context.observedAt < Math.max(0, now - 60000) || context.observedAt > now + 1000)
        fail(400, "Stale backup evidence")
    if (
        context.actorId !== ownerId ||
        ownerId === context.botId ||
        !context.privateReplyAuthorized ||
        recipientIds.length !== 1 ||
        recipientIds[0] !== ownerId
    )
        fail(403, "Fresh actual Owner and private one-to-one DM required")
    if (
        Date.parse(context.ownerJoinedAt) > context.observedAt + 1000 ||
        [context.ownerTimeoutUntil, context.botTimeoutUntil].some((x) => x !== null && Date.parse(x) > now)
    )
        fail(403, "Backup participant restricted")
    return context
}
// What a restored setting must also meet of its feature's own rules, beyond its shape
function configRules(item: BackupConfigObject) {
    switch (item.family) {
        case "response":
            if (responses.name(item.value.name) !== item.value.name) fail(400, "Noncanonical response identity")
            responses.reply(item.value.reply)
            break
        case "automod":
            if (canonicalBackupJson(rule(item.value)) !== canonicalBackupJson(item.value))
                fail(400, "Noncanonical automod rule")
            break
        case "draft":
            publishingContent(item.value.content)
            break
        case "roles":
            if (autoroleIds(item.value).length > 1000)
                fail(400, "Autorole configuration supports at most 1000 distinct roles")
            break
        case "greetings":
            for (const route of ["welcome", "dm", "goodbye"] as const) {
                const content = item.value.routes[route].content
                if (content !== undefined) greetingTemplate(content, route)
            }
            break
        case "ticketCategory": {
            if (item.value.description !== "") text(item.value.description, 1000)
            ticketQuestions(item.value.questions)
            for (const reply of item.value.cannedReplies) publishingContent(reply.content)
            break
        }
        case "leveling":
            if (canonicalBackupJson(levelMappings(item.value.mappings)) !== canonicalBackupJson(item.value.mappings))
                fail(400, "Noncanonical leveling mappings")
            break
        case "milestoneRoute": {
            const { zone, time, fold, content, kind } = item.value
            milestoneCivil({ zone, time, fold })
            validateMilestoneTemplate(publishingContent(content), kind)
            break
        }
    }
}
export function backupConfig(value: unknown): BackupConfigObject {
    const item = decode(BackupConfigObject, value)
    configRules(item)
    return item
}
/** The leaves of a value by path. Objects go by key, and arrays by the entries' names when each is an object with its own name, otherwise by index. An empty array or object is a leaf */
function leaves(value: unknown, path: string, out: Map<string, unknown>) {
    if (Array.isArray(value) && value.length) {
        const names = value.map((x) => (x && typeof x === "object" ? (x as { name?: unknown }).name : undefined)),
            byName = names.every((x) => typeof x === "string") && new Set(names).size === names.length
        value.forEach((x, i) => leaves(x, `${path}[${byName ? names[i] : i}]`, out))
    } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
        for (const [key, x] of Object.entries(value)) if (x !== undefined) leaves(x, path ? `${path}.${key}` : key, out)
    } else out.set(path, value)
}
/** The differences between two values as leaf rows in path order. A missing before lists every leaf of after, so a new item shows what it brings */
export function backupDiff(before: unknown, after: unknown) {
    const was = new Map<string, unknown>(),
        now = new Map<string, unknown>()
    if (before !== undefined) leaves(before, "", was)
    if (after !== undefined) leaves(after, "", now)
    return [...new Set([...was.keys(), ...now.keys()])]
        .sort()
        .filter(
            (path) =>
                !was.has(path) ||
                !now.has(path) ||
                canonicalBackupJson(was.get(path)) !== canonicalBackupJson(now.get(path)),
        )
        .map((path) => ({
            path,
            ...(was.has(path) ? { before: was.get(path) } : {}),
            ...(now.has(path) ? { after: now.get(path) } : {}),
        }))
}
/** Whether a path ends in an on/off switch, such as enabled, customEnabled or routes[2].enabled */
export const backupSwitchPath = (path: string) => /(^|\.)([a-z]\w*Enabled|enabled)$/.test(path)
/**
 * A setting with the optional values an archive may leave out filled in with what absent means, so a server that never set them and one that
 * set them to their defaults compare equal. Only identity and the shown changes use it
 */
export function backupNormalized(item: BackupConfigObject): BackupConfigObject {
    return item.family === "roles"
        ? {
              ...item,
              value: {
                  ...item.value,
                  advancedVerificationEnabled: item.value.advancedVerificationEnabled ?? false,
                  reservations: item.value.reservations ?? [],
              },
          }
        : item
}
export const backupXp = (value: unknown): BackupXpObject => decode(BackupXpObject, value)
export const backupStructure = (value: unknown): BackupStructureObject => decode(BackupStructureObject, value)
/** A decoded archive's limits, capture time and configuration rules */
export function backupManifest(manifest: BackupManifest, now = Date.now()): BackupManifest {
    if (!backupWithinLimits(manifest)) fail(413, "Backup category capacity exceeded")
    if (manifest.capturedAt > now + 60000) fail(400, "Invalid backup capture time")
    for (const item of manifest.config) configRules(item)
    return manifest
}
/** Fresh native evidence of the request's server, read for the context's owner and bot */
export function backupNativeProof(
    proof: BackupNativeProof,
    serverId: string,
    context: BackupContext,
): BackupNativeProof {
    const now = Date.now(),
        fresh = (at: number) => {
            if (at < Math.max(0, now - 60000) || at > now + 1000) fail(400, "Stale native evidence")
        }
    fresh(proof.observedAt)
    if (proof.serverId !== serverId || proof.ownerId !== context.ownerId || proof.botId !== context.botId)
        fail(403, "Native evidence identity mismatch")
    for (const reference of proof.references) {
        if (reference.serverId !== serverId) fail(400, "Invalid native reference")
        fresh(reference.observedAt)
    }
    for (const observation of proof.observations) fresh(observation.observedAt)
    // Plan items hash an observation without the server it was read from
    return {
        ...proof,
        observations: proof.observations.map(({ originServerId: _origin, ...observation }) => observation),
    }
}
