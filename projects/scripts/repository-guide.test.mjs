import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scan = fileURLToPath(new URL("./repository-guide.mjs", import.meta.url))
const guide = (extra = "") =>
    `# Guide\n\n- [paging.ts](../projects/bot/src/paging.ts) pages lists\n\n| Feature | Bot \`src/\` prefix | Backend \`convex/\` prefix | Contracts |\n| --- | --- | --- | --- |\n| Tickets | \`ticket\`, \`tickets\` | \`ticket\` | \`tickets\` |\n${extra}\nAfter the table\n`

// A throwaway repository with the given files, and the scan's exit code and output for it
function scanned(t, files) {
    const folder = mkdtempSync(join(tmpdir(), "neonflux-repository-guide-"))
    t.after(() => rmSync(folder, { recursive: true, force: true }))
    spawnSync("git", ["init", "-q"], { cwd: folder })
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, name)), { recursive: true })
        writeFileSync(join(folder, name), text)
    }
    const result = spawnSync(process.execPath, [scan, folder], { encoding: "utf8" })
    return { code: result.status, output: result.stdout + result.stderr }
}
const sources = {
    "projects/bot/src/paging.ts": "",
    "projects/bot/src/ticket-command.ts": "",
    "projects/bot/src/tickets.ts": "",
    "projects/backend/convex/ticketLifecycle.ts": "",
    "projects/backend/convex/tickets.ts": "",
    "projects/backend/convex/_generated/api.d.ts": "",
}

test("files found by a link or a feature prefix pass", (t) => {
    const { code, output } = scanned(t, { "docs/REPOSITORY.md": guide(), ...sources })
    assert.equal(code, 0, output)
})

test("a file the guide cannot find and a prefix with no file fail", (t) => {
    const { code, output } = scanned(t, {
        "docs/REPOSITORY.md": guide("| Voice | `voice` | `ticket` | `voice` |\n"),
        ...sources,
        "projects/bot/src/stray.ts": "",
        "projects/backend/convex/ticketing.ts": "",
    })
    assert.equal(code, 1)
    assert.match(output, /projects\/bot\/src\/stray\.ts is neither linked/)
    assert.match(output, /projects\/backend\/convex\/ticketing\.ts is neither linked/)
    assert.match(output, /names the bot prefix voice, which no file has/)
})
