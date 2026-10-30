import {
    type MetadataLogsEvent,
    type MetadataLogsSource,
    type MetadataLogsCategory,
    type MetadataLogsEventType,
    metadataAuditActions,
    metadataPlain,
    metadataSlice,
    METADATA_TEXT,
} from "@neonflux/contracts/metadata-logs"
import { cutText, InviteCode } from "@neonflux/contracts/common"
import { permissionKeyTitles, permissionNames } from "@neonflux/contracts/permission-names"
import { randomBytes } from "node:crypto"
import { Schema } from "effect"
import {
    snowflakes,
    type Guild,
    type GuildChannel,
    type GuildMember,
    type GuildRole,
    type GuildThreadChannel,
} from "@neontechspace/fluxerly/effect"
import { auditBits, auditNames, auditRoleChange } from "./audit-changes.ts"
import type { RememberedMessage } from "./message-revisions.ts"

export const object = (v: unknown): Record<string, unknown> | undefined =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const id = (v: unknown): v is string => snowflakes.isValid(v) && v !== "0"
export interface MetadataProjectionScope {
    serverId: string
    sessionId: string
    sequence: number
    observedAt: number
    botId?: string
}
export function createMetadataObservationSession() {
    const sessionId = randomBytes(16).toString("hex")
    let sequence = 0
    return (serverId: string, observedAt: number): MetadataProjectionScope => ({
        serverId,
        observedAt,
        sessionId,
        sequence: ++sequence,
    })
}

type Change = NonNullable<NonNullable<MetadataLogsEvent["details"]>["changes"]>[number]
type Details = NonNullable<MetadataLogsEvent["details"]>
const CHANGE_LIMIT = 20

// Mentions joined until a list value's 600 characters, then a count of the rest
function mentions(ids: readonly string[], format: (id: string) => string) {
    const shown: string[] = []
    let size = 0
    for (const [i, value] of ids.map(format).entries()) {
        const rest = ids.length - i
        if (size + value.length + 2 + (rest > 1 ? 16 : 0) > 600) return [...shown, `and ${rest} more`].join(", ")
        shown.push(value)
        size += value.length + 2
    }
    return shown.join(", ")
}
const user = (v: string) => `<@${v}>`,
    role = (v: string) => `<@&${v}>`,
    channel = (v: string) => `<#${v}>`
const yes = (v: boolean) => (v ? "Yes" : "No")
const time = (v: string | null) => {
    const at = v === null ? NaN : Date.parse(v)
    return Number.isFinite(at) ? `<t:${Math.floor(at / 1000)}:f>` : ""
}
/** Names a value, where "" shows as none */
type Show<T> = (value: T) => string
// A change when both sides are known and differ. Absent means unavailable, so it is never compared
function value<T>(changes: Change[], field: string, before: T | undefined, after: T | undefined, show: Show<T>) {
    if (before === undefined || after === undefined || before === after) return
    const b = show(before),
        a = show(after)
    if (b !== a) changes.push({ field, before: b || "(none)", after: a || "(none)" })
}
// An image or another hash that only says whether it changed
function image(changes: Change[], field: string, before: string | null | undefined, after: string | null | undefined) {
    if (before === undefined || after === undefined || before === after) return
    changes.push({ field, after: after ? "Changed" : "Removed" })
}
function list(
    changes: Change[],
    field: string,
    before: readonly string[],
    after: readonly string[],
    show: Show<string>,
) {
    const added = after.filter((v) => !before.includes(v)),
        removed = before.filter((v) => !after.includes(v))
    if (added.length || removed.length)
        changes.push({
            field,
            ...(added.length ? { added: mentions(added, show) } : {}),
            ...(removed.length ? { removed: mentions(removed, show) } : {}),
        })
}
const plain = (v: string | null) => (v ? metadataPlain(v) : "")
const permissions = (before: bigint, after: bigint, changes: Change[], field = "permissions") => {
    const names = (mask: bigint) => (mask ? permissionNames(mask.toString()).join(", ") : "")
    const added = names(after & ~before),
        removed = names(before & ~after)
    if (added || removed)
        changes.push({
            field,
            ...(added ? { added: metadataPlain(added, 600) } : {}),
            ...(removed ? { removed: metadataPlain(removed, 600) } : {}),
        })
}

