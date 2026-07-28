import '@tanstack/react-start/server-only';

import {
    deactivateReactionRolePanel,
    listReactionRolePanelsByGuild,
    publishReactionRolePanel,
    updateReactionRolePanel,
} from '@neonflux/db';
import type { ReactionRolePanelRecord } from '@neonflux/db';
import type { FluxerReactionRoleCatalog } from '@neonflux/fluxer/reaction-roles';
import type { ReactionRolePanelDraft } from '@neonflux/reaction-roles';

import {
    readDashboardBotReactionRoleCatalog,
    wakeDashboardBotReactionRoleWorker,
} from './bot-internal-api-client.server.js';
import { authorizeDashboardPostingTarget } from './dashboard-posting-authorization.server.js';
import { validateDashboardReactionRolePanelInput } from './dashboard-reaction-role-validation.js';
import { getWebDb } from './db.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

export type DashboardReactionRolePanel = {
    channelId: string;
    createdAt: string;
    errorCode?: string;
    id: string;
    messageId?: string;
    name: string;
    payload: ReactionRolePanelDraft;
    status: ReactionRolePanelRecord['status'];
    updatedAt: string;
    version: number;
};

export type DashboardReactionRoleReadResult =
    | {
          catalog: FluxerReactionRoleCatalog;
          panels: DashboardReactionRolePanel[];
          type: 'reaction-roles';
      }
    | DashboardReactionRoleErrorResult;

export type DashboardReactionRoleMutationResult =
    | { panel: DashboardReactionRolePanel; type: 'panel' }
    | DashboardReactionRoleErrorResult
    | { message: string; type: 'invalid-panel' }
    | { type: 'conflict' };

type DashboardReactionRoleErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' }
    | { type: 'bot-token-missing' };

export async function loadDashboardReactionRoles(
    request: Request,
    guildId: string
): Promise<DashboardReactionRoleReadResult> {
    const guildPage = await loadDashboardGuildPageData(request, guildId);
    if (guildPage.type !== 'guild') return mapGuildPageError(guildPage.type);
    const [catalog, database] = await Promise.all([
        readDashboardBotReactionRoleCatalog(guildPage.guild.id),
        getWebDb(),
    ]);
    if (catalog.isErr()) {
        return catalog.error === 'not-configured' ? { type: 'bot-token-missing' } : { type: 'guild-lookup-failed' };
    }
    const panels = await listReactionRolePanelsByGuild(database.db, { guildId: guildPage.guild.id });
    return panels.isErr()
        ? { type: 'database-error' }
        : {
              catalog: catalog.value,
              panels: panels.value.map(toDashboardPanel),
              type: 'reaction-roles',
          };
}

export async function publishDashboardReactionRolePanel(
    request: Request,
    input: {
        channelId: string;
        guildId: string;
        name: string;
        payload: unknown;
        requestKey: string;
    }
): Promise<DashboardReactionRoleMutationResult> {
    const authorized = await authorizeMutation(request, input.guildId);
    if (authorized.type !== 'authorized') return authorized;
    const parsed = validateDashboardReactionRolePanelInput(input, authorized.catalog);
    if (parsed.type !== 'valid') return parsed;
    const database = await getWebDb();
    const result = await publishReactionRolePanel(database.db, {
        actorUserId: authorized.actorUserId,
        channelId: parsed.channelId,
        guildId: authorized.guildId,
        name: parsed.name,
        payload: parsed.payload,
        requestKey: input.requestKey,
    });
    if (result.isErr()) return mapMutationError(result.error.type, result.error.type === 'conflict');
    await wakeDashboardBotReactionRoleWorker();
    return { panel: toDashboardPanel(result.value.panel), type: 'panel' };
}

