import type { BackupCategory } from "@neonflux/contracts/backup"
export const backupHelp = ["!backup export config xp structure: Save the parts you name to an encrypted file", "!backup inspect: Check an attached backup file",
    "!backup preview [next]: With a file attached, see what a restore would do, changing nothing", "!backup plan: With a file attached, plan a restore you can run for 15 minutes",
    "!backup confirm: Run up to 20 steps of your latest plan. Send it again for the rest", "!backup status | items [next]: How your latest plan is going, and its steps",
    "!backup reconcile: Check steps that were not confirmed", "!backup forget: Drop your latest plan. What it created stays", "Only the server owner can back up, in a DM with NeonFlux"].join("\n")
export type BackupCommand = { type: "help" | "inspect" | "plan" | "status" | "confirm" | "reconcile" | "forget" } | { type: "preview" | "items", next?: true } | { type: "export", selected: BackupCategory[] } | { error: string }
export function parseBackupCommand(args: readonly string[]): BackupCommand {
    const [type, ...rest] = args
    if ((!type || type === "help") && !rest.length) return { type: "help" }
    // A restore plan is never typed. Status, items, confirm, reconcile and forget work on the plan the bot showed this owner last
    if ((type === "inspect" || type === "plan" || type === "status" || type === "confirm" || type === "reconcile" || type === "forget") && !rest.length) return { type }
    if ((type === "preview" || type === "items") && (!rest.length || rest.length === 1 && rest[0] === "next")) return { type, ...(rest.length ? { next: true } : {}) }
    if (type === "export" && rest.length > 0 && rest.length <= 3 && new Set(rest).size === rest.length && rest.every(v => ["config", "xp", "structure"].includes(v))) return { type, selected: rest as BackupCategory[] }
    return { error: "Invalid backup command. Use !backup help privately. Keys, pasted URLs and filesystem paths are never accepted" }
}
