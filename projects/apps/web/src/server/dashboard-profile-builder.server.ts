import '@tanstack/react-start/server-only';

import { buildPublicWebUrl } from '@neonflux/core/public-url';
import {
    deleteProfileField,
    findDeploymentConfig,
    findProfileSubmissionById,
    listProfileFieldsByFormId,
    listProfileFormsByGuildId,
    listProfileSubmissionsByGuildId,
    recordBotActionEvent,
    reviewProfileSubmission,
    upsertProfileField,
    upsertProfileForm,
} from '@neonflux/db';
import type { ProfileFormRecord, ProfileSubmissionRecord } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import { isDashboardProfileFieldType, toDashboardProfileField } from './profile-builder-shared.js';
import type { DashboardProfileField, DashboardProfileFieldType } from './profile-builder-shared.js';

export type DashboardProfileForm = {
    id: string;
    name: string;
    approvalRequired: boolean;
    enabled: boolean;
    publicUrl?: string;
    publicPath: string;
    fields: DashboardProfileField[];
    updatedAt: string;
};

export type DashboardProfileSubmission = {
    id: string;
    formId: string;
    formName: string;
    userId: string;
    status: string;
    values: Record<string, string>;
    submittedAt: string;
    reviewedAt?: string;
};

export type DashboardProfileBuilderSettingsResult =
    | {
          type: 'settings';
          publicUrlStatus: 'available' | 'missing-public-web-url' | 'invalid-public-web-url' | 'database-error';
          forms: DashboardProfileForm[];
          submissions: DashboardProfileSubmission[];
      }
    | DashboardProfileBuilderErrorResult;

export type DashboardProfileBuilderUpdateInput = {
    guildId: string;
    name: string;
    approvalRequired?: boolean;
    enabled?: boolean;
    fields?: DashboardProfileFieldInput[];
};

export type DashboardProfileFieldInput = {
    fieldKey?: string;
    label: string;
    fieldType: DashboardProfileFieldType;
    required?: boolean;
    maxLength?: number | null;
};

export type DashboardProfileBuilderReviewInput = {
    guildId: string;
    submissionId: string;
    decision: 'approved' | 'rejected';
    reason?: string;
};

