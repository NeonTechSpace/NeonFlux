import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';

export type FluxerPlatformError =
    | { type: 'missing-input'; field: string }
    | { type: 'not-found' }
    | { type: 'permission-denied' }
    | { type: 'operation-failed'; error: unknown };

export type FluxerGuild = NonNullable<Awaited<ReturnType<FluxerBot['client']['guilds']['fetch']>>>;

export async function runGuildAction<TValue>(
    client: FluxerBot['client'],
    guildId: string,
    action: (guild: FluxerGuild) => Promise<TValue>
): Promise<Result<TValue, FluxerPlatformError>> {
    const normalizedGuildId = guildId.trim();

    if (!normalizedGuildId) {
        return err({ type: 'missing-input', field: 'guildId' });
    }

    try {
        const guild = await client.guilds.fetch(normalizedGuildId);

        if (!guild) {
            return err({ type: 'not-found' });
        }

        return ok(await action(guild));
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

export function requireTextInputs<TInput extends Record<string, unknown>>(
    input: TInput,
    fields: Array<keyof TInput & string>
): Result<void, FluxerPlatformError> {
    for (const field of fields) {
        if (typeof input[field] !== 'string' || input[field].trim().length === 0) {
            return err({ type: 'missing-input', field });
        }
    }

    return ok(undefined);
}

export function mapPlatformError(error: unknown): FluxerPlatformError {
    if (isPermissionError(error)) {
        return { type: 'permission-denied' };
    }

    if (isNotFoundError(error)) {
        return { type: 'not-found' };
    }

    return { type: 'operation-failed', error };
}

function isPermissionError(error: unknown): boolean {
    return getErrorStatus(error) === 403;
}

function isNotFoundError(error: unknown): boolean {
    return getErrorStatus(error) === 404;
}

function getErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const possibleError = error as { status?: unknown; statusCode?: unknown };
    const possibleStatus = possibleError.status ?? possibleError.statusCode;

    return typeof possibleStatus === 'number' ? possibleStatus : undefined;
}
