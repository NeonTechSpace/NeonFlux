import type { GuildFeatureRepositoryError } from './contracts.js';

export type ProfileFormRecord = {
    id: string;
    guildId: string;
    name: string;
    approvalRequired: boolean;
    outputChannelId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export type ProfileFieldRecord = {
    id: string;
    formId: string;
    fieldKey: string;
    label: string;
    fieldType: string;
    required: boolean;
    maxLength: number | null;
    position: number;
    createdAt: Date;
    updatedAt: Date;
};

export type ProfileSubmissionRecord = {
    id: string;
    guildId: string;
    formId: string;
    userId: string;
    status: string;
    values: Record<string, unknown>;
    submittedAt: Date;
    reviewedAt: Date | null;
    updatedAt: Date;
};

export type ProfileSubmissionReviewRecord = {
    id: string;
    submissionId: string;
    reviewerUserId: string;
    decision: string;
    reason: string | null;
    createdAt: Date;
};

export type ProfileBuilderRepositoryError = GuildFeatureRepositoryError;
