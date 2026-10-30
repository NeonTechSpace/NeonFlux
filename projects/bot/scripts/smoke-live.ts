// Opt-in live moderation smoke through the production backend adapter and real REST calls, without a gateway connection.
// It runs only when an operator starts `pnpm smoke:live` with the bot's .env and an ignored smoke-live.local.json, never in tests.
// Each change registers its restoration as a scope finalizer before it starts, so restorations run in reverse order after success,
// failure, Ctrl+C or a write whose outcome is unknown. A restoration reads the current state first, so it is harmless when its change never happened,
// and a release or unlock undoes only the recovery its own action's source recorded, never one that was already there
import type {
    ModerationActionInput,
    ModerationActionType,
    ModerationManageOperation,
} from "@neonflux/contracts/moderation"
import type { ModerationActor, ModerationSource } from "@neonflux/contracts/shared"
import { createClient, snowflakes } from "@neontechspace/fluxerly/effect"
import { Cause, Data, Effect, Exit, Redacted } from "effect"
import { readFileSync } from "node:fs"
import { actionPermission } from "../src/action-executor.ts"
import { readConfig } from "../src/config.ts"
import { actionContext, moderationActor, performActionGrant } from "../src/moderation.ts"
import { createModerationStore, type ModerationStore } from "../src/moderation-store.ts"
import { readSafetyAuthority } from "../src/safety-permissions.ts"
import { adoptBackendScope } from "../src/server-runtime.ts"

const configPath = "smoke-live.local.json"
const checks: Record<string, boolean> = {}
class SmokeLiveError extends Data.TaggedError("SmokeLiveError")<{ readonly message: string }> {}
const failure = (message: string) => Effect.fail(new SmokeLiveError({ message }))
// Records a named check that passes only when its effect succeeds
const run = <A, E>(name: string, effect: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
        checks[name] = false
        return effect.pipe(
            Effect.tap(() =>
                Effect.sync(() => {
                    checks[name] = true
                }),
            ),
        )
    })
const restore = (name: string, effect: Effect.Effect<unknown, unknown>) =>
    Effect.addFinalizer(() => Effect.ignore(run(name, effect)))
// Synthetic source IDs stand in for the command message a staff member would send. Like real message IDs they follow the clock
// and always rise, since the backend refuses a settings change whose ID is not above the last one and a random ID would fence out
// every later real command
let lastSource = 0n
const source = () => {
    const createdAt = Date.now()
    lastSource = [BigInt(snowflakes.boundary(new Date(createdAt))), lastSource + 1n].reduce((a, b) => (a > b ? a : b))
    return { messageId: lastSource.toString(), createdAt }
}

