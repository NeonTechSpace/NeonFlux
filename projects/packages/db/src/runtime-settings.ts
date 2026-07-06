import { api } from '@neonflux/convex-api';
import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import { err, ok, type Result } from 'neverthrow';

import type {
    GuildCommandSettingsRecord,
    GuildCommandSettingsRepositoryError,
    GuildDefconExemptionRecord,
    GuildSecurityPolicyRecord,
    GuildSecurityPolicyRepositoryError,
} from './contracts.js';
import type { ConvexDatabase } from './convex.js';

const GUILD_COMMAND_SETTINGS_FEATURE = 'commands';

type CommandSettingsDb = ConvexDatabase;
type SecurityPolicyDb = ConvexDatabase;

type ConvexGuildFeatureSettingRecord = {
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    feature: string;
    guildId: string;
    id: string;
    updatedAt: string;
};

type ConvexGuildSecurityPolicyRecord = {
    createdAt: string;
    defconLevel: 1 | 2 | 3;
    guildId: string;
    updatedAt: string;
};

type ConvexGuildDefconExemptionRecord = {
    category: string;
    createdAt: string;
    guildId: string;
};

export async function findGuildCommandSettingsByGuildId(
    db: CommandSettingsDb,
    input: { guildId: string }
): Promise<Result<GuildCommandSettingsRecord, GuildCommandSettingsRepositoryError>> {
    const setting = await readFeatureSetting(db, {
        feature: GUILD_COMMAND_SETTINGS_FEATURE,
        guildId: input.guildId,
    });

    if (setting.isErr()) {
        return err(mapFeatureSettingErrorToCommandSettingsError(setting.error));
    }

    if (!setting.value) {
        return err('not-found');
    }

    return toGuildCommandSettingsRecord(setting.value);
}

export async function upsertGuildCommandPrefix(
    db: CommandSettingsDb,
    input: { guildId: string; prefix: string }
): Promise<Result<GuildCommandSettingsRecord, GuildCommandSettingsRepositoryError>> {
    const prefix = normalizeCommandPrefix(input.prefix);

    if (prefix.isErr()) {
        return err(prefix.error);
    }

    const existingSetting = await readFeatureSetting(db, {
        feature: GUILD_COMMAND_SETTINGS_FEATURE,
        guildId: input.guildId,
    });

    if (existingSetting.isErr()) {
        return err(mapFeatureSettingErrorToCommandSettingsError(existingSetting.error));
    }

    if (existingSetting.value) {
        const existingRecord = toGuildCommandSettingsRecord(existingSetting.value);

        if (existingRecord.isOk() && existingRecord.value.prefix === prefix.value) {
            return existingRecord;
        }
    }

    try {
        const setting = await db.client.mutation(api.feature_settings.upsertGuildFeatureSetting, {
            config: { prefix: prefix.value },
            enabled: true,
            feature: GUILD_COMMAND_SETTINGS_FEATURE,
            guildId: input.guildId,
        });

        return toGuildCommandSettingsRecord(setting);
    } catch (error) {
        return err(mapFeatureSettingErrorToCommandSettingsError(mapFeatureSettingError(error)));
    }
}

export async function findGuildSecurityPolicyByGuildId(
    db: SecurityPolicyDb,
    input: { guildId: string }
): Promise<Result<GuildSecurityPolicyRecord, GuildSecurityPolicyRepositoryError>> {
    try {
        const policy = await db.client.query(api.security_policies.readGuildSecurityPolicy, input);

        return policy ? ok(toGuildSecurityPolicyRecord(policy)) : err('not-found');
    } catch (error) {
        return err(mapSecurityPolicyError(error));
    }
}

export async function upsertGuildSecurityPolicy(
    db: SecurityPolicyDb,
    input: { defconLevel: number; guildId: string }
): Promise<Result<GuildSecurityPolicyRecord, GuildSecurityPolicyRepositoryError>> {
    const defconLevel = normalizeDefconLevel(input.defconLevel);

    if (!defconLevel) {
        return err('invalid-defcon-level');
    }

    try {
        const policy = await db.client.mutation(api.security_policies.upsertGuildSecurityPolicy, {
            defconLevel,
            guildId: input.guildId,
        });

        return ok(toGuildSecurityPolicyRecord(policy));
    } catch (error) {
        return err(mapSecurityPolicyError(error));
    }
}

