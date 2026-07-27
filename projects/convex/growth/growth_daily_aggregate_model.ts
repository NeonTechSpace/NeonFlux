import type { GuildMemberFlowEventDocument, GuildOverviewAggregate } from './growth_overview_model.js';

export const growthDailyAggregateShardCount = 64;

export type GuildGrowthDailyAggregateDocument = {
    activityDate: string;
    firstEventAt?: string;
    guildId: string;
    joins: number;
    leaves: number;
    messageCount: number;
    shard: number;
    updatedAt: string;
};

export function selectGrowthDailyAggregateShard(key: string): number {
    let hash = 0x811c9dc5;

    for (let index = 0; index < key.length; index += 1) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0) % growthDailyAggregateShardCount;
}

export function createEmptyGuildGrowthDailyAggregate(
    guildId: string,
    activityDate: string,
    shard: number,
    now: string
): GuildGrowthDailyAggregateDocument {
    return {
        activityDate,
        guildId,
        joins: 0,
        leaves: 0,
        messageCount: 0,
        shard,
        updatedAt: now,
    };
}

export function addMemberEventToGuildGrowthDailyAggregate(
    aggregate: GuildGrowthDailyAggregateDocument,
    event: GuildMemberFlowEventDocument
): GuildGrowthDailyAggregateDocument {
    return {
        ...aggregate,
        firstEventAt: earlierTimestamp(aggregate.firstEventAt, event.occurredAt),
        joins: aggregate.joins + (event.eventType === 'join' ? 1 : 0),
        leaves: aggregate.leaves + (event.eventType === 'leave' ? 1 : 0),
        updatedAt: laterTimestamp(aggregate.updatedAt, event.occurredAt),
    };
}

export function addMessagesToGuildGrowthDailyAggregate(
    aggregate: GuildGrowthDailyAggregateDocument,
    input: { messageCount: number; occurredAt: string }
): GuildGrowthDailyAggregateDocument {
    return {
        ...aggregate,
        firstEventAt: earlierTimestamp(aggregate.firstEventAt, input.occurredAt),
        messageCount: aggregate.messageCount + input.messageCount,
        updatedAt: laterTimestamp(aggregate.updatedAt, input.occurredAt),
    };
}

export function toGuildOverviewAggregateFromDaily(input: {
    dailyAggregates: GuildGrowthDailyAggregateDocument[];
    days: number;
    now: string;
    oldestRetainedActivityAt?: string;
}): GuildOverviewAggregate {
    const aggregatesByDate = aggregateGrowthShardsByDate(input.dailyAggregates);
    const graphDates = createGraphDates(input.days, input.now);
    const totalJoins = input.dailyAggregates.reduce((total, aggregate) => total + aggregate.joins, 0);
    const totalLeaves = input.dailyAggregates.reduce((total, aggregate) => total + aggregate.leaves, 0);
    const totalMessages = input.dailyAggregates.reduce((total, aggregate) => total + aggregate.messageCount, 0);
    const oldestRetainedActivityAt = [
        ...(input.oldestRetainedActivityAt ? [input.oldestRetainedActivityAt] : []),
        ...input.dailyAggregates.flatMap((aggregate) => (aggregate.firstEventAt ? [aggregate.firstEventAt] : [])),
    ].sort()[0];

    return {
        ...(oldestRetainedActivityAt ? { oldestRetainedActivityAt } : {}),
        windowDays: input.days,
        activityPresence: {
            hasMemberFlow: totalJoins + totalLeaves > 0,
            hasMessageActivity: totalMessages > 0,
        },
        memberFlow: {
            graph: graphDates.map((date) => {
                const aggregate = aggregatesByDate.get(date);
                const joins = aggregate?.joins ?? 0;
                const leaves = aggregate?.leaves ?? 0;
                return { date, joins, leaves, netGrowth: joins - leaves };
            }),
            netGrowth: totalJoins - totalLeaves,
            totalJoins,
            totalLeaves,
        },
        messages: {
            graph: graphDates.map((date) => ({
                date,
                messageCount: aggregatesByDate.get(date)?.messageCount ?? 0,
            })),
            totalMessages,
        },
    };
}

export function firstOverviewActivityDate(days: number, now: string): string {
    return createGraphDates(days, now)[0] ?? now.slice(0, 10);
}

export function maxGrowthOverviewAggregateRows(days: number): number {
    return days * growthDailyAggregateShardCount;
}

function aggregateGrowthShardsByDate(
    dailyAggregates: GuildGrowthDailyAggregateDocument[]
): Map<string, { joins: number; leaves: number; messageCount: number }> {
    const aggregatesByDate = new Map<string, { joins: number; leaves: number; messageCount: number }>();

    for (const aggregate of dailyAggregates) {
        const current = aggregatesByDate.get(aggregate.activityDate) ?? { joins: 0, leaves: 0, messageCount: 0 };
        aggregatesByDate.set(aggregate.activityDate, {
            joins: current.joins + aggregate.joins,
            leaves: current.leaves + aggregate.leaves,
            messageCount: current.messageCount + aggregate.messageCount,
        });
    }

    return aggregatesByDate;
}

function createGraphDates(days: number, now: string): string[] {
    const date = new Date(now);
    return Array.from({ length: days }, (_, index) => {
        const offset = days - 1 - index;
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset))
            .toISOString()
            .slice(0, 10);
    });
}

function earlierTimestamp(current: string | undefined, candidate: string): string {
    return !current || candidate < current ? candidate : current;
}

function laterTimestamp(current: string, candidate: string): string {
    return candidate > current ? candidate : current;
}
