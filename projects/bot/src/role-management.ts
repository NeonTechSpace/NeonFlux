import type * as C from "@neonflux/backend/contracts"
import { type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp, noMentions } from "./responses.ts"
import { readNativeMember } from "./member-evidence.ts"
import { roleHelp, type RoleCommand, type RoleCommandName } from "./role-command.ts"
import { readRoleAuthority } from "./role-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { evaluateRoleRequest, roleMemberContext, roleSnapshots, roleEventSource, RoleHandlingError, withRoleMember } from "./roles.ts"
import { RolesStoreError, rolesErrorMessage, type RolesStore } from "./roles-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { readPublishingAuthority } from "./publishing-permissions.ts"
import { equalPublishingContent } from "./publishing-content.ts"
import type { PublishingStore } from "./publishing-store.ts"
import type { startRoleReactionWorker } from "./role-reconciliation.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

const formatPanel = (panel: C.RolesPanel) => [`${panel.name}: ${panel.kind}, revision ${panel.revision}, ${panel.enabled ? "Enabled" : "Disabled"}, ${panel.exclusive ? "Exclusive" : "Toggle"}${panel.withdrawing ? ", withdrawal pending" : ""}`,
    ...panel.mappings.map((m) => `${m.emoji}: Role ${m.roleId}, prerequisites ${m.prerequisiteRoleIds.join(", ") || "None"}, exclusions ${m.exclusionRoleIds.join(", ") || "None"}`),
    panel.published ? `Published revision ${panel.published.revision}, channel ${panel.published.channelId}, message ${panel.published.messageId}` : "No published panel"].join("\n")

