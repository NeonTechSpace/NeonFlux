import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot, type TestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { createBotOptions } from "../src/bot.ts"
import { installNote } from "../src/install-note.ts"
import { fakeClient } from "./backend-fake.ts"

const serverId = "1100000000000000004", systemId = "1300000000000000001", lowId = "1300000000000000002", highId = "1300000000000000003"
// The backend answers welcome only for the join that starts an installation, as joinInstallation does
function multiConfig() {
    const active = new Set<string>(), joins: string[] = []
    const client = fakeClient(call => {
        const body = (call.body ?? {}) as { serverId?: string }
        if (call.path === "/service/scope") return { mode: "multi" }
        if (call.path === "/service/installations/list") return { serverIds: [...active], nextCursor: null }
        if (call.path === "/service/installations/join") {
            joins.push(body.serverId!)
            const welcome = !active.has(body.serverId!)
            active.add(body.serverId!)
            return { serverId: body.serverId, active: true, ...(welcome ? { welcome: true } : {}) }
        }
        if (call.path === "/general/get") return { prefix: "?", revision: 1, nickname: { nickname: null, revision: 0, result: null } }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, (_name, _args, onValue) => { onValue({ version: 0 }); return () => {} })
    return { joins, config: { token: Redacted.make("synthetic-token"), scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), websiteUrl: "https://dashboard.synthetic.invalid",
        backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client } } }
}
// The bot may view and send everywhere unless a channel denies it. The system channel denies sending when systemWritable is false
function server(bot: TestBot, options: { systemWritable: boolean, anyWritable?: boolean }) {
    const f = bot.fixtures
    const botRole = f.role({ position: 5, permissions: String(Permissions.ViewChannel | Permissions.SendMessages) })
    bot.rest.respond("GET /users/@me/guilds", { body: [] })
    bot.rest.respond(`GET /guilds/${serverId}`, { body: f.guild({ id: serverId, owner_id: f.nextId(), system_channel_id: systemId }) })
    bot.rest.respond(`GET /guilds/${serverId}/roles`, { body: [f.role({ id: serverId, guild_id: serverId, permissions: "0" }), { ...botRole, guild_id: serverId }] })
    bot.rest.respond(`GET /guilds/${serverId}/members/${f.ids.bot}`, { body: f.member({ guild_id: serverId, user: f.botUser(), roles: [botRole.id] }) })
    const deny = (id: string) => [{ id: botRole.id, type: 0, allow: "0", deny: String(Permissions.SendMessages) }].filter(() => id === systemId && !options.systemWritable || options.anyWritable === false)
    const channels = bot.rest.respond(`GET /guilds/${serverId}/channels`, { body: [systemId, highId, lowId].map((id, index) => f.channel({ id, guild_id: serverId, type: 0, position: id === lowId ? 1 : index + 2, permission_overwrites: deny(id) })) })
    const sent = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ channel_id: request.path.split("/")[2]!, content: String((request.body as { content?: unknown }).content) }) }))
    return { channels, sent }
}
const added = (bot: TestBot) => bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ guild: { id: serverId }, channels: [] }))

test("a new installation posts one note in the system channel, and repeated joins post nothing more", async () => {
    const { joins, config } = multiConfig()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions(config))
        const native = server(bot, { systemWritable: true })
        yield* bot.ready()
        yield* added(bot)
        const note = yield* native.sent.next()
        assert.equal(note.path, `/channels/${systemId}/messages`)
        assert.equal((note.body as { content: string }).content, installNote(serverId, "?", "https://dashboard.synthetic.invalid"))
        assert.match(installNote(serverId, "?", "https://dashboard.synthetic.invalid"), /\?help.*\?setup[\s\S]*dashboard: https:\/\/dashboard\.synthetic\.invalid\/\?server=1100000000000000004$/)
        yield* added(bot)
        yield* bot.idle()
        assert.deepEqual(joins, [serverId])
        assert.equal(native.sent.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("without a writable system channel the note goes to the first text channel the bot can send in, or nowhere", async () => {
    for (const anyWritable of [true, false]) {
        const { config } = multiConfig()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions(config))
            const native = server(bot, { systemWritable: false, anyWritable })
            yield* bot.ready()
            yield* added(bot)
            if (anyWritable) assert.equal((yield* native.sent.next()).path, `/channels/${lowId}/messages`)
            else {
                yield* native.channels.next()
                yield* bot.idle()
                assert.equal(native.sent.requests().length, 0)
            }
        })))
    }
})
