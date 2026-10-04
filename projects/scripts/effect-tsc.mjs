// Runs the TypeScript 7 build that @effect/tsgo ships with the Effect language service built in, so a typecheck also reports
// Effect diagnostics. It checks the package in the current directory with the TypeScript version that package installs.
// Arguments reach the compiler unchanged, and the compiler's exit code is this script's
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const { default: getExePath } = await import(pathToFileURL(require.resolve("@effect/tsgo/lib/getExePath")).href)
const result = spawnSync(getExePath(), process.argv.slice(2), { stdio: "inherit" })
if (result.error) console.error(`Could not start the Effect TypeScript build: ${result.error.message}`)
process.exit(result.status ?? 1)
