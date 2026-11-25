import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import stylesheet from "../styles.css?url"

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: "utf-8" },
            { name: "viewport", content: "width=device-width, initial-scale=1" },
            { title: "NeonFlux dashboard" },
        ],
        links: [
            {
                rel: "preload",
                href: "/fonts/bricolage.woff2",
                as: "font",
                type: "font/woff2",
                crossOrigin: "anonymous",
            },
            { rel: "preload", href: "/fonts/atkinson.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
            { rel: "stylesheet", href: stylesheet },
            { rel: "preconnect", href: "https://fluxerusercontent.com", crossOrigin: "anonymous" },
            { rel: "preconnect", href: "https://challenges.cloudflare.com", crossOrigin: "anonymous" },
        ],
    }),
    component: Root,
    notFoundComponent: () => (
        <main>
            <h1>Page not found</h1>
            <a href="/">Return to the dashboard</a>
        </main>
    ),
    errorComponent: () => (
        <main>
            <h1>Unable to load this page</h1>
            <p>Reload to try again</p>
            <a href="/">Return to the dashboard</a>
        </main>
    ),
})

const motionInitScript =
    '(()=>{try{var s=localStorage.getItem("nf.motion"),still=s?s!=="on":matchMedia("(prefers-reduced-motion: reduce)").matches;document.documentElement.toggleAttribute("data-still",still);document.documentElement.dataset.motion=still?"off":"on"}catch{}})()'

function Root() {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <HeadContent />
                <script dangerouslySetInnerHTML={{ __html: motionInitScript }} />
            </head>
            <body>
                <Outlet />
                <Scripts />
            </body>
        </html>
    )
}
