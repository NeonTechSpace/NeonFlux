import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scan = fileURLToPath(new URL("./em-dashes.mjs", import.meta.url))
const dash = String.fromCharCode(0x2014)

// A throwaway repository with the given files, and the scan's exit code and output for it
function scanned(t, files) {
    const folder = mkdtempSync(join(tmpdir(), "neonflux-em-dashes-"))
    t.after(() => rmSync(folder, { recursive: true, force: true }))
    spawnSync("git", ["init", "-q"], { cwd: folder })
    for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text)
    const result = spawnSync(process.execPath, [scan, folder], { encoding: "utf8" })
    return { code: result.status, output: result.stdout + result.stderr }
}

test("an em dash in a new file fails with its file, line and column, once per dash", (t) => {
    const { code, output } = scanned(t, { "clean.md": "Plain text\n", "notes.md": `First\nA ${dash} B ${dash} C\n` })
    assert.equal(code, 1)
    assert.match(output, /notes\.md:2:3\n/)
    assert.match(output, /notes\.md:2:7/)
    assert.doesNotMatch(output, /clean\.md/)
})

test("ignored files are not checked and files without dashes pass", (t) => {
    const { code, output } = scanned(t, { ".gitignore": "private.txt\n", "private.txt": dash, "readme.md": "Fine\n" })
    assert.equal(code, 0, output)
    assert.match(output, /No em dashes in 2 files/)
})

test("a folder with no files to check fails instead of passing", (t) => {
    const { code, output } = scanned(t, {})
    assert.equal(code, 2)
    assert.match(output, /No files to check/)
})
