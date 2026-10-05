import { runBot } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { createBotOptions } from "./bot.ts"
import { readConfig } from "./config.ts"
import { adoptBackendScope } from "./server-runtime.ts"

// The backend's scope decides the bot's sizing and routing, so it is adopted before the bot options are built
const program = readConfig(process.env).pipe(
    Effect.flatMap(adoptBackendScope),
    Effect.matchEffect({
        onFailure: (error) => Effect.sync(() => {
            console.error(error.message)
            process.exitCode = 1
        }),
        onSuccess: (config) => runBot(createBotOptions(config)),
    }),
)

await Effect.runPromiseExit(program)
