import type { AppConfig } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';
import type * as NeonFluxDb from '@neonflux/db';
import { deleteBotInstallation, runDatabaseMigrations, upsertBotInstallation, type DatabaseClient } from '@neonflux/db';
import { createFluxerBot, type FluxerBotConfig, type FluxerBotLifecycleHandlers } from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBotApp } from './bot-app.js';
import { bootstrapDeploymentConfig } from './deployment-config-bootstrap.js';

vi.mock('@neonflux/db', async (importOriginal) => {
    const actual = await importOriginal<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteBotInstallation: vi.fn(),
        runDatabaseMigrations: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', () => ({
    createFluxerBot: vi.fn(),
}));

vi.mock('./deployment-config-bootstrap.js', () => ({
    bootstrapDeploymentConfig: vi.fn(),
}));

const runDatabaseMigrationsMock = vi.mocked(runDatabaseMigrations);
const bootstrapDeploymentConfigMock = vi.mocked(bootstrapDeploymentConfig);
const createFluxerBotMock = vi.mocked(createFluxerBot);
const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const testDb = {} as DatabaseClient['db'];

let capturedFluxerConfig: FluxerBotConfig | undefined;
let capturedLifecycleHandlers: FluxerBotLifecycleHandlers | undefined;
let fluxerStartMock: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let fluxerStopMock: ReturnType<typeof vi.fn<() => Promise<void>>>;