/** The changed values of a member against the member the bot knew before */
export function memberChanges(before: GuildMember, after: GuildMember) {
    const changes: Change[] = []
    value(changes, "nickname", before.nickname, after.nickname, plain)
    list(changes, "roles", before.roleIds, after.roleIds, role)
    value(changes, "timeout", before.communicationDisabledUntil, after.communicationDisabledUntil, time)
    value(changes, "username", before.username, after.username, plain)
    image(changes, "avatar", before.avatar, after.avatar)
    image(changes, "banner", before.banner, after.banner)
    value(changes, "muted", before.isMuted, after.isMuted, yes)
    value(changes, "deafened", before.isDeafened, after.isDeafened, yes)
    return changes
}
// A role shows an emoji or an image and never both, so either one proves what it shows. Absent means unavailable
const roleIcon = (role: GuildRole) => {
    if (role.unicodeEmoji) return plain(role.unicodeEmoji)
    if (role.icon) return "Image"
    return role.icon === undefined && role.unicodeEmoji === undefined ? undefined : ""
}
/** The changed values of a role against the role the bot knew before */
export function roleChanges(before: GuildRole, after: GuildRole) {
    const changes: Change[] = []
    value(changes, "name", before.name, after.name, plain)
    value(changes, "color", before.color, after.color, (v) => (v ? `#${v.toString(16).padStart(6, "0")}` : ""))
    permissions(before.permissions, after.permissions, changes)
    value(changes, "hoist", before.hoist, after.hoist, yes)
    value(changes, "mentionable", before.mentionable, after.mentionable, yes)
    if (before.icon && after.icon) image(changes, "icon", before.icon, after.icon)
    else value(changes, "icon", roleIcon(before), roleIcon(after), (v) => v)
    value(changes, "position", before.position, after.position, String)
    return changes
}
/** The changed values of a channel against the channel the bot knew before. Overwrite changes name at most five roles or members */
export function channelChanges(before: GuildChannel, after: GuildChannel) {
    const changes: Change[] = [],
        b = before as Partial<Record<string, unknown>> & GuildChannel,
        a = after as Partial<Record<string, unknown>> & GuildChannel
    value(changes, "name", before.name, after.name, plain)
    value(changes, "type", String(before.type), String(after.type), String)
    value(changes, "topic", b.topic as string | null | undefined, a.topic as string | null | undefined, plain)
    value(changes, "nsfw", before.nsfw, after.nsfw, yes)
    value(
        changes,
        "slowmode",
        b.rateLimitPerUser as number | undefined,
        a.rateLimitPerUser as number | undefined,
        (v) => (v ? `${v} seconds` : ""),
    )
    value(changes, "parent", before.parentId, after.parentId, (v) => (v ? channel(v) : ""))
    value(changes, "bitrate", b.bitrate as number | null | undefined, a.bitrate as number | null | undefined, (v) =>
        v ? String(v) : "",
    )
    value(
        changes,
        "userLimit",
        b.userLimit as number | null | undefined,
        a.userLimit as number | null | undefined,
        (v) => (v ? String(v) : ""),
    )
    value(changes, "position", before.position, after.position, String)
    if (before.permissionOverwrites && after.permissionOverwrites) {
        const key = (o: { id: string; type: string; allow: bigint; deny: bigint }) =>
            `${o.id}|${o.type}|${o.allow}|${o.deny}`
        const old = new Set(before.permissionOverwrites.map(key)),
            next = new Set(after.permissionOverwrites.map(key))
        const touched = [
            ...after.permissionOverwrites.filter((o) => !old.has(key(o))),
            ...before.permissionOverwrites.filter((o) => !next.has(key(o))),
        ]
        const targets = [...new Map(touched.map((o) => [o.id, o.type === "role" ? role(o.id) : user(o.id)])).values()]
        if (targets.length)
            changes.push({
                field: "overwrites",
                after: [...targets.slice(0, 5), ...(targets.length > 5 ? [`and ${targets.length - 5} more`] : [])].join(
                    ", ",
                ),
            })
    }
    return changes
}
/** The changed values of the server against the server the bot knew before */
export function guildChanges(before: Guild, after: Guild) {
    const changes: Change[] = []
    value(changes, "name", before.name, after.name, plain)
    image(changes, "icon", before.icon, after.icon)
    image(changes, "banner", before.banner, after.banner)
    image(changes, "splash", before.splash, after.splash)
    value(changes, "owner", before.ownerId, after.ownerId, user)
    value(changes, "systemChannel", before.systemChannelId, after.systemChannelId, (v) => (v ? channel(v) : ""))
    value(changes, "afkChannel", before.afkChannelId, after.afkChannelId, (v) => (v ? channel(v) : ""))
    value(changes, "afkTimeout", before.afkTimeoutSeconds, after.afkTimeoutSeconds, (v) => `${v} seconds`)
    value(changes, "verificationLevel", before.verificationLevel, after.verificationLevel, String)
    value(changes, "contentFilter", before.explicitContentFilter, after.explicitContentFilter, String)
    value(changes, "notifications", before.defaultMessageNotifications, after.defaultMessageNotifications, String)
    value(changes, "mfaLevel", before.mfaLevel, after.mfaLevel, String)
    value(changes, "nsfw", before.nsfw, after.nsfw, yes)
    return changes
}
/** The changed values of a thread against the thread the bot knew before. Tags show by name when the forum's tags are known */
export function threadChanges(
    before: GuildThreadChannel,
    after: GuildThreadChannel,
    tagNames?: ReadonlyMap<string, string>,
) {
    const changes: Change[] = []
    value(changes, "name", before.name, after.name, plain)
    value(changes, "archived", before.archived, after.archived, yes)
    value(changes, "locked", before.locked, after.locked, yes)
    const tags = (thread: GuildThreadChannel) =>
        "appliedTagIds" in thread && thread.appliedTagIds ? [...thread.appliedTagIds] : undefined
    const old = tags(before),
        next = tags(after)
    if (old && next) list(changes, "tags", old, next, (tag) => metadataPlain(tagNames?.get(tag) ?? `tag ${tag}`, 100))
    return changes
}
// Permission names written as SDK names or API constants, shown as Fluxer's titles
const permissionTitle = (name: string) => {
    const squashed = name.replace(/_/g, "").toLowerCase()
    return Object.entries(permissionKeyTitles).find(([key]) => key.toLowerCase() === squashed)?.[1] ?? name
}
// What one audit value shows. Lists of IDs and forum shapes only say how many items they hold
const auditValue = (v: unknown): string =>
    v === null
        ? ""
        : typeof v === "string"
          ? metadataPlain(v)
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : Array.isArray(v)
              ? `${v.length} ${v.length === 1 ? "item" : "items"}`
              : "Changed"
