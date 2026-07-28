import { resolveEffectiveGuildDefcon } from '@neonflux/core/defcon';
import { readReactionRoleExecutionPolicy } from '@neonflux/db';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export async function reactionRolesAllowed(context: BotFeatureHandlerContext, guildId: string): Promise<boolean> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId })) return false;
    const facts = await readReactionRoleExecutionPolicy(context.db, { guildId });
    if (facts.isErr() || !facts.value.botInstalled) return false;
    return (
        resolveEffectiveGuildDefcon({
            appEnv: context.appEnv,
            override: context.guildDefconOverride,
            storedLevel: facts.value.storedDefconLevel,
        }) !== 1
    );
}
