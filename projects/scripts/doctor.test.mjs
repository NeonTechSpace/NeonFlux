import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { runDoctor } from "./doctor.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const dash = String.fromCharCode(0x2014)

function write(root, rel, content) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
}

function makeHealthyRepo() {
    const root = mkdtempSync(join(tmpdir(), "neonflux-doctor-"))
    write(root, "projects/.node-version", "26.13.1\n")
    write(root, "projects/package.json", JSON.stringify({ name: "neonflux", packageManager: "pnpm@12.23.0" }))
    write(root, "projects/pnpm-workspace.yaml", "packages:\n  - contracts\n  - backend\n  - bot\n  - web\n  - site\n")
    for (const pkg of ["contracts", "backend", "bot", "web", "site"])
        write(root, `projects/${pkg}/package.json`, JSON.stringify({ name: `@neonflux/${pkg}` }))
    write(
        root,
        "projects/pnpm-lock.yaml",
        [
            "lockfileVersion: '9.0'",
            "importers:",
            "  .: {}",
            "  contracts: {}",
            "  backend: {}",
            "  bot: {}",
            "  web: {}",
            "  site: {}",
            "",
        ].join("\n"),
    )
    write(root, "projects/backend/convex/schema.ts", "export default {}\n")
    write(root, "projects/backend/convex/events.ts", "export const ok = true\n")
    write(
        root,
        "projects/backend/convex/_generated/api.d.ts",
        'import type * as events from "../events.js";\nexport declare const api: { events: typeof events };\n',
    )
    for (const file of ["api.js", "dataModel.d.ts", "server.d.ts", "server.js"])
        write(root, `projects/backend/convex/_generated/${file}`, "export {}\n")
    write(root, "projects/backend/.env.example", "CONVEX_DEPLOY_KEY=\n")
    write(root, "projects/bot/.env.example", "FLUXER_BOT_TOKEN=\nCONVEX_URL=\nNEONFLUX_BOT_API_SECRET=\n")
    write(
        root,
        "projects/web/.env.example",
        "CONVEX_URL=\nFLUXER_CLIENT_SECRET=\nWEB_SESSION_SECRET=\nTURNSTILE_SITE_KEY=\n",
    )
    write(root, "projects/site/.env.example", "PUBLIC_DASHBOARD_URL=http://localhost:3000\n")
    return root
}

const cleanEnv = {
    ...process.env,
    NEONFLUX_DOCTOR_NODE_VERSION: "26.13.1",
    NEONFLUX_DOCTOR_PNPM_VERSION: "12.23.0",
}

test("doctor passes on the real NeonFlux repository offline", () => {
    const report = runDoctor(repoRoot)
    assert.equal(
        report.ok,
        true,
        report.checks
            .filter((item) => !item.ok)
            .map((item) => `${item.name}: ${item.detail}`)
            .join("\n"),
    )
    assert.equal(report.checks.length, 7)
})

test("doctor passes on a healthy isolated workspace and catches every planted failure", () => {
    const withFixture = (mutate, env = cleanEnv) => {
        const root = makeHealthyRepo()
        try {
            mutate(root)
            return runDoctor(root, env)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    }

    assert.equal(withFixture(() => {}).ok, true)

    // 1. Node major mismatch
    const badNode = withFixture(() => {}, { ...cleanEnv, NEONFLUX_DOCTOR_NODE_VERSION: "20.11.0" })
    assert.equal(badNode.ok, false)
    assert.equal(badNode.checks.find((c) => c.name === "node-version")?.ok, false)

    // 2. pnpm major mismatch
    const badPnpm = withFixture(() => {}, { ...cleanEnv, NEONFLUX_DOCTOR_PNPM_VERSION: "9.0.0" })
    assert.equal(badPnpm.ok, false)
    assert.equal(badPnpm.checks.find((c) => c.name === "pnpm-version")?.ok, false)

    // 3. Missing workspace package manifest
    const badPkg = withFixture((root) => rmSync(join(root, "projects/bot/package.json")))
    assert.equal(badPkg.ok, false)
    assert.equal(badPkg.checks.find((c) => c.name === "workspace-packages")?.ok, false)

    // 4. Unregistered Convex module (would require live codegen)
    const badConvex = withFixture((root) => write(root, "projects/backend/convex/newModule.ts", "export const x = 1\n"))
    assert.equal(badConvex.ok, false)
    assert.equal(badConvex.checks.find((c) => c.name === "convex-generated")?.ok, false)

    // 5. Corrupt lockfile missing workspace importer
    const badLock = withFixture((root) =>
        write(root, "projects/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"),
    )
    assert.equal(badLock.ok, false)
    assert.equal(badLock.checks.find((c) => c.name === "lockfile")?.ok, false)

    // 6. Em dash planted in docs
    const badDash = withFixture((root) => write(root, "docs/NOTE.md", `Plain ${dash} text\n`))
    assert.equal(badDash.ok, false)
    assert.equal(badDash.checks.find((c) => c.name === "em-dashes")?.ok, false)

    // 7. Missing key and populated secret in env template
    const missingEnvKey = withFixture((root) => write(root, "projects/bot/.env.example", "CONVEX_URL=\n"))
    assert.equal(missingEnvKey.ok, false)
    assert.equal(missingEnvKey.checks.find((c) => c.name === "env-templates")?.ok, false)

    const populatedSecret = withFixture((root) =>
        write(root, "projects/backend/.env.example", "CONVEX_DEPLOY_KEY=leaked-synthetic-value\n"),
    )
    assert.equal(populatedSecret.ok, false)
    assert.equal(populatedSecret.checks.find((c) => c.name === "env-templates")?.ok, false)
})
