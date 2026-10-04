import { isId } from "@neonflux/contracts/common"
import type { ServiceScope } from "@neonflux/contracts/service"

/** The deployment names its one server */
export type DeploymentScope = ServiceScope
export const validServerId = isId

/** The server a message is for. A command in a DM is for the one server. The predicate names the servers this process serves now */
export function selectServerCommand(
    content: string,
    scope: DeploymentScope,
    active: (serverId: string) => boolean,
    guildId?: string,
) {
    const invocation = /^(\s*!([a-z0-9][a-z0-9_-]*))(?=\s|$)/i.exec(content)
    if (!invocation) return guildId && active(guildId) ? guildId : undefined
    const selected = guildId ?? scope.serverIds[0]
    return validServerId(selected) && active(selected) ? selected : undefined
}