export type DashboardProfileBuilderUpdateResult =
    | {
          type: 'updated';
          form: DashboardProfileForm;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardProfileBuilderErrorResult;

export type DashboardProfileBuilderReviewResult =
    | {
          type: 'reviewed';
          submission: DashboardProfileSubmission;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardProfileBuilderErrorResult;

type DashboardProfileBuilderErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;
type ProfileBuilderActor =
    | { type: 'actor'; actorUserId: string; metadata: Record<string, string> }
    | { type: 'auth-required' }
    | { type: 'database-error' };

const dashboardProfileBuilderFeature = 'profile_builder';
const maxFieldsPerForm = 12;

export async function loadDashboardProfileBuilderSettings(
    request: Request,
    guildId: string
): Promise<DashboardProfileBuilderSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = getWebDatabaseClient();
    const formsResult = await listProfileFormsByGuildId(database.db, { guildId: guildPageData.guild.id });
    const submissionsResult = await listProfileSubmissionsByGuildId(database.db, {
        guildId: guildPageData.guild.id,
        limit: 50,
    });

    if (formsResult.isErr() || submissionsResult.isErr()) {
        return { type: 'database-error' };
    }

    const publicUrlResult = await readPublicUrlBase(database.db);
    const forms = await Promise.all(
        formsResult.value.map((form) => toDashboardProfileForm(database.db, form, publicUrlResult.publicWebUrl))
    );

    const resolvedForms = forms.filter((form): form is DashboardProfileForm => form !== undefined);

    if (resolvedForms.length !== forms.length) {
        return { type: 'database-error' };
    }

    const formNamesById = new Map(resolvedForms.map((form) => [form.id, form.name]));

    return {
        type: 'settings',
        publicUrlStatus: publicUrlResult.status,
        forms: resolvedForms,
        submissions: submissionsResult.value.map((submission) =>
            toDashboardProfileSubmission(submission, formNamesById)
        ),
    };
}

export async function updateDashboardProfileBuilderForm(
    request: Request,
    input: DashboardProfileBuilderUpdateInput
): Promise<DashboardProfileBuilderUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveProfileBuilderActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const payload = normalizeFormPayload(input);

    if (payload.type === 'invalid-input') {
        return payload;
    }

    const database = getWebDatabaseClient();
    const formResult = await upsertProfileForm(database.db, {
        guildId: guildPageData.guild.id,
        name: payload.name,
        approvalRequired: payload.approvalRequired,
        enabled: payload.enabled,
    });

    if (formResult.isErr()) {
        return mapRepositoryError(formResult.error);
    }

    const fieldsResult = await replaceProfileFields(database.db, formResult.value.id, payload.fields);

    if (fieldsResult.type !== 'updated') {
        return fieldsResult;
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardProfileBuilderFeature,
        action: 'form.updated',
        actorUserId: actorResult.actorUserId,
        targetId: formResult.value.id,
        metadata: {
            formId: formResult.value.id,
            formName: formResult.value.name,
            fieldCount: payload.fields.length,
            approvalRequired: formResult.value.approvalRequired,
            enabled: formResult.value.enabled,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    const publicUrlResult = await readPublicUrlBase(database.db);
    const form = await toDashboardProfileForm(database.db, formResult.value, publicUrlResult.publicWebUrl);

    return form ? { type: 'updated', form } : { type: 'database-error' };
}

export async function reviewDashboardProfileSubmission(
    request: Request,
    input: DashboardProfileBuilderReviewInput
): Promise<DashboardProfileBuilderReviewResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveProfileBuilderActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const reviewResult = await reviewProfileSubmission(database.db, {
        guildId: guildPageData.guild.id,
        submissionId: input.submissionId,
        reviewerUserId: actorResult.actorUserId,
        decision: input.decision,
        reason: input.reason,
    });

    if (reviewResult.isErr()) {
        return mapRepositoryError(reviewResult.error);
    }

    const submissionResult = await findProfileSubmissionById(database.db, {
        guildId: guildPageData.guild.id,
        submissionId: input.submissionId,
    });

    if (submissionResult.isErr()) {
        return mapRepositoryError(submissionResult.error);
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardProfileBuilderFeature,
        action: 'submission.reviewed',
        actorUserId: actorResult.actorUserId,
        targetId: input.submissionId,
        metadata: {
            submissionId: input.submissionId,
            formId: submissionResult.value.formId,
            userId: submissionResult.value.userId,
            decision: input.decision,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'reviewed',
        submission: toDashboardProfileSubmission(submissionResult.value, new Map()),
    };
}

async function replaceProfileFields(
    db: Parameters<typeof upsertProfileField>[0],
    formId: string,
    fields: readonly DashboardProfileFieldInput[]
): Promise<{ type: 'updated' } | { type: 'invalid-input'; field: string } | { type: 'database-error' }> {
    const existingFieldsResult = await listProfileFieldsByFormId(db, { formId });

    if (existingFieldsResult.isErr()) {
        return { type: 'database-error' };
    }

    const fieldKeys = new Set<string>();

    for (const [index, field] of fields.entries()) {
        const fieldResult = await upsertProfileField(db, {
            formId,
            fieldKey: field.fieldKey ?? slugifyHandle(field.label),
            label: field.label,
            fieldType: field.fieldType,
            required: field.required ?? false,
            maxLength: field.maxLength ?? null,
            position: index,
        });

        if (fieldResult.isErr()) {
            return fieldResult.error.type === 'database-error'
                ? { type: 'database-error' }
                : { type: 'invalid-input', field: 'field' in fieldResult.error ? fieldResult.error.field : 'fields' };
        }

        fieldKeys.add(fieldResult.value.fieldKey);
    }

    for (const field of existingFieldsResult.value) {
        if (fieldKeys.has(field.fieldKey)) {
            continue;
        }

        const deleteResult = await deleteProfileField(db, { formId, fieldKey: field.fieldKey });

        if (deleteResult.isErr() && deleteResult.error.type !== 'not-found') {
            return { type: 'database-error' };
        }
    }

    return { type: 'updated' };
}

async function toDashboardProfileForm(
    db: Parameters<typeof listProfileFieldsByFormId>[0],
    record: ProfileFormRecord,
    publicWebUrl: string | undefined
): Promise<DashboardProfileForm | undefined> {
    const fieldsResult = await listProfileFieldsByFormId(db, { formId: record.id });

    if (fieldsResult.isErr()) {
        return undefined;
    }

    const publicPath = `/profile-builder?${new URLSearchParams({
        guildId: record.guildId,
        form: record.name,
    }).toString()}`;
    const publicUrlResult = buildPublicWebUrl({
        publicWebUrl,
        path: '/profile-builder',
        searchParams: {
            guildId: record.guildId,
            form: record.name,
        },
    });

    return {
        id: record.id,
        name: record.name,
        approvalRequired: record.approvalRequired,
        enabled: record.enabled,
        ...(publicUrlResult.isOk() ? { publicUrl: publicUrlResult.value } : {}),
        publicPath,
        fields: fieldsResult.value.map(toDashboardProfileField),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function toDashboardProfileSubmission(
    record: ProfileSubmissionRecord,
    formNamesById: ReadonlyMap<string, string>
): DashboardProfileSubmission {
    return {
        id: record.id,
        formId: record.formId,
        formName: formNamesById.get(record.formId) ?? record.formId,
        userId: record.userId,
        status: record.status,
        values: toStringRecord(record.values),
        submittedAt: record.submittedAt.toISOString(),
        ...(record.reviewedAt ? { reviewedAt: record.reviewedAt.toISOString() } : {}),
    };
}

async function readPublicUrlBase(db: Parameters<typeof findDeploymentConfig>[0]): Promise<{
    status: 'available' | 'missing-public-web-url' | 'invalid-public-web-url' | 'database-error';
    publicWebUrl?: string;
}> {
    const configResult = await findDeploymentConfig(db);

    if (configResult.isErr()) {
        return {
            status: 'database-error',
            publicWebUrl: undefined,
        };
    }

    const publicWebUrl = configResult.value.publicWebUrl ?? undefined;
    const status = buildPublicWebUrl({ publicWebUrl, path: '/profile-builder' }).isOk()
        ? 'available'
        : publicWebUrl
          ? 'invalid-public-web-url'
          : 'missing-public-web-url';

    return {
        status,
        publicWebUrl,
    };
}

function normalizeFormPayload(input: DashboardProfileBuilderUpdateInput):
    | {
          type: 'valid';
          name: string;
          approvalRequired: boolean;
          enabled: boolean;
          fields: DashboardProfileFieldInput[];
      }
    | { type: 'invalid-input'; field: string } {
    const name = input.name.trim();
    const fields = input.fields ?? [];

    if (!isValidHandle(name)) {
        return { type: 'invalid-input', field: 'name' };
    }

    if (fields.length > maxFieldsPerForm) {
        return { type: 'invalid-input', field: 'fields' };
    }

    const normalizedFields: DashboardProfileFieldInput[] = [];
    const fieldKeys = new Set<string>();

    for (const [index, field] of fields.entries()) {
        const label = field.label.trim();
        const fieldKey = (field.fieldKey?.trim() || slugifyHandle(label)).toLowerCase();

        if (!label) return { type: 'invalid-input', field: `fields.${index}.label` };
        if (!isValidHandle(fieldKey)) return { type: 'invalid-input', field: `fields.${index}.fieldKey` };
        if (fieldKeys.has(fieldKey)) return { type: 'invalid-input', field: `fields.${index}.fieldKey` };
        if (!isDashboardProfileFieldType(field.fieldType)) {
            return { type: 'invalid-input', field: `fields.${index}.fieldType` };
        }

        const maxLength = field.maxLength ?? null;

        if (maxLength !== null && (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 1000)) {
            return { type: 'invalid-input', field: `fields.${index}.maxLength` };
        }

        fieldKeys.add(fieldKey);
        normalizedFields.push({
            fieldKey,
            label,
            fieldType: field.fieldType,
            required: field.required ?? false,
            maxLength,
        });
    }

    return {
        type: 'valid',
        name,
        approvalRequired: input.approvalRequired ?? true,
        enabled: input.enabled ?? true,
        fields: normalizedFields,
    };
}

async function resolveProfileBuilderActor(request: Request): Promise<ProfileBuilderActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({ accessToken: authContextResult.value.accessToken });

    if (currentUserResult.isErr() || currentUserResult.value.id !== authContextResult.value.fluxerUserId) {
        return {
            type: 'actor',
            actorUserId: authContextResult.value.fluxerUserId,
            metadata: {},
        };
    }

    return {
        type: 'actor',
        actorUserId: authContextResult.value.fluxerUserId,
        metadata: {
            actorUsername: currentUserResult.value.username,
            ...(currentUserResult.value.globalName ? { actorDisplayName: currentUserResult.value.globalName } : {}),
        },
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardProfileBuilderErrorResult {
    switch (guildPageData.type) {
        case 'auth-required':
        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
            return { type: guildPageData.type };

        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}

function mapRepositoryError(error: { type: string; field?: string }) {
    switch (error.type) {
        case 'missing-input':
        case 'invalid-value':
            return { type: 'invalid-input' as const, field: error.field ?? 'unknown' };
        case 'not-found':
            return { type: 'not-found' as const };
        case 'database-error':
        default:
            return { type: 'database-error' as const };
    }
}

function slugifyHandle(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
}

function isValidHandle(value: string): boolean {
    return /^[a-z0-9][a-z0-9_-]{0,31}$/u.test(value);
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(value).map(([key, recordValue]) => [key, typeof recordValue === 'string' ? recordValue : ''])
    );
}
