import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { withPrefix } from "./general-settings.ts"
import { safetyHelpAll } from "./moderation-command.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { replyText } from "./reply-style.ts"
import { managementHelpAll } from "./response-command.ts"

/**
 * The forms each command's own help leaves out, which `!<command> help all` lists, keyed by the words before help.
 * A command's help shows its most used forms and ends with a line that points here
 */
const moreForms: Readonly<Record<string, readonly string[]>> = {
    custom: managementHelpAll("custom"),
    auto: managementHelpAll("auto"),
    mod: safetyHelpAll.mod,
    automod: safetyHelpAll.automod,
    security: safetyHelpAll.security,
}
/** Forms on one page of `help all` */
const FORMS_PER_PAGE = 10
type HelpAllRequest = { readonly path: string; readonly next: boolean; readonly helpArgs: readonly string[] }
/** `!<command> [words] help all [next]` for a command whose help leaves forms out, with the words that ask for that command's own help */
export function helpAllRequest(name: string | undefined, args: readonly string[]): HelpAllRequest | undefined {
    const at = args.findIndex((arg) => arg.toLowerCase() === "help"),
        rest = args.slice(at + 2)
    const path = [name, ...args.slice(0, at)].join(" ").toLowerCase()
    if (
        !name ||
        at < 0 ||
        args[at + 1]?.toLowerCase() !== "all" ||
        !Object.hasOwn(moreForms, path) ||
        rest.length > 1 ||
        (rest.length === 1 && rest[0]!.toLowerCase() !== "next")
    )
        return undefined
    return { path, next: rest.length === 1, helpArgs: args.slice(0, at + 1) }
}
/** One page of the forms a command's help leaves out */
export function handleHelpAll(
    config: { readonly serverId: string },
    prefix: string,
    request: HelpAllRequest,
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        const forms = moreForms[request.path]!,
            start = `!${request.path} help all`,
            key = pageKey(config.serverId, context.message, "help", request.path)
        const page = request.next ? nextPosition<number>(key) : 0
        const more = page !== undefined && (page + 1) * FORMS_PER_PAGE < forms.length
        if (page !== undefined) rememberPosition(key, more ? page + 1 : undefined)
        const lines =
            page === undefined
                ? [noNextPage(start)]
                : [
                      ...forms.slice(page * FORMS_PER_PAGE, (page + 1) * FORMS_PER_PAGE),
                      ...(more ? [`Send ${start} next for more`] : []),
                  ]
        const text = withPrefix(lines.join("\n"), prefix)
        yield* replyText(context, text)
    })
}
