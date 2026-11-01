import { JAIL_PROBLEM_LIMIT, type JailProblem, type JailSettings } from "@neonflux/contracts/jail"
import { errors, isThreadChannel, Permissions, type Client, type GuildChannel } from "@neontechspace/fluxerly/effect"
import { Clock, Effect, type Scope } from "effect"
import { nativeOutcome } from "./alerts-worker.ts"
import { contained } from "./contained.ts"
import {
    forgetJail,
    anyoneJailed,
    isJailed,
    jailSettingsOf,
    onJailStaffChange,
    rememberJail,
    rememberJailSettings,
} from "./jail-memory.ts"
import { closedToEveryone, denyJailRole, deniesJailRole, openJailChannel } from "./jail-permissions.ts"
import type { JailStore } from "./jail-store.ts"
import { actionContext, performActionGrant } from "./moderation.ts"
import type { ModerationStore } from "./moderation-store.ts"
import type { BotConfig } from "./config.ts"
import { withRoleMember } from "./roles.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

const options = { timeoutMs: 5000, auditReason: "NeonFlux jail" }
/** The channel pass reports after this many writes, and a release pass reads at most this many pages */
const REPORT_EVERY = 25,
    PAGES_PER_PASS = 10,
    LOAD_RETRY_MS = 60000,
    // Longer than any of NeonFlux's own flows takes from creating a channel to reading it back
    NEW_CHANNEL_WAIT_MS = 15000

/** Each running server's jail, so a dashboard change reaches it */
export const jailRuntimes = new Map<string, JailRuntime>()
export type JailRuntime = ReturnType<typeof createJail>

/**
 * Jail for one server. The settings and the jailed members load once when the server starts and stay in memory, so an ordinary join or member
 * update costs no backend call. The worker writes channel overwrites one at a time from a fresh read, and an overwrite with an unknown outcome
 * is listed, never repeated, until a later setup or start reads the channel again
 */
