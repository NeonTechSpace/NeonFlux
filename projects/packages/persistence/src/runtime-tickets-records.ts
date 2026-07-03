import type {
    GuildFeatureRepositoryError,
    TicketEventRecord,
    TicketMemberRecord,
    TicketPanelRecord,
    TicketRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

export type ConvexTicketPanelRecord = Omit<TicketPanelRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
export type ConvexTicketRecord = Omit<TicketRecord, 'closedAt' | 'openedAt' | 'updatedAt'> & {
    closedAt: string | null;
    openedAt: string;
    updatedAt: string;
};
export type ConvexTicketMemberRecord = Omit<TicketMemberRecord, 'createdAt'> & {
    createdAt: string;
};
export type ConvexTicketEventRecord = Omit<TicketEventRecord, 'createdAt'> & {
    createdAt: string;
};

export function toTicketPanelRecord(record: ConvexTicketPanelRecord): TicketPanelRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

export function toTicketRecord(record: ConvexTicketRecord): TicketRecord {
    return {
        ...record,
        closedAt: record.closedAt ? new Date(record.closedAt) : null,
        openedAt: new Date(record.openedAt),
        updatedAt: new Date(record.updatedAt),
    };
}

export function toTicketMemberRecord(record: ConvexTicketMemberRecord): TicketMemberRecord {
    return { ...record, createdAt: new Date(record.createdAt) };
}

export function toTicketEventRecord(record: ConvexTicketEventRecord): TicketEventRecord {
    return { ...record, createdAt: new Date(record.createdAt) };
}

export function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();
    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizePositiveInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    return Number.isInteger(value) && value >= 1 ? ok(value) : err({ field, type: 'invalid-value' });
}

export function normalizePositiveLimit(
    value: number | undefined,
    fallback: number
): Result<number, GuildFeatureRepositoryError> {
    if (value === undefined) return ok(fallback);
    return Number.isInteger(value) && value > 0
        ? ok(Math.min(value, 500))
        : err({ field: 'limit', type: 'invalid-value' });
}
