import {
    claimNextDashboardPostingOperation,
    completeDashboardPostingOperationSent,
    deferDashboardPostingOperationBeforeSend,
    failDashboardPostingOperationPermanently,
    markDashboardPostingOperationSendStarted,
    markDashboardPostingOperationUnknown,
    readDashboardPostingOperationForWorker,
    recordDashboardPostingOperationExternalMessage,
    type DashboardPostingOperationWorkerRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer/platform';
import type * as FluxerPlatform from '@neonflux/fluxer/platform';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { runNextDashboardPostingOperation } from './bot-posting-worker.js';

const resolveDashboardTarget = vi.fn();
const sendMessage = vi.fn();

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    claimNextDashboardPostingOperation: vi.fn(),
    completeDashboardPostingOperationSent: vi.fn(),
    deferDashboardPostingOperationBeforeSend: vi.fn(),
    failDashboardPostingOperationPermanently: vi.fn(),
    markDashboardPostingOperationSendStarted: vi.fn(),
    markDashboardPostingOperationUnknown: vi.fn(),
    readDashboardPostingOperationForWorker: vi.fn(),
    recordDashboardPostingOperationExternalMessage: vi.fn(),
}));

vi.mock('@neonflux/fluxer/platform', async (importActual) => ({
    ...(await importActual<typeof FluxerPlatform>()),
    createFluxerPlatform: vi.fn(),
}));

describe('dashboard posting worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createFluxerPlatform).mockReturnValue({
            messages: { resolveDashboardTarget, sendDashboard: sendMessage },
        } as unknown as ReturnType<typeof createFluxerPlatform>);
        resolveDashboardTarget.mockResolvedValue(ok({ guildId: 'guild-1', id: 'channel-1', name: 'general', type: 0 }));
        vi.mocked(deferDashboardPostingOperationBeforeSend).mockResolvedValue(ok(true));
        vi.mocked(failDashboardPostingOperationPermanently).mockResolvedValue(ok(null));
        vi.mocked(markDashboardPostingOperationUnknown).mockResolvedValue(ok(null));
        vi.mocked(readDashboardPostingOperationForWorker).mockResolvedValue(ok(null));
    });

    it('marks send-start before handing the canonical message to provider I/O', async () => {
        const operation = createOperation();
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(operation));
        vi.mocked(markDashboardPostingOperationSendStarted).mockResolvedValue(
            ok({ ...operation, sendStartedAt: new Date() })
        );
        sendMessage.mockResolvedValue(ok({ channelId: 'channel-1', id: 'message-1' }));
        vi.mocked(recordDashboardPostingOperationExternalMessage).mockResolvedValue(
            ok({ ...operation, externalChannelId: 'channel-1', externalMessageId: 'message-1' })
        );
        vi.mocked(completeDashboardPostingOperationSent).mockResolvedValue(ok({ ...operation, status: 'sent' }));

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ operationId: 'operation-1', status: 'sent' });
        if (result.status !== 'sent') throw new Error('Expected successful-send timings.');
        expect(Object.values(result.timings).every(Number.isFinite)).toBe(true);
        const markedOrder = vi.mocked(markDashboardPostingOperationSendStarted).mock.invocationCallOrder[0];
        const sentOrder = sendMessage.mock.invocationCallOrder[0];
        if (markedOrder === undefined || sentOrder === undefined) throw new Error('Expected mark and send calls.');
        expect(markedOrder).toBeLessThan(sentOrder);
        expect(sendMessage).toHaveBeenCalledWith({
            allowMassMentions: false,
            channelId: 'channel-1',
            message: { content: 'Hello', embeds: [] },
        });
    });

    it('never retries after provider send starts and the outcome is ambiguous', async () => {
        const operation = createOperation();
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(operation));
        vi.mocked(markDashboardPostingOperationSendStarted).mockResolvedValue(
            ok({ ...operation, sendStartedAt: new Date() })
        );
        sendMessage.mockResolvedValue(err({ type: 'operation-failed', error: new Error('socket closed') }));

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ operationId: 'operation-1', status: 'unknown' });
        if (result.status !== 'unknown') throw new Error('Expected an unknown result.');
        expect(result.attemptCount).toBe(1);
        expectFiniteTiming(result.timings.claimMs);
        expectFiniteTiming(result.timings.completionPersistenceMs);
        expectFiniteTiming(result.timings.operationAgeMs);
        expectFiniteTiming(result.timings.preflightMs);
        expectFiniteTiming(result.timings.providerSendMs);
        expectFiniteTiming(result.timings.queueWaitMs);
        expectFiniteTiming(result.timings.sendStartPersistenceMs);
        expectFiniteTiming(result.timings.workerTotalMs);
        expect(markDashboardPostingOperationUnknown).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'send_outcome_unknown', operationId: 'operation-1' })
        );
        expect(deferDashboardPostingOperationBeforeSend).not.toHaveBeenCalled();
        expect(recordDashboardPostingOperationExternalMessage).not.toHaveBeenCalled();
    });

    it('defers a transient preflight failure without starting a send', async () => {
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(createOperation()));
        resolveDashboardTarget.mockResolvedValue(err({ type: 'operation-failed', error: new Error('temporary') }));

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'guild_preflight_failed', status: 'deferred' });
        if (result.status !== 'deferred' || result.operationId === 'unknown' || result.timings === undefined) {
            throw new Error('Expected a claimed deferred result.');
        }
        expectFiniteTiming(result.timings.claimMs);
        expectFiniteTiming(result.timings.completionPersistenceMs);
        expectFiniteTiming(result.timings.operationAgeMs);
        expectFiniteTiming(result.timings.preflightMs);
        expectFiniteTiming(result.timings.queueWaitMs);
        expectFiniteTiming(result.timings.workerTotalMs);
        expect(result.timings).not.toHaveProperty('providerSendMs');
        expect(deferDashboardPostingOperationBeforeSend).toHaveBeenCalled();
        expect(markDashboardPostingOperationSendStarted).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it.each([5, 998])('rejects non-text Fluxer channel type %s before starting a send', async (channelType) => {
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(createOperation()));
        resolveDashboardTarget.mockResolvedValue(
            ok({ guildId: 'guild-1', id: 'channel-1', name: 'not-text', type: channelType })
        );

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'channel_not_postable', status: 'permanent_failure' });
        if (result.status !== 'permanent_failure') throw new Error('Expected a permanent failure.');
        expectFiniteTiming(result.timings.completionPersistenceMs);
        expectFiniteTiming(result.timings.preflightMs);
        expect(markDashboardPostingOperationSendStarted).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a resolved channel owned by another guild before starting a send', async () => {
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(createOperation()));
        resolveDashboardTarget.mockResolvedValue(ok({ guildId: 'guild-2', id: 'channel-1', name: 'general', type: 0 }));

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'channel_not_postable', status: 'permanent_failure' });
        expect(markDashboardPostingOperationSendStarted).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('finalizes a persisted external message without sending again', async () => {
        const operation = createOperation({ externalChannelId: 'channel-1', externalMessageId: 'message-1' });
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(operation));
        vi.mocked(completeDashboardPostingOperationSent).mockResolvedValue(ok({ ...operation, status: 'sent' }));

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ operationId: 'operation-1', status: 'sent' });
        expect(createFluxerPlatform).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

