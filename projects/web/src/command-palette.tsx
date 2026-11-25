import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { DashboardSession } from "@neonflux/backend/dashboard-contracts"
import { Icon, navigation, sectionIcons, type SectionId } from "./dashboard-sections"
import { fuzzyOptions } from "./fuzzy"

type ManagedServer = DashboardSession["servers"][number]
type MemberServer = NonNullable<DashboardSession["memberServers"]>[number]

interface CommandItem {
    id: string
    kind: "section" | "server"
    name: string
    subtitle: string
    iconPath?: string
    draft?: boolean
    active?: boolean
    run: () => void
}

export interface CommandPaletteProps {
    open: boolean
    onClose: () => void
    currentSection?: SectionId | undefined
    currentServerId?: string | undefined
    drafts: ReadonlySet<string>
    multi: boolean
    servers: ManagedServer[]
    memberServers: MemberServer[]
    onSelectSection: (section: SectionId) => void
    onSelectServer: (serverId: string) => void
}

const sectionCatalog: ReadonlyArray<{ id: SectionId; name: string; group: string }> = [
    { id: "overview", name: "Overview", group: "Summary" },
    ...navigation.flatMap(([group, items]) => items.map(([id, name]) => ({ id, name, group }))),
]

export function CommandPalette({
    open,
    onClose,
    currentSection,
    currentServerId,
    drafts,
    multi,
    servers,
    memberServers,
    onSelectSection,
    onSelectServer,
}: CommandPaletteProps) {
    const [query, setQuery] = useState("")
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const dialogRef = useRef<HTMLDivElement>(null)
    const previousFocusRef = useRef<HTMLElement | null>(null)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose
    const listId = useId()

    useEffect(() => {
        if (!open) return
        previousFocusRef.current =
            typeof document !== "undefined" &&
            typeof HTMLElement !== "undefined" &&
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null
        setQuery("")
        setActiveIndex(0)
        inputRef.current?.focus()
        const onWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            onCloseRef.current()
        }
        window.addEventListener("keydown", onWindowKeyDown)
        return () => {
            window.removeEventListener("keydown", onWindowKeyDown)
            const previous = previousFocusRef.current
            previousFocusRef.current = null
            if (previous?.isConnected) previous.focus()
        }
    }, [open])

    const items = useMemo<CommandItem[]>(() => {
        const result: CommandItem[] = []
        if (currentServerId && currentSection !== undefined) {
            for (const entry of sectionCatalog) {
                result.push({
                    id: `section:${entry.id}`,
                    kind: "section",
                    name: entry.name,
                    subtitle: entry.group,
                    iconPath: sectionIcons[entry.id],
                    draft: drafts.has(entry.id),
                    active: currentSection === entry.id,
                    run: () => {
                        onSelectSection(entry.id)
                        onClose()
                    },
                })
            }
        }
        if (multi) {
            for (const server of servers) {
                result.push({
                    id: `server:${server.id}`,
                    kind: "server",
                    name: server.name,
                    subtitle: server.id === currentServerId ? "Current server" : "Manage server",
                    active: server.id === currentServerId,
                    run: () => {
                        onSelectServer(server.id)
                        onClose()
                    },
                })
            }
            for (const server of memberServers) {
                result.push({
                    id: `member:${server.id}`,
                    kind: "server",
                    name: server.name,
                    subtitle: server.id === currentServerId ? "Current member server" : "Member features",
                    active: server.id === currentServerId,
                    run: () => {
                        onSelectServer(server.id)
                        onClose()
                    },
                })
            }
        }
        return result
    }, [
        currentSection,
        currentServerId,
        drafts,
        multi,
        servers,
        memberServers,
        onSelectSection,
        onSelectServer,
        onClose,
    ])

    const matches = useMemo(() => {
        const trimmed = query.trim()
        if (!trimmed) return items
        const searchable = items.map((item) => ({ id: item.id, name: `${item.name} ${item.subtitle}` }))
        const byId = new Map(items.map((item) => [item.id, item]))
        return fuzzyOptions(searchable, trimmed)
            .map((option) => byId.get(option.id))
            .filter((item): item is CommandItem => item !== undefined)
    }, [items, query])

    useEffect(() => {
        setActiveIndex(0)
    }, [query, open])

    if (!open) return null

    const clampedIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : -1
    const sectionMatches = matches.filter((item) => item.kind === "section")
    const serverMatches = matches.filter((item) => item.kind === "server")
    const ordered = [...sectionMatches, ...serverMatches]
    const activeOptionId = clampedIndex >= 0 && ordered[clampedIndex] ? `${listId}-opt-${clampedIndex}` : undefined

    const renderGroup = (heading: string, groupItems: CommandItem[], offset: number) => {
        if (!groupItems.length) return null
        return (
            <div className="palette-group">
                <p className="palette-group-label">{heading}</p>
                {groupItems.map((item, localIndex) => {
                    const index = offset + localIndex
                    const selected = index === clampedIndex
                    return (
                        <button
                            key={item.id}
                            id={`${listId}-opt-${index}`}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`palette-item${selected ? " is-selected" : ""}`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={item.run}
                        >
                            {item.iconPath ? (
                                <Icon path={item.iconPath} />
                            ) : (
                                <span className="palette-server-dot" aria-hidden="true" />
                            )}
                            <span className="palette-item-name">{item.name}</span>
                            {item.draft && <span className="palette-badge draft">Draft</span>}
                            {item.active && <span className="palette-badge active">Current</span>}
                            <span className="palette-item-meta">{item.subtitle}</span>
                        </button>
                    )
                })}
            </div>
        )
    }

    return (
        <div
            className="palette-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <div
                ref={dialogRef}
                className="palette-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault()
                        onClose()
                    } else if (event.key === "Tab" && dialogRef.current) {
                        const focusable = Array.from(
                            dialogRef.current.querySelectorAll<HTMLElement>(
                                'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
                            ),
                        )
                        if (focusable.length) {
                            const first = focusable[0]!,
                                last = focusable.at(-1)!
                            if (event.shiftKey && document.activeElement === first) {
                                event.preventDefault()
                                last.focus()
                            } else if (!event.shiftKey && document.activeElement === last) {
                                event.preventDefault()
                                first.focus()
                            }
                        }
                    } else if (event.key === "ArrowDown" && ordered.length) {
                        event.preventDefault()
                        setActiveIndex((current) => (current + 1) % ordered.length)
                    } else if (event.key === "ArrowUp" && ordered.length) {
                        event.preventDefault()
                        setActiveIndex((current) => (current - 1 + ordered.length) % ordered.length)
                    } else if (
                        event.key === "Enter" &&
                        ((event.target as { tagName?: string } | null)?.tagName ?? "").toUpperCase() !== "BUTTON" &&
                        clampedIndex >= 0 &&
                        ordered[clampedIndex]
                    ) {
                        event.preventDefault()
                        ordered[clampedIndex]!.run()
                    }
                }}
            >
                <div className="palette-search">
                    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20 20l-3.5-3.5" />
                    </svg>
                    <input
                        ref={inputRef}
                        type="search"
                        aria-label="Jump to a section or server"
                        aria-controls={listId}
                        aria-activedescendant={activeOptionId}
                        autoComplete="off"
                        value={query}
                        placeholder="Jump to a section or server…"
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <button type="button" className="secondary palette-close" onClick={onClose}>
                        Esc
                    </button>
                </div>
                <div id={listId} className="palette-results" role="listbox" aria-label="Matching sections and servers">
                    {ordered.length ? (
                        <>
                            {renderGroup("Sections", sectionMatches, 0)}
                            {renderGroup("Servers", serverMatches, sectionMatches.length)}
                        </>
                    ) : (
                        <p className="palette-empty muted">No matching sections or servers</p>
                    )}
                </div>
                <div className="palette-footer" aria-hidden="true">
                    <span>
                        <kbd>↑</kbd> <kbd>↓</kbd> Navigate
                    </span>
                    <span>
                        <kbd>↵</kbd> Open
                    </span>
                    <span>
                        <kbd>Esc</kbd> Close
                    </span>
                </div>
            </div>
        </div>
    )
}
