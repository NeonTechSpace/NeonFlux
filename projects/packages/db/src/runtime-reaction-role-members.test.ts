import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    loadReactionRoleMemberReconciliation,
    requestReactionRoleMemberTransition,
} from './runtime-reaction-role-members.js';

const state = {
    configRevision: 1,
    createdAt: '2026-07-10T08:00:00.000Z',
    desiredEmojiKeys: ['🎉'],
    errorCode: null,
    guildId: 'guild-1',
    id: 'state-1',
    leaseExpiresAt: null,
    leaseId: null,
    leaseOwner: null,
    messageId: 'message-1',
    nextAttemptAt: null,
    reactionRoleMessageId: 'message-row-1',
    revision: 1,
    status: 'pending' as const,
    updatedAt: '2026-07-10T08:00:00.000Z',
    userId: 'user-1',
};
const message = {
    channelId: 'channel-1',
    createdAt: '2026-07-09T08:00:00.000Z',
    enabled: true,
    generateOverview: false,
    guildId: 'guild-1',
    id: 'message-row-1',
    kind: 'reaction_role',
    lifecycle: 'ready' as const,
    messageContent: 'Choose a role.',
    messageEmbeds: [],
    messageId: 'message-1',
    mode: 'normal' as const,
    pendingOperationId: null,
    revision: 1,
    source: 'dashboard' as const,
    staleAt: null,
    updatedAt: '2026-07-09T08:00:00.000Z',
};
const option = {
    createdAt: '2026-07-09T08:00:00.000Z',
    emojiKey: '🎉',
    id: 'option-1',
    position: 0,
    reactionRoleMessageId: 'message-row-1',
    roleId: 'role-1',
    updatedAt: '2026-07-09T08:00:00.000Z',
};
const assignment = {
    assignedAt: '2026-07-10T08:00:00.000Z',
    desiredState: 'present' as const,
    emojiKey: '🎉',
    guildId: 'guild-1',
    id: 'assignment-1',
    messageId: 'message-1',
    reactionRoleMessageId: 'message-row-1',
    removedAt: null,
    roleId: 'role-1',
    status: 'pending' as const,
    updatedAt: '2026-07-10T08:00:00.000Z',
    userId: 'user-1',
};

describe('reaction-role member database adapters', () => {
    it('normalizes event identity and maps the durable reconciliation snapshot', async () => {
        const db = createConvexDb({
            mutationResults: [{ type: 'queued', state }],
            queryResults: [{ assignments: [assignment], message, options: [option], state }],
        });

        const transition = await requestReactionRoleMemberTransition(db, {
            emojiKey: ' 🎉 ',
            eventType: 'added',
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            userId: ' user-1 ',
        });
        const snapshot = await loadReactionRoleMemberReconciliation(db, { stateId: ' state-1 ' });

        expect(transition._unsafeUnwrap()).toMatchObject({
            type: 'queued',
            state: { createdAt: new Date(state.createdAt), desiredEmojiKeys: ['🎉'] },
        });
        expect(snapshot._unsafeUnwrap()).toMatchObject({
            assignments: [{ assignedAt: new Date(assignment.assignedAt) }],
            message: { createdAt: new Date(message.createdAt) },
            options: [{ createdAt: new Date(option.createdAt) }],
            state: { updatedAt: new Date(state.updatedAt) },
        });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            emojiKey: '🎉',
            eventType: 'added',
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({ stateId: 'state-1' });
    });

    it('maps database failures without leaking transport errors', async () => {
        const db = createConvexDb({ mutationErrors: [new Error('secret transport detail')] });

        const result = await requestReactionRoleMemberTransition(db, {
            emojiKey: '🎉',
            eventType: 'removed',
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown) {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();
            return error ? Promise.reject(error) : Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown) {
            this.queryCalls.push({ args, reference });
            return Promise.resolve(queryResults.shift());
        },
    };
    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'bot',
    };
}
