import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { isFluxerGuildUnavailable } from './guild-availability.js';

export type FluxerPlatformError =
    | { type: 'missing-input'; field: string }
    | { type: 'invalid-value'; field: string }
    | { type: 'not-found' }
    | { type: 'permission-denied' }
    | { type: 'unsupported'; feature: string }
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

        if (isFluxerGuildUnavailable(guild)) {
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
    const visited = new Set<object>();
    let current = error;

    while (typeof current === 'object' && current !== null && !visited.has(current)) {
        visited.add(current);

        const possibleError = current as { cause?: unknown; status?: unknown; statusCode?: unknown };
        const possibleStatus = possibleError.status ?? possibleError.statusCode;

        if (typeof possibleStatus === 'number') return possibleStatus;
        current = possibleError.cause;
    }

    return undefined;
}
