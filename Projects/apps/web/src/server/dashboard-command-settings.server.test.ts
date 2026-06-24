import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { findGuildCommandSettingsByGuildId, upsertGuildCommandPrefix } from '@neonflux/db';
import type { GuildCommandSettingsRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    loadDashboardCommandSettingsPageData,
    updateDashboardGuildCommandPrefix,
} from './dashboard-command-settings.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findGuildCommandSettingsByGuildId: vi.fn(),
        upsertGuildCommandPrefix: vi.fn(),
    };
});

describe('dashboard command settings', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue(createGuildPageData());
        vi.mocked(findGuildCommandSettingsByGuildId).mockResolvedValue(err('not-found'));
        vi.mocked(upsertGuildCommandPrefix).mockResolvedValue(ok(createCommandSettingsRecord('?')));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns the default prefix when command settings are missing', async () => {
        await expect(loadDashboardCommandSettingsPageData(request, 'guild-1')).resolves.toStrictEqual({
            ...createGuildPageData(),
            commandSettings: {
                prefix: '!',
                isDefaultPrefix: true,
            },
        });
    });

    it('returns the stored prefix for an accessible guild', async () => {
        vi.mocked(findGuildCommandSettingsByGuildId).mockResolvedValueOnce(ok(createCommandSettingsRecord('?')));

        await expect(loadDashboardCommandSettingsPageData(request, 'guild-1')).resolves.toStrictEqual({
            ...createGuildPageData(),
            commandSettings: {
                prefix: '?',
                isDefaultPrefix: false,
            },
        });
    });

    it('returns inaccessible guild states without reading command settings', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });

        await expect(loadDashboardCommandSettingsPageData(request, 'guild-2')).resolves.toStrictEqual({
            type: 'not-found',
        });
        expect(findGuildCommandSettingsByGuildId).not.toHaveBeenCalled();
    });

    it('maps invalid stored command settings to database-error', async () => {
        vi.mocked(findGuildCommandSettingsByGuildId).mockResolvedValueOnce(err('invalid-config'));

        await expect(loadDashboardCommandSettingsPageData(request, 'guild-1')).resolves.toStrictEqual({
            type: 'database-error',
        });
    });

    it('updates the prefix after re-checking dashboard access', async () => {
        vi.mocked(upsertGuildCommandPrefix).mockResolvedValueOnce(ok(createCommandSettingsRecord('?1')));

        const result = await updateDashboardGuildCommandPrefix(request, { guildId: 'guild-1', prefix: '?1' });

        expect(loadDashboardGuildPageData).toHaveBeenCalledWith(request, 'guild-1');
        expect(upsertGuildCommandPrefix).toHaveBeenCalledWith({}, { guildId: 'guild-1', prefix: '?1' });
        expect(result).toStrictEqual({
            type: 'updated',
            commandSettings: {
                prefix: '?1',
                isDefaultPrefix: false,
            },
        });
    });

    it('does not write when the guild is inaccessible', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(
            updateDashboardGuildCommandPrefix(request, { guildId: 'guild-1', prefix: '?' })
        ).resolves.toStrictEqual({
            type: 'not-found',
        });
        expect(upsertGuildCommandPrefix).not.toHaveBeenCalled();
    });

    it('returns a clear validation error for invalid prefixes', async () => {
        vi.mocked(upsertGuildCommandPrefix).mockResolvedValueOnce(err('invalid-prefix'));

        await expect(
            updateDashboardGuildCommandPrefix(request, { guildId: 'guild-1', prefix: 'abc' })
        ).resolves.toStrictEqual({
            type: 'invalid-prefix',
            message: COMMAND_PREFIX_INVALID_MESSAGE,
        });
    });

    it('maps DB write failures to database-error', async () => {
        vi.mocked(upsertGuildCommandPrefix).mockResolvedValueOnce(err('database-error'));

        await expect(
            updateDashboardGuildCommandPrefix(request, { guildId: 'guild-1', prefix: '?' })
        ).resolves.toStrictEqual({
            type: 'database-error',
        });
    });
});

function createGuildPageData() {
    return {
        type: 'guild' as const,
        mode: 'multi' as const,
        guild: {
            id: 'guild-1',
            name: 'Guild One',
        },
    };
}

function createCommandSettingsRecord(prefix: string): GuildCommandSettingsRecord {
    return {
        guildId: 'guild-1',
        prefix,
        createdAt: new Date('2026-06-24T00:00:00.000Z'),
        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
    };
}
