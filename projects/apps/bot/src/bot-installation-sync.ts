import type { AppMode } from '@neonflux/config';
import { deleteBotInstallation, upsertBotInstallation, type BotInstallationRepositoryError } from '@neonflux/db';
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
        mode: mode.instanceMode,
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

function normalizeGuildId(guildId: string | null | undefined): string | undefined {
    const normalizedGuildId = guildId?.trim();

    return normalizedGuildId && normalizedGuildId.length > 0 ? normalizedGuildId : undefined;
}

function mapRepositoryError(errorValue: BotInstallationRepositoryError): Result<never, BotInstallationSyncError> {
    switch (errorValue) {
        case 'database-error':
        case 'missing-guild-id':
        case 'not-found':
            return err('database-error');
    }
}
