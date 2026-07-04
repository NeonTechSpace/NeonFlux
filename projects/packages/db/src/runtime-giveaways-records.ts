import { err, ok, type Result } from 'neverthrow';

import type {
    GiveawayEntryRecord,
    GiveawayEventRecord,
    GiveawayRecord,
    GiveawaysRepositoryError,
    GiveawayWinnerRecord,
} from './contracts-giveaways.js';
import type { GuildFeatureRepositoryError } from './contracts.js';

export type ConvexGiveawayRecord = {
    channelId: string;
    closedAt: string | null;
    closedByUserId: string | null;
    config: Record<string, unknown>;
    createdAt: string;
    createdByUserId: string | null;
    description: string | null;
    endsAt: string | null;
    entryEmoji: string;
    guildId: string;
    id: string;
    messageId: string | null;
    prize: string;
    status: 'active' | 'cancelled' | 'closed' | 'draft';
    title: string;
    updatedAt: string;
    winnerCount: number;
};

export type ConvexGiveawayEntryRecord = {
    enteredAt: string;
    giveawayId: string;
    id: string;
    removedAt: string | null;
    userId: string;
};

export type ConvexGiveawayWinnerRecord = {
    drawNumber: number;
    giveawayId: string;
    id: string;
    selectedAt: string;
    userId: string;
};

export type ConvexGiveawayEventRecord = {
    actorUserId: string | null;
    createdAt: string;
    details: Record<string, unknown>;
    eventType: string;
    giveawayId: string;
    id: string;
};

export function toGiveawayRecord(record: ConvexGiveawayRecord): GiveawayRecord {
    return {
        channelId: record.channelId,
        closedAt: record.closedAt ? new Date(record.closedAt) : null,
        closedByUserId: record.closedByUserId,
        config: record.config,
        createdAt: new Date(record.createdAt),
        createdByUserId: record.createdByUserId,
        description: record.description,
        endsAt: record.endsAt ? new Date(record.endsAt) : null,
        entryEmoji: record.entryEmoji,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        prize: record.prize,
        status: record.status,
        title: record.title,
        updatedAt: new Date(record.updatedAt),
        winnerCount: record.winnerCount,
    };
}

export function toGiveawayEntryRecord(record: ConvexGiveawayEntryRecord): GiveawayEntryRecord {
    return {
        enteredAt: new Date(record.enteredAt),
        giveawayId: record.giveawayId,
        id: record.id,
        removedAt: record.removedAt ? new Date(record.removedAt) : null,
        userId: record.userId,
    };
}

export function toGiveawayWinnerRecord(record: ConvexGiveawayWinnerRecord): GiveawayWinnerRecord {
    return {
        drawNumber: record.drawNumber,
        giveawayId: record.giveawayId,
        id: record.id,
        selectedAt: new Date(record.selectedAt),
        userId: record.userId,
    };
}

export function toGiveawayEventRecord(record: ConvexGiveawayEventRecord): GiveawayEventRecord {
    return {
        actorUserId: record.actorUserId,
        createdAt: new Date(record.createdAt),
        details: record.details,
        eventType: record.eventType,
        giveawayId: record.giveawayId,
        id: record.id,
    };
}

export function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) return err({ field, type: 'missing-input' });

    return ok(normalizedValue);
}

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizePositiveInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    if (!Number.isInteger(value) || value < 1) return err({ field, type: 'invalid-value' });

    return ok(value);
}

export function normalizeDate(value: Date, field: string): Result<string, GuildFeatureRepositoryError> {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return err({ field, type: 'invalid-value' });

    return ok(value.toISOString());
}

export function normalizeCreateLimit(limit: number | undefined): number {
    if (!Number.isInteger(limit) || Number(limit) < 0) return 50;

    return Math.min(Math.max(Number(limit), 1), 100);
}

export function normalizeMaintenanceLimit(limit: number | undefined): number {
    return Number.isInteger(limit) && limit && limit > 0 ? Math.min(limit, 100) : 25;
}

export function normalizeGiveawayStatus(
    status: string
): Result<ConvexGiveawayRecord['status'], GiveawaysRepositoryError> {
    const normalized = normalizeRequiredText(status, 'status');

    if (normalized.isErr()) return err(normalized.error);
    if (
        normalized.value === 'active' ||
        normalized.value === 'cancelled' ||
        normalized.value === 'closed' ||
        normalized.value === 'draft'
    ) {
        return ok(normalized.value);
    }

    return err({ field: 'status', type: 'invalid-value' });
}

export function mapGiveawayConvexError(error: unknown): GiveawaysRepositoryError {
    const message = error instanceof Error ? error.message : '';

    if (message === 'giveaway-not-found') return { type: 'not-found' };

    return { type: 'database-error' };
}
