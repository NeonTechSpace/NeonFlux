import { snowflakes } from "@neontechspace/fluxerly/effect"

/** Single mode names its one server. Multi mode serves the servers the bot joins, registered through the backend */
export type DeploymentScope = { readonly mode: "single", readonly serverIds: readonly string[] } | { readonly mode: "multi" }
export function validServerId(value: unknown): value is string {
    return typeof value === "string" && /^[1-9]\d*$/.test(value) && snowflakes.isValid(value)
}
export function parseDeploymentScope(environment: Readonly<NodeJS.ProcessEnv>): DeploymentScope {
    const mode = environment.NEONFLUX_SERVER_MODE ?? "single"
    if (mode !== "single" && mode !== "multi") throw new Error("Set NEONFLUX_SERVER_MODE to single or multi")
    if (mode === "single") {
        if (environment.NEONFLUX_SERVER_IDS !== undefined) throw new Error("Remove NEONFLUX_SERVER_IDS in single mode")
        const id = environment.NEONFLUX_SERVER_ID?.trim()
        if (!validServerId(id)) throw new Error("Set NEONFLUX_SERVER_ID to the decimal ID of the server NeonFlux should manage")
        return Object.freeze({ mode, serverIds: Object.freeze([id]) })
    }
    if (environment.NEONFLUX_SERVER_ID !== undefined) throw new Error("Remove NEONFLUX_SERVER_ID in multi mode. Multi mode serves every server the bot joins")
    if (environment.NEONFLUX_SERVER_IDS !== undefined) throw new Error("Remove NEONFLUX_SERVER_IDS. Multi mode registers the servers the bot joins through the backend")
    return Object.freeze({ mode })
}

/** Remove only the reserved prefix, leaving the original quoted command body intact. The predicate names the servers this process serves now */
export function selectServerCommand(content: string, scope: DeploymentScope, active: (serverId: string) => boolean, guildId?: string) {
    const invocation = /^(\s*!([a-z0-9][a-z0-9_-]*))(?=\s|$)/i.exec(content)
    if (!invocation) return guildId && active(guildId) ? { serverId: guildId, content } : undefined
    const tail = content.slice(invocation[0].length)
    const selector = /^\s+--server\s+([^\s]+)(?=\s|$)/.exec(tail)
    const remainder = selector ? tail.slice(selector[0].length) : tail
    // This reserved option cannot occur later or be repeated. Quoted user text is preserved.
    if (hasReservedSelector(remainder) || /^\s+--server(?:\s|$)/.test(tail) && !selector) return { error: "Use --server <serverId> once, immediately after the command name" }
    const selected = selector?.[1] ?? guildId ?? (scope.mode === "single" ? scope.serverIds[0] : undefined)
    if (!validServerId(selected) || !active(selected) || guildId !== undefined && selected !== guildId) return { error: "Select an allowed server immediately after the command name with --server <serverId>" }
    return { serverId: selected, content: selector ? invocation[0] + remainder : content }
}

function hasReservedSelector(source: string) {
    let quote = "", token = "", quoted = false, escaped = false
    for (const character of source + " ") {
        if (escaped) { token += character; escaped = false; continue }
        if (character === "\\") { escaped = true; quoted = true; continue }
        if (quote) { if (character === quote) quote = ""; else token += character; continue }
        if (character === '"' || character === "'") { quote = character; quoted = true; continue }
        if (/\s/.test(character)) { if (!quoted && token === "--server") return true; token = ""; quoted = false }
        else token += character
    }
    return false
}

// Label private replies with their server without rewriting echoed user text.
// Usage text that needs the selector names --server itself
export function serverReply(text: string, serverId: string) {
    return `[Server ${serverId}] ${text}`
}

// Follow-up commands the bot writes into a multi-server reply carry the selector a DM requires.
// Apply only to bot-authored text, never to echoed user content
export function serverOption(config: { serverId: string, scope?: DeploymentScope }) {
    return config.scope?.mode === "multi" ? ` --server ${config.serverId}` : ""
}
export function serverCommands(text: string, config: { serverId: string, scope?: DeploymentScope }) {
    const option = serverOption(config)
    return option ? text.replace(/(^|\s)(![a-z0-9][a-z0-9_-]*)(?![a-z0-9_-])/gi, `$1$2${option}`) : text
}
