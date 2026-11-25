// Offline workspace health check for developers and coding agents. Verifies the Node and pnpm version pins, workspace
// packages, Convex _generated module parity, lockfile sanity, em-dash absence and environment template completeness.
// Usage: node scripts/doctor.mjs [repository], where the repository defaults to the parent of projects/
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dash = String.fromCharCode(0x2014)
const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|bin|zip|gz|tgz|pdf|wasm|mp4|webm)$/i
const ignoredDirs = new Set([".git", "node_modules", "dist", ".output", ".astro", ".nitro", ".tanstack"])
const generatedFiles = ["api.d.ts", "api.js", "dataModel.d.ts", "server.d.ts", "server.js"]
const nonApiConvexFiles = new Set(["schema.ts", "convex.config.ts"])
const expectedEnvTemplates = [
    {
        path: "projects/backend/.env.example",
        required: ["CONVEX_DEPLOY_KEY"],
    },
    {
        path: "projects/bot/.env.example",
        required: ["FLUXER_BOT_TOKEN", "CONVEX_URL", "NEONFLUX_BOT_API_SECRET"],
    },
    {
        path: "projects/web/.env.example",
        required: ["CONVEX_URL", "FLUXER_CLIENT_SECRET", "WEB_SESSION_SECRET", "TURNSTILE_SITE_KEY"],
    },
    {
        path: "projects/site/.env.example",
        required: ["PUBLIC_DASHBOARD_URL"],
    },
]
const secretKeyPattern = /(?:SECRET|TOKEN|KEY)$/

function parseWorkspacePackages(yamlText) {
    const packages = []
    let inPackages = false
    for (const rawLine of yamlText.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "")
        if (/^packages\s*:/.test(line)) {
            inPackages = true
            continue
        }
        if (inPackages) {
            if (/^\S/.test(line)) break
            const match = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line)
            if (match) packages.push(match[1])
        }
    }
    return packages
}

function collectFiles(root) {
    if (existsSync(join(root, ".git"))) {
        const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        })
            .split("\0")
            .filter((file) => file !== "" && !binary.test(file))
        if (listed.length > 0) return listed
    }
    const files = []
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (ignoredDirs.has(entry.name)) continue
            const full = join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.isFile()) {
                const rel = relative(root, full).replace(/\\/g, "/")
                if (!binary.test(rel)) files.push(rel)
            }
        }
    }
    walk(root)
    return files
}

