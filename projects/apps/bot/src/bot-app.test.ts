import type { AppConfig } from '@neonflux/config';
import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import type { AppLogger } from '@neonflux/core/logging';
import type * as NeonFluxDb from '@neonflux/db';
import {
    addTicketMember,
    createVcGeneratorControlRequest,
    createRoleReconciliationRun,
    deleteBotInstallation,
    createTicket,
    createSuggestion,
    deleteSuggestionVote,
    findActiveGiveawayByGuildMessageId,
    findActiveVerificationRecord,
    findDefaultSuggestionBoardByGuildId,
    findEnabledTicketPanelByMessageId,
    findEnabledReactionRoleOptionByReaction,
    findEnabledVerificationFlowByReaction,
    findGuildCommandPermissionRule,
    findGuildCommandSettingsByGuildId,
    findGuildSecurityPolicyByGuildId,
    findSuggestionByGuildMessageId,
    findTicketByChannelId,
    findActiveGeneratedVoiceChannelByOwner,
    findPendingVcGeneratorControlRequest,
    findGuildUserXpRank,
    findXpSettingsByGuildId,
    grantGuildUserXp,
    listActiveReactionRoleAssignmentsByGuildUser,
    listOpenTicketsByPanelAndOpener,
    listVerificationFlowsByGuildId,
    listGuildDefconExemptionCategories,
    listGuildXpLeaderboard,
    listEnabledAutomodRulesByGuildId,
    listBotInstallationGuildIds,
    runDatabaseMigrations,
    closeXpVoiceSession,
    recordTicketEvent,
    recordRoleReconciliationAction,
    removeGiveawayEntry,
    reserveNextTicketNumber,
    transitionXpVoiceSession,
    updateTicketChannelId,
    updateTicketStatus,
    updateVcGeneratorControlRequest,
    updateRoleReconciliationRunStatus,
    upsertGuildCommandPrefix,
    upsertGiveawayEntry,
    upsertSuggestionVote,
    upsertBotInstallation,
    type DatabaseClient,
} from '@neonflux/db';
import {
    createFluxerPlatform,
    createFluxerBot,
    sendFluxerChannelMessage,
    type FluxerBotConfig,
    type FluxerBotLifecycleHandlers,
} from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBotApp } from './bot-app.js';
import { createGiveawayMaintenanceScheduler } from './bot-giveaway-maintenance.js';
import type * as BotGiveawayMaintenance from './bot-giveaway-maintenance.js';
import { createVcGeneratorMaintenanceScheduler } from './bot-vc-generator-maintenance.js';
import type * as BotVcGeneratorMaintenance from './bot-vc-generator-maintenance.js';
import { bootstrapDeploymentConfig } from './deployment-config-bootstrap.js';

vi.mock('@neonflux/db', async (importOriginal) => {
    const actual = await importOriginal<typeof NeonFluxDb>();

    return {
        ...actual,
        addTicketMember: vi.fn(),
        createVcGeneratorControlRequest: vi.fn(),
        createRoleReconciliationRun: vi.fn(),
        deleteBotInstallation: vi.fn(),
        createTicket: vi.fn(),
        createSuggestion: vi.fn(),
        deleteSuggestionVote: vi.fn(),
        findActiveGiveawayByGuildMessageId: vi.fn(),
        findActiveVerificationRecord: vi.fn(),
        findDefaultSuggestionBoardByGuildId: vi.fn(),
        findEnabledTicketPanelByMessageId: vi.fn(),
        findEnabledReactionRoleOptionByReaction: vi.fn(),
        findEnabledVerificationFlowByReaction: vi.fn(),
        findGuildCommandPermissionRule: vi.fn(),
        findGuildCommandSettingsByGuildId: vi.fn(),
        findGuildSecurityPolicyByGuildId: vi.fn(),
        findSuggestionByGuildMessageId: vi.fn(),
        findTicketByChannelId: vi.fn(),
        findActiveGeneratedVoiceChannelByOwner: vi.fn(),
        findPendingVcGeneratorControlRequest: vi.fn(),
        findGuildUserXpRank: vi.fn(),
        findXpSettingsByGuildId: vi.fn(),
        grantGuildUserXp: vi.fn(),
        listActiveReactionRoleAssignmentsByGuildUser: vi.fn(),
        listOpenTicketsByPanelAndOpener: vi.fn(),
        listVerificationFlowsByGuildId: vi.fn(),
        listGuildDefconExemptionCategories: vi.fn(),
        listGuildXpLeaderboard: vi.fn(),
        listEnabledAutomodRulesByGuildId: vi.fn(),
        listBotInstallationGuildIds: vi.fn(),
        runDatabaseMigrations: vi.fn(),
        closeXpVoiceSession: vi.fn(),
        recordTicketEvent: vi.fn(),
        recordRoleReconciliationAction: vi.fn(),
        removeGiveawayEntry: vi.fn(),
        reserveNextTicketNumber: vi.fn(),
        transitionXpVoiceSession: vi.fn(),
        updateTicketChannelId: vi.fn(),
        updateTicketStatus: vi.fn(),
        updateVcGeneratorControlRequest: vi.fn(),
        updateRoleReconciliationRunStatus: vi.fn(),
        upsertGuildCommandPrefix: vi.fn(),
        upsertGiveawayEntry: vi.fn(),
        upsertSuggestionVote: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', () => ({
    createFluxerPlatform: vi.fn(),
    createFluxerBot: vi.fn(),
    sendFluxerChannelMessage: vi.fn(),
}));

