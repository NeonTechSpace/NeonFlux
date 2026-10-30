import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const workspace = join(dirname(fileURLToPath(import.meta.url)), "..")
const oxlint = join(workspace, "node_modules", ".bin", process.platform === "win32" ? "oxlint.cmd" : "oxlint")

// The workspace's Oxlint configuration run over planted files in a copy of the package layout. The boundary rules need no
// type information, so the copy turns it off and needs no tsconfig
function linted(t, files) {
    const folder = mkdtempSync(join(tmpdir(), "neonflux-lint-rules-"))
    t.after(() => rmSync(folder, { recursive: true, force: true }))
    const config = readFileSync(join(workspace, ".oxlintrc.json"), "utf8").replace(
        '"typeAware": true',
        '"typeAware": false',
    )
    writeFileSync(join(folder, ".oxlintrc.json"), config)
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, name)), { recursive: true })
        writeFileSync(join(folder, name), text)
    }
    const result = spawnSync(oxlint, ["-c", ".oxlintrc.json", "--format=unix", "--threads=1", ...Object.keys(files)], {
        cwd: folder,
        encoding: "utf8",
        shell: process.platform === "win32",
    })
    return result.stdout + result.stderr
}
const restricted = (output, file) =>
    output.split("\n").filter((line) => line.startsWith(`${file}:`) && line.includes("no-restricted-imports")).length

test("package boundaries refuse planted imports across packages", (t) => {
    const output = linted(t, {
        "bot/src/plant.ts":
            'import { a } from "../../backend/convex/schema.ts"\nimport { b } from "@neonflux/web/src/x"\nexport const c = [a, b]\n',
        "web/src/plant.ts":
            'import { a } from "@neonflux/backend/convex/schema"\nimport { b } from "../../bot/src/bot.ts"\nexport const c = [a, b]\n',
        "backend/convex/plant.ts": 'import { a } from "../../bot/src/bot.ts"\nexport const c = a\n',
        "contracts/src/plant.ts": 'import { a } from "convex/values"\nexport const c = a\n',
    })
    assert.equal(restricted(output, "bot/src/plant.ts"), 2, output)
    assert.equal(restricted(output, "web/src/plant.ts"), 2, output)
    assert.equal(restricted(output, "backend/convex/plant.ts"), 1, output)
    assert.equal(restricted(output, "contracts/src/plant.ts"), 1, output)
})

test("package boundaries allow the imports each package is meant to use", (t) => {
    const output = linted(t, {
        "bot/src/plant.ts":
            'import { a } from "@neonflux/contracts/common"\nimport { b } from "./backend-http.ts"\nexport const c = [a, b]\n',
        "web/src/plant.ts":
            'import type { A } from "@neonflux/backend/dashboard-contracts"\nimport type { B } from "@neonflux/backend/verification-contracts"\nexport type C = A | B\n',
        "backend/convex/plant.ts":
            'import { a } from "@neonflux/contracts/common"\nimport { b } from "convex/values"\nexport const c = [a, b]\n',
        "contracts/src/plant.ts":
            'import { Schema } from "effect"\nimport { a } from "./common.ts"\nexport const c = [Schema, a]\n',
    })
    for (const file of ["bot/src/plant.ts", "web/src/plant.ts", "backend/convex/plant.ts", "contracts/src/plant.ts"])
        assert.equal(restricted(output, file), 0, output)
})

test("an import cycle between contracts modules fails", (t) => {
    const output = linted(t, {
        "contracts/src/first.ts": 'import { b } from "./second.ts"\nexport const a = () => b\n',
        "contracts/src/second.ts": 'import { a } from "./first.ts"\nexport const b = () => a\n',
    })
    assert.match(output, /contracts\/src\/first\.ts:\d+:\d+: .*no-cycle/)
})

test("an unexplained any or ts comment in source fails, and one in tests passes", (t) => {
    const source = "// @ts-ignore\nexport const a = (value: any) => value\n"
    const output = linted(t, { "bot/src/plant.ts": source, "bot/tests/plant.test.ts": source })
    assert.match(output, /bot\/src\/plant\.ts:\d+:\d+: .*no-explicit-any/)
    assert.match(output, /bot\/src\/plant\.ts:\d+:\d+: .*ban-ts-comment/)
    assert.doesNotMatch(output, /bot\/tests\/plant\.test\.ts:\d+:\d+: .*no-explicit-any/)
})
