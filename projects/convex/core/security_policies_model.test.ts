import { describe, expect, it } from 'vitest';

import {
    buildGuildDefconExemptionDocument,
    buildGuildSecurityPolicyDocument,
    normalizeDefconExemptionLookupInput,
    normalizeGuildIds,
    normalizeRequiredGuildId,
    toGuildDefconExemptionRecord,
    toGuildSecurityPolicyRecord,
} from './security_policies_model.js';

describe('security policy model', () => {
    it('normalizes guild DEFCON policies like the Postgres repository', () => {
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

        if (!document.ok) {
            throw new Error('Expected normalized security policy.');
        }

        expect(toGuildSecurityPolicyRecord(document.value)).toEqual(document.value);
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

    it('normalizes DEFCON exemption documents while preserving legacy ids', () => {
        const document = buildGuildDefconExemptionDocument(
            {
                category: ' bot-mention ',
                guildId: ' guild-1 ',
                legacyId: ' exemption-1 ',
            },
            '2026-07-03T08:00:00.000Z'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                category: 'bot-mention',
                createdAt: '2026-07-03T08:00:00.000Z',
                guildId: 'guild-1',
                legacyId: 'exemption-1',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized DEFCON exemption.');
        }

        expect(toGuildDefconExemptionRecord(document.value)).toEqual({
            category: 'bot-mention',
            createdAt: '2026-07-03T08:00:00.000Z',
            guildId: 'guild-1',
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
                '2026-07-03T08:00:00.000Z',
                () => 'exemption-1'
            )
        ).toEqual({
            ok: true,
            value: {
                category: 'bot-mention',
                createdAt: '2026-07-02T07:30:00.000Z',
                guildId: 'guild-1',
                legacyId: 'exemption-1',
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

    it('normalizes guild id list helpers', () => {
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredGuildId(' ')).toEqual({ error: 'missing-guild-id', ok: false });
        expect(normalizeGuildIds([' guild-2 ', '', 'guild-1'])).toEqual(['guild-2', 'guild-1']);
    });
});
