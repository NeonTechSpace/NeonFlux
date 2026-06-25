import type { AppConfig } from '@neonflux/config';
import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import type { AppLogger } from '@neonflux/core/logging';
import type * as NeonFluxDb from '@neonflux/db';
import {
    deleteBotInstallation,
    findGuildCommandPermissionRule,
    findGuildCommandSettingsByGuildId,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    listBotInstallationGuildIds,
    runDatabaseMigrations,
    upsertGuildCommandPrefix,
    upsertBotInstallation,
    type DatabaseClient,
} from '@neonflux/db';
import {
    createFluxerBot,
    sendFluxerChannelMessage,
    type FluxerBotConfig,
    type FluxerBotLifecycleHandlers,
} from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBotApp } from './bot-app.js';
import { bootstrapDeploymentConfig } from './deployment-config-bootstrap.js';

vi.mock('@neonflux/db', async (importOriginal) => {
    const actual = await importOriginal<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteBotInstallation: vi.fn(),
        findGuildCommandPermissionRule: vi.fn(),
        findGuildCommandSettingsByGuildId: vi.fn(),
        findGuildSecurityPolicyByGuildId: vi.fn(),
        listGuildDefconExemptionCategories: vi.fn(),
        listBotInstallationGuildIds: vi.fn(),
        runDatabaseMigrations: vi.fn(),
        upsertGuildCommandPrefix: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', () => ({
    createFluxerBot: vi.fn(),
    sendFluxerChannelMessage: vi.fn(),
}));

vi.mock('./deployment-config-bootstrap.js', () => ({
    bootstrapDeploymentConfig: vi.fn(),
}));