const program = Effect.scoped(
    Effect.gen(function* () {
        const config = yield* Effect.try({
            try: () => JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>,
            catch: () => new SmokeLiveError({ message: `Create ${configPath} from smoke-live.example.json` }),
        })
        const { serverId, operatorId, targetId, channelId } = config
        if (
            ![serverId, operatorId, targetId, channelId].every(
                (id) => typeof id === "string" && /^\d{1,20}$/.test(id),
            ) ||
            operatorId === targetId
        )
            return yield* failure(`${configPath} needs distinct server, operator, target and channel IDs`)
        // The backend owns the server scope, so the smoke adopts it like the bot does before it checks the server it was given
        const bot = yield* readConfig(process.env).pipe(
            Effect.flatMap(adoptBackendScope),
            Effect.mapError((error) => new SmokeLiveError({ message: error.message })),
        )
        if (!bot.backend || (bot.scope?.mode !== "multi" && serverId !== bot.serverId))
            return yield* failure(`${configPath} must name a server that the backend configured in .env serves`)
        const ids = {
            serverId: serverId as string,
            operatorId: operatorId as string,
            targetId: targetId as string,
            channelId: channelId as string,
        }
        const client = yield* createClient({
            token: Redacted.value(bot.token),
            rest: { concurrency: 1, defaultTimeoutMs: 5000 },
            logging: { level: "silent" },
        })
        // Each request is bound to the server, as a server runtime binds its own
        const backend = createModerationStore({ ...bot.backend, serverId: ids.serverId })
        // Remembers which staff logs and private notices the production delivery path reports as sent
        const delivered = new Set<string>()
        const store: ModerationStore = {
            ...backend,
            logOutcome: (input) => {
                if (input.outcome === "sent") delivered.add(`log ${input.caseNo}`)
                return backend.logOutcome(input)
            },
            noticeOutcome: (input) => {
                if (input.outcome === "sent") delivered.add(`notice ${input.caseNo}`)
                return backend.noticeOutcome(input)
            },
        }
        const authority = (type?: ModerationActionType) =>
            readSafetyAuthority(client, ids.serverId, ids.operatorId, {
                ...(type && actionPermission(type) !== undefined ? { permission: actionPermission(type)! } : {}),
                ...(type === "lock" || type === "unlock" ? { channelId: ids.channelId } : { targetId: ids.targetId }),
            })
        const actor = authority().pipe(Effect.map(moderationActor))
        const settings = Effect.gen(function* () {
            const result = yield* store.query({
                serverId: ids.serverId,
                actor: yield* actor,
                operation: { type: "settings" },
            })
            return result.type === "settings" ? result.settings : yield* failure("Unexpected settings response")
        })
        const setSettings = (patch: Extract<ModerationManageOperation, { type: "settings" }>["patch"]) =>
            Effect.gen(function* () {
                yield* store.manage({
                    serverId: ids.serverId,
                    actor: yield* actor,
                    ...source(),
                    operation: { type: "settings", patch },
                })
            })
        // Reserves an operation like a staff command would, then performs its grant natively and requires success
        // reserved learns the case as soon as the backend records it, so its restoration can find it after an interruption
        const perform = (
            operation: ModerationManageOperation,
            who: ModerationActor,
            reserved?: (caseNo: number) => void,
            from = source(),
        ) =>
            Effect.gen(function* () {
                const result = yield* store.manage({ serverId: ids.serverId, actor: who, ...from, operation })
                if (result.duplicate || result.type !== "case" || !result.grant)
                    return yield* failure("The backend returned no action grant")
                reserved?.(result.case.caseNo)
                const performed = yield* performActionGrant(store, ids.serverId, ids.operatorId, client, result.grant)
                return performed.outcome === "succeeded"
                    ? result.case
                    : yield* failure(`The ${result.grant.action} action did not succeed`)
            })
        // owner is the source of the action whose recovery a release or unlock may undo, so a lock or quarantine from before the smoke stays
        const act = (
            input: ModerationActionInput,
            options: { reserved?: (caseNo: number) => void; from?: ModerationSource; owner?: ModerationSource } = {},
        ) =>
            Effect.gen(function* () {
                const current = yield* authority(input.type)
                const context = actionContext(current, input.type)
                if (input.type === "release" || input.type === "unlock") {
                    const found = yield* store.query({
                        serverId: ids.serverId,
                        actor: moderationActor(current),
                        operation:
                            input.type === "unlock"
                                ? { type: "recovery-channel", channelId: ids.channelId }
                                : { type: "recovery-target", targetId: ids.targetId },
                    })
                    if (found.type !== "recovery") return yield* failure("Unexpected recovery response")
                    const recorded = yield* store.query({
                        serverId: ids.serverId,
                        actor: moderationActor(current),
                        originServerId: ids.serverId,
                        privateChannelVerified: true,
                        operation: { type: "recovery-case", caseNo: found.recovery.caseNo },
                    })
                    if (recorded.type !== "case" || recorded.case.sourceId !== options.owner?.messageId)
                        return yield* failure("The tracked recovery belongs to another action")
                    input = { ...input, recoveryId: found.recovery.recoveryId, linkedCaseNo: found.recovery.caseNo }
                    context.recoveryGeneration = found.recovery.generation
                }
                return yield* perform(
                    { type: "action", action: input, context },
                    moderationActor(current),
                    options.reserved,
                    options.from,
                )
            })
        const reason = "Operator-initiated NeonFlux live smoke"

        const baseline = yield* run("read settings", settings)
        if (!baseline.manualModerationEnabled) return yield* failure("Enable manual moderation before the smoke")
        yield* restore("restore log channel", setSettings({ logChannelId: baseline.logChannelId }))
        yield* run("set log channel", setSettings({ logChannelId: ids.channelId }))

        let warningCaseNo: number | undefined
        yield* restore(
            "void warning",
            Effect.gen(function* () {
                if (warningCaseNo === undefined) return yield* failure("No warning was recorded")
                yield* perform({ type: "case-void", caseNo: warningCaseNo }, yield* actor)
            }),
        )
        const warning = yield* run(
            "warning",
            act(
                { type: "warn", targetId: ids.targetId, reason },
                {
                    reserved: (caseNo) => {
                        warningCaseNo = caseNo
                    },
                },
            ),
        )
        checks["warning log sent"] = delivered.has(`log ${warning.caseNo}`)
        checks["warning notice sent"] = delivered.has(`notice ${warning.caseNo}`)

        // Release and unlock look up the recovery the action recorded under its own source, also when the action's answer was lost, and find none when it never happened
        const quarantine = source(),
            lock = source()
        yield* restore(
            "release quarantine",
            act({ type: "release", targetId: ids.targetId, reason }, { owner: quarantine }),
        )
        yield* run(
            "quarantine",
            act({ type: "quarantine", targetId: ids.targetId, durationSeconds: 30, reason }, { from: quarantine }),
        )
        yield* restore("unlock", act({ type: "unlock", channelId: ids.channelId, reason }, { owner: lock }))
        yield* run("lock", act({ type: "lock", channelId: ids.channelId, reason }, { from: lock }))

        yield* restore("restore defcon", setSettings({ defcon: baseline.defcon }))
        for (const level of [2, 1] as const) {
            yield* run(`set defcon ${level}`, setSettings({ defcon: level }))
            const member: ModerationActor = {
                originServerId: ids.serverId,
                userId: ids.targetId,
                roleIds: [ids.serverId],
                isOwner: false,
                isAdministrator: false,
                nativePermissionAuthorized: false,
            }
            const denied = yield* store.gate({ serverId: ids.serverId, actor: member, command: "public" })
            const critical = yield* store.gate({ serverId: ids.serverId, actor: yield* actor, command: "critical" })
            checks[`defcon ${level} gates`] = denied.defcon === level && !denied.allowed && critical.allowed
        }
    }),
)

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())
const exit = await Effect.runPromiseExit(program, { signal: controller.signal })
console.log(JSON.stringify(checks, undefined, 2))
if (Exit.isFailure(exit)) {
    // Tagged service errors print only their tag, so provider and backend details stay out of the output. The smoke's own failures print their message
    const error = Cause.squash(exit.cause) as { _tag?: string; message?: string } | undefined
    console.error(
        `Smoke stopped: ${error instanceof SmokeLiveError ? error.message : (error?._tag ?? error?.message ?? "interrupted")}`,
    )
}
if (Exit.isFailure(exit) || Object.values(checks).includes(false)) process.exitCode = 1
