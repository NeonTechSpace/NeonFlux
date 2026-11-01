import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { test } from "node:test"
import { buildNav, docsTargets, pageHref, versionLinks, versions } from "../src/docs/versions.js"
import { collapseLongCode, longCodeLines, remarkLongCode, shownCodeLines } from "../src/docs/long-code.mjs"
import remarkEntries from "../src/docs/remark-entries.mjs"

const dist = new URL("../dist/", import.meta.url).pathname
const nightly = { folder: "nightly", channel: "nightly" }
const stable = (folder) => ({ folder, channel: "stable" })
const where = (list) => docsTargets(list).map(({ label, base, alias }) => [label, base, alias])

test("Nightly holds /docs/ until a Stable exists, and its own address still works", () => {
    assert.deepEqual(where([nightly]), [["Nightly", "/docs/", "/docs/nightly/"]])
})

test("The newest Stable takes /docs/, Nightly moves to its own address and old versions keep theirs", () => {
    assert.deepEqual(where([nightly, stable("v1.2.0"), stable("v1.10.0")]), [
        ["Stable (v1.10.0)", "/docs/", "/docs/v1.10.0/"],
        ["v1.2.0", "/docs/v1.2.0/", undefined],
        ["Nightly", "/docs/nightly/", undefined],
    ])
})

test("The version menu keeps the same page when the other version has it, and otherwise opens that version's home", () => {
    const targets = docsTargets([nightly, stable("v1.0.0")])
    const slugs = new Map([
        ["nightly", new Set(["index", "features/new"])],
        ["v1.0.0", new Set(["index"])],
    ])
    const links = versionLinks(targets, slugs, targets[1], "features/new")
    assert.deepEqual(
        links.map((link) => [link.href, link.current]),
        [
            ["/docs/", false],
            ["/docs/nightly/features/new/", true],
        ],
    )
    assert.equal(pageHref(targets[1], "index"), "/docs/nightly/")
})

test("A page missing from the sidebar list, or a listed page with no file, stops the build", () => {
    const meta = (pages) => ({ sections: [{ title: "A", groups: [{ title: "B", pages }] }] })
    const pages = new Map([["a/one", { title: "One" }]])
    assert.throws(() => buildNav(meta(["a/two"]), pages, "x"), /lists a\/two/)
    assert.throws(() => buildNav(meta([]), pages, "x"), /a\/one\.md is missing/)
    assert.deepEqual(buildNav(meta(["a/one"]), pages, "x")[0].groups[0].pages, [{ slug: "a/one", title: "One" }])
})

const pagesIn = (folder) =>
    readdirSync(folder).flatMap((name) => {
        const path = join(folder, name)
        return statSync(path).isDirectory() ? pagesIn(path) : name.endsWith(".html") ? [path] : []
    })

test("Every link inside the built docs reaches a page, and every section link reaches a heading", () => {
    const docs = pagesIn(join(dist, "docs"))
    assert.ok(docs.length > 1)
    const broken = []
    for (const file of [...docs, join(dist, "index.html")]) {
        const html = readFileSync(file, "utf8")
        const here = `/${file.slice(dist.length).replace(/index\.html$/, "")}`
        for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
            if (/^(?:[a-z]+:|\/\/)/.test(href) || href.startsWith("#")) continue
            const [path, anchor] = href.split("#")
            const target = posix.resolve(here, path)
            const page = join(dist, target, "index.html")
            if (!existsSync(page)) broken.push(`${here}: ${href}`)
            else if (anchor && !readFileSync(page, "utf8").includes(`id="${anchor}"`)) broken.push(`${here}: ${href}`)
        }
    }
    assert.deepEqual(broken, [])
})

test("The built docs have a search index, and the version's own address sends visitors to the real page", () => {
    assert.ok(existsSync(join(dist, "pagefind/pagefind.js")))
    assert.equal(versions.length, 1)
    assert.match(
        readFileSync(join(dist, "docs/nightly/features/tickets/index.html"), "utf8"),
        /url=\/docs\/features\/tickets\//,
    )
    assert.doesNotMatch(readFileSync(join(dist, "docs/features/tickets/index.html"), "utf8"), /name="robots"/)
})

test("A long code block shows its start and keeps the rest for its button", () => {
    const code = (lines) => ({
        type: "code",
        value: Array.from({ length: lines }, (_, line) => `line ${line}`).join("\n"),
    })
    const tree = { type: "root", children: [code(longCodeLines), code(longCodeLines + 1)] }
    remarkLongCode()(tree)
    assert.deepEqual(
        tree.children.map((node) => node.type),
        ["code", "code", "html"],
    )
    assert.equal(tree.children[0].meta, undefined)
    assert.equal(tree.children[1].meta, "collapse")
    assert.match(tree.children[2].value, /Show all 29 lines/)

    const line = { type: "element", tagName: "span", properties: {}, children: [] }
    const node = {
        children: Array.from({ length: longCodeLines + 1 }, () => [line, { type: "text", value: "\n" }]).flat(),
    }
    collapseLongCode.code.call({ options: { meta: { __raw: "collapse" } } }, node)
    const shown = node.children.filter((child) => child.tagName === "span" && !child.properties.class)
    assert.equal(shown.length, shownCodeLines)
    assert.equal(node.children.at(-1).properties.hidden, "until-found")
})

test("Tables of sentences or long commands become entries, and tables of short cells stay tables", () => {
    const cell = (value) => ({ type: "tableCell", children: [{ type: "text", value }] })
    const table = (term, text) => ({
        type: "table",
        children: [
            ["Command", "What it does"],
            [term, text],
        ].map((row) => ({ type: "tableRow", children: row.map(cell) })),
    })
    const tree = {
        type: "root",
        children: [table("!a", "Short"), table("!a", "x".repeat(61)), table("x".repeat(37), "Short")],
    }
    remarkEntries()(tree)
    assert.deepEqual(
        tree.children.map((node) => node.type),
        ["table", "entries", "entries"],
    )
})
