import { describe, expect, it } from 'vitest';

import {
    botReadPostingWakePath,
    botReadProtocolVersion,
    createBotReadGuildStructurePath,
    parseBotReadGuildStructureResponse,
    parseBotReadPostingWakeResponse,
} from './bot-read-contract.js';

describe('bot read wire contract', () => {
    it('round-trips the normalized guild structure payload', () => {
        const result = parseBotReadGuildStructureResponse({
            protocolVersion: botReadProtocolVersion,
            type: 'structure',
            structure: {
                guildId: 'guild-1',
                guildName: 'Guild One',
                botHighestRolePosition: 4,
                roles: [
                    {
                        id: 'role-1',
                        name: 'Role',
                        position: 1,
                        color: 0,
                        permissions: '8',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'general',
                        type: 0,
                        parentId: null,
                        position: 0,
                        permissionOverwrites: [{ id: 'role-1', type: 0, allow: '0', deny: '0' }],
                    },
                ],
                categories: [],
            },
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({ type: 'structure', structure: { guildId: 'guild-1' } });
    });

    it('rejects version drift, extra fields, and malformed nested structures', () => {
        expect(parseBotReadGuildStructureResponse({ protocolVersion: 2, type: 'read-failed' }).isErr()).toBe(true);
        expect(
            parseBotReadGuildStructureResponse({
                protocolVersion: botReadProtocolVersion,
                type: 'read-failed',
                providerBody: 'secret',
            }).isErr()
        ).toBe(true);
        expect(
            parseBotReadGuildStructureResponse({
                protocolVersion: botReadProtocolVersion,
                type: 'structure',
                structure: { guildId: 'guild-1', guildName: 'Guild', roles: [], channels: [{}], categories: [] },
            }).isErr()
        ).toBe(true);
    });

    it('encodes guild ids as one path segment', () => {
        expect(createBotReadGuildStructurePath('guild/one')).toBe('/v1/guilds/guild%2Fone/structure');
    });

    it('validates the exact posting wake acknowledgement', () => {
        expect(
            parseBotReadPostingWakeResponse({ protocolVersion: botReadProtocolVersion, type: 'accepted' }).isOk()
        ).toBe(true);
        expect(parseBotReadPostingWakeResponse({ protocolVersion: 2, type: 'accepted' }).isErr()).toBe(true);
        expect(
            parseBotReadPostingWakeResponse({
                protocolVersion: botReadProtocolVersion,
                type: 'accepted',
                detail: 'unexpected',
            }).isErr()
        ).toBe(true);
        expect(botReadPostingWakePath).toBe('/v1/posting/wake');
    });
});
