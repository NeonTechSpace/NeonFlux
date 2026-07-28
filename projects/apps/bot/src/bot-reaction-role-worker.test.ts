import {
    claimNextReactionRoleMemberOperation,
    claimNextReactionRolePanelOperation,
    completeReactionRolePanelOperation,
    deferReactionRolePanelOperation,
    pauseReactionRolePanelOperation,
    renewReactionRolePanelOperationLease,
    type ReactionRolePanelWorkerRecord,
    yieldReactionRolePanelOperation,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { createFluxerReactionRolePlatform } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { reactionRolesAllowed } from './bot-reaction-role-policy.js';
import { runNextReactionRoleOperation } from './bot-reaction-role-worker.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    claimNextReactionRoleMemberOperation: vi.fn(),
    claimNextReactionRolePanelOperation: vi.fn(),
    completeReactionRolePanelOperation: vi.fn(),
    deferReactionRolePanelOperation: vi.fn(),
    pauseReactionRolePanelOperation: vi.fn(),
    renewReactionRolePanelOperationLease: vi.fn(),
    yieldReactionRolePanelOperation: vi.fn(),
}));

vi.mock('@neonflux/fluxer', async (importActual) => ({
    ...(await importActual<typeof Fluxer>()),
    createFluxerReactionRolePlatform: vi.fn(),
}));

vi.mock('./bot-reaction-role-policy.js', () => ({
    reactionRolesAllowed: vi.fn(),
}));

describe('reaction-role worker state machine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(claimNextReactionRoleMemberOperation).mockResolvedValue(ok(null));
        vi.mocked(pauseReactionRolePanelOperation).mockResolvedValue(ok(true));
        vi.mocked(deferReactionRolePanelOperation).mockResolvedValue(ok(true));
        vi.mocked(renewReactionRolePanelOperationLease).mockResolvedValue(ok(true));
        vi.mocked(yieldReactionRolePanelOperation).mockResolvedValue(ok(true));
    });

    it('pauses claimed work without consuming provider actions when DEFCON blocks reaction roles', async () => {
        vi.mocked(claimNextReactionRolePanelOperation).mockResolvedValue(ok(createPanelOperation()));
        vi.mocked(reactionRolesAllowed).mockResolvedValue(false);

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'defcon_paused', status: 'deferred' });
        expect(pauseReactionRolePanelOperation).toHaveBeenCalledOnce();
        expect(createFluxerReactionRolePlatform).not.toHaveBeenCalled();
    });

    it('bounds high-cardinality completion work and yields the lease for fairness', async () => {
        vi.mocked(claimNextReactionRolePanelOperation).mockResolvedValue(
            ok(createPanelOperation({ step: 'cleanup_completed', type: 'update' }))
        );
        vi.mocked(reactionRolesAllowed).mockResolvedValue(true);
        vi.mocked(completeReactionRolePanelOperation).mockResolvedValue(ok('pending'));

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'completion_chunk_yielded', status: 'deferred' });
        expect(completeReactionRolePanelOperation).toHaveBeenCalledTimes(10);
        expect(yieldReactionRolePanelOperation).toHaveBeenCalledOnce();
    });

    it('persists a future retry time for transient provider failures', async () => {
        vi.mocked(claimNextReactionRolePanelOperation).mockResolvedValue(
            ok(createPanelOperation({ step: 'queued', type: 'publish' }))
        );
        vi.mocked(reactionRolesAllowed).mockResolvedValue(true);
        vi.mocked(createFluxerReactionRolePlatform).mockReturnValue({
            preflight: vi.fn().mockResolvedValue(err({ type: 'operation-failed', error: new Error('temporary') })),
        } as unknown as ReturnType<typeof createFluxerReactionRolePlatform>);

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ errorCode: 'preflight_failed', status: 'deferred' });
        const retry = vi.mocked(deferReactionRolePanelOperation).mock.calls[0]?.[1];
        expect(retry?.nextAttemptAt.getTime()).toBeGreaterThan(retry?.now.getTime() ?? Number.MAX_SAFE_INTEGER);
    });

    it('lets a failed panel without a managed message deactivate cleanly', async () => {
        vi.mocked(claimNextReactionRolePanelOperation).mockResolvedValue(
            ok(createPanelOperation({ messageId: null, step: 'queued', type: 'deactivate' }))
        );
        vi.mocked(reactionRolesAllowed).mockResolvedValue(true);
        vi.mocked(completeReactionRolePanelOperation).mockResolvedValue(ok('completed'));

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ operationType: 'panel', status: 'completed' });
        expect(createFluxerReactionRolePlatform).not.toHaveBeenCalled();
    });
});

function createPanelOperation(overrides: Partial<ReactionRolePanelWorkerRecord> = {}): ReactionRolePanelWorkerRecord {
    const now = new Date('2026-07-28T09:00:00.000Z');
    const version = {
        createdAt: now,
        fingerprint: 'fingerprint',
        id: 'version-1',
        payload: {
            content: '{roles}',
            embeds: [],
            mode: 'independent' as const,
            options: [
                {
                    emoji: { kind: 'unicode' as const, value: '✨' },
                    emojiKey: 'unicode:✨',
                    id: 'option-1',
                    roleId: 'role-1',
                    roleName: 'Updates',
                },
            ],
        },
        version: 1,
    };
    return {
        attemptCount: 1,
        channelId: 'channel-1',
        createdAt: now,
        deleteMessage: false,
        errorCode: null,
        generation: 1,
        guildId: 'guild-1',
        id: 'operation-1',
        leaseExpiresAt: new Date('2026-07-28T09:01:00.000Z'),
        leaseId: 'lease-1',
        leaseOwner: 'worker-1',
        messageId: 'message-1',
        nextAttemptAt: null,
        nonce: 'nonce-1',
        panelId: 'panel-1',
        previousVersion: version,
        revokeOwnedRoles: false,
        status: 'running',
        step: 'cleanup_completed',
        targetVersion: version,
        type: 'update',
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
