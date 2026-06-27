import { createServerFn } from '@tanstack/react-start';

import type {
    PublicProfileBuilderPageResult,
    PublicProfileBuilderSubmitInput,
    PublicProfileBuilderSubmitResult,
} from './profile-builder.server.js';

type PublicProfileBuilderPageInput = {
    guildId: string;
    formName?: string;
};

export const readPublicProfileBuilderPageRouteData = createServerFn({ method: 'GET' })
    .validator(validatePublicProfileBuilderPageInput)
    .handler(async ({ data }): Promise<PublicProfileBuilderPageResult> => {
        const { setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadPublicProfileBuilderPage } = await import('./profile-builder.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadPublicProfileBuilderPage(data);
    });

export const submitPublicProfileBuilderFormRouteData = createServerFn({ method: 'POST' })
    .validator(validatePublicProfileBuilderSubmitInput)
    .handler(async ({ data }): Promise<PublicProfileBuilderSubmitResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { submitPublicProfileBuilderForm } = await import('./profile-builder.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return submitPublicProfileBuilderForm(getRequest(), data);
    });

function validatePublicProfileBuilderPageInput(input: unknown): PublicProfileBuilderPageInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        formName: readOptionalString(payload.formName),
    };
}

function validatePublicProfileBuilderSubmitInput(input: unknown): PublicProfileBuilderSubmitInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', formName: 'default', values: {} };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        formName: readString(payload.formName) || 'default',
        values: isRecord(payload.values) ? payload.values : {},
    };
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
