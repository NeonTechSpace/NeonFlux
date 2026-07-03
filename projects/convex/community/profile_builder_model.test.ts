import { describe, expect, it } from 'vitest';

import {
    buildProfileFieldDocument,
    buildProfileFormDocument,
    buildProfileSubmissionDocument,
    buildProfileSubmissionReviewDocument,
    buildSubmissionReviewPatch,
    normalizeProfileBuilderLimit,
    normalizeRequiredFieldKey,
    normalizeRequiredFormId,
    normalizeRequiredFormName,
    normalizeRequiredGuildId,
    normalizeRequiredSubmissionId,
    toProfileFieldRecord,
    toProfileFormRecord,
    toProfileSubmissionRecord,
    toProfileSubmissionReviewRecord,
} from './profile_builder_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('profile builder model', () => {
    it('normalizes profile forms with defaults and app-facing records', () => {
        const document = buildProfileFormDocument(
            {
                config: { intro: 'Tell us about yourself.' },
                guildId: ' guild-1 ',
                name: ' default ',
                outputChannelId: ' channel-1 ',
            },
            now,
            undefined,
            () => 'form-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                approvalRequired: true,
                config: { intro: 'Tell us about yourself.' },
                createdAt: now,
                enabled: true,
                guildId: 'guild-1',
                legacyId: 'form-1',
                name: 'default',
                outputChannelId: 'channel-1',
                updatedAt: now,
            },
        });

        if (!document.ok) throw new Error('Expected normalized form.');

        expect(toProfileFormRecord(document.value)).toEqual({
            approvalRequired: true,
            config: { intro: 'Tell us about yourself.' },
            createdAt: now,
            enabled: true,
            guildId: 'guild-1',
            id: 'form-1',
            name: 'default',
            outputChannelId: 'channel-1',
            updatedAt: now,
        });
    });

    it('preserves form identity and creation metadata on update', () => {
        expect(
            buildProfileFormDocument(
                {
                    approvalRequired: false,
                    enabled: false,
                    guildId: 'guild-1',
                    name: 'default',
                },
                now,
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                    legacyId: 'existing-form',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                approvalRequired: false,
                config: {},
                createdAt: '2026-07-02T08:00:00.000Z',
                enabled: false,
                guildId: 'guild-1',
                legacyId: 'existing-form',
                name: 'default',
                updatedAt: now,
            },
        });
    });

    it('normalizes profile fields and preserves legacy metadata on upsert', () => {
        const document = buildProfileFieldDocument(
            {
                fieldKey: ' bio ',
                fieldType: ' textarea ',
                formId: ' form-1 ',
                label: ' About me ',
                maxLength: 400,
                position: 2,
                required: true,
            },
            now,
            undefined,
            () => 'field-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: now,
                fieldKey: 'bio',
                fieldType: 'textarea',
                formLegacyId: 'form-1',
                label: 'About me',
                legacyId: 'field-1',
                maxLength: 400,
                position: 2,
                required: true,
                updatedAt: now,
            },
        });

        if (!document.ok) throw new Error('Expected normalized field.');

        expect(toProfileFieldRecord(document.value)).toEqual({
            createdAt: now,
            fieldKey: 'bio',
            fieldType: 'textarea',
            formId: 'form-1',
            id: 'field-1',
            label: 'About me',
            maxLength: 400,
            position: 2,
            required: true,
            updatedAt: now,
        });
    });

    it('normalizes submissions, imported timestamps, and approved review timestamps', () => {
        const document = buildProfileSubmissionDocument(
            {
                formId: ' form-1 ',
                guildId: ' guild-1 ',
                status: 'approved',
                submittedAt: '2026-07-02 09:00:00+02',
                updatedAt: '2026-07-03 09:00:00+02',
                userId: ' user-1 ',
                values: { name: 'Neon' },
            },
            now,
            () => 'submission-1'
        );

        expect(document).toMatchObject({
            ok: true,
            value: {
                formLegacyId: 'form-1',
                guildId: 'guild-1',
                legacyId: 'submission-1',
                reviewedAt: now,
                status: 'approved',
                submittedAt: '2026-07-02T07:00:00.000Z',
                updatedAt: '2026-07-03T07:00:00.000Z',
                userId: 'user-1',
                values: { name: 'Neon' },
            },
        });

        if (!document.ok) throw new Error('Expected normalized submission.');

        expect(toProfileSubmissionRecord(document.value)).toEqual({
            formId: 'form-1',
            guildId: 'guild-1',
            id: 'submission-1',
            reviewedAt: now,
            status: 'approved',
            submittedAt: '2026-07-02T07:00:00.000Z',
            updatedAt: '2026-07-03T07:00:00.000Z',
            userId: 'user-1',
            values: { name: 'Neon' },
        });
    });

    it('normalizes review records and legal status transitions', () => {
        const document = buildProfileSubmissionReviewDocument(
            {
                decision: ' approved ',
                reason: ' Looks good ',
                reviewerUserId: ' reviewer-1 ',
                submissionId: ' submission-1 ',
            },
            now,
            () => 'review-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: now,
                decision: 'approved',
                legacyId: 'review-1',
                reason: 'Looks good',
                reviewerUserId: 'reviewer-1',
                submissionLegacyId: 'submission-1',
            },
        });

        if (!document.ok) throw new Error('Expected normalized review.');

        expect(toProfileSubmissionReviewRecord(document.value)).toEqual({
            createdAt: now,
            decision: 'approved',
            id: 'review-1',
            reason: 'Looks good',
            reviewerUserId: 'reviewer-1',
            submissionId: 'submission-1',
        });
        expect(buildSubmissionReviewPatch('pending', 'approved', now)).toEqual({
            ok: true,
            value: { reviewedAt: now, status: 'approved', updatedAt: now },
        });
        expect(buildSubmissionReviewPatch('approved', 'rejected', now)).toEqual({
            error: { from: 'approved', to: 'rejected', type: 'invalid-status-transition' },
            ok: false,
        });
    });

    it('rejects invalid inputs and bounds limits', () => {
        expect(buildProfileFormDocument({ guildId: '', name: 'default' }, now)).toEqual({
            error: { field: 'guildId', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildProfileFieldDocument(
                { fieldKey: 'bio', fieldType: 'text', formId: 'form-1', label: 'Bio', position: -1 },
                now
            )
        ).toEqual({
            error: { field: 'position', type: 'invalid-value' },
            ok: false,
        });
        expect(
            buildProfileSubmissionDocument(
                { formId: 'form-1', guildId: 'guild-1', status: 'rejected', userId: 'user-1' },
                now
            )
        ).toEqual({
            error: { field: 'status', type: 'invalid-value' },
            ok: false,
        });
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredFormId(' form-1 ')).toEqual({ ok: true, value: 'form-1' });
        expect(normalizeRequiredFormName(' default ')).toEqual({ ok: true, value: 'default' });
        expect(normalizeRequiredFieldKey(' bio ')).toEqual({ ok: true, value: 'bio' });
        expect(normalizeRequiredSubmissionId(' submission-1 ')).toEqual({ ok: true, value: 'submission-1' });
        expect(normalizeProfileBuilderLimit(undefined)).toBe(25);
        expect(normalizeProfileBuilderLimit(0)).toBe(1);
        expect(normalizeProfileBuilderLimit(500)).toBe(100);
    });
});
