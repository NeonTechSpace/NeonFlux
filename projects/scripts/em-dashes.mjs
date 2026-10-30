// Fails when a tracked or new text file of the repository holds an em dash, and names each one by file, line and column.
// Repository prose uses no em dashes. An empty file list fails too, so a broken scan cannot pass.
// Usage: node scripts/em-dashes.mjs [folder], where the folder defaults to the current one and git decides which files count
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const dash = String.fromCharCode(0x2014)
const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|bin|zip|gz|tgz|pdf|wasm|mp4|webm)$/i

const folder = resolve(process.argv[2] ?? ".")
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: folder,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
})
    .split("\0")
    .filter((file) => file !== "" && !binary.test(file))
if (files.length === 0) {
    console.error(`No files to check in ${folder}`)
    process.exit(2)
}

const found = []
for (const file of files) {
    let text
    try {
        text = readFileSync(resolve(folder, file), "utf8")
    } catch (error) {
        // A file deleted from the working tree but still tracked has nothing left to check
        if (error.code === "ENOENT") continue
        throw error
    }
    if (text.includes("\0") || !text.includes(dash)) continue
    text.split("\n").forEach((line, index) => {
        for (let column = line.indexOf(dash); column !== -1; column = line.indexOf(dash, column + 1))
            found.push(`${file}:${index + 1}:${column + 1}`)
    })
}
if (found.length > 0) {
    console.error(`Em dashes found. Rephrase with a comma, colon, parentheses or two sentences:\n${found.join("\n")}`)
    process.exit(1)
}
console.log(`No em dashes in ${files.length} files`)
