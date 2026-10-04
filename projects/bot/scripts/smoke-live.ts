// Opt-in live moderation smoke through the production backend adapter and real REST calls, without a gateway connection.
// It runs only when an operator starts `pnpm smoke:live` with the bot's .env and an ignored smoke-live.local.json, never in tests.
// Each change registers its restoration as a scope finalizer, so restorations run in reverse order after success, failure or Ctrl+C
import type * as C from "@neonflux/backend/contracts"
import { createClient } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit, Redacted } from "effect"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { actionPermission } from "../src/action-executor.ts"
import { readConfig } from "../src/config.ts"
import { actionContext, moderationActor, performActionGrant } from "../src/moderation.ts"
import { createModerationStore, type ModerationStore } from "../src/moderation-store.ts"
import { readSafetyAuthority } from "../src/safety-permissions.ts"

const configPath = "smoke-live.local.json"
const checks: Record<string, boolean> = {}
const failure = (message: string) => Effect.fail(new Error(message))
// Records a named check that passes only when its effect succeeds
const run = <A, E>(name: string, effect: Effect.Effect<A, E>) => Effect.suspend(() => {
    checks[name] = false
    return effect.pipe(Effect.tap(() => Effect.sync(() => { checks[name] = true })))
})
const restore = (name: string, effect: Effect.Effect<unknown, unknown>) => Effect.addFinalizer(() => Effect.ignore(run(name, effect)))
// Synthetic source IDs stand in for the command message a staff member would send
const source = () => ({ messageId: (BigInt(`0x${randomBytes(8).toString("hex")}`) >> 1n | 1n).toString(), createdAt: Date.now() })