/** The values an audit entry recorded. Keys that look like credentials are left out, since only some are known to be scrubbed */
export function auditChanges(entry: Record<string, unknown>) {
    const changes: Change[] = []
    const items = Array.isArray(entry.changes) ? entry.changes : []
    for (const item of items) {
        const change = object(item)
        const key = change?.key
        if (
            !change ||
            typeof key !== "string" ||
            !/^[a-z0-9_]{1,64}$/.test(key) ||
            /token|secret|password/i.test(key) ||
            changes.some((c) => c.field === key)
        )
            continue
        // Member role entries record the full role lists before and after
        if (key === "roles") {
            const roles = auditRoleChange([
                { key, oldValue: change.oldValue as never, newValue: change.newValue as never },
            ])
            if (roles.added.length || roles.removed.length)
                changes.push({
                    field: key,
                    ...(roles.added.length ? { added: mentions(roles.added, role) } : {}),
                    ...(roles.removed.length ? { removed: mentions(roles.removed, role) } : {}),
                })
            continue
        }
        const added = auditNames(change.newValue, "added") ?? auditNames(change.oldValue, "added"),
            removed = auditNames(change.newValue, "removed") ?? auditNames(change.oldValue, "removed")
        if (added || removed) {
            const names = (list?: string[]) =>
                list?.length ? metadataPlain(list.map(permissionTitle).join(", "), 600) : ""
            const a = names(added),
                r = names(removed)
            if (a || r) changes.push({ field: key, ...(a ? { added: a } : {}), ...(r ? { removed: r } : {}) })
            continue
        }
        const before = change.oldValue === undefined ? undefined : auditBits(change.oldValue),
            after = change.newValue === undefined ? undefined : auditBits(change.newValue)
        if ((key === "permissions" || key === "allow" || key === "deny") && after !== undefined) {
            permissions(before ?? 0n, after, changes, key)
            continue
        }
        const b = change.oldValue === undefined ? undefined : auditValue(change.oldValue),
            a = change.newValue === undefined ? undefined : auditValue(change.newValue)
        if (b === undefined && a === undefined) continue
        // An omitted side is unavailable, so only a recorded old value shows as before
        changes.push({ field: key, ...(b !== undefined ? { before: b || "(none)" } : {}), after: a || "(none)" })
    }
    const options = object(entry.options)
    if (options) {
        if (id(options.channelId) && !changes.some((c) => c.field === "channel_id"))
            changes.push({ field: "channel_id", after: channel(options.channelId) })
        if (Number.isSafeInteger(options.count) && !changes.some((c) => c.field === "count"))
            changes.push({ field: "count", after: String(options.count) })
        if (Number.isSafeInteger(options.membersRemoved) && !changes.some((c) => c.field === "members_removed"))
            changes.push({ field: "members_removed", after: String(options.membersRemoved) })
        if (Number.isSafeInteger(options.deleteMessagesMs) && !changes.some((c) => c.field === "delete_messages"))
            changes.push({
                field: "delete_messages",
                after: `${Math.round((options.deleteMessagesMs as number) / 1000)} seconds`,
            })
        // Overwrite entries name the role or member the overwrite is for
        if (
            [13, 14, 15].includes(entry.actionType as number) &&
            id(options.id) &&
            !changes.some((c) => c.field === "overwrite_target")
        )
            changes.push({ field: "overwrite_target", after: options.type === 1 ? user(options.id) : role(options.id) })
    }
    return changes
}
// At most 20 changes, with the rest counted
const withChanges = (changes: Change[]): Details | undefined =>
    changes.length
        ? {
              changes: changes.slice(0, CHANGE_LIMIT),
              ...(changes.length > CHANGE_LIMIT ? { moreChanges: changes.length - CHANGE_LIMIT } : {}),
          }
        : undefined
