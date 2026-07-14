import { createServerFn } from '@tanstack/react-start';
import { parseOutgoingMessage } from '@neonflux/messaging';

import type {
    DashboardMessageTemplateDeleteInput,
    DashboardMessageTemplateDeleteResult,
    DashboardMessageTemplateSaveInput,
    DashboardMessageTemplateSaveResult,
    DashboardMessageTemplatesResult,
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
    const expectedUpdatedAt = payload.expectedUpdatedAt;
    const templateId = payload.templateId;
    const message = parseOutgoingMessage({
        ...(typeof content === 'string' ? { content } : {}),
        embeds: Array.isArray(embeds) ? embeds : [],
    });

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        name: typeof name === 'string' ? name : '',
        ...(message.isOk() && message.value.content ? { content: message.value.content } : {}),
        ...(message.isOk() ? { embeds: message.value.embeds } : {}),
        ...(typeof expectedUpdatedAt === 'string' ? { expectedUpdatedAt } : {}),
        ...(typeof templateId === 'string' ? { templateId } : {}),
    };
}

function validateDashboardPostingTemplateDeleteInput(input: unknown): DashboardMessageTemplateDeleteInput {
    if (!input || typeof input !== 'object') {
        return { expectedUpdatedAt: '', guildId: '', templateId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const templateId = payload.templateId;
    const expectedUpdatedAt = payload.expectedUpdatedAt;

    return {
        expectedUpdatedAt: typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : '',
        guildId: typeof guildId === 'string' ? guildId : '',
        templateId: typeof templateId === 'string' ? templateId : '',
    };
}
