import type { FluxerBot } from './client.js';
import { readFluxerGuildStructure, type FluxerGuildStructure } from './guild-structure.js';
import {
    createChannelPlatform,
    createMemberPlatform,
    createModerationPlatform,
    createRolePlatform,
} from './platform-guild-operations.js';
import { createMessagePlatform } from './platform-messages.js';

export type { FluxerPlatformError } from './platform-shared.js';

export type FluxerPlatform = ReturnType<typeof createFluxerPlatform>;
export type FluxerStructureExport = FluxerGuildStructure;

export function createFluxerPlatform(client: FluxerBot['client']) {
    return {
        messages: createMessagePlatform(client),
        members: createMemberPlatform(client),
        moderation: createModerationPlatform(client),
        channels: createChannelPlatform(client),
        roles: createRolePlatform(client),
        guildStructure: {
            read: (input: { guildId: string }) => readFluxerGuildStructure({ client, guildId: input.guildId }),
        },
    };
}
