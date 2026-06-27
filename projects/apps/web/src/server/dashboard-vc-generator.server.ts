import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    deleteVcGeneratorRule,
    findVcGeneratorControlPanelByRuleId,
    listVcGeneratorControlPanelsByGuildId,
    listVcGeneratorRulesByGuildId,
    recordBotActionEvent,
    upsertVcGeneratorControlPanel,
    upsertVcGeneratorRule,
} from '@neonflux/db';
import type { VcGeneratorControlPanelRecord, VcGeneratorRuleRecord } from '@neonflux/db';
import {
    reactFluxerBotGuildChannelMessage,
    readFluxerBotGuildStructure,
    sendFluxerBotGuildChannelMessage,
} from '@neonflux/fluxer';
import type { FluxerGuildChannel } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardVcGeneratorChannel = {
    id: string;
    name: string;
    type: number;
    position: number;
    parentId?: string;
    parentName?: string;
};

export type DashboardVcGeneratorCategory = {
    id: string;
    name: string;
    position: number;
};

export type DashboardVcGeneratorRule = {
    id: string;
    sourceChannelId: string;
    sourceChannelName?: string;
    categoryId?: string;
    categoryName?: string;
    panelChannelId?: string;
    panelChannelName?: string;
    panelMessageId?: string;
    panelStatus?: string;
    nameTemplate: string;
    enabled: boolean;
    updatedAt: string;
};

export type DashboardVcGeneratorStructureReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardVcGeneratorSettingsResult =
    | {
          type: 'settings';
          structureReadStatus: DashboardVcGeneratorStructureReadStatus;
          voiceChannels: DashboardVcGeneratorChannel[];
          textChannels: DashboardVcGeneratorChannel[];
          categories: DashboardVcGeneratorCategory[];
          rules: DashboardVcGeneratorRule[];
      }
    | DashboardVcGeneratorErrorResult;

export type DashboardVcGeneratorRuleUpdateInput = {
    guildId: string;
    sourceChannelId: string;
    nameTemplate: string;
    categoryId?: string;
    panelChannelId?: string;
    enabled?: boolean;
};

export type DashboardVcGeneratorRuleDeleteInput = {
    guildId: string;
    sourceChannelId: string;
};

export type DashboardVcGeneratorRuleUpdateResult =
    | {
          type: 'updated';
          rule: DashboardVcGeneratorRule;
      }
    | { type: 'invalid-input'; field: string }
    | { type: 'bot-token-missing' }
    | { type: 'message-send-error' }
    | DashboardVcGeneratorErrorResult;

export type DashboardVcGeneratorRuleDeleteResult =
    | {
          type: 'deleted';
          rule: DashboardVcGeneratorRule;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardVcGeneratorErrorResult;

type DashboardVcGeneratorErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardVcGeneratorFeature = 'vc_generator';
const panelControlReactions = ['✏️', '#️⃣', '✅', '🚫', '🔒', '🔓'] as const;
const textChannelTypes = new Set([0, 5]);
const voiceChannelTypes = new Set([2]);

export async function loadDashboardVcGeneratorSettings(
    request: Request,
    guildId: string
): Promise<DashboardVcGeneratorSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = getWebDatabaseClient();
    const rulesResult = await listVcGeneratorRulesByGuildId(database.db, {
        guildId: guildPageData.guild.id,
    });
    const panelsResult = await listVcGeneratorControlPanelsByGuildId(database.db, {
        guildId: guildPageData.guild.id,
    });

    if (rulesResult.isErr() || panelsResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadDashboardVcGeneratorStructure(guildPageData.guild.id);
    const panelsByRuleId = new Map(panelsResult.value.map((panel) => [panel.ruleId, panel]));

    return {
        type: 'settings',
        structureReadStatus: structureResult.status,
        voiceChannels: structureResult.voiceChannels,
        textChannels: structureResult.textChannels,
        categories: structureResult.categories,
        rules: rulesResult.value.map((rule) =>
            toDashboardVcGeneratorRule(rule, {
                panel: panelsByRuleId.get(rule.id),
                channelsById: structureResult.channelsById,
                categoriesById: structureResult.categoriesById,
            })
        ),
    };
}

export async function updateDashboardVcGeneratorRule(
    request: Request,
    input: DashboardVcGeneratorRuleUpdateInput
): Promise<DashboardVcGeneratorRuleUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveVcGeneratorActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    if (input.panelChannelId && !loadWebConfig().fluxerBotToken) {
        return { type: 'bot-token-missing' };
    }

    const database = getWebDatabaseClient();
    const ruleResult = await upsertVcGeneratorRule(database.db, {
        guildId: guildPageData.guild.id,
        sourceChannelId: input.sourceChannelId,
        nameTemplate: input.nameTemplate,
        categoryId: input.categoryId,
        enabled: input.enabled ?? true,
    });

    if (ruleResult.isErr()) {
        return mapRepositoryError(ruleResult.error);
    }

    const structureResult = await loadDashboardVcGeneratorStructure(guildPageData.guild.id);
    const panelResult = input.panelChannelId
        ? await syncVcGeneratorControlPanel({
              guildId: guildPageData.guild.id,
              rule: ruleResult.value,
              panelChannelId: input.panelChannelId,
          })
        : undefined;

    if (panelResult?.type === 'bot-token-missing' || panelResult?.type === 'message-send-error') {
        return panelResult;
    }

    if (panelResult?.type === 'database-error') {
        return { type: 'database-error' };
    }

    const panel = panelResult?.panel;
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardVcGeneratorFeature,
        action: 'rule.updated',
        actorUserId: actorResult.actorUserId,
        targetId: ruleResult.value.sourceChannelId,
        metadata: {
            sourceChannelId: ruleResult.value.sourceChannelId,
            ...(structureResult.channelsById.get(ruleResult.value.sourceChannelId)
                ? { sourceChannelName: structureResult.channelsById.get(ruleResult.value.sourceChannelId)?.name }
                : {}),
            ...(ruleResult.value.categoryId ? { categoryId: ruleResult.value.categoryId } : {}),
            ...(ruleResult.value.categoryId && structureResult.categoriesById.get(ruleResult.value.categoryId)
                ? { categoryName: structureResult.categoriesById.get(ruleResult.value.categoryId)?.name }
                : {}),
            ...(panel ? { panelChannelId: panel.channelId } : {}),
            ...(panel?.messageId ? { panelMessageId: panel.messageId } : {}),
            nameTemplate: ruleResult.value.nameTemplate,
            enabled: ruleResult.value.enabled,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        rule: toDashboardVcGeneratorRule(ruleResult.value, {
            panel,
            channelsById: structureResult.channelsById,
            categoriesById: structureResult.categoriesById,
        }),
    };
}

