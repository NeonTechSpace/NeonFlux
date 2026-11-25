import { defineConfig, loadEnv } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

type WebNitroPreset = "node-server" | "cloudflare-module" | "cloudflare-pages"

function resolvePreset(raw: string | undefined): WebNitroPreset {
    const value = raw?.trim()
    if (value === "cloudflare-module" || value === "cloudflare-pages") return value
    return "node-server"
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "")
    for (const key of [
        "FLUXER_CLIENT_SECRET",
        "CONVEX_URL",
        "WEB_SESSION_SECRET",
        "TURNSTILE_SITE_KEY",
        "TRUST_PROXY",
        "NEONFLUX_WEBSITE_URL",
    ]) {
        if (env[key] && !process.env[key]) process.env[key] = env[key]
    }
    const preset = resolvePreset(process.env.NITRO_PRESET)
    // Generated evaluation output under .local would otherwise keep the dev server's watcher busy
    return {
        plugins: [
            tailwindcss(),
            tanstackStart(),
            nitro({
                preset,
                ...(preset.startsWith("cloudflare")
                    ? {
                          cloudflare: {
                              deployConfig: true,
                              nodeCompat: true,
                              wrangler: {
                                  name: "neonflux-dashboard",
                                  compatibility_date: "2025-11-01",
                                  keep_vars: true,
                              },
                          },
                      }
                    : {}),
            }),
            react(),
        ],
        server: { watch: { ignored: ["**/.local/**"] } },
    }
})
