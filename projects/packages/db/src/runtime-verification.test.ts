import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    deleteVerificationFlow,
    findActiveVerificationRecord,
    findEnabledVerificationFlowByReaction,
    listVerificationFlowsByGuildId,
    revokeVerificationRecord,
    upsertVerificationFlow,
    upsertVerificationRecord,
} from './runtime-verification.js';

const flow = {
    channelId: 'channel-1',
    createdAt: '2026-07-03T08:00:00.000Z',
    emojiKey: '✅',
    enabled: true,
    guildId: 'guild-1',
    id: 'flow-1',
    messageId: 'message-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
    verifiedRoleId: 'role-1',
};
const record = {
    guildId: 'guild-1',
    id: 'record-1',
    method: 'reaction',
    revokedAt: null,
    userId: 'user-1',
    verifiedAt: '2026-07-03T08:00:00.000Z',
};
const revokedRecord = {
    ...record,
    revokedAt: '2026-07-03T09:00:00.000Z',
};

describe('Convex verification database functions', () => {
    it('upserts, lists, finds, and deletes verification flows through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [flow, null],
            queryResults: [[flow], flow],
        });

        const upserted = await upsertVerificationFlow(db, {
            channelId: ' channel-1 ',
            emojiKey: ' ✅ ',
            enabled: true,
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            verifiedRoleId: ' role-1 ',
        });
        const listed = await listVerificationFlowsByGuildId(db, { enabled: true, guildId: 'guild-1' });
        const found = await findEnabledVerificationFlowByReaction(db, {
            emojiKey: '✅',
            guildId: 'guild-1',
            messageId: 'message-1',
        });
        const deleted = await deleteVerificationFlow(db, { guildId: 'guild-1', messageId: 'message-1' });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toFlowRecord(flow));
        expect(listed._unsafeUnwrap()).toStrictEqual([toFlowRecord(flow)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toFlowRecord(flow));
        expect(deleted._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'channel-1',
            emojiKey: '✅',
            enabled: true,
            guildId: 'guild-1',
            messageId: 'message-1',
            verifiedRoleId: 'role-1',
        });
    });

    it('upserts, finds, and revokes verification records through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [record, revokedRecord],
            queryResults: [record],
        });

        const upserted = await upsertVerificationRecord(db, {
            guildId: ' guild-1 ',
            method: ' reaction ',
            userId: ' user-1 ',
        });
        const active = await findActiveVerificationRecord(db, {
            guildId: 'guild-1',
            userId: 'user-1',
        });
        const revoked = await revokeVerificationRecord(db, {
            guildId: 'guild-1',
            userId: 'user-1',
        });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toVerificationRecord(record));
        expect(active._unsafeUnwrap()).toStrictEqual(toVerificationRecord(record));
        expect(revoked._unsafeUnwrap()).toStrictEqual(toVerificationRecord(revokedRecord));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            method: 'reaction',
            userId: 'user-1',
        });
    });

    it('maps validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingRole = await upsertVerificationFlow(db, {
            channelId: 'channel-1',
            emojiKey: '✅',
            guildId: 'guild-1',
            messageId: 'message-1',
            verifiedRoleId: ' ',
        });
        const missingEmoji = await findEnabledVerificationFlowByReaction(db, {
            emojiKey: ' ',
            guildId: 'guild-1',
            messageId: 'message-1',
        });
        const missingMethod = await upsertVerificationRecord(db, {
            guildId: 'guild-1',
            method: ' ',
            userId: 'user-1',
        });

        expect(missingRole._unsafeUnwrapErr()).toStrictEqual({
            field: 'verifiedRoleId',
            type: 'missing-input',
        });
        expect(missingEmoji._unsafeUnwrapErr()).toStrictEqual({ field: 'emojiKey', type: 'missing-input' });
        expect(missingMethod._unsafeUnwrapErr()).toStrictEqual({ field: 'method', type: 'missing-input' });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('maps Convex nulls and failures to existing repository errors', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('guild-not-found')],
            queryResults: [null, null],
        });

        const missingFlow = await findEnabledVerificationFlowByReaction(db, {
            emojiKey: '✅',
            guildId: 'guild-1',
            messageId: 'message-1',
        });
        const missingRecord = await findActiveVerificationRecord(db, {
            guildId: 'guild-1',
            userId: 'user-1',
        });
        const failedUpsert = await upsertVerificationRecord(db, {
            guildId: 'guild-1',
            method: 'reaction',
            userId: 'user-1',
        });

        expect(missingFlow._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingRecord._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(failedUpsert._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function toFlowRecord(record: typeof flow) {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        emojiKey: record.emojiKey,
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        updatedAt: new Date(record.updatedAt),
        verifiedRoleId: record.verifiedRoleId,
    };
}

function toVerificationRecord(input: typeof record | typeof revokedRecord) {
    return {
        guildId: input.guildId,
        id: input.id,
        method: input.method,
        revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
        userId: input.userId,
        verifiedAt: new Date(input.verifiedAt),
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
