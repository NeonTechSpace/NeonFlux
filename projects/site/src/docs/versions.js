// Every docs version the site serves, each with its own folder under content/docs/.
// A Stable release joins with an entry such as { folder: "v1.0.0", channel: "stable" } and a copy of the docs in that folder
export const versions = [{ folder: "nightly", channel: "nightly" }]

const numbers = (folder) => folder.slice(1).split(".").map(Number)
const newestFirst = (a, b) => {
    const [x, y] = [numbers(a.folder), numbers(b.folder)]
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
}

/**
 * Where each version lives. The newest Stable has /docs/, and with no Stable yet Nightly has it. Nightly otherwise stays
 * at /docs/nightly/, and older Stable versions at their own number. Each keeps its own address working as `alias`
 */
export function docsTargets(list = versions) {
    const stable = list.filter((entry) => entry.channel === "stable").toSorted(newestFirst)
    const nightly = list.filter((entry) => entry.channel === "nightly")
    return [...stable, ...nightly].map((entry, index) => {
        const isDefault = index === 0
        const own = `/docs/${entry.folder}/`
        const newest = entry.channel === "stable" && entry === stable[0]
        const label = entry.channel === "nightly" ? "Nightly" : newest ? `Stable (${entry.folder})` : entry.folder
        return { ...entry, label, isDefault, base: isDefault ? "/docs/" : own, alias: isDefault ? own : undefined }
    })
}

/** A page's address in a version, from its path inside the version's folder such as "features/moderation" or "index" */
export const pageHref = (target, slug) => (slug === "index" ? target.base : `${target.base}${slug}/`)

/** The same page in another version, or that version's first page when the other version lacks it */
export function versionLinks(targets, slugsByFolder, current, slug) {
    return targets.map((target) => ({
        label: target.label,
        current: target.folder === current.folder,
        href: pageHref(target, slugsByFolder.get(target.folder)?.has(slug) ? slug : "index"),
    }))
}

/** The sidebar of a version, from its meta.json and page titles. A page missing from either side fails the build */
export function buildNav(meta, pages, folder) {
    const listed = new Set()
    const sections = meta.sections.map((section) => ({
        ...section,
        groups: section.groups.map((group) => ({
            ...group,
            pages: group.pages.map((slug) => {
                const page = pages.get(slug)
                if (!page) throw new Error(`${folder}/meta.json lists ${slug}, which has no page`)
                if (listed.has(slug)) throw new Error(`${folder}/meta.json lists ${slug} twice`)
                listed.add(slug)
                return { slug, title: page.navTitle ?? page.title }
            }),
        })),
    }))
    for (const slug of pages.keys())
        if (slug !== "index" && !listed.has(slug)) throw new Error(`${folder}/${slug}.md is missing from meta.json`)
    return sections
}
