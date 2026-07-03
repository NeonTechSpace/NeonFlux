import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    deleteGuildDefconExemption,
    findGuildCommandSettingsByGuildId,
    findGuildModerationPolicyByGuildId,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    upsertGuildCommandPrefix,
    upsertGuildDefconExemption,
    upsertGuildModerationPolicy,
    upsertGuildSecurityPolicy,
} from './runtime-settings.js';

const commandSetting = {
    config: { prefix: '!' },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    feature: 'commands',
    guildId: 'guild-1',
    id: 'setting-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const moderationSetting = {
    config: {
        protectedRoleIds: ['role-1', 'role-2'],
        protectedUserIds: ['user-1'],
    },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    feature: 'moderation',
    guildId: 'guild-1',
    id: 'setting-2',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
type SecurityPolicyFixture = {
    createdAt: string;
    defconLevel: 1 | 2 | 3;
    guildId: string;
    updatedAt: string;
};

const securityPolicy: SecurityPolicyFixture = {
    createdAt: '2026-07-03T08:00:00.000Z',
    defconLevel: 2,
    guildId: 'guild-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const exemption = {
    category: 'moderation.ban',
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
};

describe('Convex settings and security persistence wrappers', () => {
    it('reads and upserts command settings through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [{ ...commandSetting, config: { prefix: '?' } }],
            queryResults: [commandSetting, commandSetting, null],
        });

        const found = await findGuildCommandSettingsByGuildId(db, { guildId: 'guild-1' });
        const unchanged = await upsertGuildCommandPrefix(db, { guildId: 'guild-1', prefix: '!' });
        const changed = await upsertGuildCommandPrefix(db, { guildId: 'guild-1', prefix: '?' });

        expect(found._unsafeUnwrap()).toStrictEqual(toCommandRecord(commandSetting));
        expect(unchanged._unsafeUnwrap()).toStrictEqual(toCommandRecord(commandSetting));
        expect(changed._unsafeUnwrap()).toStrictEqual(toCommandRecord({ ...commandSetting, config: { prefix: '?' } }));
        expect(db.client.mutationCalls).toHaveLength(1);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            config: { prefix: '?' },
            enabled: true,
            feature: 'commands',
            guildId: 'guild-1',
        });
    });

    it('maps command setting validation and missing records', async () => {
        const db = createConvexDb({
            queryErrors: [new Error('missing-guild-id')],
            queryResults: [null, { ...commandSetting, config: { prefix: 'bad space' } }],
        });

        const missingGuild = await findGuildCommandSettingsByGuildId(db, { guildId: ' ' });
        const missing = await findGuildCommandSettingsByGuildId(db, { guildId: 'guild-1' });
        const invalidConfig = await findGuildCommandSettingsByGuildId(db, { guildId: 'guild-1' });
        const invalidPrefix = await upsertGuildCommandPrefix(db, { guildId: 'guild-1', prefix: 'abcde' });

        expect(missingGuild._unsafeUnwrapErr()).toBe('missing-guild-id');
        expect(missing._unsafeUnwrapErr()).toBe('not-found');
        expect(invalidConfig._unsafeUnwrapErr()).toBe('invalid-config');
        expect(invalidPrefix._unsafeUnwrapErr()).toBe('invalid-prefix');
    });

    it('reads and upserts moderation policy through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [moderationSetting],
            queryResults: [moderationSetting],
        });

        const found = await findGuildModerationPolicyByGuildId(db, { guildId: 'guild-1' });
        const upserted = await upsertGuildModerationPolicy(db, {
            guildId: 'guild-1',
            protectedRoleIds: [' role-1 ', 'role-1', 'role-2'],
            protectedUserIds: ['user-1', ' '],
        });

        expect(found._unsafeUnwrap()).toStrictEqual(toModerationRecord(moderationSetting));
        expect(upserted._unsafeUnwrap()).toStrictEqual(toModerationRecord(moderationSetting));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            config: {
                protectedRoleIds: ['role-1', 'role-2'],
                protectedUserIds: ['user-1'],
            },
            enabled: true,
            feature: 'moderation',
            guildId: 'guild-1',
        });
    });

    it('maps moderation policy missing and invalid config states', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('missing-guild-id')],
            queryResults: [null, { ...moderationSetting, config: { protectedRoleIds: 'role-1' } }],
        });

        const missing = await findGuildModerationPolicyByGuildId(db, { guildId: 'guild-1' });
        const invalidConfig = await findGuildModerationPolicyByGuildId(db, { guildId: 'guild-1' });
        const missingGuild = await upsertGuildModerationPolicy(db, { guildId: ' ' });

        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(invalidConfig._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-config' });
        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({
            field: 'guildId',
            type: 'missing-input',
        });
    });

    it('reads and mutates security policies and DEFCON exemptions through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [{ ...securityPolicy, defconLevel: 3 }, exemption, null],
            queryResults: [securityPolicy, ['moderation.ban']],
        });

        const found = await findGuildSecurityPolicyByGuildId(db, { guildId: 'guild-1' });
        const upserted = await upsertGuildSecurityPolicy(db, { defconLevel: 3, guildId: 'guild-1' });
        const addedExemption = await upsertGuildDefconExemption(db, {
            category: exemption.category,
            guildId: exemption.guildId,
        });
        const categories = await listGuildDefconExemptionCategories(db, { guildId: 'guild-1' });
        const deletedExemption = await deleteGuildDefconExemption(db, {
            category: exemption.category,
            guildId: exemption.guildId,
        });

        expect(found._unsafeUnwrap()).toStrictEqual(toSecurityPolicyRecord(securityPolicy));
        expect(upserted._unsafeUnwrap()).toStrictEqual(toSecurityPolicyRecord({ ...securityPolicy, defconLevel: 3 }));
        expect(addedExemption._unsafeUnwrap()).toStrictEqual(toExemptionRecord(exemption));
        expect(categories._unsafeUnwrap()).toStrictEqual(['moderation.ban']);
        expect(deletedExemption._unsafeUnwrapErr()).toBe('not-found');
    });

    it('maps security policy validation failures', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('missing-category')],
            queryErrors: [new Error('missing-guild-id')],
        });

        const missingGuild = await findGuildSecurityPolicyByGuildId(db, { guildId: ' ' });
        const invalidDefcon = await upsertGuildSecurityPolicy(db, { defconLevel: 4, guildId: 'guild-1' });
        const missingCategory = await upsertGuildDefconExemption(db, { category: ' ', guildId: 'guild-1' });

        expect(missingGuild._unsafeUnwrapErr()).toBe('missing-guild-id');
        expect(invalidDefcon._unsafeUnwrapErr()).toBe('invalid-defcon-level');
        expect(missingCategory._unsafeUnwrapErr()).toBe('missing-category');
    });
});

function toCommandRecord(record: typeof commandSetting) {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        prefix: record.config.prefix,
        updatedAt: new Date(record.updatedAt),
    };
}

function toModerationRecord(record: typeof moderationSetting) {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        protectedRoleIds: record.config.protectedRoleIds,
        protectedUserIds: record.config.protectedUserIds,
        updatedAt: new Date(record.updatedAt),
    };
}

function toSecurityPolicyRecord(record: SecurityPolicyFixture) {
    return {
        createdAt: new Date(record.createdAt),
        defconLevel: record.defconLevel,
        guildId: record.guildId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toExemptionRecord(record: typeof exemption) {
    return {
        category: record.category,
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexPersistenceDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexPersistenceDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
