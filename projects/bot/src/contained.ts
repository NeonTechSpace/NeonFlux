import { Cause, Effect, type Context, type Scope } from "effect"
import { codes, errorTags, operations, outcomes, reasons, routes, sdkErrorTags, stages } from "./cause-fields.ts"

// The fields of a failure that say what failed, each kept only when its value is one cause-fields.ts lists or an HTTP status
const known = (values: ReadonlySet<string>) => (value: unknown) =>
    typeof value === "string" && values.has(value) ? value : undefined
const causeFields: Record<string, (value: unknown) => string | number | undefined> = {
    code: known(codes),
    status: (value) =>
        Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined,
    stage: known(stages),
    operation: known(operations),
    route: known(routes),
    reason: known(reasons),
    outcome: known(outcomes),
}
const failureName = (error: unknown) => {
    if (typeof error !== "object" || error === null) return typeof error
    const tag = (error as { _tag?: unknown })._tag,
        name = error.constructor?.name
    return known(errorTags)(tag) ?? known(errorTags)(name) ?? "unknown"
}

/**
 * A short summary of why work failed, as log annotations: The failure's tag or class, whether it was a defect, and its code,
 * status, stage, operation, route, reason and outcome, except that an SDK error has no operation. Each is kept only when it
 * is a known name from cause-fields.ts or an HTTP status, and an unknown class is named unknown. It never holds a message, a
 * body or any other field, so no token, message text or member name reaches the log. It takes a Cause or a failure
 */
export function causeSummary(failure: unknown): Record<string, string | number | boolean> {
    try {
        const cause = Cause.isCause(failure) ? failure : Cause.fail(failure),
            error = Cause.squash(cause)
        const summary: Record<string, string | number | boolean> = {
            "cause.error": failureName(error),
            "cause.defect": !Cause.hasFails(cause) && Cause.hasDies(cause),
        }
        if (typeof error === "object" && error !== null) {
            // An SDK error keeps its tag, status, reason and outcome, but not which SDK method it came from
            const sdk = sdkErrorTags.has(String((error as { _tag?: unknown })._tag))
            for (const [field, keep] of Object.entries(causeFields)) {
                if (sdk && field === "operation") continue
                const value = keep((error as Record<string, unknown>)[field])
                if (value !== undefined) summary[`cause.${field}`] = value
            }
        }
        return summary
    } catch {
        // A failure whose fields cannot be read is named only as unknown
        return { "cause.error": "unknown" }
    }
}

/** Logs a warning with the summary of the failure behind it */
export const warnFailure = (warning: string, failure: unknown) =>
    Effect.logWarning(warning).pipe(Effect.annotateLogs(causeSummary(failure)))

/** Runs an effect to completion, turning any failure but an interruption into a logged warning */
export const contained = <A, E, R>(effect: Effect.Effect<A, E, R>, warning: string) =>
    effect.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause) ? Effect.failCause(cause) : warnFailure(warning, cause),
        ),
    )

/** Starts a contained effect in the runtime's scope with its services, or detached before the runtime started */
export const forkContained = <E, R>(
    effect: Effect.Effect<void, E, R>,
    warning: string,
    scope: Scope.Scope | undefined,
    services: Context.Context<never> | undefined,
) => {
    const work = services ? Effect.provideContext(contained(effect, warning), services) : contained(effect, warning)
    return Effect.asVoid(scope ? Effect.forkIn(work, scope) : Effect.forkDetach(work))
}