const fieldsOf = (details: Details | undefined) => details?.changes?.map((c) => c.field) ?? []
const attachmentsOf = (value: unknown) =>
    Array.isArray(value)
        ? value.flatMap((item) => {
              const a = object(item)
              const name =
                  typeof a?.filename === "string" ? a.filename : typeof a?.name === "string" ? a.name : undefined
              if (!a || !name) return []
              return [
                  {
                      name: cutText(name, 256),
                      size: Number.isSafeInteger(a.size) && (a.size as number) >= 0 ? (a.size as number) : 0,
                      ...(typeof a.url === "string" && a.url.length <= 512 && a.url.startsWith("https://")
                          ? { url: a.url }
                          : {}),
                  },
              ]
          })
        : []

/** What the bot knew before an update or a deletion, by the kind of event */
export type MetadataPrevious =
    | GuildThreadChannel
    | GuildRole
    | GuildChannel
    | Guild
    | GuildMember
    | RememberedMessage
    | readonly (RememberedMessage | undefined)[]
/** Names the projection needs that the event does not carry, such as a forum's tag names */
export interface MetadataProjectionNames {
    readonly tags?: ReadonlyMap<string, string>
}

/**
 * Project only explicit fields. Actor attribution is never borrowed from another event. previous is what the bot knew
 * before an update or a deletion: Without it an update says earlier values are unavailable
 */
