import type { Client, Guild } from '@fluxerjs/core';
import { describe, expect, it, vi } from 'vitest';

import {
    readFluxerGuildInvites,
    type FluxerGuildInvite,
    type ReadFluxerGuildInvitesError,
    type ReadFluxerGuildInvitesInput,
} from './invites.js';

describe('readFluxerGuildInvites', () => {
    it('rejects blank guild ids before fetching', async () => {
        const fetchGuild = createFetchGuildMock(Promise.resolve(createGuild()));

        const result = await readFluxerGuildInvites({
            client: createClient(fetchGuild),
            guildId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'guildId',
        } satisfies ReadFluxerGuildInvitesError);
        expect(fetchGuild).not.toHaveBeenCalled();
    });

    it('fetches and normalizes guild invites', async () => {
        const guild = createGuild({
            invites: [
                createInvite({
                    code: ' beta ',
                    inviterUserId: 'inviter-2',
                    channelId: 'channel-2',
                    uses: 1,
                    maxUses: 5,
                    expiresAt: new Date('2026-06-27T00:00:00.000Z'),
                    temporary: true,
                }),
                createInvite({
                    code: 'alpha',
                    inviter: { id: 'inviter-1' },
                    channel: { id: 'channel-1' },
                    uses: 2,
                }),
            ],
        });
        const fetchGuild = createFetchGuildMock(Promise.resolve(guild));

        const result = await readFluxerGuildInvites({
            client: createClient(fetchGuild),
            guildId: ' guild-1 ',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
        expect(guild.fetchInvites).toHaveBeenCalledOnce();
        expect(result._unsafeUnwrap()).toStrictEqual([
            {
                code: 'alpha',
                inviterUserId: 'inviter-1',
                channelId: 'channel-1',
                uses: 2,
                maxUses: null,
                expiresAt: null,
                temporary: false,
            },
            {
                code: 'beta',
                inviterUserId: 'inviter-2',
                channelId: 'channel-2',
                uses: 1,
                maxUses: 5,
                expiresAt: new Date('2026-06-27T00:00:00.000Z'),
                temporary: true,
            },
        ] satisfies FluxerGuildInvite[]);
    });

    it('reads invite collections from manager fetch APIs', async () => {
        const guild = {
            invites: {
                fetch: vi.fn<() => Promise<Map<string, unknown>>>().mockResolvedValue(
                    new Map([
                        [
                            'alpha',
                            createInvite({
                                code: 'alpha',
                                uses: 1,
                            }),
                        ],
                    ])
                ),
            },
        } as unknown as Guild;

        const result = await readFluxerGuildInvites({
            client: createClient(createFetchGuildMock(Promise.resolve(guild))),
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject([{ code: 'alpha', uses: 1 }]);
    });

    it('returns unsupported when the SDK exposes no invite reader', async () => {
        const result = await readFluxerGuildInvites({
            client: createClient(createFetchGuildMock(Promise.resolve({} as Guild))),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'unsupported',
        } satisfies ReadFluxerGuildInvitesError);
    });

    it('maps permission denied, not found, and SDK failures', async () => {
        expect.assertions(6);

        await expectInviteError(Object.assign(new Error('denied'), { status: 403 }), { type: 'permission-denied' });
        await expectInviteError(Object.assign(new Error('missing'), { statusCode: 404 }), { type: 'not-found' });

        const sdkError = new Error('Fluxer exploded');

        await expectInviteError(sdkError, { type: 'fetch-failed', error: sdkError });
    });

    it('returns invalid-response for malformed invite payloads', async () => {
        const result = await readFluxerGuildInvites({
            client: createClient(
                createFetchGuildMock(
                    Promise.resolve(
                        createGuild({
                            invites: [createMalformedInvite({ code: undefined })],
                        })
                    )
                )
            ),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-response',
        } satisfies ReadFluxerGuildInvitesError);
    });
});

async function expectInviteError(error: Error, expected: ReadFluxerGuildInvitesError): Promise<void> {
    const result = await readFluxerGuildInvites({
        client: createClient(createFetchGuildMock(Promise.reject(error))),
        guildId: 'guild-1',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual(expected);
}

function createClient(fetchGuild: FetchGuildMock): ReadFluxerGuildInvitesInput['client'] {
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
    fetchInvites: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>;
};

function createGuild(options: { invites?: unknown[] } = {}): TestGuild {
    return {
        fetchInvites: vi.fn<() => Promise<unknown[]>>().mockResolvedValue(options.invites ?? [createInvite()]),
    } as unknown as TestGuild;
}

type MockInvite = {
    code: string;
    inviterUserId: string | null;
    inviter?: { id: string };
    channelId: string | null;
    channel?: { id: string };
    uses: number;
    maxUses: number | null;
    expiresAt: Date | null;
    temporary: boolean;
};

function createInvite(overrides: Partial<MockInvite> = {}): unknown {
    return {
        code: 'alpha',
        inviterUserId: 'inviter-1',
        channelId: 'channel-1',
        uses: 0,
        maxUses: null,
        expiresAt: null,
        temporary: false,
        ...overrides,
    };
}

function createMalformedInvite(overrides: Record<string, unknown>): unknown {
    return {
        code: 'alpha',
        inviterUserId: 'inviter-1',
        channelId: 'channel-1',
        uses: 0,
        maxUses: null,
        expiresAt: null,
        temporary: false,
        ...overrides,
    };
}
