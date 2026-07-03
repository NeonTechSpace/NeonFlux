import { describe, expect, it } from 'vitest';

import {
    buildReactionRoleAssignmentDocument,
    buildReactionRoleMessageDocument,
    buildReactionRoleOptionDocument,
    toReactionRoleAssignmentRecord,
    toReactionRoleMessageRecord,
    toReactionRoleOptionRecord,
} from './reaction_roles_model.js';

const now = '2026-07-03T08:00:00.000Z';
const createLegacyId = (): string => 'legacy-1';

describe('reaction roles model', () => {
    it('builds reaction-role messages with defaults and app-facing IDs', () => {
        const result = buildReactionRoleMessageDocument(
            {
                channelId: ' channel-1 ',
                guildId: ' guild-1 ',
                messageContent: ' Pick one ',
                messageId: ' message-1 ',
            },
            now,
            undefined,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toReactionRoleMessageRecord(result.value)).toStrictEqual({
            channelId: 'channel-1',
            createdAt: now,
            enabled: true,
            generateOverview: false,
            guildId: 'guild-1',
            id: 'legacy-1',
            kind: 'reaction_role',
            messageContent: 'Pick one',
            messageEmbeds: [],
            messageId: 'message-1',
            mode: 'normal',
            source: 'existing',
            staleAt: null,
            updatedAt: now,
        });
    });

    it('preserves message identity and created timestamp on update', () => {
        const result = buildReactionRoleMessageDocument(
            {
                channelId: 'channel-2',
                enabled: false,
                generateOverview: true,
                guildId: 'guild-1',
                messageEmbeds: [{ description: 'Choose' }],
                messageId: 'message-1',
                mode: 'exclusive',
                source: 'dashboard',
            },
            now,
            {
                createdAt: '2026-07-02T08:00:00.000Z',
                legacyId: 'message-legacy-1',
            }
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toMatchObject({
            createdAt: '2026-07-02T08:00:00.000Z',
            enabled: false,
            generateOverview: true,
            legacyId: 'message-legacy-1',
            messageEmbeds: [{ description: 'Choose' }],
            mode: 'exclusive',
            source: 'dashboard',
            updatedAt: now,
        });
    });

    it('rejects invalid message mode and embed roots', () => {
        expect(
            buildReactionRoleMessageDocument(
                {
                    channelId: 'channel-1',
                    guildId: 'guild-1',
                    messageId: 'message-1',
                    mode: 'additive',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'mode', type: 'invalid-value' },
            ok: false,
        });
        expect(
            buildReactionRoleMessageDocument(
                {
                    channelId: 'channel-1',
                    guildId: 'guild-1',
                    messageEmbeds: {} as unknown as unknown[],
                    messageId: 'message-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'messageEmbeds', type: 'invalid-value' },
            ok: false,
        });
    });

    it('builds options keyed by message legacy id and validates position', () => {
        const result = buildReactionRoleOptionDocument(
            {
                emojiKey: ' unicode:check ',
                position: 2,
                reactionRoleMessageId: ' message-legacy-1 ',
                roleId: ' role-1 ',
            },
            now,
            undefined,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toReactionRoleOptionRecord(result.value)).toStrictEqual({
            createdAt: now,
            emojiKey: 'unicode:check',
            id: 'legacy-1',
            position: 2,
            reactionRoleMessageId: 'message-legacy-1',
            roleId: 'role-1',
            updatedAt: now,
        });
        expect(
            buildReactionRoleOptionDocument(
                {
                    emojiKey: 'unicode:check',
                    position: -1,
                    reactionRoleMessageId: 'message-legacy-1',
                    roleId: 'role-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'position', type: 'invalid-value' },
            ok: false,
        });
    });

    it('builds assignments and reactivation patches by preserving assignment identity', () => {
        const result = buildReactionRoleAssignmentDocument(
            {
                emojiKey: ' unicode:check ',
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
                roleId: ' role-1 ',
                userId: ' user-1 ',
            },
            now,
            { legacyId: 'assignment-1' }
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toReactionRoleAssignmentRecord(result.value)).toStrictEqual({
            assignedAt: now,
            emojiKey: 'unicode:check',
            guildId: 'guild-1',
            id: 'assignment-1',
            messageId: 'message-1',
            removedAt: null,
            roleId: 'role-1',
            userId: 'user-1',
        });
    });
});
