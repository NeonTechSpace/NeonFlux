import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';

export type GuildFeatureRepositoryDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export type GuildFeatureRepositoryError =
    | { type: 'missing-input'; field: string }
    | { type: 'invalid-value'; field: string }
    | { type: 'invalid-status-transition'; from: string; to: string }
    | { type: 'not-found' }
    | { type: 'database-error' };

export function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
        return err({ type: 'missing-input', field });
    }

    return ok(normalizedValue);
}

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeRequiredPositiveInteger(
    value: number,
    field: string
): Result<number, GuildFeatureRepositoryError> {
    if (!Number.isInteger(value) || value < 1) {
        return err({ type: 'invalid-value', field });
    }

    return ok(value);
}

export function normalizeNonNegativeInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    if (!Number.isInteger(value) || value < 0) {
        return err({ type: 'invalid-value', field });
    }

    return ok(value);
}

export function assertAllowedStatusTransition(
    from: string,
    to: string,
    allowedTransitions: ReadonlyMap<string, readonly string[]>
): Result<void, GuildFeatureRepositoryError> {
    if (from === to) {
        return ok(undefined);
    }

    if (!allowedTransitions.get(from)?.includes(to)) {
        return err({ type: 'invalid-status-transition', from, to });
    }

    return ok(undefined);
}
