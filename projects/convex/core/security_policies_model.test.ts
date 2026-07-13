import { describe, expect, it } from 'vitest';

import {
    buildGuildDefconExemptionDocument,
    buildGuildSecurityPolicyDocument,
    normalizeDefconExemptionLookupInput,
} from './security_policies_model.js';

describe('security policy model', () => {
    it('normalizes guild DEFCON policies to the app-facing contract', () => {
        const document = buildGuildSecurityPolicyDocument(
            {
                defconLevel: 2,
                guildId: ' guild-1 ',
            },
            '2026-07-03T08:00:00.000Z'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T08:00:00.000Z',
                defconLevel: 2,
                guildId: 'guild-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves policy created timestamp on update', () => {
        expect(
            buildGuildSecurityPolicyDocument(
                {
                    defconLevel: 1,
                    guildId: 'guild-1',
                },
                '2026-07-03T08:00:00.000Z',
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-02T08:00:00.000Z',
                defconLevel: 1,
                guildId: 'guild-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves imported policy timestamps', () => {
        expect(
            buildGuildSecurityPolicyDocument(
                {
                    createdAt: '2026-07-02 09:30:00+02',
                    defconLevel: 3,
                    guildId: 'guild-1',
                    updatedAt: '2026-07-03 09:30:00+02',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:30:00.000Z',
                updatedAt: '2026-07-03T07:30:00.000Z',
            },
        });
    });

    it('rejects invalid policy input', () => {
        expect(buildGuildSecurityPolicyDocument({ defconLevel: 2 }, '2026-07-03T08:00:00.000Z')).toEqual({
            error: 'missing-guild-id',
            ok: false,
        });
        expect(
            buildGuildSecurityPolicyDocument({ defconLevel: 4, guildId: 'guild-1' }, '2026-07-03T08:00:00.000Z')
        ).toEqual({
            error: 'invalid-defcon-level',
            ok: false,
        });
        expect(
            buildGuildSecurityPolicyDocument(
                { createdAt: 'nope', defconLevel: 2, guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: 'invalid-created-at',
            ok: false,
        });
        expect(
            buildGuildSecurityPolicyDocument(
                { defconLevel: 2, guildId: 'guild-1', updatedAt: 'nope' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: 'invalid-updated-at',
            ok: false,
        });
    });

    it('normalizes DEFCON exemption documents', () => {
        const document = buildGuildDefconExemptionDocument(
            {
                category: ' bot-mention ',
                guildId: ' guild-1 ',
            },
            '2026-07-03T08:00:00.000Z'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                category: 'bot-mention',
                createdAt: '2026-07-03T08:00:00.000Z',
                guildId: 'guild-1',
            },
        });
    });

    it('preserves imported exemption timestamps', () => {
        expect(
            buildGuildDefconExemptionDocument(
                {
                    category: 'bot-mention',
                    createdAt: '2026-07-02 09:30:00+02',
                    guildId: 'guild-1',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            ok: true,
            value: {
                category: 'bot-mention',
                createdAt: '2026-07-02T07:30:00.000Z',
                guildId: 'guild-1',
            },
        });
    });

    it('rejects invalid exemption lookup input', () => {
        expect(normalizeDefconExemptionLookupInput({ category: 'verification' })).toEqual({
            error: 'missing-guild-id',
            ok: false,
        });
        expect(normalizeDefconExemptionLookupInput({ guildId: 'guild-1' })).toEqual({
            error: 'missing-category',
            ok: false,
        });
        expect(
            buildGuildDefconExemptionDocument(
                { category: 'verification', createdAt: 'nope', guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: 'invalid-created-at',
            ok: false,
        });
    });
});