function createOperation(
    overrides: Partial<DashboardPostingOperationWorkerRecord> = {}
): DashboardPostingOperationWorkerRecord {
    const now = new Date('2026-07-13T12:00:00.000Z');
    return {
        actorDisplayName: 'Neonsy',
        actorUsername: 'neonsy',
        actorUserId: 'actor-1',
        allowMassMentions: false,
        attemptCount: 1,
        completedAt: null,
        content: 'Hello',
        contentLength: 5,
        createdAt: now,
        embedCount: 0,
        embeds: [],
        errorCode: null,
        externalChannelId: null,
        externalMessageId: null,
        followupOperationId: null,
        guildId: 'guild-1',
        id: 'operation-1',
        leaseExpiresAt: new Date('2026-07-13T12:01:00.000Z'),
        leaseId: 'lease-1',
        leaseOwner: 'worker-1',
        messageId: null,
        nextAttemptAt: null,
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        resolution: null,
        resolvedAt: null,
        resolvedByUserId: null,
        retryOfOperationId: null,
        sendStartedAt: null,
        sentChannelId: null,
        status: 'running',
        updatedAt: now,
        ...overrides,
    };
}

function createContext(): BotFeatureHandlerContext {
    return {
        appEnv: 'production',
        client: {} as BotFeatureHandlerContext['client'],
        db: {} as BotFeatureHandlerContext['db'],
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode: { instanceMode: 'multi' },
    };
}

function expectFiniteTiming(value: number | undefined): void {
    expect(value).toBeTypeOf('number');
    expect(Number.isFinite(value)).toBe(true);
}
