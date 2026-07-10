import { describe, expect, it } from 'vitest';

import { hasManageServerPermission, toDashboardGuild } from './permissions.js';

describe('toDashboardGuild', () => {
    it('maps guild icon hashes to Fluxer icon URLs', () => {
        expect(
            toDashboardGuild({
                id: '1514728169414852609',
                name: 'NeonSpace',
                iconHash: 'guild-icon-hash',
                permissions: '32',
            })
        ).toStrictEqual({
            id: '1514728169414852609',
            name: 'NeonSpace',
            iconUrl: 'https://fluxerusercontent.com/icons/1514728169414852609/guild-icon-hash.webp?size=80',
            canManage: true,
            botInstalled: false,
        });
    });

    it('uses gif for animated guild icon hashes', () => {
        expect(
            toDashboardGuild({
                id: '1514728169414852609',
                iconHash: 'a_guild-icon-hash',
                permissions: '32',
            }).iconUrl
        ).toBe('https://fluxerusercontent.com/icons/1514728169414852609/a_guild-icon-hash.gif?size=80');
    });
});

describe('hasManageServerPermission', () => {
    it('recognizes Administrator as implying Manage Server', () => {
        expect(hasManageServerPermission(8)).toBe(true);
        expect(hasManageServerPermission('8')).toBe(true);
        expect(hasManageServerPermission(['ADMINISTRATOR'])).toBe(true);
    });

    it('rejects unsafe numeric permission values', () => {
        expect(hasManageServerPermission(-1)).toBe(false);
        expect(hasManageServerPermission(Number.POSITIVE_INFINITY)).toBe(false);
        expect(hasManageServerPermission(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
        expect(hasManageServerPermission('-1')).toBe(false);
    });
});
