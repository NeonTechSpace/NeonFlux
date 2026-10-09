import { Clock, Effect, Schema, Struct } from "effect"
import { Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import {
    GeneralGetResult,
    GeneralManageResult,
    GeneralNicknameRecordResult,
    GeneralNicknameSetResult,
    validNickname,
    validPrefix,
    type GeneralGetRequest,
    type GeneralManageRequest,
    type GeneralNickname,
    type GeneralNicknameRequest,
    type GeneralNicknameResultRequest,
} from "@neonflux/contracts/general"
import { BackendRequestError, createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, replyCard } from "./reply-style.ts"

// The prefix reader and the nickname command each decode their own part of the general settings
const settings = GeneralGetResult.mapFields(Struct.pick(["prefix", "revision"])),
    nickname = GeneralGetResult.mapFields(Struct.pick(["nickname"]))
export function createGeneralSettingsStore(backend: BackendConfig, serverId: string) {
    const request = createBackendRequest(backend)
    return {
        get: () =>
            request("/general/get", { serverId } satisfies GeneralGetRequest).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(settings)),
            ),
        set: (actorId: string, change: { prefix: string }, expectedRevision: number) =>
            request("/general/manage", {
                serverId,
                originServerId: serverId,
                actorId,
                managerAuthorized: true,
                ...change,
                expectedRevision,
            } satisfies GeneralManageRequest).pipe(Effect.flatMap(Schema.decodeUnknownEffect(GeneralManageResult))),
        nickname: () =>
            request("/general/get", { serverId } satisfies GeneralGetRequest).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(nickname)),
                Effect.map((value): GeneralNickname => value.nickname),
            ),
        setNickname: (actorId: string, value: string | null, createdAt: number) =>
            request("/general/nickname", {
                serverId,
                originServerId: serverId,
                actorId,
                managerAuthorized: true,
                createdAt,
                nickname: value,
            } satisfies GeneralNicknameRequest).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(GeneralNicknameSetResult)),
            ),
        recordNickname: (nicknameRevision: number, value: string | null, result: NicknameOutcome) =>
            request("/general/nickname-result", {
                serverId,
                originServerId: serverId,
                revision: nicknameRevision,
                nickname: value,
                ...result,
            } satisfies GeneralNicknameResultRequest).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(GeneralNicknameRecordResult)),
            ),
    }
}
export type GeneralSettingsStore = ReturnType<typeof createGeneralSettingsStore>

export type NicknameOutcome = { state: "applied" } | { state: "failed"; error: string }
/** Names the fix the way other refusals do */
export const missingNicknamePermission = "Grant Change own nickname to the NeonFlux role. Fluxer kept the old nickname"
/**
 * Set or clear the bot's own nickname. Without Change own nickname, Fluxer reports success and keeps the old nickname,
 * so only a returned nickname equal to the requested one counts as applied
 */
export function applyNativeNickname(client: Client, serverId: string, value: string | null) {
    return client.members.editSelf(serverId, { nickname: value }).pipe(
        Effect.map((member): NicknameOutcome =>
            member.guildId !== serverId || member.nickname === undefined
                ? { state: "failed", error: "Fluxer did not confirm the nickname change" }
                : member.nickname === value
                  ? { state: "applied" }
                  : { state: "failed", error: missingNicknamePermission },
        ),
        Effect.catch((error): Effect.Effect<NicknameOutcome> =>
            Effect.succeed({
                state: "failed",
                error:
                    error._tag === "GuildOperationError" && error.reason === "rejected" && error.status === 403
                        ? missingNicknamePermission
                        : "Fluxer did not confirm the nickname change",
            }),
        ),
    )
}

// Each managed server's prefix in bot memory. Chat changes apply at once and dashboard changes within the TTL
export const prefixTtlMs = 30000
type General = { readonly prefix: string }
const prefixes = new Map<string, General & { readAt: number }>()
const remember = (serverId: string, { prefix }: General) =>
    Clock.currentTimeMillis.pipe(
        Effect.map((readAt) => {
            prefixes.set(serverId, { prefix, readAt })
        }),
    )

/** The prefix that commands in a reply to this message use. Private DMs keep the fixed ! that also selects a server */
export const replyPrefix = (serverId: string, guildId: string | undefined) =>
    guildId === serverId ? (prefixes.get(serverId)?.prefix ?? "!") : "!"

/** Print bot-authored usage text with a reply's prefix. Lines that send the reader to a DM keep the fixed ! */
export const withPrefix = (text: string, prefix: string) =>
    prefix === "!"
        ? text
        : text
              .split("\n")
              .map((line) => (/\bDM\b/.test(line) ? line : line.replace(/(?<![\w!])!(?=[a-z])/g, () => prefix)))
              .join("\n")

/** Forget a retired server's prefix, so memory holds only servers this process serves */
export const forgetPrefix = (serverId: string) => {
    prefixes.delete(serverId)
}

