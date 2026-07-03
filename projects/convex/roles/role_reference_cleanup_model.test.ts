import { describe, expect, it } from 'vitest';

import {
    createEmptyDeletedRoleCleanupSummary,
    hasDeletedRoleCleanupChanges,
    normalizeDeletedRoleCleanupInput,
    removeRoleIdFromConfigArray,
    removeRoleIdFromStringArray,
    shouldDisablePrivateTicketPanel,
} from './role_reference_cleanup_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('deleted role reference cleanup model', () => {
    it('normalizes required guild and role IDs with an optional occurrence timestamp', () => {
        expect(
            normalizeDeletedRoleCleanupInput(
                {
                    guildId: ' guild-1 ',
                    occurredAt: '2026-07-03T09:15:00+01:00',
                    roleId: ' role-1 ',
                },
                now
            )
        ).toStrictEqual({
            ok: true,
            value: {
                guildId: 'guild-1',
                roleId: 'role-1',
                updatedAt: '2026-07-03T08:15:00.000Z',
            },
        });
        expect(
            normalizeDeletedRoleCleanupInput(
                {
                    guildId: 'guild-1',
                    roleId: 'role-1',
                },
                now
            )
        ).toStrictEqual({
            ok: true,
            value: {
                guildId: 'guild-1',
                roleId: 'role-1',
                updatedAt: now,
            },
        });
    });

    it('rejects blank IDs and invalid occurrence timestamps', () => {
        expect(
            normalizeDeletedRoleCleanupInput(
                {
                    guildId: ' ',
                    roleId: 'role-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'guildId', type: 'missing-input' },
            ok: false,
        });
        expect(
            normalizeDeletedRoleCleanupInput(
                {
                    guildId: 'guild-1',
                    occurredAt: 'not-a-date',
                    roleId: 'role-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'occurredAt', type: 'invalid-value' },
            ok: false,
        });
    });

    it('tracks whether a cleanup summary changed', () => {
        const unchanged = createEmptyDeletedRoleCleanupSummary();
        const changed = {
            ...unchanged,
            reactionRoleAssignmentsRemoved: 1,
        };

        expect(hasDeletedRoleCleanupChanges(unchanged)).toBe(false);
        expect(hasDeletedRoleCleanupChanges(changed)).toBe(true);
    });

    it('removes only exact role ID matches from string arrays', () => {
        expect(removeRoleIdFromStringArray(['role-1', 'role-2', 'role-1-extra'], 'role-1')).toStrictEqual({
            changed: true,
            values: ['role-2', 'role-1-extra'],
        });
        expect(removeRoleIdFromStringArray(['role-2'], 'role-1')).toStrictEqual({ changed: false });
        expect(removeRoleIdFromStringArray(['role-1', 42], 'role-1')).toStrictEqual({ changed: false });
    });

    it('patches config arrays without rewriting invalid or unrelated config', () => {
        expect(
            removeRoleIdFromConfigArray(
                {
                    privateTickets: true,
                    staffRoleIds: ['role-delete', 'role-keep'],
                    topic: 'support',
                },
                'staffRoleIds',
                'role-delete'
            )
        ).toStrictEqual({
            changed: true,
            config: {
                privateTickets: true,
                staffRoleIds: ['role-keep'],
                topic: 'support',
            },
            values: ['role-keep'],
        });
        expect(
            removeRoleIdFromConfigArray({ staffRoleIds: 'role-delete' }, 'staffRoleIds', 'role-delete')
        ).toStrictEqual({
            changed: false,
        });
        expect(removeRoleIdFromConfigArray(null, 'staffRoleIds', 'role-delete')).toStrictEqual({ changed: false });
    });

    it('disables only enabled private ticket panels that lose their last staff role', () => {
        expect(
            shouldDisablePrivateTicketPanel({
                config: { privateTickets: true },
                enabled: true,
                staffRoleIds: [],
            })
        ).toBe(true);
        expect(
            shouldDisablePrivateTicketPanel({
                config: { privateTickets: false },
                enabled: true,
                staffRoleIds: [],
            })
        ).toBe(false);
        expect(
            shouldDisablePrivateTicketPanel({
                config: { privateTickets: true },
                enabled: true,
                staffRoleIds: ['role-keep'],
            })
        ).toBe(false);
    });
});
