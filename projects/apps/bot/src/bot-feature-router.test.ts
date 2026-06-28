import type { AppMode } from '@neonflux/config';
import { COMMAND_PREFIX_INVALID_MESSAGE, DEFAULT_COMMAND_PREFIX } from '@neonflux/core/command-prefix';
import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import {
    deleteBotInstallation,
    addModerationCaseNote,
    addTicketMember,
    cancelPendingModerationTemporaryActionsByTarget,
    createChannelModerationCase,
    createRoleReconciliationRun,
    createVcGeneratorControlRequest,
    createObservedModerationCase,
    createModerationCase,
    createModerationTemporaryAction,
    createSuggestion,
    createTicket,
    deleteSuggestionVote,
    findDefaultSuggestionBoardByGuildId,
    findEnabledTicketPanelByMessageId,
    findGuildModerationPolicyByGuildId,
    findGuildLoggingDestinationByEventGroup,
    findRecentModerationCaseByTargetAction,
    findModerationCaseByGuildCaseNumber,
    findGuildCommandPermissionRule,
    findGuildCommandSettingsByGuildId,
    findRoleReconciliationSettingsByGuildId,
    findSuggestionByGuildMessageId,
    findTicketByChannelId,
    findActiveGeneratedVoiceChannelByOwner,
    findGeneratedVoiceChannelByChannelId,
    findPendingVcGeneratorControlRequest,
    findVcGeneratorControlPanelByMessageId,
    findVcGeneratorRuleBySourceChannelId,
    findEnabledReactionRoleOptionByReaction,
    findActiveVerificationRecord,
    findEnabledVerificationFlowByReaction,
    findActiveGiveawayByGuildMessageId,
    findGuildSecurityPolicyByGuildId,
    findGuildUserXpRank,
    incrementGuildMessageActivityDay,
    listEnabledAutoroleRulesByGuildId,
    listGuildXpLeaderboard,
    listModerationCaseEventsByCaseId,
    listModerationCasesByGuildId,
    listOpenTicketsByPanelAndOpener,
    listGuildDefconExemptionCategories,
    listGuildInviteSnapshots,
    listActiveReactionRoleAssignmentsByGuildMessageUser,
    listActiveReactionRoleAssignmentsByGuildUser,
    listVerificationFlowsByGuildId,
    recordBotActionEvent,
    recordRoleReconciliationAction,
    recordStructureObservedEvent,
    recordModerationCaseEvent,
    recordAutomodEvent,
    recordTicketEvent,
    recordGuildMemberFlowEvent,
    reserveNextTicketNumber,
    markReactionRoleAssignmentRemoved,
    removeGiveawayEntry,
    syncGuildInviteSnapshots,
    closeXpVoiceSession,
    cleanupDeletedGuildRoleReferences,
    grantGuildUserXp,
    findXpSettingsByGuildId,
    listEnabledAutomodRulesByGuildId,
    transitionXpVoiceSession,
    updateAutomodEventStatus,
    updateTicketChannelId,
    updateTicketStatus,
    updateRoleReconciliationRunStatus,
    updateVcGeneratorControlRequest,
    updateGeneratedVoiceChannelStatus,
    updateModerationCaseStatus,
    updateModerationCaseReason,
    upsertReactionRoleAssignment,
    upsertGiveawayEntry,
    upsertSuggestionVote,
    upsertVerificationRecord,
    upsertGuildCommandPrefix,
    upsertGeneratedVoiceChannel,
    upsertBotInstallation,
    voidModerationCase,
    type AutoroleRuleRecord,
    type AutomodEventRecord,
    type AutomodRuleRecord,
    type BotActionEventRecord,
    type BotInstallationRecord,
    type GuildCommandSettingsRecord,
    type GuildModerationPolicyRecord,
    type GuildLoggingDestinationRecord,
    type ModerationCaseRecord,
    type ModerationCaseEventRecord,
    type ModerationTemporaryActionRecord,
    type ReactionRoleAssignmentRecord,
    type ReactionRoleMessageRecord,
    type ReactionRoleOptionMatch,
    type ReactionRoleOptionRecord,
    type RoleReconciliationActionRecord,
    type RoleReconciliationRunRecord,
    type RoleReconciliationSettingsRecord,
    type StructureObservedEventStateRecord,
    type SuggestionBoardRecord,
    type SuggestionRecord,
    type SuggestionVoteRecord,
    type TicketEventRecord,
    type TicketMemberRecord,
    type TicketPanelRecord,
    type TicketRecord,
    type VerificationFlowRecord,
    type VerificationRecord,
    type GeneratedVoiceChannelRecord,
    type GuildUserXpRecord,
    type VcGeneratorControlPanelRecord,
    type VcGeneratorControlRequestRecord,
    type VcGeneratorRuleRecord,
    type XpGrantRecord,
    type XpSettingsRecord,
    type XpVoiceSessionRecord,
} from '@neonflux/db';
import {
    createFluxerPlatform,
    readFluxerGuildInvites,
    sendFluxerChannelMessage,
    type FluxerBot,
} from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeBotFeatureEvent, type BotFeatureHandlerContext } from './bot-feature-router.js';

