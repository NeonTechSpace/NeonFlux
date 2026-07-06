import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import {
    buildReactionRoleAssignmentDocument,
    buildReactionRoleMessageDocument,
    buildReactionRoleOptionDocument,
    toReactionRoleAssignmentRecord,
    toReactionRoleMessageRecord,
    toReactionRoleOptionRecord,
} from './reaction_roles_model.js';

const now = '2026-07-03T08:00:00.000Z';
const messageId = 'message-doc-1' as GenericId<'reactionRoleMessages'>;
const optionId = 'option-doc-1';
const assignmentId = 'assignment-doc-1';

describe('reaction roles model', () => {
    it('builds reaction-role messages with defaults', () => {
        const result = buildReactionRoleMessageDocument(
            {
                channelId: ' channel-1 ',
                guildId: ' guild-1 ',
                messageContent: ' Pick one ',
                messageId: ' message-1 ',
            },
            now
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toReactionRoleMessageRecord({ ...result.value, _id: messageId })).toStrictEqual({
            channelId: 'channel-1',
            createdAt: now,
            enabled: true,
            generateOverview: false,
            guildId: 'guild-1',
            id: messageId,
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

    it('preserves message created timestamp on update', () => {
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
            }
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toMatchObject({
            createdAt: '2026-07-02T08:00:00.000Z',
            enabled: false,
            generateOverview: true,
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

    it('builds options keyed by message id and validates position', () => {
        const result = buildReactionRoleOptionDocument(
            {
                emojiKey: ' unicode:check ',
                position: 2,
                reactionRoleMessageId: messageId,
                roleId: ' role-1 ',
            },
            now
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toReactionRoleOptionRecord({ ...result.value, _id: optionId })).toStrictEqual({
            createdAt: now,
            emojiKey: 'unicode:check',
            id: optionId,
            position: 2,
            reactionRoleMessageId: messageId,
            roleId: 'role-1',
            updatedAt: now,
        });
        expect(
            buildReactionRoleOptionDocument(
                {
                    emojiKey: 'unicode:check',
                    position: -1,
                    reactionRoleMessageId: messageId,
                    roleId: 'role-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'position', type: 'invalid-value' },
            ok: false,
        });
    });

    it('builds assignments and maps stored identity from Convex id', () => {
        const result = buildReactionRoleAssignmentDocument(
            {
                emojiKey: ' unicode:check ',
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
                roleId: ' role-1 ',
                userId: ' user-1 ',
            },
            now
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toReactionRoleAssignmentRecord({ ...result.value, _id: assignmentId })).toStrictEqual({
            assignedAt: now,
            emojiKey: 'unicode:check',
            guildId: 'guild-1',
            id: assignmentId,
            messageId: 'message-1',
            removedAt: null,
            roleId: 'role-1',
            userId: 'user-1',
        });
    });
});
