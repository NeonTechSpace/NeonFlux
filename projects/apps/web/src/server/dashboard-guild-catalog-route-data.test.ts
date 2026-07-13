import { describe, expect, it } from 'vitest';

import { toDashboardGuildCatalogReadResult } from './dashboard-guild-catalog-route-data.js';

describe('dashboard guild catalog route data', () => {
    it('preserves the authoritative manageable guild list', () => {
        expect(
            toDashboardGuildCatalogReadResult({
                type: 'dashboard',
                viewModel: {
                    type: 'guild-list',
                    mode: 'multi',
                    guilds: [{ id: 'guild-1', name: 'Guild One' }],
                    botInviteUrl: 'https://fluxer.app/invite',
                },
            })
        ).toStrictEqual({
            type: 'catalog',
            catalog: {
                guilds: [{ id: 'guild-1', name: 'Guild One' }],
                mode: 'multi',
                botInviteUrl: 'https://fluxer.app/invite',
            },
        });
    });

    it('returns an empty catalog when current permissions no longer authorize the single server', () => {
        expect(
            toDashboardGuildCatalogReadResult({
                type: 'dashboard',
                viewModel: {
                    type: 'single-unauthorized',
                    configuredGuildId: 'guild-1',
                    configuredGuildName: 'Guild One',
                },
            })
        ).toStrictEqual({
            type: 'catalog',
            catalog: {
                guilds: [],
                mode: 'single',
            },
        });
    });

    it('keeps transient infrastructure failures distinct from a confirmed empty catalog', () => {
        expect(toDashboardGuildCatalogReadResult({ type: 'guild-lookup-failed' })).toStrictEqual({
            type: 'unavailable',
        });
    });
});