export function runDoctor(root, env = process.env) {
    const workspace = join(root, "projects")
    const checks = []
    const check = (name, fn) => {
        try {
            const detail = fn()
            checks.push({ name, ok: true, detail })
        } catch (error) {
            checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
        }
    }

    // 1. Node version pin
    check("node-version", () => {
        const pinPath = join(workspace, ".node-version")
        if (!existsSync(pinPath)) throw new Error("Missing projects/.node-version")
        const expected = readFileSync(pinPath, "utf8").trim()
        if (!/^\d+\.\d+\.\d+$/.test(expected)) throw new Error(`Invalid projects/.node-version: ${expected}`)
        const actual = (env.NEONFLUX_DOCTOR_NODE_VERSION ?? process.versions.node).replace(/^v/, "").trim()
        const [expectedMajor, expectedMinor] = expected.split(".").map(Number)
        const [actualMajor, actualMinor] = actual.split(".").map(Number)
        if (!Number.isInteger(actualMajor) || !Number.isInteger(actualMinor))
            throw new Error(`Invalid Node version: ${actual}`)
        if (actualMajor < expectedMajor || (actualMajor === expectedMajor && actualMinor < expectedMinor))
            throw new Error(`Node ${actual} is older than pinned ${expected} in projects/.node-version`)
        return actual === expected
            ? `Node ${actual} matches pin ${expected}`
            : `Node ${actual} satisfies minimum pin ${expected}`
    })

    // 2. pnpm version pin
    check("pnpm-version", () => {
        const pkgPath = join(workspace, "package.json")
        if (!existsSync(pkgPath)) throw new Error("Missing projects/package.json")
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
        const manager = pkg.packageManager
        const match = typeof manager === "string" ? /^pnpm@(\d+\.\d+\.\d+)$/.exec(manager) : null
        if (!match) throw new Error(`Missing or invalid pnpm packageManager pin in projects/package.json`)
        const expected = match[1]
        let actual = env.NEONFLUX_DOCTOR_PNPM_VERSION?.trim()
        if (!actual) {
            const result = spawnSync("pnpm", ["--version"], {
                cwd: workspace,
                encoding: "utf8",
                env,
                shell: process.platform === "win32",
            })
            if (result.status !== 0) throw new Error("pnpm is not available on PATH")
            actual = result.stdout.trim()
        }
        const expectedMajor = expected.split(".")[0]
        const actualMajor = actual.split(".")[0]
        if (actualMajor !== expectedMajor)
            throw new Error(`pnpm ${actual} does not match pinned ${expected} in projects/package.json`)
        return actual === expected
            ? `pnpm ${actual} matches pin ${expected}`
            : `pnpm ${actual} matches pinned major ${expectedMajor} (exact pin ${expected})`
    })

    // 3. Workspace packages
    let workspacePackages = []
    check("workspace-packages", () => {
        const yamlPath = join(workspace, "pnpm-workspace.yaml")
        if (!existsSync(yamlPath)) throw new Error("Missing projects/pnpm-workspace.yaml")
        workspacePackages = parseWorkspacePackages(readFileSync(yamlPath, "utf8"))
        if (workspacePackages.length === 0) throw new Error("No packages listed in projects/pnpm-workspace.yaml")
        const names = []
        for (const pkgDir of workspacePackages) {
            const manifest = join(workspace, pkgDir, "package.json")
            if (!existsSync(manifest))
                throw new Error(`Workspace package missing manifest: projects/${pkgDir}/package.json`)
            const parsed = JSON.parse(readFileSync(manifest, "utf8"))
            if (typeof parsed.name !== "string" || !parsed.name.length)
                throw new Error(`Workspace package missing name: projects/${pkgDir}/package.json`)
            names.push(parsed.name)
        }
        return `${names.length} workspace packages verified (${names.join(", ")})`
    })

    // 4. Clean Convex _generated parity
    check("convex-generated", () => {
        const convexDir = join(workspace, "backend", "convex")
        const genDir = join(convexDir, "_generated")
        if (!existsSync(genDir)) throw new Error("Missing projects/backend/convex/_generated")
        for (const file of generatedFiles) {
            const full = join(genDir, file)
            if (!existsSync(full) || statSync(full).size === 0)
                throw new Error(`Missing or empty Convex generated file: ${file}`)
        }
        const apiDts = readFileSync(join(genDir, "api.d.ts"), "utf8")
        const generatedModules = new Set()
        for (const match of apiDts.matchAll(/import\s+type\s+\*\s+as\s+\w+\s+from\s+["']\.\.\/([^"']+)\.js["']/g))
            generatedModules.add(match[1])
        if (generatedModules.size === 0) throw new Error("Convex _generated/api.d.ts declares no modules")
        const sourceModules = new Set(
            readdirSync(convexDir)
                .filter(
                    (file) =>
                        file.endsWith(".ts") &&
                        !file.endsWith(".d.ts") &&
                        !file.endsWith(".test.ts") &&
                        !nonApiConvexFiles.has(file),
                )
                .map((file) => file.slice(0, -3)),
        )
        const missingInGen = [...sourceModules]
            .filter((mod) => !generatedModules.has(mod))
            .sort((a, b) => a.localeCompare(b))
        const staleInGen = [...generatedModules]
            .filter((mod) => !sourceModules.has(mod))
            .sort((a, b) => a.localeCompare(b))
        if (missingInGen.length || staleInGen.length) {
            const parts = []
            if (missingInGen.length) parts.push(`unregistered modules: ${missingInGen.join(", ")}`)
            if (staleInGen.length) parts.push(`stale generated entries: ${staleInGen.join(", ")}`)
            throw new Error(`Convex _generated/api.d.ts is out of sync (${parts.join(", ")})`)
        }
        return `${sourceModules.size} Convex modules match _generated/api.d.ts`
    })

    // 5. Lockfile sanity
    check("lockfile", () => {
        const lockPath = join(workspace, "pnpm-lock.yaml")
        if (!existsSync(lockPath)) throw new Error("Missing projects/pnpm-lock.yaml")
        const content = readFileSync(lockPath, "utf8")
        if (!/^lockfileVersion:\s*['"]?\d+(\.\d+)?['"]?/m.test(content))
            throw new Error("projects/pnpm-lock.yaml is missing a valid lockfileVersion header")
        if (!/^importers:/m.test(content)) throw new Error("projects/pnpm-lock.yaml is missing importers")
        const importersBlock = content.slice(content.indexOf("importers:"))
        const missing = workspacePackages.filter(
            (pkg) => !new RegExp(`^\\s{2}['"]?${pkg}['"]?:`, "m").test(importersBlock),
        )
        if (missing.length)
            throw new Error(`projects/pnpm-lock.yaml missing workspace importers: ${missing.join(", ")}`)
        return `pnpm-lock.yaml covers all ${workspacePackages.length} workspace importers`
    })

    // 6. No em dashes
    check("em-dashes", () => {
        const files = collectFiles(root)
        if (files.length === 0) throw new Error(`No files found to check in ${root}`)
        const found = []
        for (const file of files) {
            let text
            try {
                text = readFileSync(resolve(root, file), "utf8")
            } catch (error) {
                if (error && typeof error === "object" && error.code === "ENOENT") continue
                throw error
            }
            if (text.includes("\0") || !text.includes(dash)) continue
            text.split("\n").forEach((line, index) => {
                for (let column = line.indexOf(dash); column !== -1; column = line.indexOf(dash, column + 1))
                    found.push(`${file}:${index + 1}:${column + 1}`)
            })
        }
        if (found.length) throw new Error(`Em dashes found: ${found.slice(0, 10).join(", ")}`)
        return `No em dashes in ${files.length} files`
    })

    // 7. Env template completeness
    check("env-templates", () => {
        for (const template of expectedEnvTemplates) {
            const full = join(root, template.path)
            if (!existsSync(full)) throw new Error(`Missing env template: ${template.path}`)
            const lines = readFileSync(full, "utf8").split(/\r?\n/)
            const seen = new Set()
            for (const [index, raw] of lines.entries()) {
                const trimmed = raw.trim()
                if (!trimmed || trimmed.startsWith("#")) continue
                const eq = trimmed.indexOf("=")
                if (eq <= 0) throw new Error(`Malformed line in ${template.path}:${index + 1}`)
                const key = trimmed.slice(0, eq)
                const value = trimmed.slice(eq + 1).trim()
                if (!/^[A-Z][A-Z0-9_]*$/.test(key))
                    throw new Error(`Invalid env key ${key} in ${template.path}:${index + 1}`)
                if (secretKeyPattern.test(key) && value !== "")
                    throw new Error(`Secret template variable ${key} must be empty in ${template.path}`)
                seen.add(key)
            }
            const missing = template.required.filter((key) => !seen.has(key))
            if (missing.length) throw new Error(`${template.path} missing required keys: ${missing.join(", ")}`)
        }
        return `${expectedEnvTemplates.length} env templates complete and secret-free`
    })

    return { ok: checks.every((item) => item.ok), checks }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
    const root = resolve(process.argv[2] ?? defaultRoot)
    const report = runDoctor(root)
    for (const item of report.checks) {
        const tag = item.ok ? "PASS" : "FAIL"
        const line = `[${tag}] ${item.name}: ${item.detail}`
        if (item.ok) console.log(line)
        else console.error(line)
    }
    if (!report.ok) process.exit(1)
}
