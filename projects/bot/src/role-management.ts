import type {
    RolesClaim,
    RolesEvaluateOperation,
    RolesEvaluateResult,
    RolesManageOperation,
    RolesManageResult,
    RolesPanel,
    RolesQueryRequest,
    RolesQueryResult,
    RolesReactionJob,
    RolesSource,
    RolesWithdrawal,
} from "@neonflux/contracts/roles"
import { ROLES_PANEL_MAPPINGS } from "@neonflux/contracts/roles"
import { format, type BotEventContext, type Client, type SendError } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { readNativeMember } from "./member-evidence.ts"
import { roleHelp, type RoleCommand, type RoleCommandName } from "./role-command.ts"
import { readRoleAuthority, RolePermissionError, rolePermissionFix } from "./role-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import {
    backgroundRoleWork,
    evaluateRoleRequest,
    roleMemberContext,
    roleSnapshots,
    roleEventSource,
    RoleHandlingError,
    panelMessageGone,
    syncPanelReactions,
    withRoleMember,
} from "./roles.ts"
import { RolesStoreError, rolesErrorMessage, type RolesStore } from "./roles-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { readPublishingAuthority } from "./publishing-permissions.ts"
import { equalPublishingContent } from "@neonflux/contracts/publishing-base"
import type { PublishingStore } from "./publishing-store.ts"
import type { startRoleReactionWorker } from "./role-reconciliation.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { sentenceList } from "./permission-fix.ts"
import { warnFailure } from "./contained.ts"

// Printed with the server's prefix when the verification panel cannot be created because another panel has its name
const rulesNameTaken =
    "A role panel named rules already exists, so NeonFlux cannot create the verification panel. " +
    "Delete it with !roles delete rules, or create the verification panel on the dashboard under another name, " +
    "then send !verify configure again"
const roles = (ids: readonly string[]) => ids.map(format.roleMention).join(", ")
// The feature a member's role claims come from, by their consumer key prefix
const what = (consumerPrefix: string) =>
    consumerPrefix === "autorole:" ? "autorole" : `panel ${consumerPrefix.split(":")[1]}`
const kind = (panel: RolesPanel) => (panel.kind === "verification" ? "Rules verification" : "Reaction roles")
const panelCard = (panel: RolesPanel, prefix: string): Card => ({
    title: `Role panel ${panel.name}`,
    fields: [
        ["Type", kind(panel)],
        ["Status", onOff(panel.enabled)],
        ["Mode", panel.exclusive ? "Exclusive, one role at a time" : "Toggle, any number of roles"],
        ...(panel.withdrawing ? [["Retiring", "Removing the roles it gave"] as const] : []),
        [
            "Roles",
            panel.mappings
                .map(
                    (m) =>
                        `${m.emoji} ${format.roleMention(m.roleId)}${m.prerequisiteRoleIds.length ? `, requires ${roles(m.prerequisiteRoleIds)}` : ""}${m.exclusionRoleIds.length ? `, excludes ${roles(m.exclusionRoleIds)}` : ""}`,
                )
                .join("\n") ||
                `None yet. Add one with ${code(panel.kind === "verification" ? `${prefix}verify configure @role <emoji>` : `${prefix}roles map ${panel.name} <emoji> @role`)}`,
        ],
        [
            "Posted",
            !panel.published
                ? "Not posted yet"
                : `In ${format.channelMention(panel.published.channelId)}, post #${panel.published.postNo}${panel.published.revision === panel.revision ? "" : ". Changed since then, so publish it again to apply the change"}`,
        ],
        ...(panel.published?.pendingClear?.length
            ? [["Reactions to update", panel.published.pendingClear.join(" ")] as const]
            : []),
    ],
})
/** The one change a panel command made, with its new value. A change that waits for a new panel message says so */
function panelChange(command: RoleCommand, panel: RolesPanel) {
    const name = `Role panel ${panel.name}`,
        mapped = (emoji: string) => `${emoji} on role panel ${panel.name}`
    const line =
        command.type === "mode"
            ? `${name} is now ${panel.exclusive ? "exclusive, one role at a time" : "toggle, any number of roles"}`
            : command.type === "enable" || command.type === "disable"
              ? `${name} is ${onOff(panel.enabled).toLowerCase()}`
              : command.type === "mapping"
                ? `${mapped(command.emoji)} now gives ${format.roleMention(command.roleId)}`
                : command.type === "unmap"
                  ? `${mapped(command.emoji)} no longer gives a role`
                  : command.type === "scope"
                    ? !command.roleIds.length
                        ? `${mapped(command.emoji)} has no ${command.field === "prerequisites" ? "required" : "excluded"} roles now`
                        : `${mapped(command.emoji)} now ${command.field === "prerequisites" ? "requires" : "excludes members with"} ${roles(command.roleIds)}`
                    : command.type === "configure"
                      ? `Accepting the rules with ${command.emoji} now gives ${format.roleMention(command.roleId)}`
                      : command.type === "publish" && panel.published
                        ? `${name} posted in ${format.channelMention(panel.published.channelId)}`
                        : `${name} saved`
    return panel.published && panel.published.revision !== panel.revision
        ? `${line}. Publish it again to apply the change`
        : line
}
/** Up to five names and how many more, joined for a sentence */
const someNames = (names: readonly string[]) =>
    sentenceList(names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names)
