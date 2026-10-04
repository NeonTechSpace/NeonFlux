export function milestoneMonthDay(value: string): boolean {
    if (!/^\d\d-\d\d$/.test(value)) return false
    const [month, day] = value.split("-").map(Number)
    const date = new Date(Date.UTC(2000, month! - 1, day!))
    return date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}
