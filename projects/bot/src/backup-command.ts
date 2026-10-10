import type { BackupBinding, BackupCategory } from "@neonflux/backend/contracts"
export const backupHelp = ["Private server Owner commands:", "!backup export config xp structure (select categories explicitly)", "!backup inspect | plan (attach exactly one encrypted .nfb archive)", "!backup preview [page] (attach an archive to see what a restore would do now, changing nothing, or page the latest preview)", "!backup confirm <planID> <planHash> <archiveDigest>", "!backup status [<planID> <planHash> <archiveDigest>]", "!backup reconcile | forget <planID> <planHash> <archiveDigest>", "Confirmation executes at most 20 items. Repeat the same confirmation for remaining work within its 15-minute expiry. Restored automation stays disabled", "Recovery keys belong in bot configuration and protected offline storage, never commands"].join("\n")
export type BackupCommand = { type: "help" | "inspect" | "plan" } | { type: "preview", page: number } | { type: "export", selected: BackupCategory[] } | { type: "status", binding?: BackupBinding } | { type: "confirm" | "reconcile" | "forget", binding: BackupBinding } | { error: string }
export function parseBackupCommand(args: readonly string[]): BackupCommand {
    const [type, ...rest] = args
    if ((!type || type === "help") && !rest.length) return { type: "help" }
    if ((type === "inspect" || type === "plan") && !rest.length) return { type }
    // A preview has at most 500 items in pages of 25
    if (type === "preview" && rest.length <= 1 && (!rest.length || /^(?:[1-9]|1\d|20)$/.test(rest[0]!))) return { type, page: rest.length ? Number(rest[0]) : 1 }
    if (type === "export" && rest.length > 0 && rest.length <= 3 && new Set(rest).size === rest.length && rest.every(v => ["config", "xp", "structure"].includes(v))) return { type, selected: rest as BackupCategory[] }
    if (type === "status" && !rest.length) return { type }
    if (["status", "confirm", "reconcile", "forget"].includes(type ?? "") && rest.length === 3 && /^[a-zA-Z0-9_-]{1,256}$/.test(rest[0]!) && rest.slice(1).every(v => /^[a-f0-9]{64}$/.test(v))) return { type: type as "status" | "confirm" | "reconcile" | "forget", binding: { planId: rest[0]!, revision: 1, planHash: rest[1]!, archiveDigest: rest[2]! } }
    return { error: "Invalid backup command. Use !backup help privately. Keys, pasted URLs and filesystem paths are never accepted" }
}
