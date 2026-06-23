import type { AppConfig } from '@neonflux/config';
import { findDeploymentConfig, upsertDeploymentConfig } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDeploymentConfig } from './deployment-config-bootstrap.js';

vi.mock('@neonflux/db', () => ({
    findDeploymentConfig: vi.fn(),
    upsertDeploymentConfig: vi.fn(),
}));

const upsertDeploymentConfigMock = vi.mocked(upsertDeploymentConfig);
const findDeploymentConfigMock = vi.mocked(findDeploymentConfig);
const testDb = {} as Parameters<typeof bootstrapDeploymentConfig>[0];

describe('bootstrapDeploymentConfig', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        upsertDeploymentConfigMock.mockResolvedValue(
            ok({
                instanceMode: 'multi',
                publicWebUrl: null,
                ownerIds: [],
            })
        );
        findDeploymentConfigMock.mockResolvedValue(
            ok({
                instanceMode: 'multi',
                publicWebUrl: null,
                ownerIds: [],
            })
        );
    });

    it('writes deployment config from the bot bootstrap env before reading it back', async () => {
        const result = await bootstrapDeploymentConfig(testDb, createSingleConfig());

        expect(result.isOk()).toBe(true);
        expect(upsertDeploymentConfigMock).toHaveBeenCalledWith(testDb, {
            instanceMode: 'single',
            singleGuildId: 'guild-1',
            publicWebUrl: 'https://neonflux.example',
            ownerIds: ['owner-a'],
        });
        expect(upsertDeploymentConfigMock.mock.invocationCallOrder[0]).toBeLessThan(
            findDeploymentConfigMock.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('returns the effective single mode read from the database', async () => {
        findDeploymentConfigMock.mockResolvedValueOnce(
            ok({
                instanceMode: 'single',
                singleGuildId: 'guild-from-db',
                publicWebUrl: null,
                ownerIds: ['owner-a'],
            })
        );

        const result = await bootstrapDeploymentConfig(testDb, createSingleConfig());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            instanceMode: 'single',
            singleGuildId: 'guild-from-db',
        });
    });

    it('returns the effective multi mode read from the database', async () => {
        const result = await bootstrapDeploymentConfig(testDb, createMultiConfig());

        expect(result.isOk()).toBe(true);
        expect(upsertDeploymentConfigMock).toHaveBeenCalledWith(testDb, {
            instanceMode: 'multi',
            ownerIds: [],
        });
        expect(result._unsafeUnwrap()).toStrictEqual({
            instanceMode: 'multi',
        });
    });

    it('returns database-error when the deployment config upsert fails', async () => {
        upsertDeploymentConfigMock.mockResolvedValueOnce(err('database-error'));

        const result = await bootstrapDeploymentConfig(testDb, createMultiConfig());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(findDeploymentConfigMock).not.toHaveBeenCalled();
    });

    it('returns deployment-config-not-found when the readback row is missing', async () => {
        findDeploymentConfigMock.mockResolvedValueOnce(err('not-found'));

        const result = await bootstrapDeploymentConfig(testDb, createMultiConfig());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('deployment-config-not-found');
    });
});

function createSingleConfig(): AppConfig {
    return {
        ...createBaseConfig(),
        instanceMode: 'single',
        singleGuildId: 'guild-1',
        publicWebUrl: 'https://neonflux.example',
        ownerIds: ['owner-a'],
    };
}

function createMultiConfig(): AppConfig {
    return {
        ...createBaseConfig(),
        instanceMode: 'multi',
    };
}

function createBaseConfig(): Omit<AppConfig, 'instanceMode' | 'singleGuildId'> {
    return {
        appEnv: 'development',
        databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
        autoMigrate: true,
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
        ownerIds: [],
    };
}
