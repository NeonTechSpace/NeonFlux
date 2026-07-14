import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { verifyProjectedStructureSnapshot } from './bot-blueprint-run-verification.js';

vi.mock('@neonflux/fluxer', () => ({
    readFluxerBotGuildStructure: vi.fn(),
}));

describe('Blueprint run verification fingerprints', () => {
    beforeEach(() => vi.clearAllMocks());

    it('matches equivalent projections regardless of object key insertion order', async () => {
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            ok({
                guildId: 'guild-1',
                guildName: 'Guild',
                roles: [role('role-1', 'Role')],
                categories: [],
                channels: [],
            } as never)
        );

        const result = await verifyProjectedStructureSnapshot(
            'token',
            'guild-1',
            {
                projectedSnapshot: {
                    version: 1,
                    guildName: 'Source',
                    guildId: 'source-guild',
                    roles: [
                        {
                            position: 1,
                            permissions: '0',
                            name: 'Role',
                            mentionable: false,
                            id: 'source-role',
                            hoist: false,
                            color: 0,
                        },
                    ],
                    categories: [],
                    channels: [],
                },
            },
            { 'source-role': 'role-1' }
        );

        expect(result).toMatchObject({ status: 'matched' });
        expect(result.expectedFingerprint).toBe(result.actualFingerprint);
    });

    it('preserves array order in projection fingerprints', async () => {
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            ok({
                guildId: 'guild-1',
                roles: [role('role-2', 'Second'), role('role-1', 'First')],
                categories: [],
                channels: [],
            } as never)
        );

        const result = await verifyProjectedStructureSnapshot(
            'token',
            'guild-1',
            {
                projectedSnapshot: {
                    version: 1,
                    guildId: 'guild-1',
                    roles: [role('role-1', 'First'), role('role-2', 'Second')],
                    categories: [],
                    channels: [],
                },
            },
            {}
        );

        expect(result.status).toBe('mismatch');
    });
});

function role(id: string, name: string) {
    return {
        id,
        name,
        position: 1,
        color: 0,
        permissions: '0',
        hoist: false,
        mentionable: false,
    };
}