const runDatabaseMigrationsMock = vi.mocked(runDatabaseMigrations);
const bootstrapDeploymentConfigMock = vi.mocked(bootstrapDeploymentConfig);
const createFluxerBotMock = vi.mocked(createFluxerBot);
const sendFluxerChannelMessageMock = vi.mocked(sendFluxerChannelMessage);
const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const findGuildCommandPermissionRuleMock = vi.mocked(findGuildCommandPermissionRule);
const findGuildCommandSettingsByGuildIdMock = vi.mocked(findGuildCommandSettingsByGuildId);
const findGuildSecurityPolicyByGuildIdMock = vi.mocked(findGuildSecurityPolicyByGuildId);
const listGuildDefconExemptionCategoriesMock = vi.mocked(listGuildDefconExemptionCategories);
const listBotInstallationGuildIdsMock = vi.mocked(listBotInstallationGuildIds);
const upsertGuildCommandPrefixMock = vi.mocked(upsertGuildCommandPrefix);
const testDb = {} as DatabaseClient['db'];
const testFluxerClient = {
    user: {
        id: 'bot-user',
    },
} as never;

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
                client: testFluxerClient,
                start: fluxerStartMock,
                stop: fluxerStopMock,
            };
        });
        upsertBotInstallationMock.mockResolvedValue(ok(createBotInstallationRecord('guild-1')));
        deleteBotInstallationMock.mockResolvedValue(ok(createBotInstallationRecord('guild-1')));
        findGuildCommandPermissionRuleMock.mockResolvedValue(err('not-found'));
        findGuildCommandSettingsByGuildIdMock.mockResolvedValue(err('not-found'));
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(err('not-found'));
        listGuildDefconExemptionCategoriesMock.mockResolvedValue(ok([]));
        listBotInstallationGuildIdsMock.mockResolvedValue(ok([]));
        upsertGuildCommandPrefixMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                prefix: '?',
                createdAt: new Date('2026-06-24T00:00:00.000Z'),
                updatedAt: new Date('2026-06-24T00:00:00.000Z'),
            })
        );
        sendFluxerChannelMessageMock.mockResolvedValue(
            ok({
                id: 'reply-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            })
        );
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

    it('creates the Fluxer bot with configured custom status text', async () => {
        const app = createBotApp({
            config: createMultiConfig({
                fluxerBotCustomStatusText: 'Env NeonFlux status',
            }),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(capturedFluxerConfig).toStrictEqual({
            instanceMode: 'multi',
            customStatusText: 'Env NeonFlux status',
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

    it('reconciles current bot guilds with the DB-effective mode', async () => {
        const database = createDatabase();

        bootstrapDeploymentConfigMock.mockResolvedValueOnce(ok({ instanceMode: 'multi' }));
        listBotInstallationGuildIdsMock.mockResolvedValueOnce(ok(['guild-1', 'stale-guild']));

        const app = createBotApp({
            config: createMultiConfig(),
            logger: createLogger(),
            database,
        });

        await app.start();
        await capturedLifecycleHandlers?.guildsReady?.({
            guildIds: ['guild-1', 'guild-2'],
        });

        expect(upsertBotInstallationMock).toHaveBeenCalledWith(database.db, {
            guildId: 'guild-1',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(database.db, {
            guildId: 'guild-2',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(database.db, {
            guildId: 'stale-guild',
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

    it('routes message-created events through the bot feature router', async () => {
        const app = createBotApp({
            config: createMultiConfig(),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        await capturedLifecycleHandlers?.messageCreated?.({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: '!ping',
            mentionedUserIds: [],
        });

        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testFluxerClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('logs successful message routes in development without raw message content', async () => {
        const logInfoMock = vi.fn();
        const logger = createLogger({ info: logInfoMock });
        const app = createBotApp({
            config: createMultiConfig({
                guildDefconOverride: 1,
            }),
            logger,
            database: createDatabase(),
        });

        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.botMention]));

        await app.start();
        await capturedLifecycleHandlers?.messageCreated?.({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: '!ping',
            mentionedUserIds: [],
        });

        expect(logInfoMock).toHaveBeenCalledWith('bot.feature_route', {
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
            guildDefconOverride: 1,
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleCount: 0,
            authorIsServerOwner: false,
            authorHasManageServer: false,
            mentionedUserCount: 0,
            contentLength: '!ping'.length,
        });
    });

    it('logs ignored message route reasons in development', async () => {
        const logInfoMock = vi.fn();
        const logger = createLogger({ info: logInfoMock });
        const app = createBotApp({
            config: createMultiConfig(),
            logger,
            database: createDatabase(),
        });

        await app.start();
        await capturedLifecycleHandlers?.messageCreated?.({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: 'hello',
            mentionedUserIds: [],
        });

        expect(logInfoMock).toHaveBeenCalledWith('bot.feature_route', {
            eventType: 'message.created',
            status: 'ignored',
            reason: 'bot-not-mentioned',
            guildDefconOverride: 'auto',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleCount: 0,
            authorIsServerOwner: false,
            authorHasManageServer: false,
            mentionedUserCount: 0,
            contentLength: 'hello'.length,
        });
    });

    it('does not log feature route results in production', async () => {
        const logInfoMock = vi.fn();
        const logger = createLogger({ info: logInfoMock });
        const app = createBotApp({
            config: createMultiConfig({
                appEnv: 'production',
            }),
            logger,
            database: createDatabase(),
        });

        await app.start();
        await capturedLifecycleHandlers?.messageCreated?.({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: '!ping',
            mentionedUserIds: [],
        });

        expect(logInfoMock).not.toHaveBeenCalledWith('bot.feature_route', expect.anything());
    });

    it('logs message route failures without throwing', async () => {
        const logErrorMock = vi.fn();
        const logger = createLogger({ error: logErrorMock });

        sendFluxerChannelMessageMock.mockResolvedValueOnce(
            err({
                type: 'send-failed',
                error: new Error('missing access'),
            })
        );

        const app = createBotApp({
            config: createMultiConfig(),
            logger,
            database: createDatabase(),
        });

        await app.start();

        await expect(
            capturedLifecycleHandlers?.messageCreated?.({
                messageId: 'message-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
                authorId: 'author-1',
                authorIsBot: false,
                authorRoleIds: [],
                authorIsServerOwner: false,
                authorHasManageServer: false,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        ).resolves.toBeUndefined();
        expect(logErrorMock).toHaveBeenCalledWith('bot.message_created_route_failed', {
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            error: 'message-send-error',
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

function createMultiConfig(options: TestConfigOptions = {}): AppConfig {
    return {
        ...createBaseConfig(options),
        instanceMode: 'multi',
    };
}

function createSingleConfig(options: TestConfigOptions & { singleGuildId?: string } = {}): AppConfig {
    return {
        ...createBaseConfig(options),
        instanceMode: 'single',
        singleGuildId: options.singleGuildId ?? 'env-guild',
    };
}

type TestConfigOptions = {
    appEnv?: AppConfig['appEnv'];
    fluxerBotCustomStatusText?: string;
    fluxerBotToken?: string | null;
    guildDefconOverride?: AppConfig['guildDefconOverride'];
};

function createBaseConfig(options: TestConfigOptions = {}): Omit<AppConfig, 'instanceMode'> {
    return {
        appEnv: options.appEnv ?? 'development',
        databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
        autoMigrate: true,
        ...(options.fluxerBotCustomStatusText ? { fluxerBotCustomStatusText: options.fluxerBotCustomStatusText } : {}),
        ...(options.fluxerBotToken === null ? {} : { fluxerBotToken: options.fluxerBotToken ?? 'bot-token' }),
        guildDefconOverride: options.guildDefconOverride ?? 'auto',
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