export async function upsertGuildDefconExemption(
    db: SecurityPolicyDb,
    input: { category: string; guildId: string }
): Promise<Result<GuildDefconExemptionRecord, GuildSecurityPolicyRepositoryError>> {
    try {
        const exemption = await db.client.mutation(api.security_policies.upsertGuildDefconExemption, input);

        return ok(toGuildDefconExemptionRecord(exemption));
    } catch (error) {
        return err(mapSecurityPolicyError(error));
    }
}

export async function listGuildDefconExemptionCategories(
    db: SecurityPolicyDb,
    input: { guildId: string }
): Promise<Result<string[], GuildSecurityPolicyRepositoryError>> {
    try {
        const categories = await db.client.query(api.security_policies.listGuildDefconExemptionCategories, input);

        return ok(categories);
    } catch (error) {
        return err(mapSecurityPolicyError(error));
    }
}

export async function deleteGuildDefconExemption(
    db: SecurityPolicyDb,
    input: { category: string; guildId: string }
): Promise<Result<GuildDefconExemptionRecord, GuildSecurityPolicyRepositoryError>> {
    try {
        const exemption = await db.client.mutation(api.security_policies.deleteGuildDefconExemption, input);

        return exemption ? ok(toGuildDefconExemptionRecord(exemption)) : err('not-found');
    } catch (error) {
        return err(mapSecurityPolicyError(error));
    }
}

async function readFeatureSetting(
    db: ConvexDatabase,
    input: { feature: string; guildId: string }
): Promise<Result<ConvexGuildFeatureSettingRecord | null, FeatureSettingWrapperError>> {
    try {
        const setting = await db.client.query(api.feature_settings.readGuildFeatureSetting, input);

        return ok(setting);
    } catch (error) {
        return err(mapFeatureSettingError(error));
    }
}

function toGuildCommandSettingsRecord(
    setting: ConvexGuildFeatureSettingRecord
): Result<GuildCommandSettingsRecord, GuildCommandSettingsRepositoryError> {
    const prefix = setting.config.prefix;

    if (typeof prefix !== 'string') {
        return err('invalid-config');
    }

    const normalizedPrefix = normalizeCommandPrefix(prefix);

    if (normalizedPrefix.isErr()) {
        return err('invalid-config');
    }

    return ok({
        createdAt: new Date(setting.createdAt),
        guildId: setting.guildId,
        prefix: normalizedPrefix.value,
        updatedAt: new Date(setting.updatedAt),
    });
}

function toGuildSecurityPolicyRecord(record: ConvexGuildSecurityPolicyRecord): GuildSecurityPolicyRecord {
    return {
        createdAt: new Date(record.createdAt),
        defconLevel: record.defconLevel,
        guildId: record.guildId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toGuildDefconExemptionRecord(record: ConvexGuildDefconExemptionRecord): GuildDefconExemptionRecord {
    return {
        category: record.category,
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
    };
}

type FeatureSettingWrapperError = 'database-error' | 'missing-feature' | 'missing-guild-id';

function mapFeatureSettingError(error: unknown): FeatureSettingWrapperError {
    if (!(error instanceof Error)) {
        return 'database-error';
    }

    if (error.message.includes('missing-guild-id')) return 'missing-guild-id';
    if (error.message.includes('missing-feature')) return 'missing-feature';

    return 'database-error';
}

function mapFeatureSettingErrorToCommandSettingsError(
    error: FeatureSettingWrapperError
): GuildCommandSettingsRepositoryError {
    return error === 'missing-guild-id' ? 'missing-guild-id' : 'database-error';
}

function mapSecurityPolicyError(error: unknown): GuildSecurityPolicyRepositoryError {
    if (!(error instanceof Error)) {
        return 'database-error';
    }

    if (error.message.includes('missing-guild-id')) return 'missing-guild-id';
    if (error.message.includes('invalid-defcon-level')) return 'invalid-defcon-level';
    if (error.message.includes('missing-category')) return 'missing-category';

    return 'database-error';
}

function normalizeDefconLevel(value: number): 1 | 2 | 3 | undefined {
    return value === 1 || value === 2 || value === 3 ? value : undefined;
}
