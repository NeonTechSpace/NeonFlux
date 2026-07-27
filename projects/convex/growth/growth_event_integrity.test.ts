import { describe, expect, it, vi } from 'vitest';

import { recordMemberFlowEventOnce, recordMessageActivityOnce } from './growth_event_integrity.js';
import type { GuildMemberFlowEventDocument } from './growth_overview_model.js';

const receipt = {
    activityDate: '2026-07-14',
    guildId: 'guild-1',
    messageId: 'message-1',
    occurredAt: '2026-07-14T01:02:03.000Z',
    shard: 3,
};

describe('growth event integrity', () => {
    it('writes a message receipt before its aggregate and returns duplicate receipts without incrementing', async () => {
        const order: string[] = [];
        const insertReceipt = vi.fn(() => {
            order.push('receipt');
            return Promise.resolve();
        });
        const incrementAggregate = vi.fn(() => {
            order.push('aggregate');
            return Promise.resolve();
        });

        const recorded = await recordMessageActivityOnce({
            findReceipt: () => Promise.resolve(null),
            incrementAggregate,
            insertReceipt,
            receipt,
        });
        const duplicate = await recordMessageActivityOnce({
            findReceipt: () => Promise.resolve(receipt),
            incrementAggregate,
            insertReceipt,
            receipt,
        });

        expect(recorded).toStrictEqual({
            activityDate: receipt.activityDate,
            guildId: receipt.guildId,
            shard: receipt.shard,
            status: 'recorded',
        });
        expect(duplicate).toStrictEqual({
            activityDate: receipt.activityDate,
            guildId: receipt.guildId,
            shard: receipt.shard,
            status: 'duplicate',
        });
        expect(order).toStrictEqual(['receipt', 'aggregate']);
    });

    it('checks join identity before insertion', async () => {
        const existing = { id: 'member-event-1' };
        const insertEvent = vi.fn(() => Promise.resolve({ id: 'new-event' }));
        const result = await recordMemberFlowEventOnce({
            event: createJoin(),
            findExistingJoin: () => Promise.resolve(existing),
            insertEvent,
        });

        expect(result).toBe(existing);
        expect(insertEvent).not.toHaveBeenCalled();
    });

    it('leaves remain explicitly at-least-once because the provider has no reliable leave identity', async () => {
        const findExistingJoin = vi.fn(() => Promise.resolve({ id: 'impossible' }));
        const insertEvent = vi.fn(() => Promise.resolve({ id: 'leave-event' }));
        const result = await recordMemberFlowEventOnce({
            event: createLeave(),
            findExistingJoin,
            insertEvent,
        });

        expect(result).toStrictEqual({ id: 'leave-event' });
        expect(findExistingJoin).not.toHaveBeenCalled();
        expect(insertEvent).toHaveBeenCalledOnce();
    });
});

function createJoin(): GuildMemberFlowEventDocument {
    return {
        eventType: 'join',
        guildId: 'guild-1',
        membershipStartedAt: '2026-07-14T01:00:00.000Z',
        occurredAt: '2026-07-14T01:00:00.000Z',
        userId: 'user-1',
    };
}

function createLeave(): GuildMemberFlowEventDocument {
    return {
        eventType: 'leave',
        guildId: 'guild-1',
        occurredAt: '2026-07-14T02:00:00.000Z',
        userId: 'user-1',
    };
}
