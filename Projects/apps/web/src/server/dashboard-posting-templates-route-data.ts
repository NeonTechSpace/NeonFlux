import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardMessageTemplateDeleteInput,
    DashboardMessageTemplateDeleteResult,
    DashboardMessageTemplateSaveInput,
    DashboardMessageTemplateSaveResult,
    DashboardMessageTemplatesResult,
    DashboardPostingJsonValue,
} from './dashboard-posting-templates.server.js';

export const readDashboardPostingTemplatesRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardPostingTemplatesReadInput)
    .handler(async ({ data }): Promise<DashboardMessageTemplatesResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardMessageTemplates } = await import('./dashboard-posting-templates.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardMessageTemplates(getRequest(), data.guildId);
    });

export const saveDashboardPostingTemplateRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardPostingTemplateSaveInput)
    .handler(async ({ data }): Promise<DashboardMessageTemplateSaveResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { saveDashboardMessageTemplate } = await import('./dashboard-posting-templates.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return saveDashboardMessageTemplate(getRequest(), data);
    });

export const deleteDashboardPostingTemplateRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardPostingTemplateDeleteInput)
    .handler(async ({ data }): Promise<DashboardMessageTemplateDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardMessageTemplate } = await import('./dashboard-posting-templates.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardMessageTemplate(getRequest(), data);
    });

function validateDashboardPostingTemplatesReadInput(input: unknown): { guildId: string } {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
    };
}

function validateDashboardPostingTemplateSaveInput(input: unknown): DashboardMessageTemplateSaveInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', name: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const name = payload.name;
    const content = payload.content;
    const embeds = payload.embeds;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        name: typeof name === 'string' ? name : '',
        ...(typeof content === 'string' ? { content } : {}),
        ...(Array.isArray(embeds) ? { embeds: toSerializableJsonArray(embeds) } : {}),
    };
}

function toSerializableJsonArray(value: unknown[]): DashboardPostingJsonValue[] {
    return value.map(toSerializableJsonValue).filter((item) => item !== undefined);
}

function toSerializableJsonValue(value: unknown): DashboardPostingJsonValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
        return toSerializableJsonArray(value);
    }

    if (value && typeof value === 'object') {
        const output: { [key: string]: DashboardPostingJsonValue } = {};

        for (const [key, child] of Object.entries(value)) {
            const jsonValue = toSerializableJsonValue(child);

            if (jsonValue !== undefined) {
                output[key] = jsonValue;
            }
        }

        return output;
    }

    return undefined;
}

function validateDashboardPostingTemplateDeleteInput(input: unknown): DashboardMessageTemplateDeleteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', templateId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const templateId = payload.templateId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        templateId: typeof templateId === 'string' ? templateId : '',
    };
}
