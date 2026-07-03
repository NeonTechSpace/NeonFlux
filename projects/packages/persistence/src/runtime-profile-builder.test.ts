import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    createProfileSubmission,
    deleteProfileField,
    findProfileFormByGuildName,
    findProfileSubmissionById,
    listProfileFieldsByFormId,
    listProfileFormsByGuildId,
    listProfileSubmissionsByGuildId,
    reviewProfileSubmission,
    upsertProfileField,
    upsertProfileForm,
} from './runtime-profile-builder.js';

const form = {
    approvalRequired: false,
    config: { intro: 'welcome' },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    id: 'form-1',
    name: 'default',
    outputChannelId: 'channel-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const field = {
    createdAt: '2026-07-03T08:10:00.000Z',
    fieldKey: 'bio',
    fieldType: 'textarea',
    formId: 'form-1',
    id: 'field-1',
    label: 'Bio',
    maxLength: 180,
    position: 1,
    required: true,
    updatedAt: '2026-07-03T09:10:00.000Z',
};
const pendingSubmission = {
    formId: 'form-1',
    guildId: 'guild-1',
    id: 'submission-1',
    reviewedAt: null,
    status: 'pending' as const,
    submittedAt: '2026-07-03T08:20:00.000Z',
    updatedAt: '2026-07-03T08:20:00.000Z',
    userId: 'user-1',
    values: { bio: 'hello' },
};
const approvedSubmission = {
    ...pendingSubmission,
    reviewedAt: '2026-07-03T09:30:00.000Z',
    status: 'approved' as const,
    updatedAt: '2026-07-03T09:30:00.000Z',
};
const review = {
    createdAt: '2026-07-03T09:30:00.000Z',
    decision: 'approved' as const,
    id: 'review-1',
    reason: 'Looks good',
    reviewerUserId: 'reviewer-1',
    submissionId: 'submission-1',
};

describe('Convex profile builder persistence wrappers', () => {
    it('routes form and field operations through Convex with Date conversion', async () => {
        const db = createConvexDb({
            mutationResults: [form, field, field],
            queryResults: [[form], form, [field]],
        });

        const savedForm = await upsertProfileForm(db, {
            approvalRequired: false,
            config: form.config,
            enabled: true,
            guildId: ' guild-1 ',
            name: ' default ',
            outputChannelId: ' channel-1 ',
        });
        const forms = await listProfileFormsByGuildId(db, { enabledOnly: true, guildId: ' guild-1 ' });
        const foundForm = await findProfileFormByGuildName(db, {
            enabledOnly: true,
            guildId: ' guild-1 ',
            name: ' default ',
        });
        const savedField = await upsertProfileField(db, {
            fieldKey: ' bio ',
            fieldType: ' textarea ',
            formId: ' form-1 ',
            label: ' Bio ',
            maxLength: 180,
            position: 1,
            required: true,
        });
        const fields = await listProfileFieldsByFormId(db, { formId: ' form-1 ' });
        const deletedField = await deleteProfileField(db, { fieldKey: ' bio ', formId: ' form-1 ' });

        expect(savedForm._unsafeUnwrap()).toStrictEqual(toFormRecord(form));
        expect(forms._unsafeUnwrap()).toStrictEqual([toFormRecord(form)]);
        expect(foundForm._unsafeUnwrap()).toStrictEqual(toFormRecord(form));
        expect(savedField._unsafeUnwrap()).toStrictEqual(toFieldRecord(field));
        expect(fields._unsafeUnwrap()).toStrictEqual([toFieldRecord(field)]);
        expect(deletedField._unsafeUnwrap()).toStrictEqual(toFieldRecord(field));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            approvalRequired: false,
            config: form.config,
            enabled: true,
            guildId: 'guild-1',
            name: 'default',
            outputChannelId: 'channel-1',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            enabledOnly: true,
            guildId: 'guild-1',
            limit: 100,
        });
    });

    it('routes submissions and reviews through Convex with scoped transition checks', async () => {
        const db = createConvexDb({
            mutationResults: [pendingSubmission, review],
            queryResults: [[pendingSubmission], pendingSubmission, pendingSubmission],
        });

        const created = await createProfileSubmission(db, {
            formId: ' form-1 ',
            guildId: ' guild-1 ',
            status: 'pending',
            userId: ' user-1 ',
            values: pendingSubmission.values,
        });
        const submissions = await listProfileSubmissionsByGuildId(db, {
            guildId: ' guild-1 ',
            limit: 5,
            status: 'pending',
        });
        const found = await findProfileSubmissionById(db, {
            guildId: ' guild-1 ',
            submissionId: ' submission-1 ',
        });
        const approved = await reviewProfileSubmission(db, {
            decision: ' approved ',
            guildId: ' guild-1 ',
            reason: ' Looks good ',
            reviewerUserId: ' reviewer-1 ',
            submissionId: ' submission-1 ',
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toSubmissionRecord(pendingSubmission));
        expect(submissions._unsafeUnwrap()).toStrictEqual([toSubmissionRecord(pendingSubmission)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toSubmissionRecord(pendingSubmission));
        expect(approved._unsafeUnwrap()).toStrictEqual(toReviewRecord(review));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            formId: 'form-1',
            guildId: 'guild-1',
            status: 'pending',
            userId: 'user-1',
            values: pendingSubmission.values,
        });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            decision: 'approved',
            guildId: 'guild-1',
            reason: 'Looks good',
            reviewerUserId: 'reviewer-1',
            submissionId: 'submission-1',
        });
    });

    it('maps validation, missing records, and invalid transitions to existing errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null, approvedSubmission],
        });

        const missingGuild = await upsertProfileForm(db, { guildId: ' ', name: 'default' });
        const invalidField = await upsertProfileField(db, {
            fieldKey: 'bio',
            fieldType: 'textarea',
            formId: 'form-1',
            label: 'Bio',
            position: -1,
        });
        const invalidSubmission = await createProfileSubmission(db, {
            formId: 'form-1',
            guildId: 'guild-1',
            status: 'rejected',
            userId: 'user-1',
        });
        const missingForm = await findProfileFormByGuildName(db, { guildId: 'guild-1', name: 'default' });
        const missingField = await deleteProfileField(db, { fieldKey: 'bio', formId: 'form-1' });
        const invalidReview = await reviewProfileSubmission(db, {
            decision: 'rejected',
            guildId: 'guild-1',
            reviewerUserId: 'reviewer-1',
            submissionId: 'submission-1',
        });

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(invalidField._unsafeUnwrapErr()).toStrictEqual({ field: 'position', type: 'invalid-value' });
        expect(invalidSubmission._unsafeUnwrapErr()).toStrictEqual({ field: 'status', type: 'invalid-value' });
        expect(missingForm._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingField._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(invalidReview._unsafeUnwrapErr()).toStrictEqual({
            from: 'approved',
            to: 'rejected',
            type: 'invalid-status-transition',
        });
        expect(db.client.mutationCalls).toHaveLength(1);
    });
});

function toFormRecord(record: typeof form) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toFieldRecord(record: typeof field) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toSubmissionRecord(record: typeof pendingSubmission | typeof approvedSubmission) {
    return {
        ...record,
        reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null,
        submittedAt: new Date(record.submittedAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toReviewRecord(record: typeof review) {
    return { ...record, createdAt: new Date(record.createdAt) };
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
