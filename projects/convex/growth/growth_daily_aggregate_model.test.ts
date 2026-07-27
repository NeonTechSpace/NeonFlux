import { describe, expect, it } from 'vitest';

import {
    addMemberEventToGuildGrowthDailyAggregate,
    addMessagesToGuildGrowthDailyAggregate,
    createEmptyGuildGrowthDailyAggregate,
    firstOverviewActivityDate,
    growthDailyAggregateShardCount,
    maxGrowthOverviewAggregateRows,
    selectGrowthDailyAggregateShard,
    toGuildOverviewAggregateFromDaily,
    type GuildGrowthDailyAggregateDocument,
} from './growth_daily_aggregate_model.js';

describe('growth daily aggregate model', () => {
    it('uses exact inclusive UTC window cutoffs', () => {
        expect(firstOverviewActivityDate(30, '2026-07-10T23:59:59.999-07:00')).toBe('2026-06-12');
        expect(firstOverviewActivityDate(30, '2026-07-11T06:59:59.999Z')).toBe('2026-06-12');
        expect(firstOverviewActivityDate(90, '2026-07-10T00:00:00.000Z')).toBe('2026-04-12');
        expect(maxGrowthOverviewAggregateRows(90)).toBe(5_760);
    });

    it('keeps persisted shard assignments stable, bounded, and distributed', () => {
        expect([
            selectGrowthDailyAggregateShard('guild-1:2026-07-10:message-1'),
            selectGrowthDailyAggregateShard('message-0'),
            selectGrowthDailyAggregateShard('message-42'),
            selectGrowthDailyAggregateShard('guild-2:2026-07-11:user-9'),
        ]).toStrictEqual([57, 1, 45, 49]);

        const shards = new Set(
            Array.from({ length: 5_100 }, (_, index) => selectGrowthDailyAggregateShard(`message-${String(index)}`))
        );

        expect(Math.min(...shards)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...shards)).toBeLessThan(growthDailyAggregateShardCount);
        expect(shards.size).toBe(growthDailyAggregateShardCount);
    });

    it('compacts 5,100 member events into fixed scalar shards without cardinality growth', () => {
        const aggregates = new Map<number, GuildGrowthDailyAggregateDocument>();

        for (let index = 0; index < 5_100; index += 1) {
            const userId = `user-${String(index)}`;
            const shard = selectGrowthDailyAggregateShard(`guild-1:2026-07-10:${userId}`);
            const current =
                aggregates.get(shard) ??
                createEmptyGuildGrowthDailyAggregate('guild-1', '2026-07-10', shard, '2026-07-10T00:00:00.000Z');
            aggregates.set(
                shard,
                addMemberEventToGuildGrowthDailyAggregate(current, {
                    eventType: 'join',
                    guildId: 'guild-1',
                    occurredAt: `2026-07-10T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
                    userId,
                })
            );
        }

        const messageShard = selectGrowthDailyAggregateShard('message-1');
        const messageAggregate =
            aggregates.get(messageShard) ??
            createEmptyGuildGrowthDailyAggregate('guild-1', '2026-07-10', messageShard, '2026-07-10T00:00:00.000Z');
        aggregates.set(
            messageShard,
            addMessagesToGuildGrowthDailyAggregate(messageAggregate, {
                messageCount: 6_000,
                occurredAt: '2026-07-10T12:00:00.000Z',
            })
        );

        const overview = toGuildOverviewAggregateFromDaily({
            dailyAggregates: [...aggregates.values()],
            days: 30,
            now: '2026-07-10T23:59:59.999Z',
        });

        expect(aggregates.size).toBeLessThanOrEqual(growthDailyAggregateShardCount);
        expect(overview.memberFlow).toMatchObject({ totalJoins: 5_100, totalLeaves: 0, netGrowth: 5_100 });
        expect(overview.activityPresence).toStrictEqual({ hasMemberFlow: true, hasMessageActivity: true });
        expect(overview.windowDays).toBe(30);
        expect(overview.messages.totalMessages).toBe(6_000);
        expect(overview.messages.graph.at(-1)).toStrictEqual({ date: '2026-07-10', messageCount: 6_000 });
    });
});
