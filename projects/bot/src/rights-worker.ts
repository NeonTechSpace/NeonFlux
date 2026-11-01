import { defaultRightsSettings, type RightsSettings } from "@neonflux/contracts/rights"
import { Effect, type Scope } from "effect"
import { contained } from "./contained.ts"
import { forgetRights, rememberRights, rightsRuntimes, type RightsRuntime } from "./rights-memory.ts"
import type { RightsStore } from "./rights-store.ts"

/**
 * One server's bot-only rights in memory. The settings load once when the server starts, so an ordinary message or event costs no backend
 * call, and a server with rights off spends nothing when anti-nuke fires
 */
export function createRights(store: RightsStore, serverId: string, notify: () => Effect.Effect<void>) {
    let settings: RightsSettings = defaultRightsSettings(),
        loaded = false
    const apply = (next: RightsSettings) => {
        settings = next
        loaded = true
        rememberRights(serverId, next)
    }
    const load = Effect.suspend(() => store.get({ serverId })).pipe(
        Effect.tap((result) => Effect.sync(() => apply(result.settings))),
        Effect.asVoid,
    )
    const runtime: RightsRuntime & { start: () => Effect.Effect<void, never, Scope.Scope> } = {
        start: () =>
            Effect.gen(function* () {
                rightsRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (rightsRuntimes.get(serverId) === runtime) rightsRuntimes.delete(serverId)
                        forgetRights(serverId)
                    }),
                )
                yield* Effect.forkScoped(
                    contained(load, "Bot-only rights could not be loaded. Help leaves them out until a reload"),
                )
            }),
        changed: (next) => Effect.sync(() => apply(next)),
        reload: () => contained(load, "Bot-only rights could not be refreshed"),
        notify,
        // Settings that could not load still suspend, since the backend knows whether rights are on
        antiNukeFired: (userId) =>
            loaded && !settings.enabled
                ? Effect.void
                : contained(
                      store
                          .suspend({ serverId, userId })
                          .pipe(Effect.flatMap((result) => (result.admitted ? notify() : Effect.void))),
                      "A member's bot-only rights could not be suspended after anti-nuke fired",
                  ),
    }
    return runtime
}
