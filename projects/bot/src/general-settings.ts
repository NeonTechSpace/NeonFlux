import { Clock, Effect, Schema } from "effect"
import { Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const prefix = Schema.String.check(Schema.makeFilter(value => /^[!$%&*+,.?~^|:/\-]{1,5}$/.test(value)))
const revision = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0))
const state = Schema.Struct({ prefix, revision })
const outcome = Schema.Union([Schema.Struct({ saved: Schema.Literal(true), revision }), Schema.Struct({ saved: Schema.Literal(false), conflict: Schema.Literal(true), revision })])
export function createGeneralSettingsStore(backend: BackendConfig, serverId: string) {
    const request = createBackendRequest(backend)
    return {
        get: () => request("/general/get", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(state))),
        set: (actorId: string, value: string, expectedRevision: number) => request("/general/manage", { serverId, actorId, managerAuthorized: true, prefix: value, expectedRevision }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(outcome))),
    }
}
export type GeneralSettingsStore = ReturnType<typeof createGeneralSettingsStore>

// The server prefix in bot memory. Chat changes apply at once and other changes within the TTL
export const prefixTtlMs = 30000
const prefixes = new Map<string, { value: string, readAt: number }>()
const remember = (serverId: string, value: string) => Clock.currentTimeMillis.pipe(Effect.map(readAt => { prefixes.set(serverId, { value, readAt }) }))

/** Print bot-authored usage text with a reply's prefix */
export const withPrefix = (text: string, prefix: string) => prefix === "!" ? text : text.replace(/(?<![\w!])!(?=[a-z])/g, () => prefix)

/** Start one server's prefix memory for a new bot run and return its reader */
export function createPrefixReader(store: GeneralSettingsStore | undefined, serverId: string) {
    prefixes.delete(serverId)
    return Effect.gen(function* () {
        if (!store) return "!"
        const cached = prefixes.get(serverId)
        if (cached && (yield* Clock.currentTimeMillis) - cached.readAt < prefixTtlMs) return cached.value
        // A failed refresh keeps the last known prefix, or ! without one, for another TTL
        const value = yield* store.get().pipe(Effect.map(settings => settings.prefix), Effect.catch(() =>
            Effect.logWarning("The configured prefix could not be read. Commands use the last known prefix or !").pipe(Effect.as(cached?.value ?? "!"))))
        yield* remember(serverId, value)
        return value
    })
}

export function handlePrefixCommand(store: GeneralSettingsStore | undefined, serverId: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const respond = (content: string) => context.reply({ content, allowedMentions: { users: [], roles: [], everyone: false, repliedUser: false } })
    return Effect.gen(function* () {
        if (!store) { yield* respond("Prefix persistence is not configured"); return }
        if (context.message.guildId !== serverId) return
        const current = yield* store.get()
        yield* remember(serverId, current.prefix)
        if (!args.length) { yield* respond(`Current prefix: ${current.prefix}`); return }
        if (args.length !== 1 || !/^[!$%&*+,.?~^|:/\-]{1,5}$/.test(args[0]!)) { yield* respond("Use prefix <one to five punctuation characters>"); return }
        const authorized = yield* Effect.gen(function* () {
            const guild = yield* context.client.guilds.fetch(serverId, { timeoutMs: 5000 })
            const member = yield* context.client.members.fetch({ guildId: serverId, userId: context.message.author.id }, { timeoutMs: 5000 })
            const roles = yield* context.client.roles.fetchAll(serverId)
            if (guild.id !== serverId || member.guildId !== serverId || member.userId !== context.message.author.id) return false
            const bits = context.client.permissions.calculate({ guild, member, roles })
            return guild.ownerId === member.userId || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n
        }).pipe(Effect.timeout("5 seconds"), Effect.catch(() => Effect.succeed(false)))
        if (!authorized) { yield* respond("Only the server owner or members with Manage Server can change the prefix"); return }
        const saved = yield* store.set(context.message.author.id, args[0]!, current.revision)
        if (saved.saved) yield* remember(serverId, args[0]!)
        yield* respond(saved.saved ? `Prefix changed to ${args[0]}` : "The prefix changed while this command ran. Check the current prefix and try again")
    })
}
