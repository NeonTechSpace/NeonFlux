import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

// These read the build, so run them after `pnpm run build`
const dist = new URL("../dist/", import.meta.url).pathname
const assets = readdirSync(join(dist, "_astro")).map((name) => readFileSync(join(dist, "_astro", name), "utf8"))
const page = readFileSync(join(dist, "index.html"), "utf8")
const built = [page, ...assets].join("\n")

test("Every dashboard button opens the dashboard's own address", () => {
    assert.ok(page.includes('href="https://dashboard.neonflux.neontechspace.com"') || process.env.PUBLIC_DASHBOARD_URL)
    assert.doesNotMatch(built, /href=\\?["']\/dashboard/)
})

test("Every art and font file the page names is in the build", () => {
    const files = new Set(built.match(/\/(?:art|fonts)\/[\w./-]+\.(?:webp|woff2)/g))
    assert.ok(files.size > 0)
    for (const file of files) assert.ok(existsSync(join(dist, file)), `${file} is missing`)
})

test("The build keeps the space between a word and the inline tag after it", () => {
    assert.match(page, /fill in\s+<code/)
})
