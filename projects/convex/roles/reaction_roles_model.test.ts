import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import { buildReactionRoleMessageDocument, buildReactionRoleOptionDocument } from './reaction_roles_model.js';

const now = '2026-07-03T08:00:00.000Z';
const messageId = 'message-doc-1' as GenericId<'reactionRoleMessages'>;

describe('reaction roles model', () => {
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

    it('rejects invalid option positions', () => {
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
});