describe('createBotApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedFluxerConfig = undefined;
        capturedLifecycleHandlers = undefined;
        fluxerStartMock = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
        fluxerStopMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        runDatabaseMigrationsMock.mockResolvedValue({
            status: 'applied',
            migrationsFolder: 'migrations',
        });
        bootstrapDeploymentConfigMock.mockResolvedValue(ok({ instanceMode: 'multi' }));
        createFluxerBotMock.mockImplementation((config, _logger, lifecycleHandlers = {}) => {
            capturedFluxerConfig = config;
            capturedLifecycleHandlers = lifecycleHandlers;

            return {
                client: {} as never,
                start: fluxerStartMock,
                stop: fluxerStopMock,
            };
        });
        upsertBotInstallationMock.mockResolvedValue(ok(createBotInstallationRecord('guild-1')));
        deleteBotInstallationMock.mockResolvedValue(ok(createBotInstallationRecord('guild-1')));
    });

    it('runs migrations before deployment config bootstrap', async () => {
        const database = createDatabase();
        const app = createBotApp({
            config: createMultiConfig(),
            logger: createLogger(),
            database,
        });

        await app.start();

        expect(runDatabaseMigrationsMock).toHaveBeenCalledWith(database, {
            autoMigrate: true,
        });
        expect(runDatabaseMigrationsMock.mock.invocationCallOrder[0]).toBeLessThan(
            bootstrapDeploymentConfigMock.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('bootstraps deployment config before Fluxer login', async () => {
        const app = createBotApp({
            config: createMultiConfig(),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(bootstrapDeploymentConfigMock.mock.invocationCallOrder[0]).toBeLessThan(
            fluxerStartMock.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('creates the Fluxer bot with the DB-effective mode', async () => {
        bootstrapDeploymentConfigMock.mockResolvedValueOnce(ok({ instanceMode: 'multi' }));

        const app = createBotApp({
            config: createSingleConfig(),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(capturedFluxerConfig).toStrictEqual({
            instanceMode: 'multi',
            fluxerBotToken: 'bot-token',
        });
    });

    it('uses DB-effective mode for guild lifecycle persistence', async () => {
        const database = createDatabase();

        bootstrapDeploymentConfigMock.mockResolvedValueOnce(
            ok({
                instanceMode: 'single',
                singleGuildId: 'db-guild',
            })
        );

        const app = createBotApp({
            config: createSingleConfig({ singleGuildId: 'env-guild' }),
            logger: createLogger(),
            database,
        });

        await app.start();
        await capturedLifecycleHandlers?.guildCreated?.({ guildId: 'env-guild' });
        await capturedLifecycleHandlers?.guildDeleted?.({ guildId: 'env-guild' });

        expect(upsertBotInstallationMock).not.toHaveBeenCalled();
        expect(deleteBotInstallationMock).not.toHaveBeenCalled();

        await capturedLifecycleHandlers?.guildCreated?.({ guildId: 'db-guild' });
        await capturedLifecycleHandlers?.guildDeleted?.({ guildId: 'db-guild' });

        expect(upsertBotInstallationMock).toHaveBeenCalledWith(database.db, {
            guildId: 'db-guild',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(database.db, {
            guildId: 'db-guild',
        });
    });

    it('logs guild lifecycle sync failures without throwing', async () => {
        const logErrorMock = vi.fn();
        const logger = createLogger({ error: logErrorMock });

        upsertBotInstallationMock.mockResolvedValueOnce(err('database-error'));

        const app = createBotApp({
            config: createMultiConfig(),
            logger,
            database: createDatabase(),
        });

        await app.start();

        await expect(capturedLifecycleHandlers?.guildCreated?.({ guildId: 'guild-1' })).resolves.toBeUndefined();
        expect(logErrorMock).toHaveBeenCalledWith('bot.installation_record_failed', {
            guildId: 'guild-1',
            error: 'database-error',
        });
    });

    it('returns false and closes the database when Fluxer does not start', async () => {
        const database = createDatabase();
        const closeDatabaseMock = database.close as ReturnType<typeof vi.fn<() => Promise<void>>>;
        const app = createBotApp({
            config: createMultiConfig({ fluxerBotToken: null }),
            logger: createLogger(),
            database,
        });

        fluxerStartMock.mockResolvedValueOnce(false);

        await expect(app.start()).resolves.toBe(false);
        expect(capturedFluxerConfig).toStrictEqual({
            instanceMode: 'multi',
        });
        expect(closeDatabaseMock).toHaveBeenCalledTimes(1);

        await app.stop();

        expect(closeDatabaseMock).toHaveBeenCalledTimes(1);
    });

    it('stops the Fluxer bot and closes the database', async () => {
        const database = createDatabase();
        const closeDatabaseMock = database.close as ReturnType<typeof vi.fn<() => Promise<void>>>;
        const app = createBotApp({
            config: createMultiConfig(),
            logger: createLogger(),
            database,
        });

        await app.start();
        await app.stop();

        expect(fluxerStopMock).toHaveBeenCalledTimes(1);
        expect(closeDatabaseMock).toHaveBeenCalledTimes(1);
    });
});

function createDatabase(): DatabaseClient {
    return {
        db: testDb,
        pool: {} as DatabaseClient['pool'],
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
}

function createLogger(overrides: Partial<AppLogger> = {}): AppLogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        ...overrides,
    };
}

function createMultiConfig(options: { fluxerBotToken?: string | null } = {}): AppConfig {
    return {
        ...createBaseConfig(options),
        instanceMode: 'multi',
    };
}

function createSingleConfig(options: { singleGuildId?: string } = {}): AppConfig {
    return {
        ...createBaseConfig(),
        instanceMode: 'single',
        singleGuildId: options.singleGuildId ?? 'env-guild',
    };
}

function createBaseConfig(options: { fluxerBotToken?: string | null } = {}): Omit<AppConfig, 'instanceMode'> {
    return {
        appEnv: 'development',
        databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
        autoMigrate: true,
        ...(options.fluxerBotToken === null ? {} : { fluxerBotToken: options.fluxerBotToken ?? 'bot-token' }),
        logLevel: 'info',
        nodeEnv: 'test',
        ownerIds: [],
    };
}

function createBotInstallationRecord(guildId: string) {
    return {
        guildId,
        installedAt: new Date('2026-06-22T00:00:00.000Z'),
        updatedAt: new Date('2026-06-22T00:00:00.000Z'),
    };
}
