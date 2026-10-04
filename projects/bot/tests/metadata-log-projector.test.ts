import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { Schema } from "effect"
import { projectMetadataEvent } from "../src/metadata-log-projector.ts"
import { metadataLogEventSchema } from "../src/metadata-log-store.ts"

const f = createFixtures(), scope = { serverId: f.ids.guild, sessionId: "a".repeat(32), sequence: 1, observedAt: Date.parse("2026-10-04T20:00:00Z"), botId: f.ids.bot }
const decode = Schema.decodeUnknownSync(metadataLogEventSchema, { onExcessProperty: "error" })
test("metadata projects audit attribution only for the exact allowlisted entry without private fields", () => {
    const e = projectMetadataEvent("guildAuditLogEntryCreate", { guildId: f.ids.guild, id: f.nextId(), userId: f.ids.user, targetId: f.ids.channel, actionType: 10, reason: "private reason", changes: [{ key: "topic", newValue: "private body" }], options: { private: true } }, scope)!
    assert.deepEqual(e.actor, { kind: "audit", userId: f.ids.user }); assert.deepEqual(e.changedFields, [])
    assert(!JSON.stringify(e).includes("private")); decode(e)
    assert.equal(projectMetadataEvent("guildAuditLogEntryCreate", { guildId: f.ids.guild, id: f.nextId(), userId: f.ids.user, targetId: "invite-code", actionType: 40 }, scope), undefined)
    assert.deepEqual(projectMetadataEvent("guildMemberRemove", { guildId: f.ids.guild, userId: f.ids.user, reason: "kick" }, scope)!.actor, { kind: "unknown" })
})
test("message updates keep false author evidence and strip content, deletion preserves unknown author", () => {
    const message = { guildId: f.ids.guild, channelId: f.ids.channel, id: f.nextId(), content: "secret", attachments: [{ url: "private" }], author: { id: f.ids.user, isBot: false, isSystem: false } }
    const e = projectMetadataEvent("messageUpdate", message, scope)!
    assert.equal(e.authorBot, false); assert.deepEqual(e.changedFields, ["update"]); assert(!JSON.stringify(e).includes("secret")); decode(e)
    const deletion = projectMetadataEvent("messageDelete", { ...message, author: undefined, authorId: f.ids.user }, scope)!
    assert.equal(deletion.authorBot, null); assert.deepEqual(deletion.actor, { kind: "unknown" }); assert.equal(deletion.source.kind, "message-delete"); decode(deletion)
    assert.equal(projectMetadataEvent("messageUpdate", { ...message, author: { id: f.ids.bot, isBot: true } }, scope), undefined)
    assert.equal(projectMetadataEvent("messageDelete", { ...message, guildId: undefined }, scope), undefined)
    assert.equal(projectMetadataEvent("messageDelete", message, { ...scope, excludedChannelIds: [f.ids.channel] }), undefined)
})
test("bulk observations retain actual bounded count and bounded ID sample", () => {
    const ids = Array.from({ length: 25 }, () => f.nextId())
    const e = projectMetadataEvent("messageDeleteBulk", { guildId: f.ids.guild, channelId: f.ids.channel, ids, content: "secret" }, scope)!
    assert.equal(e.count, 25); assert.equal(e.resourceIds.length, 20); decode(e)
    const roles = projectMetadataEvent("guildRoleUpdateBulk", { guildId: f.ids.guild, roles: ids.map(id => ({ id, name: "secret" })) }, scope)!
    assert.equal(roles.count, 25); assert.equal(roles.resourceIds.length, 20); decode(roles)
    assert.equal(projectMetadataEvent("messageDeleteBulk", { guildId: f.ids.guild, channelId: f.ids.channel, ids: [ids[0], ids[0]] }, scope), undefined)
})
test("stable sources and explicit observation sources do not invent update identity", () => {
    const member = { guildId: f.ids.guild, userId: f.ids.user, joinedAt: "2026-10-04T19:59:00Z" }
    assert.equal(projectMetadataEvent("guildMemberAdd", member, scope)!.source.kind, "member-add")
    const first = projectMetadataEvent("guildMemberUpdate", member, scope)!, second = projectMetadataEvent("guildMemberUpdate", member, { ...scope, sequence: 2 })!
    assert.notDeepEqual(first.source, second.source); assert.deepEqual(first.changedFields, [])
    assert.throws(() => decode({ ...first, reason: "secret" }))
    assert.throws(() => decode({ ...first, actor: { kind: "audit", userId: f.ids.user } }))
})
