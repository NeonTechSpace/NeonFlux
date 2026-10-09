import { Cause, Effect, type Context, type Scope } from "effect"

/** Runs an effect to completion, turning any failure but an interruption into a logged warning */
export const contained = <A, E, R>(effect: Effect.Effect<A, E, R>, warning: string) =>
    effect.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(warning),
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
