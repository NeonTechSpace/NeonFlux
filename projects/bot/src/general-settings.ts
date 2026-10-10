import { Clock, Effect, Schema } from "effect"
import { Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import type { GeneralNickname, ModerationActor } from "@neonflux/backend/contracts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { BackendRequestError, createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"

/** Fluxer's 1 to 32 UTF-16 code units, without surrounding spaces or control characters, so the returned nickname compares exactly */
export const validNickname = (value: string) => value.length >= 1 && value.length <= 32 && value.trim() === value && !/[\u0000-\u001f\u007f\u202e]/.test(value)
const prefix = Schema.String.check(Schema.makeFilter(value => /^[!$%&*+,.?~^|:/\-]{1,5}$/.test(value)))
const revision = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0))
const state = Schema.Struct({ prefix, revision })
const outcome = Schema.Union([Schema.Struct({ saved: Schema.Literal(true), revision }), Schema.Struct({ saved: Schema.Literal(false), conflict: Schema.Literal(true), revision })])
const nickname = Schema.NullOr(Schema.String.check(Schema.makeFilter(validNickname)))
const nicknameState = Schema.Struct({ nickname: Schema.Struct({ nickname, revision, result: Schema.NullOr(Schema.Struct({ state: Schema.Literals(["pending", "applied", "failed"]), nickname, at: revision, error: Schema.optionalKey(Schema.String) })) }) })
export function createGeneralSettingsStore(backend: BackendConfig, serverId: string) {
    const request = createBackendRequest(backend)
    return {
        get: () => request("/general/get", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(state))),
        set: (actorId: string, value: string, expectedRevision: number) => request("/general/manage", { serverId, originServerId: serverId, actorId, managerAuthorized: true, prefix: value, expectedRevision }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(outcome))),
        nickname: () => request("/general/get", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(nicknameState)), Effect.map((value): GeneralNickname => value.nickname)),
        setNickname: (actorId: string, value: string | null, createdAt: number) => request("/general/nickname", { serverId, originServerId: serverId, actorId, managerAuthorized: true, createdAt, nickname: value })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ revision })))),
        recordNickname: (nicknameRevision: number, value: string | null, result: NicknameOutcome) => request("/general/nickname-result", { serverId, originServerId: serverId, revision: nicknameRevision, nickname: value, ...result })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ recorded: Schema.Boolean })))),
    }
}
export type GeneralSettingsStore = ReturnType<typeof createGeneralSettingsStore>

export type NicknameOutcome = { state: "applied" } | { state: "failed", error: string }
export const missingNicknamePermission = "Missing Change Nickname permission. Fluxer kept a different nickname"
/**
 * Set or clear the bot's own nickname. Without Change Nickname, Fluxer reports success and keeps the old nickname,
 * so only a returned nickname equal to the requested one counts as applied
 */
export function applyNativeNickname(client: Client, serverId: string, value: string | null) {
    return client.members.editSelf(serverId, { nickname: value }).pipe(
        Effect.map((member): NicknameOutcome => member.guildId !== serverId || member.nickname === undefined ? { state: "failed", error: "Fluxer did not confirm the nickname change" }
            : member.nickname === value ? { state: "applied" } : { state: "failed", error: missingNicknamePermission }),
        Effect.catch((error): Effect.Effect<NicknameOutcome> => Effect.succeed({ state: "failed",
            error: error._tag === "GuildOperationError" && error.reason === "rejected" && error.status === 403 ? missingNicknamePermission : "Fluxer did not confirm the nickname change" })))
}

// Each managed server's prefix in bot memory. Chat changes apply at once and dashboard changes within the TTL
export const prefixTtlMs = 30000
const prefixes = new Map<string, { value: string, readAt: number }>()
const remember = (serverId: string, value: string) => Clock.currentTimeMillis.pipe(Effect.map(readAt => { prefixes.set(serverId, { value, readAt }) }))

/** The prefix that commands in a reply to this message use. Private DMs keep the fixed ! that also selects a server */
export const replyPrefix = (serverId: string, guildId: string | undefined) => guildId === serverId ? prefixes.get(serverId)?.value ?? "!" : "!"

