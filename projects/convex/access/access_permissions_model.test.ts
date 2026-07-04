import { describe, expect, it } from 'vitest';

import {
    buildCommandPermissionRuleDocument,
    buildDashboardPermissionRuleDocument,
    normalizeCommandPermissionLookupInput,
    normalizeGuildIds,
    normalizeRequiredGuildId,
    toCommandPermissionRuleRecord,
    toDashboardPermissionRuleRecord,
} from './access_permissions_model.js';

describe('access permission model', () => {
    it('normalizes command permission rules to the app-facing contract', () => {
        const document = buildCommandPermissionRuleDocument(
            {
                guildId: ' guild-1 ',
                roleIds: [' role-1 ', ''],
                targetId: ' settings ',
                targetType: 'category',
                userIds: [' user-1 '],
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'rule-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T08:00:00.000Z',
                guildId: 'guild-1',
                legacyId: 'rule-1',
                roleIds: ['role-1'],
                targetId: 'settings',
                targetType: 'category',
                updatedAt: '2026-07-03T08:00:00.000Z',
                userIds: ['user-1'],
            },
        });

        if (!document.ok) {
            throw new Error('Expected command permission rule document.');
        }

        expect(toCommandPermissionRuleRecord(document.value)).toEqual({
            createdAt: '2026-07-03T08:00:00.000Z',
            guildId: 'guild-1',
            id: 'rule-1',
            roleIds: ['role-1'],
            targetId: 'settings',
            targetType: 'category',
            updatedAt: '2026-07-03T08:00:00.000Z',
            userIds: ['user-1'],
        });
    });

    it('preserves command rule legacy identity and created timestamp on update', () => {
        expect(
            buildCommandPermissionRuleDocument(
                {
                    guildId: 'guild-1',
                    roleIds: ['role-2'],
                    targetId: 'settings.prefix',
                    targetType: 'command',
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
                guildId: 'guild-1',
                legacyId: 'existing-rule',
                roleIds: ['role-2'],
                targetId: 'settings.prefix',
                targetType: 'command',
                updatedAt: '2026-07-03T08:00:00.000Z',
                userIds: [],
            },
        });
    });

    it('normalizes dashboard permission rules', () => {
        const document = buildDashboardPermissionRuleDocument(
            {
                guildId: ' guild-1 ',
                roleIds: [' role-1 '],
                userIds: [' user-1 ', ''],
            },
            '2026-07-03T08:00:00.000Z'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T08:00:00.000Z',
                guildId: 'guild-1',
                roleIds: ['role-1'],
                updatedAt: '2026-07-03T08:00:00.000Z',
                userIds: ['user-1'],
            },
        });

        if (!document.ok) {
            throw new Error('Expected dashboard permission rule document.');
        }

        expect(toDashboardPermissionRuleRecord(document.value)).toEqual(document.value);
    });

    it('rejects invalid command lookup input', () => {
        expect(normalizeCommandPermissionLookupInput({ targetId: 'settings', targetType: 'category' })).toEqual({
            error: 'missing-guild-id',
            ok: false,
        });
        expect(
            normalizeCommandPermissionLookupInput({ guildId: 'guild-1', targetId: 'settings', targetType: 'bad' })
        ).toEqual({
            error: 'invalid-target-type',
            ok: false,
        });
        expect(normalizeCommandPermissionLookupInput({ guildId: 'guild-1', targetType: 'category' })).toEqual({
            error: 'missing-target-id',
            ok: false,
        });
    });

    it('normalizes guild ids and imported timestamps', () => {
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredGuildId(' ')).toEqual({ error: 'missing-guild-id', ok: false });
        expect(normalizeGuildIds([' guild-2 ', '', 'guild-1'])).toEqual(['guild-2', 'guild-1']);
        expect(
            buildDashboardPermissionRuleDocument(
                {
                    createdAt: '2026-07-02 09:30:00+02',
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
});
