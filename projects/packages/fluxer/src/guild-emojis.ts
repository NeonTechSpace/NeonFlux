import { Client, type Guild } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

export type FluxerGuildEmoji = {
    id: string;
    guildId: string;
    name: string;
    animated: boolean;
    identifier: string;
    url?: string;
};

export type ReadFluxerGuildEmojisInput = {
    client: Client;
    guildId: string;
};

export type ReadFluxerBotGuildEmojisInput = Omit<ReadFluxerGuildEmojisInput, 'client'> & {
    botToken: string;
};

export type ReadFluxerGuildEmojisError =
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'unavailable-or-not-found' }
    | { type: 'fetch-failed'; error: unknown }
    | { type: 'invalid-response' };

export type ReadFluxerBotGuildEmojisError =
    | ReadFluxerGuildEmojisError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

type FetchableGuildEmojis = Guild & {
    fetchEmojis(): Promise<unknown>;
};

export async function readFluxerBotGuildEmojis(
    input: ReadFluxerBotGuildEmojisInput
): Promise<Result<FluxerGuildEmoji[], ReadFluxerBotGuildEmojisError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await readFluxerGuildEmojis({
            client,
            guildId: input.guildId,
        });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function readFluxerGuildEmojis(
    input: ReadFluxerGuildEmojisInput
): Promise<Result<FluxerGuildEmoji[], ReadFluxerGuildEmojisError>> {
    const guildId = input.guildId.trim();

    if (!guildId) {
        return err({ type: 'missing-input', field: 'guildId' });
    }

    try {
        const guild = await input.client.guilds.fetch(guildId);

        if (!guild || typeof (guild as FetchableGuildEmojis).fetchEmojis !== 'function') {
            return err({ type: 'unavailable-or-not-found' });
        }

        const emojis = await (guild as FetchableGuildEmojis).fetchEmojis();
        const normalizedEmojis = normalizeGuildEmojis(emojis);

        return normalizedEmojis ? ok(normalizedEmojis) : err({ type: 'invalid-response' });
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

function normalizeGuildEmojis(value: unknown): FluxerGuildEmoji[] | undefined {
    const emojis = Array.isArray(value) ? value : isCollection(value) ? [...value.values()] : undefined;

    if (!emojis) {
        return undefined;
    }

    const normalizedEmojis: FluxerGuildEmoji[] = [];

    for (const emoji of emojis) {
        const normalizedEmoji = normalizeGuildEmoji(emoji);

        if (!normalizedEmoji) {
            return undefined;
        }

        normalizedEmojis.push(normalizedEmoji);
    }

    return normalizedEmojis.sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
}

function normalizeGuildEmoji(value: unknown): FluxerGuildEmoji | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.guildId !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.animated !== 'boolean' ||
        typeof value.identifier !== 'string'
    ) {
        return undefined;
    }

    return {
        id: value.id,
        guildId: value.guildId,
        name: value.name,
        animated: value.animated,
        identifier: value.identifier,
        ...(typeof value.url === 'string' ? { url: value.url } : {}),
    };
}

function isCollection(value: unknown): value is { values(): Iterable<unknown> } {
    return isObject(value) && typeof value.values === 'function';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
