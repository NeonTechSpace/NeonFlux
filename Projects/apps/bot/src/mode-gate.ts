import { shouldHandleGuildEvent, type GuildEventScope } from '@neonflux/core';

import type { AppMode } from '@neonflux/config';

export function shouldProcessBotGuildEvent(mode: AppMode, event: GuildEventScope): boolean {
    return shouldHandleGuildEvent(mode, event);
}