vi.mock('@neonflux/db', () => {
    return {
        deleteBotInstallation: vi.fn(),
        addModerationCaseNote: vi.fn(),
        addTicketMember: vi.fn(),
        cancelPendingModerationTemporaryActionsByTarget: vi.fn(),
        createChannelModerationCase: vi.fn(),
        createRoleReconciliationRun: vi.fn(),
        createVcGeneratorControlRequest: vi.fn(),
        createObservedModerationCase: vi.fn(),
        createModerationCase: vi.fn(),
        createModerationTemporaryAction: vi.fn(),
        createSuggestion: vi.fn(),
        createTicket: vi.fn(),
        deleteSuggestionVote: vi.fn(),
        findDefaultSuggestionBoardByGuildId: vi.fn(),
        findEnabledTicketPanelByMessageId: vi.fn(),
        findGuildModerationPolicyByGuildId: vi.fn(),
        findGuildLoggingDestinationByEventGroup: vi.fn(),
        findRecentModerationCaseByTargetAction: vi.fn(),
        findModerationCaseByGuildCaseNumber: vi.fn(),
        findGuildCommandPermissionRule: vi.fn(),
        findGuildCommandSettingsByGuildId: vi.fn(),
        findRoleReconciliationSettingsByGuildId: vi.fn(),
        findSuggestionByGuildMessageId: vi.fn(),
        findTicketByChannelId: vi.fn(),
        findActiveGeneratedVoiceChannelByOwner: vi.fn(),
        findGeneratedVoiceChannelByChannelId: vi.fn(),
        findPendingVcGeneratorControlRequest: vi.fn(),
        findVcGeneratorControlPanelByMessageId: vi.fn(),
        findVcGeneratorRuleBySourceChannelId: vi.fn(),
        findEnabledReactionRoleOptionByReaction: vi.fn(),
        findActiveVerificationRecord: vi.fn(),
        findEnabledVerificationFlowByReaction: vi.fn(),
        findActiveGiveawayByGuildMessageId: vi.fn(),
        findGuildSecurityPolicyByGuildId: vi.fn(),
        findGuildUserXpRank: vi.fn(),
        incrementGuildMessageActivityDay: vi.fn(),
        listEnabledAutoroleRulesByGuildId: vi.fn(),
        listGuildXpLeaderboard: vi.fn(),
        listModerationCaseEventsByCaseId: vi.fn(),
        listModerationCasesByGuildId: vi.fn(),
        listOpenTicketsByPanelAndOpener: vi.fn(),
        listGuildDefconExemptionCategories: vi.fn(),
        listGuildInviteSnapshots: vi.fn(),
        listActiveReactionRoleAssignmentsByGuildMessageUser: vi.fn(),
        listActiveReactionRoleAssignmentsByGuildUser: vi.fn(),
        listVerificationFlowsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        recordRoleReconciliationAction: vi.fn(),
        recordStructureObservedEvent: vi.fn(),
        recordModerationCaseEvent: vi.fn(),
        recordTicketEvent: vi.fn(),
        recordGuildMemberFlowEvent: vi.fn(),
        reserveNextTicketNumber: vi.fn(),
        markReactionRoleAssignmentRemoved: vi.fn(),
        removeGiveawayEntry: vi.fn(),
        syncGuildInviteSnapshots: vi.fn(),
        closeXpVoiceSession: vi.fn(),
        cleanupDeletedGuildRoleReferences: vi.fn(),
        grantGuildUserXp: vi.fn(),
        findXpSettingsByGuildId: vi.fn(),
        listEnabledAutomodRulesByGuildId: vi.fn(),
        recordAutomodEvent: vi.fn(),
        updateAutomodEventStatus: vi.fn(),
        transitionXpVoiceSession: vi.fn(),
        updateTicketChannelId: vi.fn(),
        updateTicketStatus: vi.fn(),
        updateRoleReconciliationRunStatus: vi.fn(),
        updateVcGeneratorControlRequest: vi.fn(),
        updateGeneratedVoiceChannelStatus: vi.fn(),
        updateModerationCaseStatus: vi.fn(),
        updateModerationCaseReason: vi.fn(),
        upsertReactionRoleAssignment: vi.fn(),
        upsertGiveawayEntry: vi.fn(),
        upsertSuggestionVote: vi.fn(),
        upsertVerificationRecord: vi.fn(),
        upsertGuildCommandPrefix: vi.fn(),
        upsertGeneratedVoiceChannel: vi.fn(),
        upsertBotInstallation: vi.fn(),
        voidModerationCase: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', () => {
    return {
        createFluxerPlatform: vi.fn(),
        readFluxerGuildInvites: vi.fn(),
        sendFluxerChannelMessage: vi.fn(),
    };
});

const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const addModerationCaseNoteMock = vi.mocked(addModerationCaseNote);
const addTicketMemberMock = vi.mocked(addTicketMember);
const cancelPendingModerationTemporaryActionsByTargetMock = vi.mocked(cancelPendingModerationTemporaryActionsByTarget);
const createChannelModerationCaseMock = vi.mocked(createChannelModerationCase);
const createRoleReconciliationRunMock = vi.mocked(createRoleReconciliationRun);
const createVcGeneratorControlRequestMock = vi.mocked(createVcGeneratorControlRequest);
const createObservedModerationCaseMock = vi.mocked(createObservedModerationCase);
const createModerationCaseMock = vi.mocked(createModerationCase);
const createModerationTemporaryActionMock = vi.mocked(createModerationTemporaryAction);
const createSuggestionMock = vi.mocked(createSuggestion);
const createTicketMock = vi.mocked(createTicket);
const deleteSuggestionVoteMock = vi.mocked(deleteSuggestionVote);
const findDefaultSuggestionBoardByGuildIdMock = vi.mocked(findDefaultSuggestionBoardByGuildId);
const findEnabledTicketPanelByMessageIdMock = vi.mocked(findEnabledTicketPanelByMessageId);
const findGuildModerationPolicyByGuildIdMock = vi.mocked(findGuildModerationPolicyByGuildId);
const findGuildLoggingDestinationByEventGroupMock = vi.mocked(findGuildLoggingDestinationByEventGroup);
const findRecentModerationCaseByTargetActionMock = vi.mocked(findRecentModerationCaseByTargetAction);
const findModerationCaseByGuildCaseNumberMock = vi.mocked(findModerationCaseByGuildCaseNumber);
const findGuildCommandPermissionRuleMock = vi.mocked(findGuildCommandPermissionRule);
const findGuildCommandSettingsByGuildIdMock = vi.mocked(findGuildCommandSettingsByGuildId);
const findRoleReconciliationSettingsByGuildIdMock = vi.mocked(findRoleReconciliationSettingsByGuildId);
const findSuggestionByGuildMessageIdMock = vi.mocked(findSuggestionByGuildMessageId);
const findTicketByChannelIdMock = vi.mocked(findTicketByChannelId);
const findActiveGeneratedVoiceChannelByOwnerMock = vi.mocked(findActiveGeneratedVoiceChannelByOwner);
const findGeneratedVoiceChannelByChannelIdMock = vi.mocked(findGeneratedVoiceChannelByChannelId);
const findPendingVcGeneratorControlRequestMock = vi.mocked(findPendingVcGeneratorControlRequest);
const findVcGeneratorControlPanelByMessageIdMock = vi.mocked(findVcGeneratorControlPanelByMessageId);
const findVcGeneratorRuleBySourceChannelIdMock = vi.mocked(findVcGeneratorRuleBySourceChannelId);
const findEnabledReactionRoleOptionByReactionMock = vi.mocked(findEnabledReactionRoleOptionByReaction);
const findActiveVerificationRecordMock = vi.mocked(findActiveVerificationRecord);
const findEnabledVerificationFlowByReactionMock = vi.mocked(findEnabledVerificationFlowByReaction);
const findActiveGiveawayByGuildMessageIdMock = vi.mocked(findActiveGiveawayByGuildMessageId);
const findGuildSecurityPolicyByGuildIdMock = vi.mocked(findGuildSecurityPolicyByGuildId);
const findGuildUserXpRankMock = vi.mocked(findGuildUserXpRank);
const incrementGuildMessageActivityDayMock = vi.mocked(incrementGuildMessageActivityDay);
const listEnabledAutoroleRulesByGuildIdMock = vi.mocked(listEnabledAutoroleRulesByGuildId);
const listGuildXpLeaderboardMock = vi.mocked(listGuildXpLeaderboard);
const listModerationCaseEventsByCaseIdMock = vi.mocked(listModerationCaseEventsByCaseId);
const listModerationCasesByGuildIdMock = vi.mocked(listModerationCasesByGuildId);
const listOpenTicketsByPanelAndOpenerMock = vi.mocked(listOpenTicketsByPanelAndOpener);
const listGuildDefconExemptionCategoriesMock = vi.mocked(listGuildDefconExemptionCategories);
const listGuildInviteSnapshotsMock = vi.mocked(listGuildInviteSnapshots);
const listActiveReactionRoleAssignmentsByGuildMessageUserMock = vi.mocked(
    listActiveReactionRoleAssignmentsByGuildMessageUser
);
const listActiveReactionRoleAssignmentsByGuildUserMock = vi.mocked(listActiveReactionRoleAssignmentsByGuildUser);
const listVerificationFlowsByGuildIdMock = vi.mocked(listVerificationFlowsByGuildId);
const recordBotActionEventMock = vi.mocked(recordBotActionEvent);
const recordRoleReconciliationActionMock = vi.mocked(recordRoleReconciliationAction);
const recordStructureObservedEventMock = vi.mocked(recordStructureObservedEvent);
const recordModerationCaseEventMock = vi.mocked(recordModerationCaseEvent);
const recordAutomodEventMock = vi.mocked(recordAutomodEvent);
const recordTicketEventMock = vi.mocked(recordTicketEvent);
const recordGuildMemberFlowEventMock = vi.mocked(recordGuildMemberFlowEvent);
const reserveNextTicketNumberMock = vi.mocked(reserveNextTicketNumber);
const markReactionRoleAssignmentRemovedMock = vi.mocked(markReactionRoleAssignmentRemoved);
const removeGiveawayEntryMock = vi.mocked(removeGiveawayEntry);
const syncGuildInviteSnapshotsMock = vi.mocked(syncGuildInviteSnapshots);
const closeXpVoiceSessionMock = vi.mocked(closeXpVoiceSession);
const cleanupDeletedGuildRoleReferencesMock = vi.mocked(cleanupDeletedGuildRoleReferences);
const grantGuildUserXpMock = vi.mocked(grantGuildUserXp);
const findXpSettingsByGuildIdMock = vi.mocked(findXpSettingsByGuildId);
const listEnabledAutomodRulesByGuildIdMock = vi.mocked(listEnabledAutomodRulesByGuildId);
const transitionXpVoiceSessionMock = vi.mocked(transitionXpVoiceSession);
const updateAutomodEventStatusMock = vi.mocked(updateAutomodEventStatus);
const updateTicketChannelIdMock = vi.mocked(updateTicketChannelId);
const updateTicketStatusMock = vi.mocked(updateTicketStatus);
const updateRoleReconciliationRunStatusMock = vi.mocked(updateRoleReconciliationRunStatus);
const updateVcGeneratorControlRequestMock = vi.mocked(updateVcGeneratorControlRequest);
const updateGeneratedVoiceChannelStatusMock = vi.mocked(updateGeneratedVoiceChannelStatus);
const updateModerationCaseStatusMock = vi.mocked(updateModerationCaseStatus);
const updateModerationCaseReasonMock = vi.mocked(updateModerationCaseReason);
const upsertReactionRoleAssignmentMock = vi.mocked(upsertReactionRoleAssignment);
const upsertGiveawayEntryMock = vi.mocked(upsertGiveawayEntry);
const upsertSuggestionVoteMock = vi.mocked(upsertSuggestionVote);
const upsertVerificationRecordMock = vi.mocked(upsertVerificationRecord);
const upsertGuildCommandPrefixMock = vi.mocked(upsertGuildCommandPrefix);
const upsertGeneratedVoiceChannelMock = vi.mocked(upsertGeneratedVoiceChannel);
const voidModerationCaseMock = vi.mocked(voidModerationCase);
const readFluxerGuildInvitesMock = vi.mocked(readFluxerGuildInvites);
const sendFluxerChannelMessageMock = vi.mocked(sendFluxerChannelMessage);
const createFluxerPlatformMock = vi.mocked(createFluxerPlatform);
const guildStructureReadMock = vi.fn();
const memberReadMock = vi.fn();
const memberAddRoleMock = vi.fn();
const memberMoveMock = vi.fn();
const memberRemoveRoleMock = vi.fn();
const channelCreateMock = vi.fn();
const channelDeleteMock = vi.fn();
const channelEditMock = vi.fn();
const channelEditPermissionMock = vi.fn();
const channelDeletePermissionMock = vi.fn();
const messagesBulkDeleteMock = vi.fn();
const messagesDeleteMock = vi.fn();
const messagesFetchManyMock = vi.fn();
const messagesReactMock = vi.fn();
const messagesRemoveReactionMock = vi.fn();
const messagesSendMock = vi.fn();
const moderationBanMock = vi.fn();
const moderationKickMock = vi.fn();
const moderationTimeoutMock = vi.fn();
const moderationUntimeoutMock = vi.fn();
const moderationUnbanMock = vi.fn();
const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as FluxerBot['client'];
type PlatformMessageSendInput = Parameters<ReturnType<typeof createFluxerPlatform>['messages']['send']>[0];
type RecentModerationCaseLookupInput = Parameters<typeof findRecentModerationCaseByTargetAction>[1];

describe('routeBotFeatureEvent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        addModerationCaseNoteMock.mockResolvedValue(ok(createModerationCaseEventRecord()));
        addTicketMemberMock.mockResolvedValue(ok(createTicketMemberRecord()));
        cancelPendingModerationTemporaryActionsByTargetMock.mockResolvedValue(ok([]));
        createChannelModerationCaseMock.mockResolvedValue(
            ok(
                createModerationCaseRecord({
                    action: 'purge',
                    targetType: 'channel',
                    targetUserId: null,
                    targetChannelId: 'channel-1',
                })
            )
        );
        createRoleReconciliationRunMock.mockResolvedValue(ok(createRoleReconciliationRunRecord()));
        createVcGeneratorControlRequestMock.mockImplementation((_db, input) =>
            Promise.resolve(
                ok(
                    createVcGeneratorControlRequestRecord({
                        guildId: input.guildId,
                        generatedChannelId: input.generatedChannelId,
                        panelChannelId: input.panelChannelId,
                        targetChannelId: input.targetChannelId,
                        requesterUserId: input.requesterUserId,
                        controlAction: input.controlAction,
                        expiresAt: input.expiresAt,
                        status: input.status ?? 'pending',
                    })
                )
            )
        );
        createObservedModerationCaseMock.mockResolvedValue(ok(createModerationCaseRecord({ status: 'resolved' })));
        createModerationCaseMock.mockResolvedValue(ok(createModerationCaseRecord()));
        createModerationTemporaryActionMock.mockResolvedValue(ok(createModerationTemporaryActionRecord()));
        createSuggestionMock.mockResolvedValue(ok(createSuggestionRecord()));
        createTicketMock.mockResolvedValue(ok(createTicketRecord()));
        deleteSuggestionVoteMock.mockResolvedValue(ok(createSuggestionVoteRecord()));
        findDefaultSuggestionBoardByGuildIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findEnabledTicketPanelByMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findGuildModerationPolicyByGuildIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValue(err({ type: 'not-found' }));
        findRecentModerationCaseByTargetActionMock.mockResolvedValue(err({ type: 'not-found' }));
        findModerationCaseByGuildCaseNumberMock.mockResolvedValue(ok(createModerationCaseRecord()));
        findGuildCommandPermissionRuleMock.mockResolvedValue(err('not-found'));
        findGuildCommandSettingsByGuildIdMock.mockResolvedValue(err('not-found'));
        findRoleReconciliationSettingsByGuildIdMock.mockResolvedValue(ok(createRoleReconciliationSettingsRecord()));
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValue(err({ type: 'not-found' }));
        findActiveVerificationRecordMock.mockResolvedValue(err({ type: 'not-found' }));
        findEnabledVerificationFlowByReactionMock.mockResolvedValue(err({ type: 'not-found' }));
        findActiveGiveawayByGuildMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(err('not-found'));
        findGuildUserXpRankMock.mockResolvedValue(err({ type: 'not-found' }));
        findSuggestionByGuildMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findTicketByChannelIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findActiveGeneratedVoiceChannelByOwnerMock.mockResolvedValue(err({ type: 'not-found' }));
        findGeneratedVoiceChannelByChannelIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findPendingVcGeneratorControlRequestMock.mockResolvedValue(err({ type: 'not-found' }));
        findVcGeneratorControlPanelByMessageIdMock.mockResolvedValue(err({ type: 'not-found' }));
        findVcGeneratorRuleBySourceChannelIdMock.mockResolvedValue(err({ type: 'not-found' }));
        incrementGuildMessageActivityDayMock.mockResolvedValue(ok(createMessageActivityRecord()));
        listEnabledAutoroleRulesByGuildIdMock.mockResolvedValue(ok([]));
        listGuildXpLeaderboardMock.mockResolvedValue(ok([]));
        listModerationCaseEventsByCaseIdMock.mockResolvedValue(ok([createModerationCaseEventRecord()]));
        listModerationCasesByGuildIdMock.mockResolvedValue(ok([createModerationCaseRecord()]));
        listOpenTicketsByPanelAndOpenerMock.mockResolvedValue(ok([]));
        listGuildDefconExemptionCategoriesMock.mockResolvedValue(ok([]));
        listGuildInviteSnapshotsMock.mockResolvedValue(ok([]));
        listActiveReactionRoleAssignmentsByGuildMessageUserMock.mockResolvedValue(ok([]));
        listActiveReactionRoleAssignmentsByGuildUserMock.mockResolvedValue(ok([]));
        listVerificationFlowsByGuildIdMock.mockResolvedValue(ok([]));
        recordBotActionEventMock.mockResolvedValue(ok(createBotActionEventRecord()));
        recordRoleReconciliationActionMock.mockResolvedValue(ok(createRoleReconciliationActionRecord()));
        recordStructureObservedEventMock.mockResolvedValue(ok(createStructureObservedEventStateRecord()));
        recordModerationCaseEventMock.mockResolvedValue(ok(createModerationCaseEventRecord()));
        recordTicketEventMock.mockResolvedValue(ok(createTicketEventRecord()));
        recordGuildMemberFlowEventMock.mockResolvedValue(ok(createMemberFlowRecord()));
        reserveNextTicketNumberMock.mockResolvedValue(ok(1));
        markReactionRoleAssignmentRemovedMock.mockResolvedValue(
            ok(createReactionRoleAssignmentRecord({ removedAt: new Date() }))
        );
        removeGiveawayEntryMock.mockResolvedValue(err({ type: 'not-found' }));
        syncGuildInviteSnapshotsMock.mockResolvedValue(ok([]));
        closeXpVoiceSessionMock.mockResolvedValue(err({ type: 'not-found' }));
        cleanupDeletedGuildRoleReferencesMock.mockResolvedValue(ok(createDeletedRoleCleanupResult('unchanged')));
        grantGuildUserXpMock.mockResolvedValue(
            ok({
                status: 'granted',
                userXp: createGuildUserXpRecord(),
                grant: createXpGrantRecord(),
            })
        );
        findXpSettingsByGuildIdMock.mockResolvedValue(err({ type: 'not-found' }));
        listEnabledAutomodRulesByGuildIdMock.mockResolvedValue(ok([]));
        recordAutomodEventMock.mockResolvedValue(ok(createAutomodEventRecord()));
        updateAutomodEventStatusMock.mockResolvedValue(ok(createAutomodEventRecord({ status: 'enforced' })));
        transitionXpVoiceSessionMock.mockResolvedValue(
            ok({
                status: 'started',
                active: createXpVoiceSessionRecord(),
            })
        );
        updateTicketChannelIdMock.mockResolvedValue(ok(createTicketRecord({ channelId: 'generated-voice-1' })));
        updateTicketStatusMock.mockResolvedValue(ok(createTicketRecord({ status: 'closed' })));
        updateRoleReconciliationRunStatusMock.mockImplementation((_db, input) =>
            Promise.resolve(
                ok(
                    createRoleReconciliationRunRecord({
                        id: input.runId,
                        status: input.status,
                        summary: input.summary ?? {},
                    })
                )
            )
        );
        updateVcGeneratorControlRequestMock.mockImplementation((_db, input) =>
            Promise.resolve(
                ok(
                    createVcGeneratorControlRequestRecord({
                        id: input.requestId,
                        status: input.status ?? 'pending',
                        promptMessageId: input.promptMessageId ?? null,
                        value: input.value ?? null,
                        errorMessage: input.errorMessage ?? null,
                    })
                )
            )
        );
        updateGeneratedVoiceChannelStatusMock.mockResolvedValue(err({ type: 'not-found' }));
        updateModerationCaseStatusMock.mockResolvedValue(ok(createModerationCaseRecord({ status: 'resolved' })));
        updateModerationCaseReasonMock.mockResolvedValue(ok(createModerationCaseRecord({ reason: 'Updated reason' })));
        upsertReactionRoleAssignmentMock.mockResolvedValue(ok(createReactionRoleAssignmentRecord()));
        upsertGiveawayEntryMock.mockResolvedValue(
            ok({
                id: 'giveaway-entry-1',
                giveawayId: 'giveaway-1',
                userId: 'user-1',
                enteredAt: new Date('2026-06-26T00:00:00.000Z'),
                removedAt: null,
            })
        );
        upsertSuggestionVoteMock.mockResolvedValue(ok(createSuggestionVoteRecord()));
        upsertVerificationRecordMock.mockResolvedValue(ok(createVerificationRecord()));
        upsertGuildCommandPrefixMock.mockResolvedValue(ok(createCommandSettings('guild-1', '?')));
        upsertGeneratedVoiceChannelMock.mockResolvedValue(ok(createGeneratedVoiceChannelRecord()));
        voidModerationCaseMock.mockResolvedValue(ok(createModerationCaseRecord({ status: 'void' })));
        readFluxerGuildInvitesMock.mockResolvedValue(ok([]));
        memberReadMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                userId: 'target-1',
                roleIds: [],
            })
        );
        memberAddRoleMock.mockResolvedValue(ok(undefined));
        memberMoveMock.mockResolvedValue(ok(undefined));
        memberRemoveRoleMock.mockResolvedValue(ok(undefined));
        channelCreateMock.mockResolvedValue(
            ok({
                id: 'generated-voice-1',
                guildId: 'guild-1',
            })
        );
        channelDeleteMock.mockResolvedValue(ok(undefined));
        channelEditMock.mockResolvedValue(ok(undefined));
        channelEditPermissionMock.mockResolvedValue(ok(undefined));
        channelDeletePermissionMock.mockResolvedValue(ok(undefined));
        guildStructureReadMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                roles: [
                    createGuildRole({ id: 'bot-role', name: 'NeonFlux', position: 100 }),
                    createGuildRole({ id: 'role-1', name: 'Member', position: 10 }),
                    createGuildRole({ id: 'role-2', name: 'Verified', position: 20 }),
                    createGuildRole({ id: 'role-3', name: 'Opt-in', position: 30 }),
                    createGuildRole({ id: 'role-high', name: 'Admin', position: 150 }),
                ],
                channels: [],
                categories: [],
            })
        );
        moderationBanMock.mockResolvedValue(ok(undefined));
        moderationKickMock.mockResolvedValue(ok(undefined));
        moderationTimeoutMock.mockResolvedValue(ok(undefined));
        moderationUntimeoutMock.mockResolvedValue(ok(undefined));
        moderationUnbanMock.mockResolvedValue(ok(undefined));
        messagesBulkDeleteMock.mockResolvedValue(ok(undefined));
        messagesDeleteMock.mockResolvedValue(ok(undefined));
        messagesFetchManyMock.mockResolvedValue(
            ok([createFetchedMessage('message-3'), createFetchedMessage('message-2')])
        );
        messagesReactMock.mockResolvedValue(ok(undefined));
        messagesRemoveReactionMock.mockResolvedValue(ok(undefined));
        messagesSendMock.mockResolvedValue(
            ok({
                id: 'log-message-1',
                channelId: 'log-channel-1',
                guildId: 'guild-1',
            })
        );
        createFluxerPlatformMock.mockReturnValue({
            messages: {
                bulkDelete: messagesBulkDeleteMock,
                delete: messagesDeleteMock,
                fetchMany: messagesFetchManyMock,
                react: messagesReactMock,
                removeReaction: messagesRemoveReactionMock,
                send: messagesSendMock,
            },
            members: {
                read: memberReadMock,
                addRole: memberAddRoleMock,
                move: memberMoveMock,
                removeRole: memberRemoveRoleMock,
            },
            moderation: {
                ban: moderationBanMock,
                kick: moderationKickMock,
                timeout: moderationTimeoutMock,
                untimeout: moderationUntimeoutMock,
                unban: moderationUnbanMock,
            },
            guildStructure: {
                read: guildStructureReadMock,
            },
            channels: {
                create: channelCreateMock,
                delete: channelDeleteMock,
                edit: channelEditMock,
                editPermission: channelEditPermissionMock,
                deletePermission: channelDeletePermissionMock,
            },
        } as unknown as ReturnType<typeof createFluxerPlatform>);
        sendFluxerChannelMessageMock.mockResolvedValue(
            ok({
                id: 'reply-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            })
        );
    });

    it('uses ! as the default bot command prefix', () => {
        expect(DEFAULT_COMMAND_PREFIX).toBe('!');
    });

    it('records only the configured guild in single mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation('target')));

        const ignoredResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'other',
        });

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.created',
            status: 'ignored',
        });
        expect(upsertBotInstallationMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'target',
        });

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.created',
            status: 'handled',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
    });

    it('records any guild in multi mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation('guild-1')));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.created',
            status: 'handled',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
        });
    });

    it('removes only the configured guild in single mode', async () => {
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation('target')));

        const ignoredResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'other',
        });

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'ignored',
        });
        expect(deleteBotInstallationMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'target',
        });

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'handled',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
    });

    it('removes any guild in multi mode', async () => {
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation('guild-1')));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'handled',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
        });
    });

    it('ignores stale delete events when the installation is already gone', async () => {
        deleteBotInstallationMock.mockResolvedValue(err('not-found'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'ignored',
        });
    });

    it('returns database-error when installation tracking cannot write', async () => {
        upsertBotInstallationMock.mockResolvedValue(err('database-error'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('returns handler-error when a feature handler throws unexpectedly', async () => {
        upsertBotInstallationMock.mockRejectedValue(new Error('unexpected'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('handler-error');
    });

    it('mode-gates scaffold events before planned features claim them', async () => {
        const ignoredByMode = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'other',
            userId: 'user-1',
            emojiKey: 'emoji:1',
        });
        const ignoredWithoutHandler = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'emoji:1',
        });

        expect(ignoredByMode.isOk()).toBe(true);
        expect(ignoredByMode._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(ignoredWithoutHandler.isOk()).toBe(true);
        expect(ignoredWithoutHandler._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
    });

    it('cleans deleted role references before logging role delete events', async () => {
        cleanupDeletedGuildRoleReferencesMock.mockResolvedValueOnce(ok(createDeletedRoleCleanupResult('cleaned')));
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'roles' }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'role.deleted',
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'role.deleted',
            status: 'handled',
            action: 'event.role_reconciliation.structure_cleaned',
        });
        expect(cleanupDeletedGuildRoleReferencesMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            roleId: 'role-1',
        });
        expect(messagesSendMock).toHaveBeenCalled();
        expect(memberAddRoleMock).not.toHaveBeenCalled();
        expect(memberRemoveRoleMock).not.toHaveBeenCalled();
        expect(channelDeleteMock).not.toHaveBeenCalled();
    });

    it('records observed structure changes for role and channel events', async () => {
        const roleResult = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'role.created',
            guildId: 'guild-1',
            roleId: 'role-1',
        });
        const channelResult = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'channel.updated',
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelType: 0,
        });

        expect(roleResult.isOk()).toBe(true);
        expect(roleResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'role.created',
            status: 'handled',
            action: 'event.import_export.structure_observed',
        });
        expect(channelResult.isOk()).toBe(true);
        expect(channelResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'channel.updated',
            status: 'handled',
            action: 'event.import_export.structure_observed',
        });
        expect(recordStructureObservedEventMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventType: 'role.created',
            targetType: 'role',
            targetId: 'role-1',
        });
        expect(recordStructureObservedEventMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventType: 'channel.updated',
            targetType: 'channel',
            targetId: 'channel-1',
        });
    });

    it('records deleted role structure changes when no cleanup references were changed', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'role.deleted',
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'role.deleted',
            status: 'handled',
            action: 'event.import_export.structure_observed',
        });
        expect(cleanupDeletedGuildRoleReferencesMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            roleId: 'role-1',
        });
        expect(recordStructureObservedEventMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventType: 'role.deleted',
            targetType: 'role',
            targetId: 'role-1',
        });
    });

    it('skips deleted role cleanup when role reconciliation cleanup is disabled', async () => {
        findRoleReconciliationSettingsByGuildIdMock.mockResolvedValueOnce(
            ok(createRoleReconciliationSettingsRecord({ cleanupDeletedRoleReferences: false }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'role.deleted',
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'role.deleted',
            status: 'handled',
            action: 'event.import_export.structure_observed',
        });
        expect(cleanupDeletedGuildRoleReferencesMock).not.toHaveBeenCalled();
        expect(recordStructureObservedEventMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventType: 'role.deleted',
            targetType: 'role',
            targetId: 'role-1',
        });
    });

    it('mode-gates deleted role cleanup', async () => {
        const result = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'role.deleted',
            guildId: 'other',
            roleId: 'role-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'role.deleted',
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(cleanupDeletedGuildRoleReferencesMock).not.toHaveBeenCalled();
    });

    it('returns database-error when deleted role cleanup fails', async () => {
        cleanupDeletedGuildRoleReferencesMock.mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'role.deleted',
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('applies a configured reaction role when a matching reaction is added', async () => {
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValueOnce(ok(createReactionRoleMatch()));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.reaction_roles.assigned',
        });
        expect(memberAddRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
        expect(upsertReactionRoleAssignmentMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
            roleId: 'role-1',
            emojiKey: 'unicode:check',
        });
        expect(messagesSendMock).not.toHaveBeenCalled();
    });

    it('removes a configured reaction role when the reaction is removed', async () => {
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValueOnce(ok(createReactionRoleMatch()));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.removed',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.removed',
            status: 'handled',
            action: 'event.reaction_roles.removed',
        });
        expect(memberRemoveRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
        expect(markReactionRoleAssignmentRemovedMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
        expect(messagesReactMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: 'unicode:check',
        });
    });

    it('ignores bot-owned reaction-role seed reactions', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'bot-user',
            userIsBot: true,
            emojiKey: 'unicode:check',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(findEnabledReactionRoleOptionByReactionMock).not.toHaveBeenCalled();
        expect(memberAddRoleMock).not.toHaveBeenCalled();
        expect(memberRemoveRoleMock).not.toHaveBeenCalled();
        expect(markReactionRoleAssignmentRemovedMock).not.toHaveBeenCalled();
    });

    it('switches exclusive reaction roles by removing previous role and user reaction', async () => {
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValueOnce(
            ok(
                createReactionRoleMatch({
                    message: { mode: 'exclusive' },
                    option: { roleId: 'role-2', emojiKey: 'unicode:new' },
                })
            )
        );
        listActiveReactionRoleAssignmentsByGuildMessageUserMock.mockResolvedValueOnce(
            ok([
                createReactionRoleAssignmentRecord({
                    roleId: 'role-1',
                    emojiKey: 'unicode:old',
                }),
            ])
        );
        memberReadMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:new',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.reaction_roles.assigned',
        });
        expect(memberRemoveRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
        expect(messagesRemoveReactionMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: 'unicode:old',
            userId: 'user-1',
        });
        expect(markReactionRoleAssignmentRemovedMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
        expect(memberAddRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-2',
        });
        expect(upsertReactionRoleAssignmentMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
            roleId: 'role-2',
            emojiKey: 'unicode:new',
        });
    });

    it('returns platform-error when a removed reaction role cannot reseed the menu reaction', async () => {
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValueOnce(ok(createReactionRoleMatch()));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );
        messagesReactMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.removed',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
    });

    it('skips configured reaction roles that are not below the bot highest role', async () => {
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValueOnce(
            ok(
                createReactionRoleMatch({
                    option: {
                        roleId: 'role-high',
                    },
                })
            )
        );
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(memberAddRoleMock).not.toHaveBeenCalled();
        expect(upsertReactionRoleAssignmentMock).not.toHaveBeenCalled();
    });

    it('returns platform-error when a configured reaction role cannot be applied', async () => {
        findEnabledReactionRoleOptionByReactionMock.mockResolvedValueOnce(ok(createReactionRoleMatch()));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );
        memberAddRoleMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
    });

    it('verifies a member when a configured verification reaction is added', async () => {
        findEnabledVerificationFlowByReactionMock.mockResolvedValueOnce(ok(createVerificationFlowRecord()));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.verification.verified',
        });
        expect(memberAddRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
        expect(upsertVerificationRecordMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'user-1',
            method: 'reaction',
        });
    });

    it('skips verification reactions that target roles above the bot highest role', async () => {
        findEnabledVerificationFlowByReactionMock.mockResolvedValueOnce(
            ok(createVerificationFlowRecord({ verifiedRoleId: 'role-high' }))
        );
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'unicode:check',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(memberAddRoleMock).not.toHaveBeenCalled();
        expect(upsertVerificationRecordMock).not.toHaveBeenCalled();
    });

    it('logs message delete events to the configured logging destination', async () => {
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'messages' }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'message.deleted',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            content: 'removed content',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.deleted',
            status: 'handled',
            action: 'event.logging.messages',
        });
        expect(findGuildLoggingDestinationByEventGroupMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventGroup: 'messages',
        });
        const sendInput = getPlatformMessageSendInput();
        const content = getPlatformMessageSendContent();

        expect(sendInput.channelId).toBe('log-channel-1');
        expect(content).toContain('**Message deleted**');
        expect(content).toContain('<#channel-1> (channel-1)');
        expect(content).toContain('<@author-1> (author-1)');
        expect(content).toContain('Message ID: message-1');
        expect(content).toContain('removed content');
    });

    it('ignores loggable events when no logging destination is configured', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'message.deleted',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            content: 'removed content',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.deleted',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(messagesSendMock).not.toHaveBeenCalled();
    });

    it('returns message-send-error when a configured logging destination cannot be written', async () => {
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'messages' }))
        );
        messagesSendMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'message.updated',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: 'new content',
            mentionedUserIds: [],
            oldContent: 'old content',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('message-send-error');
    });

    it('logs member joins after growth tracking records the event', async () => {
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'members' }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.joined',
            status: 'handled',
            action: 'event.logging.members',
        });
        expect(recordGuildMemberFlowEventMock).toHaveBeenCalled();
        expect(getPlatformMessageSendInput().channelId).toBe('log-channel-1');
        expect(getPlatformMessageSendContent()).toContain('**Member joined**');
    });

    it('applies configured autoroles after growth tracking records the member join', async () => {
        listEnabledAutoroleRulesByGuildIdMock.mockResolvedValueOnce(ok([createAutoroleRuleRecord()]));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.joined',
            status: 'handled',
            action: 'event.autorole.member_joined',
        });
        expect(recordGuildMemberFlowEventMock).toHaveBeenCalled();
        expect(guildStructureReadMock).toHaveBeenCalledWith({ guildId: 'guild-1' });
        expect(memberAddRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
    });

    it('skips configured autoroles that are not below the bot highest role', async () => {
        listEnabledAutoroleRulesByGuildIdMock.mockResolvedValueOnce(
            ok([createAutoroleRuleRecord({ roleId: 'role-high' })])
        );
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.joined',
            status: 'handled',
        });
        expect(memberAddRoleMock).not.toHaveBeenCalled();
    });

    it('returns platform-error when a configured autorole cannot be applied', async () => {
        listEnabledAutoroleRulesByGuildIdMock.mockResolvedValueOnce(ok([createAutoroleRuleRecord()]));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );
        memberAddRoleMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
    });

    it('restores verification roles when a verified member rejoins', async () => {
        findActiveVerificationRecordMock.mockResolvedValueOnce(ok(createVerificationRecord()));
        listVerificationFlowsByGuildIdMock.mockResolvedValueOnce(ok([createVerificationFlowRecord()]));
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.joined',
            status: 'handled',
            action: 'event.verification.member_joined',
        });
        expect(memberAddRoleMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });
    });

    it('does not restore verification roles already present on join', async () => {
        findActiveVerificationRecordMock.mockResolvedValueOnce(ok(createVerificationRecord()));
        listVerificationFlowsByGuildIdMock.mockResolvedValueOnce(ok([createVerificationFlowRecord()]));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: ['role-1'],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.joined',
            status: 'handled',
        });
        expect(memberAddRoleMock).not.toHaveBeenCalled();
    });

    it('repairs missing configured roles when a member update removes owned state', async () => {
        listEnabledAutoroleRulesByGuildIdMock.mockResolvedValueOnce(ok([createAutoroleRuleRecord()]));
        findActiveVerificationRecordMock.mockResolvedValueOnce(ok(createVerificationRecord()));
        listVerificationFlowsByGuildIdMock.mockResolvedValueOnce(
            ok([createVerificationFlowRecord({ verifiedRoleId: 'role-2' })])
        );
        listActiveReactionRoleAssignmentsByGuildUserMock.mockResolvedValueOnce(
            ok([
                createReactionRoleAssignmentRecord({
                    roleId: 'role-3',
                }),
            ])
        );
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'bot-user',
                roleIds: ['bot-role'],
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.updated',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.updated',
            status: 'handled',
            action: 'event.role_reconciliation.member_repaired',
        });
        expect(createRoleReconciliationRunMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            summary: {
                userId: 'user-1',
                missingRoleCount: 3,
                repairableRoleCount: 3,
            },
        });
        expect(memberAddRoleMock).toHaveBeenCalledWith({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-1' });
        expect(memberAddRoleMock).toHaveBeenCalledWith({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-2' });
        expect(memberAddRoleMock).toHaveBeenCalledWith({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-3' });
        expect(recordRoleReconciliationActionMock).toHaveBeenCalledWith(testDb, {
            runId: 'role-reconciliation-run-1',
            actionType: 'member.role_restored',
            roleId: 'role-1',
            status: 'applied',
            details: {
                userId: 'user-1',
                sources: ['autorole'],
            },
        });
        expect(updateRoleReconciliationRunStatusMock).toHaveBeenLastCalledWith(testDb, {
            runId: 'role-reconciliation-run-1',
            status: 'applied',
            summary: {
                userId: 'user-1',
                appliedRoleIds: ['role-1', 'role-2', 'role-3'],
            },
        });
    });

    it('skips member role repair when role reconciliation is disabled', async () => {
        findRoleReconciliationSettingsByGuildIdMock.mockResolvedValueOnce(
            ok(createRoleReconciliationSettingsRecord({ enabled: false }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.updated',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.updated',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(listEnabledAutoroleRulesByGuildIdMock).not.toHaveBeenCalled();
        expect(createRoleReconciliationRunMock).not.toHaveBeenCalled();
        expect(memberAddRoleMock).not.toHaveBeenCalled();
    });

    it('does not create reconciliation runs when member roles are already correct', async () => {
        listEnabledAutoroleRulesByGuildIdMock.mockResolvedValueOnce(ok([createAutoroleRuleRecord()]));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'member.updated',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: ['role-1'],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'member.updated',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(createRoleReconciliationRunMock).not.toHaveBeenCalled();
        expect(memberAddRoleMock).not.toHaveBeenCalled();
    });

    it('mode-gates ban reconciliation events before writing cases', async () => {
        const result = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'ban.added',
            guildId: 'other',
            userId: 'target-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'ban.added',
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(findRecentModerationCaseByTargetActionMock).not.toHaveBeenCalled();
        expect(createObservedModerationCaseMock).not.toHaveBeenCalled();
    });

    it('records external ban events as resolved observed moderation cases', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'ban.added',
            guildId: 'guild-1',
            userId: 'target-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'ban.added',
            status: 'handled',
            action: 'event.moderation.ban_added',
        });
        const recentCaseInput = getRecentModerationCaseLookupInput();

        expect(recentCaseInput).toMatchObject({
            guildId: 'guild-1',
            targetUserId: 'target-1',
            action: 'ban',
            statuses: ['open', 'resolved'],
        });
        expect(recentCaseInput.since).toBeInstanceOf(Date);
        expect(createObservedModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'ban',
            targetUserId: 'target-1',
            eventType: 'action.observed',
            details: {
                action: 'ban',
                source: 'fluxer',
                sourceEventType: 'ban.added',
                userId: 'target-1',
            },
        });
    });

    it('logs ban events without replacing the moderation reconciliation action', async () => {
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'moderation' }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'ban.added',
            guildId: 'guild-1',
            userId: 'target-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'ban.added',
            status: 'handled',
            action: 'event.moderation.ban_added',
        });
        expect(getPlatformMessageSendInput().channelId).toBe('log-channel-1');
        expect(getPlatformMessageSendContent()).toContain('**User banned**');
    });

    it('records external unban events as resolved observed moderation cases', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'ban.removed',
            guildId: 'guild-1',
            userId: 'target-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'ban.removed',
            status: 'handled',
            action: 'event.moderation.ban_removed',
        });
        expect(createObservedModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'unban',
            targetUserId: 'target-1',
            eventType: 'action.observed',
            details: {
                action: 'unban',
                source: 'fluxer',
                sourceEventType: 'ban.removed',
                userId: 'target-1',
            },
        });
    });

    it('attaches observed ban events to recent matching command cases instead of creating duplicates', async () => {
        findRecentModerationCaseByTargetActionMock.mockResolvedValueOnce(
            ok(createModerationCaseRecord({ action: 'ban', status: 'open' }))
        );
        listModerationCaseEventsByCaseIdMock.mockResolvedValueOnce(ok([]));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'ban.added',
            guildId: 'guild-1',
            userId: 'target-1',
        });

        expect(result.isOk()).toBe(true);
        expect(createObservedModerationCaseMock).not.toHaveBeenCalled();
        expect(recordModerationCaseEventMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            eventType: 'action.observed',
            details: {
                action: 'ban',
                source: 'fluxer',
                sourceEventType: 'ban.added',
                userId: 'target-1',
            },
        });
    });

    it('does not duplicate observed events on a recent matching case', async () => {
        findRecentModerationCaseByTargetActionMock.mockResolvedValueOnce(
            ok(createModerationCaseRecord({ action: 'ban', status: 'resolved' }))
        );
        listModerationCaseEventsByCaseIdMock.mockResolvedValueOnce(
            ok([
                createModerationCaseEventRecord({
                    eventType: 'action.observed',
                }),
            ])
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'ban.added',
            guildId: 'guild-1',
            userId: 'target-1',
        });

        expect(result.isOk()).toBe(true);
        expect(createObservedModerationCaseMock).not.toHaveBeenCalled();
        expect(recordModerationCaseEventMock).not.toHaveBeenCalled();
    });

    it('returns database-error when ban reconciliation cannot write the observed case', async () => {
        createObservedModerationCaseMock.mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'ban.added',
            guildId: 'guild-1',
            userId: 'target-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('replies to !ping with the no-pong message', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode(), {
                botUserId: undefined,
            }),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
        expect(findGuildSecurityPolicyByGuildIdMock).toHaveBeenCalledWith(testDb, { guildId: 'guild-1' });
    });

    it('does not block command replies when message activity tracking fails', async () => {
        incrementGuildMessageActivityDayMock.mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode(), {
                botUserId: undefined,
            }),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('treats automod enforcement as handled for non-command messages', async () => {
        listEnabledAutomodRulesByGuildIdMock.mockResolvedValueOnce(
            ok([
                createAutomodRuleRecord({
                    id: 'automod-rule-delete',
                    name: 'Delete invites',
                    triggerType: 'invite_links',
                    actionType: 'delete_message',
                    config: {},
                }),
            ])
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: 'join discord.gg/example',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'event.automod.enforced',
        });
        expect(messagesDeleteMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageId: 'message-1',
        });
        expect(updateAutomodEventStatusMock).toHaveBeenCalledWith(
            testDb,
            expect.objectContaining({
                eventId: 'automod-event-1',
                status: 'enforced',
            })
        );
    });

    it('treats ping command casing and whitespace as a ping command', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '  !PiNg  ',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('uses stored guild prefix for ping commands', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('replies to default-prefix help with available command pages', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help');
        expect(getLastReplyContent()).toContain('`!help general`');
        expect(getLastReplyContent()).toContain('`!ping`');
        expect(getLastReplyContent()).toContain('`@NeonFlux prefix ?`');
    });

    it('lists guarded commands in help even when the user cannot run them', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
                authorHasManageServer: false,
                authorIsServerOwner: false,
                authorRoleIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('`@NeonFlux prefix ?`');
        expect(findGuildCommandPermissionRuleMock).not.toHaveBeenCalled();
    });

    it('uses the stored guild prefix in help examples', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?help',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('`?help general`');
        expect(getLastReplyContent()).toContain('`?ping`');
        expect(getLastReplyContent()).not.toContain('`!ping`');
    });

    it('uses the stored guild prefix in category help examples', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?help general',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('`?help [category]`');
        expect(getLastReplyContent()).toContain('`?ping`');
        expect(getLastReplyContent()).not.toContain('`!ping`');
    });

    it('replies to mentioned help before treating the mention as contextless', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> help',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help');
    });

    it('replies with the requested general help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help general',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(getLastReplyContent()).toContain('NeonFlux help: General');
        expect(getLastReplyContent()).toContain('`!help [category]`');
        expect(getLastReplyContent()).toContain('`!ping`');
        expect(getLastReplyContent()).not.toContain('@NeonFlux prefix ?');
    });

    it('replies with the requested settings help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help settings',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(getLastReplyContent()).toContain('NeonFlux help: Settings');
        expect(getLastReplyContent()).toContain('`@NeonFlux prefix ?`');
        expect(getLastReplyContent()).not.toContain('`!ping`');
    });

    it('replies with the requested moderation help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help moderation',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help: Moderation');
        expect(getLastReplyContent()).toContain('`!warn <user> [reason]`');
        expect(getLastReplyContent()).toContain('`!kick <user> [reason]`');
        expect(getLastReplyContent()).toContain('`!ban <user> [reason]`');
        expect(getLastReplyContent()).toContain('`!unban <user> [reason]`');
        expect(getLastReplyContent()).toContain('`!timeout <user> <duration: 1m-28d> [reason]`');
        expect(getLastReplyContent()).toContain('`!untimeout <user> [reason]`');
        expect(getLastReplyContent()).toContain('`!purge <1-100> [reason]`');
    });

    it('replies clearly for unknown help pages', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help nope',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toBe(
            'Unknown help page `nope`.\nTry `!help general`, `!help settings`, `!help moderation`, `!help suggestions`, or `!help xp`.'
        );
    });

    it('replies with the requested suggestions help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help suggestions',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help: Suggestions');
        expect(getLastReplyContent()).toContain('`!suggest <idea>`');
    });

    it('replies with the requested XP help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help xp',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help: XP');
        expect(getLastReplyContent()).toContain('`!rank [user]`');
        expect(getLastReplyContent()).toContain('`!leaderboard`');
    });

    it('replies with the caller XP rank by default', async () => {
        findGuildUserXpRankMock.mockResolvedValueOnce(
            ok({
                userXp: createGuildUserXpRecord({ userId: 'author-1', xp: 125, level: 1 }),
                rank: 3,
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!rank',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.xp.rank',
        });
        expect(findGuildUserXpRankMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'author-1',
        });
        expect(getLastReplyContent()).toContain('Rank: #3');
        expect(getLastReplyContent()).toContain('Total XP: 125 (80 message, 45 voice)');
    });

    it('replies with XP rank for a mentioned user', async () => {
        findGuildUserXpRankMock.mockResolvedValueOnce(
            ok({
                userXp: createGuildUserXpRecord({ userId: 'target-1', xp: 240, level: 1 }),
                rank: 1,
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!rank <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(findGuildUserXpRankMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'target-1',
        });
        expect(getLastReplyContent()).toContain('XP rank for <@target-1>');
    });

    it('lists the XP leaderboard', async () => {
        listGuildXpLeaderboardMock.mockResolvedValueOnce(
            ok([
                createGuildUserXpRecord({ userId: 'user-1', xp: 300, level: 1 }),
                createGuildUserXpRecord({ userId: 'user-2', xp: 180, level: 1 }),
            ])
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!leaderboard',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.xp.leaderboard',
        });
        expect(getLastReplyContent()).toContain('#1 <@user-1> - 300 XP');
        expect(getLastReplyContent()).toContain('#2 <@user-2> - 180 XP');
    });

    it('blocks XP commands in DEFCON 1 unless XP is exempt', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const blockedResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!rank',
                mentionedUserIds: [],
            })
        );

        expect(blockedResult.isOk()).toBe(true);
        expect(blockedResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'defcon-denied',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();

        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.xp]));
        findGuildUserXpRankMock.mockResolvedValueOnce(err({ type: 'not-found' }));

        const exemptResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!rank',
                mentionedUserIds: [],
            })
        );

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.xp.rank',
        });
        expect(getLastReplyContent()).toBe('No XP recorded for <@author-1> yet.');
    });

    it('posts suggestions to the configured board and records the suggestion trace', async () => {
        findDefaultSuggestionBoardByGuildIdMock.mockResolvedValueOnce(ok(createSuggestionBoardRecord()));
        messagesSendMock.mockResolvedValueOnce(
            ok({
                id: 'suggestion-message-1',
                channelId: 'suggestions-channel-1',
                guildId: 'guild-1',
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!suggest Add more neon',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.suggestions.suggest',
        });
        expect(findDefaultSuggestionBoardByGuildIdMock).toHaveBeenCalledWith(testDb, { guildId: 'guild-1' });
        expect(messagesSendMock).toHaveBeenCalledWith({
            channelId: 'suggestions-channel-1',
            embeds: [
                {
                    title: 'Suggestion',
                    description: 'Add more neon',
                    color: 1235140,
                    footer: {
                        text: 'Submitted by author-1',
                    },
                },
            ],
        });
        expect(createSuggestionMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            boardId: 'suggestion-board-1',
            channelId: 'suggestions-channel-1',
            messageId: 'suggestion-message-1',
            authorUserId: 'author-1',
            content: 'Add more neon',
        });
        expect(messagesReactMock).toHaveBeenCalledWith({
            channelId: 'suggestions-channel-1',
            messageId: 'suggestion-message-1',
            emoji: '✅',
        });
        expect(messagesReactMock).toHaveBeenCalledWith({
            channelId: 'suggestions-channel-1',
            messageId: 'suggestion-message-1',
            emoji: '❌',
        });
        expect(getLastReplyContent()).toBe('Suggestion submitted to <#suggestions-channel-1>.');
    });

    it('replies when suggestions are not configured for the guild', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!suggest Add more neon',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.suggestions.suggest',
        });
        expect(messagesSendMock).not.toHaveBeenCalled();
        expect(createSuggestionMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('Suggestions are not configured for this server yet.');
    });

    it('blocks suggestion commands in DEFCON 1 unless suggestions are exempt', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const blockedResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!suggest Add more neon',
                mentionedUserIds: [],
            })
        );

        expect(blockedResult.isOk()).toBe(true);
        expect(blockedResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'defcon-denied',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(messagesSendMock).not.toHaveBeenCalled();

        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.suggestions]));
        findDefaultSuggestionBoardByGuildIdMock.mockResolvedValueOnce(ok(createSuggestionBoardRecord()));

        const exemptResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!suggest Add more neon',
                mentionedUserIds: [],
            })
        );

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.suggestions.suggest',
        });
    });

    it('records suggestion votes from suggestion message reactions', async () => {
        findSuggestionByGuildMessageIdMock.mockResolvedValueOnce(ok(createSuggestionRecord()));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            guildId: 'guild-1',
            channelId: 'suggestions-channel-1',
            messageId: 'suggestion-message-1',
            userId: 'voter-1',
            emojiKey: 'unicode:✅',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.suggestions.vote_updated',
        });
        expect(upsertSuggestionVoteMock).toHaveBeenCalledWith(testDb, {
            suggestionId: 'suggestion-1',
            userId: 'voter-1',
            vote: 'up',
        });
    });

    it('removes suggestion votes when suggestion reactions are removed', async () => {
        findSuggestionByGuildMessageIdMock.mockResolvedValueOnce(ok(createSuggestionRecord()));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.removed',
            guildId: 'guild-1',
            channelId: 'suggestions-channel-1',
            messageId: 'suggestion-message-1',
            userId: 'voter-1',
            emojiKey: 'unicode:❌',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.removed',
            status: 'handled',
            action: 'event.suggestions.vote_removed',
        });
        expect(deleteSuggestionVoteMock).toHaveBeenCalledWith(testDb, {
            suggestionId: 'suggestion-1',
            userId: 'voter-1',
        });
    });

    it('awards message XP for non-command messages when XP is enabled', async () => {
        findXpSettingsByGuildIdMock.mockResolvedValueOnce(ok(createXpSettingsRecord()));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: 'normal chat message',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'event.xp.message_awarded',
        });
        const grantInput = grantGuildUserXpMock.mock.calls[0]?.[1];

        if (!grantInput) {
            throw new Error('Expected XP grant input.');
        }

        expect(typeof grantInput.xp).toBe('number');
        expect(grantInput).toMatchObject({
            guildId: 'guild-1',
            userId: 'author-1',
            source: 'message',
            idempotencyKey: 'message:message-1',
            metadata: {
                channelId: 'channel-1',
                messageId: 'message-1',
            },
        });
    });

    it('skips message XP while the user is cooling down', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-26T00:01:00.000Z').getTime());

        findXpSettingsByGuildIdMock.mockResolvedValueOnce(ok(createXpSettingsRecord({ cooldownSeconds: 120 })));
        findGuildUserXpRankMock.mockResolvedValueOnce(
            ok({
                userXp: createGuildUserXpRecord({
                    lastMessageXpAt: new Date('2026-06-26T00:00:30.000Z'),
                }),
                rank: 1,
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: 'normal chat message',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-not-mentioned',
            status: 'ignored',
        });
        expect(grantGuildUserXpMock).not.toHaveBeenCalled();

        nowSpy.mockRestore();
    });

    it('awards voice XP when a tracked voice session closes', async () => {
        findXpSettingsByGuildIdMock.mockResolvedValueOnce(
            ok(createXpSettingsRecord({ voiceXpPerMinute: 2, voiceMinimumMinutes: 5 }))
        );
        closeXpVoiceSessionMock.mockResolvedValueOnce(
            ok({
                session: createXpVoiceSessionRecord({
                    status: 'closed',
                    endedAt: new Date('2026-06-26T00:06:00.000Z'),
                    creditedSeconds: 360,
                }),
                durationSeconds: 360,
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: null,
            oldChannelId: 'voice-1',
            oldChannelOccupancy: 0,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'voice_state.updated',
            status: 'handled',
            action: 'event.xp.voice_awarded',
        });
        expect(grantGuildUserXpMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'author-1',
            source: 'voice',
            xp: 12,
            voiceSeconds: 360,
            idempotencyKey: 'voice:xp-voice-session-1',
            metadata: {
                channelId: 'voice-1',
                sessionId: 'xp-voice-session-1',
                durationSeconds: 360,
            },
        });
    });

    it('creates and moves members into generated voice channels from configured source channels', async () => {
        findVcGeneratorRuleBySourceChannelIdMock.mockResolvedValueOnce(ok(createVcGeneratorRuleRecord()));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: 'source-voice-1',
            oldChannelId: null,
            oldChannelOccupancy: null,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'voice_state.updated',
            status: 'handled',
            action: 'event.vc_generator.created',
        });
        expect(channelCreateMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            type: 2,
            name: 'author-1 room',
            parentId: 'category-1',
        });
        expect(upsertGeneratedVoiceChannelMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            ruleId: 'vc-rule-1',
            channelId: 'generated-voice-1',
            ownerUserId: 'author-1',
            status: 'active',
        });
        expect(memberMoveMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: 'generated-voice-1',
        });
    });

    it('returns platform-error when generated voice channel creation fails', async () => {
        findVcGeneratorRuleBySourceChannelIdMock.mockResolvedValueOnce(ok(createVcGeneratorRuleRecord()));
        channelCreateMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: 'source-voice-1',
            oldChannelId: null,
            oldChannelOccupancy: null,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
        expect(upsertGeneratedVoiceChannelMock).not.toHaveBeenCalled();
    });

    it('marks generated voice channels orphaned when the member move fails', async () => {
        findVcGeneratorRuleBySourceChannelIdMock.mockResolvedValueOnce(ok(createVcGeneratorRuleRecord()));
        updateGeneratedVoiceChannelStatusMock.mockResolvedValueOnce(
            ok(createGeneratedVoiceChannelRecord({ status: 'orphaned' }))
        );
        memberMoveMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: 'source-voice-1',
            oldChannelId: null,
            oldChannelOccupancy: null,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
        expect(updateGeneratedVoiceChannelStatusMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            channelId: 'generated-voice-1',
            status: 'orphaned',
        });
    });

    it('deletes empty generated voice channels after the last tracked member leaves', async () => {
        findGeneratedVoiceChannelByChannelIdMock.mockResolvedValueOnce(ok(createGeneratedVoiceChannelRecord()));
        updateGeneratedVoiceChannelStatusMock.mockResolvedValueOnce(
            ok(createGeneratedVoiceChannelRecord({ status: 'deleted' }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: null,
            oldChannelId: 'generated-voice-1',
            oldChannelOccupancy: 0,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'voice_state.updated',
            status: 'handled',
            action: 'event.vc_generator.cleaned_up',
        });
        expect(channelDeleteMock).toHaveBeenCalledWith({
            channelId: 'generated-voice-1',
        });
        expect(updateGeneratedVoiceChannelStatusMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            channelId: 'generated-voice-1',
            status: 'deleted',
        });
    });

    it('keeps generated voice channels when tracked occupancy is not empty', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: null,
            oldChannelId: 'generated-voice-1',
            oldChannelOccupancy: 1,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'voice_state.updated',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(channelDeleteMock).not.toHaveBeenCalled();
        expect(updateGeneratedVoiceChannelStatusMock).not.toHaveBeenCalled();
    });

    it('does not mark generated voice channels deleted when cleanup deletion fails', async () => {
        findGeneratedVoiceChannelByChannelIdMock.mockResolvedValueOnce(ok(createGeneratedVoiceChannelRecord()));
        channelDeleteMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'author-1',
            channelId: null,
            oldChannelId: 'generated-voice-1',
            oldChannelOccupancy: 0,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
        expect(updateGeneratedVoiceChannelStatusMock).not.toHaveBeenCalled();
    });

    it('marks generated voice channels deleted when Fluxer reports channel deletion', async () => {
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'channels' }))
        );
        updateGeneratedVoiceChannelStatusMock.mockResolvedValueOnce(
            ok(createGeneratedVoiceChannelRecord({ status: 'deleted' }))
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'channel.deleted',
            guildId: 'guild-1',
            channelId: 'generated-voice-1',
            channelType: 2,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'channel.deleted',
            status: 'handled',
            action: 'event.vc_generator.deleted',
        });
        expect(updateGeneratedVoiceChannelStatusMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            channelId: 'generated-voice-1',
            status: 'deleted',
        });
        expect(findGuildLoggingDestinationByEventGroupMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventGroup: 'channels',
        });
        expect(getPlatformMessageSendInput().channelId).toBe('log-channel-1');
        expect(getPlatformMessageSendContent()).toContain('**Channel deleted**');
        expect(getPlatformMessageSendContent()).toContain('Channel ID: generated-voice-1');
    });

    it('starts a pending VC generator control request from panel reactions', async () => {
        findVcGeneratorControlPanelByMessageIdMock.mockResolvedValueOnce(ok(createVcGeneratorControlPanelRecord()));
        findActiveGeneratedVoiceChannelByOwnerMock.mockResolvedValueOnce(ok(createGeneratedVoiceChannelRecord()));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'panel-message-1',
            channelId: 'panel-channel-1',
            guildId: 'guild-1',
            userId: 'author-1',
            emojiKey: 'unicode:✏️',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.vc_generator.control_requested',
        });
        const controlRequestInput = createVcGeneratorControlRequestMock.mock.calls.at(-1)?.[1];

        expect(controlRequestInput).toMatchObject({
            guildId: 'guild-1',
            generatedChannelId: 'generated-voice-row-1',
            panelChannelId: 'panel-channel-1',
            targetChannelId: 'generated-voice-1',
            requesterUserId: 'author-1',
            controlAction: 'rename',
        });
        expect(controlRequestInput?.expiresAt).toBeInstanceOf(Date);
        expect(getPlatformMessageSendInput()).toMatchObject({ channelId: 'panel-channel-1' });
        expect(getPlatformMessageSendContent()).toContain('new name');
        expect(channelEditMock).not.toHaveBeenCalled();
    });

    it('applies VC generator rename responses before normal message commands', async () => {
        findPendingVcGeneratorControlRequestMock.mockResolvedValueOnce(
            ok(createVcGeneratorControlRequestRecord({ controlAction: 'rename' }))
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                channelId: 'panel-channel-1',
                content: '!help but actually room name',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'event.vc_generator.control_applied',
        });
        expect(channelEditMock).toHaveBeenCalledWith({
            channelId: 'generated-voice-1',
            name: '!help but actually room name',
        });
        expect(updateVcGeneratorControlRequestMock).toHaveBeenCalledWith(testDb, {
            requestId: 'vc-control-request-1',
            status: 'applied',
            value: '!help but actually room name',
        });
        expect(getPlatformMessageSendInput()).toMatchObject({ channelId: 'panel-channel-1' });
        expect(getPlatformMessageSendContent()).toContain('Renamed');
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('applies immediate VC generator lock controls', async () => {
        findVcGeneratorControlPanelByMessageIdMock.mockResolvedValueOnce(ok(createVcGeneratorControlPanelRecord()));
        findActiveGeneratedVoiceChannelByOwnerMock.mockResolvedValueOnce(ok(createGeneratedVoiceChannelRecord()));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'panel-message-1',
            channelId: 'panel-channel-1',
            guildId: 'guild-1',
            userId: 'author-1',
            emojiKey: 'unicode:🔒',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.vc_generator.control_applied',
        });
        expect(channelEditPermissionMock).toHaveBeenCalledWith({
            channelId: 'generated-voice-1',
            overwriteId: 'guild-1',
            type: 0,
            deny: '1048576',
        });
        expect(updateVcGeneratorControlRequestMock).toHaveBeenCalledWith(testDb, {
            requestId: 'vc-control-request-1',
            status: 'applied',
        });
    });

    it('fails invalid VC generator control responses without mutating channels', async () => {
        findPendingVcGeneratorControlRequestMock.mockResolvedValueOnce(
            ok(createVcGeneratorControlRequestRecord({ controlAction: 'user_limit' }))
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                channelId: 'panel-channel-1',
                content: 'many',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'event.vc_generator.control_failed',
        });
        expect(channelEditMock).not.toHaveBeenCalled();
        expect(updateVcGeneratorControlRequestMock).toHaveBeenCalledWith(testDb, {
            requestId: 'vc-control-request-1',
            status: 'failed',
            errorMessage: 'User limit must be a whole number from 0 to 99.',
        });
    });

    it('opens tickets from configured ticket panel reactions', async () => {
        createTicketMock.mockResolvedValueOnce(ok(createTicketRecord({ channelId: null })));
        findEnabledTicketPanelByMessageIdMock.mockResolvedValueOnce(ok(createTicketPanelRecord()));
        updateTicketChannelIdMock.mockResolvedValueOnce(ok(createTicketRecord({ channelId: 'ticket-channel-1' })));
        channelCreateMock.mockResolvedValueOnce(
            ok({
                id: 'ticket-channel-1',
                guildId: 'guild-1',
            })
        );

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'ticket-panel-message-1',
            channelId: 'ticket-panel-channel-1',
            guildId: 'guild-1',
            userId: 'author-1',
            emojiKey: 'unicode:🎫',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.tickets.opened',
        });
        expect(createTicketMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            ticketNumber: 1,
            openerUserId: 'author-1',
            panelId: 'ticket-panel-1',
        });
        expect(addTicketMemberMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            userId: 'author-1',
            role: 'opener',
        });
        expect(channelCreateMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            type: 0,
            name: 'ticket-1',
            parentId: 'ticket-category-1',
        });
        expect(updateTicketChannelIdMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            channelId: 'ticket-channel-1',
        });
        expect(channelEditPermissionMock).toHaveBeenCalledWith({
            channelId: 'ticket-channel-1',
            overwriteId: 'guild-1',
            type: 0,
            deny: '1024',
        });
        expect(channelEditPermissionMock).toHaveBeenCalledWith({
            channelId: 'ticket-channel-1',
            overwriteId: 'author-1',
            type: 1,
            allow: '68608',
        });
        expect(channelEditPermissionMock).toHaveBeenCalledWith({
            channelId: 'ticket-channel-1',
            overwriteId: 'support-role-1',
            type: 0,
            allow: '68608',
        });
        expect(messagesSendMock).toHaveBeenCalledWith({
            channelId: 'ticket-channel-1',
            content: '<@author-1> Ticket #1 opened.',
        });
        expect(recordTicketEventMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            eventType: 'opened',
            actorUserId: 'author-1',
            details: {
                channelId: 'ticket-channel-1',
                panelId: 'ticket-panel-1',
            },
        });
    });

    it('does not open another ticket when the panel max is already reached for the user', async () => {
        findEnabledTicketPanelByMessageIdMock.mockResolvedValueOnce(ok(createTicketPanelRecord()));
        listOpenTicketsByPanelAndOpenerMock.mockResolvedValueOnce(ok([createTicketRecord()]));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'ticket-panel-message-1',
            channelId: 'ticket-panel-channel-1',
            guildId: 'guild-1',
            userId: 'author-1',
            emojiKey: 'unicode:🎫',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'handled',
            action: 'event.tickets.open_existing',
        });
        expect(channelCreateMock).not.toHaveBeenCalled();
        expect(createTicketMock).not.toHaveBeenCalled();
    });

    it('archives the ticket row when opening the server channel fails', async () => {
        createTicketMock.mockResolvedValueOnce(ok(createTicketRecord({ channelId: null })));
        findEnabledTicketPanelByMessageIdMock.mockResolvedValueOnce(ok(createTicketPanelRecord()));
        channelCreateMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'ticket-panel-message-1',
            channelId: 'ticket-panel-channel-1',
            guildId: 'guild-1',
            userId: 'author-1',
            emojiKey: 'unicode:🎫',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('platform-error');
        expect(updateTicketStatusMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            status: 'archived',
        });
        expect(recordTicketEventMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            eventType: 'open.failed',
            details: {
                reason: 'channel-create-failed',
            },
        });
        expect(updateTicketChannelIdMock).not.toHaveBeenCalled();
    });

    it('closes tickets when their server channel is deleted', async () => {
        findGuildLoggingDestinationByEventGroupMock.mockResolvedValueOnce(
            ok(createLoggingDestinationRecord({ eventGroup: 'channels' }))
        );
        findTicketByChannelIdMock.mockResolvedValueOnce(ok(createTicketRecord({ channelId: 'ticket-channel-1' })));
        updateTicketStatusMock.mockResolvedValueOnce(ok(createTicketRecord({ status: 'closed' })));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'channel.deleted',
            guildId: 'guild-1',
            channelId: 'ticket-channel-1',
            channelType: 0,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'channel.deleted',
            status: 'handled',
            action: 'event.tickets.channel_deleted',
        });
        expect(updateTicketStatusMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            status: 'closed',
        });
        expect(recordTicketEventMock).toHaveBeenCalledWith(testDb, {
            ticketId: 'ticket-1',
            eventType: 'channel.deleted',
            details: {
                channelId: 'ticket-channel-1',
            },
        });
        expect(findGuildLoggingDestinationByEventGroupMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventGroup: 'channels',
        });
        expect(getPlatformMessageSendInput().channelId).toBe('log-channel-1');
        expect(getPlatformMessageSendContent()).toContain('**Channel deleted**');
        expect(getPlatformMessageSendContent()).toContain('Channel ID: ticket-channel-1');
    });

    it('records a warning case through the configured prefix', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!warn <@target-1> repeated spam',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.warn',
        });
        expect(createModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'warn',
            targetUserId: 'target-1',
            actorUserId: 'author-1',
            reason: 'repeated spam',
        });
        expect(getLastReplyContent()).toBe('Warning #1 recorded for <@target-1>.');
    });

    it('bans users through the platform and resolves the moderation case', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!ban <@target-1> raid account',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.ban',
        });
        expect(createModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'ban',
            targetUserId: 'target-1',
            actorUserId: 'author-1',
            reason: 'raid account',
        });
        expect(createFluxerPlatformMock).toHaveBeenCalledWith(testClient);
        expect(moderationBanMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'target-1',
            reason: 'raid account',
        });
        expect(recordModerationCaseEventMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            eventType: 'action.applied',
            actorUserId: 'author-1',
            details: {
                action: 'ban',
            },
        });
        expect(updateModerationCaseStatusMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            status: 'resolved',
        });
        expect(getLastReplyContent()).toBe('Ban recorded as case #1 for <@target-1>.');
    });

    it('voids the moderation case when a platform punishment fails', async () => {
        moderationKickMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!kick <@target-1> raid account',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.kick',
        });
        expect(moderationKickMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'target-1',
        });
        expect(recordModerationCaseEventMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            eventType: 'action.failed',
            actorUserId: 'author-1',
            details: {
                action: 'kick',
                errorType: 'permission-denied',
            },
        });
        expect(voidModerationCaseMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            actorUserId: 'author-1',
            reason: 'Fluxer action failed: permission-denied',
        });
        expect(updateModerationCaseStatusMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe(
            'Kick failed for <@target-1>. Case #1 was voided: NeonFlux is missing permission for that action.'
        );
    });

    it('blocks punishment commands against protected users before creating a case', async () => {
        findGuildModerationPolicyByGuildIdMock.mockResolvedValueOnce(
            ok(createModerationPolicyRecord({ protectedUserIds: ['target-1'] }))
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!ban <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.ban',
        });
        expect(createModerationCaseMock).not.toHaveBeenCalled();
        expect(moderationBanMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('That user is protected by the moderation policy. No ban was applied.');
    });

    it('blocks punishment commands against protected roles before creating a case', async () => {
        findGuildModerationPolicyByGuildIdMock.mockResolvedValueOnce(
            ok(createModerationPolicyRecord({ protectedRoleIds: ['role-protected'] }))
        );
        memberReadMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                userId: 'target-1',
                roleIds: ['role-protected'],
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!kick <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(createModerationCaseMock).not.toHaveBeenCalled();
        expect(moderationKickMock).not.toHaveBeenCalled();
        expect(memberReadMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'target-1',
        });
        expect(getLastReplyContent()).toBe(
            "That user's role is protected by the moderation policy. No kick was applied."
        );
    });

    it('unbans users without treating unban as ban', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!unban target-1 appeal accepted',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.unban',
        });
        expect(createModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'unban',
            targetUserId: 'target-1',
            actorUserId: 'author-1',
            reason: 'appeal accepted',
        });
        expect(moderationUnbanMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'target-1',
        });
        expect(moderationBanMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('Unban recorded as case #1 for <@target-1>.');
    });

    it('times out users through the platform and tracks the pending expiry', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-26T10:00:00.000Z').getTime());

        try {
            const result = await routeBotFeatureEvent(
                createContext(createMultiMode()),
                createMessageEvent({
                    authorHasManageServer: true,
                    content: '!timeout <@target-1> 2h cool down',
                    mentionedUserIds: ['target-1'],
                })
            );

            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap()).toStrictEqual({
                eventType: 'message.created',
                status: 'handled',
                action: 'command.moderation.timeout',
            });
            expect(createModerationCaseMock).toHaveBeenCalledWith(testDb, {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'target-1',
                actorUserId: 'author-1',
                reason: 'cool down',
            });
            expect(moderationTimeoutMock).toHaveBeenCalledWith({
                guildId: 'guild-1',
                userId: 'target-1',
                expiresAt: new Date('2026-06-26T12:00:00.000Z'),
                reason: 'cool down',
            });
            expect(recordModerationCaseEventMock).toHaveBeenCalledWith(testDb, {
                caseId: 'case-1',
                eventType: 'action.applied',
                actorUserId: 'author-1',
                details: {
                    action: 'timeout',
                    expiresAt: '2026-06-26T12:00:00.000Z',
                },
            });
            expect(createModerationTemporaryActionMock).toHaveBeenCalledWith(testDb, {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'target-1',
                expiresAt: new Date('2026-06-26T12:00:00.000Z'),
                caseId: 'case-1',
            });
            expect(cancelPendingModerationTemporaryActionsByTargetMock).toHaveBeenCalledWith(testDb, {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'target-1',
                excludeId: 'temporary-action-1',
            });
            expect(updateModerationCaseStatusMock).toHaveBeenCalledWith(testDb, {
                caseId: 'case-1',
                status: 'resolved',
            });
            expect(getLastReplyContent()).toBe(
                'Timeout recorded as case #1 for <@target-1>. Expires <t:1782475200:f>.'
            );
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('removes timeouts and cancels pending timeout expiry tracking', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!untimeout <@target-1> served',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.untimeout',
        });
        expect(createModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'untimeout',
            targetUserId: 'target-1',
            actorUserId: 'author-1',
            reason: 'served',
        });
        expect(moderationUntimeoutMock).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'target-1',
            reason: 'served',
        });
        expect(createModerationTemporaryActionMock).not.toHaveBeenCalled();
        expect(cancelPendingModerationTemporaryActionsByTargetMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'timeout',
            targetUserId: 'target-1',
        });
        expect(getLastReplyContent()).toBe('Untimeout recorded as case #1 for <@target-1>.');
    });

    it('replies with timeout usage for invalid durations after authorization', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!timeout <@target-1> 29d too long',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(createModerationCaseMock).not.toHaveBeenCalled();
        expect(moderationTimeoutMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('Use: `!timeout <user> <duration: 1m-28d> [reason]`.');
    });

    it('purges recent channel messages and resolves a channel-targeted moderation case', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!purge 2 spam cleanup',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.purge',
        });
        expect(messagesFetchManyMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            limit: 2,
            before: 'message-1',
        });
        expect(createChannelModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'purge',
            targetChannelId: 'channel-1',
            actorUserId: 'author-1',
            reason: 'spam cleanup',
        });
        expect(messagesBulkDeleteMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageIds: ['message-3', 'message-2'],
        });
        expect(recordModerationCaseEventMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            eventType: 'action.applied',
            actorUserId: 'author-1',
            details: {
                action: 'purge',
                channelId: 'channel-1',
                requestedCount: 2,
                deletedCount: 2,
            },
        });
        expect(updateModerationCaseStatusMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            status: 'resolved',
        });
        expect(getLastReplyContent()).toBe(
            'Purge recorded as case #1. Deleted 2 of 2 requested message(s) in <#channel-1>.'
        );
    });

    it('does not create a purge case when no recent messages match', async () => {
        messagesFetchManyMock.mockResolvedValueOnce(ok([]));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!purge 5',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(createChannelModerationCaseMock).not.toHaveBeenCalled();
        expect(messagesBulkDeleteMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('No recent messages were found before this command.');
    });

    it('voids the purge case when bulk deletion fails', async () => {
        messagesBulkDeleteMock.mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!purge 2',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(recordModerationCaseEventMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            eventType: 'action.failed',
            actorUserId: 'author-1',
            details: {
                action: 'purge',
                channelId: 'channel-1',
                errorType: 'permission-denied',
                requestedCount: 2,
                matchedCount: 2,
            },
        });
        expect(voidModerationCaseMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            actorUserId: 'author-1',
            reason: 'Fluxer bulk delete failed: permission-denied',
        });
        expect(updateModerationCaseStatusMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe(
            'Purge failed. Case #1 was voided: NeonFlux is missing permission for that action.'
        );
    });

    it('replies with purge usage for invalid counts after authorization', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!purge 101',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(createChannelModerationCaseMock).not.toHaveBeenCalled();
        expect(messagesBulkDeleteMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('Use: `!purge <1-100> [reason]`.');
    });

    it('does not call Fluxer when punishment case creation fails', async () => {
        createModerationCaseMock.mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!ban <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(moderationBanMock).not.toHaveBeenCalled();
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('allows a command-specific grant to run a ban command', async () => {
        findGuildCommandPermissionRuleMock.mockImplementation((_db, input) => {
            if (input.targetType === 'command' && input.targetId === 'moderation.ban') {
                return Promise.resolve(
                    ok({
                        guildId: 'guild-1',
                        targetType: 'command',
                        targetId: 'moderation.ban',
                        userIds: ['author-1'],
                        roleIds: [],
                        createdAt: new Date('2026-06-24T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
                    })
                );
            }

            return Promise.resolve(err('not-found'));
        });

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!ban <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            status: 'handled',
            action: 'command.moderation.ban',
        });
        expect(moderationBanMock).toHaveBeenCalled();
    });

    it('uses the stored prefix for moderation commands', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '?warn <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            status: 'handled',
            action: 'command.moderation.warn',
        });
        expect(createModerationCaseMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            action: 'warn',
            targetUserId: 'target-1',
            actorUserId: 'author-1',
        });
    });

    it('denies moderation commands without Manage Server, owner, or command grants', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!warn <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.moderation.warn',
        });
        expect(createModerationCaseMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toContain('You cannot run moderation commands here.');
    });

    it('allows a moderation category grant to run warning commands', async () => {
        findGuildCommandPermissionRuleMock.mockImplementation((_db, input) => {
            if (input.targetType === 'category' && input.targetId === 'moderation') {
                return Promise.resolve(
                    ok({
                        guildId: 'guild-1',
                        targetType: 'category',
                        targetId: 'moderation',
                        userIds: [],
                        roleIds: ['mod-role'],
                        createdAt: new Date('2026-06-24T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
                    })
                );
            }

            return Promise.resolve(err('not-found'));
        });

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorRoleIds: ['mod-role'],
                content: '!warn <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(createModerationCaseMock).toHaveBeenCalled();
    });

    it('replies with moderation command usage after authorization', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!warn',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(createModerationCaseMock).not.toHaveBeenCalled();
        expect(getLastReplyContent()).toBe('Use: `!warn <user> [reason]`.');
    });

    it('lists warning cases for a user', async () => {
        listModerationCasesByGuildIdMock.mockResolvedValueOnce(
            ok([
                createModerationCaseRecord({
                    caseNumber: 2,
                    targetUserId: 'target-1',
                    reason: 'Second warning',
                }),
                createModerationCaseRecord({
                    caseNumber: 1,
                    targetUserId: 'target-1',
                    reason: 'First warning',
                }),
            ])
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!warnings <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(listModerationCasesByGuildIdMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetUserId: 'target-1',
            action: 'warn',
            limit: 10,
        });
        expect(getLastReplyContent()).toContain('Warnings for <@target-1>:');
        expect(getLastReplyContent()).toContain('#2 warn <@target-1> (open) - Second warning');
    });

    it('voids one warning case through delwarn', async () => {
        findModerationCaseByGuildCaseNumberMock.mockResolvedValueOnce(
            ok(createModerationCaseRecord({ caseNumber: 2 }))
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!delwarn 2 duplicate',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(voidModerationCaseMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            actorUserId: 'author-1',
            reason: 'duplicate',
        });
        expect(getLastReplyContent()).toBe('Warning #2 deleted.');
    });

    it('clears open warning cases for a user', async () => {
        listModerationCasesByGuildIdMock.mockResolvedValueOnce(
            ok([
                createModerationCaseRecord({ id: 'case-1', caseNumber: 2 }),
                createModerationCaseRecord({ id: 'case-2', caseNumber: 1 }),
            ])
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!clearwarn <@target-1> stale warnings',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(listModerationCasesByGuildIdMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetUserId: 'target-1',
            action: 'warn',
            status: 'open',
            limit: 100,
        });
        expect(voidModerationCaseMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            actorUserId: 'author-1',
            reason: 'stale warnings',
        });
        expect(voidModerationCaseMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-2',
            actorUserId: 'author-1',
            reason: 'stale warnings',
        });
        expect(getLastReplyContent()).toBe('Cleared 2 warning(s) for <@target-1>.');
    });

    it('updates case reasons and stores case notes', async () => {
        const reasonResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!reason 1 updated reason',
                mentionedUserIds: [],
            })
        );
        const noteResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!note 1 internal context',
                mentionedUserIds: [],
            })
        );

        expect(reasonResult.isOk()).toBe(true);
        expect(noteResult.isOk()).toBe(true);
        expect(updateModerationCaseReasonMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            actorUserId: 'author-1',
            reason: 'updated reason',
        });
        expect(addModerationCaseNoteMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            actorUserId: 'author-1',
            note: 'internal context',
        });
    });

    it('lists case notes without exposing unrelated case events', async () => {
        listModerationCaseEventsByCaseIdMock.mockResolvedValueOnce(
            ok([
                createModerationCaseEventRecord({
                    actorUserId: 'mod-1',
                    details: { note: 'first note' },
                }),
            ])
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!notes 1',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(listModerationCaseEventsByCaseIdMock).toHaveBeenCalledWith(testDb, {
            caseId: 'case-1',
            eventType: 'note.added',
            limit: 10,
        });
        expect(getLastReplyContent()).toBe('Notes for case #1:\n- <@mod-1>: first note');
    });

    it('keeps guarded moderation commands owner-only in DEFCON 2', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                defconLevel: 2,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const managerResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '!warn <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );
        const ownerResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorId: 'owner-1',
                authorIsServerOwner: true,
                content: '!warn <@target-1>',
                mentionedUserIds: ['target-1'],
            })
        );

        expect(managerResult.isOk()).toBe(true);
        expect(ownerResult.isOk()).toBe(true);
        expect(createModerationCaseMock).toHaveBeenCalledTimes(1);
    });

    it('blocks help in DEFCON 1 unless the help category is exempt', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const blockedResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(blockedResult.isOk()).toBe(true);
        expect(blockedResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'defcon-denied',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();

        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.help]));

        const exemptResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledOnce();
    });

    it('uses single-mode guild gating before replying to help', async () => {
        const ignoredResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                content: '!help',
                guildId: 'other',
                mentionedUserIds: [],
            })
        );

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'guild-not-processable',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildCommandSettingsByGuildIdMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                content: '!help',
                guildId: 'target',
                mentionedUserIds: [],
            })
        );

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
    });

    it('ignores the default prefix when the guild has a stored custom prefix', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-not-mentioned',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('changes the guild prefix when the server owner mentions the bot with prefix command', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?',
        });
        expect(recordBotActionEventMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            feature: 'settings',
            action: 'command_prefix.updated',
            actorUserId: 'author-1',
            targetId: 'settings.prefix',
            metadata: {
                prefix: '?',
                source: 'bot-command',
            },
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix updated to `?`.',
        });
    });

    it('does not persist when the requested prefix is already the effective default prefix', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix !',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
        expect(recordBotActionEventMock).not.toHaveBeenCalled();
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix is already `!`.',
        });
    });

    it('does not persist when the requested prefix is already the stored guild prefix', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
        expect(recordBotActionEventMock).not.toHaveBeenCalled();
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix is already `?`.',
        });
    });

    it('can replace invalid stored prefix config with a valid prefix', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(err('invalid-config'));
        upsertGuildCommandPrefixMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?',
        });
    });

    it('changes the guild prefix when an authorized manager mentions the bot with prefix command', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '<@bot-user> prefix $',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '$',
        });
    });

    it('changes the guild prefix when an allowed role grant authorizes the command', async () => {
        findGuildCommandPermissionRuleMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                targetType: 'category',
                targetId: 'settings',
                userIds: [],
                roleIds: ['role-1'],
                createdAt: new Date('2026-06-24T00:00:00.000Z'),
                updatedAt: new Date('2026-06-24T00:00:00.000Z'),
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorRoleIds: ['role-1'],
                content: '<@bot-user> prefix %',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '%',
        });
    });

    it('changes the guild prefix when a command category grant authorizes the command', async () => {
        findGuildCommandPermissionRuleMock.mockImplementation((_db, input) => {
            if (input.targetType === 'category' && input.targetId === 'settings') {
                return Promise.resolve(
                    ok({
                        guildId: 'guild-1',
                        targetType: 'category',
                        targetId: 'settings',
                        userIds: [],
                        roleIds: ['role-1'],
                        createdAt: new Date('2026-06-24T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
                    })
                );
            }

            return Promise.resolve(err('not-found'));
        });

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorRoleIds: ['role-1'],
                content: '<@bot-user> prefix %',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '%',
        });
    });

    it('keeps legacy prefix category grants working after target-based command grants', async () => {
        findGuildCommandPermissionRuleMock.mockImplementation((_db, input) => {
            if (input.targetType === 'category' && input.targetId === DEFCON_FEATURE_CATEGORY.prefix) {
                return Promise.resolve(
                    ok({
                        guildId: 'guild-1',
                        targetType: 'category',
                        targetId: DEFCON_FEATURE_CATEGORY.prefix,
                        userIds: ['author-1'],
                        roleIds: [],
                        createdAt: new Date('2026-06-24T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
                    })
                );
            }

            return Promise.resolve(err('not-found'));
        });

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> prefix %',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(findGuildCommandPermissionRuleMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: 'settings.prefix',
        });
        expect(findGuildCommandPermissionRuleMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetType: 'category',
            targetId: 'settings',
        });
        expect(findGuildCommandPermissionRuleMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetType: 'category',
            targetId: DEFCON_FEATURE_CATEGORY.prefix,
        });
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '%',
        });
    });

    it('changes the guild prefix when the prefix mixes symbols and numbers after the first character', async () => {
        upsertGuildCommandPrefixMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?1')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?1',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?1',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix updated to `?1`.',
        });
    });

    it('uses stored guild prefix with letters or numbers after the first symbol for ping commands', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?1')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?1ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it.each(['a', '1', '....', '\u200b', '/', '@', '#', '<', '>', ':'])(
        'replies clearly for invalid prefix %j',
        async (prefix) => {
            upsertGuildCommandPrefixMock.mockResolvedValueOnce(err('invalid-prefix'));

            const result = await routeBotFeatureEvent(
                createContext(createMultiMode()),
                createMessageEvent({
                    authorIsServerOwner: true,
                    content: `<@bot-user> prefix ${prefix}`,
                    mentionedUserIds: ['bot-user'],
                })
            );

            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap()).toStrictEqual({
                eventType: 'message.created',
                status: 'handled',
                action: 'commands.prefix_change',
            });
            expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
                client: testClient,
                channelId: 'channel-1',
                content: COMMAND_PREFIX_INVALID_MESSAGE,
            });
            expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
        }
    );

    it('replies with usage when the prefix command omits a new prefix', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: `Use: mention me with \`prefix ?\`. ${COMMAND_PREFIX_INVALID_MESSAGE}`,
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
    });

    it('rejects prefix changes outside guilds with a clear reply', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                guildId: null,
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'I can only change the prefix inside a community.',
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
    });

    it('denies prefix changes for unauthorized users', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content:
                'You cannot change the prefix here. In lockdown, only the server owner can change guarded settings. Otherwise, this command requires Manage Server or an allowed role/user rule.',
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
    });

    it.each([1, 2] as const)('allows only the server owner to change prefix in DEFCON %s', async (defconLevel) => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                defconLevel,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const managerResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(managerResult.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();

        const ownerResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorId: 'owner-1',
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(ownerResult.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?',
        });
    });

    it('returns database-error when stored prefix lookup fails', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('returns database-error when help prefix lookup fails', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('returns database-error when prefix persistence fails', async () => {
        upsertGuildCommandPrefixMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix $',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(recordBotActionEventMock).not.toHaveBeenCalled();
    });

    it('returns database-error when prefix audit recording fails', async () => {
        recordBotActionEventMock.mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix $',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '$',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('escalates contextless bot mention replies before cooldown', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-23T20:00:00.000Z').getTime());
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-1';

        for (const content of [
            "I predominantly dislike it when people think that saying someone's name just to see if they're there is proper communication. Just say what's on your mind please",
            "I don't appreciate being called for nothing",
            'I will no longer respond to that...',
        ]) {
            const result = await routeBotFeatureEvent(
                context,
                createMessageEvent({
                    authorId,
                    content: '<@bot-user>',
                    mentionedUserIds: ['bot-user'],
                })
            );

            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap()).toStrictEqual({
                eventType: 'message.created',
                status: 'handled',
                action: 'bot_mention.contextless_reply',
            });
            expect(sendFluxerChannelMessageMock).toHaveBeenLastCalledWith({
                client: testClient,
                channelId: 'channel-1',
                content,
            });
        }

        nowSpy.mockRestore();
    });

    it('ignores contextless bot mentions during cooldown', async () => {
        const startedAt = new Date('2026-06-23T20:00:00.000Z').getTime();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-2';

        for (let index = 0; index < 3; index += 1) {
            await routeBotFeatureEvent(
                context,
                createMessageEvent({
                    authorId,
                    content: '<@bot-user>',
                    mentionedUserIds: ['bot-user'],
                })
            );
        }

        const result = await routeBotFeatureEvent(
            context,
            createMessageEvent({
                authorId,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'contextless-mention-cooldown',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledTimes(3);

        nowSpy.mockRestore();
    });

    it('reminds after contextless mention cooldown expires and starts another cooldown', async () => {
        const startedAt = new Date('2026-06-23T20:00:00.000Z').getTime();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-3';

        for (let index = 0; index < 3; index += 1) {
            await routeBotFeatureEvent(
                context,
                createMessageEvent({
                    authorId,
                    content: '<@bot-user>',
                    mentionedUserIds: ['bot-user'],
                })
            );
        }

        nowSpy.mockReturnValue(startedAt + 5 * 60 * 1000);

        const reminderResult = await routeBotFeatureEvent(
            context,
            createMessageEvent({
                authorId,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(reminderResult.isOk()).toBe(true);
        expect(reminderResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'bot_mention.contextless_reply',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenLastCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "We've been here before... back to ignoring I suppose",
        });

        const ignoredResult = await routeBotFeatureEvent(
            context,
            createMessageEvent({
                authorId,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'contextless-mention-cooldown',
            status: 'ignored',
        });

        nowSpy.mockRestore();
    });

    it('ignores messages that do not mention the bot', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                mentionedUserIds: ['other-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-not-mentioned',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('ignores bot mentions when the message includes context', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> please help with logging',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-mentioned-with-context',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('ignores bot-authored mention messages', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsBot: true,
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-authored-message',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('uses single-mode guild gating before replying to mentions', async () => {
        const ignoredResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                guildId: 'other',
            })
        );

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'guild-not-processable',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                content: '!ping',
                guildId: 'target',
                mentionedUserIds: [],
            })
        );

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('ignores mention messages when the bot user id is unavailable', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode(), { botUserId: undefined }), {
            ...createMessageEvent(),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-user-unavailable',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('allows public bot mentions in development DEFCON 2 default', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode(), {
                appEnv: 'development',
                guildDefconOverride: 'auto',
            }),
            createMessageEvent()
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'bot_mention.contextless_reply',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledOnce();
    });

    it('blocks public bot mentions in DEFCON 1 unless the category is exempt', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const blockedResult = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(blockedResult.isOk()).toBe(true);
        expect(blockedResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'defcon-denied',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();

        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.botMention]));

        const exemptResult = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'bot_mention.contextless_reply',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledOnce();
    });

    it('returns database-error when bot mention DEFCON lookup fails', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('returns message-send-error when the mention reply cannot be sent', async () => {
        sendFluxerChannelMessageMock.mockResolvedValueOnce(err({ type: 'send-failed', error: new Error('no access') }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('message-send-error');
    });

    it('returns message-send-error when the help reply cannot be sent', async () => {
        sendFluxerChannelMessageMock.mockResolvedValueOnce(err({ type: 'send-failed', error: new Error('no access') }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('message-send-error');
    });
});

function createContext(
    mode: AppMode,
    options: {
        botUserId?: string | undefined;
        appEnv?: BotFeatureHandlerContext['appEnv'];
        guildDefconOverride?: BotFeatureHandlerContext['guildDefconOverride'];
    } = {}
): BotFeatureHandlerContext {
    const botUserId = 'botUserId' in options ? options.botUserId : 'bot-user';

    return {
        db: testDb,
        mode,
        appEnv: options.appEnv ?? 'production',
        guildDefconOverride: options.guildDefconOverride ?? 'auto',
        client: testClient,
        ...(botUserId ? { botUserId } : {}),
    };
}

function createSingleMode(): AppMode {
    return {
        instanceMode: 'single',
        singleGuildId: 'target',
    };
}

function createMultiMode(): AppMode {
    return {
        instanceMode: 'multi',
    };
}

function createInstallation(guildId: string): BotInstallationRecord {
    const timestamp = new Date('2026-06-21T00:00:00.000Z');

    return {
        guildId,
        installedAt: timestamp,
        updatedAt: timestamp,
    };
}

function createCommandSettings(guildId: string, prefix: string): GuildCommandSettingsRecord {
    const timestamp = new Date('2026-06-24T00:00:00.000Z');

    return {
        guildId,
        prefix,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function createModerationCaseRecord(overrides: Partial<ModerationCaseRecord> = {}): ModerationCaseRecord {
    const timestamp = new Date('2026-06-25T00:00:00.000Z');

    return {
        id: 'case-1',
        guildId: 'guild-1',
        caseNumber: 1,
        action: 'warn',
        targetType: 'user',
        targetUserId: 'target-1',
        targetChannelId: null,
        actorUserId: 'author-1',
        reason: null,
        status: 'open',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createModerationPolicyRecord(
    overrides: Partial<GuildModerationPolicyRecord> = {}
): GuildModerationPolicyRecord {
    const timestamp = new Date('2026-06-25T00:00:00.000Z');

    return {
        guildId: 'guild-1',
        protectedUserIds: [],
        protectedRoleIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createModerationCaseEventRecord(
    overrides: Partial<ModerationCaseEventRecord> = {}
): ModerationCaseEventRecord {
    return {
        id: 'case-event-1',
        caseId: 'case-1',
        eventType: 'note.added',
        actorUserId: 'author-1',
        details: {
            note: 'Stored note',
        },
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
        ...overrides,
    };
}

function createModerationTemporaryActionRecord(
    overrides: Partial<ModerationTemporaryActionRecord> = {}
): ModerationTemporaryActionRecord {
    const timestamp = new Date('2026-06-25T00:00:00.000Z');

    return {
        id: 'temporary-action-1',
        guildId: 'guild-1',
        caseId: 'case-1',
        action: 'timeout',
        targetUserId: 'target-1',
        status: 'pending',
        expiresAt: new Date('2026-06-26T12:00:00.000Z'),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createLoggingDestinationRecord(
    overrides: Partial<GuildLoggingDestinationRecord> = {}
): GuildLoggingDestinationRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'logging-destination-1',
        guildId: 'guild-1',
        eventGroup: 'messages',
        channelId: 'log-channel-1',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createBotActionEventRecord(overrides: Partial<BotActionEventRecord> = {}): BotActionEventRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'bot-action-event-1',
        guildId: 'guild-1',
        feature: 'settings',
        action: 'command_prefix.updated',
        actorUserId: 'author-1',
        targetId: 'settings.prefix',
        metadata: {},
        createdAt: timestamp,
        ...overrides,
    };
}

function createAutomodRuleRecord(overrides: Partial<AutomodRuleRecord> = {}): AutomodRuleRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'automod-rule-1',
        guildId: 'guild-1',
        name: 'Automod rule',
        triggerType: 'blocked_terms',
        actionType: 'record',
        enabled: true,
        config: { terms: ['spam'] },
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createAutomodEventRecord(overrides: Partial<AutomodEventRecord> = {}): AutomodEventRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'automod-event-1',
        guildId: 'guild-1',
        ruleId: 'automod-rule-1',
        messageId: 'message-1',
        channelId: 'channel-1',
        authorUserId: 'author-1',
        triggerType: 'blocked_terms',
        actionType: 'record',
        status: 'recorded',
        details: {},
        createdAt: timestamp,
        ...overrides,
    };
}

function createAutoroleRuleRecord(overrides: Partial<AutoroleRuleRecord> = {}): AutoroleRuleRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'autorole-rule-1',
        guildId: 'guild-1',
        roleId: 'role-1',
        name: 'Member',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createReactionRoleMessageRecord(
    overrides: Partial<ReactionRoleMessageRecord> = {}
): ReactionRoleMessageRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'reaction-role-message-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        kind: 'reaction_role',
        mode: 'normal',
        source: 'existing',
        messageContent: null,
        messageEmbeds: [],
        generateOverview: false,
        enabled: true,
        staleAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createReactionRoleOptionRecord(overrides: Partial<ReactionRoleOptionRecord> = {}): ReactionRoleOptionRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'reaction-role-option-1',
        reactionRoleMessageId: 'reaction-role-message-1',
        emojiKey: 'unicode:check',
        roleId: 'role-1',
        position: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createReactionRoleAssignmentRecord(
    overrides: Partial<ReactionRoleAssignmentRecord> = {}
): ReactionRoleAssignmentRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'reaction-role-assignment-1',
        guildId: 'guild-1',
        messageId: 'message-1',
        userId: 'user-1',
        roleId: 'role-1',
        emojiKey: 'unicode:check',
        assignedAt: timestamp,
        removedAt: null,
        ...overrides,
    };
}

function createRoleReconciliationRunRecord(
    overrides: Partial<RoleReconciliationRunRecord> = {}
): RoleReconciliationRunRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'role-reconciliation-run-1',
        guildId: 'guild-1',
        status: 'pending',
        summary: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createRoleReconciliationActionRecord(
    overrides: Partial<RoleReconciliationActionRecord> = {}
): RoleReconciliationActionRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'role-reconciliation-action-1',
        runId: 'role-reconciliation-run-1',
        actionType: 'member.role_restored',
        roleId: 'role-1',
        status: 'applied',
        details: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createRoleReconciliationSettingsRecord(
    overrides: Partial<RoleReconciliationSettingsRecord> = {}
): RoleReconciliationSettingsRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        guildId: 'guild-1',
        enabled: true,
        restoreAutoroleRoles: true,
        restoreVerificationRoles: true,
        restoreReactionRoles: true,
        cleanupDeletedRoleReferences: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createDeletedRoleCleanupResult(status: 'cleaned' | 'unchanged') {
    const summary = {
        autoroleRulesDisabled: 0,
        commandPermissionRulesUpdated: 0,
        dashboardPermissionRulesUpdated: 0,
        moderationPoliciesUpdated: 0,
        reactionRoleAssignmentsRemoved: 0,
        reactionRoleOptionsDeleted: 0,
        ticketPanelsDisabled: 0,
        ticketPanelsUpdated: 0,
        verificationFlowsDisabled: 0,
        xpRoleRewardsDeleted: 0,
    };

    if (status === 'unchanged') {
        return { status, summary };
    }

    return {
        status,
        runId: 'role-reconciliation-run-1',
        summary: {
            ...summary,
            autoroleRulesDisabled: 1,
        },
    };
}

function createReactionRoleMatch(
    overrides: {
        message?: Partial<ReactionRoleMessageRecord>;
        option?: Partial<ReactionRoleOptionRecord>;
    } = {}
): ReactionRoleOptionMatch {
    const message = createReactionRoleMessageRecord(overrides.message);

    return {
        message,
        option: createReactionRoleOptionRecord({
            reactionRoleMessageId: message.id,
            ...overrides.option,
        }),
    };
}

function createVerificationFlowRecord(overrides: Partial<VerificationFlowRecord> = {}): VerificationFlowRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'verification-flow-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        emojiKey: 'unicode:check',
        verifiedRoleId: 'role-1',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createVerificationRecord(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'verification-record-1',
        guildId: 'guild-1',
        userId: 'user-1',
        method: 'reaction',
        verifiedAt: timestamp,
        revokedAt: null,
        ...overrides,
    };
}

function createGuildRole(overrides: { id: string; name: string; position: number }) {
    return {
        color: 0,
        permissions: '0',
        hoist: false,
        mentionable: false,
        ...overrides,
    };
}

function createMemberFlowRecord() {
    return {
        id: 'flow-1',
        guildId: 'guild-1',
        userId: 'user-1',
        eventType: 'join',
        inviteCode: null,
        inviterUserId: null,
        attributionStatus: 'unavailable',
        occurredAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}

function createMessageActivityRecord() {
    return {
        id: 'activity-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        activityDate: '2026-06-26',
        messageCount: 1,
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}

function createStructureObservedEventStateRecord(
    overrides: Partial<StructureObservedEventStateRecord> = {}
): StructureObservedEventStateRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        guildId: 'guild-1',
        observedChangeCount: 1,
        lastEventType: 'role.created',
        lastTargetType: 'role',
        lastTargetId: 'role-1',
        lastObservedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createSuggestionBoardRecord(overrides: Partial<SuggestionBoardRecord> = {}): SuggestionBoardRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'suggestion-board-1',
        guildId: 'guild-1',
        channelId: 'suggestions-channel-1',
        name: 'default',
        enabled: true,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createSuggestionRecord(overrides: Partial<SuggestionRecord> = {}): SuggestionRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'suggestion-1',
        guildId: 'guild-1',
        boardId: 'suggestion-board-1',
        channelId: 'suggestions-channel-1',
        messageId: 'suggestion-message-1',
        authorUserId: 'author-1',
        status: 'pending',
        content: 'Add more neon',
        createdAt: timestamp,
        updatedAt: timestamp,
        closedAt: null,
        ...overrides,
    };
}

function createSuggestionVoteRecord(overrides: Partial<SuggestionVoteRecord> = {}): SuggestionVoteRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'suggestion-vote-1',
        suggestionId: 'suggestion-1',
        userId: 'voter-1',
        vote: 'up',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createTicketPanelRecord(overrides: Partial<TicketPanelRecord> = {}): TicketPanelRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'ticket-panel-1',
        guildId: 'guild-1',
        channelId: 'ticket-panel-channel-1',
        messageId: 'ticket-panel-message-1',
        title: 'Open a ticket',
        enabled: true,
        config: {
            description: 'Need help? Open a ticket.',
            openEmoji: '🎫',
            openEmojiKey: 'unicode:🎫',
            ticketCategoryId: 'ticket-category-1',
            staffRoleIds: ['support-role-1'],
            ticketNameTemplate: 'ticket-{number}',
            maxOpenPerUser: 1,
            privateTickets: true,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createTicketRecord(overrides: Partial<TicketRecord> = {}): TicketRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'ticket-1',
        guildId: 'guild-1',
        panelId: 'ticket-panel-1',
        ticketNumber: 1,
        channelId: 'ticket-channel-1',
        openerUserId: 'author-1',
        status: 'open',
        claimedByUserId: null,
        openedAt: timestamp,
        closedAt: null,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createTicketMemberRecord(overrides: Partial<TicketMemberRecord> = {}): TicketMemberRecord {
    return {
        id: 'ticket-member-1',
        ticketId: 'ticket-1',
        userId: 'author-1',
        role: 'opener',
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createTicketEventRecord(overrides: Partial<TicketEventRecord> = {}): TicketEventRecord {
    return {
        id: 'ticket-event-1',
        ticketId: 'ticket-1',
        eventType: 'opened',
        actorUserId: 'author-1',
        details: {},
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createXpSettingsRecord(overrides: Partial<XpSettingsRecord> = {}): XpSettingsRecord {
    return {
        guildId: 'guild-1',
        enabled: true,
        messageXpMin: 5,
        messageXpMax: 10,
        cooldownSeconds: 60,
        voiceXpPerMinute: 2,
        voiceMinimumMinutes: 5,
        config: {},
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createGuildUserXpRecord(overrides: Partial<GuildUserXpRecord> = {}): GuildUserXpRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'guild-user-xp-1',
        guildId: 'guild-1',
        userId: 'author-1',
        xp: 125,
        level: 1,
        messageXp: 80,
        voiceXp: 45,
        messageCount: 12,
        voiceSeconds: 1_350,
        lastMessageXpAt: null,
        lastVoiceXpAt: null,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createXpGrantRecord(overrides: Partial<XpGrantRecord> = {}): XpGrantRecord {
    return {
        id: 'xp-grant-1',
        guildId: 'guild-1',
        userId: 'author-1',
        source: 'message',
        xp: 5,
        levelBefore: 0,
        levelAfter: 1,
        idempotencyKey: 'message:message-1',
        metadata: {},
        grantedAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createXpVoiceSessionRecord(overrides: Partial<XpVoiceSessionRecord> = {}): XpVoiceSessionRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'xp-voice-session-1',
        guildId: 'guild-1',
        userId: 'author-1',
        channelId: 'voice-1',
        status: 'active',
        startedAt: timestamp,
        endedAt: null,
        creditedSeconds: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createVcGeneratorRuleRecord(overrides: Partial<VcGeneratorRuleRecord> = {}): VcGeneratorRuleRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'vc-rule-1',
        guildId: 'guild-1',
        sourceChannelId: 'source-voice-1',
        nameTemplate: '{user} room',
        categoryId: 'category-1',
        enabled: true,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createGeneratedVoiceChannelRecord(
    overrides: Partial<GeneratedVoiceChannelRecord> = {}
): GeneratedVoiceChannelRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'generated-voice-row-1',
        guildId: 'guild-1',
        ruleId: 'vc-rule-1',
        channelId: 'generated-voice-1',
        ownerUserId: 'author-1',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSeenAt: timestamp,
        ...overrides,
    };
}

function createVcGeneratorControlPanelRecord(
    overrides: Partial<VcGeneratorControlPanelRecord> = {}
): VcGeneratorControlPanelRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'vc-panel-1',
        guildId: 'guild-1',
        ruleId: 'vc-rule-1',
        channelId: 'panel-channel-1',
        messageId: 'panel-message-1',
        controlMode: 'reaction',
        status: 'active',
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSyncedAt: timestamp,
        staleAt: null,
        ...overrides,
    };
}

function createVcGeneratorControlRequestRecord(
    overrides: Partial<VcGeneratorControlRequestRecord> = {}
): VcGeneratorControlRequestRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'vc-control-request-1',
        guildId: 'guild-1',
        generatedChannelId: 'generated-voice-row-1',
        panelChannelId: 'panel-channel-1',
        targetChannelId: 'generated-voice-1',
        requesterUserId: 'author-1',
        controlAction: 'rename',
        status: 'pending',
        promptMessageId: null,
        value: null,
        errorMessage: null,
        expiresAt: new Date('2030-06-26T00:10:00.000Z'),
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createFetchedMessage(messageId: string) {
    return {
        id: messageId,
        channelId: 'channel-1',
        guildId: 'guild-1',
    };
}

function createMessageEvent(
    overrides: Partial<Extract<Parameters<typeof routeBotFeatureEvent>[1], { type: 'message.created' }>> = {}
): Extract<Parameters<typeof routeBotFeatureEvent>[1], { type: 'message.created' }> {
    return {
        type: 'message.created',
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
        ...overrides,
    };
}

function getPlatformMessageSendInput(index = 0): PlatformMessageSendInput {
    const calls = messagesSendMock.mock.calls as Array<[PlatformMessageSendInput]>;
    const call = calls.at(index);

    if (!call) {
        throw new Error('Expected a platform message send call.');
    }

    return call[0];
}

function getPlatformMessageSendContent(index = 0): string {
    const content = getPlatformMessageSendInput(index).content;

    if (!content) {
        throw new Error('Expected platform message send content.');
    }

    return content;
}

function getRecentModerationCaseLookupInput(index = 0): RecentModerationCaseLookupInput {
    const calls = findRecentModerationCaseByTargetActionMock.mock.calls as Array<
        [BotFeatureHandlerContext['db'], RecentModerationCaseLookupInput]
    >;
    const call = calls.at(index);

    if (!call) {
        throw new Error('Expected a recent moderation case lookup call.');
    }

    return call[1];
}

function getLastReplyContent(): string {
    const content = sendFluxerChannelMessageMock.mock.calls.at(-1)?.[0].content;

    if (!content) {
        throw new Error('Expected a reply message.');
    }

    return content;
}