/** Print bot-authored usage text with a reply's prefix. Lines that send the reader to a DM keep the fixed ! */
export const withPrefix = (text: string, prefix: string) => prefix === "!" ? text : text.split("\n")
    .map(line => /\bDM\b/.test(line) ? line : line.replace(/(?<![\w!])!(?=[a-z])/g, () => prefix)).join("\n")

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
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* respond("Only the server owner or members with Manage Server can change the prefix"); return }
        const saved = yield* store.set(context.message.author.id, args[0]!, current.revision)
        if (saved.saved) yield* remember(serverId, args[0]!)
        yield* respond(saved.saved ? `Prefix changed to ${args[0]}` : "The prefix changed while this command ran. Check the current prefix and try again")
    })
}

/** Server settings follow one rule: the server owner, Administrator or Manage Server, read fresh from Fluxer. The owner holds every permission */
export function readServerManagerAuthority(client: Client, serverId: string, userId: string) {
    return client.permissions.fetch({ guildId: serverId, userId }, { timeoutMs: 5000 }).pipe(
        Effect.map(bits => (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n), Effect.catch(() => Effect.succeed(false)))
}

/** The same rule with the fresh reads a backend change carries, optionally with one channel of this server */
export function readServerManager(client: Client, serverId: string, userId: string, channelId?: string) {
    return readSafetyAuthority(client, serverId, userId, channelId ? { channelId } : {}).pipe(Effect.map(authority => ({
        authority,
        actor: { originServerId: authority.guild.id, userId, roleIds: authority.roleIds, isOwner: authority.isOwner, isAdministrator: authority.isAdmin, nativePermissionAuthorized: true } satisfies ModerationActor,
        manager: authority.isOwner || (client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles }) & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n,
    })))
}

const nicknameUsage ="Use nickname to show the bot's nickname, nickname set <name> with 1 to 32 characters, or nickname reset to show the bot's username"
const nicknameText = (value: string | null) => value ?? "none, so the bot's username is shown"

/** Set, reset or show the bot's nickname in this server. Changes apply at once and the result is recorded for the website */
export function handleNicknameCommand(store: GeneralSettingsStore | undefined, serverId: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const respond = (content: string) => context.reply({ content, allowedMentions: noMentions })
    return Effect.gen(function* () {
        if (!store) { yield* respond("Nickname persistence is not configured"); return }
        if (context.message.guildId !== serverId) return
        const verb = args[0]?.toLowerCase()
        if (!args.length) {
            const current = yield* store.nickname(), result = current.result
            const last = !result ? "" : result.state === "pending" ? "\nLast change: not confirmed by the bot" : result.state === "applied" ? "\nLast change: applied"
                : `\nLast change failed: ${result.error ?? "Fluxer did not confirm the nickname change"}`
            yield* respond(`Bot nickname: ${nicknameText(current.nickname)}${last}`)
            return
        }
        const name = verb === "set" ? args.slice(1).join(" ") : undefined
        if (!(verb === "set" && name !== undefined && validNickname(name) || verb === "reset" && args.length === 1)) { yield* respond(nicknameUsage); return }
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) { yield* respond("Only the server owner or members with Manage Server can change the bot nickname"); return }
        const value = verb === "set" ? name! : null
        const saved = yield* store.setNickname(context.message.author.id, value, yield* sourceTimestamp(context.message)).pipe(
            Effect.map(saved => saved.revision), Effect.catchIf((error): error is BackendRequestError => error instanceof BackendRequestError && error.status === 409, () => Effect.succeed(undefined)))
        if (saved === undefined) { yield* respond("The nickname changed on the website while this command ran. Check the current nickname and try again"); return }
        const result = yield* applyNativeNickname(context.client, serverId, value)
        yield* store.recordNickname(saved, value, result).pipe(Effect.catch(() => Effect.logWarning("The nickname result could not be recorded")))
        yield* respond(result.state === "failed" ? `The nickname was not applied. ${result.error}` : value === null ? "Bot nickname reset. The bot's username is shown" : `Bot nickname set to ${value}`)
    })
}
