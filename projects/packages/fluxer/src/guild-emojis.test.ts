import { describe, expect, it, vi } from 'vitest';

import { readFluxerGuildEmojis } from './guild-emojis.js';

describe('readFluxerGuildEmojis', () => {
    it('normalizes sorted guild custom emojis from the SDK', async () => {
        const fetchEmojis = vi
            .fn()
            .mockResolvedValue([
                createGuildEmoji({ id: 'emoji-2', name: 'wave', identifier: 'wave:emoji-2' }),
                createGuildEmoji({ id: 'emoji-1', name: 'party', identifier: 'party:emoji-1' }),
            ]);
        const fetchGuild = vi.fn().mockResolvedValue({ fetchEmojis });
        const client = createClient({
            guilds: {
                fetch: fetchGuild,
            },
        });

        const result = await readFluxerGuildEmojis({
            client,
            guildId: ' guild-1 ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual([
            {
                id: 'emoji-1',
                guildId: 'guild-1',
                name: 'party',
                animated: false,
                identifier: 'party:emoji-1',
                url: 'https://cdn.example/emoji-1.webp',
            },
            {
                id: 'emoji-2',
                guildId: 'guild-1',
                name: 'wave',
                animated: false,
                identifier: 'wave:emoji-2',
                url: 'https://cdn.example/emoji-2.webp',
            },
        ]);
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
    });

    it('maps blank guild id before fetching', async () => {
        const fetch = vi.fn();

        const result = await readFluxerGuildEmojis({
            client: createClient({ guilds: { fetch } }),
            guildId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'guildId' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects invalid emoji responses', async () => {
        const result = await readFluxerGuildEmojis({
            client: createClient({
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        fetchEmojis: vi.fn().mockResolvedValue([{ id: 123 }]),
                    }),
                },
            }),
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });
});

function createGuildEmoji(overrides: Partial<Record<'id' | 'name' | 'identifier', string>> = {}) {
    const id = overrides.id ?? 'emoji-1';

    return {
        id,
        guildId: 'guild-1',
        name: overrides.name ?? 'party',
        animated: false,
        identifier: overrides.identifier ?? `party:${id}`,
        url: `https://cdn.example/${id}.webp`,
    };
}

function createClient(overrides: Record<string, unknown>) {
    return overrides as unknown as Parameters<typeof readFluxerGuildEmojis>[0]['client'];
}
