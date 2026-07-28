import { describe, expect, it } from 'vitest';

import {
    parseReactionRoleCatalogResponse,
    reactionRoleCatalogProtocolVersion,
} from './reaction-role-catalog-contract.js';

const catalogResponse = {
    catalog: {
        channels: [
            {
                eligible: true,
                id: 'channel-1',
                name: 'roles',
                parentId: null,
                parentName: null,
                position: 1,
            },
        ],
        emojis: [
            {
                animated: false,
                id: 'emoji-1',
                markup: '<:sparkle:emoji-1>',
                name: 'sparkle',
                url: 'https://cdn.example.test/emoji-1.png',
            },
        ],
        guildId: 'guild-1',
        guildName: 'Guild',
        roles: [{ color: 0, eligible: true, id: 'role-1', name: 'Member' }],
    },
    protocolVersion: reactionRoleCatalogProtocolVersion,
    type: 'catalog',
} as const;

describe('parseReactionRoleCatalogResponse', () => {
    it('accepts the exact live catalog contract', () => {
        expect(parseReactionRoleCatalogResponse(catalogResponse).isOk()).toBe(true);
    });

    it('rejects unsafe emoji image URLs', () => {
        expect(
            parseReactionRoleCatalogResponse({
                ...catalogResponse,
                catalog: {
                    ...catalogResponse.catalog,
                    emojis: [{ ...catalogResponse.catalog.emojis[0], url: 'data:image/svg+xml,<svg />' }],
                },
            }).isErr()
        ).toBe(true);
    });

    it('rejects unversioned and widened responses', () => {
        expect(
            parseReactionRoleCatalogResponse({
                ...catalogResponse,
                catalog: { ...catalogResponse.catalog, unexpected: true },
            }).isErr()
        ).toBe(true);
        expect(
            parseReactionRoleCatalogResponse({
                ...catalogResponse,
                protocolVersion: reactionRoleCatalogProtocolVersion + 1,
            }).isErr()
        ).toBe(true);
    });
});
