// The workspace lint: Oxlint with type-aware rules over every package, then the repository's own scans. The heavy-task
// gate runs it in one slot, so Oxlint and its type checker get two threads, as two gated jobs would
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const workspace = join(dirname(fileURLToPath(import.meta.url)), "..")
const run = (command, args, env = {}) => {
    const result = spawnSync(command, args, {
        cwd: workspace,
        stdio: "inherit",
        env: { ...process.env, ...env },
        shell: process.platform === "win32",
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
}
run(
    "oxlint",
    ["-c", ".oxlintrc.json", "--threads=2", "--deny-warnings", "bot", "backend", "contracts", "web", "scripts"],
    {
        // oxlint-tsgolint checks types on Go threads, which --threads does not limit
        GOMAXPROCS: "2",
    },
)
run(process.execPath, ["scripts/em-dashes.mjs", ".."])
run(process.execPath, ["scripts/doc-links.mjs", ".."])
run(process.execPath, ["scripts/repository-guide.mjs", ".."])
