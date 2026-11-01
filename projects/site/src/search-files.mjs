import { readFile, writeFile } from "node:fs/promises"

// Writes sitemap.xml and robots.txt after every build. The sitemap lists the pages that were built and allowed in search, so
// no page is ever listed by hand, and redirects, the 404 page and docs versions other than the main one stay out
export default function searchFiles() {
    let site = ""
    return {
        name: "neonflux-search-files",
        hooks: {
            "astro:config:done": ({ config }) => {
                site = config.site
            },
            "astro:build:done": async ({ dir, pages }) => {
                const listed = []
                for (const { pathname } of pages) {
                    const file = new URL(`${pathname.replace(/^\//, "")}index.html`, dir)
                    const html = await readFile(file, "utf8").catch(() => "")
                    if (html && !/<meta name="robots" content="noindex"/.test(html))
                        listed.push(new URL(pathname, site).href)
                }
                const entries = listed.toSorted().map((address) => `    <url><loc>${address}</loc></url>`)
                await writeFile(
                    new URL("sitemap.xml", dir),
                    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`,
                )
                await writeFile(
                    new URL("robots.txt", dir),
                    `User-agent: *\nDisallow: /pagefind/\n\nSitemap: ${new URL("sitemap.xml", site).href}\n`,
                )
            },
        },
    }
}
