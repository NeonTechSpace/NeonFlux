import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scan = fileURLToPath(new URL("./doc-links.mjs", import.meta.url))

// A throwaway repository with the given files, and the scan's exit code and output for it
function scanned(t, files) {
    const folder = mkdtempSync(join(tmpdir(), "neonflux-doc-links-"))
    t.after(() => rmSync(folder, { recursive: true, force: true }))
    spawnSync("git", ["init", "-q"], { cwd: folder })
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, name)), { recursive: true })
        writeFileSync(join(folder, name), text)
    }
    const result = spawnSync(process.execPath, [scan, folder], { encoding: "utf8" })
    return { code: result.status, output: result.stdout + result.stderr }
}

const guide = "# Guide\n\n## Set up `!ping` here\n\n## Notes\n\n## Notes\n"

test("links to existing files and headings pass, including code, repeated headings and folders", (t) => {
    const { code, output } = scanned(t, {
        "docs/GUIDE.md": guide,
        "src/app.ts": "",
        "docs/README.md":
            "[Guide](GUIDE.md) [ping](GUIDE.md#set-up-ping-here) [second](GUIDE.md#notes-1) [own](#readme) [app](../src/app.ts) [src](../src/) [site](https://example.com/x)\n\n# Readme\n\n```md\n[example](missing.md)\n```\n\n`[inline](missing.md)`\n",
    })
    assert.equal(code, 0, output)
})

test("a missing file or heading fails with its file and line", (t) => {
    const { code, output } = scanned(t, {
        "docs/GUIDE.md": guide,
        "docs/README.md": "# Readme\n\n[gone](OLD.md)\n[bad](GUIDE.md#setup)\n[third](GUIDE.md#notes-2)\n",
    })
    assert.equal(code, 1)
    assert.match(output, /docs\/README\.md:3: OLD\.md names a missing file/)
    assert.match(output, /docs\/README\.md:4: GUIDE\.md#setup names a missing heading/)
    assert.match(output, /docs\/README\.md:5: GUIDE\.md#notes-2 names a missing heading/)
})

test("a folder without Markdown files fails instead of passing", (t) => {
    const { code } = scanned(t, { "a.txt": "x" })
    assert.equal(code, 2)
})
