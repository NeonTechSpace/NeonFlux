import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { FE, featureDocs, featurePath } from "../src/features.js"

// These read the build, so run them after `pnpm run build`
const dist = new URL("../dist/", import.meta.url).pathname
const site = "https://neonflux.neontechspace.com"
const sitemap = readFileSync(join(dist, "sitemap.xml"), "utf8")
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
const pageOf = (address) => readFileSync(join(dist, new URL(address).pathname, "index.html"), "utf8")
const content = (html, pattern) => pattern.exec(html)?.[1]

test("The sitemap lists the homepage, every feature page and the docs, and nothing kept out of search", () => {
    for (const path of ["/", "/docs/", "/docs/self-hosting/bot/", ...FE.map(featurePath)]) {
        assert.ok(listed.includes(new URL(path, site).href), `${path} is missing`)
    }
    assert.deepEqual(
        listed.filter((address) => /\/docs\/nightly\/|\/404/.test(address)),
        [],
    )
    assert.match(readFileSync(join(dist, "robots.txt"), "utf8"), new RegExp(`Sitemap: ${site}/sitemap.xml`))
})

test("Every listed page has its own title, a description, its own address and a share picture", () => {
    const titles = new Map()
    for (const address of listed) {
        const html = pageOf(address)
        const title = content(html, /<title>([^<]*)<\/title>/)
        assert.ok(title, `${address} has no title`)
        assert.equal(titles.get(title), undefined, `${address} shares the title "${title}"`)
        titles.set(title, address)
        const description = content(html, /<meta name="description" content="([^"]*)"/)
        assert.ok(description && description.length <= 170, `${address} has a description of ${description?.length}`)
        assert.equal(content(html, /<link rel="canonical" href="([^"]*)"/), address)
        assert.match(html, /<meta property="og:image" content="https:\/\/neonflux\.neontechspace\.com\/og-image\.png"/)
        assert.doesNotMatch(html, /name="robots"/)
    }
})

test("The icons and preview files the pages name are in the build", () => {
    const html = pageOf(`${site}/`)
    const named = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map(
        (match) => match[1],
    )
    assert.ok(named.length >= 4)
    const manifest = JSON.parse(readFileSync(join(dist, "site.webmanifest"), "utf8"))
    for (const file of [...named, "/og-image.png", ...manifest.icons.map((icon) => icon.src)]) {
        assert.ok(existsSync(join(dist, file)), `${file} is missing`)
    }
})

test("A feature page has its words in its first HTML, so a search engine reads them without running the script", () => {
    for (const feature of FE) {
        const html = pageOf(new URL(featurePath(feature), site).href)
        assert.ok(html.includes(`<h1>${feature.n}</h1>`), `${feature.n} has no heading`)
        assert.ok(html.includes(feature.f[0].replaceAll("'", "&#39;")), `${feature.n} is missing its facts`)
        for (const [href] of featureDocs(feature)) {
            assert.ok(html.includes(`href="${href}"`), `${feature.n} does not link ${href}`)
            assert.ok(existsSync(join(dist, href, "index.html")), `${href} is not a page`)
        }
    }
})

test("Pages kept out of search say so", () => {
    assert.match(readFileSync(join(dist, "404.html"), "utf8"), /name="robots" content="noindex"/)
    assert.match(readFileSync(join(dist, "docs/nightly/index.html"), "utf8"), /name="robots" content="noindex"/)
})

test("LLM text endpoints are generated from features and docs, linked from layouts and kept out of the sitemap", () => {
    const summary = readFileSync(join(dist, "llms.txt"), "utf8")
    const full = readFileSync(join(dist, "llms-full.txt"), "utf8")
    assert.match(summary, /^# NeonFlux\n/)
    assert.match(summary, /https:\/\/neonflux\.neontechspace\.com\/llms-full\.txt/)
    for (const feature of FE) {
        assert.ok(summary.includes(new URL(featurePath(feature), site).href), `llms.txt missing ${feature.d}`)
        assert.ok(full.includes(`### ${feature.n}`), `llms-full.txt missing ${feature.n}`)
    }
    assert.ok(summary.includes(`${site}/docs/features/first-steps/`))
    assert.ok(summary.includes(`${site}/docs/self-hosting/overview/`))
    assert.ok(full.includes(`URL: ${site}/docs/features/moderation/`))
    assert.doesNotMatch(full, /\]\(\.\/[^)]+\.md/)
    assert.ok(!summary.includes("\u2014"))
    assert.ok(!full.includes("\u2014"))
    assert.deepEqual(
        listed.filter((address) => /\/llms(?:-full)?\.txt/.test(address)),
        [],
    )
    for (const path of ["/", "/docs/"]) {
        const html = pageOf(new URL(path, site).href)
        assert.match(html, /<link rel="alternate" type="text\/plain" href="\/llms\.txt"/)
    }
})

test("Cloudflare Pages headers set security, caching and noindex rules", () => {
    const headersPath = join(dist, "_headers")
    assert.ok(existsSync(headersPath), "_headers is missing from dist")
    const headers = readFileSync(headersPath, "utf8")
    assert.match(headers, /^\/\*\n[\s\S]*X-Content-Type-Options: nosniff/m)
    assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/)
    assert.match(headers, /X-Frame-Options: DENY/)
    assert.match(headers, /Content-Security-Policy: .*script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/)
    assert.match(headers, /\/_astro\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
    assert.match(headers, /\/fonts\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
    assert.match(headers, /\/art\/\*\n\s+Cache-Control: [^\n]*stale-while-revalidate/)
    assert.match(headers, /\/pagefind\/\*\n\s+Cache-Control: [^\n]*stale-while-revalidate/)
    for (const path of ["/404.html", "/llms.txt", "/llms-full.txt"]) {
        assert.match(headers, new RegExp(`${path.replace(".", "\\.")}\\n\\s+X-Robots-Tag: noindex`))
    }
})

test("The homepage and feature pages each have one h1 and a skip link to main", () => {
    for (const path of ["/", ...FE.map(featurePath)]) {
        const html = pageOf(new URL(path, site).href)
        const h1s = [...html.matchAll(/<h1\b[^>]*>/g)]
        assert.equal(h1s.length, 1, `${path} has ${h1s.length} h1 elements`)
        assert.match(html, /<a class="skip-link" href="#main">Skip to content<\/a>/)
        assert.match(html, /<main id="main"/)
    }
})
