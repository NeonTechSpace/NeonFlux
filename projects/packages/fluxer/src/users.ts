import { err, ok, type Result } from 'neverthrow';

const FLUXER_OAUTH_USERINFO_URL = 'https://api.fluxer.app/v1/oauth2/userinfo';

export type FluxerUsersFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FluxerCurrentUser = {
    id: string;
    subjectId?: string;
    username: string;
    discriminator: string;
    globalName: string | null;
    avatar: string | null;
    bot?: boolean;
    system?: boolean;
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
        response = await (input.fetch ?? fetch)(FLUXER_OAUTH_USERINFO_URL, {
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
    const subjectId = value.sub;
    const globalName = value.global_name;
    const avatar = value.avatar;
    const bot = value.bot;
    const system = value.system;

    if (
        typeof id !== 'string' ||
        typeof username !== 'string' ||
        typeof discriminator !== 'string' ||
        !isOptionalNullableString(globalName) ||
        !isOptionalNullableString(avatar) ||
        !isOptionalString(subjectId) ||
        !isOptionalBoolean(bot) ||
        !isOptionalBoolean(system)
    ) {
        return undefined;
    }

    return {
        id,
        ...(subjectId !== undefined ? { subjectId } : {}),
        username,
        discriminator,
        globalName: globalName ?? null,
        avatar: avatar ?? null,
        ...(bot !== undefined ? { bot } : {}),
        ...(system !== undefined ? { system } : {}),
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
    return typeof value === 'string' || value === undefined;
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
    return typeof value === 'string' || value === null || value === undefined;
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
    return typeof value === 'boolean' || value === undefined;
}