export function createJail(
    store: JailStore,
    moderation: ModerationStore | undefined,
    config: BotConfig,
    notifyMetadata: () => Effect.Effect<void>,
) {
    const serverId = config.serverId
    let loaded = false,
        lastLoadAt = Number.NEGATIVE_INFINITY,
        overwritesDue = false,
        setupRunning = false,
        started: Client | undefined
    let problems: JailProblem[] = []
    let moreProblems = 0,
        total = 0,
        done = 0
    let wakeWorker: Effect.Effect<void> = Effect.void
    let scope: Scope.Scope | undefined
    const waiting = new Set<string>()
    const load = Effect.andThen(
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.sync(() => {
                lastLoadAt = now
            }),
        ),
        Effect.suspend(() => store.memory({ serverId })),
    ).pipe(
        Effect.tap((memory) =>
            Effect.sync(() => {
                rememberJail(serverId, memory.settings, memory.jailedIds, memory.confinedIds)
                setupRunning = memory.setupRunning
                loaded = true
                // A channel created while the bot was down, or a setup it did not finish, is caught here
                overwritesDue = holdsAnyone()
            }),
        ),
    )
    // A backend outage at the start must not leave jailed members free to rejoin, so the next join or member update tries again, at most once a minute
    const ensureLoaded = Effect.gen(function* () {
        if (!loaded && (yield* Clock.currentTimeMillis) - lastLoadAt >= LOAD_RETRY_MS)
            yield* contained(load, "Jail could not be loaded. It tries again on the next member event")
    })
    // A jailed member stays held while jail is off, so channels stay closed to them too. Only a server with jail off and nobody jailed skips this
    const holdsAnyone = () => jailSettingsOf(serverId).enabled || anyoneJailed(serverId)
    const addProblem = (channelId: string, state: JailProblem["state"]) => {
        if (problems.length < JAIL_PROBLEM_LIMIT) problems.push({ channelId, state })
        else moreProblems++
    }
    const overwritePass = (client: Client, settings: JailSettings & { roleId: string; channelId: string }) =>
        Effect.gen(function* () {
            const botId = yield* readAuthenticatedBotId(client)
            const authority = yield* readSafetyAuthority(client, serverId, botId, {
                permission: Permissions.ManageRoles,
            })
            // Overwrites of a role someone deleted would only have to be cleaned up by hand, so nothing is written until !jail setup makes a new one
            if (!authority.roles.some((role) => role.id === settings.roleId)) {
                if (setupRunning)
                    yield* store.report({
                        serverId,
                        setup: { state: "done", total: 0, done: 0, problems: [], moreProblems: 0 },
                    })
                setupRunning = false
                return
            }
            // A thread follows its parent, so it holds no overwrite of its own
            const channels = (yield* client.channels.fetchAll(serverId, { timeoutMs: 10000 })).filter(
                (channel) => !isThreadChannel(channel),
            )
            // Who may read the jail channel, read fresh, since staff roles change without a restart
            const { moderationRoleIds } = yield* store.memory({ serverId })
            problems = []
            moreProblems = 0
            let writes = 0
            done = 0
            total = channels.length
            const report = (state: "running" | "done") =>
                store.report({ serverId, setup: { state, total, done, problems, moreProblems } }).pipe(Effect.asVoid)
            if (setupRunning) yield* report("running")
            for (const channel of channels) {
                const outcome: "succeeded" | "unchanged" | "failed" | "uncertain" =
                    channel.id === settings.channelId
                        ? yield* openJailChannel(
                              client,
                              channel,
                              serverId,
                              settings.roleId,
                              moderationRoleIds,
                              botId,
                              authority.botServerPermissions,
                          )
                        : closedToEveryone(channel, serverId)
                          ? "unchanged"
                          : yield* denyJailRole(client, channel, settings.roleId)
                if (outcome === "failed" || outcome === "uncertain") addProblem(channel.id, outcome)
                else done++
                if (outcome !== "unchanged" && ++writes % REPORT_EVERY === 0) yield* report("running")
            }
            // A start that found every channel as it should be has nothing to report and costs no backend call
            if (setupRunning || writes > 0) yield* report("done")
            setupRunning = false
        })
    const releaseOne = (client: Client, userId: string) =>
        withRoleMember(
            client,
            userId,
            Effect.gen(function* () {
                if (!moderation) return
                const botId = yield* readAuthenticatedBotId(client)
                const authority = yield* readSafetyAuthority(client, serverId, botId, {
                    permission: Permissions.ManageRoles,
                    targetId: userId,
                    allowAbsentTarget: true,
                })
                const decided = yield* store.release({
                    serverId,
                    userId,
                    context: actionContext(authority, "unjail"),
                })
                if (decided.grant) yield* performActionGrant(moderation, serverId, botId, client, decided.grant, config)
            }),
            serverId,
        )
    const releasePass = (client: Client) =>
        Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const { userIds } = yield* store.due({ serverId })
                for (const userId of userIds)
                    yield* contained(releaseOne(client, userId), "A jail that ended could not be released yet")
                if (userIds.length < 10) return
            }
        })
    const pass = Effect.gen(function* () {
        const client = started
        if (!client) return
        yield* ensureLoaded
        const settings = jailSettingsOf(serverId)
        if (overwritesDue && holdsAnyone() && settings.roleId && settings.channelId) {
            overwritesDue = false
            yield* overwritePass(client, { ...settings, roleId: settings.roleId, channelId: settings.channelId })
        }
        yield* releasePass(client)
    })
    const runtime = {
        serverId,
        start: (client: Client) =>
            Effect.gen(function* () {
                started = client
                scope = yield* Effect.scope
                const { wake } = yield* startSignalledWorker(
                    pass,
                    Effect.logWarning("A jail pass stopped. Run !jail setup or wait for the next start to go on"),
                )
                wakeWorker = wake
                jailRuntimes.set(serverId, runtime)
                onJailStaffChange(serverId, runtime.staffChanged())
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (jailRuntimes.get(serverId) === runtime) jailRuntimes.delete(serverId)
                        forgetJail(serverId)
                    }),
                )
                // A server with jail off and nobody jailed goes no further, and only the dispatcher wakes the worker when a jail ends
                yield* Effect.forkScoped(
                    contained(
                        load.pipe(Effect.flatMap(() => (overwritesDue || anyoneJailed(serverId) ? wake : Effect.void))),
                        "Jail could not be loaded. It tries again on the next member event",
                    ),
                )
                return { notify: () => wake }
            }),
        /** After a chat change the bot applied. A setup, role or channel change writes the overwrites again */
        changed: (settings: JailSettings, setup = false) =>
            Effect.gen(function* () {
                rememberJailSettings(serverId, settings)
                overwritesDue = true
                setupRunning ||= setup
                yield* wakeWorker
            }),
        /** The moderation staff changed, so the jail channel's overwrites are due again. It costs nothing while jail holds nobody */
        staffChanged: () =>
            Effect.suspend(() => {
                if (!holdsAnyone()) return Effect.void
                overwritesDue = true
                return wakeWorker
            }),
        /** After a dashboard change or restored item */
        reload: () => contained(load.pipe(Effect.andThen(wakeWorker)), "Jail settings could not be refreshed"),
        /**
         * A new or changed channel the jail role could see gets its denial, from memory, so this costs nothing while jail holds nobody. NeonFlux's
         * own flows, such as a ticket or a restored channel, read back the exact overwrites they just wrote, so the write waits until they are done
         */
        channelSeen: (channel: GuildChannel, client: Client) =>
            Effect.suspend(() => {
                const { roleId, channelId } = jailSettingsOf(serverId)
                if (
                    !scope ||
                    !holdsAnyone() ||
                    !roleId ||
                    channel.id === channelId ||
                    closedToEveryone(channel, serverId) ||
                    deniesJailRole(channel, roleId) ||
                    waiting.has(channel.id)
                )
                    return Effect.void
                waiting.add(channel.id)
                return Effect.sleep(`${NEW_CHANNEL_WAIT_MS} millis`).pipe(
                    Effect.andThen(denyAfterWait(channel.id, client)),
                    (work) => contained(work, "A channel could not be closed to the jail role"),
                    Effect.ensuring(Effect.sync(() => waiting.delete(channel.id))),
                    Effect.forkIn(scope),
                    Effect.asVoid,
                )
            }),
        /**
         * Sets a jailed member who came back to the jail role right away, keeping the stored roles. Answers whether the member is jailed,
         * so the features that give roles skip them
         */
        memberJoined: (userId: string, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (!isJailed(serverId, userId)) return false
                yield* setBack(userId, "rejoin", client)
                return true
            }),
        /** A role someone added to a jailed member goes again in one edit, which never changes the stored roles */
        memberUpdated: (member: { userId: string; roleIds: readonly string[] }, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (!isJailed(serverId, member.userId)) return
                const { roleId } = jailSettingsOf(serverId)
                if (roleId && (member.roleIds.length !== 1 || member.roleIds[0] !== roleId))
                    yield* setBack(member.userId, "stripped", client)
            }),
    }
    /** The channel as it is now, read fresh after the wait. One deleted or closed meanwhile needs nothing */
    const denyAfterWait = (channelId: string, client: Client) =>
        Effect.gen(function* () {
            const { roleId } = jailSettingsOf(serverId)
            if (!roleId || !holdsAnyone()) return
            const channel = yield* client.channels
                .fetch(channelId, { timeoutMs: 5000 })
                .pipe(
                    Effect.catch((error) =>
                        errors.isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error),
                    ),
                )
            if (
                !channel ||
                channel.guildId !== serverId ||
                closedToEveryone(channel, serverId) ||
                deniesJailRole(channel, roleId)
            )
                return
            // A role someone deleted gets no more overwrites, which only a hand could clean up. The read comes only when a write would follow
            const roles = yield* client.roles.fetchAll(serverId, { timeoutMs: 5000 })
            if (!roles.some((role) => role.id === roleId)) return
            const outcome = yield* denyJailRole(client, channel, roleId)
            if (outcome === "failed" || outcome === "uncertain") {
                addProblem(channel.id, outcome)
                total++
                yield* store.report({ serverId, setup: { state: "done", total, done, problems, moreProblems } })
            }
        })
    const setBack = (userId: string, kind: "rejoin" | "stripped", client: Client) =>
        contained(
            Effect.gen(function* () {
                const { roleId } = jailSettingsOf(serverId)
                if (!roleId) return
                const outcome = yield* nativeOutcome(
                    client.members.setRoles({ guildId: serverId, userId }, [roleId], options),
                )
                const held = yield* store.held({
                    serverId,
                    userId,
                    kind,
                    outcome,
                    at: yield* Clock.currentTimeMillis,
                })
                if (held.admitted) yield* notifyMetadata()
            }),
            "A jailed member could not be set back to the jail role",
        )
    return runtime
}
