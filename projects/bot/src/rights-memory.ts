import { defaultRightsSettings, rightsOfRoles, type BotRight, type RightsSettings } from "@neonflux/contracts/rights"
import type { Effect } from "effect"
import type { RightsStoreError } from "./rights-store.ts"

// What a server's bot-only rights are, loaded once when the server starts, so help and a purge's first step cost no backend call. This
// memory only chooses what to show and whether to go on. The backend decides every action from the stored grants, so a stale copy grants nothing

const off = defaultRightsSettings()
const servers = new Map<string, RightsSettings>()
export const rememberRights = (serverId: string, settings: RightsSettings) => void servers.set(serverId, settings)
export const forgetRights = (serverId: string) => void servers.delete(serverId)
export const serverRights = (serverId: string) => servers.get(serverId) ?? off
/** The rights these roles hold on this server, as far as memory knows */
export const rightsHeldBy = (serverId: string, roleIds: readonly string[]): readonly BotRight[] =>
    rightsOfRoles(serverRights(serverId), roleIds)
/** The roles that hold any right, which anti-nuke's strip takes along with the dangerous ones */
export const rightRoleIds = (serverId: string): readonly string[] => {
    const settings = serverRights(serverId)
    return settings.enabled ? settings.grants.map((grant) => grant.roleId) : []
}
/** What other features need of a running server's rights */
export interface RightsRuntime {
    readonly changed: (settings: RightsSettings) => Effect.Effect<void>
    readonly reload: () => Effect.Effect<void, RightsStoreError>
    /** A security record waits for delivery */
    readonly notify: () => Effect.Effect<void>
    /** Anti-nuke fired on this account, in dry-run too, since a refused bot action hurts nothing */
    readonly antiNukeFired: (userId: string) => Effect.Effect<void, RightsStoreError>
}
export const rightsRuntimes = new Map<string, RightsRuntime>()
