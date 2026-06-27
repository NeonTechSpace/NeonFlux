import '@tanstack/react-start/server-only';

import {
    deleteMessageTemplate,
    listMessageTemplatesByGuildId,
    recordBotActionEvent,
    upsertMessageTemplate,
} from '@neonflux/db';
import type { MessageTemplateRecord, PostingRepositoryError } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
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
    guildId: string;
    name: string;
    content?: string;
    embeds?: DashboardPostingJsonValue[];
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
    | DashboardPostingTemplateErrorResult;

export type DashboardMessageTemplateDeleteInput = {
    guildId: string;
    templateId: string;
};

export type DashboardMessageTemplateDeleteResult =
    | {
          type: 'deleted';
          templateId: string;
      }
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

    const database = getWebDatabaseClient();
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

    const database = getWebDatabaseClient();
    const templateResult = await upsertMessageTemplate(database.db, {
        guildId: guildPageData.guild.id,
        name: input.name,
        content: input.content,
        embeds: input.embeds ?? [],
        createdByUserId: actorResult.actorUserId,
    });

    if (templateResult.isErr()) {
        return mapTemplateWriteError(templateResult.error);
    }

    const auditResult = await recordTemplateAudit(database.db, guildPageData.guild.id, actorResult, {
        action: templateSavedAction,
        template: templateResult.value,
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
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

    const database = getWebDatabaseClient();
    const deleteResult = await deleteMessageTemplate(database.db, {
        guildId: guildPageData.guild.id,
        templateId: input.templateId,
    });

    if (deleteResult.isErr()) {
        return mapPostingRepositoryError(deleteResult.error);
    }

    const auditResult = await recordTemplateAudit(database.db, guildPageData.guild.id, actorResult, {
        action: templateDeletedAction,
        template: deleteResult.value,
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
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

async function recordTemplateAudit(
    db: Parameters<typeof recordBotActionEvent>[0],
    guildId: string,
    actor: Extract<PostingTemplateActor, { type: 'actor' }>,
    input: {
        action: string;
        template: MessageTemplateRecord;
    }
): Promise<'recorded' | 'database-error'> {
    const result = await recordBotActionEvent(db, {
        guildId,
        feature: postingTemplatesFeature,
        action: input.action,
        actorUserId: actor.actorUserId,
        targetId: input.template.id,
        metadata: {
            templateId: input.template.id,
            templateName: input.template.name,
            contentLength: input.template.content?.length ?? 0,
            embedCount: Array.isArray(input.template.embeds) ? input.template.embeds.length : 0,
            source: 'dashboard',
            ...actor.metadata,
        },
    });

    return result.isOk() ? 'recorded' : 'database-error';
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

    return mapPostingRepositoryError(errorValue);
}

function mapPostingRepositoryError(errorValue: PostingRepositoryError): DashboardPostingTemplateErrorResult {
    switch (errorValue.type) {
        case 'not-found':
            return { type: 'not-found' };

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
