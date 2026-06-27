import { expirePendingVcGeneratorControlRequests } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { createVcGeneratorMaintenanceScheduler, runVcGeneratorMaintenance } from './bot-vc-generator-maintenance.js';

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        expirePendingVcGeneratorControlRequests: vi.fn(),
    };
});

describe('VC generator maintenance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(expirePendingVcGeneratorControlRequests).mockResolvedValue(ok([createControlRequest()]));
    });

    it('expires pending control requests due before now', async () => {
        const now = new Date('2026-06-26T12:15:00.000Z');
        const result = await runVcGeneratorMaintenance(createContext(), { now });

        expect(result._unsafeUnwrap()).toStrictEqual({
            expiredControlRequests: 1,
        });
        expect(expirePendingVcGeneratorControlRequests).toHaveBeenCalledWith(
            {},
            {
                now,
            }
        );
    });

    it('maps repository failures to bot route failures', async () => {
        vi.mocked(expirePendingVcGeneratorControlRequests).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await runVcGeneratorMaintenance(createContext(), {
            now: new Date('2026-06-26T12:15:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('logs completed scheduler work only when rows changed', async () => {
        const logger = createLogger();
        const scheduler = createVcGeneratorMaintenanceScheduler({
            createContext,
            logger,
            now: () => new Date('2026-06-26T12:15:00.000Z'),
        });

        await scheduler.runOnce();

        expect(logger.info).toHaveBeenCalledWith('vc_generator.maintenance_completed', {
            expiredControlRequests: 1,
        });
    });

    it('does not log empty scheduler runs', async () => {
        const logger = createLogger();
        vi.mocked(expirePendingVcGeneratorControlRequests).mockResolvedValueOnce(ok([]));
        const scheduler = createVcGeneratorMaintenanceScheduler({
            createContext,
            logger,
            now: () => new Date('2026-06-26T12:15:00.000Z'),
        });

        await scheduler.runOnce();

        expect(logger.info).not.toHaveBeenCalled();
    });
});

function createContext(): BotFeatureHandlerContext {
    return {
        db: {},
        mode: {
            instanceMode: 'multi',
        },
        appEnv: 'production',
        guildDefconOverride: 'auto',
        client: {},
        botUserId: 'bot-1',
    } as BotFeatureHandlerContext;
}

function createControlRequest() {
    return {
        id: 'request-1',
        guildId: 'guild-1',
        generatedChannelId: 'generated-row-1',
        panelChannelId: 'panel-channel-1',
        targetChannelId: 'generated-voice-1',
        requesterUserId: 'user-1',
        controlAction: 'rename',
        status: 'expired',
        promptMessageId: null,
        value: null,
        errorMessage: 'expired-by-maintenance',
        expiresAt: new Date('2026-06-26T12:00:00.000Z'),
        completedAt: new Date('2026-06-26T12:15:00.000Z'),
        createdAt: new Date('2026-06-26T11:50:00.000Z'),
        updatedAt: new Date('2026-06-26T12:15:00.000Z'),
    };
}

function createLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}