vi.mock('./deployment-config-bootstrap.js', () => ({
    bootstrapDeploymentConfig: vi.fn(),
}));

vi.mock('./bot-giveaway-maintenance.js', async (importOriginal) => {
    const actual = await importOriginal<typeof BotGiveawayMaintenance>();

    return {
        ...actual,
        createGiveawayMaintenanceScheduler: vi.fn(),
    };
});

vi.mock('./bot-vc-generator-maintenance.js', async (importOriginal) => {
    const actual = await importOriginal<typeof BotVcGeneratorMaintenance>();

    return {
        ...actual,
        createVcGeneratorMaintenanceScheduler: vi.fn(),
    };
});

const runDatabaseMigrationsMock = vi.mocked(runDatabaseMigrations);
const bootstrapDeploymentConfigMock = vi.mocked(bootstrapDeploymentConfig);
const createGiveawayMaintenanceSchedulerMock = vi.mocked(createGiveawayMaintenanceScheduler);
const createVcGeneratorMaintenanceSchedulerMock = vi.mocked(createVcGeneratorMaintenanceScheduler);
const createFluxerBotMock = vi.mocked(createFluxerBot);
const sendFluxerChannelMessageMock = vi.mocked(sendFluxerChannelMessage);
const createFluxerPlatformMock = vi.mocked(createFluxerPlatform);
const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const addTicketMemberMock = vi.mocked(addTicketMember);
const createVcGeneratorControlRequestMock = vi.mocked(createVcGeneratorControlRequest);
const createRoleReconciliationRunMock = vi.mocked(createRoleReconciliationRun);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const createTicketMock = vi.mocked(createTicket);
const createSuggestionMock = vi.mocked(createSuggestion);
const deleteSuggestionVoteMock = vi.mocked(deleteSuggestionVote);
const findActiveGiveawayByGuildMessageIdMock = vi.mocked(findActiveGiveawayByGuildMessageId);
const findActiveVerificationRecordMock = vi.mocked(findActiveVerificationRecord);
const findDefaultSuggestionBoardByGuildIdMock = vi.mocked(findDefaultSuggestionBoardByGuildId);
const findEnabledTicketPanelByMessageIdMock = vi.mocked(findEnabledTicketPanelByMessageId);
const findEnabledReactionRoleOptionByReactionMock = vi.mocked(findEnabledReactionRoleOptionByReaction);
const findEnabledVerificationFlowByReactionMock = vi.mocked(findEnabledVerificationFlowByReaction);
const findGuildCommandPermissionRuleMock = vi.mocked(findGuildCommandPermissionRule);
const findGuildCommandSettingsByGuildIdMock = vi.mocked(findGuildCommandSettingsByGuildId);
const findGuildSecurityPolicyByGuildIdMock = vi.mocked(findGuildSecurityPolicyByGuildId);
const findSuggestionByGuildMessageIdMock = vi.mocked(findSuggestionByGuildMessageId);
const findTicketByChannelIdMock = vi.mocked(findTicketByChannelId);
const findActiveGeneratedVoiceChannelByOwnerMock = vi.mocked(findActiveGeneratedVoiceChannelByOwner);
const findPendingVcGeneratorControlRequestMock = vi.mocked(findPendingVcGeneratorControlRequest);
const findGuildUserXpRankMock = vi.mocked(findGuildUserXpRank);
const findXpSettingsByGuildIdMock = vi.mocked(findXpSettingsByGuildId);
const grantGuildUserXpMock = vi.mocked(grantGuildUserXp);
const listActiveReactionRoleAssignmentsByGuildUserMock = vi.mocked(listActiveReactionRoleAssignmentsByGuildUser);
const listOpenTicketsByPanelAndOpenerMock = vi.mocked(listOpenTicketsByPanelAndOpener);
const listVerificationFlowsByGuildIdMock = vi.mocked(listVerificationFlowsByGuildId);
const listGuildDefconExemptionCategoriesMock = vi.mocked(listGuildDefconExemptionCategories);
const listGuildXpLeaderboardMock = vi.mocked(listGuildXpLeaderboard);
const listEnabledAutomodRulesByGuildIdMock = vi.mocked(listEnabledAutomodRulesByGuildId);
const listBotInstallationGuildIdsMock = vi.mocked(listBotInstallationGuildIds);
const closeXpVoiceSessionMock = vi.mocked(closeXpVoiceSession);
const recordTicketEventMock = vi.mocked(recordTicketEvent);
const recordRoleReconciliationActionMock = vi.mocked(recordRoleReconciliationAction);
const removeGiveawayEntryMock = vi.mocked(removeGiveawayEntry);
const reserveNextTicketNumberMock = vi.mocked(reserveNextTicketNumber);
const transitionXpVoiceSessionMock = vi.mocked(transitionXpVoiceSession);
const updateTicketChannelIdMock = vi.mocked(updateTicketChannelId);
const updateTicketStatusMock = vi.mocked(updateTicketStatus);
const updateVcGeneratorControlRequestMock = vi.mocked(updateVcGeneratorControlRequest);
const updateRoleReconciliationRunStatusMock = vi.mocked(updateRoleReconciliationRunStatus);
const upsertGuildCommandPrefixMock = vi.mocked(upsertGuildCommandPrefix);
const upsertGiveawayEntryMock = vi.mocked(upsertGiveawayEntry);
const upsertSuggestionVoteMock = vi.mocked(upsertSuggestionVote);
const testDb = {} as DatabaseClient['db'];
const testFluxerClient = {
    user: {
        id: 'bot-user',
    },
} as never;