export async function updateDashboardReactionRolePanel(
    request: Request,
    input: {
        channelId: string;
        expectedUpdatedAt: string;
        guildId: string;
        name: string;
        panelId: string;
        payload: unknown;
        requestKey: string;
    }
): Promise<DashboardReactionRoleMutationResult> {
    const authorized = await authorizeMutation(request, input.guildId);
    if (authorized.type !== 'authorized') return authorized;
    const parsed = validateDashboardReactionRolePanelInput(input, authorized.catalog);
    if (parsed.type !== 'valid') return parsed;
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()) || !input.panelId.trim()) {
        return { message: 'Refresh the panel and try again.', type: 'invalid-panel' };
    }
    const database = await getWebDb();
    const result = await updateReactionRolePanel(database.db, {
        actorUserId: authorized.actorUserId,
        channelId: parsed.channelId,
        expectedUpdatedAt,
        guildId: authorized.guildId,
        name: parsed.name,
        panelId: input.panelId,
        payload: parsed.payload,
        requestKey: input.requestKey,
    });
    if (result.isErr()) return mapMutationError(result.error.type, result.error.type === 'conflict');
    await wakeDashboardBotReactionRoleWorker();
    return { panel: toDashboardPanel(result.value.panel), type: 'panel' };
}

export async function deactivateDashboardReactionRolePanel(
    request: Request,
    input: {
        deleteMessage: boolean;
        expectedUpdatedAt: string;
        guildId: string;
        panelId: string;
        requestKey: string;
        revokeOwnedRoles: boolean;
    }
): Promise<DashboardReactionRoleMutationResult> {
    const authorized = await authorizeMutation(request, input.guildId);
    if (authorized.type !== 'authorized') return authorized;
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime()) || !input.panelId.trim()) {
        return { message: 'Refresh the panel and try again.', type: 'invalid-panel' };
    }
    const database = await getWebDb();
    const result = await deactivateReactionRolePanel(database.db, {
        actorUserId: authorized.actorUserId,
        deleteMessage: input.deleteMessage,
        expectedUpdatedAt,
        guildId: authorized.guildId,
        panelId: input.panelId,
        requestKey: input.requestKey,
        revokeOwnedRoles: input.revokeOwnedRoles,
    });
    if (result.isErr()) return mapMutationError(result.error.type, result.error.type === 'conflict');
    await wakeDashboardBotReactionRoleWorker();
    return { panel: toDashboardPanel(result.value.panel), type: 'panel' };
}

async function authorizeMutation(
    request: Request,
    guildId: string
): Promise<
    | { actorUserId: string; catalog: FluxerReactionRoleCatalog; guildId: string; type: 'authorized' }
    | DashboardReactionRoleErrorResult
> {
    const auth = await readAuthenticatedFluxerContext(request);
    if (auth.isErr()) return auth.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    const authorization = await authorizeDashboardPostingTarget(auth.value, guildId);
    if (authorization.isErr()) return { type: authorization.error };
    const catalog = await readDashboardBotReactionRoleCatalog(authorization.value.guild.id);
    if (catalog.isErr()) {
        return catalog.error === 'not-configured' ? { type: 'bot-token-missing' } : { type: 'guild-lookup-failed' };
    }
    return {
        actorUserId: auth.value.fluxerUserId,
        catalog: catalog.value,
        guildId: authorization.value.guild.id,
        type: 'authorized',
    };
}

function toDashboardPanel(panel: ReactionRolePanelRecord): DashboardReactionRolePanel {
    return {
        channelId: panel.channelId,
        createdAt: panel.createdAt.toISOString(),
        ...(panel.errorCode ? { errorCode: panel.errorCode } : {}),
        id: panel.id,
        ...(panel.messageId ? { messageId: panel.messageId } : {}),
        name: panel.name,
        payload: panel.desiredVersion.payload,
        status: panel.status,
        updatedAt: panel.updatedAt.toISOString(),
        version: panel.desiredVersion.version,
    };
}

function mapGuildPageError(type: string): DashboardReactionRoleErrorResult {
    switch (type) {
        case 'auth-required':
            return { type: 'auth-required' };
        case 'deployment-config-not-found':
            return { type: 'deployment-config-not-found' };
        case 'database-error':
            return { type: 'database-error' };
        case 'guild-lookup-failed':
            return { type: 'guild-lookup-failed' };
        default:
            return { type: 'not-found' };
    }
}

function mapMutationError(type: string, conflict: boolean): DashboardReactionRoleMutationResult {
    if (conflict) return { type: 'conflict' };
    return type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}
