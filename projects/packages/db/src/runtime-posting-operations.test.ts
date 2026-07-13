import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    claimNextDashboardPostingOperation,
    enqueueDashboardPostingOperation,
    normalizeDashboardPostingPayload,
} from './runtime-posting-operations.js';

describe('dashboard posting operation runtime', () => {
    it('normalizes JSON-safe payloads without prototype mutation', () => {
        const embed = JSON.parse('{"__proto__":{"polluted":true},"title":"Safe"}') as Record<string, unknown>;

        const result = normalizeDashboardPostingPayload({ embeds: [embed] })._unsafeUnwrap();
        const normalized = result.embeds[0] as Record<string, unknown>;

        expect(Object.hasOwn(normalized, '__proto__')).toBe(true);
        expect(normalized.__proto__).toStrictEqual({ polluted: true });
        expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('rejects circular and oversized payloads before calling Convex', async () => {
        const circular: unknown[] = [];
        circular.push(circular);
        const db = createConvexDb();

        expect(normalizeDashboardPostingPayload({ embeds: circular })._unsafeUnwrapErr()).toStrictEqual({
            field: 'message',
            type: 'invalid-value',
        });
        const oversized = await enqueueDashboardPostingOperation(db, {
            actorUserId: 'actor-1',
            content: 'x'.repeat(128 * 1024),
            guildId: 'guild-1',
            payloadHash: 'hash-1',
            requestKey: 'request-1',
            requestedChannelId: 'channel-1',
        });
        expect(oversized._unsafeUnwrapErr()).toStrictEqual({ field: 'message', type: 'invalid-value' });
        expect(db.client.mutationCalls).toHaveLength(0);
    });

    it('converts queue records and serializes worker lease timestamps', async () => {
        const db = createConvexDb([
            { created: true, operation: createConvexOperation() },
            createConvexWorkerOperation(),
        ]);

        const enqueued = await enqueueDashboardPostingOperation(db, {
            actorUserId: 'actor-1',
            content: ' Hello ',
            embeds: [],
            guildId: 'guild-1',
            payloadHash: 'hash-1',
            requestKey: 'request-1',
            requestedChannelId: 'channel-1',
        });
        const claimed = await claimNextDashboardPostingOperation(db, {
            leaseExpiresAt: new Date('2026-07-13T12:01:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-13T12:00:00.000Z'),
        });

        expect(enqueued._unsafeUnwrap().operation.createdAt).toStrictEqual(new Date('2026-07-13T12:00:00.000Z'));
        expect(claimed._unsafeUnwrap()?.leaseExpiresAt).toStrictEqual(new Date('2026-07-13T12:01:00.000Z'));
        expect(db.client.mutationCalls[0]?.args).toMatchObject({ content: 'Hello', requestKey: 'request-1' });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            leaseExpiresAt: '2026-07-13T12:01:00.000Z',
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: '2026-07-13T12:00:00.000Z',
        });
    });

    it('maps request-key conflicts without exposing database details', async () => {
        const db = createConvexDb([], [new Error('posting-request-key-conflict: secret')]);
        const result = await enqueueDashboardPostingOperation(db, {
            actorUserId: 'actor-1',
            content: 'Hello',
            guildId: 'guild-1',
            payloadHash: 'hash-1',
            requestKey: 'request-1',
            requestedChannelId: 'channel-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ field: 'requestKey', type: 'conflict' });
    });
});

function createConvexOperation() {
    return {
        actorDisplayName: null,
        actorUsername: null,
        actorUserId: 'actor-1',
        attemptCount: 0,
        completedAt: null,
        contentLength: 5,
        createdAt: '2026-07-13T12:00:00.000Z',
        embedCount: 0,
        errorCode: null,
        guildId: 'guild-1',
        id: 'operation-1',
        messageId: null,
        nextAttemptAt: null,
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        sentChannelId: null,
        status: 'running',
        updatedAt: '2026-07-13T12:00:00.000Z',
    };
}

function createConvexWorkerOperation() {
    return {
        ...createConvexOperation(),
        content: 'Hello',
        embeds: [],
        externalChannelId: null,
        externalMessageId: null,
        leaseExpiresAt: '2026-07-13T12:01:00.000Z',
        leaseId: 'lease-1',
        leaseOwner: 'worker-1',
        sendStartedAt: null,
    };
}

function createConvexDb(mutationResults: unknown[] = [], mutationErrors: Error[] = []) {
    const results = [...mutationResults];
    const errors = [...mutationErrors];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = errors.shift();
            if (error) return Promise.reject(error);
            return Promise.resolve(results.shift());
        },
        query(): Promise<unknown> {
            return Promise.resolve(null);
        },
    };
    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex' as const,
        serviceName: 'web' as const,
    };
}
