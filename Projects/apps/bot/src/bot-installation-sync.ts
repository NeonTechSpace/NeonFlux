import type { AppMode } from '@neonflux/config';
import {
    deleteBotInstallation,
    listBotInstallationGuildIds,
    upsertBotInstallation,
    type BotInstallationRepositoryError,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { shouldProcessBotGuildEvent } from './mode-gate.js';

type BotInstallationDatabase = Parameters<typeof upsertBotInstallation>[0];

export type BotInstallationEvent = {
    guildId: string | null | undefined;
};

export type BotInstallationSyncResult =
    | {
          status: 'recorded';
          guildId: string;
      }
    | {
          status: 'removed';
          guildId: string;
      }
    | {
          status: 'ignored';
      };

export type BotInstallationReconciliationResult = {
    status: 'reconciled';
    recordedGuildIds: string[];
    removedGuildIds: string[];
};

export type BotInstallationSyncError = 'database-error';

export async function recordBotInstallationEvent(
    db: BotInstallationDatabase,
    mode: AppMode,
    event: BotInstallationEvent
): Promise<Result<BotInstallationSyncResult, BotInstallationSyncError>> {
    const guildId = normalizeGuildId(event.guildId);

    if (!guildId || !shouldProcessBotGuildEvent(mode, { guildId })) {
        return ok({ status: 'ignored' });
    }

    const result = await upsertBotInstallation(db, {
        guildId,
    });

    if (result.isErr()) {
        return mapRepositoryError(result.error);
    }

    return ok({
        status: 'recorded',
        guildId: result.value.guildId,
    });
}

export async function removeBotInstallationEvent(
    db: BotInstallationDatabase,
    mode: AppMode,
    event: BotInstallationEvent
): Promise<Result<BotInstallationSyncResult, BotInstallationSyncError>> {
    const guildId = normalizeGuildId(event.guildId);

    if (!guildId || !shouldProcessBotGuildEvent(mode, { guildId })) {
        return ok({ status: 'ignored' });
    }

    const result = await deleteBotInstallation(db, {
        guildId,
    });

    if (result.isErr()) {
        if (result.error === 'not-found') {
            return ok({ status: 'ignored' });
        }

        return mapRepositoryError(result.error);
    }

    return ok({
        status: 'removed',
        guildId: result.value.guildId,
    });
}

export async function reconcileBotInstallations(
    db: BotInstallationDatabase,
    mode: AppMode,
    input: { guildIds: readonly string[] }
): Promise<Result<BotInstallationReconciliationResult, BotInstallationSyncError>> {
    const currentGuildIds = getProcessableGuildIds(mode, input.guildIds);
    const recordedGuildIds: string[] = [];
    const removedGuildIds: string[] = [];

    for (const guildId of currentGuildIds) {
        const result = await upsertBotInstallation(db, { guildId });

        if (result.isErr()) {
            return mapRepositoryError(result.error);
        }

        recordedGuildIds.push(result.value.guildId);
    }

    const installedGuildIdsResult = await listBotInstallationGuildIds(db);

    if (installedGuildIdsResult.isErr()) {
        return mapRepositoryError(installedGuildIdsResult.error);
    }

    const currentGuildIdSet = new Set(currentGuildIds);

    for (const installedGuildId of installedGuildIdsResult.value) {
        if (!shouldRemoveInstalledGuild(mode, installedGuildId, currentGuildIdSet)) {
            continue;
        }

        const result = await deleteBotInstallation(db, { guildId: installedGuildId });

        if (result.isErr()) {
            if (result.error === 'not-found') {
                continue;
            }

            return mapRepositoryError(result.error);
        }

        removedGuildIds.push(result.value.guildId);
    }

    return ok({
        status: 'reconciled',
        recordedGuildIds,
        removedGuildIds,
    });
}

function normalizeGuildId(guildId: string | null | undefined): string | undefined {
    const normalizedGuildId = guildId?.trim();

    return normalizedGuildId && normalizedGuildId.length > 0 ? normalizedGuildId : undefined;
}

function getProcessableGuildIds(mode: AppMode, guildIds: readonly string[]): string[] {
    const normalizedGuildIds = new Set<string>();

    for (const guildId of guildIds) {
        const normalizedGuildId = normalizeGuildId(guildId);

        if (normalizedGuildId && shouldProcessBotGuildEvent(mode, { guildId: normalizedGuildId })) {
            normalizedGuildIds.add(normalizedGuildId);
        }
    }

    return [...normalizedGuildIds].sort();
}

function shouldRemoveInstalledGuild(
    mode: AppMode,
    installedGuildId: string,
    currentGuildIds: ReadonlySet<string>
): boolean {
    switch (mode.instanceMode) {
        case 'single':
            return installedGuildId === mode.singleGuildId && !currentGuildIds.has(installedGuildId);

        case 'multi':
            return !currentGuildIds.has(installedGuildId);
    }
}

function mapRepositoryError(errorValue: BotInstallationRepositoryError): Result<never, BotInstallationSyncError> {
    switch (errorValue) {
        case 'database-error':
        case 'missing-guild-id':
        case 'not-found':
            return err('database-error');
    }
}
