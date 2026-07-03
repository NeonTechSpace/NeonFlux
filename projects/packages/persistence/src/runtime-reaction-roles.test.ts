import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    deleteReactionRoleMessage,
    deleteReactionRoleOption,
    deleteReactionRoleOptionByMessage,
    findEnabledReactionRoleOptionByReaction,
    findReactionRoleMessage,
    findReactionRoleOption,
    listActiveReactionRoleAssignmentsByGuildMessageUser,
    listActiveReactionRoleAssignmentsByGuildUser,
    listReactionRoleMessagesByGuildId,
    markReactionRoleAssignmentRemoved,
    markReactionRoleAssignmentsRemovedByMessageUser,
    upsertReactionRoleAssignment,
    upsertReactionRoleMessage,
    upsertReactionRoleOption,
    upsertReactionRoleOptionByMessage,
} from './runtime-reaction-roles.js';

const message = {
    channelId: 'channel-1',
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    generateOverview: false,
    guildId: 'guild-1',
    id: 'message-row-1',
    kind: 'reaction_role',
    messageContent: 'Choose a role.',
    messageEmbeds: [{ title: 'Roles' }],
    messageId: 'message-1',
    mode: 'exclusive' as const,
    source: 'dashboard' as const,
    staleAt: null,
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const option = {
    createdAt: '2026-07-03T08:01:00.000Z',
    emojiKey: 'unicode:check',
    id: 'option-1',
    position: 2,
    reactionRoleMessageId: 'message-row-1',
    roleId: 'role-1',
    updatedAt: '2026-07-03T09:01:00.000Z',
};
const assignment = {
    assignedAt: '2026-07-03T08:02:00.000Z',
    emojiKey: 'unicode:check',
    guildId: 'guild-1',
    id: 'assignment-1',
    messageId: 'message-1',
    removedAt: null,
    roleId: 'role-1',
    userId: 'user-1',
};

describe('Convex reaction-role persistence wrappers', () => {
    it('upserts, lists, finds, and deletes messages and options through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [message, option, option, message],
            queryResults: [[{ ...message, options: [option] }], message, { message, option }, option],
        });

        const upsertedMessage = await upsertReactionRoleMessage(db, {
            channelId: ' channel-1 ',
            enabled: true,
            generateOverview: false,
            guildId: ' guild-1 ',
            messageContent: ' Choose a role. ',
            messageEmbeds: message.messageEmbeds,
            messageId: ' message-1 ',
            mode: 'exclusive',
            source: 'dashboard',
        });
        const listed = await listReactionRoleMessagesByGuildId(db, { guildId: ' guild-1 ' });
        const found = await findReactionRoleMessage(db, { guildId: ' guild-1 ', messageId: ' message-1 ' });
        const matched = await findEnabledReactionRoleOptionByReaction(db, {
            emojiKey: ' unicode:check ',
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
        });
        const upsertedOption = await upsertReactionRoleOption(db, {
            emojiKey: ' unicode:check ',
            position: 2,
            reactionRoleMessageId: ' message-row-1 ',
            roleId: ' role-1 ',
        });
        const foundOption = await findReactionRoleOption(db, {
            emojiKey: ' unicode:check ',
            reactionRoleMessageId: ' message-row-1 ',
        });
        const deletedOption = await deleteReactionRoleOption(db, {
            emojiKey: ' unicode:check ',
            reactionRoleMessageId: ' message-row-1 ',
        });
        const deletedMessage = await deleteReactionRoleMessage(db, { guildId: ' guild-1 ', messageId: ' message-1 ' });

        expect(upsertedMessage._unsafeUnwrap()).toStrictEqual(toMessageRecord(message));
        expect(listed._unsafeUnwrap()).toStrictEqual([
            { ...toMessageRecord(message), options: [toOptionRecord(option)] },
        ]);
        expect(found._unsafeUnwrap()).toStrictEqual(toMessageRecord(message));
        expect(matched._unsafeUnwrap()).toStrictEqual({
            message: toMessageRecord(message),
            option: toOptionRecord(option),
        });
        expect(upsertedOption._unsafeUnwrap()).toStrictEqual(toOptionRecord(option));
        expect(foundOption._unsafeUnwrap()).toStrictEqual(toOptionRecord(option));
        expect(deletedOption._unsafeUnwrap()).toStrictEqual(toOptionRecord(option));
        expect(deletedMessage._unsafeUnwrap()).toStrictEqual(toMessageRecord(message));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'channel-1',
            enabled: true,
            generateOverview: false,
            guildId: 'guild-1',
            messageContent: 'Choose a role.',
            messageEmbeds: message.messageEmbeds,
            messageId: 'message-1',
            mode: 'exclusive',
            source: 'dashboard',
        });
    });

    it('preserves by-message option not-found behavior through two-step lookups', async () => {
        const db = createConvexDb({
            queryResults: [null],
        });

        const result = await upsertReactionRoleOptionByMessage(db, {
            emojiKey: 'unicode:check',
            guildId: 'guild-1',
            messageId: 'missing-message',
            roleId: 'role-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls).toHaveLength(0);
    });

    it('upserts and removes reaction-role assignments through Convex', async () => {
        const removedAssignment = { ...assignment, removedAt: '2026-07-03T10:00:00.000Z' };
        const db = createConvexDb({
            mutationResults: [assignment, removedAssignment, [removedAssignment]],
            queryResults: [[assignment], [assignment]],
        });

        const upserted = await upsertReactionRoleAssignment(db, {
            emojiKey: ' unicode:check ',
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            roleId: ' role-1 ',
            userId: ' user-1 ',
        });
        const userAssignments = await listActiveReactionRoleAssignmentsByGuildUser(db, {
            guildId: ' guild-1 ',
            userId: ' user-1 ',
        });
        const messageAssignments = await listActiveReactionRoleAssignmentsByGuildMessageUser(db, {
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            userId: ' user-1 ',
        });
        const removed = await markReactionRoleAssignmentRemoved(db, {
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            roleId: ' role-1 ',
            userId: ' user-1 ',
        });
        const removedByMessage = await markReactionRoleAssignmentsRemovedByMessageUser(db, {
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            userId: ' user-1 ',
        });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toAssignmentRecord(assignment));
        expect(userAssignments._unsafeUnwrap()).toStrictEqual([toAssignmentRecord(assignment)]);
        expect(messageAssignments._unsafeUnwrap()).toStrictEqual([toAssignmentRecord(assignment)]);
        expect(removed._unsafeUnwrap()).toStrictEqual(toAssignmentRecord(removedAssignment));
        expect(removedByMessage._unsafeUnwrap()).toStrictEqual([toAssignmentRecord(removedAssignment)]);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            emojiKey: 'unicode:check',
            guildId: 'guild-1',
            messageId: 'message-1',
            roleId: 'role-1',
            userId: 'user-1',
        });
    });

    it('maps validation failures and missing Convex records to existing repository errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null],
        });

        const invalidMode = await upsertReactionRoleMessage(db, {
            channelId: 'channel-1',
            guildId: 'guild-1',
            messageId: 'message-1',
            mode: 'invalid' as never,
        });
        const invalidPosition = await upsertReactionRoleOption(db, {
            emojiKey: 'unicode:check',
            position: -1,
            reactionRoleMessageId: 'message-row-1',
            roleId: 'role-1',
        });
        const missingReaction = await findEnabledReactionRoleOptionByReaction(db, {
            emojiKey: 'unicode:check',
            guildId: 'guild-1',
            messageId: 'message-1',
        });
        const missingAssignment = await markReactionRoleAssignmentRemoved(db, {
            guildId: 'guild-1',
            messageId: 'message-1',
            roleId: 'role-1',
            userId: 'user-1',
        });

        expect(invalidMode._unsafeUnwrapErr()).toStrictEqual({ field: 'mode', type: 'invalid-value' });
        expect(invalidPosition._unsafeUnwrapErr()).toStrictEqual({ field: 'position', type: 'invalid-value' });
        expect(missingReaction._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingAssignment._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });
});

function toMessageRecord(record: typeof message) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        staleAt: record.staleAt ? new Date(record.staleAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toOptionRecord(record: typeof option) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toAssignmentRecord(record: {
    assignedAt: string;
    emojiKey: string;
    guildId: string;
    id: string;
    messageId: string;
    removedAt: string | null;
    roleId: string;
    userId: string;
}) {
    return {
        ...record,
        assignedAt: new Date(record.assignedAt),
        removedAt: record.removedAt ? new Date(record.removedAt) : null,
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexPersistenceDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexPersistenceDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
