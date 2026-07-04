import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    addModerationCaseNote,
    createChannelModerationCase,
    createModerationCase,
    createObservedModerationCase,
    findModerationCaseByGuildCaseNumber,
    findRecentModerationCaseByTargetAction,
    listModerationCaseEventsByCaseId,
    listModerationCasesByGuildId,
    recordModerationCaseEvent,
    updateModerationCaseReason,
    updateModerationCaseStatus,
    voidModerationCase,
} from './runtime-moderation.js';
import {
    cancelPendingModerationTemporaryActionsByTarget,
    createModerationTemporaryAction,
    findPendingModerationTemporaryActionByTarget,
    listDueModerationTemporaryActions,
    updateModerationTemporaryActionStatus,
} from './runtime-moderation-temporary-actions.js';

const moderationCase = {
    action: 'warn',
    actorUserId: 'mod-1',
    caseNumber: 7,
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    id: 'case-1',
    reason: 'Repeated spam',
    status: 'open',
    targetChannelId: null,
    targetType: 'user' as const,
    targetUserId: 'user-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const channelCase = {
    ...moderationCase,
    action: 'purge',
    caseNumber: 8,
    id: 'case-2',
    targetChannelId: 'channel-1',
    targetType: 'channel' as const,
    targetUserId: null,
};
const observedCase = {
    ...moderationCase,
    caseNumber: 9,
    id: 'case-3',
    status: 'resolved',
};
const moderationEvent = {
    actorUserId: 'mod-1',
    caseId: 'case-1',
    createdAt: '2026-07-03T08:05:00.000Z',
    details: { reason: 'Updated reason' },
    eventType: 'reason.updated',
    id: 'event-1',
};
const temporaryAction = {
    action: 'timeout',
    caseId: 'case-1',
    createdAt: '2026-07-03T08:10:00.000Z',
    expiresAt: '2026-07-03T09:10:00.000Z',
    guildId: 'guild-1',
    id: 'temporary-action-1',
    status: 'pending' as const,
    targetUserId: 'user-1',
    updatedAt: '2026-07-03T08:10:00.000Z',
};

