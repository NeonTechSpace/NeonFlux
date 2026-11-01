import { posix, relative, sep } from "node:path"

const root = "content/docs/"

// A guide's position inside its version's folder, such as features/moderation.md
const inVersion = (path) => {
    const parts = path.split(sep).join("/").split(root)[1].split("/").slice(1)
    return parts.join("/")
}
const pageDir = (file) => (file === "index.md" ? "" : file.replace(/\.md$/, ""))

/**
 * Guides link to each other by file, such as ./tickets.md#panels, so the repository's link scan checks them. This turns
 * those into addresses relative to the page, which keep working whichever address the version is served at. Links to
 * other sites open in a new tab
 */
export default function remarkLinks() {
    const visit = (node, file) => {
        if (node.type === "link") {
            if (/^https?:/.test(node.url)) {
                node.data = { hProperties: { target: "_blank", rel: "noopener" } }
            } else if (!node.url.startsWith("#")) {
                const [path, anchor] = node.url.split("#")
                const here = inVersion(file.path)
                const target = posix.normalize(posix.join(posix.dirname(here), path))
                if (!target.endsWith(".md") || target.startsWith(".."))
                    throw new Error(`${here}: ${node.url} is not a guide`)
                const url = relative(pageDir(here) || ".", pageDir(target) || ".")
                    .split(sep)
                    .join("/")
                node.url = `${url ? `${url}/` : "./"}${anchor ? `#${anchor}` : ""}`
            }
        }
        for (const child of node.children ?? []) visit(child, file)
    }
    return (tree, file) => visit(tree, file)
}
