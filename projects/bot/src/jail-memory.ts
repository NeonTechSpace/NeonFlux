import { defaultJailSettings, type JailSettings } from "@neonflux/contracts/jail"
import { Effect } from "effect"

// Who is jailed on each running server, so a join or member update costs no backend call. Two sets, since they answer different questions.
// jailed is who NeonFlux sets back to the jail role: From a confirmed jail until the release is sent, so a jail with an unknown outcome never
// sends its edit again. confined is who the command gate and channel writes treat as jailed: Everyone with a record, doubts included

type Memory = { settings: JailSettings; jailed: Set<string>; confined: Set<string>; staffChanged?: Effect.Effect<void> }
const servers = new Map<string, Memory>()
export const rememberJail = (
    serverId: string,
    settings: JailSettings,
    jailedIds: readonly string[],
    confinedIds: readonly string[],
) => {
    const staffChanged = servers.get(serverId)?.staffChanged
    servers.set(serverId, {
        settings,
        jailed: new Set(jailedIds),
        confined: new Set(confinedIds),
        ...(staffChanged ? { staffChanged } : {}),
    })
}
export const rememberJailSettings = (serverId: string, settings: JailSettings) => {
    const memory = servers.get(serverId)
    if (memory) memory.settings = settings
    else servers.set(serverId, { settings, jailed: new Set(), confined: new Set() })
}
export const forgetJail = (serverId: string) => void servers.delete(serverId)
export const jailSettingsOf = (serverId: string): JailSettings =>
    servers.get(serverId)?.settings ?? defaultJailSettings()
/** What runs when the moderation staff change, since they may read the jail channel */
export const onJailStaffChange = (serverId: string, staffChanged: Effect.Effect<void>) => {
    const memory = servers.get(serverId)
    if (memory) memory.staffChanged = staffChanged
    else
        servers.set(serverId, { settings: defaultJailSettings(), jailed: new Set(), confined: new Set(), staffChanged })
}
export const jailStaffChanged = (serverId: string) => servers.get(serverId)?.staffChanged ?? Effect.void
export const isJailed = (serverId: string, userId: string) => servers.get(serverId)?.jailed.has(userId) === true
export const isConfined = (serverId: string, userId: string) => servers.get(serverId)?.confined.has(userId) === true
export const anyoneJailed = (serverId: string) => (servers.get(serverId)?.confined.size ?? 0) > 0
/** A confirmed jail, or a read that shows one */
export const holdJailed = (serverId: string, userId: string) => {
    servers.get(serverId)?.jailed.add(userId)
    servers.get(serverId)?.confined.add(userId)
}
/** A jail or release whose outcome is unknown: Nothing sends an edit, and the member stays behind the command gate */
export const confineOnly = (serverId: string, userId: string) => {
    servers.get(serverId)?.jailed.delete(userId)
    servers.get(serverId)?.confined.add(userId)
}
/** The release is about to be sent, so the member update its edit causes is no role to take back. They stay behind the command gate */
export const stopHolding = (serverId: string, userId: string) => void servers.get(serverId)?.jailed.delete(userId)
/** A confirmed release, a jail that failed, or a read that shows no jail */
export const letJailedGo = (serverId: string, userId: string) => {
    servers.get(serverId)?.jailed.delete(userId)
    servers.get(serverId)?.confined.delete(userId)
}
