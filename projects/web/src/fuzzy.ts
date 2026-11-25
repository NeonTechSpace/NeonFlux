export interface PickerOption {
    id: string
    name: string
}

const searchText = (value: string) =>
    value
        .normalize("NFC")
        .replace(/[\uFE0E\uFE0F]/g, "")
        .toLowerCase()

/** Ranks options by exact ID, name prefix, ID prefix, then subsequence distance */
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
