import { err, ok, type Result } from 'neverthrow';

const FLUXER_CURRENT_USER_URL = 'https://api.fluxer.app/v1/users/@me';

export type FluxerUsersFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FluxerCurrentUser = {
    id: string;
    username: string;
    discriminator: string;
    globalName: string | null;
    avatar: string | null;
    bot: boolean;
    system: boolean;
};

export type GetFluxerCurrentUserInput = {
    accessToken: string;
    fetch?: FluxerUsersFetch;
};

export type GetFluxerCurrentUserError =
    | { type: 'missing-input'; field: 'accessToken' }
    | { type: 'request-failed'; status: number; statusText: string }
    | { type: 'network-error'; error: unknown }
    | { type: 'invalid-response' };

export async function getFluxerCurrentUser(
    input: GetFluxerCurrentUserInput
): Promise<Result<FluxerCurrentUser, GetFluxerCurrentUserError>> {
    const accessToken = input.accessToken.trim();

    if (!accessToken) {
        return err({ type: 'missing-input', field: 'accessToken' });
    }

    let response: Response;

    try {
        response = await (input.fetch ?? fetch)(FLUXER_CURRENT_USER_URL, {
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

    const currentUser = parseFluxerCurrentUser(responseBody);

    if (!currentUser) {
        return err({ type: 'invalid-response' });
    }

    return ok(currentUser);
}

function parseFluxerCurrentUser(value: unknown): FluxerCurrentUser | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    const id = value.id;
    const username = value.username;
    const discriminator = value.discriminator;
    const globalName = value.global_name;
    const avatar = value.avatar;
    const bot = value.bot;
    const system = value.system;

    if (
        typeof id !== 'string' ||
        typeof username !== 'string' ||
        typeof discriminator !== 'string' ||
        !isNullableString(globalName) ||
        !isNullableString(avatar) ||
        typeof bot !== 'boolean' ||
        typeof system !== 'boolean'
    ) {
        return undefined;
    }

    return {
        id,
        username,
        discriminator,
        globalName,
        avatar,
        bot,
        system,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
    return typeof value === 'string' || value === null;
}
