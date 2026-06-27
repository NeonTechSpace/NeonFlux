import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { runGuildAction, type FluxerPlatformError } from './platform-shared.js';

export type FluxerGuildInvite = {
    code: string;
    inviterUserId: string | null;
    channelId: string | null;
    uses: number;
    maxUses: number | null;
    expiresAt: Date | null;
    temporary: boolean;
};

export type ReadFluxerGuildInvitesInput = {
    client: FluxerBot['client'];
    guildId: string;
};

export type ReadFluxerGuildInvitesError =
    | { type: 'missing-input'; field: string }
    | { type: 'permission-denied' }
    | { type: 'not-found' }
    | { type: 'fetch-failed'; error: unknown }
    | { type: 'unsupported' }
    | { type: 'invalid-response' };

type GuildInviteFetchResult = { type: 'invites'; invites: unknown } | { type: 'unsupported' };
type GuildWithFetchInvites = Record<string, unknown> & {
    fetchInvites: () => Promise<unknown>;
};
type GuildWithInviteManager = Record<string, unknown> & {
    invites: {
        fetch: () => Promise<unknown>;
    };
};
type ValueCollection = {
    values: () => unknown;
};

export async function readFluxerGuildInvites(
    input: ReadFluxerGuildInvitesInput
): Promise<Result<FluxerGuildInvite[], ReadFluxerGuildInvitesError>> {
    const fetchResult = await runGuildAction(input.client, input.guildId, fetchGuildInvites);

    if (fetchResult.isErr()) {
        return err(mapInviteReadError(fetchResult.error));
    }

    if (fetchResult.value.type === 'unsupported') {
        return err({ type: 'unsupported' });
    }

    const invites = normalizeInviteCollection(fetchResult.value.invites);

    return invites ? ok(invites) : err({ type: 'invalid-response' });
}

function mapInviteReadError(error: FluxerPlatformError): ReadFluxerGuildInvitesError {
    switch (error.type) {
        case 'missing-input':
        case 'permission-denied':
        case 'not-found':
            return error;

        case 'invalid-value':
            return { type: 'invalid-response' };

        case 'operation-failed':
            return { type: 'fetch-failed', error: error.error };

        case 'unsupported':
            return { type: 'unsupported' };
    }
}

async function fetchGuildInvites(guild: unknown): Promise<GuildInviteFetchResult> {
    if (!isObject(guild)) {
        return { type: 'unsupported' };
    }

    if (hasFetchInvites(guild)) {
        return { type: 'invites', invites: await guild.fetchInvites() };
    }

    if (hasInviteManager(guild)) {
        return { type: 'invites', invites: await guild.invites.fetch() };
    }

    if ('invites' in guild) {
        return { type: 'invites', invites: guild.invites };
    }

    return { type: 'unsupported' };
}

function normalizeInviteCollection(value: unknown): FluxerGuildInvite[] | undefined {
    const invites = toIterableValues(value);

    if (!invites) {
        return undefined;
    }

    const normalizedInvites: FluxerGuildInvite[] = [];

    for (const invite of invites) {
        const normalizedInvite = normalizeInvite(invite);

        if (!normalizedInvite) {
            return undefined;
        }

        normalizedInvites.push(normalizedInvite);
    }

    return normalizedInvites.sort((left, right) => left.code.localeCompare(right.code));
}

function normalizeInvite(invite: unknown): FluxerGuildInvite | undefined {
    if (!isObject(invite) || typeof invite.code !== 'string' || !invite.code.trim()) {
        return undefined;
    }

    const uses = getOptionalNumber(invite.uses) ?? 0;
    const maxUses = getNullableNumber(invite.maxUses);
    const expiresAt = getNullableDate(invite.expiresAt ?? invite.expiresTimestamp);

    if (uses < 0 || (maxUses !== null && maxUses < 0) || expiresAt === undefined) {
        return undefined;
    }

    return {
        code: invite.code.trim(),
        inviterUserId: getNullableText(invite.inviterUserId ?? getNestedId(invite.inviter)),
        channelId: getNullableText(invite.channelId ?? getNestedId(invite.channel)),
        uses,
        maxUses,
        expiresAt,
        temporary: invite.temporary === true,
    };
}

function toIterableValues(value: unknown): Iterable<unknown> | undefined {
    if (isUnknownArray(value)) {
        return value;
    }

    if (value instanceof Map) {
        return (value as Map<unknown, unknown>).values();
    }

    if (isObject(value)) {
        if (hasValuesFunction(value)) {
            const values = value.values();

            return isIterable(values) ? values : undefined;
        }

        if (isObject(value.cache)) {
            return toIterableValues(value.cache);
        }
    }

    return undefined;
}

function getNestedId(value: unknown): unknown {
    return isObject(value) ? value.id : undefined;
}

function getNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();

    return normalized || null;
}

function getOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    return typeof value === 'number' && Number.isInteger(value) ? value : Number.NaN;
}

function getNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    return typeof value === 'number' && Number.isInteger(value) ? value : Number.NaN;
}

function getNullableDate(value: unknown): Date | null | undefined {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value;
    }

    if (typeof value === 'number') {
        const date = new Date(value);

        return Number.isNaN(date.getTime()) ? undefined : date;
    }

    if (typeof value === 'string') {
        const date = new Date(value);

        return Number.isNaN(date.getTime()) ? undefined : date;
    }

    return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasFetchInvites(value: Record<string, unknown>): value is GuildWithFetchInvites {
    return typeof value.fetchInvites === 'function';
}

function hasInviteManager(value: Record<string, unknown>): value is GuildWithInviteManager {
    return isObject(value.invites) && typeof value.invites.fetch === 'function';
}

function hasValuesFunction(value: Record<string, unknown>): value is ValueCollection {
    return typeof value.values === 'function';
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function isIterable(value: unknown): value is Iterable<unknown> {
    return isObject(value) && typeof (value as unknown as Iterable<unknown>)[Symbol.iterator] === 'function';
}
