import { unified } from "@astrojs/markdown-remark"
import { defineConfig } from "astro/config"
import searchFiles from "./src/search-files.mjs"
import remarkEntries from "./src/docs/remark-entries.mjs"
import remarkLinks from "./src/docs/remark-links.mjs"
import { codeLineIndent, collapseLongCode, remarkLongCode } from "./src/docs/long-code.mjs"
import theme from "./src/docs/theme.json" with { type: "json" }

export default defineConfig({
    site: "https://neonflux.neontechspace.com",
    output: "static",
    trailingSlash: "always",
    integrations: [searchFiles()],
    // Astro's compression drops the line break between a word and an inline tag, which joined words such as "fill inbot/.env"
    compressHTML: false,
    markdown: {
        processor: unified({ remarkPlugins: [remarkLinks, remarkLongCode, remarkEntries], smartypants: false }),
        shikiConfig: { theme, transformers: [codeLineIndent, collapseLongCode] },
    },
    // The docs route's name would otherwise put "..." into its stylesheet's file name, which some hosts refuse
    vite: { build: { rollupOptions: { output: { assetFileNames: "_astro/[hash][extname]" } } } },
})