describe('Convex moderation database functions', () => {
    it('routes moderation cases and events through Convex with app-facing records', async () => {
        const db = createConvexDb({
            mutationResults: [
                moderationCase,
                channelCase,
                observedCase,
                moderationEvent,
                { ...moderationCase, status: 'resolved' },
                { ...moderationCase, reason: 'Updated reason' },
                { ...moderationCase, status: 'void' },
                moderationEvent,
            ],
            queryResults: [moderationCase, [moderationCase], observedCase, [moderationEvent]],
        });

        const created = await createModerationCase(db, {
            action: ' warn ',
            actorUserId: ' mod-1 ',
            caseNumber: 7,
            guildId: ' guild-1 ',
            reason: ' Repeated spam ',
            targetUserId: ' user-1 ',
        });
        const channel = await createChannelModerationCase(db, {
            action: ' purge ',
            actorUserId: ' mod-1 ',
            guildId: ' guild-1 ',
            reason: ' cleanup ',
            targetChannelId: ' channel-1 ',
        });
        const observed = await createObservedModerationCase(db, {
            action: ' ban ',
            details: { source: 'fluxer' },
            eventType: ' action.observed ',
            guildId: ' guild-1 ',
            targetUserId: ' user-1 ',
        });
        const event = await recordModerationCaseEvent(db, {
            actorUserId: ' mod-1 ',
            caseId: ' case-1 ',
            details: moderationEvent.details,
            eventType: ' reason.updated ',
        });
        const found = await findModerationCaseByGuildCaseNumber(db, { caseNumber: 7, guildId: ' guild-1 ' });
        const listed = await listModerationCasesByGuildId(db, {
            action: ' warn ',
            guildId: ' guild-1 ',
            limit: 50,
            status: ' open ',
            targetUserId: ' user-1 ',
        });
        const recent = await findRecentModerationCaseByTargetAction(db, {
            action: ' ban ',
            guildId: ' guild-1 ',
            since: new Date('2026-07-03T07:00:00.000Z'),
            statuses: [' open ', 'resolved', ' '],
            targetUserId: ' user-1 ',
        });
        const events = await listModerationCaseEventsByCaseId(db, {
            caseId: ' case-1 ',
            eventType: ' reason.updated ',
            limit: 10,
        });
        const resolved = await updateModerationCaseStatus(db, { caseId: ' case-1 ', status: ' resolved ' });
        const reason = await updateModerationCaseReason(db, {
            actorUserId: ' mod-1 ',
            caseId: ' case-1 ',
            reason: ' Updated reason ',
        });
        const voided = await voidModerationCase(db, {
            actorUserId: ' mod-1 ',
            caseId: ' case-1 ',
            reason: ' Mistake ',
        });
        const note = await addModerationCaseNote(db, {
            actorUserId: ' mod-1 ',
            caseId: ' case-1 ',
            note: ' Internal note ',
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toCaseRecord(moderationCase));
        expect(channel._unsafeUnwrap()).toStrictEqual(toCaseRecord(channelCase));
        expect(observed._unsafeUnwrap()).toStrictEqual(toCaseRecord(observedCase));
        expect(event._unsafeUnwrap()).toStrictEqual(toEventRecord(moderationEvent));
        expect(found._unsafeUnwrap()).toStrictEqual(toCaseRecord(moderationCase));
        expect(listed._unsafeUnwrap()).toStrictEqual([toCaseRecord(moderationCase)]);
        expect(recent._unsafeUnwrap()).toStrictEqual(toCaseRecord(observedCase));
        expect(events._unsafeUnwrap()).toStrictEqual([toEventRecord(moderationEvent)]);
        expect(resolved._unsafeUnwrap()).toMatchObject({ status: 'resolved' });
        expect(reason._unsafeUnwrap()).toMatchObject({ reason: 'Updated reason' });
        expect(voided._unsafeUnwrap()).toMatchObject({ status: 'void' });
        expect(note._unsafeUnwrap()).toStrictEqual(toEventRecord(moderationEvent));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            action: 'warn',
            actorUserId: 'mod-1',
            caseNumber: 7,
            guildId: 'guild-1',
            reason: 'Repeated spam',
            targetUserId: 'user-1',
        });
        expect(db.client.queryCalls[2]?.args).toStrictEqual({
            action: 'ban',
            guildId: 'guild-1',
            since: '2026-07-03T07:00:00.000Z',
            statuses: ['open', 'resolved'],
            targetUserId: 'user-1',
        });
    });

    it('routes moderation temporary actions through Convex with Date conversion', async () => {
        const completed = { ...temporaryAction, status: 'completed' as const };
        const db = createConvexDb({
            mutationResults: [temporaryAction, [{ ...temporaryAction, status: 'cancelled' }], completed],
            queryResults: [temporaryAction, [temporaryAction]],
        });

        const created = await createModerationTemporaryAction(db, {
            action: ' timeout ',
            caseId: ' case-1 ',
            expiresAt: new Date('2026-07-03T09:10:00.000Z'),
            guildId: ' guild-1 ',
            targetUserId: ' user-1 ',
        });
        const pending = await findPendingModerationTemporaryActionByTarget(db, {
            action: ' timeout ',
            guildId: ' guild-1 ',
            now: new Date('2026-07-03T08:30:00.000Z'),
            targetUserId: ' user-1 ',
        });
        const due = await listDueModerationTemporaryActions(db, {
            action: ' timeout ',
            limit: 10,
            now: new Date('2026-07-03T10:00:00.000Z'),
        });
        const cancelled = await cancelPendingModerationTemporaryActionsByTarget(db, {
            action: ' timeout ',
            excludeId: ' temporary-action-1 ',
            guildId: ' guild-1 ',
            targetUserId: ' user-1 ',
        });
        const updated = await updateModerationTemporaryActionStatus(db, {
            id: ' temporary-action-1 ',
            status: 'completed',
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toTemporaryActionRecord(temporaryAction));
        expect(pending._unsafeUnwrap()).toStrictEqual(toTemporaryActionRecord(temporaryAction));
        expect(due._unsafeUnwrap()).toStrictEqual([toTemporaryActionRecord(temporaryAction)]);
        expect(cancelled._unsafeUnwrap()).toStrictEqual([
            toTemporaryActionRecord({ ...temporaryAction, status: 'cancelled' }),
        ]);
        expect(updated._unsafeUnwrap()).toStrictEqual(toTemporaryActionRecord(completed));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            action: 'timeout',
            caseId: 'case-1',
            expiresAt: '2026-07-03T09:10:00.000Z',
            guildId: 'guild-1',
            targetUserId: 'user-1',
        });
    });

    it('maps validation and missing Convex records to existing moderation errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null],
        });

        const missingTarget = await createModerationCase(db, {
            action: 'warn',
            guildId: 'guild-1',
            targetUserId: ' ',
        });
        const invalidSince = await findRecentModerationCaseByTargetAction(db, {
            action: 'warn',
            guildId: 'guild-1',
            since: new Date(Number.NaN),
            targetUserId: 'user-1',
        });
        const missingCase = await findModerationCaseByGuildCaseNumber(db, {
            caseNumber: 7,
            guildId: 'guild-1',
        });
        const invalidExpiry = await createModerationTemporaryAction(db, {
            action: 'timeout',
            expiresAt: new Date(Number.NaN),
            guildId: 'guild-1',
            targetUserId: 'user-1',
        });
        const missingTemporaryAction = await updateModerationTemporaryActionStatus(db, {
            id: 'temporary-action-missing',
            status: 'completed',
        });

        expect(missingTarget._unsafeUnwrapErr()).toStrictEqual({ field: 'targetUserId', type: 'missing-input' });
        expect(invalidSince._unsafeUnwrapErr()).toStrictEqual({ field: 'since', type: 'invalid-value' });
        expect(missingCase._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(invalidExpiry._unsafeUnwrapErr()).toStrictEqual({ field: 'expiresAt', type: 'invalid-value' });
        expect(missingTemporaryAction._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });
});

function toCaseRecord(record: {
    action: string;
    actorUserId: string | null;
    caseNumber: number;
    createdAt: string;
    guildId: string;
    id: string;
    reason: string | null;
    status: string;
    targetChannelId: string | null;
    targetType: 'channel' | 'user';
    targetUserId: string | null;
    updatedAt: string;
}) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toEventRecord(record: typeof moderationEvent) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
    };
}

function toTemporaryActionRecord(record: {
    action: string;
    caseId: string | null;
    createdAt: string;
    expiresAt: string;
    guildId: string;
    id: string;
    status: 'cancelled' | 'completed' | 'failed' | 'pending';
    targetUserId: string;
    updatedAt: string;
}) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
        updatedAt: new Date(record.updatedAt),
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
