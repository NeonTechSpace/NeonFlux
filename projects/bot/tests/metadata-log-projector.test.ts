import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { Schema } from "effect"
import { projectMetadataEvent } from "../src/metadata-log-projector.ts"
import {
    MetadataLogsEvent,
    metadataEventLabel,
    metadataLogContent,
    metadataPlain,
} from "@neonflux/contracts/metadata-logs"

const f = createFixtures(),
    scope = {
        serverId: f.ids.guild,
        sessionId: "a".repeat(32),
        sequence: 1,
        observedAt: Date.parse("2026-10-04T20:00:00Z"),
        botId: f.ids.bot,
    }
const decode = Schema.decodeUnknownSync(MetadataLogsEvent, { onExcessProperty: "error" })
test("audit entries keep the actor, reason and recorded changes, without credential keys or invite targets", () => {
    const e = projectMetadataEvent(
        "guildAuditLogEntryCreate",
        {
            guildId: f.ids.guild,
            id: f.nextId(),
            userId: f.ids.user,
            targetId: f.ids.channel,
            actionType: 14,
            reason: "Locking for the event",
            changes: [
                { key: "topic", oldValue: "Old **topic**", newValue: "New topic" },
                { key: "allow", oldValue: "0", newValue: "2048" },
                { key: "webhook_token", newValue: "synthetic-credential-value" },
                { key: "Bad Key", newValue: "x" },
            ],
            options: { channelId: f.ids.channel, id: "777", type: 0 },
        },
        scope,
    )!
    assert.deepEqual(e.actor, { kind: "audit", userId: f.ids.user })
    assert.deepEqual(e.changedFields, [])
    assert.equal(e.details?.reason, "Locking for the event")
    assert.deepEqual(e.details?.changes, [
        { field: "topic", before: "Old \\*\\*topic\\*\\*", after: "New topic" },
        { field: "allow", added: "Send messages" },
        { field: "channel_id", after: `<#${f.ids.channel}>` },
        { field: "overwrite_target", after: "<@&777>" },
    ])
    assert(!JSON.stringify(e).includes("synthetic-credential-value"))
    decode(e)
    // A member role entry names the roles added and removed
    const roles = projectMetadataEvent(
        "guildAuditLogEntryCreate",
        {
            guildId: f.ids.guild,
            id: f.nextId(),
            userId: f.ids.user,
            targetId: f.ids.user,
            actionType: 25,
            changes: [{ key: "roles", oldValue: ["5", "6"], newValue: ["6", "7"] }],
        },
        scope,
    )!
    assert.deepEqual(roles.details, { changes: [{ field: "roles", added: "<@&7>", removed: "<@&5>" }] })
    decode(roles)
    // An invite action targets its code, which the record keeps as the invite code instead of a resource
    const invite = projectMetadataEvent(
        "guildAuditLogEntryCreate",
        { guildId: f.ids.guild, id: f.nextId(), userId: f.ids.user, targetId: "invite-code", actionType: 40 },
        scope,
    )!
    assert.deepEqual([invite.resourceIds, invite.details], [[], { inviteCode: "invite-code" }])
    decode(invite)
    assert.deepEqual(
        projectMetadataEvent("guildMemberRemove", { guildId: f.ids.guild, userId: f.ids.user, reason: "kick" }, scope)!
            .actor,
        { kind: "unknown" },
    )
})
test("message edits carry the earlier and new text, deletions Fluxer's text and the remembered attachments", () => {
    const message = {
        guildId: f.ids.guild,
        channelId: f.ids.channel,
        id: f.nextId(),
        content: "new text",
        editedAt: "2026-10-04T20:00:00.000Z",
        pinned: false,
        flags: 0,
        attachments: [{ filename: "cat.png", size: 10, url: "https://cdn.example.invalid/cat.png" }],
        author: { id: f.ids.user, isBot: false, isSystem: false },
    }
    const e = projectMetadataEvent("messageUpdate", message, scope, {
        text: "old text",
        authorId: f.ids.user,
        editedAt: null,
        pinned: false,
        flags: 0,
    })!
    assert.equal(e.authorBot, false)
    assert.deepEqual(e.changedFields, ["update"])
    assert.deepEqual(e.details, {
        authorId: f.ids.user,
        before: "old text",
        text: "new text",
        attachments: [{ name: "cat.png", size: 10, url: "https://cdn.example.invalid/cat.png" }],
    })
    decode(e)
    // A pin of an unchanged message names only the pin, and a message the bot did not remember says so
    const pinned = projectMetadataEvent("messageUpdate", { ...message, pinned: true }, scope, {
        text: "new text",
        editedAt: "2026-10-04T20:00:00.000Z",
        pinned: false,
        flags: 0,
    })!
    assert.deepEqual(pinned.changedFields, ["pinned"])
    assert.equal(pinned.details?.before, undefined)
    assert.equal(pinned.details?.earlierUnknown, undefined)
    assert.equal(projectMetadataEvent("messageUpdate", message, scope)!.details?.earlierUnknown, true)
    const deletion = projectMetadataEvent(
        "messageDelete",
        { ...message, author: undefined, authorId: f.ids.user, content: "deleted text" },
        scope,
        { text: "remembered", attachments: [{ name: "cat.png", size: 10 }] },
    )!
    assert.equal(deletion.authorBot, null)
    assert.deepEqual(deletion.actor, { kind: "unknown" })
    assert.equal(deletion.source.kind, "message-delete")
    assert.deepEqual(deletion.details, {
        authorId: f.ids.user,
        text: "deleted text",
        attachments: [{ name: "cat.png", size: 10 }],
    })
    decode(deletion)
    // Without Fluxer's text the remembered text shows, and a remembered bot author keeps the deletion out
    const remembered = projectMetadataEvent("messageDelete", { ...message, author: undefined, content: null }, scope, {
        text: "remembered",
        authorId: f.ids.user,
    })!
    assert.deepEqual(remembered.details, { authorId: f.ids.user, text: "remembered" })
    assert.equal(
        projectMetadataEvent("messageDelete", { ...message, author: undefined }, scope, { authorBot: true }),
        undefined,
    )
    assert.equal(
        projectMetadataEvent("messageUpdate", { ...message, author: { id: f.ids.bot, isBot: true } }, scope),
        undefined,
    )
    assert.equal(projectMetadataEvent("messageDelete", { ...message, guildId: undefined }, scope), undefined)
})
test("a deleted or edited message keeps up to 4,000 characters, Fluxer's longest message, and its post fits one embed", () => {
    const message = {
        guildId: f.ids.guild,
        channelId: f.ids.channel,
        id: f.nextId(),
        author: { id: f.ids.user, isBot: false },
    }
    const long = "d".repeat(3500)
    const deletion = projectMetadataEvent("messageDelete", { ...message, content: long }, scope)!
    assert.equal(deletion.details?.text, long)
    decode(deletion)
    const description = metadataLogContent(1, deletion, f.ids.guild).split("\n").slice(1).join("\n")
    assert.ok(description.length <= 4096, String(description.length))
    assert.ok(description.includes(`\`\`\`\n${long}\n\`\`\``), "the whole text shows")
    const edit = projectMetadataEvent(
        "messageUpdate",
        { ...message, content: "e".repeat(4500), editedAt: "2026-10-04T20:00:01.000Z", pinned: false, flags: 0 },
        scope,
        { text: "b".repeat(4000), editedAt: "2026-10-04T20:00:00.000Z", pinned: false, flags: 0 },
    )!
    assert.equal(edit.details?.before?.length, 4000)
    assert.equal(edit.details?.text?.length, 4000)
    decode(edit)
    assert.ok(metadataLogContent(1, edit, f.ids.guild).split("\n").slice(1).join("\n").length <= 4096)
})
test("member, role, channel and server updates name their changed values, or say the earlier ones are unknown", () => {
    const member = {
        guildId: f.ids.guild,
        userId: f.ids.user,
        username: "synthetic",
        isBot: false,
        roleIds: ["5", "6"],
        joinedAt: "2026-10-04T19:00:00Z",
        nickname: "Old",
        communicationDisabledUntil: null,
    }
    const updated = projectMetadataEvent(
        "guildMemberUpdate",
        { ...member, roleIds: ["6", "7"], nickname: "New\n**fake line**" },
        scope,
        member as never,
    )!
    assert.deepEqual(updated.changedFields, ["nickname", "roles"])
    assert.deepEqual(updated.details?.changes, [
        { field: "nickname", before: "Old", after: "New \\*\\*fake line\\*\\*" },
        { field: "roles", added: "<@&7>", removed: "<@&5>" },
    ])
    decode(updated)
    const unknown = projectMetadataEvent("guildMemberUpdate", member, scope)!
    assert.deepEqual(unknown.details, { earlierUnknown: true })
    decode(unknown)
    const role = { guildId: f.ids.guild, id: "5", name: "Mods", color: 0, position: 2, permissions: 0n, hoist: false }
    const roleEvent = projectMetadataEvent(
        "guildRoleUpdate",
        { ...role, color: 0xff0000, permissions: 8n | 2048n },
        scope,
        role as never,
    )!
    assert.deepEqual(roleEvent.details?.changes, [
        { field: "color", before: "(none)", after: "#ff0000" },
        { field: "permissions", added: "Administrator, Send messages" },
    ])
    decode(roleEvent)
    const iconChange = (before: object, after: object) => {
        const event = projectMetadataEvent("guildRoleUpdate", { ...role, ...after }, scope, {
            ...role,
            ...before,
        } as never)!
        decode(event)
        return event.details?.changes
    }
    const none = { icon: null, unicodeEmoji: null },
        emoji = (unicodeEmoji: string) => ({ icon: null, unicodeEmoji }),
        picture = (icon: string) => ({ icon, unicodeEmoji: null })
    assert.deepEqual(iconChange(none, picture("a")), [{ field: "icon", before: "(none)", after: "Image" }])
    assert.deepEqual(iconChange(picture("a"), picture("b")), [{ field: "icon", after: "Changed" }])
    assert.deepEqual(iconChange(picture("a"), none), [{ field: "icon", before: "Image", after: "(none)" }])
    assert.deepEqual(iconChange(emoji("🛡️"), picture("a")), [{ field: "icon", before: "🛡️", after: "Image" }])
    assert.deepEqual(iconChange(picture("a"), emoji("🛡️")), [{ field: "icon", before: "Image", after: "🛡️" }])
    assert.deepEqual(iconChange(none, emoji("🛡️")), [{ field: "icon", before: "(none)", after: "🛡️" }])
    assert.deepEqual(iconChange(emoji("🛡️"), none), [{ field: "icon", before: "🛡️", after: "(none)" }])
    assert.deepEqual(iconChange(emoji("🧑‍💻"), emoji("🏃🏻‍♂️")), [{ field: "icon", before: "🧑‍💻", after: "🏃🏻‍♂️" }])
    // Either field alone proves what the role shows
    assert.deepEqual(iconChange({ unicodeEmoji: "🛡️" }, picture("a")), [
        { field: "icon", before: "🛡️", after: "Image" },
    ])
    assert.deepEqual(iconChange({ icon: "a" }, emoji("🛡️")), [{ field: "icon", before: "Image", after: "🛡️" }])
    // A snapshot without either field says nothing about what the role showed
    assert.equal(iconChange({}, picture("a")), undefined)
    // A joining character stays only inside an emoji, since elsewhere it could hide text
    assert.equal(metadataPlain("a\u200db 🧑\u200d c \u200d🧑"), "a b 🧑  c  🧑")
    const channel = {
        guildId: f.ids.guild,
        id: f.ids.channel,
        type: 0,
        name: "general",
        topic: "Hi",
        rateLimitPerUser: 0,
        permissionOverwrites: [{ id: "5", type: "role", allow: 0n, deny: 0n }],
    }
    const channelEvent = projectMetadataEvent(
        "guildChannelUpdate",
        {
            ...channel,
            rateLimitPerUser: 30,
            permissionOverwrites: [{ id: "5", type: "role", allow: 1024n, deny: 0n }],
        },
        scope,
        channel as never,
    )!
    assert.deepEqual(channelEvent.details?.changes, [
        { field: "slowmode", before: "(none)", after: "30 seconds" },
        { field: "overwrites", after: "<@&5>" },
    ])
    decode(channelEvent)
    const server = { id: f.ids.guild, name: "Server", ownerId: "10", features: [], icon: null }
    const serverEvent = projectMetadataEvent(
        "guildUpdate",
        { ...server, ownerId: "11", icon: "abc" },
        scope,
        server as never,
    )!
    assert.deepEqual(serverEvent.details?.changes, [
        { field: "icon", after: "Changed" },
        { field: "owner", before: "<@10>", after: "<@11>" },
    ])
    decode(serverEvent)
    // A thread names its tags by the forum's names when they are known
    const thread = {
        guildId: f.ids.guild,
        id: f.nextId(),
        parentId: f.ids.channel,
        type: 11,
        name: "Post",
        archived: false,
        locked: false,
        appliedTagIds: ["81"],
    }
    const tagged = projectMetadataEvent("threadUpdate", { ...thread, appliedTagIds: ["82"] }, scope, thread as never, {
        tags: new Map([
            ["81", "Bug"],
            ["82", "Solved"],
        ]),
    })!
    assert.deepEqual(tagged.details?.changes, [{ field: "tags", added: "Solved", removed: "Bug" }])
    decode(tagged)
    // An update that changed nothing NeonFlux shows makes no claim
    assert.equal(projectMetadataEvent("guildRoleUpdate", role, scope, role as never)!.details, undefined)
})
test("bulk observations retain actual bounded count and bounded ID sample", () => {
    const ids = Array.from({ length: 25 }, () => f.nextId())
    const e = projectMetadataEvent(
        "messageDeleteBulk",
        { guildId: f.ids.guild, channelId: f.ids.channel, ids, content: "secret" },
        scope,
    )!
    assert.equal(e.count, 25)
    assert.equal(e.resourceIds.length, 20)
    assert.equal(e.details, undefined)
    decode(e)
    // The authors the bot remembered, most messages first, and never any text or a bot
    const authored = projectMetadataEvent(
        "messageDeleteBulk",
        { guildId: f.ids.guild, channelId: f.ids.channel, ids: ids.slice(0, 3) },
        scope,
        [
            { authorId: "8", text: "secret" },
            undefined,
            { authorId: "9" },
            { authorId: "9" },
            { authorId: "7", authorBot: true },
        ],
    )!
    assert.deepEqual(authored.details, {
        authors: [
            { userId: "9", count: 2 },
            { userId: "8", count: 1 },
        ],
    })
    assert(!JSON.stringify(authored).includes("secret"))
    decode(authored)
    const roles = projectMetadataEvent(
        "guildRoleUpdateBulk",
        { guildId: f.ids.guild, roles: ids.map((id) => ({ id, name: "secret" })) },
        scope,
    )!
    assert.equal(roles.count, 25)
    assert.equal(roles.resourceIds.length, 20)
    decode(roles)
    assert.equal(
        projectMetadataEvent(
            "messageDeleteBulk",
            { guildId: f.ids.guild, channelId: f.ids.channel, ids: [ids[0], ids[0]] },
            scope,
        ),
        undefined,
    )
})
test("stable sources and explicit observation sources do not invent update identity", () => {
    const member = { guildId: f.ids.guild, userId: f.ids.user, joinedAt: "2026-10-04T19:59:00Z" }
    assert.equal(projectMetadataEvent("guildMemberAdd", member, scope)!.source.kind, "member-add")
    const first = projectMetadataEvent("guildMemberUpdate", member, scope)!,
        second = projectMetadataEvent("guildMemberUpdate", member, { ...scope, sequence: 2 })!
    assert.notDeepEqual(first.source, second.source)
    assert.deepEqual(first.changedFields, [])
    assert.throws(() => decode({ ...first, reason: "secret" }))
    assert.throws(() => decode({ ...first, actor: { kind: "audit", userId: f.ids.user } }))
})
test("an audit reason cut at its limit never splits an emoji", () => {
    const e = projectMetadataEvent(
        "guildAuditLogEntryCreate",
        {
            guildId: f.ids.guild,
            id: f.nextId(),
            userId: f.ids.user,
            targetId: f.ids.channel,
            actionType: 14,
            reason: `${"a".repeat(511)}😀`,
        },
        scope,
    )!
    assert.equal(e.details!.reason, "a".repeat(511))
    decode(e)
})
test("message deletions, webhook changes and prunes from the audit log are logged, a prune without a target too", () => {
    const audit = (actionType: number, targetId: string | null, extra: Record<string, unknown> = {}) =>
        projectMetadataEvent(
            "guildAuditLogEntryCreate",
            { guildId: f.ids.guild, id: f.nextId(), userId: f.ids.user, targetId, actionType, ...extra },
            scope,
        )!
    const lines = (event: MetadataLogsEvent) => metadataLogContent(1, event, f.ids.guild).split("\n")
    // Fluxer names the deleted message and the member who deleted it
    const deleted = audit(72, "901", { options: { channelId: f.ids.channel } })
    decode(deleted)
    assert.equal(metadataEventLabel(`audit-entry:${deleted.auditAction}`), "Audit: Message deleted")
    assert.deepEqual(deleted.actor, { kind: "audit", userId: f.ids.user })
    assert.ok(lines(deleted).includes(`By: <@${f.ids.user}>`))
    assert.ok(lines(deleted).includes("Messages: 901"))
    assert.ok(lines(deleted).includes(`**Channel_id**: <#${f.ids.channel}>`))
    const webhook = audit(50, "902", { changes: [{ key: "name", newValue: "Synthetic hook" }] })
    decode(webhook)
    assert.equal(metadataEventLabel(`audit-entry:${webhook.auditAction}`), "Audit: Webhook created")
    assert.ok(lines(webhook).includes("Webhook: 902"))
    const prune = audit(21, null, { options: { membersRemoved: 12 } })
    decode(prune)
    assert.equal(metadataEventLabel(`audit-entry:${prune.auditAction}`), "Audit: Members pruned")
    assert.deepEqual(prune.resourceIds, [])
    assert.deepEqual(prune.details, { changes: [{ field: "members_removed", after: "12" }] })
    assert.ok(!lines(prune).some((line) => line.startsWith("About:")))
    assert.ok(lines(prune).includes(`By: <@${f.ids.user}>`))
})
test("a deleted channel's threads, a bulk deletion and a role batch are counted in full, however many", () => {
    const ids = (count: number, from: number) => Array.from({ length: count }, (_, i) => String(from + i))
    const threads = projectMetadataEvent(
        "threadsDeletedWithParent",
        { guildId: f.ids.guild, id: f.ids.channel, threadIds: ids(1500, 100000) },
        scope,
    )!
    decode(threads)
    assert.deepEqual([threads.count, threads.resourceIds.length], [1500, 20])
    const roles = projectMetadataEvent(
        "guildRoleUpdateBulk",
        { guildId: f.ids.guild, roles: ids(1200, 200000).map((id) => ({ id })) },
        scope,
    )!
    decode(roles)
    assert.equal(roles.count, 1200)
    const bulk = projectMetadataEvent(
        "messageDeleteBulk",
        { guildId: f.ids.guild, channelId: f.ids.channel, ids: ids(1100, 300000) },
        scope,
        [],
    )!
    decode({ ...bulk, privateChannel: false })
    assert.equal(bulk.count, 1100)
})