/** Start one server's prefix memory for a new bot run and return its prefix reader */
export function createPrefixReader(store: GeneralSettingsStore | undefined, serverId: string) {
    prefixes.delete(serverId)
    return Effect.gen(function* () {
        if (!store) return "!"
        const cached = prefixes.get(serverId)
        if (cached && (yield* Clock.currentTimeMillis) - cached.readAt < prefixTtlMs) return cached.prefix
        // A failed refresh keeps the last known prefix, or ! without one, for another TTL
        const value = yield* store
            .get()
            .pipe(
                Effect.catch(() =>
                    Effect.logWarning(
                        "The configured prefix could not be read. Commands use the last known prefix or !",
                    ).pipe(Effect.as<General>(cached ?? { prefix: "!" })),
                ),
            )
        yield* remember(serverId, value)
        return value.prefix
    })
}

export function handlePrefixCommand(
    store: GeneralSettingsStore | undefined,
    serverId: string,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    const respond = (content: string) => context.reply({ content })
    return Effect.gen(function* () {
        if (!store) {
            yield* respond(notSetUp("The prefix setting"))
            return
        }
        if (context.message.guildId !== serverId) return
        const current = yield* store.get()
        yield* remember(serverId, current)
        if (!args.length) {
            yield* respond(`Current prefix: ${current.prefix}`)
            return
        }
        if (args.length !== 1 || !validPrefix(args[0])) {
            yield* respond(`Use ${code(`${current.prefix}prefix <one to five punctuation characters>`)}`)
            return
        }
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) {
            yield* respond("Only the server owner or members with Manage community can change the prefix")
            return
        }
        const saved = yield* store.set(context.message.author.id, { prefix: args[0]! }, current.revision)
        if (saved.saved) yield* remember(serverId, { ...current, prefix: args[0]! })
        yield* respond(
            saved.saved
                ? `Prefix changed to ${args[0]}`
                : "The prefix changed while this command ran. Check the current prefix and try again",
        )
    })
}

/** Server settings follow one rule: the server owner, Administrator or Manage community, read fresh from Fluxer. The owner holds every permission */
export function readServerManagerAuthority(client: Client, serverId: string, userId: string) {
    return client.permissions.fetch({ guildId: serverId, userId }, { timeoutMs: 5000 }).pipe(
        Effect.map((bits) => (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n),
        Effect.catch(() => Effect.succeed(false)),
    )
}

const nicknameUsage = (prefix: string) =>
    `Use ${code(`${prefix}nickname`)} to show the bot's nickname, ${code(`${prefix}nickname set <name>`)} with 1 to 32 characters, or ${code(`${prefix}nickname reset`)} to show the bot's username`

/** Set, reset or show the bot's nickname in this server. Changes apply at once and the result is recorded for the website */
export function handleNicknameCommand(
    store: GeneralSettingsStore | undefined,
    serverId: string,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    const respond = (content: string) => context.reply({ content })
    return Effect.gen(function* () {
        if (!store) {
            yield* respond(notSetUp("The nickname setting"))
            return
        }
        if (context.message.guildId !== serverId) return
        const verb = args[0]?.toLowerCase()
        if (!args.length) {
            const current = yield* store.nickname(),
                result = current.result
            yield* replyCard(context, {
                title: "Bot nickname",
                fields: [
                    ["Nickname", current.nickname ?? "None, so the bot's username shows"],
                    ...(result
                        ? [
                              [
                                  "Last change",
                                  result.state === "pending"
                                      ? "Not confirmed yet"
                                      : result.state === "applied"
                                        ? "Applied"
                                        : `Failed. ${result.error ?? "Fluxer did not confirm the nickname change"}`,
                              ] as const,
                          ]
                        : []),
                ],
            })
            return
        }
        const name = verb === "set" ? args.slice(1).join(" ") : undefined
        if (!(
            (verb === "set" && name !== undefined && validNickname(name)) ||
            (verb === "reset" && args.length === 1)
        )) {
            yield* respond(nicknameUsage(replyPrefix(serverId, context.message.guildId)))
            return
        }
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) {
            yield* respond("Only the server owner or members with Manage community can change the bot nickname")
            return
        }
        const value = verb === "set" ? name! : null
        const saved = yield* store
            .setNickname(context.message.author.id, value, yield* sourceTimestamp(context.message))
            .pipe(
                Effect.map((saved) => saved.revision),
                Effect.catchIf(
                    (error): error is BackendRequestError =>
                        error instanceof BackendRequestError && error.status === 409,
                    () => Effect.succeed(undefined),
                ),
            )
        if (saved === undefined) {
            yield* respond(
                "The nickname changed on the website while this command ran. Check the current nickname and try again",
            )
            return
        }
        const result = yield* applyNativeNickname(context.client, serverId, value)
        yield* store
            .recordNickname(saved, value, result)
            .pipe(Effect.catch(() => Effect.logWarning("The nickname result could not be recorded")))
        yield* respond(
            result.state === "failed"
                ? `The nickname was not applied. ${result.error}`
                : value === null
                  ? "Bot nickname reset. The bot's username is shown"
                  : `Bot nickname set to ${value}`,
        )
    })
}
