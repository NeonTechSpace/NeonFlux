import { runBot } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { createBotOptions } from "./bot.ts"
import { readConfig } from "./config.ts"

const program = readConfig(process.env).pipe(
    Effect.matchEffect({
        onFailure: (error) => Effect.sync(() => {
            console.error(error.message)
            process.exitCode = 1
        }),
        onSuccess: (config) => runBot(createBotOptions(config)),
    }),
)

await Effect.runPromiseExit(program)
