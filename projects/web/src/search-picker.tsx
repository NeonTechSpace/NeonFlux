import { isId } from "@neonflux/contracts/common"
import { useId, useState } from "react"
import { useCatalogRefresh } from "./catalog"

interface PickerOption {
    id: string
    name: string
}
const searchText = (value: string) =>
    value
        .normalize("NFC")
        .replace(/[\uFE0E\uFE0F]/g, "")
        .toLowerCase()
export function fuzzyOptions(options: PickerOption[], query: string): PickerOption[] {
    const needle = searchText(query).trim()
    if (!needle) return options
    const score = (option: PickerOption) => {
        const name = searchText(option.name)
        if (option.id === needle) return -2
        if (name.startsWith(needle)) return -1
        if (/^\d+$/.test(needle) && option.id.startsWith(needle)) return 0
        let position = 0,
            total = 0
        for (const letter of needle) {
            const index = name.indexOf(letter, position)
            if (index < 0) return Infinity
            total += index - position
            position = index + letter.length
        }
        return total
    }
    return options
        .map((option) => ({ option, score: score(option) }))
        .filter((row) => Number.isFinite(row.score))
        .sort((a, b) => a.score - b.score || a.option.name.localeCompare(b.option.name))
        .map((row) => row.option)
}

/** catalog marks a picker of the server's channels or roles. Inside a catalog refresh provider it offers to reload those lists */
export function SearchPicker({
    label,
    options,
    value,
    onChange,
    multiple = false,
    disabled = false,
    loading = false,
    allowManual = false,
    catalog = false,
}: {
    label: string
    options: PickerOption[]
    value: string[]
    onChange: (ids: string[]) => void
    multiple?: boolean | undefined
    disabled?: boolean | undefined
    loading?: boolean | undefined
    allowManual?: boolean | undefined
    catalog?: boolean | undefined
}) {
    const id = useId(),
        [query, setQuery] = useState(""),
        [opened, setOpen] = useState(false),
        [active, setActive] = useState(0)
    const refresh = useCatalogRefresh()
    const open = opened && !disabled && !loading
    const results = fuzzyOptions(options, query).filter((option) => !multiple || !value.includes(option.id))
    if (
        allowManual &&
        isId(query.trim()) &&
        !options.some((option) => option.id === query.trim()) &&
        !value.includes(query.trim())
    )
        results.push({ id: query.trim(), name: `Use ID ${query.trim()}` })
    const select = (option: PickerOption) => {
        onChange(multiple ? [...value, option.id] : [option.id])
        setQuery("")
        setActive(0)
        setOpen(false)
    }
    return (
        <div className="search-picker">
            <div className="picker-label">
                <label htmlFor={`${id}-input`}>{label}</label>
                {catalog && refresh && (
                    <button
                        type="button"
                        className="picker-refresh secondary"
                        aria-label={`Refresh channels and roles for ${label}`}
                        title="Load the server's current channels and roles"
                        disabled={refresh.busy}
                        onClick={refresh.refresh}
                    >
                        {refresh.refreshing ? "Refreshing…" : "Refresh"}
                    </button>
                )}
            </div>
            {value.length > 0 && (
                <div className="selected-options">
                    {value.map((selected) => (
                        <span className="selected-option" key={selected}>
                            {options.find((option) => option.id === selected)?.name ?? `Unavailable (${selected})`}
                            <button
                                type="button"
                                className="secondary"
                                aria-label={`Remove ${options.find((option) => option.id === selected)?.name ?? selected}`}
                                disabled={disabled}
                                onClick={() => onChange(value.filter((item) => item !== selected))}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <input
                id={`${id}-input`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={`${id}-list`}
                aria-activedescendant={open && results[active] ? `${id}-option-${active}` : undefined}
                autoComplete="off"
                value={query}
                disabled={disabled || loading}
                placeholder={loading ? "Loading choices…" : "Type to search…"}
                onFocus={() => setOpen(true)}
                onBlur={(event) => {
                    if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false)
                }}
                onChange={(event) => {
                    setQuery(event.target.value)
                    setActive(0)
                    setOpen(true)
                }}
                onPaste={(event) => {
                    // Several pasted IDs or mentions, apart or split by commas or lines, are each chosen at once, so a long list
                    // need not be picked one by one. IDs that match no choice stay in the box to show which were not added
                    const ids = [...event.clipboardData.getData("text").matchAll(/\d+/g)]
                        .map((match) => match[0])
                        .filter(isId)
                    if (!multiple || ids.length < 2) return
                    event.preventDefault()
                    const known = (id: string) => allowManual || options.some((option) => option.id === id)
                    onChange([...new Set([...value, ...ids.filter(known)])])
                    setQuery(ids.filter((id) => !known(id)).join(" "))
                    setActive(0)
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setOpen(false)
                        return
                    }
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault()
                        setOpen(true)
                        setActive((current) =>
                            Math.max(0, Math.min(results.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))),
                        )
                    }
                    if (event.key === "Enter" && open) {
                        event.preventDefault()
                        if (results[active]) select(results[active])
                    }
                }}
            />
            {open && (
                <div className="picker-results" id={`${id}-list`} role="listbox" aria-label={label}>
                    {results.length ? (
                        results.map((option, index) => {
                            // Only an ID worth reading is shown beside the name, never an internal key or a repeat of the name
                            const hint = isId(option.id) && option.name !== option.id ? option.id : undefined
                            return (
                                <button
                                    id={`${id}-option-${index}`}
                                    role="option"
                                    aria-label={hint ? `${option.name} ${hint}` : option.name}
                                    aria-selected={active === index}
                                    key={option.id}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => select(option)}
                                >
                                    {option.name}
                                    {hint && <span className="muted">{hint}</span>}
                                </button>
                            )
                        })
                    ) : (
                        <p className="muted">No matching choices</p>
                    )}
                </div>
            )}
        </div>
    )
}
