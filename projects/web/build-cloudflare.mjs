import { spawnSync } from "node:child_process"

const result = spawnSync(process.execPath, ["../scripts/heavy.mjs", "vite", "build"], {
    stdio: "inherit",
    env: { ...process.env, NITRO_PRESET: process.env.NITRO_PRESET || "cloudflare-module" },
})
process.exit(result.status ?? 1)
