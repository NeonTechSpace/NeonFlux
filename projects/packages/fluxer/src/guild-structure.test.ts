import type { Client, Guild, GuildChannel, Role } from '@fluxerjs/core';
import { describe, expect, it, vi } from 'vitest';

import {
    readFluxerGuildStructure,
    type ReadFluxerGuildStructureError,
    type ReadFluxerGuildStructureInput,
} from './guild-structure.js';

describe('readFluxerGuildStructure', () => {
    it('rejects blank guild ids before fetching', async () => {
        const fetchGuild = createFetchGuildMock(Promise.resolve(createGuild()));

        const result = await readFluxerGuildStructure({
            client: createClient(fetchGuild),
            guildId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'guildId',
        } satisfies ReadFluxerGuildStructureError);
        expect(fetchGuild).not.toHaveBeenCalled();
    });

    it('fetches and normalizes guild roles, channels, and categories', async () => {
        const guild = createGuild({
            roles: [
                createRole({
                    id: 'role-1',
                    name: 'Member',
                    position: 1,
                    color: 12_345,
                    permissions: createPermissions('1024'),
                    hoist: false,
                    mentionable: true,
                }),
            ],
            channels: [
                createChannel({
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    parentId: 'category-1',
                    position: 2,
                }),
                createChannel({
                    id: 'category-1',
                    name: 'Info',
                    type: 4,
                    parentId: null,
                    position: 1,
                }),
            ],
        });
        const fetchGuild = createFetchGuildMock(Promise.resolve(guild));

        const result = await readFluxerGuildStructure({
            client: createClient(fetchGuild),
            guildId: ' guild-1 ',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
        expect(guild.fetchRoles).toHaveBeenCalledOnce();
        expect(guild.fetchChannels).toHaveBeenCalledOnce();
        expect(result._unsafeUnwrap()).toStrictEqual({
            guildId: 'guild-1',
            roles: [
                {
                    id: 'role-1',
                    name: 'Member',
                    position: 1,
                    color: 12_345,
                    permissions: '1024',
                    hoist: false,
                    mentionable: true,
                },
            ],
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    parentId: 'category-1',
                    position: 2,
                    permissionOverwrites: [],
                },
            ],
            categories: [
                {
                    id: 'category-1',
                    name: 'Info',
                    type: 4,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        });
    });

    it('returns empty arrays for empty guild structures', async () => {
        const result = await readFluxerGuildStructure({
            client: createClient(createFetchGuildMock(Promise.resolve(createGuild({ roles: [], channels: [] })))),
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            guildId: 'guild-1',
            roles: [],
            channels: [],
            categories: [],
        });
    });

    it('preserves channel permission overwrites', async () => {
        const result = await readFluxerGuildStructure({
            client: createClient(
                createFetchGuildMock(
                    Promise.resolve(
                        createGuild({
                            channels: [
                                createChannel({
                                    permissionOverwrites: [
                                        {
                                            id: 'role-1',
                                            type: 0,
                                            allow: '1024',
                                            deny: '2048',
                                        },
                                    ],
                                }),
                            ],
                        })
                    )
                )
            ),
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().channels[0]?.permissionOverwrites).toStrictEqual([
            {
                id: 'role-1',
                type: 0,
                allow: '1024',
                deny: '2048',
            },
        ]);
    });

    it('returns unavailable-or-not-found when the guild cannot be resolved', async () => {
        const result = await readFluxerGuildStructure({
            client: createClient(createFetchGuildMock(Promise.resolve(null))),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'unavailable-or-not-found',
        } satisfies ReadFluxerGuildStructureError);
    });

    it('maps guild fetch rejections to fetch-failed', async () => {
        const fetchError = new Error('guild fetch failed');

        const result = await readFluxerGuildStructure({
            client: createClient(createFetchGuildMock(Promise.reject(fetchError))),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'fetch-failed',
            error: fetchError,
        } satisfies ReadFluxerGuildStructureError);
    });

    it('maps role and channel fetch rejections to fetch-failed', async () => {
        const fetchError = new Error('channel fetch failed');

        const result = await readFluxerGuildStructure({
            client: createClient(
                createFetchGuildMock(
                    Promise.resolve(
                        createGuild({
                            channelsResult: Promise.reject(fetchError),
                        })
                    )
                )
            ),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'fetch-failed',
            error: fetchError,
        } satisfies ReadFluxerGuildStructureError);
    });

    it('returns invalid-response for malformed role data', async () => {
        const result = await readFluxerGuildStructure({
            client: createClient(
                createFetchGuildMock(
                    Promise.resolve(
                        createGuild({
                            roles: [
                                createMalformedRole({
                                    name: undefined,
                                }),
                            ],
                        })
                    )
                )
            ),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-response',
        } satisfies ReadFluxerGuildStructureError);
    });

    it('returns invalid-response for malformed channel data', async () => {
        const result = await readFluxerGuildStructure({
            client: createClient(
                createFetchGuildMock(
                    Promise.resolve(
                        createGuild({
                            channels: [
                                createChannel({
                                    permissionOverwrites: [
                                        {
                                            id: 'role-1',
                                            type: 0,
                                            allow: '1024',
                                        },
                                    ] as MockChannel['permissionOverwrites'],
                                }),
                            ],
                        })
                    )
                )
            ),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-response',
        } satisfies ReadFluxerGuildStructureError);
    });
});

function createClient(fetchGuild: FetchGuildMock): ReadFluxerGuildStructureInput['client'] {
    return {
        guilds: {
            fetch: fetchGuild,
        },
    } as unknown as Client;
}

type FetchGuildMock = ReturnType<typeof vi.fn<(guildId: string) => Promise<Guild | null>>>;

function createFetchGuildMock(result: Promise<Guild | null>): FetchGuildMock {
    return vi.fn<(guildId: string) => Promise<Guild | null>>().mockReturnValue(result);
}

type TestGuild = Guild & {
    fetchRoles: ReturnType<typeof vi.fn<() => Promise<Role[]>>>;
    fetchChannels: ReturnType<typeof vi.fn<() => Promise<GuildChannel[]>>>;
};

function createGuild(
    options: {
        roles?: Role[];
        channels?: GuildChannel[];
        rolesResult?: Promise<Role[]>;
        channelsResult?: Promise<GuildChannel[]>;
    } = {}
): TestGuild {
    return {
        fetchRoles: vi
            .fn<() => Promise<Role[]>>()
            .mockReturnValue(options.rolesResult ?? Promise.resolve(options.roles ?? [createRole()])),
        fetchChannels: vi
            .fn<() => Promise<GuildChannel[]>>()
            .mockReturnValue(options.channelsResult ?? Promise.resolve(options.channels ?? [createChannel()])),
    } as unknown as TestGuild;
}

type MockRole = {
    id: string;
    name: string;
    position: number;
    color: number;
    permissions: { valueOf(): string };
    hoist: boolean;
    mentionable: boolean;
};

function createRole(overrides: Partial<MockRole> = {}): Role {
    return createRoleFromRaw(overrides);
}

function createMalformedRole(overrides: Record<string, unknown>): Role {
    return createRoleFromRaw(overrides);
}

function createRoleFromRaw(overrides: Record<string, unknown>): Role {
    return {
        id: 'role-1',
        name: 'Member',
        position: 1,
        color: 0,
        permissions: createPermissions('64'),
        hoist: false,
        mentionable: false,
        ...overrides,
    } as unknown as Role;
}

function createPermissions(bitfield: string): { valueOf(): string } {
    return {
        valueOf: () => bitfield,
    };
}

type MockChannel = {
    id: string;
    name: string | null;
    type: number;
    parentId: string | null;
    position?: number;
    permissionOverwrites: Array<{
        id: string;
        type: number;
        allow: string;
        deny: string;
    }>;
};

function createChannel(overrides: Partial<MockChannel> = {}): GuildChannel {
    return {
        id: 'channel-1',
        name: 'general',
        type: 0,
        parentId: null,
        position: 1,
        permissionOverwrites: [],
        ...overrides,
    } as unknown as GuildChannel;
}
