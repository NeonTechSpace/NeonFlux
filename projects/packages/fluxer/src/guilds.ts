import { err, ok, type Result } from 'neverthrow';

const FLUXER_CURRENT_USER_GUILDS_URL = 'https://api.fluxer.app/v1/users/@me/guilds';

export type FluxerGuildsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FluxerCurrentUserGuild = {
    id: string;
    name: string;
    permissions: string;
    iconHash?: string;
    ownerId?: string;
};

export type ListFluxerCurrentUserGuildsInput = {
    accessToken: string;
    before?: string;
    after?: string;
    limit?: number;
    withCounts?: boolean;
    fetch?: FluxerGuildsFetch;
};

export type ListFluxerCurrentUserGuildsError =
    | { type: 'missing-input'; field: 'accessToken' }
    | { type: 'invalid-input'; field: 'before' | 'after' | 'limit' }
    | { type: 'request-failed'; status: number; statusText: string }
    | { type: 'network-error'; error: unknown }
    | { type: 'invalid-response' };

export async function listFluxerCurrentUserGuilds(
    input: ListFluxerCurrentUserGuildsInput
): Promise<Result<FluxerCurrentUserGuild[], ListFluxerCurrentUserGuildsError>> {
    const accessToken = input.accessToken.trim();

    if (!accessToken) {
        return err({ type: 'missing-input', field: 'accessToken' });
    }

    const urlResult = buildCurrentUserGuildsUrl(input);

    if (urlResult.isErr()) {
        return err(urlResult.error);
    }

    let response: Response;

    try {
        response = await (input.fetch ?? fetch)(urlResult.value, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
    } catch (error) {
        return err({ type: 'network-error', error });
    }

    if (!response.ok) {
        return err({
            type: 'request-failed',
            status: response.status,
            statusText: response.statusText,
        });
    }

    let responseBody: unknown;

    try {
        responseBody = await response.json();
    } catch {
        return err({ type: 'invalid-response' });
    }

    const guilds = parseFluxerCurrentUserGuilds(responseBody);

    if (!guilds) {
        return err({ type: 'invalid-response' });
    }

    return ok(guilds);
}

function buildCurrentUserGuildsUrl(
    input: ListFluxerCurrentUserGuildsInput
): Result<string, Extract<ListFluxerCurrentUserGuildsError, { type: 'invalid-input' }>> {
    const url = new URL(FLUXER_CURRENT_USER_GUILDS_URL);
    const before = input.before?.trim();
    const after = input.after?.trim();

    if (input.before !== undefined) {
        if (!before) {
            return err({ type: 'invalid-input', field: 'before' });
        }

        url.searchParams.set('before', before);
    }

    if (input.after !== undefined) {
        if (!after) {
            return err({ type: 'invalid-input', field: 'after' });
        }

        url.searchParams.set('after', after);
    }

    if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
            return err({ type: 'invalid-input', field: 'limit' });
        }

        url.searchParams.set('limit', input.limit.toString());
    }

    if (input.withCounts === true) {
        url.searchParams.set('with_counts', 'true');
    }

    return ok(url.toString());
}

function parseFluxerCurrentUserGuilds(value: unknown): FluxerCurrentUserGuild[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const guilds: FluxerCurrentUserGuild[] = [];

    for (const item of value) {
        const guild = parseFluxerCurrentUserGuild(item);

        if (!guild) {
            return undefined;
        }

        guilds.push(guild);
    }

    return guilds;
}

function parseFluxerCurrentUserGuild(value: unknown): FluxerCurrentUserGuild | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    const id = value.id;
    const name = value.name;
    const permissions = value.permissions;
    const icon = value.icon;
    const ownerId = value.owner_id;

    if (typeof id !== 'string' || typeof name !== 'string' || typeof permissions !== 'string') {
        return undefined;
    }

    return {
        id,
        name,
        permissions,
        ...(typeof icon === 'string' && icon.trim().length > 0 ? { iconHash: icon.trim() } : {}),
        ...(typeof ownerId === 'string' && ownerId.trim().length > 0 ? { ownerId: ownerId.trim() } : {}),
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
