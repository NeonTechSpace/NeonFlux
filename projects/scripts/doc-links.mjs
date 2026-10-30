// Fails when a Markdown file of the repository links to a local file that does not exist or to a heading that is missing.
// Links to other sites are not fetched. Headings become anchors the way GitHub makes them. An empty file list fails too.
// Usage: node scripts/doc-links.mjs [folder], where the folder defaults to the current one and git decides which files count
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const folder = resolve(process.argv[2] ?? ".")
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.md"], {
    cwd: folder,
    encoding: "utf8",
})
    .split("\0")
    .filter(Boolean)
if (files.length === 0) {
    console.error(`No Markdown files to check in ${folder}`)
    process.exit(2)
}

// Code blocks hold examples, not headings or links, and inline code holds no links
const blocks = (text) => text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
const prose = (text) => blocks(text).replace(/`[^`\n]*`/g, "")
const anchors = new Map()
function anchorsOf(file) {
    let found = anchors.get(file)
    if (found) return found
    found = new Set()
    const seen = new Map()
    for (const [, heading] of blocks(readFileSync(file, "utf8")).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
        const base = heading
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s/g, "-")
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        found.add(count ? `${base}-${count}` : base)
    }
    anchors.set(file, found)
    return found
}

const broken = []
for (const file of files) {
    const path = join(folder, file)
    if (!existsSync(path)) continue
    const lines = prose(readFileSync(path, "utf8")).split("\n")
    lines.forEach((line, index) => {
        for (const [, target] of line.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
            if (/^[a-z][a-z+.-]*:/i.test(target)) continue
            const [pathPart, anchor] = target.split("#", 2)
            const linked = pathPart ? resolve(dirname(path), decodeURIComponent(pathPart)) : path
            const where = `${file}:${index + 1}`
            if (!existsSync(linked)) broken.push(`${where}: ${target} names a missing file`)
            else if (
                anchor &&
                !statSync(linked).isDirectory() &&
                linked.endsWith(".md") &&
                !anchorsOf(linked).has(anchor)
            )
                broken.push(`${where}: ${target} names a missing heading`)
        }
    })
}
if (broken.length > 0) {
    console.error(`Broken documentation links:\n${broken.join("\n")}`)
    process.exit(1)
}
console.log(`Links in ${files.length} Markdown files resolve`)
