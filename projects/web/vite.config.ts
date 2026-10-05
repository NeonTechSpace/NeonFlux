import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['FLUXER_CLIENT_ID', 'FLUXER_CLIENT_SECRET', 'CONVEX_URL', 'WEB_ORIGIN', 'WEB_SESSION_SECRET']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }
  return { plugins: [tailwindcss(), tanstackStart(), nitro({ preset: 'node-server' }), react()] }
})