/** Reaction checks in one sentence, such as 4 reaction checks: 3 running, 1 stopped (panel colors). Only a stopped check needs staff */
function jobsCard(jobs: readonly RolesReactionJob[], prefix: string): Card {
    const of = (status: RolesReactionJob["status"]) => jobs.filter((job) => job.status === status),
        stopped = of("blocked").map((job) => job.name)
    const counts = [
            [of("running").length, "running"],
            [of("queued").length, "waiting"],
            [stopped.length, "stopped"],
        ] as const,
        total = counts.reduce((sum, [count]) => sum + count, 0)
    const parts = counts
        .filter(([count]) => count)
        .map(
            ([count, state]) =>
                `${count} ${state}${state === "stopped" ? ` (${stopped.length > 1 ? "panels" : "panel"} ${someNames(stopped)})` : ""}`,
        )
    return {
        title: "Reaction checks",
        description: total
            ? `${total} reaction check${total === 1 ? "" : "s"}: ${parts.join(", ")}`
            : "No reaction checks are running",
        ...(stopped.length
            ? { note: `Send ${code(`${prefix}roles resume <panel>`)} to check a stopped panel again` }
            : {}),
    }
}
const claimStates: Record<RolesClaim["status"], string> = {
    idle: "Settled",
    pending: "In progress",
    uncertain: "Not confirmed yet",
}
/** A role request's result in words. Delivery decides when a role change was attempted */
function requestText(result: RolesEvaluateResult, outcome?: { outcome: string; acknowledged: boolean }) {
    if (outcome)
        return outcome.outcome === "succeeded"
            ? outcome.acknowledged
                ? "Your roles are updated"
                : "Your roles changed, but NeonFlux could not record it yet"
            : outcome.outcome === "failed"
              ? "Your roles could not be changed"
              : outcome.outcome === "uncertain"
                ? "Your role change is not confirmed yet. Check your roles before you try again"
                : "Your role change is still in progress"
    return result.status === "blocked"
        ? "You can't get that role right now"
        : result.status === "ambiguous"
          ? "That request could not be settled. Try again"
          : result.status === "acknowledged"
            ? "Rules accepted"
            : result.status === "unchanged"
              ? "Nothing to change"
              : "Your role change is still in progress"
}
const configuration = (consumerKey: string) =>
    consumerKey.startsWith("autorole:") ? "Autorole" : `Panel ${consumerKey.split(":")[1]}`

export function processRoleWithdrawal(
    store: RolesStore,
    serverId: string,
    client: Client,
    actorId: string,
    source: RolesSource,
    withdrawal: RolesWithdrawal,
    manage: (
        operation: Extract<RolesManageOperation, { type: "withdraw-departed" | "withdraw-next" }>,
    ) => Effect.Effect<RolesManageResult, unknown>,
    query: (cursor?: string) => Effect.Effect<RolesQueryResult, unknown>,
) {
    const withdrawTarget = (target: RolesWithdrawal["targets"][number]) =>
        Effect.gen(function* () {
            const evidence = yield* readNativeMember(client, serverId, target.userId),
                native = evidence.member
            if (!native || native.joinedAt !== target.joinedAt) {
                const retired = yield* manage({
                    type: "withdraw-departed",
                    withdrawalId: withdrawal.withdrawalId,
                    userId: target.userId,
                    joinedAt: target.joinedAt,
                    originServerId: evidence.originServerId,
                    memberUserId: evidence.userId,
                    currentJoinedAt: native?.joinedAt ?? null,
                    observedAt: yield* Clock.currentTimeMillis,
                })
                return retired.duplicate || retired.type !== "withdrawal" || retired.withdrawal.status !== "blocked"
            }
            const applied = yield* evaluateRoleRequest(
                store,
                serverId,
                client,
                {
                    ...source,
                    sourceId: roleEventSource(
                        "withdraw",
                        source.sourceId,
                        withdrawal.withdrawalId,
                        target.userId,
                        target.joinedAt,
                        target.roleId,
                    ),
                },
                target.userId,
                { type: "withdraw", withdrawalId: withdrawal.withdrawalId, roleId: target.roleId },
                actorId,
                native.isBot,
                target.joinedAt,
            ).pipe((effect) => withRoleMember(client, target.userId, effect, serverId))
            return (
                applied.result.status !== "blocked" &&
                (!applied.outcome || (applied.outcome.outcome === "succeeded" && applied.outcome.acknowledged))
            )
        })
    return Effect.gen(function* () {
        let current = withdrawal,
            conflicts = 0,
            cursor: string | undefined
        const skipped = new Set<string>()
        // One bounded run pages through the withdrawal itself and moves past targets that cannot be confirmed
        for (let round = 0; round < 50 && current.status !== "complete"; round++) {
            const targets = current.targets.filter(
                (target) => !skipped.has(`${target.userId}:${target.joinedAt}:${target.roleId}`),
            )
            for (const target of targets) {
                const done = yield* withdrawTarget(target).pipe(
                    Effect.match({ onFailure: () => false, onSuccess: (value) => value }),
                )
                if (!done) {
                    conflicts++
                    skipped.add(`${target.userId}:${target.joinedAt}:${target.roleId}`)
                }
            }
            if (targets.length) {
                const found = yield* query(cursor)
                if (found.type === "withdrawal") current = found.withdrawal
                continue
            }
            // Skipped targets stay for later recovery while the next page is inspected
            if (current.targets.length) {
                if (!current.nextCursor) break
                cursor = current.nextCursor
                const found = yield* query(cursor)
                if (found.type === "withdrawal") current = found.withdrawal
                continue
            }
            // Acknowledgment and configuration cleanup continue once no target remains on the first page
            if (cursor !== undefined || current.status !== "pending") break
            const settled = yield* manage({
                type: "withdraw-next",
                withdrawalId: current.withdrawalId,
                expectedStep: current.step,
            })
            if (settled.duplicate || settled.type !== "withdrawal") break
            current = settled.withdrawal
        }
        return { withdrawal: current, conflicts }
    })
}

