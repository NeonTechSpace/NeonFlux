// A table of sentences or long commands reads as prose squeezed into columns, and it runs off a phone. It becomes a list of
// entries: The first column on its own line, then the other columns under it. A table with more than one other column
// keeps each column's name as a small label. The Markdown stays a plain table, and tables of short cells stay tables

// Cells outside the first column that average more characters than this read as prose
const proseCells = 60
// A first column this long, such as a full command, would squeeze the text beside it
const longTerm = 36

const textOf = (node) => node.value ?? (node.children ?? []).map(textOf).join("")
const element = (type, hName, className, children) => ({ type, data: { hName, hProperties: { className } }, children })

export const isProse = (table) => {
    const rows = table.children.slice(1)
    const cells = rows.flatMap((row) => row.children.slice(1))
    const longest = Math.max(...rows.map((row) => textOf(row.children[0]).trim().length))
    return (
        longest > longTerm ||
        (cells.length > 0 &&
            cells.reduce((sum, cell) => sum + textOf(cell).trim().length, 0) / cells.length > proseCells)
    )
}

const entries = (table) => {
    const [head, ...rows] = table.children
    const labels = head.children.slice(1)
    return element(
        "entries",
        "dl",
        ["entries"],
        rows.map((row) => {
            const [term, ...parts] = row.children
            return element(
                "entry",
                "div",
                ["entry"],
                [
                    element("entryTerm", "dt", [], term.children),
                    ...parts.flatMap((cell, index) =>
                        textOf(cell).trim()
                            ? [
                                  element(
                                      "entryPart",
                                      "dd",
                                      [],
                                      [
                                          ...(labels.length > 1
                                              ? [
                                                    element(
                                                        "entryLabel",
                                                        "span",
                                                        ["entry-label"],
                                                        structuredClone(labels[index].children),
                                                    ),
                                                ]
                                              : []),
                                          { type: "paragraph", children: cell.children },
                                      ],
                                  ),
                              ]
                            : [],
                    ),
                ],
            )
        }),
    )
}

export default function remarkEntries() {
    const visit = (parent) => {
        if (!Array.isArray(parent.children)) return
        parent.children = parent.children.map((child) =>
            child.type === "table" && child.children.length > 1 && isProse(child) ? entries(child) : child,
        )
        parent.children.forEach(visit)
    }
    return (tree) => visit(tree)
}
