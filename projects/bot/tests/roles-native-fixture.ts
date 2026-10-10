import type * as C from "@neonflux/backend/contracts"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { platform } from "./moderation-fixture.ts"
import type { rolesBoundary } from "./roles-fixture.ts"
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
export function nativeRoles(bot: Bot) {
    const p = platform(bot), f = bot.fixtures
    const role = f.role({ position: 2, permissions: "0" }), second = f.role({ position: 3, permissions: "0" })
    p.rolesRoute.remove(); bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, role, second] })
    const roleIds = new Set([p.targetRole.id])
    p.target.remove()
    const target = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({ body: f.member({ user: f.user({ id: p.targetId }), roles: [...roleIds], communication_disabled_until: null }) }))
    const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", (request) => { roleIds.add(request.path.split("/").at(-1)!); return { status: 204 } })
    const remove = bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", (request) => { roleIds.delete(request.path.split("/").at(-1)!); return { status: 204 } })
    const messages = new Map<string, ReturnType<typeof f.message>>()
    p.replies.remove()
    const send = bot.rest.respond("POST /channels/:id/messages", (request) => {
        const body = request.body as { content?: string, embeds?: object[] }
        // Fluxer returns sent embeds as rich embeds whose fields say whether they are inline
        const embeds = (body.embeds ?? []).map(embed => {
            const rich = embed as { fields?: { name: string, value: string, inline?: boolean }[] }
            return { type: "rich", ...embed, ...(rich.fields ? { fields: rich.fields.map(field => ({ ...field, inline: field.inline ?? false })) } : {}) }
        })
        const message = f.message({ channel_id: request.path.split("/")[2], author: f.botUser(), content: body.content ?? "", embeds })
        messages.set(message.id, message); return { body: message }
    })
    bot.rest.respond("GET /channels/:id/messages/:id", (request) => ({ body: messages.get(request.path.split("/").at(-1)!) }))
    return { ...p, role, second, roleIds, target, add, remove, messages, send }
}
export function savedPanel(bot: Bot, native: ReturnType<typeof nativeRoles>, remote: ReturnType<typeof rolesBoundary>, kind: C.RolesPanelKind = "reaction") {
    const message = bot.fixtures.message({ author: bot.fixtures.botUser(), content: "Current panel" })
    native.messages.set(message.id, message)
    const panel: C.RolesPanel = { name: kind === "verification" ? "rules" : "colors", kind, revision: 1, enabled: true, withdrawing: false, exclusive: false,
        mappings: [{ emoji: "✅", roleId: native.role.id, prerequisiteRoleIds: [], exclusionRoleIds: [] }],
        published: { revision: 1, publishedAt: 0, postNo: 1, postGeneration: 1, channelId: bot.fixtures.ids.channel, messageId: message.id, botId: bot.fixtures.ids.bot,
            content: { content: message.content }, mappings: [{ emoji: "✅", roleId: native.role.id, prerequisiteRoleIds: [], exclusionRoleIds: [] }], exclusive: false } }
    remote.panels.set(panel.name, panel)
    return panel
}