let capturedFluxerConfig: FluxerBotConfig | undefined;
let capturedLifecycleHandlers: FluxerBotLifecycleHandlers | undefined;
let giveawayMaintenanceStartMock: ReturnType<typeof vi.fn<() => void>>;
let giveawayMaintenanceStopMock: ReturnType<typeof vi.fn<() => void>>;
let vcGeneratorMaintenanceStartMock: ReturnType<typeof vi.fn<() => void>>;
let vcGeneratorMaintenanceStopMock: ReturnType<typeof vi.fn<() => void>>;
let fluxerStartMock: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let fluxerStopMock: ReturnType<typeof vi.fn<() => Promise<void>>>;

describe('createBotApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedFluxerConfig = undefined;
        capturedLifecycleHandlers = undefined;
        giveawayMaintenanceStartMock = vi.fn<() => void>();
        giveawayMaintenanceStopMock = vi.fn<() => void>();
        vcGeneratorMaintenanceStartMock = vi.fn<() => void>();
        vcGeneratorMaintenanceStopMock = vi.fn<() => void>();
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
        createGiveawayMaintenanceSchedulerMock.mockReturnValue({
            start: giveawayMaintenanceStartMock,
            stop: giveawayMaintenanceStopMock,
            runOnce: vi.fn(),
        });
        createVcGeneratorMaintenanceSchedulerMock.mockReturnValue({
            start: vcGeneratorMaintenanceStartMock,
            stop: vcGeneratorMaintenanceStopMock,
            runOnce: vi.fn(),
        });
        upsertBotInstallationMock.mockResolvedValue(ok(createBotInstallationRecord('guild-1')));
        addTicketMemberMock.mockResolvedValue(err({ type: 'database-error' }));
        createVcGeneratorControlRequestMock.mockResolvedValue(err({ type: 'database-error' }));
        createRoleReconciliationRunMock.mockResolvedValue(err({ type: 'database-error' }));
        deleteBotInstallationMock.mockResolvedValue(ok(createBotInstallationRecord('guild-1')));
        createTicketMock.mockResolvedValue(err({ type: 'database-error' }));
        createSuggestionMock.mockResolvedValue(err({ type: 'database-error' }));
        deleteSuggestionVoteMock.mockResolvedValue(err({ type: 'not-found' }));
        findActiveGiveawayByGuildMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findActiveVerificationRecordMock.mockResolvedValue(err({ type: 'not-found' }));
        findDefaultSuggestionBoardByGuildIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findEnabledTicketPanelByMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValue(err({ type: 'not-found' }));
        findEnabledVerificationFlowByReactionMock.mockResolvedValue(err({ type: 'not-found' }));
        findGuildCommandPermissionRuleMock.mockResolvedValue(err('not-found'));
        findGuildCommandSettingsByGuildIdMock.mockResolvedValue(err('not-found'));
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(err('not-found'));
        findSuggestionByGuildMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findTicketByChannelIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findActiveGeneratedVoiceChannelByOwnerMock.mockResolvedValue(err({ type: 'not-found' }));
        findPendingVcGeneratorControlRequestMock.mockResolvedValue(err({ type: 'not-found' }));
        findGuildUserXpRankMock.mockResolvedValue(err({ type: 'not-found' }));
        findXpSettingsByGuildIdMock.mockResolvedValue(err({ type: 'not-found' }));
        grantGuildUserXpMock.mockResolvedValue(err({ type: 'database-error' }));
        listActiveReactionRoleAssignmentsByGuildUserMock.mockResolvedValue(ok([]));
        listOpenTicketsByPanelAndOpenerMock.mockResolvedValue(ok([]));
        listVerificationFlowsByGuildIdMock.mockResolvedValue(ok([]));
        listGuildDefconExemptionCategoriesMock.mockResolvedValue(ok([]));
        listGuildXpLeaderboardMock.mockResolvedValue(ok([]));
        listEnabledAutomodRulesByGuildIdMock.mockResolvedValue(ok([]));
        listBotInstallationGuildIdsMock.mockResolvedValue(ok([]));
        closeXpVoiceSessionMock.mockResolvedValue(err({ type: 'not-found' }));
        recordTicketEventMock.mockResolvedValue(err({ type: 'database-error' }));
        recordRoleReconciliationActionMock.mockResolvedValue(err({ type: 'database-error' }));
        removeGiveawayEntryMock.mockResolvedValue(err({ type: 'database-error' }));
        reserveNextTicketNumberMock.mockResolvedValue(err({ type: 'database-error' }));
        transitionXpVoiceSessionMock.mockResolvedValue(err({ type: 'database-error' }));
        updateTicketChannelIdMock.mockResolvedValue(err({ type: 'database-error' }));
        updateTicketStatusMock.mockResolvedValue(err({ type: 'database-error' }));
        updateVcGeneratorControlRequestMock.mockResolvedValue(err({ type: 'database-error' }));
        updateRoleReconciliationRunStatusMock.mockResolvedValue(err({ type: 'database-error' }));
        upsertGiveawayEntryMock.mockResolvedValue(err({ type: 'database-error' }));
        upsertSuggestionVoteMock.mockResolvedValue(err({ type: 'database-error' }));
        upsertGuildCommandPrefixMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                prefix: '?',
                createdAt: new Date('2026-06-24T00:00:00.000Z'),
                updatedAt: new Date('2026-06-24T00:00:00.000Z'),
            })
        );
        createFluxerPlatformMock.mockReturnValue({
            messages: {
                react: vi.fn().mockResolvedValue(ok(undefined)),
                send: vi.fn().mockResolvedValue(
                    ok({
                        id: 'platform-message-1',
                        channelId: 'channel-1',
                        guildId: 'guild-1',
                    })
                ),
            },
        } as never);
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
            config: createSingleConfig({
                guildDefconOverride: 3,
            }),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(capturedFluxerConfig).toStrictEqual({
            instanceMode: 'multi',
            fluxerBotToken: 'bot-token',
        });
    });

    it('creates the Fluxer bot with configured custom status text in normal mode', async () => {
        const app = createBotApp({
            config: createMultiConfig({
                fluxerBotCustomStatusText: 'Env NeonFlux status',
                guildDefconOverride: 3,
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

    it('does not configure a custom status in normal mode when the env status is unset', async () => {
        const app = createBotApp({
            config: createMultiConfig({
                guildDefconOverride: 3,
            }),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(capturedFluxerConfig).toStrictEqual({
            instanceMode: 'multi',
            fluxerBotToken: 'bot-token',
        });
    });

    it.each([
        [1, 'DEFCON 1: Owner only mode'],
        [2, 'DEFCON 2: Guarded commands restricted'],
    ] as const)('uses DEFCON %s as the bot status instead of the env status', async (defconLevel, customStatusText) => {
        const app = createBotApp({
            config: createMultiConfig({
                fluxerBotCustomStatusText: 'Env NeonFlux status',
                guildDefconOverride: defconLevel,
            }),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(capturedFluxerConfig).toStrictEqual({
            instanceMode: 'multi',
            customStatusText,
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

    it('routes scaffold lifecycle events through the bot feature router', async () => {
        const logInfoMock = vi.fn();
        const logger = createLogger({ info: logInfoMock });
        const app = createBotApp({
            config: createMultiConfig(),
            logger,
            database: createDatabase(),
        });

        await app.start();
        await capturedLifecycleHandlers?.reactionAdded?.({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            userIsBot: false,
            emojiKey: 'emoji:1',
        });

        expect(logInfoMock).toHaveBeenCalledWith('bot.feature_route', {
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'no-feature-handler',
            guildDefconOverride: 'auto',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'emoji:1',
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
            config: createMultiConfig({ fluxerBotToken: null, guildDefconOverride: 3 }),
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

    it('starts and stops background maintenance with the bot lifecycle', async () => {
        const app = createBotApp({
            config: createMultiConfig(),
            logger: createLogger(),
            database: createDatabase(),
        });

        await app.start();

        expect(createGiveawayMaintenanceSchedulerMock).toHaveBeenCalledOnce();
        expect(createVcGeneratorMaintenanceSchedulerMock).toHaveBeenCalledOnce();
        const giveawaySchedulerInput = createGiveawayMaintenanceSchedulerMock.mock.calls[0]?.[0];
        const vcGeneratorSchedulerInput = createVcGeneratorMaintenanceSchedulerMock.mock.calls[0]?.[0];

        expect(typeof giveawaySchedulerInput?.createContext).toBe('function');
        expect(giveawaySchedulerInput?.logger).toBeDefined();
        expect(typeof vcGeneratorSchedulerInput?.createContext).toBe('function');
        expect(vcGeneratorSchedulerInput?.logger).toBeDefined();
        expect(giveawayMaintenanceStartMock).toHaveBeenCalledTimes(1);
        expect(giveawayMaintenanceStartMock.mock.invocationCallOrder[0]).toBeGreaterThan(
            fluxerStartMock.mock.invocationCallOrder[0] ?? 0
        );
        expect(vcGeneratorMaintenanceStartMock).toHaveBeenCalledTimes(1);
        expect(vcGeneratorMaintenanceStartMock.mock.invocationCallOrder[0]).toBeGreaterThan(
            fluxerStartMock.mock.invocationCallOrder[0] ?? 0
        );

        await app.stop();

        expect(vcGeneratorMaintenanceStopMock).toHaveBeenCalledTimes(1);
        expect(vcGeneratorMaintenanceStopMock.mock.invocationCallOrder[0]).toBeLessThan(
            fluxerStopMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
        );
        expect(giveawayMaintenanceStopMock).toHaveBeenCalledTimes(1);
        expect(giveawayMaintenanceStopMock.mock.invocationCallOrder[0]).toBeLessThan(
            fluxerStopMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
        );
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