const program = Effect.scoped(Effect.gen(function* () {
    const config = yield* Effect.try({ try: () => JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>, catch: () => new Error(`Create ${configPath} from smoke-live.example.json`) })
    const bot = yield* readConfig(process.env).pipe(Effect.mapError((error) => new Error(error.message)))
    const { serverId, operatorId, targetId, channelId } = config
    if (![serverId, operatorId, targetId, channelId].every((id) => typeof id === "string" && /^\d{1,20}$/.test(id)) || operatorId === targetId) return yield* failure(`${configPath} needs distinct server, operator, target and channel IDs`)
    if (!bot.backend || serverId !== bot.serverId) return yield* failure(`${configPath} must name the server and backend configured in .env`)
    const ids = { serverId: serverId as string, operatorId: operatorId as string, targetId: targetId as string, channelId: channelId as string }
    const client = yield* createClient({ token: Redacted.value(bot.token), rest: { concurrency: 1, defaultTimeoutMs: 5000 }, logging: { level: "silent" } })
    const backend = createModerationStore(bot.backend)
    // Remembers which staff logs and private notices the production delivery path reports as sent
    const delivered = new Set<string>()
    const store: ModerationStore = { ...backend,
        logOutcome: (input) => { if (input.outcome === "sent") delivered.add(`log ${input.caseNo}`); return backend.logOutcome(input) },
        noticeOutcome: (input) => { if (input.outcome === "sent") delivered.add(`notice ${input.caseNo}`); return backend.noticeOutcome(input) },
    }
    const authority = (type?: C.ModerationActionType) => readSafetyAuthority(client, ids.serverId, ids.operatorId, {
        ...(type && actionPermission(type) !== undefined ? { permission: actionPermission(type)! } : {}),
        ...(type === "lock" || type === "unlock" ? { channelId: ids.channelId } : { targetId: ids.targetId }),
    })
    const actor = authority().pipe(Effect.map(moderationActor))
    const settings = Effect.gen(function* () {
        const result = yield* store.query({ serverId: ids.serverId, actor: yield* actor, operation: { type: "settings" } })
        return result.type === "settings" ? result.settings : yield* failure("Unexpected settings response")
    })
    const setSettings = (patch: Extract<C.ModerationManageOperation, { type: "settings" }>["patch"]) => Effect.gen(function* () {
        yield* store.manage({ serverId: ids.serverId, actor: yield* actor, ...source(), operation: { type: "settings", patch } })
    })
    // Reserves an operation like a staff command would, then performs its grant natively and requires success
    const perform = (operation: C.ModerationManageOperation, who: C.ModerationActor) => Effect.gen(function* () {
        const result = yield* store.manage({ serverId: ids.serverId, actor: who, ...source(), operation })
        if (result.duplicate || result.type !== "case" || !result.grant) return yield* failure("The backend returned no action grant")
        const performed = yield* performActionGrant(store, ids.serverId, ids.operatorId, client, result.grant)
        return performed.outcome === "succeeded" ? result.case : yield* failure(`The ${result.grant.action} action did not succeed`)
    })
    const act = (input: C.ModerationActionInput) => Effect.gen(function* () {
        const current = yield* authority(input.type)
        const context = actionContext(current, input.type)
        if (input.type === "release" || input.type === "unlock") {
            const found = yield* store.query({ serverId: ids.serverId, actor: moderationActor(current), operation: input.type === "unlock" ? { type: "recovery-channel", channelId: ids.channelId } : { type: "recovery-target", targetId: ids.targetId } })
            if (found.type !== "recovery") return yield* failure("Unexpected recovery response")
            input = { ...input, recoveryId: found.recovery.recoveryId, linkedCaseNo: found.recovery.caseNo }
            context.recoveryGeneration = found.recovery.generation
        }
        return yield* perform({ type: "action", action: input, context }, moderationActor(current))
    })
    const reason = "Operator-initiated NeonFlux live smoke"

    const baseline = yield* run("read settings", settings)
    if (!baseline.manualModerationEnabled) return yield* failure("Enable manual moderation before the smoke")
    yield* run("set log channel", setSettings({ logChannelId: ids.channelId }))
    yield* restore("restore log channel", setSettings({ logChannelId: baseline.logChannelId }))

    const warning = yield* run("warning", act({ type: "warn", targetId: ids.targetId, reason }))
    yield* restore("void warning", Effect.gen(function* () { yield* perform({ type: "case-void", caseNo: warning.caseNo }, yield* actor) }))
    checks["warning log sent"] = delivered.has(`log ${warning.caseNo}`)
    checks["warning notice sent"] = delivered.has(`notice ${warning.caseNo}`)

    yield* run("quarantine", act({ type: "quarantine", targetId: ids.targetId, durationSeconds: 30, reason }))
    yield* restore("release quarantine", act({ type: "release", targetId: ids.targetId, reason }))
    yield* run("lock", act({ type: "lock", channelId: ids.channelId, reason }))
    yield* restore("unlock", act({ type: "unlock", channelId: ids.channelId, reason }))

    yield* restore("restore defcon", setSettings({ defcon: baseline.defcon }))
    for (const level of [2, 1] as const) {
        yield* run(`set defcon ${level}`, setSettings({ defcon: level }))
        const member: C.ModerationActor = { userId: ids.targetId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false }
        const denied = yield* store.gate({ serverId: ids.serverId, actor: member, command: "public" })
        const critical = yield* store.gate({ serverId: ids.serverId, actor: yield* actor, command: "critical" })
        checks[`defcon ${level} gates`] = denied.defcon === level && !denied.allowed && critical.allowed
    }
}))

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())
const exit = await Effect.runPromiseExit(program, { signal: controller.signal })
console.log(JSON.stringify(checks, undefined, 2))
if (Exit.isFailure(exit)) {
    // Tagged service errors print only their tag, so provider and backend details stay out of the output
    const error = Cause.squash(exit.cause) as { _tag?: string, message?: string } | undefined
    console.error(`Smoke stopped: ${error?._tag ?? error?.message ?? "interrupted"}`)
}
if (Exit.isFailure(exit) || Object.values(checks).includes(false)) process.exitCode = 1
