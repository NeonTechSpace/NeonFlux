import { CommandRulesState, type CommandRulesManageRequest } from "@neonflux/contracts/command-rules"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class CommandRulesStoreError extends Data.TaggedError("CommandRulesStoreError")<{
    readonly status: number | null
}> {}
export interface CommandRulesStore {
    manage(input: CommandRulesManageRequest): Effect.Effect<CommandRulesState, CommandRulesStoreError>
}
export function createCommandRulesStore(config: BackendConfig): CommandRulesStore {
    const request = createBackendRequest(config)
    return {
        manage: (input) =>
            request("/commands/manage", input).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(CommandRulesState, { onExcessProperty: "error" })),
                Effect.mapError(
                    (error) =>
                        new CommandRulesStoreError({
                            status: "status" in error && typeof error.status === "number" ? error.status : null,
                        }),
                ),
            ),
    }
}
