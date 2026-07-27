import '@tanstack/react-start/server-only';

import { listBotActionEventPageByGuildId } from '@neonflux/db';

import type {
    DashboardAuditEvent,
    DashboardAuditEventsInput,
    DashboardAuditEventsResult,
    DashboardAuditMetadata,
} from './dashboard-audit-events-model.js';
import { getWebDb } from './db.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

const dashboardAuditPageSize = 40;

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;
type DashboardGuildPageErrorResult = Exclude<DashboardAuditEventsResult, { type: 'events' }>;

export async function loadDashboardGuildAuditEventsPage(
    request: Request,
    input: DashboardAuditEventsInput
): Promise<DashboardAuditEventsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const cursor = normalizeDashboardAuditCursor(input.cursor);

    if (cursor === 'invalid') {
        return { type: 'database-error' };
    }

    const database = await getWebDb();
    const eventsResult = await listBotActionEventPageByGuildId(database.db, {
        guildId: guildPageData.guild.id,
        ...(cursor ? { cursor } : {}),
        limit: input.limit ?? dashboardAuditPageSize,
        ...(input.search ? { search: input.search } : {}),
        ...(input.searchScope ? { searchScope: input.searchScope } : {}),
        ...(typeof input.searchOffsetMinutes === 'number' ? { searchOffsetMinutes: input.searchOffsetMinutes } : {}),
    });

    if (eventsResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'events',
        auditEvents: eventsResult.value.records.map(toDashboardAuditEvent),
        ...(eventsResult.value.nextCursor ? { nextCursor: eventsResult.value.nextCursor } : {}),
    };
}

function toDashboardAuditEvent(record: {
    id: string;
    feature: string;
    action: string;
    actorUserId: string | null;
    targetId: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
}): DashboardAuditEvent {
    const metadata = toDashboardAuditMetadata(record.metadata);
    const actorUsername = getMetadataString(record.metadata.actorUsername);
    const actorDisplayName =
        getMetadataString(record.metadata.actorDisplayName) ?? getMetadataString(record.metadata.actorGlobalName);

    return {
        id: record.id,
        feature: record.feature,
        action: record.action,
        ...(record.actorUserId ? { actorUserId: record.actorUserId } : {}),
        ...(actorUsername ? { actorUsername } : {}),
        ...(actorDisplayName ? { actorDisplayName } : {}),
        ...(record.targetId ? { targetId: record.targetId } : {}),
        metadata,
        createdAt: record.createdAt.toISOString(),
    };
}

function toDashboardAuditMetadata(metadata: Record<string, unknown>): DashboardAuditMetadata {
    const serializableMetadata: DashboardAuditMetadata = {};

    for (const [key, value] of Object.entries(metadata)) {
        if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
            serializableMetadata[key] = value;
            continue;
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            serializableMetadata[key] = value;
        }
    }

    return serializableMetadata;
}

function getMetadataString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeDashboardAuditCursor(cursor: string | undefined): string | undefined | 'invalid' {
    if (!cursor) {
        return undefined;
    }

    const normalizedCursor = cursor.trim();
    return normalizedCursor.length > 0 && normalizedCursor.length <= 1_024 ? normalizedCursor : 'invalid';
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardGuildPageErrorResult {
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
