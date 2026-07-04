import { err, ok, type Result } from 'neverthrow';

import type {
    GuildFeatureRepositoryError,
} from './contracts.js';
import type {
    ProfileBuilderRepositoryError,
    ProfileFieldRecord,
    ProfileFormRecord,
    ProfileSubmissionRecord,
    ProfileSubmissionReviewRecord,
} from './contracts-profile-builder.js';

export type ConvexProfileFormRecord = {
    approvalRequired: boolean;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    outputChannelId: string | null;
    updatedAt: string;
};

export type ConvexProfileFieldRecord = {
    createdAt: string;
    fieldKey: string;
    fieldType: string;
    formId: string;
    id: string;
    label: string;
    maxLength: number | null;
    position: number;
    required: boolean;
    updatedAt: string;
};

export type ConvexProfileSubmissionRecord = {
    formId: string;
    guildId: string;
    id: string;
    reviewedAt: string | null;
    status: 'approved' | 'pending' | 'rejected';
    submittedAt: string;
    updatedAt: string;
    userId: string;
    values: Record<string, unknown>;
};

export type ConvexProfileSubmissionReviewRecord = {
    createdAt: string;
    decision: 'approved' | 'rejected';
    id: string;
    reason: string | null;
    reviewerUserId: string;
    submissionId: string;
};

export function toProfileFormRecord(record: ConvexProfileFormRecord): ProfileFormRecord {
    return {
        approvalRequired: record.approvalRequired,
        config: record.config,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        outputChannelId: record.outputChannelId,
        updatedAt: new Date(record.updatedAt),
    };
}

export function toProfileFieldRecord(record: ConvexProfileFieldRecord): ProfileFieldRecord {
    return {
        createdAt: new Date(record.createdAt),
        fieldKey: record.fieldKey,
        fieldType: record.fieldType,
        formId: record.formId,
        id: record.id,
        label: record.label,
        maxLength: record.maxLength,
        position: record.position,
        required: record.required,
        updatedAt: new Date(record.updatedAt),
    };
}

export function toProfileSubmissionRecord(record: ConvexProfileSubmissionRecord): ProfileSubmissionRecord {
    return {
        formId: record.formId,
        guildId: record.guildId,
        id: record.id,
        reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null,
        status: record.status,
        submittedAt: new Date(record.submittedAt),
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
        values: record.values,
    };
}

export function toProfileSubmissionReviewRecord(
    record: ConvexProfileSubmissionReviewRecord
): ProfileSubmissionReviewRecord {
    return {
        createdAt: new Date(record.createdAt),
        decision: record.decision,
        id: record.id,
        reason: record.reason,
        reviewerUserId: record.reviewerUserId,
        submissionId: record.submissionId,
    };
}

export function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) return err({ field, type: 'missing-input' });

    return ok(normalizedValue);
}

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeNonNegativeInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    if (!Number.isInteger(value) || value < 0) return err({ field, type: 'invalid-value' });

    return ok(value);
}

export function normalizeListLimit(limit: number | undefined): number {
    return Number.isInteger(limit) ? Math.min(Math.max(Number(limit), 1), 100) : 25;
}

export function normalizeSubmissionCreateStatus(
    status: string | undefined
): Result<'approved' | 'pending', ProfileBuilderRepositoryError> {
    const normalizedStatus = status ?? 'pending';

    if (normalizedStatus === 'approved' || normalizedStatus === 'pending') return ok(normalizedStatus);

    return err({ field: 'status', type: 'invalid-value' });
}

export function normalizeReviewDecision(
    decision: string
): Result<'approved' | 'rejected', ProfileBuilderRepositoryError> {
    const normalizedDecision = normalizeRequiredText(decision, 'decision');

    if (normalizedDecision.isErr()) return err(normalizedDecision.error);
    if (normalizedDecision.value === 'approved' || normalizedDecision.value === 'rejected') {
        return ok(normalizedDecision.value);
    }

    return err({ field: 'decision', type: 'invalid-value' });
}

export function mapProfileBuilderConvexError(error: unknown): ProfileBuilderRepositoryError {
    const message = error instanceof Error ? error.message : '';

    if (message === 'profile-form-not-found' || message === 'profile-submission-not-found') {
        return { type: 'not-found' };
    }

    return { type: 'database-error' };
}
