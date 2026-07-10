import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    deleteMessageTemplate,
    findMessageTemplateByName,
    listMessageTemplatesByGuildId,
    recordPostedMessage,
    upsertMessageTemplate,
} from './runtime-posting.js';

const template = {
    content: 'Hello',
    createdAt: '2026-07-03T08:00:00.000Z',
    createdByUserId: 'user-1',
    embeds: [{ title: 'Launch' }],
    guildId: 'guild-1',
    id: 'template-1',
    name: 'Launch',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const postedMessage = {
    channelId: 'channel-1',
    createdAt: '2026-07-03T08:00:00.000Z',
    createdByUserId: 'user-1',
    guildId: 'guild-1',
    id: 'posted-1',
    messageId: 'message-1',
    purpose: 'manual',
    templateId: 'template-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};

describe('Convex posting database functions', () => {
    it('upserts, lists, finds, and deletes message templates through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [template, null],
            queryResults: [[template], template],
        });

        const upserted = await upsertMessageTemplate(db, {
            content: ' Hello ',
            createdByUserId: ' user-1 ',
            embeds: template.embeds,
            guildId: ' guild-1 ',
            name: ' Launch ',
        });
        const listed = await listMessageTemplatesByGuildId(db, { guildId: 'guild-1', limit: 25 });
        const found = await findMessageTemplateByName(db, { guildId: 'guild-1', name: 'Launch' });
        const deleted = await deleteMessageTemplate(db, {
            expectedUpdatedAt: template.updatedAt,
            guildId: 'guild-1',
            templateId: 'template-1',
        });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toTemplateRecord(template));
        expect(listed._unsafeUnwrap()).toStrictEqual([toTemplateRecord(template)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toTemplateRecord(template));
        expect(deleted._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            content: 'Hello',
            createdByUserId: 'user-1',
            embeds: template.embeds,
            guildId: 'guild-1',
            name: 'Launch',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            limit: 25,
        });
    });

    it('records posted messages through Convex with normalized optional fields', async () => {
        const db = createConvexDb({
            mutationResults: [postedMessage],
        });

        const result = await recordPostedMessage(db, {
            channelId: ' channel-1 ',
            createdByUserId: ' user-1 ',
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            purpose: ' manual ',
            templateId: ' template-1 ',
        });

        expect(result._unsafeUnwrap()).toStrictEqual(toPostedMessageRecord(postedMessage));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'channel-1',
            createdByUserId: 'user-1',
            guildId: 'guild-1',
            messageId: 'message-1',
            purpose: 'manual',
            templateId: 'template-1',
        });
    });

    it('maps posting validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingTemplateMessage = await upsertMessageTemplate(db, {
            guildId: 'guild-1',
            name: 'empty',
        });
        const missingTemplateName = await findMessageTemplateByName(db, {
            guildId: 'guild-1',
            name: ' ',
        });
        const missingPostedMessageChannel = await recordPostedMessage(db, {
            channelId: ' ',
            guildId: 'guild-1',
            messageId: 'message-1',
        });
        const missingDeleteTemplateId = await deleteMessageTemplate(db, {
            expectedUpdatedAt: template.updatedAt,
            guildId: 'guild-1',
            templateId: ' ',
        });

        expect(missingTemplateMessage._unsafeUnwrapErr()).toStrictEqual({
            field: 'message',
            type: 'missing-input',
        });
        expect(missingTemplateName._unsafeUnwrapErr()).toStrictEqual({ field: 'name', type: 'missing-input' });
        expect(missingPostedMessageChannel._unsafeUnwrapErr()).toStrictEqual({
            field: 'channelId',
            type: 'missing-input',
        });
        expect(missingDeleteTemplateId._unsafeUnwrapErr()).toStrictEqual({
            field: 'templateId',
            type: 'missing-input',
        });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('maps missing template reads and Convex failures to existing repository errors', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('template-not-found')],
            queryResults: [null],
        });

        const missing = await findMessageTemplateByName(db, { guildId: 'guild-1', name: 'missing' });
        const failedRecord = await recordPostedMessage(db, {
            channelId: 'channel-1',
            guildId: 'guild-1',
            messageId: 'message-1',
            templateId: 'template-missing',
        });

        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(failedRecord._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });

    it('preserves template name and revision conflicts from Convex', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('template-name-conflict'), new Error('template-version-conflict')],
        });

        const duplicateName = await upsertMessageTemplate(db, {
            content: 'duplicate',
            guildId: 'guild-1',
            name: 'Launch',
        });
        const staleDelete = await deleteMessageTemplate(db, {
            expectedUpdatedAt: template.updatedAt,
            guildId: 'guild-1',
            templateId: 'template-1',
        });

        expect(duplicateName._unsafeUnwrapErr()).toStrictEqual({ field: 'name', type: 'conflict' });
        expect(staleDelete._unsafeUnwrapErr()).toStrictEqual({ field: 'updatedAt', type: 'conflict' });
    });
});

function toTemplateRecord(record: typeof template) {
    return {
        content: record.content,
        createdAt: new Date(record.createdAt),
        createdByUserId: record.createdByUserId,
        embeds: record.embeds,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        updatedAt: new Date(record.updatedAt),
    };
}

function toPostedMessageRecord(record: typeof postedMessage) {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        createdByUserId: record.createdByUserId,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        purpose: record.purpose,
        templateId: record.templateId,
        updatedAt: new Date(record.updatedAt),
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
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
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
