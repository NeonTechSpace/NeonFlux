import type {
    GeneratedVoiceChannelRecord,
    GuildFeatureRepositoryError,
    VcGeneratorControlPanelRecord,
    VcGeneratorRuleRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

export type ConvexVcGeneratorRuleRecord = Omit<VcGeneratorRuleRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
export type ConvexGeneratedVoiceChannelRecord = Omit<
    GeneratedVoiceChannelRecord,
    'createdAt' | 'lastSeenAt' | 'updatedAt'
> & {
    createdAt: string;
    lastSeenAt: string;
    updatedAt: string;
};
export type ConvexVcGeneratorControlPanelRecord = Omit<
    VcGeneratorControlPanelRecord,
    'createdAt' | 'lastSyncedAt' | 'staleAt' | 'updatedAt'
> & {
    createdAt: string;
    lastSyncedAt: string | null;
    staleAt: string | null;
    updatedAt: string;
};

export function toRuleRecord(record: ConvexVcGeneratorRuleRecord): VcGeneratorRuleRecord {
    return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

export function toGeneratedChannelRecord(record: ConvexGeneratedVoiceChannelRecord): GeneratedVoiceChannelRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastSeenAt: new Date(record.lastSeenAt),
        updatedAt: new Date(record.updatedAt),
    };
}

export function toControlPanelRecord(record: ConvexVcGeneratorControlPanelRecord): VcGeneratorControlPanelRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastSyncedAt: record.lastSyncedAt ? new Date(record.lastSyncedAt) : null,
        staleAt: record.staleAt ? new Date(record.staleAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
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

export function normalizeNonNegativeInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    return Number.isInteger(value) && value >= 0 ? ok(value) : err({ field, type: 'invalid-value' });
}
