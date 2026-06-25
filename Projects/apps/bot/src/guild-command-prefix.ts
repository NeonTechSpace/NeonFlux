import { DEFAULT_COMMAND_PREFIX } from '@neonflux/core/command-prefix';
import { findGuildCommandSettingsByGuildId } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';

export async function findEffectiveGuildCommandPrefix(
    context: BotFeatureHandlerContext,
    guildId: string
): Promise<Result<string, 'database-error'>> {
    const settingsResult = await findGuildCommandSettingsByGuildId(context.db, { guildId });

    if (settingsResult.isOk()) {
        return ok(settingsResult.value.prefix);
    }

    return settingsResult.error === 'not-found' ? ok(DEFAULT_COMMAND_PREFIX) : err('database-error');
}