export function projectMetadataEvent(
    name: string,
    payload: unknown,
    scope: MetadataProjectionScope,
    previous?: MetadataPrevious,
    names: MetadataProjectionNames = {},
): MetadataLogsEvent | undefined {
    const value = object(payload)
    if (
        !value ||
        !id(scope.serverId) ||
        !/^[a-f0-9]{32}$/.test(scope.sessionId) ||
        !Number.isSafeInteger(scope.sequence) ||
        scope.sequence < 1 ||
        !Number.isSafeInteger(scope.observedAt) ||
        scope.observedAt < 0 ||
        (value.guildId !== scope.serverId && !(name === "guildUpdate" && value.id === scope.serverId))
    )
        return
    const source: MetadataLogsSource = { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence }
    const base = (
        category: MetadataLogsCategory,
        type: MetadataLogsEventType,
        resources: unknown[],
        details?: Details,
    ): MetadataLogsEvent | undefined => {
        if (resources.length > 20 || !resources.every(id) || new Set(resources).size !== resources.length) return
        return {
            originServerId: scope.serverId,
            category,
            type,
            source,
            observedAt: scope.observedAt,
            actor: { kind: "unknown" },
            resourceIds: resources as string[],
            changedFields: category === "audit" ? [] : fieldsOf(details),
            count: 1,
            outcome: "observed",
            ...(details ? { details } : {}),
        }
    }
    // An update compared with the earlier copy, or one that says there was none
    const compared = (changes: Change[] | undefined): Details | undefined =>
        changes === undefined ? { earlierUnknown: true } : withChanges(changes)
    if (name === "guildAuditLogEntryCreate") {
        const action = value.actionType as (typeof metadataAuditActions)[number]
        if (!id(value.id) || !metadataAuditActions.includes(action)) return
        // An invite action names its code. Other actions name a resource by ID, and one without a target, such as a
        // prune, is logged without one
        const invite = action >= 40 && action <= 42
        const inviteCode =
            invite && typeof value.targetId === "string" && Schema.is(InviteCode)(value.targetId)
                ? value.targetId
                : undefined
        // The reason shows in a code block, so it keeps its own text
        const reason = typeof value.reason === "string" ? metadataSlice(value.reason.trim(), 512) : ""
        const changes = auditChanges(value)
        const details: Details | undefined =
            changes.length || reason || inviteCode
                ? { ...withChanges(changes), ...(reason ? { reason } : {}), ...(inviteCode ? { inviteCode } : {}) }
                : undefined
        return {
            ...base("audit", "audit-entry", !invite && id(value.targetId) ? [value.targetId] : [], details)!,
            source: { kind: "audit", auditEntryId: value.id },
            actor: id(value.userId) ? { kind: "audit", userId: value.userId } : { kind: "unknown" },
            auditAction: value.actionType as number,
        }
    }
    if (["guildMemberAdd", "guildMemberUpdate", "guildMemberRemove"].includes(name)) {
        const details =
            name === "guildMemberUpdate"
                ? compared(
                      previous ? memberChanges(previous as GuildMember, value as unknown as GuildMember) : undefined,
                  )
                : undefined
        const event = base(
            "membership",
            name === "guildMemberAdd" ? "member-add" : name === "guildMemberRemove" ? "member-remove" : "member-update",
            [value.userId],
            details,
        )
        if (
            event &&
            name === "guildMemberAdd" &&
            typeof value.joinedAt === "string" &&
            value.joinedAt.length <= 64 &&
            /^\d{4}-\d\d-\d\dT/.test(value.joinedAt) &&
            Date.parse(value.joinedAt) <= scope.observedAt + 1000 &&
            Date.parse(value.joinedAt) >= scope.observedAt - 900000
        )
            event.source = { kind: "member-add", userId: value.userId as string, joinedAt: value.joinedAt }
        return event
    }
    const threads: Record<string, MetadataLogsEventType> = {
        threadCreate: "thread-create",
        threadUpdate: "thread-update",
        threadDelete: "thread-delete",
    }
    if (threads[name]) {
        if (!id(value.parentId) || value.parentId === value.id) return
        // Fluxer sends the thread after a change without previous values, so fields are named only against the last known state
        const details =
            name === "threadUpdate"
                ? compared(
                      previous
                          ? threadChanges(
                                previous as GuildThreadChannel,
                                value as unknown as GuildThreadChannel,
                                names.tags,
                            )
                          : undefined,
                  )
                : undefined
        const event = base("resources", threads[name]!, [value.id], details)
        return event ? { ...event, parentChannelId: value.parentId } : undefined
    }
    // Deleting a channel deletes its threads without thread events, so one record counts the threads the bot knew
    if (name === "threadsDeletedWithParent") {
        const ids = value.threadIds
        if (
            !id(value.id) ||
            !Array.isArray(ids) ||
            ids.length < 1 ||
            !ids.every(id) ||
            new Set(ids).size !== ids.length ||
            ids.includes(value.id)
        )
            return
        const event = base("resources", "thread-delete", ids.slice(0, 20))
        return event ? { ...event, parentChannelId: value.id, count: ids.length } : undefined
    }
    const resources: Record<string, MetadataLogsEventType> = {
        guildRoleCreate: "role-create",
        guildRoleUpdate: "role-update",
        guildRoleDelete: "role-delete",
        guildChannelCreate: "channel-create",
        guildChannelUpdate: "channel-update",
        guildChannelDelete: "channel-delete",
        guildUpdate: "server-update",
    }
    if (resources[name]) {
        const current = value as unknown
        const details =
            name === "guildRoleUpdate"
                ? compared(previous ? roleChanges(previous as GuildRole, current as GuildRole) : undefined)
                : name === "guildChannelUpdate"
                  ? compared(previous ? channelChanges(previous as GuildChannel, current as GuildChannel) : undefined)
                  : name === "guildUpdate"
                    ? compared(previous ? guildChanges(previous as Guild, current as Guild) : undefined)
                    : undefined
        return base("resources", resources[name]!, [value.id ?? value.roleId], details)
    }
    if (name === "guildRoleUpdateBulk" || name === "guildChannelUpdateBulk") {
        const items = value[name === "guildRoleUpdateBulk" ? "roles" : "channels"]
        if (!Array.isArray(items) || items.length < 1) return
        const ids = items.map((v) => object(v)?.id)
        if (!ids.every(id) || new Set(ids).size !== ids.length) return
        // A batch is one observation. The bounded resource sample is not a complete inventory.
        const event = base(
            "resources",
            name === "guildRoleUpdateBulk" ? "role-update" : "channel-update",
            ids.slice(0, 20),
        )
        return event ? { ...event, count: items.length } : undefined
    }
    if (["messageUpdate", "messageDelete", "messageDeleteBulk"].includes(name)) {
        if (!id(value.channelId)) return
        const author = object(value.author)
        // A deletion carries no author flags, so the bot flag comes from the message the bot remembered
        const remembered = name === "messageDelete" ? (previous as RememberedMessage | undefined) : undefined
        if (
            author?.isBot === true ||
            author?.isSystem === true ||
            remembered?.authorBot === true ||
            value.webhookId ||
            (scope.botId && (author?.id === scope.botId || value.authorId === scope.botId))
        )
            return
        const messageIds = name === "messageDeleteBulk" ? value.ids : [value.id]
        if (
            !Array.isArray(messageIds) ||
            messageIds.length < 1 ||
            !messageIds.every(id) ||
            new Set(messageIds).size !== messageIds.length
        )
            return
        const type =
            name === "messageUpdate"
                ? "message-update"
                : name === "messageDelete"
                  ? "message-delete"
                  : "message-bulk-delete"
        const clip = (text: string) => metadataSlice(text, METADATA_TEXT)
        let details: Details | undefined
        let changed: string[] = []
        if (name === "messageUpdate") {
            const earlier = previous as RememberedMessage | undefined,
                text = typeof value.content === "string" ? clip(value.content) : undefined,
                attachments = attachmentsOf(value.attachments),
                count = Array.isArray(value.attachments) ? value.attachments.length : 0
            const differs = (field: "editedAt" | "pinned" | "flags") =>
                earlier?.[field] !== undefined && value[field] !== undefined && earlier[field] !== value[field]
            changed = [
                ...(!earlier || differs("editedAt") || (earlier.text !== undefined && earlier.text !== text)
                    ? ["update"]
                    : []),
                ...(differs("pinned") ? ["pinned"] : []),
                ...(differs("flags") ? ["flags"] : []),
            ]
            if (!changed.length) changed = ["update"]
            details = {
                ...(id(author?.id) ? { authorId: author.id } : {}),
                ...(earlier?.text === undefined
                    ? { earlierUnknown: true as const }
                    : earlier.text !== text
                      ? { before: earlier.text }
                      : {}),
                ...(text !== undefined ? { text } : {}),
                ...(attachments.length ? { attachments: attachments.slice(0, 10) } : {}),
                ...(count > Math.min(10, attachments.length) ? { attachmentCount: count } : {}),
            }
        } else if (name === "messageDelete") {
            const authorId = id(value.authorId) ? value.authorId : remembered?.authorId
            // Fluxer's own text comes first, and null or absent means it sent none
            const text = typeof value.content === "string" ? clip(value.content) : remembered?.text
            details = {
                ...(authorId ? { authorId } : {}),
                ...(text !== undefined ? { text } : {}),
                ...(remembered?.attachments?.length ? { attachments: [...remembered.attachments] } : {}),
                ...(remembered?.attachmentCount ? { attachmentCount: remembered.attachmentCount } : {}),
            }
        } else {
            // The authors the bot remembered, with how many of the messages each wrote, most first
            const counts = new Map<string, number>()
            for (const m of (Array.isArray(previous) ? previous : []) as readonly (RememberedMessage | undefined)[])
                if (m?.authorId && !m.authorBot) counts.set(m.authorId, (counts.get(m.authorId) ?? 0) + 1)
            const authors = [...counts]
                .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
                .slice(0, 20)
                .map(([userId, count]) => ({ userId, count }))
            if (authors.length) details = { authors }
        }
        const event = base(
            "messages",
            type,
            messageIds.slice(0, 20),
            details && Object.keys(details).length ? details : undefined,
        )!
        return {
            ...event,
            changedFields: changed,
            ...(name === "messageDelete"
                ? { source: { kind: "message-delete", messageId: value.id as string } as const }
                : {}),
            channelId: value.channelId,
            authorBot:
                typeof author?.isBot === "boolean"
                    ? author.isBot
                    : typeof remembered?.authorBot === "boolean"
                      ? remembered.authorBot
                      : null,
            privateChannel: false,
            count: messageIds.length,
        }
    }
}
