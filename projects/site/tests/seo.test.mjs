import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { FE, featurePath } from "../src/features.js"

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
        assert.ok(html.includes(`href="/docs/features/${feature.d}/"`), `${feature.n} does not link its docs page`)
    }
})

test("Pages kept out of search say so", () => {
    assert.match(readFileSync(join(dist, "404.html"), "utf8"), /name="robots" content="noindex"/)
    assert.match(readFileSync(join(dist, "docs/nightly/index.html"), "utf8"), /name="robots" content="noindex"/)
})
