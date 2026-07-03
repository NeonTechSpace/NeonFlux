import { describe, expect, it } from 'vitest';

import { transformPostgresRow } from './transform.js';

describe('migration transform', () => {
    it('maps Postgres UUID primary and foreign keys to legacy identifiers', () => {
        const doc = transformPostgresRow(
            {
                case_id: '11111111-1111-4111-8111-111111111111',
                guild_id: '1514728169414852609',
                id: '22222222-2222-4222-8222-222222222222',
            },
            [
                { dataType: 'uuid', name: 'id' },
                { dataType: 'uuid', name: 'case_id' },
                { dataType: 'text', name: 'guild_id' },
            ]
        );

        expect(doc).toEqual({
            caseLegacyId: '11111111-1111-4111-8111-111111111111',
            guildId: '1514728169414852609',
            legacyId: '22222222-2222-4222-8222-222222222222',
        });
    });

    it('omits null optional fields and converts timestamps to ISO strings', () => {
        const doc = transformPostgresRow({
            created_at: new Date('2026-07-03T10:15:00.000Z'),
            reason: null,
            updated_at: undefined,
        });

        expect(doc).toEqual({
            createdAt: '2026-07-03T10:15:00.000Z',
        });
    });

    it('preserves encrypted OAuth payloads without decrypting them', () => {
        const doc = transformPostgresRow({
            access_token: {
                authTag: 'tag',
                ciphertext: 'ciphertext',
                iv: 'iv',
                version: 'v1',
            },
        });

        expect(doc.accessToken).toEqual({
            authTag: 'tag',
            ciphertext: 'ciphertext',
            iv: 'iv',
            version: 'v1',
        });
    });
});
