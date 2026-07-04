import { describe, expect, it } from 'vitest';

import {
    buildAutoroleRuleDocument,
    normalizeAutoroleRuleLimit,
    normalizeAutoroleRuleLookupInput,
    normalizeRequiredGuildId,
    toAutoroleRuleRecord,
} from './autoroles_model.js';

describe('autorole model', () => {
    it('normalizes autorole rule input to the app-facing contract', () => {
        const document = buildAutoroleRuleDocument(
            {
                guildId: ' guild-1 ',
                name: ' Member ',
                roleId: ' role-1 ',
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'rule-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: true,
                guildId: 'guild-1',
                legacyId: 'rule-1',
                name: 'Member',
                roleId: 'role-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized autorole rule.');
        }

        expect(toAutoroleRuleRecord(document.value)).toEqual({
            createdAt: '2026-07-03T08:00:00.000Z',
            enabled: true,
            guildId: 'guild-1',
            id: 'rule-1',
            name: 'Member',
            roleId: 'role-1',
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves legacy identity and created timestamp on update', () => {
        expect(
            buildAutoroleRuleDocument(
                {
                    enabled: false,
                    guildId: 'guild-1',
                    name: 'Verified Member',
                    roleId: 'role-1',
                },
                '2026-07-03T08:00:00.000Z',
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                    legacyId: 'existing-rule',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-02T08:00:00.000Z',
                enabled: false,
                guildId: 'guild-1',
                legacyId: 'existing-rule',
                name: 'Verified Member',
                roleId: 'role-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves imported timestamps and legacy ids', () => {
        expect(
            buildAutoroleRuleDocument(
                {
                    createdAt: '2026-07-02 09:30:00+02',
                    guildId: 'guild-1',
                    legacyId: 'legacy-rule',
                    roleId: 'role-1',
                    updatedAt: '2026-07-03 09:30:00+02',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:30:00.000Z',
                legacyId: 'legacy-rule',
                updatedAt: '2026-07-03T07:30:00.000Z',
            },
        });
    });

    it('drops blank optional names', () => {
        const document = buildAutoroleRuleDocument(
            {
                guildId: 'guild-1',
                name: ' ',
                roleId: 'role-1',
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'rule-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: true,
                guildId: 'guild-1',
                legacyId: 'rule-1',
                roleId: 'role-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized autorole rule.');
        }

        expect(toAutoroleRuleRecord(document.value).name).toBeNull();
    });

    it('rejects blank required fields and invalid timestamps', () => {
        expect(buildAutoroleRuleDocument({ roleId: 'role-1' }, '2026-07-03T08:00:00.000Z')).toEqual({
            error: { field: 'guildId', type: 'missing-input' },
            ok: false,
        });
        expect(buildAutoroleRuleDocument({ guildId: 'guild-1' }, '2026-07-03T08:00:00.000Z')).toEqual({
            error: { field: 'roleId', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildAutoroleRuleDocument(
                { createdAt: 'nope', guildId: 'guild-1', roleId: 'role-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'createdAt', type: 'invalid-value' },
            ok: false,
        });
    });

    it('normalizes lookup and limit helpers', () => {
        expect(normalizeAutoroleRuleLookupInput({ guildId: ' guild-1 ', roleId: ' role-1 ' })).toEqual({
            ok: true,
            value: {
                guildId: 'guild-1',
                roleId: 'role-1',
            },
        });
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredGuildId(' ')).toEqual({
            error: { field: 'guildId', type: 'missing-input' },
            ok: false,
        });
        expect(normalizeAutoroleRuleLimit(undefined)).toBe(500);
        expect(normalizeAutoroleRuleLimit(0)).toBe(1);
        expect(normalizeAutoroleRuleLimit(5_000)).toBe(1000);
    });
});