export function processRoleWithdrawal(store: RolesStore, serverId: string, client: Client, actorId: string, source: C.RolesSource, withdrawal: C.RolesWithdrawal,
    manage: (operation: Extract<C.RolesManageOperation, { type: "withdraw-departed" | "withdraw-next" }>) => Effect.Effect<C.RolesManageResult, unknown>,
    query: (cursor?: string) => Effect.Effect<C.RolesQueryResult, unknown>) {
    const withdrawTarget = (target: C.RolesWithdrawal["targets"][number]) => Effect.gen(function* () {
        const evidence = yield* readNativeMember(client, serverId, target.userId), native = evidence.member
        if (!native || native.joinedAt !== target.joinedAt) {
            const retired = yield* manage({ type: "withdraw-departed", withdrawalId: withdrawal.withdrawalId, userId: target.userId,
                joinedAt: target.joinedAt, originServerId: evidence.originServerId, memberUserId: evidence.userId,
                currentJoinedAt: native?.joinedAt ?? null, observedAt: yield* Clock.currentTimeMillis })
            return retired.duplicate || retired.type !== "withdrawal" || retired.withdrawal.status !== "blocked"
        }
        const applied = yield* evaluateRoleRequest(store, serverId, client,
            { ...source, sourceId: roleEventSource("withdraw", source.sourceId, withdrawal.withdrawalId, target.userId, target.joinedAt, target.roleId) },
            target.userId, { type: "withdraw", withdrawalId: withdrawal.withdrawalId, roleId: target.roleId }, actorId, native.isBot, target.joinedAt)
            .pipe(effect => withRoleMember(client, target.userId, effect, serverId))
        return applied.result.status !== "blocked" && (!applied.outcome || applied.outcome.outcome === "succeeded" && applied.outcome.acknowledged)
    })
    return Effect.gen(function* () {
        let current = withdrawal, conflicts = 0, cursor: string | undefined
        const skipped = new Set<string>()
        // One bounded run pages through the withdrawal itself and moves past targets that cannot be confirmed
        for (let round = 0; round < 50 && current.status !== "complete"; round++) {
            const targets = current.targets.filter((target) => !skipped.has(`${target.userId}:${target.joinedAt}:${target.roleId}`))
            for (const target of targets) {
                const done = yield* withdrawTarget(target).pipe(Effect.match({ onFailure: () => false, onSuccess: (value) => value }))
                if (!done) { conflicts++; skipped.add(`${target.userId}:${target.joinedAt}:${target.roleId}`) }
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
            const settled = yield* manage({ type: "withdraw-next", withdrawalId: current.withdrawalId, expectedStep: current.step })
            if (settled.duplicate || settled.type !== "withdrawal") break
            current = settled.withdrawal
        }
        return { withdrawal: current, conflicts }
    })
}

export function handleRoleCommand(store: RolesStore, publishing: PublishingStore | undefined, config: BotConfig,
    name: RoleCommandName, command: RoleCommand | { error: string }, context: BotEventContext<"messageCreate">,
    worker?: Effect.Success<ReturnType<typeof startRoleReactionWorker>>) {
    const reply = (content: string) => Effect.gen(function* () {
        for (let i = 0; i < content.length; i += 1900) yield* context.reply({ content: content.slice(i, i + 1900), allowedMentions: noMentions })
    })
    const work = Effect.gen(function* () {
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(roleHelp(name), replyPrefix(config.serverId, context.message.guildId))); return }
        const { client, message } = context
        const source = { sourceId: message.id, createdAt: yield* sourceTimestamp(message) }
        const selfService = command.type === "verify" || command.type === "choose" || name === "verify" && command.type === "status"
        const authority = yield* readSafetyAuthority(client, config.serverId, message.author.id)
        const actor = moderationActor(authority)
        if (!selfService && !authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage role configuration and staff recovery"); return }
        const query = (operation: C.RolesQueryRequest["operation"], currentActor = actor) => store.query({ serverId: config.serverId, actor: currentActor, operation })
        const manage = (operation: C.RolesManageOperation, currentActor = actor) => store.manage({ serverId: config.serverId, actor: currentActor, messageId: source.sourceId, createdAt: source.createdAt, operation })
        const findPanel = (panelName: string) => Effect.gen(function* () {
            if (selfService) {
                const fresh = yield* roleMemberContext(client, config.serverId, actor.userId)
                const member = yield* store.memberQuery({ serverId: config.serverId, context: fresh.context })
                const panel = member.panels.find((p) => p.name === panelName)
                if (!panel) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
                return panel
            }
            const value = yield* query({ type: "panel-show", name: panelName })
            if (value.type !== "panel") return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            return value.panel
        })
        const changed = (panel: C.RolesPanel, patch: Extract<C.RolesManageOperation, { type: "panel-update" }>["patch"]) => Effect.gen(function* () {
            const ids = patch.mappings?.map((m) => m.roleId) ?? []
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds: ids })
            return yield* manage({ type: "panel-update", name: panel.name, expectedRevision: panel.revision, patch, roles: roleSnapshots(fresh) }, moderationActor(fresh))
        })
        // Each operation of a chat command is its own source, so a redelivered message applies nothing twice
        const evaluateCommand = (userId: string, operation: C.RolesEvaluateOperation, index: number) => evaluateRoleRequest(store, config.serverId, client,
            { ...source, sourceId: `command_${message.id}_${index}` }, userId, operation, actor.userId, false)
        if (command.type === "jobs" || command.type === "resume") {
            const current = yield* store.reactionJobs({ serverId: config.serverId, operation: { type: "list" } })
            if (current.type !== "jobs") return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            if (command.type === "resume") {
                const job = current.jobs.find((j) => j.jobId === command.jobId)
                if (!job || !worker) { yield* reply("That active reaction job could not be confirmed"); return }
                yield* worker.notify(job)
                yield* reply(`Reaction job ${job.jobId} queued for fresh reconciliation`)
            } else yield* reply(current.jobs.map((job) => `${job.jobId}: ${job.name}, revision ${job.revision}, ${job.status}, page ${job.pageStep}`).join("\n") || "No active reaction jobs")
            return
        }
        if (command.type === "reactions") {
            const panel = yield* findPanel(command.name)
            if (!panel.published || !worker) { yield* reply("A current published panel and running reconciliation worker are required"); return }
            yield* worker.enqueue(panel.published.messageId)
            yield* reply(`Current reactions for ${panel.name} queued for bounded reconciliation`)
            return
        }
        let result: C.RolesManageResult | undefined
        if (name === "verify" && command.type === "status") {
            const fresh = yield* roleMemberContext(client, config.serverId, actor.userId)
            const current = yield* store.memberQuery({ serverId: config.serverId, context: fresh.context })
            yield* reply(`Rules acknowledged: ${current.acknowledgment.acknowledged ? "Yes" : "No"}. Access role present: ${current.acknowledgment.accessRolePresent ? "Yes" : "No"}. Access confirmed: ${current.acknowledgment.accessConfirmed ? "Yes" : "No"}`)
            return
        }
        if (command.type === "reservations") {
            const found = yield* query({ type: "settings" })
            if (found.type === "settings") yield* reply(`Saved role reservations\n${(found.settings.reservations ?? []).map(row => `User ${row.userId}: ${row.roleIds.join(", ")}`).join("\n") || "None"}\nReservations persist for future joins and share the autorole module and humans-only policy`)
            return
        }
        if (command.type === "status" || command.type === "list" && name === "autorole") {
            const found = yield* query({ type: "settings" })
            if (found.type === "settings") yield* reply(`Reaction panels: ${found.settings.panelsEnabled ? "On" : "Off"}. Verification: ${found.settings.verificationEnabled ? "On" : "Off"}. Autorole: ${found.settings.autoroleEnabled ? "On" : "Off"}, ${found.settings.humansOnly ? "Humans only" : "Explicit bot opt-in"}. Autoroles: ${found.settings.autoroleIds.join(", ") || "None"}. Settings revision ${found.settings.revision}`)
            return
        }
        if (command.type === "list") {
            const found = yield* query({ type: "panel-list", page: command.page })
            if (found.type === "panels") yield* reply(`Panels, page ${found.page}/${found.totalPages}\n${found.panels.map((p) => `${p.name}: ${p.kind}, revision ${p.revision}, ${p.enabled ? "Enabled" : "Disabled"}`).join("\n") || "No panels"}`)
            return
        }
        if (command.type === "show") { yield* reply(formatPanel(yield* findPanel(command.name))); return }
        if (command.type === "history") {
            const found = yield* query({ type: "configuration-list", ...(command.name ? { name: command.name } : {}), ...(command.cursor ? { cursor: command.cursor } : {}) })
            if (found.type === "configurations") yield* reply(`Retained configurations\n${found.references.map((r) => `${r.consumerKey}, role ${r.roleId}${r.postNo ? `, publishing post ${r.postNo}` : ""}`).join("\n") || "None"}${found.nextCursor ? `\nNext: !${name} history${command.name ? ` ${command.name}` : ""} "${found.nextCursor}"` : ""}`)
            return
        }
        if (command.type === "module") {
            const fresh = name === "autorole" && command.enabled ? yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true }) : undefined
            result = yield* manage({ type: "settings", patch: { [name === "roles" ? "panelsEnabled" : name === "verify" ? "verificationEnabled" : "autoroleEnabled"]: command.enabled }, ...(fresh ? { roles: roleSnapshots(fresh) } : {}) }, fresh ? moderationActor(fresh) : actor)
        }
        if (command.type === "humans") result = yield* manage({ type: "settings", patch: { humansOnly: command.humansOnly } })
        if (command.type === "mode") result = yield* changed(yield* findPanel(command.name), { exclusive: command.exclusive })
        if (command.type === "withdrawal") {
            const found = yield* query({ type: "withdrawal-show", withdrawalId: command.withdrawalId })
            if (found.type !== "withdrawal") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            result = yield* manage({ type: "withdraw-next", withdrawalId: command.withdrawalId, expectedStep: found.withdrawal.step })
        }
        if (command.type === "retire") {
            if (name === "autorole") {
                const found = yield* query({ type: "settings" })
                if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
                result = yield* manage({ type: "autorole-withdraw", revision: command.revision ?? found.settings.revision })
            } else {
                const panel = yield* findPanel(command.name ?? "rules")
                result = yield* manage({ type: "withdraw", name: panel.name, revision: command.revision ?? panel.published?.revision ?? panel.revision })
            }
        }
        if (command.type === "create") result = yield* manage({ type: "panel-create", name: command.name, kind: "reaction", exclusive: command.mode === "exclusive" })
        if (command.type === "autorole") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            const roleIds = command.operation === "add" ? [...new Set([...found.settings.autoroleIds, command.roleId])] : found.settings.autoroleIds.filter((id) => id !== command.roleId)
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds })
            result = yield* manage({ type: "settings", patch: { autoroleIds: roleIds }, roles: roleSnapshots(fresh), expectedRevision: found.settings.revision }, moderationActor(fresh))
        }
        if (command.type === "reservation") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            const reservations = (found.settings.reservations ?? []).filter(row => row.userId !== command.userId)
            if (command.roleIds.length) reservations.push({ userId: command.userId, roleIds: command.roleIds })
            const roleIds = [...new Set([...found.settings.autoroleIds, ...reservations.flatMap(row => row.roleIds)])]
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds, readOnly: !roleIds.length })
            result = yield* manage({ type: "settings", patch: { reservations }, roles: roleSnapshots(fresh), expectedRevision: found.settings.revision }, moderationActor(fresh))
        }
        if (command.type === "enable" || command.type === "disable") result = yield* changed(yield* findPanel(command.name), { enabled: command.type === "enable" })
        if (command.type === "mapping" || command.type === "unmap" || command.type === "scope") {
            const panel = yield* findPanel(command.name)
            let mappings = panel.mappings.map((m) => ({ ...m }))
            if (command.type === "mapping") mappings = [...mappings.filter((m) => m.emoji !== command.emoji), { emoji: command.emoji, roleId: command.roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] }]
            else if (command.type === "unmap") mappings = mappings.filter((m) => m.emoji !== command.emoji)
            else {
                const selected = mappings.find((m) => m.emoji === command.emoji)
                if (!selected) { yield* reply("That emoji has no mapping"); return }
                if (command.roleIds.some((id) => !authority.roles.some((r) => r.id === id))) { yield* reply("Every prerequisite and exclusion role must exist in this server"); return }
                if (command.field === "prerequisites") selected.prerequisiteRoleIds = command.roleIds
                else selected.exclusionRoleIds = command.roleIds
            }
            result = yield* changed(panel, { mappings })
        }
        if (command.type === "configure") {
            const mappings = [{ emoji: command.emoji, roleId: command.roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] }]
            const panel = yield* findPanel("rules").pipe(Effect.catch((error) => error instanceof RolesStoreError && error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error)))
            if (panel) result = yield* changed(panel, { mappings })
            else {
                const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds: [command.roleId] })
                result = yield* manage({ type: "panel-create", name: "rules", kind: "verification", mappings, roles: roleSnapshots(fresh) }, moderationActor(fresh))
            }
        }
        if (command.type === "publish") {
            if (!publishing) { yield* reply("Publishing persistence is not configured"); return }
            const panel = yield* findPanel(command.name ?? "rules")
            const draft = yield* publishing.query({ serverId: config.serverId, actor, operation: { type: "draft-show", kind: "draft", name: command.draftName } })
            if (draft.type !== "draft") return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, command.channelId, !!draft.draft.content.embed)
            const reserved = yield* publishing.manage({ serverId: config.serverId, actor: moderationActor(fresh), messageId: message.id, createdAt: source.createdAt,
                operation: { type: "send", kind: "draft", name: draft.draft.name, expectedRevision: draft.draft.revision, channelId: command.channelId,
                    context: { originServerId: fresh.guild.id, botId: fresh.botId, channelId: command.channelId, actorAuthorized: true, botAuthorized: true } } })
            if (reserved.duplicate) return
            if (reserved.type !== "post" || !equalPublishingContent(reserved.grant.content, draft.draft.content)) return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            const delivered = yield* performPublishingGrant(publishing, config.serverId, actor.userId, client, reserved.grant)
            if (delivered.outcome !== "sent" || !delivered.acknowledged) { yield* reply(`Panel delivery is ${delivered.outcome}. Inspect publishing post ${reserved.post.postNo} before continuing`); return }
            const current = yield* readSafetyAuthority(client, config.serverId, actor.userId)
            result = yield* manage({ type: "panel-bind", name: panel.name, expectedRevision: panel.revision, postNo: reserved.post.postNo, expectedPostGeneration: reserved.post.generation }, moderationActor(current))
        }
        if (command.type === "verify" || command.type === "choose") {
            const panel = yield* findPanel(command.type === "verify" ? "rules" : command.name)
            // The backend binds the published revision, so a command needs no panel message re-read
            if (panel.published?.revision !== panel.revision) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            const choices = command.type === "verify" ? [{ type: "verify" as const, name: panel.name, revision: panel.revision }]
                : command.emoji === null ? panel.mappings.map((m) => ({ type: "choose" as const, name: panel.name, revision: panel.revision, roleId: m.roleId, selected: false }))
                    : panel.mappings.filter((m) => m.emoji === command.emoji).map((m) => ({ type: "choose" as const, name: panel.name, revision: panel.revision, roleId: m.roleId, selected: true }))
            if (!choices.length) { yield* reply("That emoji has no current mapping"); return }
            for (let index = 0; index < choices.length; index++) {
                const applied = yield* evaluateCommand(actor.userId, choices[index]!, index)
                if (applied.result.duplicate) continue
                yield* reply(`Role request: ${applied.result.status}${applied.outcome ? `, delivery ${applied.outcome.outcome}${applied.outcome.acknowledged ? "" : ", outcome acknowledgement unconfirmed"}` : ""}. Rules acknowledged: ${applied.result.acknowledgment.acknowledged ? "Yes" : "No"}`)
                if (applied.outcome && applied.outcome.outcome !== "succeeded") break
            }
            return
        }
        if (command.type === "delete") {
            const panel = yield* findPanel(command.name)
            result = yield* manage({ type: "withdraw", name: panel.name, revision: panel.published?.revision ?? panel.revision, deletePanel: true })
        }
        if (command.type === "member") {
            const userId = command.userId ?? actor.userId
            const fresh = yield* roleMemberContext(client, config.serverId, userId, actor.userId)
            const claims = yield* query({ type: "claim-list", userId, joinedAt: fresh.context.joinedAt, ...(command.cursor ? { cursor: command.cursor } : {}) }, moderationActor(fresh.authority))
            if (claims.type !== "claims") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            if (command.operation === "withdraw") {
                const operations: C.RolesEvaluateOperation[] = []
                for (const claim of claims.claims) for (const consumerKey of claim.consumerKeys) {
                    if (command.name && !consumerKey.startsWith(`panel:${command.name}:`) || name === "verify" && !consumerKey.startsWith("panel:rules:")
                        || name === "autorole" && !consumerKey.startsWith("autorole:")) continue
                    operations.push({ type: "withdraw-member", consumerKey, roleId: claim.roleId })
                }
                const batch = operations.slice(0, 20)
                for (let index = 0; index < batch.length; index++) {
                    const applied = yield* evaluateCommand(userId, batch[index]!, index)
                    if (applied.outcome && (applied.outcome.outcome !== "succeeded" || !applied.outcome.acknowledged)) {
                        yield* reply(`Withdrawal delivery: ${applied.outcome.outcome}. Outcome acknowledgement: ${applied.outcome.acknowledged ? "Confirmed" : "Unconfirmed"}`)
                        return
                    }
                }
                if (operations.length > 20) yield* reply("This command bound twenty exact withdrawals. Use a new command to continue the remaining references on this page")
            }
            for (const claim of claims.claims) {
                const relevant = claim.consumerKeys.some((consumerKey) => name === "autorole" ? consumerKey.startsWith("autorole:")
                    : consumerKey.startsWith(`panel:${command.name ?? "rules"}:`))
                if (!relevant) continue
                if (command.operation === "reconcile" && claim.attempt) {
                    const recorded = yield* store.reconcile({ serverId: config.serverId, actor, messageId: message.id, createdAt: source.createdAt,
                        attemptId: claim.attempt.attemptId, generation: claim.generation, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis,
                            userId, joinedAt: fresh.context.joinedAt, roleId: claim.roleId, present: fresh.context.roleIds.includes(claim.roleId) } })
                    yield* reply(`Role ${recorded.claim.roleId}: ${recorded.claim.status}, confirmed ownership ${recorded.claim.owned ? "Yes" : "No"}`)
                }
            }
            yield* reply(`Inspected ${claims.claims.length} managed claims. No uncertain addition establishes removal ownership${claims.nextCursor ? `\nNext: !${name} ${command.operation}${command.name ? ` ${command.name}` : ""} <@${userId}> "${claims.nextCursor}"` : ""}`)
            return
        }
        if (!result || result.duplicate) return
        if (result.type === "panel") yield* reply(formatPanel(result.panel))
        if (result.type === "settings") yield* reply(`Role settings saved, revision ${result.settings.revision}`)
        if (result.type === "withdrawal") {
            const { withdrawal: current, conflicts } = yield* processRoleWithdrawal(store, config.serverId, client, actor.userId, source, result.withdrawal,
                operation => manage(operation), (cursor) => query({ type: "withdrawal-show", withdrawalId: result.withdrawal.withdrawalId, ...(cursor === undefined ? {} : { cursor }) }))
            yield* reply(`Withdrawal ${current.withdrawalId}: ${current.status}, at least ${current.remainingAtLeast} remaining, ${conflicts} unconfirmed targets.${current.status !== "complete" ? ` Next: !${name} next ${current.withdrawalId}` : ""}`)
        }
    }).pipe(Effect.catch((error) => error instanceof RolesStoreError ? reply(rolesErrorMessage(error)) : reply("Current role eligibility or panel identity could not be confirmed. Inspect the state before another change")))
    return !("error" in command) && ["verify", "choose", "member"].includes(command.type)
        ? withRoleMember(context.client, command.type === "member" ? command.userId ?? context.message.author.id : context.message.author.id, work, config.serverId) : work
}
