// Fails when a source file of the bot or the backend cannot be found from the repository guide, and when the guide's
// feature table names a file prefix that no file has. A file is found when the guide links it or when its name starts with
// a prefix from the feature table: a bot file is the prefix, its plural or the prefix and a hyphen, and a backend file is
// the prefix, its plural or the prefix and an uppercase letter.
// Usage: node scripts/repository-guide.mjs [repository], where the repository defaults to the parent folder
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(process.argv[2] ?? "..")
const guide = readFileSync(join(root, "docs", "REPOSITORY.md"), "utf8")
const table = guide.slice(guide.indexOf("| Feature | Bot"))
const prefixes = { bot: new Set(), backend: new Set() }
for (const row of table.split("\n").slice(2)) {
    if (!row.startsWith("|")) break
    const cells = row.split("|")
    for (const [, prefix] of cells[2].matchAll(/`([^`]+)`/g)) prefixes.bot.add(prefix)
    for (const [, prefix] of cells[3].matchAll(/`([^`]+)`/g)) prefixes.backend.add(prefix)
}
if (prefixes.bot.size === 0 || prefixes.backend.size === 0) {
    console.error("The feature table of docs/REPOSITORY.md was not found")
    process.exit(2)
}
const tracked = (folder) =>
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", folder], {
        cwd: root,
        encoding: "utf8",
    })
        .split("\0")
        .filter((file) => /\.tsx?$/.test(file))
const name = (file) =>
    file
        .split("/")
        .pop()
        .replace(/(\.d)?\.tsx?$/, "")
const fits = {
    bot: (file, prefix) => [prefix, `${prefix}s`].includes(name(file)) || name(file).startsWith(`${prefix}-`),
    backend: (file, prefix) =>
        [prefix, `${prefix}s`].includes(name(file)) || new RegExp(`^${prefix}[A-Z]`).test(name(file)),
}
const sources = {
    bot: tracked("projects/bot/src"),
    backend: tracked("projects/backend/convex").filter((file) => !file.includes("/_generated/")),
}
const problems = []
for (const side of ["bot", "backend"]) {
    for (const file of sources[side])
        if (!guide.includes(`(../${file})`) && ![...prefixes[side]].some((prefix) => fits[side](file, prefix)))
            problems.push(
                `${file} is neither linked from docs/REPOSITORY.md nor named by a prefix of its feature table`,
            )
    for (const prefix of prefixes[side])
        if (!sources[side].some((file) => fits[side](file, prefix)))
            problems.push(`The feature table names the ${side} prefix ${prefix}, which no file has`)
}
if (problems.length > 0) {
    console.error(`The repository guide is out of date:\n${problems.join("\n")}`)
    process.exit(1)
}
console.log(`docs/REPOSITORY.md finds all ${sources.bot.length + sources.backend.length} bot and backend source files`)
