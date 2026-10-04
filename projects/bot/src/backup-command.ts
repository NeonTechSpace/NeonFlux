import type { BackupCategory } from "@neonflux/contracts/backup"
export const backupHelp = [
    "!backup export config xp structure: Save the parts you name to an encrypted file",
    "!backup inspect: Check an attached backup file",
    "!backup preview [next|match]: With a file attached, check what a restore would change and make the plan you can run for 15 minutes. Match also deletes the channels and categories the backup does not hold",
    "!backup plan: The same as preview",
    "!backup confirm: Run up to 20 steps of your latest plan. Send it again for the rest",
    "!backup status | items [next]: How your latest plan is going, and its steps",
    "!backup reconcile: Check steps that were not confirmed",
    "!backup forget: Drop your latest plan. What it created stays",
    "Only the server owner can back up, in a DM with NeonFlux",
].join("\n")
export type BackupCommand =
    | { type: "help" | "inspect" | "status" | "confirm" | "reconcile" | "forget" }
    | { type: "preview"; next?: true; match?: true }
    | { type: "items"; next?: true }
    | { type: "export"; selected: BackupCategory[] }
    | { error: string }
export function parseBackupCommand(args: readonly string[]): BackupCommand {
    // A preview and a plan are the same thing, so plan is another word for preview
    const [word, ...rest] = args,
        type = word === "plan" ? "preview" : word
    if ((!type || type === "help") && !rest.length) return { type: "help" }
    // match also deletes what the backup does not hold
    if (type === "preview" && rest.length === 1 && rest[0] === "match") return { type: "preview", match: true }
    // A restore plan is never typed. Status, items, confirm, reconcile and forget work on the plan the bot showed this owner last
    if (
        (type === "inspect" || type === "status" || type === "confirm" || type === "reconcile" || type === "forget") &&
        !rest.length
    )
        return { type }
    if ((type === "preview" || type === "items") && (!rest.length || (rest.length === 1 && rest[0] === "next")))
        return { type, ...(rest.length ? { next: true } : {}) }
    if (
        type === "export" &&
        rest.length > 0 &&
        rest.length <= 3 &&
        new Set(rest).size === rest.length &&
        rest.every((v) => ["config", "xp", "structure"].includes(v))
    )
        return { type, selected: rest as BackupCategory[] }
    return {
        error: "Invalid backup command. Use !backup help privately. Keys, pasted URLs and filesystem paths are never accepted",
    }
}
