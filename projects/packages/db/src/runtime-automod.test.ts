import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    deleteAutomodRule,
    listAutomodEventsByGuildId,
    listAutomodRulesByGuildId,
    listEnabledAutomodRulesByGuildId,
    recordAutomodEvent,
    saveAutomodRule,
    updateAutomodEventStatus,
} from './runtime-automod.js';

const rule = {
    actionType: 'timeout' as const,
    config: {
        terms: ['spam'],
        timeoutDurationSeconds: 300,
    },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    id: 'rule-1',
    name: 'Spam',
    triggerType: 'blocked_terms' as const,
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const event = {
    actionType: 'timeout' as const,
    authorUserId: 'user-1',
    channelId: 'channel-1',
    createdAt: '2026-07-03T08:30:00.000Z',
    details: { term: 'spam' },
    guildId: 'guild-1',
    id: 'event-1',
    messageId: 'message-1',
    ruleId: 'rule-1',
    status: 'recorded',
    triggerType: 'blocked_terms' as const,
};

describe('Convex automod database functions', () => {
    it('saves, lists, and deletes automod rules through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [rule, null],
            queryResults: [[rule], [rule]],
        });

        const saved = await saveAutomodRule(db, {
            actionType: 'timeout',
            config: {
                terms: [' spam ', 'spam'],
                timeoutDurationSeconds: 300,
            },
            enabled: true,
            guildId: ' guild-1 ',
            name: ' Spam ',
            triggerType: 'blocked_terms',
        });
        const all = await listAutomodRulesByGuildId(db, { guildId: 'guild-1' });
        const enabled = await listEnabledAutomodRulesByGuildId(db, { guildId: 'guild-1' });
        const deleted = await deleteAutomodRule(db, { guildId: 'guild-1', ruleId: 'rule-1' });

        expect(saved._unsafeUnwrap()).toStrictEqual(toRuleRecord(rule));
        expect(all._unsafeUnwrap()).toStrictEqual([toRuleRecord(rule)]);
        expect(enabled._unsafeUnwrap()).toStrictEqual([toRuleRecord(rule)]);
        expect(deleted._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            actionType: 'timeout',
            config: {
                terms: ['spam'],
                timeoutDurationSeconds: 300,
            },
            enabled: true,
            guildId: 'guild-1',
            name: 'Spam',
            triggerType: 'blocked_terms',
        });
    });

    it('records, lists, and updates automod events through Convex', async () => {
        const updatedEvent = { ...event, status: 'resolved' };
        const db = createConvexDb({
            mutationResults: [event, updatedEvent],
            queryResults: [[event]],
        });

        const recorded = await recordAutomodEvent(db, {
            actionType: 'timeout',
            authorUserId: ' user-1 ',
            channelId: ' channel-1 ',
            details: { term: 'spam' },
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            ruleId: ' rule-1 ',
            triggerType: 'blocked_terms',
        });
        const listed = await listAutomodEventsByGuildId(db, { guildId: 'guild-1', limit: 25 });
        const updated = await updateAutomodEventStatus(db, {
            eventId: 'event-1',
            status: 'resolved',
        });

        expect(recorded._unsafeUnwrap()).toStrictEqual(toEventRecord(event));
        expect(listed._unsafeUnwrap()).toStrictEqual([toEventRecord(event)]);
        expect(updated._unsafeUnwrap()).toStrictEqual(toEventRecord(updatedEvent));
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            limit: 25,
        });
    });

    it('maps validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingTerms = await saveAutomodRule(db, {
            guildId: 'guild-1',
            name: 'Spam',
            triggerType: 'blocked_terms',
        });
        const invalidTrigger = await recordAutomodEvent(db, {
            authorUserId: 'user-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            messageId: 'message-1',
            triggerType: 'bad',
        });
        const invalidLimit = await listAutomodEventsByGuildId(db, { guildId: 'guild-1', limit: 500 });

        expect(missingTerms._unsafeUnwrapErr()).toStrictEqual({
            field: 'config.terms',
            type: 'invalid-value',
        });
        expect(invalidTrigger._unsafeUnwrapErr()).toStrictEqual({
            field: 'triggerType',
            type: 'invalid-value',
        });
        expect(invalidLimit._unsafeUnwrapErr()).toStrictEqual({
            field: 'limit',
            type: 'invalid-value',
        });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('maps Convex not-found and failures to repository errors', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('not-found'), new Error('guild-not-found')],
        });

        const missingUpdate = await saveAutomodRule(db, {
            actionType: 'record',
            config: {},
            guildId: 'guild-1',
            name: 'Invites',
            ruleId: 'missing-rule',
            triggerType: 'invite_links',
        });
        const failedRecord = await recordAutomodEvent(db, {
            authorUserId: 'user-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            messageId: 'message-1',
            triggerType: 'invite_links',
        });

        expect(missingUpdate._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(failedRecord._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function toRuleRecord(record: typeof rule) {
    return {
        actionType: record.actionType,
        config: record.config,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        triggerType: record.triggerType,
        updatedAt: new Date(record.updatedAt),
    };
}

function toEventRecord(record: typeof event) {
    return {
        actionType: record.actionType,
        authorUserId: record.authorUserId,
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        details: record.details,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        ruleId: record.ruleId,
        status: record.status,
        triggerType: record.triggerType,
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
