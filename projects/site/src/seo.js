import { homeDescription } from "./features.js"

// The facts shared by every page's head, and the structured data search engines read
export const siteName = "NeonFlux"
export const siteUrl = "https://neonflux.neontechspace.com"

export const shareImage = {
    path: "/og-image.png",
    width: 1280,
    height: 640,
    alt: "NeonFlux, the only bot you should ever need, with moderation, roles, messages, support, community and voice",
}

const absolute = (path) => new URL(path, siteUrl).href

const organization = {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "NeonTechSpace",
    url: "https://github.com/NeonTechSpace",
}

const website = {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: `${siteUrl}/`,
    name: siteName,
    description: homeDescription,
    inLanguage: "en",
    publisher: { "@id": organization["@id"] },
}

const software = {
    "@type": "SoftwareSourceCode",
    "@id": `${siteUrl}/#software`,
    name: siteName,
    description: homeDescription,
    url: `${siteUrl}/`,
    image: absolute(shareImage.path),
    codeRepository: "https://github.com/NeonTechSpace/NeonFlux",
    programmingLanguage: "TypeScript",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    author: { "@id": organization["@id"] },
}

export const homeGraph = [website, software, organization]

/** The trail above a page, as a list of its name and address from the homepage down */
export const pageGraph = (trail) => [
    {
        "@type": "BreadcrumbList",
        itemListElement: trail.map((step, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: step.name,
            item: absolute(step.path),
        })),
    },
]
