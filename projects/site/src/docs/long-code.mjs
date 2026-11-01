// A block longer than this is cut to its first lines, with a button for the rest, so long code never buries a page
export const longCodeLines = 28
export const shownCodeLines = 16

const lineCount = (node) => node.value.trimEnd().split("\n").length

/** Marks every long block and puts its button after the code, not in it, so it stays put while a phone scrolls the code sideways */
export function remarkLongCode() {
    const visit = (parent) => {
        if (!parent.children) return
        for (const node of parent.children.filter((child) => child.type === "code")) {
            if (lineCount(node) <= longCodeLines) continue
            node.meta = "collapse"
            const show = `Show all ${lineCount(node)} lines`
            parent.children.splice(parent.children.indexOf(node) + 1, 0, {
                type: "html",
                value: `<button type="button" class="code-more" data-pagefind-ignore aria-expanded="false" data-show="${show}" data-hide="Show fewer lines">${show}</button>`,
            })
        }
        parent.children.forEach(visit)
    }
    return (tree) => visit(tree)
}

/** Puts the later lines of a marked block in an element the browser's own find can still open */
export const collapseLongCode = {
    name: "collapse-long-code",
    code(node) {
        if (this.options.meta?.__raw !== "collapse") return
        let lines = 0
        const split = node.children.findIndex((child) => child.type === "element" && ++lines > shownCodeLines)
        if (split < 0) return
        const rest = {
            type: "element",
            tagName: "span",
            properties: { class: "code-rest", hidden: "until-found" },
            children: node.children.slice(split),
        }
        node.children = [...node.children.slice(0, split), rest]
    },
}

/** Records each line's indent, so the wrapped part of a long line can hang past it */
export const codeLineIndent = {
    name: "code-line-indent",
    line(node, line) {
        const lead = /^[ \t]*/.exec(this.source.split("\n")[line - 1] ?? "")?.[0] ?? ""
        const width = lead.replace(/\t/g, "    ").length
        if (width > 0) node.properties.style = `--indent:${width}ch`
    },
}
