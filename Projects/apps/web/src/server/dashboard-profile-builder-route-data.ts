import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardProfileBuilderReviewInput,
    DashboardProfileBuilderReviewResult,
    DashboardProfileBuilderSettingsResult,
    DashboardProfileBuilderUpdateInput,
    DashboardProfileBuilderUpdateResult,
    DashboardProfileFieldInput,
} from './dashboard-profile-builder.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

export const readDashboardProfileBuilderSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardProfileBuilderSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardProfileBuilderSettings } = await import('./dashboard-profile-builder.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardProfileBuilderSettings(getRequest(), data.guildId);
    });

export const updateDashboardProfileBuilderFormRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardProfileBuilderUpdateInput)
    .handler(async ({ data }): Promise<DashboardProfileBuilderUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardProfileBuilderForm } = await import('./dashboard-profile-builder.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardProfileBuilderForm(getRequest(), data);
    });

export const reviewDashboardProfileSubmissionRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardProfileBuilderReviewInput)
    .handler(async ({ data }): Promise<DashboardProfileBuilderReviewResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { reviewDashboardProfileSubmission } = await import('./dashboard-profile-builder.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return reviewDashboardProfileSubmission(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;

    return {
        guildId: readString(guildId),
    };
}

function validateDashboardProfileBuilderUpdateInput(input: unknown): DashboardProfileBuilderUpdateInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', name: '', fields: [] };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        name: readString(payload.name),
        approvalRequired: readOptionalBoolean(payload.approvalRequired),
        enabled: readOptionalBoolean(payload.enabled),
        fields: readFieldInputs(payload.fields),
    };
}

function validateDashboardProfileBuilderReviewInput(input: unknown): DashboardProfileBuilderReviewInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', submissionId: '', decision: 'rejected' };
    }

    const payload = input as Record<string, unknown>;
    const decision = payload.decision === 'approved' ? 'approved' : 'rejected';

    return {
        guildId: readString(payload.guildId),
        submissionId: readString(payload.submissionId),
        decision,
        reason: readOptionalString(payload.reason),
    };
}

function readFieldInputs(value: unknown): DashboardProfileFieldInput[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((item) => {
        if (!item || typeof item !== 'object') {
            return {
                label: '',
                fieldType: 'text',
            };
        }

        const field = item as Record<string, unknown>;
        const fieldType = field.fieldType === 'textarea' || field.fieldType === 'url' ? field.fieldType : 'text';

        return {
            fieldKey: readOptionalString(field.fieldKey),
            label: readString(field.label),
            fieldType,
            required: readOptionalBoolean(field.required),
            maxLength: typeof field.maxLength === 'number' ? field.maxLength : null,
        };
    });
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}