export function handleRoleCommand(
    store: RolesStore,
    publishing: PublishingStore | undefined,
    config: BotConfig,
    name: RoleCommandName,
    command: RoleCommand | { error: string },
    context: BotEventContext<"messageCreate">,
    worker?: Effect.Success<ReturnType<typeof startRoleReactionWorker>>,
    // The membership the author sent !roles choose or !verify from, which the request is bound to however long it waits
    joinedAt?: string,
    // Set when the command already runs as the server's background role work
    background = false,
): Effect.Effect<void | undefined, SendError> {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content),
        card = (value: Card) => replyCard(context, config.serverId, value)
    // !roles choose, !verify and a staff reconcile run in their member's line with memberRoleWork, and a withdrawal, retirement and
    // deletion take each member's lock in their background work, so their answers never hold the event handlers
    return Effect.gen(function* () {
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(withPrefix(roleHelp(name), prefix))
            return
        }
        const { client, message } = context
        const source = { sourceId: message.id, createdAt: yield* sourceTimestamp(message) }
        const selfService =
            command.type === "verify" || command.type === "choose" || (name === "verify" && command.type === "status")
        const authority = yield* readSafetyAuthority(client, config.serverId, message.author.id)
        const actor = moderationActor(authority)
        if (!selfService && !authority.isOwner && !authority.isAdmin) {
            yield* reply("Only the server owner or an administrator can manage role configuration and staff recovery")
            return
        }
        const query = (operation: RolesQueryRequest["operation"], currentActor = actor) =>
            store.query({ serverId: config.serverId, actor: currentActor, operation })
        const manage = (operation: RolesManageOperation, currentActor = actor) =>
            store.manage({
                serverId: config.serverId,
                actor: currentActor,
                messageId: source.sourceId,
                createdAt: source.createdAt,
                operation,
            })
        const memberPanels = Effect.gen(function* () {
            const fresh = yield* roleMemberContext(client, config.serverId, actor.userId)
            return (yield* store.memberQuery({ serverId: config.serverId, context: fresh.context })).panels
        })
        // The server's one verification panel is found by its kind, so chat verification works whatever the panel is
        // named
        const verificationPanel = Effect.gen(function* () {
            const panel = (yield* memberPanels).find((p) => p.kind === "verification")
            if (!panel) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            return panel
        })
        const findPanel = (panelName: string) =>
            Effect.gen(function* () {
                if (selfService) {
                    const panel = (yield* memberPanels).find((p) => p.name === panelName)
                    if (!panel) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
                    return panel
                }
                const value = yield* query({ type: "panel-show", name: panelName })
                if (value.type !== "panel") return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
                return value.panel
            })
        // A posted reaction panel changes under its posted message, except a switch to one choice, which members holding
        // several of its roles would conflict with
        const inPlace = (panel: RolesPanel, patch: Extract<RolesManageOperation, { type: "panel-update" }>["patch"]) =>
            panel.kind === "reaction" &&
            panel.published?.revision === panel.revision &&
            !(patch.exclusive === true && !panel.exclusive)
        // Clears the reactions whose meaning changed and reports them with a reaction check. Answers the sentence for a sync
        // that failed
        const syncReactions = (panel: RolesPanel, check = false) =>
            Effect.gen(function* () {
                const published = panel.published
                if (!published) return undefined
                const cleared = yield* syncPanelReactions(client, panel)
                if (!cleared.length && !check) return undefined
                const generation = published.clearGeneration
                yield* worker
                    ? worker.enqueue(published.messageId, cleared, generation)
                    : store.reactionJobs({
                          serverId: config.serverId,
                          operation: {
                              type: "enqueue",
                              messageId: published.messageId,
                              clearedEmojis: cleared,
                              ...(generation !== undefined ? { clearGeneration: generation } : {}),
                          },
                      })
                return undefined
            }).pipe(
                Effect.catch((error) =>
                    Effect.succeed(
                        panelMessageGone(error)
                            ? `The posted message of panel ${panel.name} is gone. Post it again with ${code(`${prefix}roles publish ${panel.name} #channel <draft-name>`)}`
                            : `Panel ${panel.name} changed, but its reactions are not updated yet. Run ${code(`${prefix}roles reactions ${panel.name}`)}`,
                    ),
                ),
            )
        const changed = (panel: RolesPanel, patch: Extract<RolesManageOperation, { type: "panel-update" }>["patch"]) =>
            Effect.gen(function* () {
                const ids = patch.mappings?.map((m) => m.roleId) ?? []
                const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, {
                    configuration: true,
                    roleIds: ids,
                })
                return yield* manage(
                    {
                        type: "panel-update",
                        name: panel.name,
                        expectedRevision: panel.revision,
                        patch,
                        roles: roleSnapshots(fresh),
                        ...(inPlace(panel, patch) ? { inPlace: true as const } : {}),
                    },
                    moderationActor(fresh),
                )
            })
        const processWithdrawal = (withdrawal: RolesWithdrawal) =>
            processRoleWithdrawal(
                store,
                config.serverId,
                client,
                actor.userId,
                source,
                withdrawal,
                (operation) => manage(operation),
                (cursor) =>
                    query({
                        type: "withdrawal-show",
                        withdrawalId: withdrawal.withdrawalId,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
            )
        // A fresh panel message and autorole edits leave the grants of earlier revisions behind, so retiring or deleting a panel or
        // autorole withdraws every revision that still has configuration, earlier ones first, and stops at the first
        // not done. Running it again continues where it stopped, since a finished revision only runs again as a no-op
        const withdrawRevisions = (
            current: number,
            operation: (revision: number, last: boolean) => RolesManageOperation,
            panelName?: string,
        ) =>
            Effect.gen(function* () {
                const earlier = new Set<number>()
                let cursor: string | undefined
                do {
                    const found = yield* query({
                        type: "configuration-list",
                        ...(panelName === undefined ? {} : { name: panelName }),
                        ...(cursor === undefined ? {} : { cursor }),
                    })
                    if (found.type !== "configurations") break
                    for (const reference of found.references)
                        earlier.add(Number(reference.consumerKey.split(":").at(-1)))
                    cursor = found.nextCursor
                } while (cursor !== undefined)
                earlier.delete(current)
                for (const revision of [...earlier].sort((a, b) => a - b)) {
                    const older = yield* manage(operation(revision, false))
                    if (older.duplicate || older.type !== "withdrawal") return undefined
                    const settled = yield* processWithdrawal(older.withdrawal)
                    if (settled.withdrawal.status !== "complete") return settled
                }
                const last = yield* manage(operation(current, true))
                return last.duplicate || last.type !== "withdrawal"
                    ? undefined
                    : yield* processWithdrawal(last.withdrawal)
            })
        const withdrawPanel = (panel: RolesPanel, deletePanel?: true) =>
            withdrawRevisions(
                panel.published?.revision ?? panel.revision,
                (revision, last) => ({
                    type: "withdraw",
                    name: panel.name,
                    revision,
                    ...(last && deletePanel ? { deletePanel } : {}),
                }),
                panel.name,
            )
        const withdrawAutorole = Effect.gen(function* () {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            return yield* withdrawRevisions(found.settings.revision, (revision) => ({
                type: "autorole-withdraw",
                revision,
            }))
        })
        // Each operation of a chat command is its own source, so a redelivered message applies nothing twice
        const evaluateCommand = (userId: string, operation: RolesEvaluateOperation, index: number) =>
            evaluateRoleRequest(
                store,
                config.serverId,
                client,
                { ...source, sourceId: `command_${message.id}_${index}` },
                userId,
                operation,
                actor.userId,
                false,
                joinedAt,
                undefined,
                undefined,
                true,
            )
        const managed = (count: number) => `${count} role${count === 1 ? "" : "s"} NeonFlux manages`
        // Takes back every role the feature gave the member, walking all of the member's claims. It runs as the server's background role
        // work, so the command answers at once and never holds the messages after it, and its result follows as another reply. It reads the
        // staff member's authority and, under the member's lock, the member again, and stops when the member left or rejoined since the
        // command. Fluxer removes 20 roles per server every 10 seconds, so a removal its limit holds back waits for it. Each removal is its
        // own source, a retried one too, so a redelivered message applies nothing twice, and counts from when it runs, since the work may
        // wait behind other role work
        const withdrawMember = (userId: string, joinedAt: string, consumerPrefix: string, start: string) =>
            Effect.gen(function* () {
                const member = format.userMention(userId),
                    check = code(start.replace(" withdraw", " reconcile"))
                const feature = what(consumerPrefix),
                    plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
                const removed = new Set<string>()
                let released = 0
                const progress = () =>
                    `Removed ${plural(removed.size, "role")} and released ${plural(released, `${feature} claim`)} so far`
                // The roles left on the member after a complete withdrawal were already gone, stay for another feature, or were not
                // confirmed as given by NeonFlux, which never removes those
                const summary = (
                    operations: readonly { roleId: string }[],
                    claims: ReadonlyMap<string, RolesClaim>,
                    roleIds: ReadonlySet<string>,
                ) => {
                    const left = [...new Set(operations.map((operation) => operation.roleId))].filter(
                        (roleId) => !removed.has(roleId),
                    )
                    const gone = left.filter((roleId) => !roleIds.has(roleId)).length,
                        held = left.filter((roleId) => roleIds.has(roleId)),
                        shared = held.filter((roleId) =>
                            claims.get(roleId)?.consumerKeys.some((key) => !key.startsWith(consumerPrefix)),
                        ).length
                    return [
                        `Removed ${plural(removed.size, "role")}`,
                        ...(gone ? [`${gone} already gone`] : []),
                        ...(shared ? [`${shared} kept for another feature`] : []),
                        ...(held.length > shared
                            ? [`${held.length - shared} kept, since NeonFlux did not confirm it gave them`]
                            : []),
                    ].join(", ")
                }
                const work = Effect.gen(function* () {
                    const authority = yield* readSafetyAuthority(client, config.serverId, message.author.id)
                    if (!authority.isOwner && !authority.isAdmin) {
                        yield* reply(
                            `Stopped removing roles from ${member}, since only the server owner or an administrator can`,
                        )
                        return
                    }
                    const current = yield* withRoleMember(
                        client,
                        userId,
                        Effect.gen(function* () {
                            const now = yield* roleMemberContext(
                                client,
                                config.serverId,
                                userId,
                                authority.actor.userId,
                            )
                            if (now.context.joinedAt !== joinedAt) return undefined
                            const operations: Extract<RolesEvaluateOperation, { type: "withdraw-member" }>[] = []
                            const claims = new Map<string, RolesClaim>()
                            let cursor: string | undefined
                            do {
                                const page = yield* query(
                                    { type: "claim-list", userId, joinedAt, ...(cursor ? { cursor } : {}) },
                                    moderationActor(now.authority),
                                )
                                if (page.type !== "claims")
                                    return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
                                for (const claim of page.claims) {
                                    claims.set(claim.roleId, claim)
                                    for (const consumerKey of claim.consumerKeys)
                                        if (consumerKey.startsWith(consumerPrefix))
                                            operations.push({
                                                type: "withdraw-member",
                                                consumerKey,
                                                roleId: claim.roleId,
                                            })
                                }
                                cursor = page.nextCursor
                            } while (cursor !== undefined)
                            return { now, operations, claims }
                        }),
                        config.serverId,
                    )
                    if (!current) {
                        yield* reply(`${member} left or rejoined, so no role was removed`)
                        return
                    }
                    const { operations, claims } = current
                    const roleIds = new Set(current.now.context.roleIds)
                    let latest: typeof current.now | undefined = current.now,
                        waited = false,
                        rounds = 0,
                        attempt = 0
                    for (let index = 0; index < operations.length;) {
                        const operation = operations[index]!
                        const applied: Effect.Success<ReturnType<typeof evaluateRoleRequest>> =
                            yield* evaluateRoleRequest(
                                store,
                                config.serverId,
                                client,
                                {
                                    sourceId: `command_${message.id}_${attempt++}`,
                                    createdAt: yield* Clock.currentTimeMillis,
                                },
                                userId,
                                operation,
                                authority.actor.userId,
                                false,
                                joinedAt,
                                undefined,
                                latest,
                            ).pipe((effect) => withRoleMember(client, userId, effect, config.serverId))
                        const outcome: (typeof applied)["outcome"] = applied.outcome
                        // A removal's fresh read with its change is the next one's member, and an evaluation that changed nothing keeps it
                        if (outcome) latest = outcome.observed
                        if (applied.result.status === "blocked") {
                            yield* reply(
                                `Stopped at ${format.roleMention(operation.roleId)}, whose last change for ${member} is not confirmed yet. Check it with ${check}, then withdraw again. ${progress()}`,
                            )
                            return
                        }
                        // Fluxer's role limit refused the removal before it was sent, so it goes again once the limit allows, under a new source
                        if (
                            outcome?.outcome === "failed" &&
                            outcome.retryAfterMs !== undefined &&
                            outcome.acknowledged
                        ) {
                            if (++rounds > operations.length) break
                            if (!waited)
                                yield* reply(
                                    `${progress()}. Fluxer's role limit holds back the rest of ${member}'s roles, which follow once it allows`,
                                )
                            waited = true
                            yield* Effect.sleep(`${outcome.retryAfterMs} millis`)
                            continue
                        }
                        if (outcome && (outcome.outcome !== "succeeded" || !outcome.acknowledged)) {
                            yield* reply(
                                `Removing ${format.roleMention(operation.roleId)} from ${member} ${outcome.outcome === "failed" ? "failed" : outcome.outcome === "succeeded" ? "worked, but NeonFlux could not record it yet" : "is not confirmed yet"}. Check it with ${check}. ${progress()}`,
                            )
                            return
                        }
                        released++
                        if (outcome) {
                            removed.add(operation.roleId)
                            roleIds.delete(operation.roleId)
                        }
                        index++
                    }
                    if (released < operations.length) {
                        yield* reply(
                            `Removing roles from ${member} stopped. ${progress()}. Continue with ${code(start)}`,
                        )
                        return
                    }
                    yield* card({
                        title: "Role removal",
                        description: summary(operations, claims, roleIds),
                        fields: [
                            ["Member", member],
                            ["Released", plural(released, `${feature} claim`)],
                        ],
                        footer: "NeonFlux removes a role only when it confirmed that it gave it",
                    })
                }).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : reply(
                                  `Removing roles from ${member} stopped. ${progress()}. Check it with ${check}`,
                              ).pipe(Effect.ignore),
                    ),
                )
                yield* backgroundRoleWork(client, config.serverId, work)
                yield* reply(`Removing the roles ${feature} gave ${member}. NeonFlux replies here when it is done`)
            })
        if (command.type === "jobs" || command.type === "resume") {
            const current = yield* store.reactionJobs({ serverId: config.serverId, operation: { type: "list" } })
            if (current.type !== "jobs") return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            if (command.type === "resume") {
                const job = current.jobs.find((j) => j.name === command.name)
                if (!job || !worker) {
                    yield* reply(
                        `Panel ${command.name} has no reaction check to resume. Start one with ${code(`${prefix}roles reactions ${command.name}`)}`,
                    )
                    return
                }
                yield* worker.notify(job)
                yield* reply(`Checking the reactions on panel ${job.name} again`)
            } else yield* card(jobsCard(current.jobs, prefix))
            return
        }
        if (command.type === "reactions") {
            const panel = yield* findPanel(command.name)
            if (!panel.published) {
                yield* reply(`Panel ${panel.name} is not posted yet, so it has no reactions to check`)
                return
            }
            if (!worker) {
                yield* reply("Reaction checks are not running right now")
                return
            }
            // Reactions whose meaning changed are cleared first, so the check counts them again
            const failed = yield* syncReactions(panel, true)
            yield* reply(
                failed ?? `Checking the reactions on panel ${panel.name}. Members get or lose its roles to match`,
            )
            return
        }
        let result: RolesManageResult | undefined,
            withdrawn: Effect.Success<ReturnType<typeof processWithdrawal>> | undefined,
            // Further lines of a panel change, such as what members do after a remapped emoji
            notes: string[] = []
        if (name === "verify" && command.type === "status") {
            const fresh = yield* roleMemberContext(client, config.serverId, actor.userId)
            const current = yield* store.memberQuery({ serverId: config.serverId, context: fresh.context }),
                yes = (value: boolean) => (value ? "Yes" : "No")
            yield* card({
                title: "Your verification",
                fields: [
                    ["Rules accepted", yes(current.acknowledgment.acknowledged)],
                    ["Access role", current.acknowledgment.accessRolePresent ? "You have it" : "You don't have it"],
                    ["Access confirmed", yes(current.acknowledgment.accessConfirmed)],
                ],
            })
            return
        }
        if (command.type === "reservations") {
            const start = `${prefix}autorole reservations`,
                key = pageKey(config.serverId, message, name, "reservations"),
                next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return
            // Reservations removed since the last page can shorten the list, so next shows its last page at most
            const rows = found.settings.reservations ?? [],
                pages = Math.max(1, Math.ceil(rows.length / 10)),
                page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            yield* card({
                title: "Role reservations",
                description: rows.length
                    ? [
                          `${rows.length} member${rows.length === 1 ? " gets" : "s get"} roles on joining`,
                          ...rows
                              .slice((page - 1) * 10, page * 10)
                              .map((row) => `${format.userMention(row.userId)}: ${roles(row.roleIds)}`),
                      ].join("\n")
                    : "No role reservations yet",
                fields: page < pages ? [["Next", code(`${start} next`)]] : [],
                footer: "Reserved roles are given when the user joins, while autorole is on and its humans-only setting allows them",
            })
            return
        }
        if (command.type === "status" || (command.type === "list" && name === "autorole")) {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return
            const s = found.settings
            yield* card(
                name === "autorole"
                    ? {
                          title: "Autorole",
                          fields: [
                              ["Status", onOff(s.autoroleEnabled)],
                              [
                                  "Roles",
                                  roles(s.autoroleIds) ||
                                      `None yet. Add one with ${code(`${prefix}autorole add @role`)}`,
                              ],
                              ["Given to", s.humansOnly ? "Humans only" : "Humans and bots"],
                              ...((s.reservations ?? []).length
                                  ? [
                                        [
                                            "Reservations",
                                            `${s.reservations!.length}. See ${code(`${prefix}autorole reservations`)}`,
                                        ] as const,
                                    ]
                                  : []),
                          ],
                      }
                    : // The rules panel is a role panel too, and !verify status shows a member's own verification
                      {
                          title: "Role panels",
                          fields: [
                              ["Reaction roles", onOff(s.panelsEnabled)],
                              ["Rules verification", onOff(s.verificationEnabled)],
                              ["Panels", code(`${prefix}roles list`)],
                          ],
                      },
            )
            return
        }
        if (command.type === "list") {
            const key = pageKey(config.serverId, message, name, "list"),
                page = command.next ? nextPosition<number>(key) : 1
            if (page === undefined) {
                yield* reply(noNextPage(`${prefix}${name} list`))
                return
            }
            const found = yield* query({ type: "panel-list", page })
            if (found.type !== "panels") return
            rememberPosition(key, found.page < found.totalPages ? found.page + 1 : undefined)
            yield* card({
                title: "Role panels",
                description:
                    found.panels
                        .map(
                            (p) =>
                                `**${p.name}** ${kind(p)}, ${onOff(p.enabled).toLowerCase()}${p.published ? "" : ", not posted yet"}`,
                        )
                        .join("\n") || "No role panels yet",
                fields: found.page < found.totalPages ? [["Next", code(`${prefix}${name} list next`)]] : [],
            })
            return
        }
        if (command.type === "show") {
            yield* card(panelCard(yield* findPanel(command.name), prefix))
            return
        }
        if (command.type === "history") {
            const start = `${prefix}${name} history${command.name ? ` ${command.name}` : ""}`
            const key = pageKey(config.serverId, message, name, "history", command.name),
                cursor = command.next ? nextPosition<string>(key) : undefined
            if (command.next && cursor === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const found = yield* query({
                type: "configuration-list",
                ...(command.name ? { name: command.name } : {}),
                ...(cursor ? { cursor } : {}),
            })
            if (found.type !== "configurations") return
            rememberPosition(key, found.nextCursor)
            yield* card({
                title: "Role history",
                description:
                    found.references
                        .map(
                            (r) =>
                                `${configuration(r.consumerKey)}: ${format.roleMention(r.roleId)}${r.postNo ? `, post #${r.postNo}` : ""}`,
                        )
                        .join("\n") || "No role history yet",
                fields: found.nextCursor ? [["Next", code(`${start} next`)]] : [],
            })
            return
        }
        if (command.type === "module") {
            const fresh =
                name === "autorole" && command.enabled
                    ? yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true })
                    : undefined
            result = yield* manage(
                {
                    type: "settings",
                    patch: {
                        [name === "roles"
                            ? "panelsEnabled"
                            : name === "verify"
                              ? "verificationEnabled"
                              : "autoroleEnabled"]: command.enabled,
                    },
                    ...(fresh ? { roles: roleSnapshots(fresh) } : {}),
                },
                fresh ? moderationActor(fresh) : actor,
            )
        }
        if (command.type === "humans")
            result = yield* manage({ type: "settings", patch: { humansOnly: command.humansOnly } })
        if (command.type === "mode")
            result = yield* changed(yield* findPanel(command.name), { exclusive: command.exclusive })
        // Retiring or deleting a panel or autorole, and continuing either, takes back each member's roles under that member's lock, so once
        // the panel or removal is found it runs as the server's background role work, answers at once and replies with its result when it
        // is done. The work runs this command again, which reads the staff member's authority and the panel again when it starts
        if (command.type === "withdrawal" || command.type === "retire" || command.type === "delete") {
            let deletePanel = command.type === "delete" ? (true as const) : undefined
            if (command.type === "withdrawal") {
                const panelName = name === "verify" ? (yield* verificationPanel).name : command.name
                const found = yield* query({
                    type: "withdrawal-open",
                    ...(panelName ? { name: panelName } : {}),
                }).pipe(
                    Effect.catch((error) =>
                        error instanceof RolesStoreError && error.status === 404
                            ? Effect.succeed(undefined)
                            : Effect.fail(error),
                    ),
                )
                if (!found) {
                    yield* reply(`${panelName ? `Panel ${panelName}` : "Autorole"} has no role removal to continue`)
                    return
                }
                if (found.type !== "withdrawal") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
                if (found.withdrawal.deletePanel) deletePanel = true
            }
            const panel =
                name === "autorole"
                    ? undefined
                    : yield* command.name === undefined ? verificationPanel : findPanel(command.name)
            if (!background) {
                yield* reply(
                    `${command.type === "delete" ? "Deleting" : command.type === "retire" ? "Retiring" : "Continuing the role removal of"} ${panel ? `panel ${panel.name}` : "autorole"}. NeonFlux replies here when it is done`,
                )
                yield* backgroundRoleWork(
                    client,
                    config.serverId,
                    handleRoleCommand(store, publishing, config, name, command, context, worker, joinedAt, true).pipe(
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : warnFailure("A role removal could not be answered", cause),
                        ),
                    ),
                )
                return
            }
            // A panel continues through every revision, because an earlier one may be what stopped
            withdrawn = panel ? yield* withdrawPanel(panel, deletePanel) : yield* withdrawAutorole
        }
        if (command.type === "create")
            result = yield* manage({
                type: "panel-create",
                name: command.name,
                kind: "reaction",
                exclusive: command.mode === "exclusive",
            })
        if (command.type === "autorole") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            const roleIds =
                command.operation === "add"
                    ? [...new Set([...found.settings.autoroleIds, command.roleId])]
                    : found.settings.autoroleIds.filter((id) => id !== command.roleId)
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, {
                configuration: true,
                roleIds,
            })
            result = yield* manage(
                {
                    type: "settings",
                    patch: { autoroleIds: roleIds },
                    roles: roleSnapshots(fresh),
                    expectedRevision: found.settings.revision,
                },
                moderationActor(fresh),
            )
        }
        if (command.type === "reservation") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            const reservations = (found.settings.reservations ?? []).filter((row) => row.userId !== command.userId)
            if (command.roleIds.length) reservations.push({ userId: command.userId, roleIds: command.roleIds })
            const roleIds = [...new Set([...found.settings.autoroleIds, ...reservations.flatMap((row) => row.roleIds)])]
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, {
                configuration: true,
                roleIds,
                readOnly: !roleIds.length,
            })
            result = yield* manage(
                {
                    type: "settings",
                    patch: { reservations },
                    roles: roleSnapshots(fresh),
                    expectedRevision: found.settings.revision,
                },
                moderationActor(fresh),
            )
        }
        if (command.type === "enable" || command.type === "disable")
            result = yield* changed(yield* findPanel(command.name), { enabled: command.type === "enable" })
        if (command.type === "mapping" || command.type === "unmap" || command.type === "scope") {
            const panel = yield* findPanel(command.name)
            const previous = panel.mappings.find((m) => m.emoji === command.emoji)
            let mappings = panel.mappings.map((m) => ({ ...m }))
            // Each role comes from one emoji, because a member's claim on a panel role follows that emoji's rules
            const taken =
                command.type === "mapping" &&
                mappings.find((m) => m.roleId === command.roleId && m.emoji !== command.emoji)
            if (taken) {
                // A posted panel keeps at least one role, so its only emoji cannot be unmapped first
                yield* reply(
                    `${format.roleMention(taken.roleId)} already comes from ${taken.emoji} on role panel ${panel.name}. Each role can come from one emoji, ${
                        inPlace(panel, {}) && mappings.length === 1
                            ? `and this posted panel must keep at least one role, so change the emoji of ${taken.emoji} on the dashboard or choose another role`
                            : `so unmap ${taken.emoji} with ${code(`${prefix}roles unmap ${panel.name} ${taken.emoji}`)} first or choose another role`
                    }`,
                )
                return
            }
            if (command.type === "mapping" && !previous && mappings.length >= ROLES_PANEL_MAPPINGS) {
                yield* reply(
                    `Role panel ${panel.name} already has ${ROLES_PANEL_MAPPINGS} emojis, the most a panel can have. Unmap one first or choose an emoji it already has`,
                )
                return
            }
            if (command.type === "mapping")
                mappings = [
                    ...mappings.filter((m) => m.emoji !== command.emoji),
                    { emoji: command.emoji, roleId: command.roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] },
                ]
            else if (command.type === "unmap") mappings = mappings.filter((m) => m.emoji !== command.emoji)
            else {
                const selected = mappings.find((m) => m.emoji === command.emoji)
                if (!selected) {
                    yield* reply(`That emoji gives no role on panel ${panel.name}`)
                    return
                }
                if (command.roleIds.some((id) => !authority.roles.some((r) => r.id === id))) {
                    yield* reply("Every required and excluded role must exist in this server")
                    return
                }
                if (command.field === "prerequisites") selected.prerequisiteRoleIds = command.roleIds
                else selected.exclusionRoleIds = command.roleIds
            }
            result = yield* changed(panel, { mappings })
            if (inPlace(panel, { mappings }) && result && !result.duplicate && result.type === "panel") {
                if (command.type === "unmap" && previous) notes.push("NeonFlux takes back the role it gave for it")
                if (command.type === "mapping" && previous && previous.roleId !== command.roleId)
                    notes.push(
                        "Members react again for the new role, and NeonFlux takes back the role it gave for the old one",
                    )
                const failed = yield* syncReactions(result.panel)
                if (failed) notes.push(failed)
            }
        }
        if (command.type === "configure") {
            const mappings = [
                { emoji: command.emoji, roleId: command.roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] },
            ]
            const panel = yield* verificationPanel.pipe(
                Effect.catchIf(
                    (error) => error instanceof RoleHandlingError && error.stage === "panel",
                    () => Effect.succeed(undefined),
                ),
            )
            if (panel) result = yield* changed(panel, { mappings })
            else {
                const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, {
                    configuration: true,
                    roleIds: [command.roleId],
                })
                result = yield* manage(
                    {
                        type: "panel-create",
                        name: "rules",
                        kind: "verification",
                        mappings,
                        roles: roleSnapshots(fresh),
                    },
                    moderationActor(fresh),
                ).pipe(
                    // The only 409 this create answers is a taken name, and no verification panel exists to hold it
                    Effect.catchIf(
                        (error) => error instanceof RolesStoreError && error.status === 409,
                        () => reply(withPrefix(rulesNameTaken, prefix)).pipe(Effect.as(undefined)),
                    ),
                )
            }
        }
        if (command.type === "publish") {
            if (!publishing) {
                yield* reply(notSetUp("Publishing"))
                return
            }
            const panel = yield* command.name === undefined ? verificationPanel : findPanel(command.name)
            // The verification panel binds one message to each revision, so a second one would never work. A reaction
            // panel's fresh message takes a new revision
            if (panel.kind === "verification" && panel.published?.revision === panel.revision) {
                yield* reply(
                    `Panel ${panel.name} is already posted at its current revision. Change its roles or mode first`,
                )
                return
            }
            const draft = yield* publishing.query({
                serverId: config.serverId,
                actor,
                operation: { type: "draft-show", kind: "draft", name: command.draftName },
            })
            if (draft.type !== "draft") return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            const fresh = yield* readPublishingAuthority(
                client,
                config.serverId,
                actor.userId,
                command.channelId,
                !!draft.draft.content.embed,
            )
            const reserved = yield* publishing.manage({
                serverId: config.serverId,
                actor: moderationActor(fresh),
                messageId: message.id,
                createdAt: source.createdAt,
                operation: {
                    type: "send",
                    kind: "draft",
                    name: draft.draft.name,
                    expectedRevision: draft.draft.revision,
                    channelId: command.channelId,
                    context: {
                        originServerId: fresh.guild.id,
                        botId: fresh.botId,
                        channelId: command.channelId,
                        actorAuthorized: true,
                        botAuthorized: true,
                    },
                },
            })
            if (reserved.duplicate) return
            if (reserved.type !== "post" || !equalPublishingContent(reserved.grant.content, draft.draft.content))
                return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            const delivered = yield* performPublishingGrant(
                publishing,
                config.serverId,
                actor.userId,
                client,
                reserved.grant,
            )
            const postNo = reserved.post.postNo
            if (delivered.outcome !== "sent" || !delivered.acknowledged) {
                yield* reply(
                    delivered.outcome === "failed"
                        ? `The panel could not be posted. See post #${postNo} with ${code(`${prefix}publish status ${postNo}`)}`
                        : `The panel post is not confirmed yet, run ${code(`${prefix}publish reconcile ${postNo}`)}`,
                )
                return
            }
            const current = yield* readSafetyAuthority(client, config.serverId, actor.userId)
            result = yield* manage(
                {
                    type: "panel-bind",
                    name: panel.name,
                    expectedRevision: panel.revision,
                    postNo: reserved.post.postNo,
                    expectedPostGeneration: reserved.post.generation,
                },
                moderationActor(current),
            )
            if (result && !result.duplicate && result.type === "panel") {
                if (panel.published) notes.push("The earlier message no longer gives roles")
                if (panel.kind === "reaction") {
                    const failed = yield* syncReactions(result.panel)
                    if (failed) notes.push(failed)
                }
            }
        }
        if (command.type === "verify" || command.type === "choose") {
            const panel = yield* command.type === "verify" ? verificationPanel : findPanel(command.name)
            // The backend binds the published revision, so a command needs no panel message re-read
            if (panel.published?.revision !== panel.revision) {
                yield* reply(
                    `Panel ${panel.name} was edited after it was published. An administrator must publish it again`,
                )
                return
            }
            const choices =
                command.type === "verify"
                    ? [{ type: "verify" as const, name: panel.name, revision: panel.revision }]
                    : command.emoji === null
                      ? panel.mappings.map((m) => ({
                            type: "choose" as const,
                            name: panel.name,
                            revision: panel.revision,
                            roleId: m.roleId,
                            selected: false,
                        }))
                      : panel.mappings
                            .filter((m) => m.emoji === command.emoji)
                            .map((m) => ({
                                type: "choose" as const,
                                name: panel.name,
                                revision: panel.revision,
                                roleId: m.roleId,
                                selected: true,
                            }))
            if (!choices.length) {
                yield* reply(`That emoji gives no role on panel ${panel.name}`)
                return
            }
            for (let index = 0; index < choices.length; index++) {
                const applied = yield* evaluateCommand(actor.userId, choices[index]!, index)
                if (applied.result.duplicate) continue
                const done = requestText(applied.result, applied.outcome)
                yield* reply(
                    command.type === "verify" && done !== "Rules accepted"
                        ? `${done}. ${applied.result.acknowledgment.acknowledged ? "Rules accepted" : "Rules not accepted yet"}`
                        : done,
                )
                if (applied.outcome && applied.outcome.outcome !== "succeeded") break
            }
            return
        }
        if (command.type === "member") {
            // Panel claims are keyed by the panel's name
            const consumerPrefix =
                name === "autorole" ? "autorole:" : `panel:${command.name ?? (yield* verificationPanel).name}:`
            const userId = command.userId ?? actor.userId,
                target = `${command.name ? ` ${command.name}` : ""} ${format.userMention(userId)}`,
                start = `${prefix}${name} ${command.operation}${target}`
            const key = pageKey(config.serverId, message, name, command.operation, command.name, userId),
                cursor = command.next ? nextPosition<string>(key) : undefined
            if (command.next && cursor === undefined) {
                yield* reply(noNextPage(start))
                return
            }
            const fresh = yield* roleMemberContext(client, config.serverId, userId, actor.userId)
            if (command.operation === "withdraw") {
                yield* withdrawMember(userId, fresh.context.joinedAt, consumerPrefix, start)
                return
            }
            // A role change that stayed unconfirmed in an earlier membership is reconciled too
            const claims = yield* query(
                {
                    type: "claim-list",
                    userId,
                    ...(command.operation === "reconcile" ? {} : { joinedAt: fresh.context.joinedAt }),
                    ...(cursor ? { cursor } : {}),
                },
                moderationActor(fresh.authority),
            )
            if (claims.type !== "claims") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            rememberPosition(key, claims.nextCursor)
            const lines: string[] = []
            for (const claim of claims.claims) {
                // A removal leaves only its attempt to name the feature, because the feature no longer desires the role
                if (
                    command.operation !== "reconcile" ||
                    claim.status !== "uncertain" ||
                    !claim.attempt ||
                    !(
                        claim.attempt.consumerKey.startsWith(consumerPrefix) ||
                        claim.consumerKeys.some((consumerKey) => consumerKey.startsWith(consumerPrefix))
                    )
                )
                    continue
                const recorded = yield* store.reconcile({
                    serverId: config.serverId,
                    actor,
                    messageId: message.id,
                    createdAt: source.createdAt,
                    attemptId: claim.attempt.attemptId,
                    generation: claim.generation,
                    observation: {
                        originServerId: config.serverId,
                        observedAt: yield* Clock.currentTimeMillis,
                        userId,
                        joinedAt: fresh.context.joinedAt,
                        roleId: claim.roleId,
                        present: fresh.context.roleIds.includes(claim.roleId),
                    },
                })
                lines.push(
                    `${format.roleMention(recorded.claim.roleId)}: ${claimStates[recorded.claim.status]}, ${recorded.claim.owned ? "given by NeonFlux" : "not confirmed as given by NeonFlux"}`,
                )
            }
            yield* card({
                title: "Role check",
                ...(lines.length ? { description: lines.join("\n") } : {}),
                fields: [
                    ["Member", format.userMention(userId)],
                    ["Checked", managed(claims.claims.length)],
                    ...(claims.nextCursor ? [["Next", code(`${start} next`)] as const] : []),
                ],
                footer: "NeonFlux removes a role only when it confirmed that it gave it",
            })
            return
        }
        // A stopped deletion is continued by sending delete again, since only the last revision is asked to delete
        const again = (withdrawal: RolesWithdrawal) =>
            code(
                `${prefix}${name} ${command.type === "delete" ? "delete" : "next"}${name === "roles" ? ` ${withdrawal.consumerKey.split(":")[1]}` : ""}`,
            )
        if (!withdrawn && result && !result.duplicate && result.type === "withdrawal")
            withdrawn = yield* processWithdrawal(result.withdrawal)
        if (withdrawn) {
            const { withdrawal: current, conflicts } = withdrawn
            yield* reply(
                current.status === "complete"
                    ? `${current.deletePanel ? "Deleted" : "Retired"}. The roles it gave are removed`
                    : `${current.status === "blocked" ? "Stopped" : "Still removing roles"}, at least ${current.remainingAtLeast} left${conflicts ? `, ${conflicts} not confirmed` : ""}\nContinue: ${again(current)}`,
            )
            return
        }
        if (!result || result.duplicate) return
        // A new panel shows its whole card, and a change to one names what changed
        if (result.type === "panel")
            yield* command.type === "create"
                ? card(panelCard(result.panel, prefix))
                : reply([panelChange(command, result.panel), ...notes].join(". "))
        if (result.type === "settings") {
            const s = result.settings
            yield* reply(
                command.type === "module"
                    ? `${name === "roles" ? "Role panels" : name === "verify" ? "Rules verification" : "Autorole"} ${command.enabled ? "on" : "off"}`
                    : command.type === "humans"
                      ? `Autorole now gives roles to ${s.humansOnly ? "humans only" : "humans and bots"}`
                      : command.type === "autorole"
                        ? `${format.roleMention(command.roleId)} ${command.operation === "add" ? "added to" : "removed from"} autorole`
                        : command.type === "reservation"
                          ? command.roleIds.length
                              ? `${format.userMention(command.userId)} gets ${roles(command.roleIds)} on joining`
                              : `Reservation for ${format.userMention(command.userId)} removed`
                          : "Role settings saved",
            )
        }
    }).pipe(
        Effect.catch((error) =>
            reply(
                error instanceof RolesStoreError
                    ? rolesErrorMessage(error)
                    : (error instanceof RolePermissionError && rolePermissionFix(error)) ||
                          "NeonFlux couldn't confirm the member's roles or the panel. Check them before you try again",
            ),
        ),
    )
}
