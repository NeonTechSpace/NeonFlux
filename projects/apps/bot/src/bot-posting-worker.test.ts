import {
    claimNextDashboardPostingOperation,
    completeDashboardPostingOperationSent,
    deferDashboardPostingOperationBeforeSend,
    failDashboardPostingOperationPermanently,
    isDashboardPostingGuildRunnable,
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

const readStructure = vi.fn();
const sendMessage = vi.fn();

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    claimNextDashboardPostingOperation: vi.fn(),
    completeDashboardPostingOperationSent: vi.fn(),
    deferDashboardPostingOperationBeforeSend: vi.fn(),
    failDashboardPostingOperationPermanently: vi.fn(),
    isDashboardPostingGuildRunnable: vi.fn(),
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
            guildStructure: { read: readStructure },
            messages: { send: sendMessage },
        } as unknown as ReturnType<typeof createFluxerPlatform>);
        readStructure.mockResolvedValue(
            ok({ channels: [{ id: 'channel-1', name: 'general', type: 0 }], guildId: 'guild-1', roles: [] })
        );
        vi.mocked(isDashboardPostingGuildRunnable).mockResolvedValue(ok(true));
        vi.mocked(deferDashboardPostingOperationBeforeSend).mockResolvedValue(ok(true));
        vi.mocked(failDashboardPostingOperationPermanently).mockResolvedValue(ok(null));
        vi.mocked(markDashboardPostingOperationUnknown).mockResolvedValue(ok(null));
        vi.mocked(readDashboardPostingOperationForWorker).mockResolvedValue(ok(null));
    });

    it('marks send-start before provider I/O and disables mention parsing', async () => {
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
        const markedOrder = vi.mocked(markDashboardPostingOperationSendStarted).mock.invocationCallOrder[0];
        const sentOrder = sendMessage.mock.invocationCallOrder[0];
        if (markedOrder === undefined || sentOrder === undefined) throw new Error('Expected mark and send calls.');
        expect(markedOrder).toBeLessThan(sentOrder);
        expect(sendMessage).toHaveBeenCalledWith({
            allowedMentions: { parse: [] },
            channelId: 'channel-1',
            content: 'Hello',
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
        expect(markDashboardPostingOperationUnknown).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'send_outcome_unknown', operationId: 'operation-1' })
        );
        expect(deferDashboardPostingOperationBeforeSend).not.toHaveBeenCalled();
        expect(recordDashboardPostingOperationExternalMessage).not.toHaveBeenCalled();
    });

    it('defers a transient preflight failure without starting a send', async () => {
        vi.mocked(claimNextDashboardPostingOperation).mockResolvedValue(ok(createOperation()));
        readStructure.mockResolvedValue(err({ type: 'operation-failed', error: new Error('temporary') }));

        const result = await runNextDashboardPostingOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'guild_preflight_failed', status: 'deferred' });
        expect(deferDashboardPostingOperationBeforeSend).toHaveBeenCalled();
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
        guildId: 'guild-1',
        id: 'operation-1',
        leaseExpiresAt: new Date('2026-07-13T12:01:00.000Z'),
        leaseId: 'lease-1',
        leaseOwner: 'worker-1',
        messageId: null,
        nextAttemptAt: null,
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
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
