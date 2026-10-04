import type { GreetingsRoute } from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type GreetingsCommand =
    | { type: "help", route: GreetingsRoute }
    | { type: "configure", route: GreetingsRoute, templateName: string, channelId?: string, timing: "join" | "verified" }
    | { type: "module", route: GreetingsRoute, enabled: boolean }
    | { type: "clear", route: GreetingsRoute }
    | { type: "preview", route: GreetingsRoute }
    | { type: "query", route: GreetingsRoute, operation: { type: "settings" } | { type: "delivery", deliveryNo: number } | { type: "member", userId: string } | { type: "deliveries", beforeDeliveryNo?: number } }
    | { type: "settings", route: GreetingsRoute, claimsPerMinute?: number, retentionDays?: number }

export function greetingsHelp(route: GreetingsRoute) {
    const prefix = route === "dm" ? "!welcome dm" : route === "welcome" ? "!welcome" : "!goodbye"
    return [
        `${prefix} configure <template-name>${route === "dm" ? "" : " #channel"}${route === "goodbye" ? "" : " join|verified"}`,
        `${prefix} module on|off | clear | preview | show | status [delivery-number] | history [before-delivery] | member @user | help`,
        "!welcome rate <1..60> | retention <30..3650> (Shared delivery budget and history retention)",
        "Compose reusable rich templates with !publish template. Configuration copies the selected revision",
        "Text placeholders: {user.name}, {user.mention}, {user.id}, {server.name}, {server.id}, {channel.id} (Channel routes only)",
        "Preview uses the invoking administrator in the current channel. Unknown sends never replay",
    ].join("\n")
}

export function parseGreetingsCommand(name: "welcome" | "goodbye", input: readonly string[]): GreetingsCommand | { error: string } {
    const args = [...input]
    let route: GreetingsRoute = name === "goodbye" ? "goodbye" : "welcome"
    if (name === "welcome" && args[0]?.toLowerCase() === "dm") { route = "dm"; args.shift() }
    const verb = args[0]?.toLowerCase() ?? "show"
    const failure = () => ({ error: `Check quoting and syntax. Use ${route === "dm" ? "!welcome dm" : `!${name}`} help for examples` })
    if (verb === "help" && args.length <= 1) return { type: "help", route }
    if ((verb === "show" || verb === "status") && args.length <= 1) return { type: "query", route, operation: { type: "settings" } }
    const number = args[1] && /^[1-9]\d*$/.test(args[1]) && Number.isSafeInteger(Number(args[1])) ? Number(args[1]) : undefined
    if (verb === "status" && args.length === 2 && number) return { type: "query", route, operation: { type: "delivery", deliveryNo: number } }
    if (verb === "member" && args.length === 2) {
        const userId = commandId(args[1])
        if (userId) return { type: "query", route, operation: { type: "member", userId } }
    }
    if (verb === "history" && args.length <= 2 && (args[1] === undefined || number)) return { type: "query", route,
        operation: { type: "deliveries", ...(number ? { beforeDeliveryNo: number } : {}) } }
    if (verb === "preview" && args.length === 1) return { type: "preview", route }
    if (verb === "clear" && args.length === 1) return { type: "clear", route }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "module", route, enabled: args[1] === "on" }
    if ((verb === "rate" || verb === "retention") && name === "welcome" && route === "welcome" && args.length === 2 && /^[1-9]\d*$/.test(args[1]!)) {
        const value = Number(args[1])
        if (Number.isSafeInteger(value) && (verb === "rate" ? value <= 60 : value >= 30 && value <= 3650)) return { type: "settings", route,
            ...(verb === "rate" ? { claimsPerMinute: value } : { retentionDays: value }) }
    }
    if (verb === "configure" && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(args[1] ?? "")) {
        const channelId = route === "dm" ? undefined : commandId(args[2])
        const timing = route === "goodbye" ? "join" : args[route === "dm" ? 2 : 3]
        const length = route === "dm" || route === "goodbye" ? 3 : 4
        if (args.length === length && (route === "dm" || channelId) && (timing === "join" || timing === "verified")) return {
            type: "configure", route, templateName: args[1]!.toLowerCase(), timing, ...(channelId ? { channelId } : {}),
        }
    }
    return failure()
}

export function greetingsCritical(command: GreetingsCommand | { error: string }) {
    return !("error" in command) && (command.type === "query" || command.type === "help" || command.type === "clear" || command.type === "module" && !command.enabled)
}
