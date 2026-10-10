import { noMentions } from "./responses.ts"

// A range is reported when more than 100 members of the same level score higher, so only the level's bounds are known
export type RankPosition = number | { from: number, to: number } | "unranked" | "outside-top-1000"
const formatRank = (rank: RankPosition) => rank === "outside-top-1000" ? "Outside the top 1000" : rank === "unranked" ? "Unranked"
    : typeof rank === "number" ? `#${rank}` : `#${rank.from} to #${rank.to}`

export function rankCard(userId: string, xp: number, rank: RankPosition) {
    const level = Math.floor(Math.sqrt(xp / 100))
    const floor = 100 * level * level, next = level === 1000 ? floor : 100 * (level + 1) ** 2
    const fraction = next === floor ? 1 : (xp - floor) / (next - floor)
    const filled = Math.max(0, Math.min(10, Math.floor(fraction * 10)))
    return { allowedMentions: noMentions, embeds: [{ title: "Message rank", color: 0x7c6cff,
        description: `Member ${userId}`,
        fields: [
            { name: "Level", value: String(level), inline: true },
            { name: "Lifetime XP", value: xp.toLocaleString("en-US"), inline: true },
            { name: "Server rank", value: formatRank(rank), inline: true },
            { name: "Progress", value: `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${level === 1000 ? "Maximum level" : `${xp - floor} / ${next - floor} XP to level ${level + 1}`}` },
        ],
    }] }
}
