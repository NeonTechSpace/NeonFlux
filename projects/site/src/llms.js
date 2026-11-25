import { posix } from "node:path"
import { dashboardUrl } from "./dashboard-url.js"
import { buildNav, docsTargets, pageHref } from "./docs/versions.js"
import { FE, featureDocs, featurePath, homeDescription } from "./features.js"
import { siteName, siteUrl } from "./seo.js"

const absolute = (path) => new URL(path, siteUrl).href

/** Rewrites relative Markdown doc links into full canonical URLs for standalone text output */
function rewriteDocLinks(markdown, slug, target) {
    const here = slug === "index" ? "index.md" : `${slug}.md`
    return markdown.replace(/\]\(([^)\s]+)\)/g, (match, rawUrl) => {
        if (/^(?:[a-z]+:|\/\/|#|\/)/i.test(rawUrl)) return match
        const [filePart, anchor] = rawUrl.split("#")
        if (!filePart.endsWith(".md")) return match
        const resolved = posix.normalize(posix.join(posix.dirname(here), filePart))
        if (resolved.startsWith("..")) return match
        const targetSlug = resolved.replace(/\.md$/, "")
        const href = pageHref(target, targetSlug) + (anchor ? `#${anchor}` : "")
        return `](${absolute(href)})`
    })
}

/** Resolves the default docs version, its ordered sidebar navigation and its page map */
export function defaultDocsData(entries, metas) {
    const target = docsTargets()[0]
    const list = entries.filter((entry) => entry.id.startsWith(`${target.folder}/`))
    const slugOf = (entry) => entry.id.split("/").slice(1).join("/")
    const bySlug = new Map(list.map((entry) => [slugOf(entry), entry]))
    const metaKey = Object.keys(metas).find((key) => key.endsWith(`/${target.folder}/meta.json`))
    if (!metaKey) throw new Error(`Missing meta.json for docs version ${target.folder}`)
    const metaModule = metas[metaKey]
    const meta = metaModule.default ?? metaModule
    const pages = new Map(list.map((entry) => [slugOf(entry), entry.data]))
    const nav = buildNav(meta, pages, target.folder)
    return { target, nav, bySlug }
}

/** Builds the concise /llms.txt index from feature and documentation metadata */
export function buildLlmsTxt(entries, metas) {
    const { target, nav, bySlug } = defaultDocsData(entries, metas)
    const lines = [
        `# ${siteName}`,
        "",
        `> ${homeDescription}`,
        "",
        `NeonFlux is open source under Apache 2.0. The full documentation in one file is at ${absolute("/llms-full.txt")}`,
        "",
        "## Main pages",
        "",
        `- [Homepage](${absolute("/")}): Overview and interactive examples of NeonFlux`,
        `- [Documentation](${absolute(target.base)}): Setup, commands and self-hosting guides`,
        "- [Source code](https://github.com/NeonTechSpace/NeonFlux): Repository on GitHub",
        `- [Dashboard](${dashboardUrl}): Web dashboard for server settings, role picking and member profiles`,
        "",
        "## Features",
        "",
        ...FE.map((feature) => `- [${feature.n}](${absolute(featurePath(feature))}): ${feature.l}`),
    ]

    for (const section of nav) {
        lines.push("", `## Docs: ${section.title}`)
        for (const group of section.groups) {
            if (group.title) lines.push("", `### ${group.title}`)
            lines.push("")
            for (const page of group.pages) {
                const entry = bySlug.get(page.slug)
                const desc = entry?.data.description ? `: ${entry.data.description}` : ""
                lines.push(`- [${page.title}](${absolute(pageHref(target, page.slug))})${desc}`)
            }
        }
    }

    lines.push(
        "",
        "## Optional",
        "",
        `- [Full documentation](${absolute("/llms-full.txt")}): Complete text of the ${target.label} documentation and feature summaries`,
        "",
    )

    return lines.join("\n")
}

/** Builds the full /llms-full.txt corpus containing feature summaries and every default docs page */
export function buildLlmsFullTxt(entries, metas) {
    const { target, nav, bySlug } = defaultDocsData(entries, metas)
    const orderedSlugs = [
        "index",
        ...nav.flatMap((section) => section.groups.flatMap((group) => group.pages.map((p) => p.slug))),
    ]
    const blocks = [
        `# ${siteName}`,
        "",
        `> ${homeDescription}`,
        "",
        `Source code: https://github.com/NeonTechSpace/NeonFlux`,
        `License: Apache 2.0`,
        `Dashboard: ${dashboardUrl}`,
        `Summary index: ${absolute("/llms.txt")}`,
        "",
        "## Features",
    ]

    for (const feature of FE) {
        blocks.push(
            "",
            `### ${feature.n}`,
            "",
            `URL: ${absolute(featurePath(feature))}`,
            "",
            feature.l,
            "",
            ...feature.f.map((fact) => `- ${fact}`),
            "",
            ...featureDocs(feature).map(([href, label]) => `- Docs (${label}): ${absolute(href)}`),
        )
    }

    blocks.push("", `## Documentation (${target.label})`)

    for (const slug of orderedSlugs) {
        const entry = bySlug.get(slug)
        if (!entry) continue
        const body = rewriteDocLinks((entry.body ?? "").trim(), slug, target)
        blocks.push(
            "",
            `---`,
            "",
            `### ${entry.data.title}`,
            "",
            `URL: ${absolute(pageHref(target, slug))}`,
            `Description: ${entry.data.description}`,
            "",
            body,
        )
    }

    blocks.push("")
    return blocks.join("\n")
}
