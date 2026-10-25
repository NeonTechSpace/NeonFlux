import assert from "node:assert/strict"
import test from "node:test"
import type { Client, Guild, GuildChannel, GuildMember, GuildRole } from "@neontechspace/fluxerly/effect"
import {
    forgetChannel,
    forgetMember,
    forgetRole,
    forgetServerChannels,
    forgetServerResources,
    rememberChannel,
    rememberGuild,
    rememberMember,
    rememberRole,
    seedServerResources,
} from "../src/resource-memory.ts"

// Each test uses its own client, so the memories never share state
const client = () => ({}) as Client
const role = (id: string, name = "Role", guildId = "1") =>
    ({ id, guildId, name, color: 0, position: 1, permissions: 0n, hoist: false, mentionable: false }) as GuildRole
const channel = (id: string, guildId = "1") => ({ id, guildId, type: 0, name: "general" }) as GuildChannel
const member = (userId: string, nickname: string, guildId = "1") =>
    ({ guildId, userId, username: "synthetic", isBot: false, roleIds: [], joinedAt: "", nickname }) as GuildMember
const guild = (id: string, name = "Server") => ({ id, name, ownerId: "10", features: [] }) as Guild

test("a server's start seeds its roles and the server, and an update returns the earlier copy", () => {
    const c = client()
    seedServerResources(c, guild("1"), [role("21", "Old")])
    assert.equal(rememberRole(c, role("21", "New"))?.name, "Old")
    assert.equal(rememberGuild(c, guild("1", "Renamed"))?.name, "Server")
    // Channels and members are learned from events, so their first change has no earlier copy
    assert.equal(rememberChannel(c, channel("31")), undefined)
    assert.equal(rememberChannel(c, channel("31"))?.id, "31")
    assert.equal(rememberMember(c, member("41", "first")), undefined)
    assert.equal(rememberMember(c, member("41", "second"))?.nickname, "first")
    // A member of another server is a separate entry
    assert.equal(rememberMember(c, member("41", "elsewhere", "2")), undefined)
})

test("deletions, category changes and a server becoming available or unavailable forget", () => {
    const c = client()
    seedServerResources(c, guild("1"), [role("21")])
    rememberChannel(c, channel("31"))
    rememberChannel(c, channel("32"))
    rememberChannel(c, channel("33", "2"))
    rememberMember(c, member("41", "a"))
    forgetRole(c, "21")
    assert.equal(rememberRole(c, role("21")), undefined)
    forgetChannel(c, "31")
    assert.equal(rememberChannel(c, channel("31")), undefined)
    forgetMember(c, "1", "41")
    assert.equal(rememberMember(c, member("41", "a")), undefined)
    forgetServerChannels(c, "1")
    assert.equal(rememberChannel(c, channel("32")), undefined)
    assert.equal(rememberChannel(c, channel("33", "2"))?.id, "33")
    forgetServerResources(c, "1")
    assert.equal(rememberGuild(c, guild("1")), undefined)
    assert.equal(rememberRole(c, role("21")), undefined)
    assert.equal(rememberMember(c, member("41", "a")), undefined)
    // A new start replaces what was kept before
    rememberRole(c, role("22", "Gone"))
    seedServerResources(c, guild("1"), [])
    assert.equal(rememberRole(c, role("22")), undefined)
})

test("each kind keeps at most the bot's SDK cache bound, dropping the oldest", () => {
    const c = client()
    for (let i = 0; i <= 20000; i++) rememberMember(c, member(String(100 + i), "n"))
    assert.equal(rememberMember(c, member("100", "n")), undefined)
    assert.equal(rememberMember(c, member("20100", "n"))?.userId, "20100")
    for (let i = 0; i <= 20000; i++) rememberChannel(c, channel(String(100 + i)))
    assert.equal(rememberChannel(c, channel("100")), undefined)
    for (let i = 0; i <= 5000; i++) rememberGuild(c, guild(String(100 + i)))
    assert.equal(rememberGuild(c, guild("100")), undefined)
    for (let i = 0; i <= 50000; i++) rememberRole(c, role(String(100 + i)))
    assert.equal(rememberRole(c, role("100")), undefined)
    assert.equal(rememberRole(c, role("50100"))?.id, "50100")
})

test("forgetting one server reads none of the entries other servers keep", () => {
    const c = client()
    let reads = 0
    // Entries whose server is read through a counter, so a scan over every server's entries shows
    const counted = <T extends object>(value: T, guildId: string) =>
        Object.defineProperty(value, "guildId", {
            get: () => {
                reads++
                return guildId
            },
        }) as T
    for (let i = 0; i < 50; i++) {
        rememberRole(c, counted(role(`2${i}`), "2"))
        rememberChannel(c, counted(channel(`3${i}`), "2"))
        rememberMember(c, counted(member(`4${i}`, "n"), "2"))
    }
    rememberRole(c, role("21"))
    reads = 0
    forgetServerResources(c, "1")
    forgetServerChannels(c, "1")
    assert.equal(reads, 0)
    assert.equal(rememberRole(c, role("21")), undefined)
    // The other server's entries are still kept
    assert.equal(rememberRole(c, role("20", "Again", "2"))?.id, "20")
})