export async function deleteDashboardVcGeneratorRule(
    request: Request,
    input: DashboardVcGeneratorRuleDeleteInput
): Promise<DashboardVcGeneratorRuleDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveVcGeneratorActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const structureResult = await loadDashboardVcGeneratorStructure(guildPageData.guild.id);
    const ruleResult = await deleteVcGeneratorRule(database.db, {
        guildId: guildPageData.guild.id,
        sourceChannelId: input.sourceChannelId,
    });

    if (ruleResult.isErr()) {
        return mapRepositoryError(ruleResult.error);
    }

    const rule = toDashboardVcGeneratorRule(ruleResult.value, {
        channelsById: structureResult.channelsById,
        categoriesById: structureResult.categoriesById,
    });
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardVcGeneratorFeature,
        action: 'rule.deleted',
        actorUserId: actorResult.actorUserId,
        targetId: ruleResult.value.sourceChannelId,
        metadata: {
            sourceChannelId: ruleResult.value.sourceChannelId,
            ...(rule.sourceChannelName ? { sourceChannelName: rule.sourceChannelName } : {}),
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        rule,
    };
}

async function syncVcGeneratorControlPanel(input: {
    guildId: string;
    rule: VcGeneratorRuleRecord;
    panelChannelId: string;
}): Promise<
    | { type: 'panel'; panel: VcGeneratorControlPanelRecord }
    | { type: 'bot-token-missing' }
    | { type: 'message-send-error' }
    | { type: 'database-error' }
> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return { type: 'bot-token-missing' };
    }

    const existingPanelResult = await findVcGeneratorControlPanelByRuleId(getWebDatabaseClient().db, {
        guildId: input.guildId,
        ruleId: input.rule.id,
    });

    if (
        existingPanelResult.isOk() &&
        existingPanelResult.value.channelId === input.panelChannelId &&
        existingPanelResult.value.messageId
    ) {
        return { type: 'panel', panel: existingPanelResult.value };
    }

    if (existingPanelResult.isErr() && existingPanelResult.error.type !== 'not-found') {
        return { type: 'database-error' };
    }

    const sendResult = await sendFluxerBotGuildChannelMessage({
        botToken,
        guildId: input.guildId,
        channelId: input.panelChannelId,
        embeds: [createVcGeneratorPanelEmbed(input.rule)],
    });

    if (sendResult.isErr()) {
        return { type: 'message-send-error' };
    }

    const controlsSynced = await syncVcGeneratorControlReactions({
        botToken,
        guildId: input.guildId,
        channelId: sendResult.value.channelId,
        messageId: sendResult.value.id,
    });

    const panelResult = await upsertVcGeneratorControlPanel(getWebDatabaseClient().db, {
        guildId: input.guildId,
        ruleId: input.rule.id,
        channelId: sendResult.value.channelId,
        messageId: sendResult.value.id,
        controlMode: 'reaction',
        status: controlsSynced ? 'active' : 'stale',
        synced: controlsSynced,
        config: {
            controls: ['rename', 'user_limit', 'whitelist', 'blacklist', 'lock', 'unlock'],
        },
    });

    return panelResult.isOk() ? { type: 'panel', panel: panelResult.value } : { type: 'database-error' };
}

