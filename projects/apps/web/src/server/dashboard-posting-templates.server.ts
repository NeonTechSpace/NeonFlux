import '@tanstack/react-start/server-only';

import { deleteMessageTemplate, listMessageTemplatesByGuildId, upsertMessageTemplate } from '@neonflux/db';
import type { MessageTemplateRecord, PostingRepositoryError } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDb } from './db.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardMessageTemplate = {
    id: string;
    guildId: string;
    name: string;
    content?: string;
    embeds: DashboardPostingJsonValue[];
    createdByUserId?: string;
    updatedAt: string;
};

export type DashboardPostingJsonValue =
    | string
    | number
    | boolean
    | null
    | DashboardPostingJsonValue[]
    | { [key: string]: DashboardPostingJsonValue };

export type DashboardMessageTemplatesResult =
    | {
          type: 'templates';
          templates: DashboardMessageTemplate[];
      }
    | DashboardPostingTemplateErrorResult;

export type DashboardMessageTemplateSaveInput = {
    expectedUpdatedAt?: string;
    guildId: string;
    name: string;
    content?: string;
    embeds?: DashboardPostingJsonValue[];
    templateId?: string;
};

export type DashboardMessageTemplateSaveResult =
    | {
          type: 'saved';
          template: DashboardMessageTemplate;
      }
    | {
          type: 'invalid-template';
          message: string;
      }
    | { type: 'template-conflict'; field: 'name' | 'updatedAt' }
    | DashboardPostingTemplateErrorResult;

export type DashboardMessageTemplateDeleteInput = {
    expectedUpdatedAt: string;
    guildId: string;
    templateId: string;
};

export type DashboardMessageTemplateDeleteResult =
    | {
          type: 'deleted';
          templateId: string;
      }
    | { type: 'template-conflict'; field: 'updatedAt' }
    | DashboardPostingTemplateErrorResult;

type DashboardPostingTemplateErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type PostingTemplateActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

const postingTemplatesFeature = 'posting';
const templateSavedAction = 'template.saved';
const templateDeletedAction = 'template.deleted';

export async function loadDashboardMessageTemplates(
    request: Request,
    guildId: string
): Promise<DashboardMessageTemplatesResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = await getWebDb();
    const templatesResult = await listMessageTemplatesByGuildId(database.db, {
        guildId: guildPageData.guild.id,
    });

    if (templatesResult.isErr()) {
        return mapPostingRepositoryError(templatesResult.error);
    }

    return {
        type: 'templates',
        templates: templatesResult.value.map(toDashboardMessageTemplate),
    };
}

export async function saveDashboardMessageTemplate(
    request: Request,
    input: DashboardMessageTemplateSaveInput
): Promise<DashboardMessageTemplateSaveResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolvePostingTemplateActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = await getWebDb();
    const templateResult = await upsertMessageTemplate(database.db, {
        audit: {
            action: templateSavedAction,
            actorUserId: actorResult.actorUserId,
            feature: postingTemplatesFeature,
            metadata: {
                source: 'dashboard',
                ...actorResult.metadata,
            },
        },
        guildId: guildPageData.guild.id,
        name: input.name,
        content: input.content,
        embeds: input.embeds ?? [],
        createdByUserId: actorResult.actorUserId,
        ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
        ...(input.templateId ? { templateId: input.templateId } : {}),
    });

    if (templateResult.isErr()) {
        return mapTemplateWriteError(templateResult.error);
    }

    return {
        type: 'saved',
        template: toDashboardMessageTemplate(templateResult.value),
    };
}

export async function deleteDashboardMessageTemplate(
    request: Request,
    input: DashboardMessageTemplateDeleteInput
): Promise<DashboardMessageTemplateDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolvePostingTemplateActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = await getWebDb();
    const deleteResult = await deleteMessageTemplate(database.db, {
        audit: {
            action: templateDeletedAction,
            actorUserId: actorResult.actorUserId,
            feature: postingTemplatesFeature,
            metadata: {
                source: 'dashboard',
                ...actorResult.metadata,
            },
        },
        expectedUpdatedAt: input.expectedUpdatedAt,
        guildId: guildPageData.guild.id,
        templateId: input.templateId,
    });

    if (deleteResult.isErr()) {
        if (deleteResult.error.type === 'conflict') {
            return { field: 'updatedAt', type: 'template-conflict' };
        }

        return mapPostingRepositoryError(deleteResult.error);
    }

    return {
        type: 'deleted',
        templateId: deleteResult.value.id,
    };
}

async function resolvePostingTemplateActor(request: Request): Promise<PostingTemplateActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({
        accessToken: authContextResult.value.accessToken,
    });

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

function toDashboardMessageTemplate(template: MessageTemplateRecord): DashboardMessageTemplate {
    return {
        id: template.id,
        guildId: template.guildId,
        name: template.name,
        ...(template.content ? { content: template.content } : {}),
        embeds: toDashboardPostingJsonArray(template.embeds),
        ...(template.createdByUserId ? { createdByUserId: template.createdByUserId } : {}),
        updatedAt: template.updatedAt.toISOString(),
    };
}

function toDashboardPostingJsonArray(value: unknown): DashboardPostingJsonValue[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map(toDashboardPostingJsonValue).filter((item) => item !== undefined);
}

function toDashboardPostingJsonValue(value: unknown): DashboardPostingJsonValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
        return value.map(toDashboardPostingJsonValue).filter((item) => item !== undefined);
    }

    if (value && typeof value === 'object') {
        const output: { [key: string]: DashboardPostingJsonValue } = {};

        for (const [key, child] of Object.entries(value)) {
            const jsonValue = toDashboardPostingJsonValue(child);

            if (jsonValue !== undefined) {
                output[key] = jsonValue;
            }
        }

        return output;
    }

    return undefined;
}

function mapTemplateWriteError(errorValue: PostingRepositoryError): DashboardMessageTemplateSaveResult {
    if (errorValue.type === 'missing-input') {
        return {
            type: 'invalid-template',
            message:
                errorValue.field === 'message'
                    ? 'Add message content or at least one embed before saving.'
                    : 'Template name is required.',
        };
    }

    if (errorValue.type === 'conflict') {
        return { field: errorValue.field, type: 'template-conflict' };
    }

    return mapPostingRepositoryError(errorValue);
}

function mapPostingRepositoryError(errorValue: PostingRepositoryError): DashboardPostingTemplateErrorResult {
    switch (errorValue.type) {
        case 'not-found':
            return { type: 'not-found' };

        case 'conflict':
        case 'missing-input':
        case 'invalid-value':
        case 'invalid-status-transition':
        case 'database-error':
            return { type: 'database-error' };
    }
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, { type: 'guild' }>
): DashboardPostingTemplateErrorResult {
    switch (guildPageData.type) {
        case 'auth-required':
            return { type: 'auth-required' };

        case 'deployment-config-not-found':
            return { type: 'deployment-config-not-found' };

        case 'database-error':
            return { type: 'database-error' };

        case 'guild-lookup-failed':
            return { type: 'guild-lookup-failed' };

        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}