async function syncVcGeneratorControlReactions(input: {
    botToken: string;
    guildId: string;
    channelId: string;
    messageId: string;
}): Promise<boolean> {
    for (const emoji of panelControlReactions) {
        const reactionResult = await reactFluxerBotGuildChannelMessage({
            botToken: input.botToken,
            guildId: input.guildId,
            channelId: input.channelId,
            messageId: input.messageId,
            emoji,
        });

        if (reactionResult.isErr()) {
            return false;
        }
    }

    return true;
}

function createVcGeneratorPanelEmbed(rule: VcGeneratorRuleRecord) {
    return {
        title: 'Voice channel controls',
        description: [
            'React to control your generated voice channel.',
            '',
            '✏️ Rename',
            '#️⃣ User limit',
            '✅ Whitelist',
            '🚫 Blacklist',
            '🔒 Lock',
            '🔓 Unlock',
        ].join('\n'),
        color: 0x12d8c4,
        footer: {
            text: `Template: ${rule.nameTemplate}`,
        },
    };
}

async function loadDashboardVcGeneratorStructure(guildId: string) {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return emptyStructureResult('bot-token-missing' as const);
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return emptyStructureResult('fetch-failed' as const);
    }

    const categories = structureResult.value.categories
        .map((category) => ({
            id: category.id,
            name: category.name ?? category.id,
            position: category.position ?? 0,
        }))
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const voiceChannels = toDashboardChannels(structureResult.value.channels, categoriesById, voiceChannelTypes);
    const textChannels = toDashboardChannels(structureResult.value.channels, categoriesById, textChannelTypes);

    return {
        status: 'available' as const,
        voiceChannels,
        textChannels,
        categories,
        channelsById: new Map([...voiceChannels, ...textChannels].map((channel) => [channel.id, channel])),
        categoriesById,
    };
}

function emptyStructureResult(status: Exclude<DashboardVcGeneratorStructureReadStatus, 'available'>) {
    return {
        status,
        voiceChannels: [],
        textChannels: [],
        categories: [],
        channelsById: new Map<string, DashboardVcGeneratorChannel>(),
        categoriesById: new Map<string, DashboardVcGeneratorCategory>(),
    };
}

function toDashboardChannels(
    channels: FluxerGuildChannel[],
    categoriesById: ReadonlyMap<string, DashboardVcGeneratorCategory>,
    allowedTypes: ReadonlySet<number>
): DashboardVcGeneratorChannel[] {
    return channels
        .filter((channel) => allowedTypes.has(channel.type))
        .map((channel) => ({
            id: channel.id,
            name: channel.name ?? channel.id,
            type: channel.type,
            position: channel.position ?? 0,
            ...(channel.parentId ? { parentId: channel.parentId } : {}),
            ...(channel.parentId && categoriesById.get(channel.parentId)
                ? { parentName: categoriesById.get(channel.parentId)?.name }
                : {}),
        }))
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

function toDashboardVcGeneratorRule(
    record: VcGeneratorRuleRecord,
    lookups: {
        panel?: VcGeneratorControlPanelRecord;
        channelsById: ReadonlyMap<string, DashboardVcGeneratorChannel>;
        categoriesById: ReadonlyMap<string, DashboardVcGeneratorCategory>;
    }
): DashboardVcGeneratorRule {
    const sourceChannel = lookups.channelsById.get(record.sourceChannelId);
    const category = record.categoryId ? lookups.categoriesById.get(record.categoryId) : undefined;
    const panelChannel = lookups.panel ? lookups.channelsById.get(lookups.panel.channelId) : undefined;

    return {
        id: record.id,
        sourceChannelId: record.sourceChannelId,
        ...(sourceChannel ? { sourceChannelName: sourceChannel.name } : {}),
        ...(record.categoryId ? { categoryId: record.categoryId } : {}),
        ...(category ? { categoryName: category.name } : {}),
        ...(lookups.panel ? { panelChannelId: lookups.panel.channelId } : {}),
        ...(panelChannel ? { panelChannelName: panelChannel.name } : {}),
        ...(lookups.panel?.messageId ? { panelMessageId: lookups.panel.messageId } : {}),
        ...(lookups.panel?.status ? { panelStatus: lookups.panel.status } : {}),
        nameTemplate: record.nameTemplate,
        enabled: record.enabled,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardVcGeneratorErrorResult {
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

type VcGeneratorActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveVcGeneratorActor(request: Request): Promise<VcGeneratorActor> {
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
